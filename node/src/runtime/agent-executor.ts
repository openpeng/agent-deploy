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
import { getPolicyRegistry } from './policy.js';
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

export interface AgentOverrides {
  instructions?: string;
  skills?: SkillDefinition[];
  mcp_servers?: Record<string, MCPServerEntry>;
  shared_context?: Record<string, any>;
  trusted?: boolean;
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
  output: any;
  duration_ms: number;
  summary: { total_steps: number; successful_steps: number; failed_steps: number; total_duration_ms: number };
}

export class AgentExecutor {
  static async execute(options: AgentExecuteOptions): Promise<AgentExecuteResult> {
    const startTime = Date.now();
    const { agent: agentRef, input = {}, overrides = {}, verbose = false } = options;
    const agentDir = await AgentExecutor.resolveAgentDir(agentRef);
    const agentJson = JSON.parse(fs.readFileSync(path.join(agentDir, 'agent.json'), 'utf-8'));
    const agentName = agentJson.identity?.name || agentJson.name || path.basename(agentDir);
    const workerYaml = new V2CompatibilityLayer().getWorkerYaml(agentDir);
    const validation = new WorkerYamlParser().validate(workerYaml);
    if (!validation.valid) throw new Error('Invalid worker.yaml: ' + validation.errors.join(', '));

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
    if (overrides.trusted) getPolicyRegistry().trust(agentName);

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

    const context = ExecutionContextManager.create({
      agent: { name: agentName, identity: { name: agentName } },
      initialArgs: input, cwd: workingDir, env: envVars, sharedContext, instructions,
    });
    ToolRegistry.attach(registry, context);

    try { await new DependencyResolver().resolve(agentDir); } catch {}

    const engine = new PipelineEngine(registry, new ConsoleLogger(verbose));
    engine.registerSubagents(agentDir, registry);
    try {
      const result = await engine.execute(workerYaml, context);
      const duration = Date.now() - startTime;
      return { success: ExecutionContextManager.getSummary(context).failed_steps === 0, agent: agentName, agent_dir: agentDir, output: result, duration_ms: duration, summary: ExecutionContextManager.getSummary(context) };
    } catch (err) {
      return { success: false, agent: agentName, agent_dir: agentDir, output: { error: (err as Error).message }, duration_ms: Date.now() - startTime, summary: ExecutionContextManager.getSummary(context) };
    }
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
