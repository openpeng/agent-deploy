import { mkdir, writeFile, appendFile } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { loadRegistry, getToolConfig } from "./registry.js";

export interface InstallEntry {
  /** Registry key of the target tool. */
  tool: string;
  /** Absolute path where the file was (or would be) written. */
  path: string;
  /** Installation level: "project" or "user". */
  level: string;
  /** "installed", "dry-run", or "error: <msg>". */
  status: string;
  /** Error message if status is "error". */
  error?: string;
}

/**
 * Install adapted agent content for a given target tool.
 *
 * @param content    - Adapted markdown content (from adaptAgent).
 * @param agentName  - Human-readable agent name (used in template substitution).
 * @param targetTool - Registry key of the target tool.
 * @param level      - "project", "user", or "both".
 * @param dryRun      - If true, compute paths but do not write.
 * @returns Array of InstallEntry records, one per installed path.
 */
export async function installAgent(
  content: string,
  agentName: string,
  targetTool: string,
  level: string,
  dryRun: boolean,
): Promise<InstallEntry[]> {
  const config = getToolConfig(targetTool);
  if (!config) {
    return [{ tool: targetTool, path: '', level: level, status: 'error', error: `Unknown target tool: ${targetTool}` }];
  }

  const { install } = config;
  const slug = agentName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const bases: Array<{ root: string; level: string }> = [];

  if (level === "project" || level === "both") {
    bases.push({ root: process.cwd(), level: "project" });
  }
  if (level === "user" || level === "both") {
    bases.push({ root: homedir(), level: "user" });
  }

  const entries: InstallEntry[] = [];

  for (const { root, level: lvl } of bases) {
    // Match install entry to the correct level
    const installKey = lvl === "project" ? "project_level" : "user_level";
    const templatePath = install[installKey];
    if (!templatePath) continue;

    // Replace template placeholders
    let relPath = templatePath
      .replace(/\{agent_name\}/g, agentName)
      .replace(/\{slug\}/g, slug);

    // Strip leading ~/ for user-level paths (root is already homedir)
    relPath = relPath.replace(/^~\//, "");

    const absPath = join(root, relPath);

    if (dryRun) {
      entries.push({
        tool: targetTool,
        path: absPath,
        level: lvl,
        status: "dry-run",
      });
    } else {
      try {
        await mkdir(dirname(absPath), { recursive: true });
        // Check if this is an append-mode template (CONVENTIONS.md / AGENTS.md)
        if (
          relPath === "CONVENTIONS.md" ||
          relPath === "AGENTS.md"
        ) {
          await appendFile(absPath, content, "utf8");
        } else {
          await writeFile(absPath, content, "utf8");
        }
        entries.push({
          tool: targetTool,
          path: absPath,
          level: lvl,
          status: "installed",
        });
      } catch (err: any) {
        entries.push({
          tool: targetTool,
          path: absPath,
          level: lvl,
          status: `error: ${err.message}`,
        });
      }
    }
  }

  return entries;
}
