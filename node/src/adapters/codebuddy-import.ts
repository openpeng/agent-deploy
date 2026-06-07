/**
 * CodeBuddy Import Adapter - Phase 2
 * Imports agents from CodeBuddy format: .codebuddy/skills/[name]/SKILL.md
 */

import type { ImportAdapter } from "../import.js";
import type { AgentJsonV2 } from "../types.js";
import { slugify, extractDescription, parseFrontmatter } from "../import.js";
import { existsSync, readFileSync } from "fs";
import { basename, dirname } from "path";

/**
 * CodeBuddyImportAdapter imports agents from CodeBuddy format
 *
 * Input: .codebuddy/skills/my-skill/SKILL.md
 * Output: agent.json v2.0 with instructions
 *
 * CodeBuddy format uses YAML frontmatter + markdown
 */
export class CodeBuddyImportAdapter implements ImportAdapter {
  canImport(sourcePath: string): boolean {
    const normalized = sourcePath.replace(/\\/g, "/");
    return normalized.includes(".codebuddy/skills") && normalized.endsWith("SKILL.md");
  }

  importFrom(sourcePath: string): AgentJsonV2 {
    if (!existsSync(sourcePath)) {
      throw new Error(`CodeBuddy SKILL.md file not found: ${sourcePath}`);
    }

    const content = readFileSync(sourcePath, "utf-8");

    // Extract skill name from directory name
    const skillDir = basename(dirname(sourcePath));
    const name = slugify(skillDir);

    // Parse YAML frontmatter (required for CodeBuddy)
    const { frontmatter, body } = parseFrontmatter(content);

    if (!frontmatter.name && !frontmatter.display_name) {
      throw new Error(
        `CodeBuddy SKILL.md must have YAML frontmatter with 'name' field.\n` +
        `File: ${sourcePath}`
      );
    }

    const displayName = frontmatter.display_name || frontmatter.name || skillDir;
    const description = frontmatter.description || extractDescription(body) || "";

    // Build agent.json v2.0
    const agentJson: AgentJsonV2 = {
      schema_version: "2.0",
      identity: {
        name: frontmatter.name ? slugify(frontmatter.name) : name,
        version: frontmatter.version || "1.0.0",
        display_name: displayName,
        description,
        author: frontmatter.author || "Imported from CodeBuddy",
        tags: [
          ...(Array.isArray(frontmatter.tags) ? frontmatter.tags : []),
          "codebuddy",
          "imported"
        ]
      },
      instructions: {
        format: "markdown",
        source: "inline",
        content: body
      },
      capabilities: frontmatter.capabilities || [],
      compatibility: {
        codebuddy: true,
        source: "codebuddy",
        original_path: sourcePath
      }
    };

    return agentJson;
  }

  getToolInfo() {
    return {
      name: "codebuddy",
      pattern: ".codebuddy/skills/*/SKILL.md",
      description: "Import agents from CodeBuddy skill format"
    };
  }
}
