/**
 * Check for updates to deployed agents by comparing local versions with Market versions.
 */

import { getActiveDeployments, type DeploymentRecord } from "./state.js";
import { MarketClient } from "./market.js";

export interface UpdateInfo {
  /** Agent name */
  agent_name: string;
  /** Currently deployed version */
  current_version: string;
  /** Latest version available on Market */
  latest_version?: string;
  /** Target tool */
  target_tool: string;
  /** Whether an update is available */
  has_update: boolean;
  /** Market agent ID (if found) */
  market_id?: string;
  /** Error message if check failed */
  error?: string;
}

/**
 * Check for updates to all deployed agents.
 *
 * @param marketUrl - Optional Market API URL override.
 * @returns Array of update information for each deployed agent.
 */
export async function checkUpdates(marketUrl?: string): Promise<UpdateInfo[]> {
  const deployments = getActiveDeployments();
  const results: UpdateInfo[] = [];

  // Group deployments by agent name to avoid duplicate checks
  const seenAgents = new Set<string>();

  for (const deployment of deployments) {
    // Skip if already checked this agent
    if (seenAgents.has(deployment.agent_name)) continue;
    seenAgents.add(deployment.agent_name);

    const info: UpdateInfo = {
      agent_name: deployment.agent_name,
      current_version: deployment.version,
      target_tool: deployment.target_tool,
      has_update: false,
    };

    try {
      // Search for this agent on the Market
      const client = new MarketClient({ baseUrl: marketUrl || process.env.MARKET_API_URL || "http://localhost:8321" });
      const searchResult = await client.searchAgents({ query: deployment.agent_name });

      if (searchResult && searchResult.agents && searchResult.agents.length > 0) {
        // Find the best match (exact name match preferred)
        const match = searchResult.agents.find(
          (r: any) => r.name === deployment.agent_name || r.display_name === deployment.agent_name
        ) || searchResult.agents[0];

        info.market_id = match.id;
        info.latest_version = match.version;

        // Compare versions (simple string comparison, could be enhanced with semver)
        if (match.version && match.version !== deployment.version) {
          info.has_update = true;
        }
      }
    } catch (err: any) {
      info.error = err.message || "Failed to check Market";
    }

    results.push(info);
  }

  return results;
}

/**
 * Get summary of update status.
 */
export function getUpdateSummary(updates: UpdateInfo[]): {
  total: number;
  up_to_date: number;
  has_updates: number;
  check_failed: number;
} {
  return {
    total: updates.length,
    up_to_date: updates.filter((u) => !u.has_update && !u.error).length,
    has_updates: updates.filter((u) => u.has_update).length,
    check_failed: updates.filter((u) => u.error).length,
  };
}
