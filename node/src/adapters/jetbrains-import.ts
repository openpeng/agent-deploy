/**
 * JetBrains Import Adapter - Phase 3
 * Imports agents from JetBrains AI Assistant prompts format
 */

import type { ImportAdapter } from "../import.js";
import type { AgentJsonV2 } from "../types.js";
import { slugify, extractDescription, parseFrontmatter } from "../import.js";
import { existsSync, readFileSync } from "fs";
import { basename } from "path";

/**
 * JetBrainsImportAdapter imports agents from JetBrains AI Assistant format
 *
 * Input: .idea/ai-prompts/*.md
 * Output: agent.json v2.0 with instructions
 */
export class JetBrainsImportAdapter implements ImportAdapter {
  canImport(sourcePath: string): boolean {
    const normalized = sourcePath.replace(/\\/g, "/");
    return normalized.includes(".idea/ai-prompts") && normalized.endsWith(".md");
  }

  importFrom(sourcePath: string): AgentJsonV2 {
    if (!existsSync(sourcePath)) {
      throw new Error(`JetBrains AI prompt file not found: ${sourcePath}`);
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
                       `Imported from JetBrains: ${fileName}`;

    // Build agent.json v2.0
    const agentJson: AgentJsonV2 = {
      schema_version: "2.0",
      identity: {
        name,
        version: frontmatter.version || "1.0.0",
        display_name: displayName,
        description,
        author: frontmatter.author || "Imported from JetBrains",
        tags: ["jetbrains", "imported"]
      },
      instructions: {
        format: "markdown",
        source: "inline",
        content: body
      },
      capabilities: [],
      compatibility: {
        jetbrains: true,
        source: "jetbrains",
        original_path: sourcePath
      }
    };

    return agentJson;
  }

  getToolInfo() {
    return {
      name: "jetbrains",
      pattern: ".idea/ai-prompts/*.md",
      description: "Import agents from JetBrains AI Assistant prompt format"
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
