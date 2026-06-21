import * as yaml from "js-yaml";
import * as fs from "fs";
import * as path from "path";
import {
  WorkerYaml,
  ToolDefinition,
  PipelineStep,
  ValidationResult,
} from "./types.js";

/**
 * Parse and validate worker.yaml file
 */
export class WorkerYamlParser {
  /**
   * Parse worker.yaml from file path
   */
  parseFile(yamlPath: string): WorkerYaml {
    if (!fs.existsSync(yamlPath)) {
      throw new Error(`Worker YAML file not found: ${yamlPath}`);
    }

    const content = fs.readFileSync(yamlPath, "utf-8");
    return this.parseString(content, yamlPath);
  }

  /**
   * Parse worker.yaml from string content
   */
  parseString(content: string, sourcePath?: string): WorkerYaml {
    let parsed: unknown;

    try {
      parsed = yaml.load(content);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new Error(
        `Failed to parse YAML${sourcePath ? ` in ${sourcePath}` : ""}: ${err.message}`
      );
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid YAML: root must be an object");
    }

    // Validate and construct WorkerYaml
    const p = parsed as Record<string, any>;
    const workerYaml: WorkerYaml = {
      tools: this.parseTools(p.tools),
      shared_context: p.shared_context || {},
      pipeline: this.parsePipeline(p.pipeline),
    };

    return workerYaml;
  }

  /**
   * Validate worker.yaml structure
   */
  validate(workerYaml: WorkerYaml): ValidationResult {
    const errors: string[] = [];

    // 1. Validate tools (optional - builtin tools are always available)
    if (workerYaml.tools) {
      const toolNames = new Set<string>();
      for (const tool of workerYaml.tools) {
        if (!tool.name) {
          errors.push("Tool is missing 'name' field");
        } else if (toolNames.has(tool.name)) {
          errors.push(`Duplicate tool name: ${tool.name}`);
        } else {
          toolNames.add(tool.name);
        }

        if (!tool.type) {
          errors.push(`Tool '${tool.name}' is missing 'type' field`);
        }
      }
    }

    // 2. Validate pipeline
    if (!workerYaml.pipeline || workerYaml.pipeline.length === 0) {
      errors.push("'pipeline' array is required and must not be empty");
    } else {
      const stepNames = new Set<string>();
      const declaredToolNames = new Set(workerYaml.tools?.map((t: ToolDefinition) => t.name) || []);

      // Builtin tools that are always available
      const builtinTools = new Set([
        "read_file",
        "write_file",
        "bash",
        "glob",
        "llm_chat",
        "web_fetch",
        "web_search",
        "invoke_agent",  // Add new builtin tool
      ]);

      for (let i = 0; i < workerYaml.pipeline.length; i++) {
        const step = workerYaml.pipeline[i];

        // Check step name
        if (!step.step) {
          errors.push(`Pipeline step ${i} is missing 'step' field`);
        } else if (stepNames.has(step.step)) {
          errors.push(`Duplicate step name: ${step.step}`);
        } else {
          stepNames.add(step.step);
        }

        // Check tool reference - allow `invoke`, `invoke_parallel` or `tool`
        if (!step.tool && !step.invoke && !step.invoke_parallel) {
          errors.push(`Step '${step.step}' is missing 'tool', 'invoke', or 'invoke_parallel' field`);
        } else if (step.tool && !declaredToolNames.has(step.tool) && !builtinTools.has(step.tool)) {
          errors.push(
            `Step '${step.step}' references undefined tool: ${step.tool}`
          );
        }

        // Validate invoke shorthand
        if (step.invoke) {
          if (!step.with || Object.keys(step.with).length === 0) {
            errors.push(
              `Step '${step.step}' uses 'invoke' but is missing 'with' field for input args`
            );
          }
        }

        // Validate invoke_parallel
        if (step.invoke_parallel) {
          if (!Array.isArray(step.invoke_parallel) || step.invoke_parallel.length === 0) {
            errors.push(`Step '${step.step}' has empty 'invoke_parallel' array`);
          } else {
            for (let j = 0; j < step.invoke_parallel.length; j++) {
              const inv = step.invoke_parallel[j];
              if (!inv.agent) {
                errors.push(`Step '${step.step}' invoke_parallel[${j}] is missing 'agent'`);
              }
            }
          }
        }

        // Validate on_fail strategy
        if (step.on_fail) {
          if (typeof step.on_fail === "string") {
            if (!["abort", "skip", "continue"].includes(step.on_fail)) {
              errors.push(
                `Step '${step.step}' has invalid on_fail strategy: ${step.on_fail}`
              );
            }
          } else if (typeof step.on_fail === "object") {
            if (!("retry" in step.on_fail) || typeof step.on_fail.retry !== "number") {
              errors.push(
                `Step '${step.step}' has invalid on_fail strategy: must be string or {retry: number}`
              );
            }
          } else {
            errors.push(
              `Step '${step.step}' has invalid on_fail strategy type`
            );
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private parseTools(tools: unknown): ToolDefinition[] {
    if (!Array.isArray(tools)) {
      throw new Error("'tools' must be an array");
    }

    return tools.map((tool, index) => {
      if (!tool || typeof tool !== "object") {
        throw new Error(`Tool at index ${index} must be an object`);
      }

      const t = tool as Record<string, unknown>;

      if (!t.name || typeof t.name !== "string") {
        throw new Error(
          `Tool at index ${index} is missing 'name' field (string)`
        );
      }

      if (!t.type || typeof t.type !== "string") {
        throw new Error(
          `Tool '${t.name}' is missing 'type' field (string)`
        );
      }

      return {
        name: t.name,
        type: t.type as import("./types.js").ToolType,
        subagent: typeof t.subagent === "string" ? t.subagent : undefined,
        server: typeof t.server === "string" ? t.server : undefined,
        skill_name: typeof t.skill_name === "string" ? t.skill_name : undefined,
      };
    });
  }

  private parsePipeline(pipeline: unknown): PipelineStep[] {
    if (!Array.isArray(pipeline)) {
      throw new Error("'pipeline' must be an array");
    }

    return pipeline.map((step, index) => {
      if (!step || typeof step !== "object") {
        throw new Error(`Pipeline step at index ${index} must be an object`);
      }

      const s = step as Record<string, unknown>;

      if (!s.step || typeof s.step !== "string") {
        throw new Error(
          `Pipeline step at index ${index} is missing 'step' field (string)`
        );
      }

      if (!s.tool || typeof s.tool !== "string") {
        throw new Error(
          `Step '${s.step}' is missing 'tool' field (string)`
        );
      }

      return {
        step: s.step,
        tool: s.tool,
        args: s.args as Record<string, unknown> | undefined,
        output: typeof s.output === "string" ? s.output : undefined,
        when: typeof s.when === "string" ? s.when : undefined,
        on_fail: s.on_fail as PipelineStep["on_fail"],
      };
    });
  }
}
