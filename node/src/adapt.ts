import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { loadRegistry } from "./registry.js";

/** Regex to detect YAML frontmatter delimited by --- */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;

export interface AdaptationResult {
  /** The adapted markdown / yaml+markdown content. */
  content: string;
  /** Relative path where this file should be written. */
  target_file: string;
  /** Format hint: "markdown" or "yaml+markdown". */
  format: string;
  /** When true, content should be appended to an existing file. */
  append?: boolean;
  /** Agent name slug for path substitution. */
  slug?: string;
}

/**
 * Unified Agent Descriptor - internal representation.
 */
interface AgentDescriptor {
  name: string;
  displayName: string;
  version: string;
  description: string;
  instructions: string;
  capabilities: any[];
  compatibility: Record<string, any>;
  metadata: Record<string, any>;
}

/**
 * Load agent from agent.json (primary) or SKILL.md (fallback).
 *
 * Priority:
 * 1. agent.json with instructions field
 * 2. agent.json + external instruction file
 * 3. SKILL.md (deprecated, backward compatibility)
 */
function loadAgentDescriptor(agentPath: string): AgentDescriptor {
  const agentJsonPath = join(agentPath, "agent.json");
  const skillMdPath = join(agentPath, "SKILL.md");

  // Try agent.json first
  if (existsSync(agentJsonPath)) {
    try {
      const raw = readFileSync(agentJsonPath, "utf8");
      const agentJson = JSON.parse(raw);
      return parseAgentJson(agentJson, agentPath);
    } catch (err: any) {
      console.warn(`[WARN] Failed to parse agent.json: ${err.message}`);
      console.warn(`[WARN] Falling back to SKILL.md...`);
    }
  }

  // Fallback to SKILL.md
  if (existsSync(skillMdPath)) {
    console.warn(`[DEPRECATED] Using SKILL.md as fallback. Consider migrating to agent.json with instructions field.`);
    return parseSkillMd(skillMdPath);
  }

  throw new Error(
    `No agent.json or SKILL.md found in ${agentPath}. ` +
    `Agent directory must contain at least one of these files.`
  );
}

/**
 * Parse agent.json into AgentDescriptor.
 */
function parseAgentJson(agentJson: any, agentPath: string): AgentDescriptor {
  // Support both new (identity) and old (flat) format
  const identity = agentJson.identity || agentJson;

  const name = identity.name || agentPath.split("/").pop() || "agent";
  const displayName = identity.display_name || identity.displayName || name;
  const version = identity.version || "1.0.0";
  const description = identity.description || "";

  // Extract instructions (CORE CHANGE)
  let instructions = "";

  if (agentJson.instructions) {
    const inst = agentJson.instructions;

    if (inst.source === "inline") {
      instructions = inst.content || "";
    } else if (inst.source === "file") {
      const instFile = inst.file || "";
      if (instFile) {
        const instPath = join(agentPath, instFile);
        if (existsSync(instPath)) {
          instructions = readFileSync(instPath, "utf8");
        } else {
          console.warn(`[WARN] Instruction file not found: ${instPath}`);
        }
      }
    }
  }

  // Strategy 2: Generate from subagents (PilotDeck Agent format)
  if (!instructions && agentJson.subagents && agentJson.subagents.length > 0) {
    const entry = agentJson.entry?.main_subagent || agentJson.subagents[0].name;

    instructions = `# ${identity.display_name || identity.name}

${identity.description || ""}

## Workflows

This agent contains ${agentJson.subagents.length} sub-workflow(s):

${agentJson.subagents.map((sub: any) => `- **${sub.name}** (\`${sub.path}\`): ${sub.description || "No description"}`).join("\n")}

Entry workflow: **${entry}**

## Usage

This agent is based on PilotDeck workflow orchestration. See individual \`.yaml\` files for detailed configuration.
`;
    console.warn(`[INFO] Generated instructions from subagents for PilotDeck Agent format.`);
  }

  // Strategy 3: Fallback to SKILL.md
  if (!instructions) {
    const skillMdPath = join(agentPath, "SKILL.md");
    if (existsSync(skillMdPath)) {
      console.warn(`[DEPRECATED] agent.json found but no instructions field. Falling back to SKILL.md.`);
      instructions = readFileSync(skillMdPath, "utf8");
      // Strip YAML frontmatter for cleaner output
      instructions = stripFrontmatter(instructions);
    }
  }

  // Strategy 4: Fallback to README.md
  if (!instructions) {
    const readmePath = join(agentPath, "README.md");
    if (existsSync(readmePath)) {
      console.warn(`[FALLBACK] Using README.md as instructions source.`);
      instructions = readFileSync(readmePath, "utf8");
    }
  }

  if (!instructions) {
    throw new Error(
      `No instructions found. Tried:\n` +
      `1. agent.json instructions field\n` +
      `2. Generated from subagents\n` +
      `3. SKILL.md file\n` +
      `4. README.md file\n` +
      `Please add at least one of these to your agent.`
    );
  }

  const capabilities = agentJson.capabilities || [];
  const compatibility = agentJson.compatibility || {};

  const metadata = {
    schema_version: agentJson.schema_version || "1.0",
    author: identity.author || "",
    license: identity.license || "MIT",
  };

  return {
    name,
    displayName,
    version,
    description,
    instructions,
    capabilities,
    compatibility,
    metadata,
  };
}

/**
 * Strip YAML frontmatter from markdown.
 */
function stripFrontmatter(text: string): string {
  const match = text.match(FRONTMATTER_RE);
  if (match) {
    return text.slice(match[0].length).trim();
  }
  return text.trim();
}

/**
 * Parse SKILL.md (legacy format) into AgentDescriptor.
 */
function parseSkillMd(skillPath: string): AgentDescriptor {
  const raw = readFileSync(skillPath, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);

  const fm = frontmatter ? parseYamlFrontmatter(frontmatter) : {};
  const name = fm.name || skillPath.split("/").slice(-2, -1)[0] || "agent";
  const description = (fm.description || "").trim();

  return {
    name,
    displayName: fm.display_name || fm.displayName || name,
    version: fm.version || "1.0.0",
    description,
    instructions: body,
    capabilities: [],
    compatibility: {},
    metadata: { source: "skill_md", frontmatter: fm },
  };
}

/**
 * Extract YAML frontmatter (the block between --- delimiters) and the body.
 */
function parseFrontmatter(raw: string): { frontmatter: string | null; body: string } {
  const match = raw.match(FRONTMATTER_RE);
  if (match) {
    return {
      frontmatter: match[1].trim(),
      body: raw.slice(match[0].length).trim(),
    };
  }
  return { frontmatter: null, body: raw.trim() };
}

/**
 * Parse YAML frontmatter string into object (simplified).
 */
function parseYamlFrontmatter(yaml: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = yaml.split("\n");
  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      const key = match[1];
      let value: any = match[2].trim();
      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  }
  return result;
}

/**
 * Generate a URL-safe slug from an agent name.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Read agent from directory and adapt it for the target tool.
 * Now uses loadAgentDescriptor() which prioritizes agent.json.
 *
 * @param agentPath - Path to the agent directory (must contain agent.json or SKILL.md).
 * @param target    - Registry key of the target tool (e.g. "opencode").
 * @returns AdaptationResult with the transformed content and target path.
 */
export function adaptAgent(agentPath: string, target: string): AdaptationResult {
  // Load unified AgentDescriptor
  const descriptor = loadAgentDescriptor(agentPath);
  const slug = slugify(descriptor.name);

  const registry = loadRegistry();
  const toolConfig = registry.tools[target];
  if (!toolConfig) {
    return {
      content: `# Error\n\nUnknown target tool: ${target}`,
      target_file: `unknown/${target}.md`,
      format: "markdown",
      slug,
    };
  }

  // Adapt based on target tool
  switch (target) {
    case "opencode":
    case "cursor": {
      // Strip YAML frontmatter, wrap as a markdown command.
      const header = `# ${descriptor.displayName}\n\n`;
      const content = header + descriptor.instructions;
      return {
        content,
        target_file: `.${target}/commands/${slug}.md`,
        format: "markdown",
        slug,
      };
    }

    case "codebuddy": {
      // Keep YAML frontmatter, add codebuddy-specific header.
      let out = `---\nname: ${descriptor.name}\nversion: ${descriptor.version}\ndescription: ${descriptor.description}\n---\n\n`;
      out += `<!-- codebuddy:skill name="${descriptor.name}" -->\n\n`;
      out += descriptor.instructions;
      return {
        content: out,
        target_file: `.codebuddy/skills/${slug}/SKILL.md`,
        format: "yaml+markdown",
        slug,
      };
    }

    case "codebuddy_agent": {
      // NEW: Plain markdown file for CodeBuddy agents
      const content = `# ${descriptor.displayName}\n\n**Version**: ${descriptor.version}\n**Description**: ${descriptor.description}\n\n${descriptor.instructions}\n\n---\n*Adapted from PilotDeck Market by agent-deploy v2.0*\n`;
      return {
        content,
        target_file: `.codebuddy/agents/${slug}.md`,
        format: "markdown",
        slug,
      };
    }

    case "claude_code": {
      // Strip YAML, wrap with slash-command format.
      const ccContent = `# /${slug} — ${descriptor.displayName}\n\n## Description\n\n${descriptor.description}\n\n${descriptor.instructions}`;
      return {
        content: ccContent,
        target_file: `.claude/commands/${slug}.md`,
        format: "markdown",
        slug,
      };
    }

    case "github_copilot": {
      // Markdown with an agent-style prompt header.
      const ghContent = `# ${descriptor.displayName}\n\n> AI agent prompt – generated by agent-deploy v2.0\n\n${descriptor.description}\n\n${descriptor.instructions}`;
      return {
        content: ghContent,
        target_file: `.github/agents/${slug}.md`,
        format: "markdown",
        slug,
      };
    }

    case "windsurf":
    case "trae": {
      // Rules-style format — add a small header block.
      const rulesContent = `# Rule: ${descriptor.displayName}\n\n${descriptor.description}\n\n${descriptor.instructions}`;
      const dir = `.${target}/rules`;
      return {
        content: rulesContent,
        target_file: `${dir}/${slug}.md`,
        format: "markdown",
        slug,
      };
    }

    case "aider": {
      // Append-mode: CONVENTIONS.md section.
      const aiderSection = `\n\n---\n## ${descriptor.displayName}\n\n${descriptor.description}\n\n${descriptor.instructions}`;
      return {
        content: aiderSection,
        target_file: "CONVENTIONS.md",
        format: "markdown",
        append: true,
        slug,
      };
    }

    case "agents_md": {
      // Append-mode: AGENTS.md section.
      const agentsSection = `\n\n---\n## ${descriptor.displayName}\n\n**Description**: ${descriptor.description}\n\n${descriptor.instructions}`;
      return {
        content: agentsSection,
        target_file: "AGENTS.md",
        format: "markdown",
        append: true,
        slug,
      };
    }

    default:
      throw new Error(`No adaptation strategy for tool: ${target}`);
  }
}
