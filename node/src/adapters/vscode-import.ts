/**
 * VS Code Import Adapter - Phase 3
 * Imports agents from VS Code's .vscode/prompts/*.md format
 */

import type { ImportAdapter } from "../import.js";
import type { AgentJsonV2 } from "../types.js";
import { slugify, extractDescription, parseFrontmatter } from "../import.js";
import { existsSync, readFileSync } from "fs";
import { basename } from "path";

/**
 * VSCodeImportAdapter imports agents from VS Code prompt format
 *
 * Input: .vscode/prompts/my-agent.md
 * Output: agent.json v2.0 with instructions
 */
export class VSCodeImportAdapter implements ImportAdapter {
  canImport(sourcePath: string): boolean {
    const normalized = sourcePath.replace(/\\/g, "/");
    return normalized.includes(".vscode/prompts") && normalized.endsWith(".md");
  }

  importFrom(sourcePath: string): AgentJsonV2 {
    if (!existsSync(sourcePath)) {
      throw new Error(`VS Code prompt file not found: ${sourcePath}`);
    }

    const content = readFileSync(sourcePath, "utf-8");
    const fileName = basename(sourcePath, ".md");
    const name = slugify(fileName);

    // Parse frontmatter if present
    const { frontmatter, body } = parseFrontmatter(content);

    // Extract display name from content or filename
    const displayName = frontmatter.name ||
                       frontmatter.display_name ||
                       this.extractTitle(content) ||
                       fileName;

    // Extract description
    const description = frontmatter.description ||
                       extractDescription(body) ||
                       `Imported from VS Code: ${fileName}`;

    // Build agent.json v2.0
    const agentJson: AgentJsonV2 = {
      schema_version: "2.0",
      identity: {
        name,
        version: frontmatter.version || "1.0.0",
        display_name: displayName,
        description,
        author: frontmatter.author || "Imported from VS Code",
        tags: ["vscode", "imported"]
      },
      instructions: {
        format: "markdown",
        source: "inline",
        content: body
      },
      capabilities: [],
      compatibility: {
        vscode: true,
        source: "vscode",
        original_path: sourcePath
      }
    };

    return agentJson;
  }

  getToolInfo() {
    return {
      name: "vscode",
      pattern: ".vscode/prompts/*.md",
      description: "Import agents from VS Code prompt format"
    };
  }

  /**
   * Extract title from markdown (first # heading)
   */
  private extractTitle(content: string): string | null {
    const match = content.match(/^#\s+(.+)$/m);
    if (!match) return null;

    return match[1]
      .trim()
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ");
  }
}
