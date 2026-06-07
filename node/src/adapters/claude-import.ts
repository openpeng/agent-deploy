/**
 * Claude Code Import Adapter - Phase 2
 * Imports agents from Claude Code's .claude/commands/*.md format
 */

import type { ImportAdapter } from "../import.js";
import type { AgentJsonV2 } from "../types.js";
import { slugify, extractDescription, parseFrontmatter } from "../import.js";
import { existsSync, readFileSync } from "fs";
import { basename } from "path";

/**
 * ClaudeImportAdapter imports agents from Claude Code format
 *
 * Input: .claude/commands/my-skill.md
 * Output: agent.json v2.0 with instructions
 *
 * Claude Code format often uses slash command style:
 * # /command-name — Display Name
 */
export class ClaudeImportAdapter implements ImportAdapter {
  canImport(sourcePath: string): boolean {
    const normalized = sourcePath.replace(/\\/g, "/");
    return normalized.includes(".claude/commands") && normalized.endsWith(".md");
  }

  importFrom(sourcePath: string): AgentJsonV2 {
    if (!existsSync(sourcePath)) {
      throw new Error(`Claude Code command file not found: ${sourcePath}`);
    }

    const content = readFileSync(sourcePath, "utf-8");
    const fileName = basename(sourcePath, ".md");
    const name = slugify(fileName);

    // Parse frontmatter if present
    const { frontmatter, body } = parseFrontmatter(content);

    // Extract display name from Claude Code slash command format
    const displayName = frontmatter.name ||
                       frontmatter.display_name ||
                       this.extractSlashCommandName(content) ||
                       fileName;

    // Extract description
    const description = frontmatter.description ||
                       this.extractDescriptionFromContent(body) ||
                       extractDescription(body) ||
                       `Imported from Claude Code: ${fileName}`;

    // Build agent.json v2.0
    const agentJson: AgentJsonV2 = {
      schema_version: "2.0",
      identity: {
        name,
        version: frontmatter.version || "1.0.0",
        display_name: displayName,
        description,
        author: frontmatter.author || "Imported from Claude Code",
        tags: ["claude_code", "imported"]
      },
      instructions: {
        format: "markdown",
        source: "inline",
        content: body
      },
      capabilities: [],
      compatibility: {
        claude_code: true,
        source: "claude_code",
        original_path: sourcePath
      }
    };

    return agentJson;
  }

  getToolInfo() {
    return {
      name: "claude_code",
      pattern: ".claude/commands/*.md",
      description: "Import agents from Claude Code command format"
    };
  }

  /**
   * Extract display name from Claude Code slash command format
   * # /command-name — Display Name
   */
  private extractSlashCommandName(content: string): string | null {
    const match = content.match(/^#\s*\/[\w-]+\s*[—–-]\s*(.+)$/m);
    if (match) {
      return match[1]
        .trim()
        .replace(/\n+/g, " ")
        .replace(/\s+/g, " ");
    }

    // Fallback to simple title
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (!titleMatch) return null;

    return titleMatch[1]
      .trim()
      .replace(/^\//, "")
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ");
  }

  /**
   * Extract description from ## Description section
   */
  private extractDescriptionFromContent(content: string): string | null {
    const match = content.match(/##\s+Description\s*\n\n(.+?)(?:\n\n|$)/s);
    if (!match) return null;

    return match[1]
      .trim()
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ");
  }
}
