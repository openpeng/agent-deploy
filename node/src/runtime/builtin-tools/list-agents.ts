/**
 * Builtin Tool: list_agents
 *
 * Lists all registered sub-agent tools and their descriptions.
 * Enables runtime agent discovery — an agent can query what
 * other agents are available to invoke.
 */
import { ToolRegistry } from "../tool-registry.js";

export const listAgentsTool = {
  name: "list_agents",

  description: "List all registered sub-agents with their descriptions. Use this to discover which agents are available for invoke_agent.",

  async execute(_args: any, _context: any): Promise<{
    total: number;
    agents: Array<{ name: string; description: string }>;
  }> {
    const registry = ToolRegistry.from(_context);
    const agentTools: Array<{ name: string; description: string }> = [];

    if (registry) {
      const tools = registry.list();
      for (const toolName of tools) {
        if (toolName.startsWith("agent/")) {
          const tool = registry.get(toolName);
          agentTools.push({
            name: toolName.replace("agent/", ""),
            description: (tool as any)?.description || "No description",
          });
        }
      }
    }

    return {
      total: agentTools.length,
      agents: agentTools,
    };
  },
};
