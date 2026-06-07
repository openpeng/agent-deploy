/**
 * GitHub Copilot Import Adapter - Phase 2
 * Imports agents from GitHub's .github/agents/*.md format
 */

import type { ImportAdapter } from "../import.js";
import type { AgentJsonV2 } from "../types.js";
import { slugify, extractDescription, parseFrontmatter } from "../import.js";
import { existsSync, readFileSync } from "fs";
import { basename } from "path";

/**
 * GitHubImportAdapter imports agents from GitHub Copilot format
 *
 * Input: .github/agents/my-agent.md
 * Output: agent.json v2.0 with instructions
 */
export class GitHubImportAdapter implements ImportAdapter {
  canImport(sourcePath: string): boolean {
    const normalized = sourcePath.replace(/\\/g, "/");
    return normalized.includes(".github/agents") && normalized.endsWith(".md");
  }

  importFrom(sourcePath: string): AgentJsonV2 {
    if (!existsSync(sourcePath)) {
      throw new Error(`GitHub agent file not found: ${sourcePath}`);
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
                       `Imported from GitHub Copilot: ${fileName}`;

    // Build agent.json v2.0
    const agentJson: AgentJsonV2 = {
      schema_version: "2.0",
      identity: {
        name,
        version: frontmatter.version || "1.0.0",
        display_name: displayName,
        description,
        author: frontmatter.author || "Imported from GitHub Copilot",
        tags: ["github_copilot", "imported"]
      },
      instructions: {
        format: "markdown",
        source: "inline",
        content: body
      },
      capabilities: [],
      compatibility: {
        github_copilot: true,
        source: "github_copilot",
        original_path: sourcePath
      }
    };

    return agentJson;
  }

  getToolInfo() {
    return {
      name: "github_copilot",
      pattern: ".github/agents/*.md",
      description: "Import agents from GitHub Copilot agent format"
    };
  }

  /**
   * Extract title from markdown (first # heading)
   */
  private extractTitle(content: string): string | null {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }
}
