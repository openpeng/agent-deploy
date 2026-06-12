/**
 * Builtin Tool: list_agents
 *
 * Lists all registered sub-agent tools and their descriptions.
 * Supports optional market discovery.
 */
import { ToolRegistry } from "../tool-registry.js";
import { MarketClient } from "../../market.js";

export const listAgentsTool = {
  name: "list_agents",

  description: "List all registered sub-agents with their descriptions. Supports optional market discovery.",

  async execute(args: any, _context: any): Promise<{
    total: number;
    agents: Array<{ name: string; description: string; source: string }>;
  }> {
    const registry = ToolRegistry.from(_context);
    const agentTools: Array<{ name: string; description: string; source: string }> = [];

    // Local agents from registry
    if (registry) {
      const tools = registry.list();
      for (const toolName of tools) {
        if (toolName.startsWith("agent/")) {
          const tool = registry.get(toolName);
          agentTools.push({
            name: toolName.replace("agent/", ""),
            description: (tool as any)?.description || "No description",
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
      } catch {
        // Market unavailable, silently skip
      }
    }

    return {
      total: agentTools.length,
      agents: agentTools,
    };
  },
};
