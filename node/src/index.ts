#!/usr/bin/env node
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
        level: { type: "string", description: "Install level: project, user, or both", default: "both" },
      },
      required: ["adapted_content", "agent_name", "target_tool"],
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
        level: { type: "string", description: "Install level", default: "both" },
      },
      required: ["agent_path"],
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
  const { adapted_content, agent_name, target_tool, level } = args as {
    adapted_content: string; agent_name: string; target_tool: string; level?: string;
  };
  const results = await installAgent(adapted_content, agent_name, target_tool, level ?? "both", false);
  return JSON.stringify({ status: "ok", results }, null, 2);
}

async function handleDeployAgent(args: Record<string, unknown>): Promise<string> {
  const agentPath = args.agent_path as string;
  const targetTool = (args.target_tool as string) ?? "auto";
  const level = (args.level as string) ?? "both";

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
    const adapted = await adaptAgent(agentPath, tt);
    const results = await installAgent(adapted.content, adapted.slug ?? "agent", tt, level, false);
    allResults.push({ tool: tt, adapt: adapted, install: results });
  }

  return JSON.stringify({
    status: "ok",
    detected_tools: detected.map(t => t.tool),
    target_tools: targetTools,
    results: allResults,
  }, null, 2);
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
