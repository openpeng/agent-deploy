/**
 * Builtin Tool: invoke_agent
 *
 * 调用另一个 agent 作为子任务执行
 * Phase 6: 通过 context 传递 registry，支持 market:// 自动加载
 */

import * as path from "path";
import * as fs from "fs";
import { ExecutionContextManager } from "../context.js";
import { PipelineEngine } from "../pipeline.js";
import { WorkerYamlParser } from "../parser.js";
import { V2CompatibilityLayer } from "../v2-compat.js";
import { ToolRegistry } from "../tool-registry.js";
import { AgentCache } from "../agent-cache.js";
import { MarketAgentLoader } from "../agent-loader.js";
import { getPolicyRegistry } from "../policy.js";
import { MCPToolLoader, MCPServerEntry } from "../mcp-integration.js";
import { SkillLoader, SkillDefinition } from "../skill-integration.js";
import { ExecutionContext } from "../types.js";

interface InvokeAgentArgs {
  agent: string;        // Agent 路径 / market:// URL / 简单名称
  input: unknown;       // 传给子 agent 的输入参数
  cwd?: string;         // 可选：子 agent 的工作目录
  version?: string;     // 可选：指定版本 market:// 下载时使用
  /** 动态覆盖：instructions / skills / mcp_servers */
  overrides?: {
    instructions?: string;
    skills?: SkillDefinition[];
    mcp_servers?: Record<string, MCPServerEntry>;
  };
}

export const invokeAgentTool = {
  name: "invoke_agent",

  description: "调用另一个 agent 执行子任务。支持 market:// URL 自动下载",

  async execute(args: InvokeAgentArgs, context: ExecutionContext): Promise<unknown> {
    const { agent, input, cwd, version } = args;

    // 从 context 获取 registry（Phase 6）
    const registry = ToolRegistry.from(context);
    if (!registry) {
      throw new Error("Tool registry not found in execution context");
    }

    // 1. 解析 agent 路径
    let agentDir: string;

    if (agent.startsWith("market://")) {
      // market:// URL — 自动从市场下载
      const cache = new AgentCache();
      const marketLoader = new MarketAgentLoader(cache);
      agentDir = await marketLoader.load(agent);
    } else if (path.isAbsolute(agent)) {
      // 绝对路径
      agentDir = agent;
    } else if (agent.startsWith("./") || agent.startsWith("../")) {
      // 显式相对路径 - 相对于当前 agent 的工作目录
      const currentAgentDir = ExecutionContextManager.getCwd(context) || process.cwd();
      agentDir = path.resolve(currentAgentDir, agent);
    } else {
      // 简单名称 - 多级查找
      const currentAgentDir = ExecutionContextManager.getCwd(context) || process.cwd();

      // 检查兄弟目录
      const parentDir = path.dirname(currentAgentDir);
      const sibling = path.join(parentDir, agent);
      if (fs.existsSync(sibling) && fs.existsSync(path.join(sibling, "agent.json"))) {
        agentDir = sibling;
      } else {
        // 检查 cwd
        const cwdAgent = path.resolve(process.cwd(), agent);
        if (fs.existsSync(cwdAgent) && fs.existsSync(path.join(cwdAgent, "agent.json"))) {
          agentDir = cwdAgent;
        } else {
          // 最后尝试从市场加载
          const cache = new AgentCache();
          const marketLoader = new MarketAgentLoader(cache);
          const verStr = version || "latest";
          agentDir = await marketLoader.load(`market://${agent}@${verStr}`);
        }
      }
    }

    // 2. 预检：验证 agent 目录和必需文件存在
    if (!fs.existsSync(agentDir)) {
      throw new Error(`invoke_agent: Sub-agent directory not found: ${agentDir}\n` +
        `  Check that the agent path is correct and the sub-agent exists`);
    }

    const agentJsonPath = path.join(agentDir, "agent.json");
    if (!fs.existsSync(agentJsonPath)) {
      throw new Error(`invoke_agent: agent.json not found in: ${agentDir}\n` +
        `  The directory exists but does not contain a valid agent definition`);
    }

    const workerYamlPath = path.join(agentDir, "worker.yaml");
    if (!fs.existsSync(workerYamlPath) && !fs.existsSync(path.join(agentDir, "SKILL.md"))) {
      throw new Error(`invoke_agent: No worker.yaml or SKILL.md found in: ${agentDir}\n` +
        `  The agent must have a pipeline definition (worker.yaml) or SKILL.md to execute`);
    }

    // 3. 加载 agent 元数据
    const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8")) as { identity?: { name?: string }; name?: string };
    const agentName = agentJson.identity?.name || agentJson.name || path.basename(agentDir);

    console.log(`  ↳ Invoking sub-agent: ${agentName}`);

    // Propagate trust from parent to child agent
    const parentAgentName = context.agent?.identity?.name || context.agent?.name || "unknown";
    getPolicyRegistry().propagateTrust(parentAgentName, agentName);

    // 4. 加载 worker.yaml（支持 v2 兼容）
    const v2Compat = new V2CompatibilityLayer();
    const workerYaml = v2Compat.getWorkerYaml(agentDir);

    // 5. 验证 pipeline
    const parser = new WorkerYamlParser();
    const validation = parser.validate(workerYaml);
    if (!validation.valid) {
      throw new Error(`Invalid worker.yaml in ${agentName}: ${validation.errors.join(", ")}`);
    }

    // 6. 创建子 agent 执行上下文（继承父 agent 的环境变量、策略和 trace_id）
    const subCwd = cwd || agentDir;
    const parentEnv = ExecutionContextManager.getAllEnv(context) || {};
    const subContext = ExecutionContextManager.create({
      agent: { name: agentName, identity: { name: agentName } },
      initialArgs: input as Record<string, any>,
      cwd: subCwd,
      env: { ...parentEnv, ...((input as any)?.__env || {}) },
    });
    // Propagate trace_id through the call chain
    if (context.trace_id) subContext.trace_id = context.trace_id;
    // Propagate OTel trace context for distributed tracing continuity
    if (context.otelContext) subContext.otelContext = { ...context.otelContext };

    // 将 registry 附加到子 context，支持嵌套 invoke_agent

    // Handle overrides for sub-agent context and tools
    let effectiveRegistry = registry;
    if (args.overrides) {
      const ovr = args.overrides;

      // Apply instructions override
      if (ovr.instructions) {
        ExecutionContextManager.setInstructions(subContext, ovr.instructions);
      }

      // Apply MCP override: create child registry and register extra MCP tools
      if (ovr.mcp_servers && Object.keys(ovr.mcp_servers).length > 0) {
        const mcpLoader = new MCPToolLoader();
        effectiveRegistry = registry.createChild();
        await mcpLoader.registerFromConfig(ovr.mcp_servers, effectiveRegistry);
      }

      // Apply Skills override: register on effective registry
      if (ovr.skills && ovr.skills.length > 0) {
        const skillLoader = new SkillLoader();
        if (effectiveRegistry === registry) {
          effectiveRegistry = registry.createChild();
        }
        skillLoader.registerFromDefs(ovr.skills, effectiveRegistry);
      }
    }
    ToolRegistry.attach(effectiveRegistry, subContext);

    // 7. 使用 context 中的 registry 创建 engine（Phase 6）
    const engine = new PipelineEngine(effectiveRegistry);

    // Execute sub-agent pipeline. On failure, throw so the parent Pipeline's
    // on_fail/retry mechanism can take over (instead of silently swallowing errors).
    const result = await engine.execute(workerYaml, subContext);

    console.log(`  ✓ Sub-agent ${agentName} completed`);

    return {
      success: true,
      agent: agentName,
      result: result,
    };
  },
};
