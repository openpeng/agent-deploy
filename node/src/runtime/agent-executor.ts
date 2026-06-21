/**
 * Agent Executor - Core orchestration module.
 * Encapsulates full agent execution flow, shared by CLI and MCP Server.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ExecutionContextManager } from './context.js';
import { PipelineEngine, ConsoleLogger } from './pipeline.js';
import { ToolRegistry } from './tool-registry.js';
import { WorkerYamlParser } from './parser.js';
import { V2CompatibilityLayer } from './v2-compat.js';
import { MCPToolLoader, MCPServerEntry } from './mcp-integration.js';
import { SkillLoader, SkillDefinition } from './skill-integration.js';
import { AgentCache } from './agent-cache.js';
import { MarketAgentLoader } from './agent-loader.js';
import { getPolicyRegistry, PolicyLevel } from './policy.js';
import { loadPolicy } from './policy-loader.js';
import { registerMemoryTool } from './memory-integration.js';
import { DependencyResolver } from './dependency-resolver.js';
import { ReadFileTool } from './tools/read-file.js';
import { WriteFileTool } from './tools/write-file.js';
import { BashTool } from './tools/bash.js';
import { GlobTool } from './tools/glob.js';
import { LLMChatTool } from './tools/llm-chat.js';
import { WebFetchTool } from './tools/web-fetch.js';
import { WebSearchTool } from './tools/web-search.js';
import { invokeAgentTool } from './builtin-tools/invoke-agent.js';
import { listAgentsTool } from './builtin-tools/list-agents.js';
import { getTracer, serializeTraceContext } from '../telemetry.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { recordToolCallMetric, recordAgentExecution } from '../metrics.js';

export interface AgentOverrides {
  instructions?: string;
  skills?: SkillDefinition[];
  mcp_servers?: Record<string, MCPServerEntry>;
  shared_context?: Record<string, any>;
  trusted?: boolean;
  policyLevel?: PolicyLevel;
  cwd?: string;
  env?: Record<string, string>;
}

export interface AgentExecuteOptions {
  agent: string;
  input?: Record<string, any>;
  overrides?: AgentOverrides;
  verbose?: boolean;
}

export interface AgentExecuteResult {
  success: boolean;
  agent: string;
  agent_dir: string;
  output: unknown;
  duration_ms: number;
  summary: { total_steps: number; successful_steps: number; failed_steps: number; total_duration_ms: number };
}

const executorTracer = getTracer("agent-deploy-executor");

export class AgentExecutor {
  static async execute(options: AgentExecuteOptions): Promise<AgentExecuteResult> {
    const startTime = Date.now();
    const { agent: agentRef, input = {}, overrides = {}, verbose = false } = options;

    return executorTracer.startActiveSpan("agent.execute", async (span) => {
      span.setAttribute("agent.ref", agentRef);
      span.setAttribute("agent.input_keys", Object.keys(input).join(","));

      let agentDir: string;
      try {
        agentDir = await AgentExecutor.resolveAgentDir(agentRef);
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        span.recordException(err as Error);
        span.end();
        throw err;
      }

      const agentJson = JSON.parse(fs.readFileSync(path.join(agentDir, 'agent.json'), 'utf-8'));
      const agentName = agentJson.identity?.name || agentJson.name || path.basename(agentDir);
      span.setAttribute("agent.name", agentName);
      span.setAttribute("agent.dir", agentDir);

      const workerYaml = new V2CompatibilityLayer().getWorkerYaml(agentDir);

      // Notify when running in V2 compatibility mode
      if (!fs.existsSync(path.join(agentDir, 'worker.yaml'))) {
        const v2Check = new V2CompatibilityLayer();
        if (v2Check.isV2Agent(path.join(agentDir, 'agent.json'))) {
          console.log(`i  v2 agent detected - running in compatibility mode\n`);
        }
      }

      const validation = new WorkerYamlParser().validate(workerYaml);
      if (!validation.valid) {
        const err = new Error('Invalid worker.yaml: ' + validation.errors.join(', '));
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        span.recordException(err);
        span.end();
        throw err;
      }

      const registry = new ToolRegistry();
      registry.register(new ReadFileTool());
      registry.register(new WriteFileTool());
      registry.register(new BashTool());
      registry.register(new GlobTool());
      registry.register(new LLMChatTool());
      registry.register(new WebFetchTool());
      registry.register(new WebSearchTool());
      registry.register(invokeAgentTool);
      registry.register(listAgentsTool);

      const mcpLoader = new MCPToolLoader();
      const mergedMCP = AgentExecutor.mergeMCPConfig(agentDir, mcpLoader, overrides);
      if (Object.keys(mergedMCP).length > 0) await mcpLoader.registerFromConfig(mergedMCP, registry);

      const skillLoader = new SkillLoader();
      const mergedSkills = AgentExecutor.mergeSkills(agentDir, skillLoader, overrides);
      if (mergedSkills.length > 0) skillLoader.registerFromDefs(mergedSkills, registry);

      registerMemoryTool(agentDir, registry);

      // Apply policy: overrides take precedence, then policy.yaml, then default restricted
      const policyRegistry = getPolicyRegistry();
      if (overrides.policyLevel) {
        policyRegistry.setLevel(agentName, overrides.policyLevel);
      } else if (overrides.trusted) {
        policyRegistry.trust(agentName);
      } else {
        const loadedPolicy = loadPolicy(agentName);
        policyRegistry.set(agentName, loadedPolicy);
      }

      const workingDir = overrides.cwd || agentDir;
      const envVars: Record<string, string> = { ...(process.env as Record<string, string>) };
      if (overrides.env) Object.assign(envVars, overrides.env);
      const sharedContext: Record<string, any> = {};
      if (workerYaml.shared_context) Object.assign(sharedContext, workerYaml.shared_context);
      if (overrides.shared_context) Object.assign(sharedContext, overrides.shared_context);

      let instructions = overrides.instructions || undefined;
      if (!instructions) {
        const inst = agentJson.instructions;
        if (inst) instructions = typeof inst === 'string' ? inst : inst.content;
      }

      const executionContext = ExecutionContextManager.create({
        agent: { name: agentName, identity: { name: agentName } },
        initialArgs: input, cwd: workingDir, env: envVars, sharedContext, instructions,
      });

      // Serialize current OTel trace context into ExecutionContext for downstream propagation
      executionContext.otelContext = serializeTraceContext();

      ToolRegistry.attach(registry, executionContext);

      try { await new DependencyResolver().resolve(agentDir); } catch (err) {
        if (verbose) console.warn(`Dependency resolution warning: ${(err as Error).message}`);
      }

      const engine = new PipelineEngine(registry, new ConsoleLogger(verbose));
      engine.registerSubagents(agentDir, registry);
      try {
        const result = await engine.execute(workerYaml, executionContext);
        const duration = Date.now() - startTime;
        const summary = ExecutionContextManager.getSummary(executionContext);
        span.setStatus({ code: SpanStatusCode.OK });
        span.setAttribute("agent.duration_ms", duration);
        span.setAttribute("agent.successful_steps", summary.successful_steps);
        span.setAttribute("agent.failed_steps", summary.failed_steps);
        span.end();
        return { success: summary.failed_steps === 0, agent: agentName, agent_dir: agentDir, output: result, duration_ms: duration, summary };
      } catch (err) {
        const duration = Date.now() - startTime;
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        span.recordException(err as Error);
        span.setAttribute("agent.duration_ms", duration);
        span.end();
        return { success: false, agent: agentName, agent_dir: agentDir, output: { error: (err as Error).message }, duration_ms: duration, summary: ExecutionContextManager.getSummary(executionContext) };
      }
    });
  }

  private static mergeMCPConfig(agentDir: string, loader: MCPToolLoader, overrides: AgentOverrides): Record<string, MCPServerEntry> {
    const merged: Record<string, MCPServerEntry> = {};
    const cfg = loader.loadConfig(agentDir);
    if (cfg?.mcpServers) Object.assign(merged, cfg.mcpServers);
    if (overrides.mcp_servers) Object.assign(merged, overrides.mcp_servers);
    return merged;
  }

  private static mergeSkills(agentDir: string, loader: SkillLoader, overrides: AgentOverrides): SkillDefinition[] {
    const map = new Map<string, SkillDefinition>();
    for (const s of loader.loadSkills(agentDir)) map.set(s.name, s);
    if (overrides.skills) for (const s of overrides.skills) { if (s.name) map.set(s.name, s); }
    return Array.from(map.values());
  }

  private static async resolveAgentDir(agentRef: string): Promise<string> {
    if (agentRef.startsWith('market://')) return await new MarketAgentLoader(new AgentCache()).load(agentRef);
    if (path.isAbsolute(agentRef)) {
      if (fs.existsSync(agentRef) && fs.existsSync(path.join(agentRef, 'agent.json'))) return agentRef;
      throw new Error('Agent not found: ' + agentRef);
    }
    if (agentRef.startsWith('./') || agentRef.startsWith('../')) {
      const resolved = path.resolve(process.cwd(), agentRef);
      if (fs.existsSync(resolved) && fs.existsSync(path.join(resolved, 'agent.json'))) return resolved;
      throw new Error('Agent not found: ' + resolved);
    }
    const cwd = process.cwd();
    const sibling = path.join(path.dirname(cwd), agentRef);
    if (fs.existsSync(sibling) && fs.existsSync(path.join(sibling, 'agent.json'))) return sibling;
    const cwdAgent = path.resolve(cwd, agentRef);
    if (fs.existsSync(cwdAgent) && fs.existsSync(path.join(cwdAgent, 'agent.json'))) return cwdAgent;
    return await new MarketAgentLoader(new AgentCache()).load('market://' + agentRef);
  }
}
