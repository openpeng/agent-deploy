/**
 * ImportAdapter Interface - Phase 2
 * Enables importing agents from various AI tools into agent.json format
 */

import type { AgentJsonV2 } from "./types.js";

/**
 * ImportAdapter interface - converts AI tool formats to agent.json
 *
 * Each platform adapter implements this interface to enable
 * importing agents from that platform into the agent-market.
 */
export interface ImportAdapter {
  /**
   * Import an agent from the source path and convert to AgentJsonV2 format
   *
   * @param sourcePath - Path to the agent file or directory
   * @returns AgentJsonV2 descriptor ready to be written as agent.json
   * @throws Error if import fails or format is invalid
   */
  importFrom(sourcePath: string): AgentJsonV2;

  /**
   * Check if this adapter can import from the given path
   *
   * @param sourcePath - Path to check
   * @returns true if this adapter recognizes the format
   */
  canImport(sourcePath: string): boolean;

  /**
   * Get metadata about this adapter's capabilities
   *
   * @returns Tool information for registration and discovery
   */
  getToolInfo(): {
    /** Tool identifier (e.g., "cursor", "claude_code") */
    name: string;
    /** File/directory pattern this adapter matches (e.g., "*.cursor/commands/*.md") */
    pattern: string;
    /** Human-readable description */
    description: string;
  };
}

/**
 * Helper function to slugify a name
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Helper function to extract description from markdown content
 * Looks for the first paragraph after the title
 */
export function extractDescription(content: string, maxLength: number = 200): string {
  // Remove YAML frontmatter if present
  const contentWithoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, "");

  // Remove title (first # line)
  const withoutTitle = contentWithoutFrontmatter.replace(/^#[^\n]*\n+/, "");

  // Get first paragraph
  const firstParagraph = withoutTitle.split("\n\n")[0] || "";
  const cleaned = firstParagraph.trim().replace(/\n/g, " ");

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  // Truncate at word boundary
  const truncated = cleaned.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > 0 ? truncated.slice(0, lastSpace) + "..." : truncated + "...";
}

/**
 * Helper function to parse YAML frontmatter
 */
export function parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    return { frontmatter: {}, body: content };
  }

  const yamlText = frontmatterMatch[1];
  const body = frontmatterMatch[2];

  // Simple YAML parser (supports key: value and arrays)
  const frontmatter: Record<string, any> = {};
  const lines = yamlText.split("\n");
  let currentKey: string | null = null;
  let currentArray: any[] = [];

  for (const line of lines) {
    // Array item (starts with -)
    if (line.match(/^\s*-\s+(.+)$/)) {
      const arrayMatch = line.match(/^\s*-\s+(.+)$/);
      if (arrayMatch && currentKey) {
        currentArray.push(arrayMatch[1].trim());
      }
      continue;
    }

    // Key: value pair
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      // Save previous array if exists
      if (currentKey && currentArray.length > 0) {
        frontmatter[currentKey] = currentArray;
        currentArray = [];
      }

      const key = match[1];
      let value: any = match[2].trim();

      // Check if this is starting an array (empty value or ends with :)
      if (!value) {
        currentKey = key;
        currentArray = [];
        continue;
      }

      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      frontmatter[key] = value;
      currentKey = null;
    }
  }

  // Save final array if exists
  if (currentKey && currentArray.length > 0) {
    frontmatter[currentKey] = currentArray;
  }

  return { frontmatter, body };
}
