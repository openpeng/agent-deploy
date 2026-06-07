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
  parameters?: Record<string, any>;
  workerYaml: WorkerYaml;
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

  async execute(args: Record<string, any>, context: ExecutionContext): Promise<any> {
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
      env: context.env as Record<string, string>,
      sharedContext: { ...context.sharedContext },
    });

    const engine = new PipelineEngine(registry, new ConsoleLogger(false));
    return await engine.execute(this.skill.workerYaml, skillContext);
  }
}

// ---------------------------------------------------------------------------
// SkillLoader
// ---------------------------------------------------------------------------

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

      let parsed: any;
      try {
        parsed = yaml.load(fs.readFileSync(filePath, "utf-8"));
      } catch (e) {
        console.warn(`[WARN] Failed to parse skill file ${filePath}: ${(e as Error).message}`);
        continue;
      }

      if (!parsed || !Array.isArray(parsed.pipeline)) {
        console.warn(`[WARN] Skill file ${filePath} has no 'pipeline' array — skipping`);
        continue;
      }

      const name = path.basename(file, path.extname(file));
      const workerYaml: WorkerYaml = {
        tools: parsed.tools || [],
        shared_context: parsed.shared_context || {},
        pipeline: parsed.pipeline,
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
  registerSkills(agentDir: string, registry: any): number {
    const skills = this.loadSkills(agentDir);
    for (const skill of skills) {
      registry.register(new SkillTool(skill, agentDir));
    }
    if (skills.length > 0) {
      console.log(`[Skills] Registered ${skills.length} skill(s): ${skills.map(s => s.name).join(", ")}`);
    }
    return skills.length;
  }
}
