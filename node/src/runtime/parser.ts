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
    let parsed: any;

    try {
      parsed = yaml.load(content);
    } catch (error) {
      const err = error as Error;
      throw new Error(
        `Failed to parse YAML${sourcePath ? ` in ${sourcePath}` : ""}: ${
          err.message
        }`
      );
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid YAML: root must be an object");
    }

    // Validate and construct WorkerYaml
    const workerYaml: WorkerYaml = {
      tools: this.parseTools(parsed.tools),
      shared_context: parsed.shared_context || {},
      pipeline: this.parsePipeline(parsed.pipeline),
    };

    return workerYaml;
  }

  /**
   * Validate worker.yaml structure
   */
  validate(workerYaml: WorkerYaml): ValidationResult {
    const errors: string[] = [];

    // 1. Validate tools
    if (!workerYaml.tools || workerYaml.tools.length === 0) {
      errors.push("'tools' array is required and must not be empty");
    } else {
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
      const toolNames = new Set(workerYaml.tools.map((t: ToolDefinition) => t.name));

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

        // Check tool reference
        if (!step.tool) {
          errors.push(`Step '${step.step}' is missing 'tool' field`);
        } else if (!toolNames.has(step.tool)) {
          errors.push(
            `Step '${step.step}' references undefined tool: ${step.tool}`
          );
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

  private parseTools(tools: any): ToolDefinition[] {
    if (!Array.isArray(tools)) {
      throw new Error("'tools' must be an array");
    }

    return tools.map((tool, index) => {
      if (!tool || typeof tool !== "object") {
        throw new Error(`Tool at index ${index} must be an object`);
      }

      if (!tool.name || typeof tool.name !== "string") {
        throw new Error(
          `Tool at index ${index} is missing 'name' field (string)`
        );
      }

      if (!tool.type || typeof tool.type !== "string") {
        throw new Error(
          `Tool '${tool.name}' is missing 'type' field (string)`
        );
      }

      return {
        name: tool.name,
        type: tool.type,
        subagent: tool.subagent,
        server: tool.server,
        skill_name: tool.skill_name,
      };
    });
  }

  private parsePipeline(pipeline: any): PipelineStep[] {
    if (!Array.isArray(pipeline)) {
      throw new Error("'pipeline' must be an array");
    }

    return pipeline.map((step, index) => {
      if (!step || typeof step !== "object") {
        throw new Error(`Pipeline step at index ${index} must be an object`);
      }

      if (!step.step || typeof step.step !== "string") {
        throw new Error(
          `Pipeline step at index ${index} is missing 'step' field (string)`
        );
      }

      if (!step.tool || typeof step.tool !== "string") {
        throw new Error(
          `Step '${step.step}' is missing 'tool' field (string)`
        );
      }

      return {
        step: step.step,
        tool: step.tool,
        args: step.args,
        output: step.output,
        when: step.when,
        on_fail: step.on_fail,
      };
    });
  }
}
