import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { loadRegistry } from "./registry.js";
import * as yaml from "js-yaml";

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
 * Load and translate worker.yaml pipeline into executable CC prompt instructions.
 * Returns null if no worker.yaml found or parsing fails.
 */
function loadWorkerYamlAsPrompt(agentPath: string, subagentPath: string): string | null {
  const yamlPath = join(agentPath, subagentPath);
  if (!existsSync(yamlPath)) return null;

  let parsed: any;
  try {
    const content = readFileSync(yamlPath, "utf8");
    parsed = yaml.load(content);
  } catch {
    return null;
  }

  if (!parsed || !Array.isArray(parsed.pipeline)) return null;

  const toolInstructions: Record<string, (args: any) => string> = {
    write_file: (args: any) =>
      `Write the following content to file \`${args.path}\`:\n\`\`\`\n${args.content}\n\`\`\`${args.mode === "append" ? "\n(append to existing file)" : ""}`,
    web_fetch: (args: any) =>
      `Fetch URL via HTTP ${args.method || "GET"}: \`${args.url}\``,
    bash: (args: any) =>
      `Run shell command:\n\`\`\`bash\n${args.command}\n\`\`\``,
    read_file: (args: any) =>
      `Read file: \`${args.path}\``,
    glob: (args: any) =>
      `Find files matching pattern: \`${args.pattern}\``,
    llm_chat: (args: any) =>
      `Ask LLM: ${args.prompt}`,
    web_search: (args: any) =>
      `Search the web for: ${args.query}`,
  };

  // Extract all {{varName}} template variables from args, excluding steps.* and shared_context keys
  const varPattern = /\{\{([^}]+)\}\}/g;
  const allVars = new Set<string>();
  const sharedKeys = new Set(Object.keys(parsed.shared_context || {}));
  for (const step of parsed.pipeline) {
    const argsStr = JSON.stringify(step.args || {});
    let m: RegExpExecArray | null;
    while ((m = varPattern.exec(argsStr)) !== null) {
      const v = m[1].trim();
      if (!v.startsWith("steps.") && !v.startsWith("shared_context.") && !sharedKeys.has(v)) {
        allVars.add(v);
      }
    }
  }

  const paramSection = allVars.size > 0
    ? `## Parameters\n\nProvide the following values when invoking this agent (use \`$ARGUMENTS\` or pass as key=value):\n\n${[...allVars].map(v => `- \`${v}\``).join("\n")}\n\n`
    : "";

  const steps: string[] = parsed.pipeline.map((step: any, i: number) => {
    const num = i + 1;
    const toolFn = (toolInstructions as any)[step.tool];
    const instruction = toolFn
      ? toolFn(step.args || {})
      : `Call tool \`${step.tool}\` with args: ${JSON.stringify(step.args || {})}`;
    const outputNote = step.output ? ` Save result as \`${step.output}\`.` : "";
    return `**Step ${num}: ${step.step}**\n${instruction}${outputNote}`;
  });

  const sharedCtx = parsed.shared_context
    ? `\n\n**Shared context**: ${JSON.stringify(parsed.shared_context)}`
    : "";

  return paramSection + steps.join("\n\n") + sharedCtx;
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
export function adaptAgent(agentPath: string, target: string, targetFile?: string): AdaptationResult {
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

  let result: AdaptationResult;

  // Adapt based on target tool
  switch (target) {
    case "opencode":
    case "cursor": {
      // Strip YAML frontmatter, wrap as a markdown command.
      const header = `# ${descriptor.displayName}\n\n`;
      const content = header + descriptor.instructions;
      result = {
        content,
        target_file: `.${target}/commands/${slug}.md`,
        format: "markdown",
        slug,
      };
      break;
    }

    case "codebuddy": {
      // Keep YAML frontmatter, add codebuddy-specific header.
      let out = `---\nname: ${descriptor.name}\nversion: ${descriptor.version}\ndescription: ${descriptor.description}\n---\n\n`;
      out += `<!-- codebuddy:skill name="${descriptor.name}" -->\n\n`;
      out += descriptor.instructions;
      result = {
        content: out,
        target_file: `.codebuddy/skills/${slug}/SKILL.md`,
        format: "yaml+markdown",
        slug,
      };
      break;
    }

    case "codebuddy_agent": {
      // CodeBuddy Agent format - plain markdown with optional pipeline info
      const agentJsonPath = join(agentPath, "agent.json");
      let pipelineInfo = "";

      // Check for worker.yaml pipeline (direct or via subagents)
      if (existsSync(agentJsonPath)) {
        try {
          const agentJson = JSON.parse(readFileSync(agentJsonPath, "utf8"));
          let pipelinePath: string | null = null;

          // Check direct worker.yaml in agent dir
          const directWorkerPath = join(agentPath, "worker.yaml");
          if (existsSync(directWorkerPath)) {
            pipelinePath = "worker.yaml";
          }
          // Check subagents for entry point
          else if (agentJson.subagents && agentJson.subagents.length > 0) {
            const entryName = agentJson.entry?.main_subagent || agentJson.subagents[0].name;
            const entrySubagent = agentJson.subagents.find((s: any) => s.name === entryName) || agentJson.subagents[0];
            if (entrySubagent && entrySubagent.path) {
              pipelinePath = entrySubagent.path;
            }
          }

          if (pipelinePath) {
            const pipelinePrompt = loadWorkerYamlAsPrompt(agentPath, pipelinePath);
            if (pipelinePrompt) {
              pipelineInfo = `## Pipeline\n\n${pipelinePrompt}\n\n`;
            }
          }
        } catch {
          // ignore, fall through to basic instructions
        }
      }

      const content =
        `# ${descriptor.displayName}\n\n` +
        `**Version**: ${descriptor.version}\n` +
        `**Description**: ${descriptor.description}\n\n` +
        pipelineInfo +
        `${descriptor.instructions}\n\n` +
        `---\n` +
        `*Adapted from Agent Market by agent-deploy v${descriptor.version}*\n`;
      result = {
        content,
        target_file: `.codebuddy/agents/${slug}.md`,
        format: "markdown",
        slug,
      };
      break;
    }

    case "claude_code": {
      // Check if agent has subagents with worker.yaml pipeline — translate to executable prompt
      const agentJsonPath = join(agentPath, "agent.json");
      let pipelinePrompt: string | null = null;
      if (existsSync(agentJsonPath)) {
        try {
          const agentJson = JSON.parse(readFileSync(agentJsonPath, "utf8"));
          if (agentJson.subagents && agentJson.subagents.length > 0) {
            const entrySubagentName = agentJson.entry?.main_subagent || agentJson.subagents[0].name;
            const entrySubagent = agentJson.subagents.find((s: any) => s.name === entrySubagentName) || agentJson.subagents[0];
            pipelinePrompt = loadWorkerYamlAsPrompt(agentPath, entrySubagent.path);
          }
        } catch {
          // fall through to descriptor.instructions
        }
      }

      const body = pipelinePrompt
        ? `## Description\n\n${descriptor.description}\n\n## Steps\n\nExecute the following steps in order:\n\n${pipelinePrompt}`
        : `## Description\n\n${descriptor.description}\n\n${descriptor.instructions}`;

      const ccContent = `# /${slug} — ${descriptor.displayName}\n\n${body}`;
      result = {
        content: ccContent,
        target_file: `.claude/commands/${slug}.md`,
        format: "markdown",
        slug,
      };
      break;
    }

    case "github_copilot": {
      // Markdown with an agent-style prompt header.
      const ghContent = `# ${descriptor.displayName}\n\n> AI agent prompt – generated by agent-deploy v2.0\n\n${descriptor.description}\n\n${descriptor.instructions}`;
      result = {
        content: ghContent,
        target_file: `.github/agents/${slug}.md`,
        format: "markdown",
        slug,
      };
      break;
    }

    case "windsurf":
    case "trae": {
      // Rules-style format — add a small header block.
      const rulesContent = `# Rule: ${descriptor.displayName}\n\n${descriptor.description}\n\n${descriptor.instructions}`;
      const dir = `.${target}/rules`;
      result = {
        content: rulesContent,
        target_file: `${dir}/${slug}.md`,
        format: "markdown",
        slug,
      };
      break;
    }

    case "aider": {
      // Append-mode: CONVENTIONS.md section.
      const aiderSection = `\n\n---\n## ${descriptor.displayName}\n\n${descriptor.description}\n\n${descriptor.instructions}`;
      result = {
        content: aiderSection,
        target_file: "CONVENTIONS.md",
        format: "markdown",
        append: true,
        slug,
      };
      break;
    }

    case "agents_md": {
      // Append-mode: AGENTS.md section.
      const agentsSection = `\n\n---\n## ${descriptor.displayName}\n\n**Description**: ${descriptor.description}\n\n${descriptor.instructions}`;
      result = {
        content: agentsSection,
        target_file: "AGENTS.md",
        format: "markdown",
        append: true,
        slug,
      };
      break;
    }

    default:
      throw new Error(`No adaptation strategy for tool: ${target}`);
  }

  // Override target_file if explicitly provided
  if (targetFile) {
    result.target_file = targetFile;
  }

  return result;
}
