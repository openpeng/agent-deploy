/**
 * Scan deployed agents across all AI coding tools.
 * Discovers agents by scanning the filesystem directories defined in the registry.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, basename, extname } from "path";
import { homedir } from "os";
import { loadRegistry } from "./registry.js";
import { syncStateWithFilesystem, getActiveDeployments, type DeploymentRecord } from "./state.js";

export interface ScannedAgent {
  /** Agent name (derived from filename or directory name) */
  name: string;
  /** Target tool registry key */
  tool: string;
  /** Absolute path to the agent file */
  path: string;
  /** Install level: "project" or "user" */
  level: string;
  /** File modification time */
  modified_at: string;
  /** Whether this deployment was tracked in state */
  tracked: boolean;
  /** Version from state (if tracked) */
  version?: string;
  /** Deployment time from state (if tracked) */
  deployed_at?: string;
}

/** Extract agent name from a path based on tool conventions */
function extractAgentName(filePath: string, toolKey: string): string | null {
  const registry = loadRegistry();
  const config = registry.tools[toolKey];
  if (!config) return null;

  const { agent_format } = config;
  const ext = extname(filePath);
  const base = basename(filePath, ext);

  // For CONVENTIONS.md and AGENTS.md, we can't extract individual agent names
  // from filename alone - they'd need content parsing
  if (base === "CONVENTIONS" || base === "AGENTS") {
    return base.toLowerCase();
  }

  return base;
}

/** Scan a single directory for agent files */
function scanDirectory(dirPath: string, toolKey: string, level: string): ScannedAgent[] {
  const results: ScannedAgent[] = [];
  if (!existsSync(dirPath)) return results;

  const stats = statSync(dirPath);
  if (!stats.isDirectory()) return results;

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // For tools that use subdirectories (e.g., .codebuddy/skills/{agent}/SKILL.md)
        const skillFile = join(fullPath, "SKILL.md");
        if (existsSync(skillFile)) {
          const stat = statSync(skillFile);
          results.push({
            name: entry.name,
            tool: toolKey,
            path: skillFile,
            level,
            modified_at: stat.mtime.toISOString(),
            tracked: false,
          });
        }
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const agentName = extractAgentName(fullPath, toolKey);
        if (agentName) {
          const stat = statSync(fullPath);
          results.push({
            name: agentName,
            tool: toolKey,
            path: fullPath,
            level,
            modified_at: stat.mtime.toISOString(),
            tracked: false,
          });
        }
      }
    }
  } catch {
    // Directory might not be readable
  }

  return results;
}

/** Scan for deployed agents across all tools */
export function scanDeployedAgents(workspaceRoot?: string): ScannedAgent[] {
  const root = workspaceRoot ?? process.cwd();
  const registry = loadRegistry();
  const results: ScannedAgent[] = [];

  // First sync state with filesystem
  syncStateWithFilesystem();

  // Get tracked deployments for merging
  const trackedDeployments = getActiveDeployments();
  const trackedPaths = new Set(trackedDeployments.map((d) => d.install_path));

  for (const [toolKey, config] of Object.entries(registry.tools)) {
    const { install, agent_format } = config;

    // Scan project-level paths
    if (install.project_level) {
      const projectPath = join(root, agent_format.directory || ".");
      const scanned = scanDirectory(projectPath, toolKey, "project");
      results.push(...scanned);
    }

    // Scan user-level paths
    if (install.user_level) {
      const userDir = agent_format.directory || ".";
      const userPath = join(homedir(), userDir.startsWith(".") ? userDir : `.${userDir}`);
      const scanned = scanDirectory(userPath, toolKey, "user");
      results.push(...scanned);
    }
  }

  // Merge with tracked deployments
  const merged = new Map<string, ScannedAgent>();

  // Add scanned results
  for (const scanned of results) {
    const key = `${scanned.tool}:${scanned.path}`;
    merged.set(key, scanned);
  }

  // Add/merge tracked deployments
  for (const tracked of trackedDeployments) {
    const key = `${tracked.target_tool}:${tracked.install_path}`;
    const existing = merged.get(key);
    if (existing) {
      existing.tracked = true;
      existing.version = tracked.version;
      existing.deployed_at = tracked.deployed_at;
    } else {
      // Tracked file no longer exists on disk (should have been cleaned by syncStateWithFilesystem)
      // but include it for completeness
      merged.set(key, {
        name: tracked.agent_name,
        tool: tracked.target_tool,
        path: tracked.install_path,
        level: tracked.level,
        modified_at: tracked.deployed_at,
        tracked: true,
        version: tracked.version,
        deployed_at: tracked.deployed_at,
      });
    }
  }

  return Array.from(merged.values());
}

/** Get summary of deployments per tool */
export function getDeploymentSummary(workspaceRoot?: string): Record<string, number> {
  const agents = scanDeployedAgents(workspaceRoot);
  const summary: Record<string, number> = {};
  for (const agent of agents) {
    summary[agent.tool] = (summary[agent.tool] || 0) + 1;
  }
  return summary;
}
