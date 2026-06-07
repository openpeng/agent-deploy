import * as fs from "fs";
import * as path from "path";
import { WorkerYaml } from "./types.js";

/**
 * V2 to V3 compatibility layer
 * Automatically converts v2 agents (with instructions) to v3 format (with worker.yaml)
 */
export class V2CompatibilityLayer {
  /**
   * Detect if an agent is v2 format
   */
  isV2Agent(agentJsonPath: string): boolean {
    if (!fs.existsSync(agentJsonPath)) {
      return false;
    }

    try {
      const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));

      // Check for v2 indicators:
      // 1. schema_version is "2.0" OR
      // 2. Has instructions field AND no worker.yaml in same directory
      const isV2Schema = agentJson.schema_version === "2.0";
      const hasInstructions = agentJson.instructions !== undefined;
      const agentDir = path.dirname(agentJsonPath);
      const hasWorkerYaml = fs.existsSync(path.join(agentDir, "worker.yaml"));

      return isV2Schema || (hasInstructions && !hasWorkerYaml);
    } catch (error) {
      return false;
    }
  }

  /**
   * Convert v2 agent to v3 worker.yaml format
   *
   * Strategy:
   * - Extract instructions.content as system prompt
   * - Create simple pipeline: llm_chat with system prompt
   * - Accept user_input as {{user_input}} or {{args.input}}
   */
  convertToV3WorkerYaml(agentJsonPath: string): WorkerYaml {
    const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));

    // Extract instructions
    const instructions = agentJson.instructions?.content || "";
    const agentName = agentJson.identity?.name || agentJson.name || "agent";

    // Build worker.yaml structure
    const workerYaml: WorkerYaml = {
      pipeline: [
        {
          step: "process_with_instructions",
          tool: "llm_chat",
          args: {
            system_prompt: instructions,
            prompt: "{{input}}",
            model: "claude-3-5-sonnet-20241022",
            temperature: 0.7,
          },
          output: "result",
        },
      ],
    };

    return workerYaml;
  }

  /**
   * Get or generate worker.yaml for an agent
   *
   * - If worker.yaml exists, load it (v3 agent)
   * - If not, check if v2 agent and auto-convert
   * - Otherwise, throw error
   */
  getWorkerYaml(agentDir: string): WorkerYaml {
    const workerYamlPath = path.join(agentDir, "worker.yaml");
    const agentJsonPath = path.join(agentDir, "agent.json");

    // Try to load existing worker.yaml (v3 agent)
    if (fs.existsSync(workerYamlPath)) {
      const yaml = require("js-yaml");
      return yaml.load(fs.readFileSync(workerYamlPath, "utf-8")) as WorkerYaml;
    }

    // Check if v2 agent
    if (this.isV2Agent(agentJsonPath)) {
      return this.convertToV3WorkerYaml(agentJsonPath);
    }

    // Neither v2 nor v3
    throw new Error(
      `No worker.yaml found and agent is not v2 compatible: ${agentDir}`
    );
  }

  /**
   * Get migration info for a v2 agent
   */
  getMigrationInfo(agentJsonPath: string): {
    is_v2: boolean;
    has_worker_yaml: boolean;
    can_auto_convert: boolean;
    suggestions: string[];
  } {
    const agentDir = path.dirname(agentJsonPath);
    const workerYamlPath = path.join(agentDir, "worker.yaml");
    const isV2 = this.isV2Agent(agentJsonPath);
    const hasWorkerYaml = fs.existsSync(workerYamlPath);

    const suggestions: string[] = [];

    if (isV2 && !hasWorkerYaml) {
      suggestions.push("This is a v2 agent. It will run in compatibility mode.");
      suggestions.push("Consider creating a worker.yaml for better control.");
      suggestions.push("See: migration-v2-to-v3.md for migration guide.");
    }

    return {
      is_v2: isV2,
      has_worker_yaml: hasWorkerYaml,
      can_auto_convert: isV2,
      suggestions,
    };
  }

  /**
   * Generate and save worker.yaml for a v2 agent
   * Useful for migrating agents permanently
   */
  generateWorkerYamlFile(agentJsonPath: string, outputPath?: string): string {
    const yaml = require("js-yaml");
    const agentDir = path.dirname(agentJsonPath);
    const workerYaml = this.convertToV3WorkerYaml(agentJsonPath);

    const output = outputPath || path.join(agentDir, "worker.yaml");
    const yamlContent = yaml.dump(workerYaml, {
      indent: 2,
      lineWidth: 80,
      noRefs: true,
    });

    fs.writeFileSync(output, yamlContent, "utf-8");

    return output;
  }
}
