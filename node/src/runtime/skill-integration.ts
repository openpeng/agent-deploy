/**
 * Skill System Integration
 *
 * Skills are self-contained pipeline fragments stored in the agent's skills/
 * directory.  Each skill is a worker.yaml file (same schema as the agent's
 * main pipeline) that can be invoked as a tool from the parent pipeline.
 *
 * Agent layout:
 *   my-agent/
 *     agent.json
 *     worker.yaml          ← main pipeline
 *     skills/
 *       summarize.yaml     ← skill "summarize"
 *       translate.yaml     ← skill "translate"
 *
 * Usage in worker.yaml:
 *   pipeline:
 *     - step: do_summary
 *       tool: summarize       ← matches skills/summarize.yaml
 *       args:
 *         text: "{{input}}"
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { ExecutionContext, WorkerYaml } from "./types.js";
import { ExecutionContextManager } from "./context.js";
import { PipelineEngine, ConsoleLogger } from "./pipeline.js";
import { ToolRegistry } from "./tool-registry.js";
import { ReadFileTool } from "./tools/read-file.js";
import { WriteFileTool } from "./tools/write-file.js";
import { BashTool } from "./tools/bash.js";
import { GlobTool } from "./tools/glob.js";
import { LLMChatTool } from "./tools/llm-chat.js";
import { WebFetchTool } from "./tools/web-fetch.js";
import { WebSearchTool } from "./tools/web-search.js";

export interface SkillDefinition {
  name: string;
  description: string;
  entry_point: string;
  parameters?: Record<string, unknown>;
  workerYaml: WorkerYaml;
}

interface ParsedSkillYaml {
  tools?: unknown[];
  shared_context?: Record<string, unknown>;
  pipeline: unknown[];
  description?: string;
  parameters?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// SkillTool — executes a skill pipeline as a named tool
// ---------------------------------------------------------------------------

export class SkillTool {
  readonly name: string;

  constructor(
    private skill: SkillDefinition,
    private agentDir: string
  ) {
    this.name = skill.name;
  }

  async execute(args: Record<string, unknown>, context: ExecutionContext): Promise<unknown> {
    // Build an isolated registry with builtin tools (skills cannot use other skills)
    const registry = new ToolRegistry();
    registry.register(new ReadFileTool());
    registry.register(new WriteFileTool());
    registry.register(new BashTool());
    registry.register(new GlobTool());
    registry.register(new LLMChatTool());
    registry.register(new WebFetchTool());
    registry.register(new WebSearchTool());

    // Isolated context: inherit cwd/env from parent, fresh steps
    const skillContext = ExecutionContextManager.create({
      agent: context.agent,
      initialArgs: args,
      cwd: context.cwd,
      env: context.env,
      sharedContext: { ...context.sharedContext },
    });

    const engine = new PipelineEngine(registry, new ConsoleLogger(false));
    return await engine.execute(this.skill.workerYaml, skillContext);
  }
}

// ---------------------------------------------------------------------------
// SkillLoader
// ---------------------------------------------------------------------------

interface ToolRegistryLike {
  register(tool: { name: string; execute(args: unknown, ctx: unknown): Promise<unknown> }): void;
}

export class SkillLoader {
  /**
   * Scan agent's skills/ directory for *.yaml files and parse each as a
   * WorkerYaml pipeline.  Returns an empty array if the directory doesn't exist.
   */
  loadSkills(agentDir: string): SkillDefinition[] {
    const skillsDir = path.join(agentDir, "skills");
    if (!fs.existsSync(skillsDir)) return [];

    const skills: SkillDefinition[] = [];

    for (const file of fs.readdirSync(skillsDir)) {
      if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
      const filePath = path.join(skillsDir, file);

      let parsed: ParsedSkillYaml | null = null;
      try {
        parsed = yaml.load(fs.readFileSync(filePath, "utf-8")) as ParsedSkillYaml | null;
      } catch (e) {
        console.warn(`[WARN] Failed to parse skill file ${filePath}: ${(e as Error).message}`);
        continue;
      }

      if (!parsed || !Array.isArray(parsed.pipeline)) {
        console.warn(`[WARN] Skill file ${filePath} has no 'pipeline' array — skipping`);
        continue;
      }

      const name = path.basename(file, path.extname(file));
      interface ParsedToolEntry {
        name: string;
        type: string;
        subagent?: string;
        server?: string;
        skill_name?: string;
      }
      interface ParsedPipelineEntry {
        step: string;
        tool?: string;
        args?: Record<string, unknown>;
        output?: string;
        when?: string;
        on_fail?: unknown;
        timeout_ms?: number;
        invoke?: string;
        with?: Record<string, unknown>;
        invoke_parallel?: unknown;
        as?: Record<string, string>;
      }
      const workerYaml: WorkerYaml = {
        tools: (parsed.tools || []).map((t) => {
          const entry = t as ParsedToolEntry;
          return {
            name: entry.name,
            type: entry.type as import("./types.js").ToolType,
            subagent: entry.subagent,
            server: entry.server,
            skill_name: entry.skill_name,
          };
        }),
        shared_context: parsed.shared_context || {},
        pipeline: parsed.pipeline.map((s) => {
          const entry = s as ParsedPipelineEntry;
          return {
            step: entry.step,
            tool: entry.tool,
            args: entry.args,
            output: entry.output,
            when: entry.when,
            on_fail: entry.on_fail as import("./types.js").OnFailStrategy | undefined,
            timeout_ms: entry.timeout_ms,
            invoke: entry.invoke,
            with: entry.with,
            invoke_parallel: entry.invoke_parallel as Array<{ agent: string; with?: Record<string, unknown> }> | undefined,
            as: entry.as,
          };
        }),
      };

      skills.push({
        name,
        description: parsed.description || `Skill: ${name}`,
        entry_point: filePath,
        parameters: parsed.parameters,
        workerYaml,
      });
    }

    return skills;
  }

  /**
   * Register all skills from the agent directory into the provided ToolRegistry.
   * Returns the number of skills registered.
   */
  registerSkills(agentDir: string, registry: ToolRegistryLike): number {
    const skills = this.loadSkills(agentDir);
    for (const skill of skills) {
      registry.register(new SkillTool(skill, agentDir));
    }
    if (skills.length > 0) {
      console.log(`[Skills] Registered ${skills.length} skill(s): ${skills.map(s => s.name).join(", ")}`);
    }
    return skills.length;
  }

  /**
   * Register skills from runtime SkillDefinition array (not from agent directory).
   * Used by agent-executor to merge overrides.skills at execution time.
   *
   * @param skillDefs - Array of SkillDefinition objects to register
   * @param registry  - Target ToolRegistry to register skills into
   * @returns         - Number of skills registered
   */
  registerFromDefs(skillDefs: SkillDefinition[], registry: ToolRegistryLike): number {
    let count = 0;
    // agentDir is required for SkillTool constructor but is not used for execution
    // when skills come from runtime overrides rather than a directory
    const dummyDir = process.cwd();

    for (const skill of skillDefs) {
      if (!skill.name || !skill.workerYaml || !Array.isArray(skill.workerYaml.pipeline)) {
        console.warn(`[WARN] Skipping invalid skill definition: ${skill.name || "unnamed"}`);
        continue;
      }
      registry.register(new SkillTool(skill, dummyDir));
      count++;
    }

    if (count > 0) {
      console.log(`[Skills] Registered ${count} skill(s) from runtime config: ${skillDefs.map(s => s.name).join(", ")}`);
    }
    return count;
  }

}
