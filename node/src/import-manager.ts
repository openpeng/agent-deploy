/**
 * ImportManager - Phase 2
 * Orchestrates multiple ImportAdapters and handles agent importing
 */

import type { ImportAdapter } from "./import.js";
import type { AgentJsonV2 } from "./types.js";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, basename } from "path";

/**
 * Manages registration and execution of ImportAdapters
 */
export class ImportManager {
  private adapters: ImportAdapter[] = [];

  /**
   * Register an import adapter
   */
  registerAdapter(adapter: ImportAdapter): void {
    this.adapters.push(adapter);
  }

  /**
   * Get all registered adapters
   */
  getAdapters(): ImportAdapter[] {
    return [...this.adapters];
  }

  /**
   * Detect which adapter can handle the given source path
   *
   * @param sourcePath - Path to agent file or directory
   * @returns The first adapter that can import, or null if none found
   */
  detectAdapter(sourcePath: string): ImportAdapter | null {
    for (const adapter of this.adapters) {
      if (adapter.canImport(sourcePath)) {
        return adapter;
      }
    }
    return null;
  }

  /**
   * Force a specific adapter by tool name
   *
   * @param toolName - Tool identifier (e.g., "cursor", "claude_code")
   * @returns The adapter or null if not found
   */
  getAdapterByName(toolName: string): ImportAdapter | null {
    return this.adapters.find(a => a.getToolInfo().name === toolName) || null;
  }

  /**
   * Import an agent from source path to output directory
   *
   * @param sourcePath - Path to the agent file or directory
   * @param outputDir - Directory where agent.json will be created
   * @param toolName - Optional: force specific tool adapter
   * @returns Path to the created agent directory
   * @throws Error if no adapter found or import fails
   */
  importAgent(sourcePath: string, outputDir: string, toolName?: string): string {
    // Select adapter
    let adapter: ImportAdapter | null = null;

    if (toolName) {
      adapter = this.getAdapterByName(toolName);
      if (!adapter) {
        throw new Error(`No adapter found for tool: ${toolName}`);
      }
    } else {
      adapter = this.detectAdapter(sourcePath);
      if (!adapter) {
        throw new Error(
          `No adapter found for: ${sourcePath}\n` +
          `Tried ${this.adapters.length} adapter(s). ` +
          `Supported formats: ${this.adapters.map(a => a.getToolInfo().name).join(", ")}`
        );
      }
    }

    // Import to AgentJsonV2
    const descriptor = adapter.importFrom(sourcePath);

    // Create output directory
    const agentName = descriptor.identity.name;
    const agentDir = join(outputDir, agentName);

    if (!existsSync(agentDir)) {
      mkdirSync(agentDir, { recursive: true });
    }

    // Write agent.json
    const agentJsonPath = join(agentDir, "agent.json");
    writeFileSync(agentJsonPath, JSON.stringify(descriptor, null, 2), "utf-8");

    return agentDir;
  }

  /**
   * Dry-run: show what would be imported without writing files
   *
   * @param sourcePath - Path to agent file or directory
   * @param toolName - Optional: force specific tool adapter
   * @returns The descriptor that would be written
   */
  dryRun(sourcePath: string, toolName?: string): AgentJsonV2 {
    let adapter: ImportAdapter | null = null;

    if (toolName) {
      adapter = this.getAdapterByName(toolName);
      if (!adapter) {
        throw new Error(`No adapter found for tool: ${toolName}`);
      }
    } else {
      adapter = this.detectAdapter(sourcePath);
      if (!adapter) {
        throw new Error(
          `No adapter found for: ${sourcePath}\n` +
          `Supported formats: ${this.adapters.map(a => a.getToolInfo().name).join(", ")}`
        );
      }
    }

    return adapter.importFrom(sourcePath);
  }

  /**
   * List all registered adapters with their info
   */
  listAdapters(): Array<{ name: string; pattern: string; description: string }> {
    return this.adapters.map(a => a.getToolInfo());
  }
}
