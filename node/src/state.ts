/**
 * Agent deployment state management.
 * Tracks which agents are deployed to which tools, their versions, paths, and timestamps.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const STATE_DIR = join(homedir(), ".agent-deploy");
const STATE_FILE = join(STATE_DIR, "state.json");

/** Record of a single deployment */
export interface DeploymentRecord {
  /** Agent name (from agent.json identity.name) */
  agent_name: string;
  /** Agent version */
  version: string;
  /** Target tool registry key (e.g. "cursor", "trae") */
  target_tool: string;
  /** Absolute path where the agent was installed */
  install_path: string;
  /** Install level: "project" or "user" */
  level: string;
  /** ISO timestamp of deployment */
  deployed_at: string;
  /** Whether this deployment is still active (file exists) */
  active: boolean;
}

/** Full state structure */
export interface DeployState {
  schema_version: string;
  /** All deployment records */
  deployments: DeploymentRecord[];
  /** Last time the state was updated */
  last_updated: string;
}

const DEFAULT_STATE: DeployState = {
  schema_version: "1.0",
  deployments: [],
  last_updated: new Date().toISOString(),
};

/** Ensure state directory exists */
function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
}

/** Load the deployment state from disk */
export function loadState(): DeployState {
  ensureStateDir();
  if (!existsSync(STATE_FILE)) {
    return { ...DEFAULT_STATE };
  }
  try {
    const raw = readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as DeployState;
    // Validate basic structure
    if (!parsed.deployments || !Array.isArray(parsed.deployments)) {
      return { ...DEFAULT_STATE };
    }
    return parsed;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/** Save the deployment state to disk */
export function saveState(state: DeployState): void {
  ensureStateDir();
  state.last_updated = new Date().toISOString();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

/** Add or update a deployment record */
export function recordDeployment(
  agentName: string,
  version: string,
  targetTool: string,
  installPath: string,
  level: string,
): void {
  const state = loadState();
  // Remove any existing record for this agent+tool+level combination
  state.deployments = state.deployments.filter(
    (d) => !(d.agent_name === agentName && d.target_tool === targetTool && d.level === level),
  );
  // Add new record
  state.deployments.push({
    agent_name: agentName,
    version,
    target_tool: targetTool,
    install_path: installPath,
    level,
    deployed_at: new Date().toISOString(),
    active: true,
  });
  saveState(state);
}

/** Mark a deployment as removed */
export function removeDeployment(
  agentName: string,
  targetTool: string,
  level: string,
): void {
  const state = loadState();
  const record = state.deployments.find(
    (d) => d.agent_name === agentName && d.target_tool === targetTool && d.level === level,
  );
  if (record) {
    record.active = false;
    record.deployed_at = new Date().toISOString();
    saveState(state);
  }
}

/** Get all active deployments */
export function getActiveDeployments(): DeploymentRecord[] {
  const state = loadState();
  return state.deployments.filter((d) => d.active);
}

/** Get deployments for a specific agent */
export function getAgentDeployments(agentName: string): DeploymentRecord[] {
  const state = loadState();
  return state.deployments.filter((d) => d.agent_name === agentName);
}

/** Get deployments for a specific tool */
export function getToolDeployments(targetTool: string): DeploymentRecord[] {
  const state = loadState();
  return state.deployments.filter((d) => d.target_tool === targetTool);
}

/** Check if an agent is deployed to a specific tool */
export function isDeployed(agentName: string, targetTool: string): boolean {
  const state = loadState();
  return state.deployments.some(
    (d) => d.agent_name === agentName && d.target_tool === targetTool && d.active,
  );
}

/** Sync state with filesystem: mark records as inactive if files no longer exist */
export function syncStateWithFilesystem(): void {
  const state = loadState();
  let changed = false;
  for (const record of state.deployments) {
    const fileExists = existsSync(record.install_path);
    if (record.active && !fileExists) {
      record.active = false;
      changed = true;
    } else if (!record.active && fileExists) {
      record.active = true;
      changed = true;
    }
  }
  if (changed) {
    saveState(state);
  }
}
