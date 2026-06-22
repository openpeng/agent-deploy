#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { detectAll, detectPrimary } from "./detect.js";
import { adaptAgent } from "./adapt.js";
import { installAgent } from "./install.js";
import { ImportManager } from "./import-manager.js";
import { CursorImportAdapter } from "./adapters/cursor-import.js";
import { ClaudeImportAdapter } from "./adapters/claude-import.js";
import { CodeBuddyImportAdapter } from "./adapters/codebuddy-import.js";
import { GitHubImportAdapter } from "./adapters/github-import.js";
import {
  uploadAgent, downloadAgent,
  uploadTeam, downloadTeam, searchTeams, getTeam,
  uploadWorkflow, downloadWorkflow, searchWorkflows, getWorkflow
} from "./market.js";
import { AgentExecutor } from "./runtime/agent-executor.js";
import { MarketClient } from "./market.js";
import { scanDeployedAgents, getDeploymentSummary } from "./scan-deployed.js";
import { uninstallAgent } from "./uninstall.js";
import { checkUpdates, getUpdateSummary } from "./check-updates.js";

const SERVER_NAME = "agent-deploy";
const SERVER_VERSION = "1.0.0";

// ---- Tool Definitions ----
const TOOLS: Tool[] = [
  {
    name: "list_installed_tools",
    description: "Detect which external AI coding tools are installed or active on the host.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "adapt_agent",
    description: "Adapt a market agent into the native format of a target AI coding tool.",
    inputSchema: {
      type: "object",
      properties: {
        agent_path: { type: "string", description: "Path to the agent directory containing SKILL.md" },
        target_tool: { type: "string", description: "Target tool ID, e.g. 'opencode', 'codebuddy', 'cursor'" },
        target_file: { type: "string", description: "Custom target file path (relative). If provided, overrides the default path." },
      },
      required: ["agent_path", "target_tool"],
    },
  },
  {
    name: "install_agent",
    description: "Install adapted agent content into the target tool's auto-discovery directory.",
    inputSchema: {
      type: "object",
      properties: {
        adapted_content: { type: "string", description: "The adapted markdown/yaml content" },
        agent_name: { type: "string", description: "Name of the agent" },
        target_tool: { type: "string", description: "Target tool ID" },
        target_file: { type: "string", description: "Required. Target file path (relative) where the agent should be installed." },
        level: { type: "string", description: "Install level: project, user, or both", default: "both" },
      },
      required: ["adapted_content", "agent_name", "target_tool", "target_file"],
    },
  },
  {
    name: "deploy_agent",
    description: "Full pipeline: detect tools → download agent → adapt → install in one call.",
    inputSchema: {
      type: "object",
      properties: {
        agent_path: { type: "string", description: "Path to local agent directory (skip download)" },
        target_tool: { type: "string", description: "Target tool ID, 'auto' for auto-detect, 'all' for all detected", default: "auto" },
        target_file: { type: "string", description: "Required. Target file path (relative)." },
        level: { type: "string", description: "Install level", default: "both" },
      },
      required: ["agent_path", "target_file"],
    },
  },
  {
    name: "scan_deployed",
    description: "Scan and list all deployed agents across AI coding tools.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_root: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "uninstall_agent",
    description: "Uninstall an agent from a target AI coding tool.",
    inputSchema: {
      type: "object",
      properties: {
        agent_name: { type: "string" },
        target_tool: { type: "string" },
        install_path: { type: "string" },
        level: { type: "string", default: "project" },
      },
      required: ["agent_name", "target_tool", "install_path"],
    },
  },
  {
    name: "check_updates",
    description: "Check for updates to deployed agents.",
    inputSchema: {
      type: "object",
      properties: {
        market_url: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "import_agent",
    description: "Import an agent from an AI tool format (Cursor, Claude Code, CodeBuddy, GitHub) to agent.json v2.0 format.",
    inputSchema: {
      type: "object",
      properties: {
        source_path: { type: "string", description: "Path to the agent file or directory (e.g., .cursor/commands/my-agent.md)" },
        output_dir: { type: "string", description: "Output directory for agent.json (default: ./imported-agents)" },
        tool: { type: "string", description: "Force specific tool adapter: cursor, claude_code, codebuddy, github_copilot (auto-detect if omitted)" },
        dry_run: { type: "boolean", description: "Preview import without writing files (default: false)" },
      },
      required: ["source_path"],
    },
  },
  {
    name: "upload_agent",
    description: "Upload an agent to the Market for sharing and distribution. Requires a valid API key.",
    inputSchema: {
      type: "object",
      properties: {
        agent_dir: { type: "string", description: "Path to the agent directory containing agent.json" },
        market_url: { type: "string", description: "Market API URL (default: $MARKET_API_URL or http://localhost:8321)" },
        api_key: { type: "string", description: "API key for authentication (default: $MARKET_API_KEY)" },
        force: { type: "boolean", description: "Force overwrite existing version (default: false)" },
      },
      required: ["agent_dir"],
    },
  },
  {
    name: "download_agent",
    description: "Download an agent from the Market by ID.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Agent ID to download from Market" },
        output_dir: { type: "string", description: "Output directory (default: ./downloaded-agents)" },
        market_url: { type: "string", description: "Market API URL (default: $MARKET_API_URL or http://localhost:8321)" },
      },
      required: ["agent_id"],
    },
  },
  {
    name: "list_agents",
    description: "List available agents — local agents and optionally market agents.",
    inputSchema: {
      type: "object",
      properties: {
        include_market: { type: "boolean", description: "Include market agents (default: true)" },
        include_deployed: { type: "boolean", description: "Include deployed agents (default: true)", default: true },
      },
    },
  },
  {
    name: "execute_agent",
    description: "Execute an agent with full support for dynamic overrides. Customize context, inject skills, and mount MCP servers at runtime.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Agent identifier — name, path, or market://name@version" },
        input: { type: "object", description: "Input arguments passed to the agent" },
        overrides: {
          type: "object",
          description: "Dynamic overrides",
          properties: {
            instructions: { type: "string", description: "Override agent instructions" },
            skills: { type: "array", description: "Skill definitions to inject" },
            mcp_servers: { type: "object", description: "MCP server configs to mount" },
            shared_context: { type: "object", description: "Shared context values" },
            trusted: { type: "boolean", description: "Trusted mode" },
            cwd: { type: "string", description: "Working directory" },
            env: { type: "object", description: "Environment variables" },
          },
        },
      },
      required: ["agent"],
    },
  },
  {
    name: "upload_team",
    description: "Upload a Team package to the Market. Requires a valid API key.",
    inputSchema: {
      type: "object",
      properties: {
        team_dir: { type: "string", description: "Path to the Team directory containing team.json" },
        market_url: { type: "string", description: "Market API URL (default: $MARKET_API_URL or http://localhost:8321)" },
        api_key: { type: "string", description: "API key for authentication (default: $MARKET_API_KEY)" },
        force: { type: "boolean", description: "Force overwrite existing version (default: false)" },
      },
      required: ["team_dir"],
    },
  },
  {
    name: "download_team",
    description: "Download a Team from the Market by ID.",
    inputSchema: {
      type: "object",
      properties: {
        team_id: { type: "string", description: "Team ID to download from Market" },
        output_dir: { type: "string", description: "Output directory (default: ./downloaded-teams)" },
        market_url: { type: "string", description: "Market API URL (default: $MARKET_API_URL or http://localhost:8321)" },
      },
      required: ["team_id"],
    },
  },
  {
    name: "list_teams",
    description: "List Teams available on the Market.",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Filter by tag (optional)" },
        category: { type: "string", description: "Filter by category (optional)" },
        market_url: { type: "string", description: "Market API URL (optional)" },
        limit: { type: "number", description: "Max number of results (default: 50)" },
      },
    },
  },
  {
    name: "get_team",
    description: "Get the full detail of a Team from the Market.",
    inputSchema: {
      type: "object",
      properties: {
        team_id: { type: "string", description: "Team ID to retrieve" },
        market_url: { type: "string", description: "Market API URL (optional)" },
      },
      required: ["team_id"],
    },
  },
  {
    name: "validate_team",
    description: "Validate a team.json file for required fields and format.",
    inputSchema: {
      type: "object",
      properties: {
        team_dir: { type: "string", description: "Path to the Team directory containing team.json" },
      },
      required: ["team_dir"],
    },
  },
  {
    name: "upload_workflow",
    description: "Upload a Workflow package to the Market. Requires a valid API key.",
    inputSchema: {
      type: "object",
      properties: {
        workflow_dir: { type: "string", description: "Path to the Workflow directory containing workflow.json" },
        market_url: { type: "string", description: "Market API URL (default: $MARKET_API_URL or http://localhost:8321)" },
        api_key: { type: "string", description: "API key for authentication (default: $MARKET_API_KEY)" },
        force: { type: "boolean", description: "Force overwrite existing version (default: false)" },
      },
      required: ["workflow_dir"],
    },
  },
  {
    name: "download_workflow",
    description: "Download a Workflow from the Market by ID.",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: { type: "string", description: "Workflow ID to download from Market" },
        output_dir: { type: "string", description: "Output directory (default: ./downloaded-workflows)" },
        market_url: { type: "string", description: "Market API URL (default: $MARKET_API_URL or http://localhost:8321)" },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "list_workflows",
    description: "List Workflows available on the Market.",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Filter by tag (optional)" },
        category: { type: "string", description: "Filter by category (optional)" },
        market_url: { type: "string", description: "Market API URL (optional)" },
        limit: { type: "number", description: "Max number of results (default: 50)" },
      },
    },
  },
  {
    name: "get_workflow",
    description: "Get the full detail of a Workflow from the Market.",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: { type: "string", description: "Workflow ID to retrieve" },
        market_url: { type: "string", description: "Market API URL (optional)" },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "validate_workflow",
    description: "Validate a workflow.json file for required fields and format.",
    inputSchema: {
      type: "object",
      properties: {
        workflow_dir: { type: "string", description: "Path to the Workflow directory containing workflow.json" },
      },
      required: ["workflow_dir"],
    },
  },
];

// ---- Tool Handlers ----
async function handleListTools(): Promise<string> {
  const tools = detectAll();
  return JSON.stringify({
    detected_tools: tools,
    primary_tool: tools[0]?.tool ?? null,
    total_found: tools.length,
  }, null, 2);
}

async function handleAdaptAgent(args: Record<string, unknown>): Promise<string> {
  const agentPath = args.agent_path as string;
  const targetTool = args.target_tool as string;
  if (!agentPath || !targetTool) throw new Error("agent_path and target_tool are required");
  const result = await adaptAgent(agentPath, targetTool);
  return JSON.stringify(result, null, 2);
}

async function handleInstallAgent(args: Record<string, unknown>): Promise<string> {
  const { adapted_content, agent_name, target_tool, level, target_file, version } = args as {
    adapted_content: string; agent_name: string; target_tool: string; level?: string; target_file?: string; version?: string;
  };
  const results = await installAgent(adapted_content, agent_name, target_tool, level ?? "both", false, target_file, version);
  return JSON.stringify({ status: "ok", results }, null, 2);
}

async function handleDeployAgent(args: Record<string, unknown>): Promise<string> {
  const agentPath = args.agent_path as string;
  const targetTool = (args.target_tool as string) ?? "auto";
  const level = (args.level as string) ?? "both";
  const targetFile = args.target_file as string | undefined;

  if (!targetFile) {
    throw new Error("target_file is required for deploy_agent");
  }

  // Read agent version from agent.json
  let agentVersion: string | undefined;
  try {
    const agentJsonPath = path.join(agentPath, "agent.json");
    if (fs.existsSync(agentJsonPath)) {
      const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
      agentVersion = agentJson.identity?.version || agentJson.version;
    }
  } catch {
    // Ignore errors reading version
  }

  // Step 1: detect
  const detected = detectAll();
  let targetTools: string[];
  if (targetTool === "all") {
    targetTools = detected.map(t => t.tool);
  } else if (targetTool === "auto") {
    targetTools = detected.length > 0 ? [detected[0].tool] : ["agents_md"];
  } else {
    targetTools = [targetTool];
  }

  // Step 2: adapt & install for each target
  const allResults: Record<string, unknown>[] = [];
  for (const tt of targetTools) {
    const adapted = await adaptAgent(agentPath, tt, targetFile);
    const results = await installAgent(adapted.content, adapted.slug ?? "agent", tt, level, false, targetFile, agentVersion);
    allResults.push({ tool: tt, adapt: adapted, install: results });
  }

  return JSON.stringify({
    status: "ok",
    detected_tools: detected.map(t => t.tool),
    target_tools: targetTools,
    results: allResults,
  }, null, 2);
}

async function handleImportAgent(args: Record<string, unknown>): Promise<string> {
  const sourcePath = args.source_path as string;
  const outputDir = (args.output_dir as string) ?? "./imported-agents";
  const tool = args.tool as string | undefined;
  const dryRun = (args.dry_run as boolean) ?? false;

  if (!sourcePath) {
    throw new Error("source_path is required");
  }

  // Create ImportManager and register all adapters
  const manager = new ImportManager();
  manager.registerAdapter(new CursorImportAdapter());
  manager.registerAdapter(new ClaudeImportAdapter());
  manager.registerAdapter(new CodeBuddyImportAdapter());
  manager.registerAdapter(new GitHubImportAdapter());

  try {
    if (dryRun) {
      // Dry-run: preview without writing
      const descriptor = manager.dryRun(sourcePath, tool);

      return JSON.stringify({
        status: "dry-run",
        source_path: sourcePath,
        detected_tool: tool || "auto",
        agent: {
          name: descriptor.identity.name,
          version: descriptor.identity.version,
          display_name: descriptor.identity.display_name,
          description: descriptor.identity.description,
          author: descriptor.identity.author,
          tags: descriptor.identity.tags,
        },
        output_path: `${outputDir}/${descriptor.identity.name}/agent.json`,
        message: "Dry-run successful. Use dry_run: false to write files."
      }, null, 2);
    } else {
      // Real import: write agent.json
      const agentDir = manager.importAgent(sourcePath, outputDir, tool);
      const agentJsonPath = `${agentDir}/agent.json`;

      return JSON.stringify({
        status: "success",
        source_path: sourcePath,
        output_path: agentJsonPath,
        agent_dir: agentDir,
        message: `✅ Successfully imported agent to: ${agentDir}\n\nYou can now:\n1. Upload this agent to the market\n2. Deploy it to other AI tools with deploy_agent`
      }, null, 2);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Import failed: ${msg}`);
  }
}

async function handleUploadAgent(args: Record<string, unknown>): Promise<string> {
  const agentDir = args.agent_dir as string;
  const marketUrl = args.market_url as string | undefined;
  const apiKey = args.api_key as string | undefined;
  const force = args.force as boolean | undefined;

  if (!agentDir) {
    throw new Error("agent_dir is required");
  }

  try {
    const result = await uploadAgent({
      agentDir,
      marketUrl,
      apiKey,
      force,
    });

    return JSON.stringify({
      status: "success",
      agent_id: result.agent_id,
      agent_name: result.agent_name,
      version: result.version,
      market_url: result.market_url,
      message: `✅ Successfully uploaded ${result.agent_name} v${result.version}\n\nMarket URL: ${result.market_url}\n\nYou can now:\n1. Share the Market URL with others\n2. Deploy this agent to AI tools with deploy_agent`,
    }, null, 2);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Upload failed: ${msg}`);
  }
}

async function handleDownloadAgent(args: Record<string, unknown>): Promise<string> {
  const agentId = args.agent_id as string;
  const outputDir = args.output_dir as string | undefined || "./downloaded-agents";
  const marketUrl = args.market_url as string | undefined;

  if (!agentId) {
    throw new Error("agent_id is required");
  }

  try {
    const result = await downloadAgent({
      agentId,
      outputDir,
      marketUrl,
    });

    return JSON.stringify({
      status: "success",
      agent_id: result.agent_id,
      output_path: result.output_path,
      message: `✅ Successfully downloaded agent to: ${result.output_path}\n\nYou can now:\n1. Review the agent.json\n2. Deploy it to AI tools with deploy_agent`,
    }, null, 2);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Download failed: ${msg}`);
  }
}

/**
 * list_agents — list available agents (local + market)
 */
async function handleListAgents(args: Record<string, unknown>): Promise<string> {
  const includeMarket = args.include_market !== false; // default true
  const includeDeployed = args.include_deployed !== false; // default true
  const agents: Array<{ name: string; source: string; path?: string }> = [];

  // Scan local agents directory
  const agentsDir = path.join(process.cwd(), 'agents');
  try {
    if (fs.existsSync(agentsDir)) {
      for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const agentJsonPath = path.join(agentsDir, entry.name, 'agent.json');
          if (fs.existsSync(agentJsonPath)) {
            agents.push({ name: entry.name, source: 'local', path: path.join(agentsDir, entry.name) });
          }
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.warn('[list_agents] agents/ scan warning:', (err as Error).message);
  }
  // Also check parent directory for sibling agents
  const parentDir = path.dirname(process.cwd());
  try {
    if (fs.existsSync(parentDir)) {
      for (const entry of fs.readdirSync(parentDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const agentJsonPath = path.join(parentDir, entry.name, 'agent.json');
          if (fs.existsSync(agentJsonPath)) {
            const exists = agents.some(a => a.name === entry.name);
            if (!exists) {
              agents.push({ name: entry.name, source: 'local', path: path.join(parentDir, entry.name) });
            }
          }
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.warn('[list_agents] parent dir scan warning:', (err as Error).message);
  }

  // Market discovery
  if (includeMarket) {
    try {
      const marketUrl = process.env.MARKET_API_URL || 'http://localhost:8321';
      const client = new MarketClient({ baseUrl: marketUrl });
      const result = await client.searchAgents({ limit: 50 });
      if (result?.agents) {
        for (const agent of result.agents) {
          const name = agent.name || agent.id;
          if (name && !agents.some(a => a.name === name)) {
            agents.push({ name, source: 'market', path: 'market://' + name });
          }
        }
      }
    } catch (err) {
      if (process.env.DEBUG) console.warn('[list_agents] Market discovery skipped:', (err as Error).message);
    }
  }

  // Include deployed agents
  if (includeDeployed) {
    try {
      const deployed = scanDeployedAgents();
      for (const d of deployed) {
        if (!agents.some(a => a.name === d.name)) {
          agents.push({ name: d.name, source: 'deployed', path: d.path });
        }
      }
    } catch (err) {
      if (process.env.DEBUG) console.warn('[list_agents] deployed scan warning:', (err as Error).message);
    }
  }

  return JSON.stringify({ total: agents.length, agents }, null, 2);
}

/**
 * execute_agent — execute an agent with full override support
 */
async function handleExecuteAgent(args: Record<string, unknown>): Promise<string> {
  const agent = args.agent as string;
  if (!agent) throw new Error('agent parameter is required');

  const input = (args.input as Record<string, any>) || {};
  const overrides = (args.overrides as any) || {};

  const result = await AgentExecutor.execute({
    agent,
    input,
    overrides,
    verbose: false,
  });

  return JSON.stringify(result, null, 2);
}

async function handleScanDeployed(args: Record<string, unknown>): Promise<string> {
  const workspaceRoot = args.workspace_root as string | undefined;
  const agents = scanDeployedAgents(workspaceRoot);
  const summary = getDeploymentSummary(workspaceRoot);
  return JSON.stringify({ total: agents.length, agents, summary }, null, 2);
}

async function handleUninstallAgent(args: Record<string, unknown>): Promise<string> {
  const agentName = args.agent_name as string;
  const targetTool = args.target_tool as string;
  const installPath = args.install_path as string;
  const level = (args.level as string) || "project";
  if (!agentName || !targetTool || !installPath) {
    throw new Error("agent_name, target_tool, and install_path are required");
  }
  const result = uninstallAgent(agentName, targetTool, installPath, level);
  return JSON.stringify({ status: "ok", result }, null, 2);
}

async function handleCheckUpdates(args: Record<string, unknown>): Promise<string> {
  const marketUrl = args.market_url as string | undefined;
  const updates = await checkUpdates(marketUrl);
  const summary = getUpdateSummary(updates);
  return JSON.stringify({ total: updates.length, updates, summary }, null, 2);
}

async function handleUploadTeam(args: Record<string, unknown>): Promise<string> {
  const teamDir = args.team_dir as string;
  const marketUrl = args.market_url as string | undefined;
  const apiKey = args.api_key as string | undefined;
  const force = args.force as boolean | undefined;

  if (!teamDir) {
    throw new Error("team_dir is required");
  }

  try {
    const result = await uploadTeam({
      teamDir,
      marketUrl,
      apiKey,
      force,
    });

    return JSON.stringify({
      status: "success",
      team_id: result.team_id,
      team_name: result.team_name,
      version: result.version,
      market_url: result.market_url,
      message: `✅ Successfully uploaded Team ${result.team_name} v${result.version}`,
    }, null, 2);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Upload failed: ${msg}`);
  }
}

async function handleDownloadTeam(args: Record<string, unknown>): Promise<string> {
  const teamId = args.team_id as string;
  const outputDir = args.output_dir as string | undefined || "./downloaded-teams";
  const marketUrl = args.market_url as string | undefined;

  if (!teamId) {
    throw new Error("team_id is required");
  }

  try {
    const result = await downloadTeam({
      teamId,
      outputDir,
      marketUrl,
    });

    return JSON.stringify({
      status: "success",
      team_id: result.team_id,
      output_path: result.output_path,
      message: `✅ Successfully downloaded Team to: ${result.output_path}`,
    }, null, 2);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Download failed: ${msg}`);
  }
}

async function handleListTeams(args: Record<string, unknown>): Promise<string> {
  const tag = args.tag as string | undefined;
  const category = args.category as string | undefined;
  const marketUrl = args.market_url as string | undefined;
  const limit = (args.limit as number) || 50;

  try {
    const result = await searchTeams({
      tag,
      category,
      marketUrl,
      limit,
    });

    return JSON.stringify({
      total: result.total,
      teams: result.teams.map(t => ({
        id: t.id,
        name: t.name,
        display_name: t.display_name,
        version: t.version,
        description: t.description,
        category: t.category,
        tags: t.tags,
      })),
    }, null, 2);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Search failed: ${msg}`);
  }
}

async function handleGetTeam(args: Record<string, unknown>): Promise<string> {
  const teamId = args.team_id as string;
  const marketUrl = args.market_url as string | undefined;

  if (!teamId) {
    throw new Error("team_id is required");
  }

  try {
    const team = await getTeam({ teamId, marketUrl });
    return JSON.stringify({ status: "success", team }, null, 2);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Get Team failed: ${msg}`);
  }
}

async function handleValidateTeam(args: Record<string, unknown>): Promise<string> {
  const teamDir = args.team_dir as string;
  if (!teamDir) throw new Error("team_dir is required");

  try {
    const teamJsonPath = path.join(teamDir, "team.json");
    if (!fs.existsSync(teamJsonPath)) {
      throw new Error(`team.json not found in: ${teamDir}`);
    }

    const content = fs.readFileSync(teamJsonPath, "utf-8");
    const team = JSON.parse(content);

    // Required top-level fields
    const requiredTop = ["schema_version", "identity", "definition"];
    const missingTop = requiredTop.filter(k => !team[k]);
    if (missingTop.length > 0) {
      throw new Error(`Missing top-level fields: ${missingTop.join(", ")}`);
    }

    // Required identity fields
    const requiredIdentity = ["name", "version", "display_name", "description"];
    const missingIdentity = requiredIdentity.filter(k => !team.identity?.[k]);
    if (missingIdentity.length > 0) {
      throw new Error(`Missing identity fields: ${missingIdentity.join(", ")}`);
    }

    // Required definition fields
    if (!team.definition?.members || team.definition.members.length === 0) {
      throw new Error("definition.members must be a non-empty array");
    }

    return JSON.stringify({
      status: "success",
      team_name: team.identity.name,
      version: team.identity.version,
      members_count: team.definition.members.length,
      message: `✅ Team ${team.identity.name} v${team.identity.version} is valid`,
    }, null, 2);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Validation failed: ${msg}`);
  }
}

async function handleUploadWorkflow(args: Record<string, unknown>): Promise<string> {
  const workflowDir = args.workflow_dir as string;
  const marketUrl = args.market_url as string | undefined;
  const apiKey = args.api_key as string | undefined;
  const force = args.force as boolean | undefined;

  if (!workflowDir) {
    throw new Error("workflow_dir is required");
  }

  try {
    const result = await uploadWorkflow({
      workflowDir,
      marketUrl,
      apiKey,
      force,
    });

    return JSON.stringify({
      status: "success",
      workflow_id: result.workflow_id,
      workflow_name: result.workflow_name,
      version: result.version,
      market_url: result.market_url,
      message: `✅ Successfully uploaded Workflow ${result.workflow_name} v${result.version}`,
    }, null, 2);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Upload failed: ${msg}`);
  }
}

async function handleDownloadWorkflow(args: Record<string, unknown>): Promise<string> {
  const workflowId = args.workflow_id as string;
  const outputDir = args.output_dir as string | undefined || "./downloaded-workflows";
  const marketUrl = args.market_url as string | undefined;

  if (!workflowId) {
    throw new Error("workflow_id is required");
  }

  try {
    const result = await downloadWorkflow({
      workflowId,
      outputDir,
      marketUrl,
    });

    return JSON.stringify({
      status: "success",
      workflow_id: result.workflow_id,
      output_path: result.output_path,
      message: `✅ Successfully downloaded Workflow to: ${result.output_path}`,
    }, null, 2);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Download failed: ${msg}`);
  }
}

async function handleListWorkflows(args: Record<string, unknown>): Promise<string> {
  const tag = args.tag as string | undefined;
  const category = args.category as string | undefined;
  const marketUrl = args.market_url as string | undefined;
  const limit = (args.limit as number) || 50;

  try {
    const result = await searchWorkflows({
      tag,
      category,
      marketUrl,
      limit,
    });

    return JSON.stringify({
      total: result.total,
      workflows: result.workflows.map(w => ({
        id: w.id,
        name: w.name,
        display_name: w.display_name,
        version: w.version,
        description: w.description,
        category: w.category,
        tags: w.tags,
        steps_count: w.steps_count,
      })),
    }, null, 2);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Search failed: ${msg}`);
  }
}

async function handleGetWorkflow(args: Record<string, unknown>): Promise<string> {
  const workflowId = args.workflow_id as string;
  const marketUrl = args.market_url as string | undefined;

  if (!workflowId) {
    throw new Error("workflow_id is required");
  }

  try {
    const workflow = await getWorkflow({ workflowId, marketUrl });
    return JSON.stringify({ status: "success", workflow }, null, 2);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Get Workflow failed: ${msg}`);
  }
}

async function handleValidateWorkflow(args: Record<string, unknown>): Promise<string> {
  const workflowDir = args.workflow_dir as string;
  if (!workflowDir) throw new Error("workflow_dir is required");

  try {
    const workflowJsonPath = path.join(workflowDir, "workflow.json");
    if (!fs.existsSync(workflowJsonPath)) {
      throw new Error(`workflow.json not found in: ${workflowDir}`);
    }

    const content = fs.readFileSync(workflowJsonPath, "utf-8");
    const workflow = JSON.parse(content);

    const requiredTop = ["schema_version", "identity", "definition"];
    const missingTop = requiredTop.filter(k => !workflow[k]);
    if (missingTop.length > 0) {
      throw new Error(`Missing top-level fields: ${missingTop.join(", ")}`);
    }

    const requiredIdentity = ["name", "version", "display_name", "description"];
    const missingIdentity = requiredIdentity.filter(k => !workflow.identity?.[k]);
    if (missingIdentity.length > 0) {
      throw new Error(`Missing identity fields: ${missingIdentity.join(", ")}`);
    }

    if (!workflow.definition?.steps || workflow.definition.steps.length === 0) {
      throw new Error("definition.steps must be a non-empty array");
    }

    return JSON.stringify({
      status: "success",
      workflow_name: workflow.identity.name,
      version: workflow.identity.version,
      steps_count: workflow.definition.steps.length,
      message: `✅ Workflow ${workflow.identity.name} v${workflow.identity.version} is valid`,
    }, null, 2);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Validation failed: ${msg}`);
  }
}

// ---- Server Setup ----
const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result: string;
    switch (name) {
      case "list_installed_tools": result = await handleListTools(); break;
      case "adapt_agent": result = await handleAdaptAgent(args ?? {}); break;
      case "install_agent": result = await handleInstallAgent(args ?? {}); break;
      case "deploy_agent": result = await handleDeployAgent(args ?? {}); break;
      case "import_agent": result = await handleImportAgent(args ?? {}); break;
      case "upload_agent": result = await handleUploadAgent(args ?? {}); break;
      case "download_agent": result = await handleDownloadAgent(args ?? {}); break;
      case "list_agents": result = await handleListAgents(args ?? {}); break;
      case "execute_agent": result = await handleExecuteAgent(args ?? {}); break;
      case "scan_deployed": result = await handleScanDeployed(args ?? {}); break;
      case "uninstall_agent": result = await handleUninstallAgent(args ?? {}); break;
      case "check_updates": result = await handleCheckUpdates(args ?? {}); break;
      case "upload_team": result = await handleUploadTeam(args ?? {}); break;
      case "download_team": result = await handleDownloadTeam(args ?? {}); break;
      case "list_teams": result = await handleListTeams(args ?? {}); break;
      case "get_team": result = await handleGetTeam(args ?? {}); break;
      case "validate_team": result = await handleValidateTeam(args ?? {}); break;
      case "upload_workflow": result = await handleUploadWorkflow(args ?? {}); break;
      case "download_workflow": result = await handleDownloadWorkflow(args ?? {}); break;
      case "list_workflows": result = await handleListWorkflows(args ?? {}); break;
      case "get_workflow": result = await handleGetWorkflow(args ?? {}); break;
      case "validate_workflow": result = await handleValidateWorkflow(args ?? {}); break;
      default: throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: "text", text: result }] };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }], isError: true };
  }
});

// ---- Run ----
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
