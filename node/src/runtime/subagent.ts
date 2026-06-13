import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { WorkerYaml, ExecutionContext } from "./types.js";
import { ExecutionContextManager } from "./context.js";
import { PipelineEngine } from "./pipeline.js";
import { ToolRegistry } from "./tool-registry.js";

/**
 * Subagent executor
 * Executes a child agent's worker.yaml in an isolated context
 * with tool inheritance from parent
 */
export class SubagentExecutor {
  /**
   * Execute a subagent
   *
   * @param agentPath Path to the agent directory (containing agent.json and worker.yaml)
   * @param args Arguments to pass to the subagent
   * @param parentContext Parent execution context (for tool inheritance)
   * @param parentRegistry Parent tool registry (for tool inheritance)
   * @returns Subagent execution result
   */
  async execute(
    agentPath: string,
    args: Record<string, any>,
    parentContext: ExecutionContext,
    parentRegistry: ToolRegistry
  ): Promise<any> {
    // Validate agent path
    if (!fs.existsSync(agentPath)) {
      throw new Error(`Subagent path not found: ${agentPath}`);
    }

    // Load worker.yaml
    const workerYamlPath = path.join(agentPath, "worker.yaml");
    if (!fs.existsSync(workerYamlPath)) {
      throw new Error(`worker.yaml not found in agent: ${agentPath}`);
    }

    const workerYaml = yaml.load(
      fs.readFileSync(workerYamlPath, "utf-8")
    ) as WorkerYaml;

    // Create child tool registry (inherits from parent)
    const childRegistry = parentRegistry.createChild();

    // Load agent.json to get agent metadata
    const agentJsonPath = path.join(agentPath, "agent.json");
    let agentName = path.basename(agentPath);
    if (fs.existsSync(agentJsonPath)) {
      const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
      agentName = agentJson.name || agentName;
    }

    // Create child execution context
    const childContext = ExecutionContextManager.create({
      agent: { name: agentName },
      initialArgs: args,
      cwd: agentPath, // Subagent runs in its own directory
      env: parentContext.env, // Inherit environment variables
    });

    // Execute the subagent's pipeline
    const engine = new PipelineEngine(childRegistry);
    const result = await engine.execute(workerYaml, childContext);

    return result;
  }

  /**
   * Execute a subagent with explicit worker.yaml content
   * Useful for testing or inline subagent definitions
   *
   * @param workerYaml Worker YAML configuration
   * @param args Arguments to pass to the subagent
   * @param parentContext Parent execution context
   * @param parentRegistry Parent tool registry
   * @param options Execution options
   * @returns Subagent execution result
   */
  async executeInline(
    workerYaml: WorkerYaml,
    args: Record<string, any>,
    parentContext: ExecutionContext,
    parentRegistry: ToolRegistry,
    options?: {
      agentName?: string;
      cwd?: string;
    }
  ): Promise<any> {
    // Create child tool registry (inherits from parent)
    const childRegistry = parentRegistry.createChild();

    // Create child execution context
    const childContext = ExecutionContextManager.create({
      agent: { name: options?.agentName || "inline-subagent" },
      initialArgs: args,
      cwd: options?.cwd || parentContext.cwd,
      env: parentContext.env,
    });

    // Execute the subagent's pipeline
    const engine = new PipelineEngine(childRegistry);
    const result = await engine.execute(workerYaml, childContext);

    return result;
  }
}
