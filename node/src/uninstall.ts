/**
 * Uninstall agent from target AI coding tools.
 * Removes deployed agent files and updates state tracking.
 */

import { existsSync, unlinkSync, rmSync } from "fs";
import { dirname, basename } from "path";
import { removeDeployment } from "./state.js";

export interface UninstallEntry {
  /** Registry key of the target tool */
  tool: string;
  /** Absolute path that was targeted */
  path: string;
  /** "uninstalled", "not_found", or "error: <msg>" */
  status: string;
  /** Error message if status is "error" */
  error?: string;
}

/**
 * Uninstall an agent from a target tool.
 *
 * @param agentName  - Name of the agent to uninstall.
 * @param targetTool - Registry key of the target tool.
 * @param installPath - Absolute path to the installed agent file.
 * @param level      - "project" or "user".
 * @returns UninstallEntry record.
 */
export function uninstallAgent(
  agentName: string,
  targetTool: string,
  installPath: string,
  level: string,
): UninstallEntry {
  try {
    if (!existsSync(installPath)) {
      // Already removed, just update state
      removeDeployment(agentName, targetTool, level);
      return {
        tool: targetTool,
        path: installPath,
        status: "not_found",
      };
    }

    // Remove the file
    unlinkSync(installPath);

    // Try to remove empty parent directory (for directory-based installs like .codebuddy/skills/)
    const parentDir = dirname(installPath);
    const parentName = basename(parentDir);
    if (parentName === agentName || parentName === "skills" || parentName === "agents") {
      try {
        rmSync(parentDir, { recursive: true, force: true });
      } catch {
        // Directory not empty or not removable, ignore
      }
    }

    // Update state
    removeDeployment(agentName, targetTool, level);

    return {
      tool: targetTool,
      path: installPath,
      status: "uninstalled",
    };
  } catch (err: unknown) {
    return {
      tool: targetTool,
      path: installPath,
      status: `error: ${(err as Error).message}`,
    };
  }
}
