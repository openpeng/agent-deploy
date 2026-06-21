/**
 * Builtin Tool: list_agents
 *
 * Lists all registered sub-agent tools and their descriptions.
 * Supports optional market discovery.
 */
import { ToolRegistry } from "../tool-registry.js";
import { MarketClient } from "../../market.js";
import { ExecutionContext } from "../types.js";

interface ListAgentsArgs {
  include_market?: boolean;
}

interface AgentListItem {
  name: string;
  description: string;
  source: string;
}

interface ListAgentsResult {
  total: number;
  agents: AgentListItem[];
}

interface ToolLike {
  description?: string;
}

export const listAgentsTool = {
  name: "list_agents",

  description: "List all registered sub-agents with their descriptions. Supports optional market discovery.",

  async execute(args: ListAgentsArgs, _context: ExecutionContext): Promise<ListAgentsResult> {
    const registry = ToolRegistry.from(_context);
    const agentTools: AgentListItem[] = [];

    // Local agents from registry
    if (registry) {
      const tools = registry.list();
      for (const toolName of tools) {
        if (toolName.startsWith("agent/")) {
          const tool = registry.get(toolName) as ToolLike | undefined;
          agentTools.push({
            name: toolName.replace("agent/", ""),
            description: tool?.description || "No description",
            source: "local",
          });
        }
      }
    }

    // Market discovery (non-fatal if unavailable)
    if (args?.include_market !== false) {
      try {
        const marketUrl = process.env.MARKET_API_URL || "http://localhost:8321";
        const client = new MarketClient({ baseUrl: marketUrl });
        const result = await client.searchAgents({ limit: 50 });
        if (result?.agents) {
          for (const agent of result.agents) {
            // Avoid duplicates with local agents
            const alreadyLocal = agentTools.some(a => a.name === (agent.name || agent.id));
            if (!alreadyLocal) {
              agentTools.push({
                name: agent.name || agent.id || "unknown",
                description: agent.description || "No description",
                source: "market",
              });
            }
          }
        }
      } catch (err) {
        if (process.env.DEBUG) console.warn('[list_agents] Market discovery skipped:', (err as Error).message);
      }
    }

    return {
      total: agentTools.length,
      agents: agentTools,
    };
  },
};
