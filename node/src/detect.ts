import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { loadRegistry, listToolKeys, type ToolConfig } from "./registry.js";

export interface DetectionResult {
  /** Registry key of the tool (e.g. "claude_code", "codebuddy"). */
  tool: string;
  /** Human-friendly display name from the registry. */
  name: string;
  /** Confidence score 0-1. Higher means more certain. */
  confidence: number;
  /** Which detection method succeeded (binary, config_file, env_var). */
  detected_by: string;
}

/**
 * Run `which <cmd>` to see if a binary is on PATH.
 * Returns true if found, false otherwise.
 */
function binaryExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect a single tool against the given workspace root.
 * Returns a DetectionResult if found, or null.
 */
function detectOne(
  toolKey: string,
  config: ToolConfig,
  workspaceRoot: string,
): DetectionResult | null {
  const { detection } = config;

  // 1. Binary detection – highest confidence
  if (detection.binaries) {
    for (const binary of detection.binaries) {
      if (binaryExists(binary)) {
        return {
          tool: toolKey,
          name: config.name,
          confidence: 0.9,
          detected_by: `binary:${binary}`,
        };
      }
    }
  }

  // 2. Config file detection – medium confidence
  if (detection.config_files) {
    for (const relPath of detection.config_files) {
      const fullPath = join(workspaceRoot, relPath);
      if (existsSync(fullPath)) {
        return {
          tool: toolKey,
          name: config.name,
          confidence: 0.6,
          detected_by: `config_file:${relPath}`,
        };
      }
    }
  }

  // 3. Environment variable detection – lower confidence
  if (detection.env_vars) {
    for (const envVar of detection.env_vars) {
      if (process.env[envVar]) {
        return {
          tool: toolKey,
          name: config.name,
          confidence: 0.5,
          detected_by: `env_var:${envVar}`,
        };
      }
    }
  }

  return null;
}

/**
 * Detect all installed AI coding tools in the workspace.
 *
 * @param workspaceRoot - Directory to scan for config files. Defaults to cwd.
 * @returns Detection results sorted by confidence descending.
 */
export function detectAll(workspaceRoot?: string): DetectionResult[] {
  const root = workspaceRoot ?? process.cwd();
  const registry = loadRegistry();
  const results: DetectionResult[] = [];

  for (const toolKey of listToolKeys()) {
    const config = registry.tools[toolKey];
    if (!config) continue;
    const result = detectOne(toolKey, config, root);
    if (result) {
      results.push(result);
    }
  }

  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

/**
 * Return the single highest-confidence detected tool, or null if none found.
 */
export function detectPrimary(workspaceRoot?: string): DetectionResult | null {
  const all = detectAll(workspaceRoot);
  return all.length > 0 ? all[0] : null;
}
