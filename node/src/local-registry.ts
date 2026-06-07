/**
 * Local Agent Registry
 *
 * Manages a local registry of agents for development.
 * Similar to `npm link` — allows developing and testing agents
 * without publishing to Market.
 *
 * Registry file: ~/.agent-market/local-registry.json
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface LocalRegistryEntry {
  name: string;
  version: string;
  path: string;
  linkedAt: string;
  description?: string;
}

const REGISTRY_DIR = path.join(os.homedir(), ".agent-market");
const REGISTRY_FILE = path.join(REGISTRY_DIR, "local-registry.json");

function ensureRegistry(): void {
  if (!fs.existsSync(REGISTRY_DIR)) {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  }
  if (!fs.existsSync(REGISTRY_FILE)) {
    fs.writeFileSync(REGISTRY_FILE, "{}", "utf-8");
  }
}

function readRegistry(): Record<string, LocalRegistryEntry> {
  ensureRegistry();
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeRegistry(data: Record<string, LocalRegistryEntry>): void {
  ensureRegistry();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export function linkAgent(agentDir: string): LocalRegistryEntry {
  const fullPath = path.resolve(agentDir);
  const agentJsonPath = path.join(fullPath, "agent.json");

  if (!fs.existsSync(agentJsonPath)) {
    throw new Error(`No agent.json found in ${fullPath}`);
  }

  const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
  const name = agentJson.identity?.name || agentJson.name || path.basename(fullPath);
  const version = agentJson.identity?.version || "0.1.0";

  const registry = readRegistry();

  if (registry[name]) {
    console.warn(`Agent '${name}' already linked at ${registry[name].path}. Overwriting...`);
  }

  const entry: LocalRegistryEntry = {
    name,
    version,
    path: fullPath,
    description: agentJson.identity?.description || "",
    linkedAt: new Date().toISOString(),
  };

  registry[name] = entry;
  writeRegistry(registry);

  console.log(`Linked agent '${name}' (v${version}) at ${fullPath}`);
  return entry;
}

export function unlinkAgent(name: string): void {
  const registry = readRegistry();

  if (!registry[name]) {
    throw new Error(`Agent '${name}' is not linked`);
  }

  delete registry[name];
  writeRegistry(registry);
  console.log(`Unlinked agent '${name}'`);
}

export function listLinkedAgents(): LocalRegistryEntry[] {
  const registry = readRegistry();
  return Object.values(registry).sort((a, b) => a.name.localeCompare(b.name));
}

export function getLinkedAgent(name: string): LocalRegistryEntry | null {
  const registry = readRegistry();
  return registry[name] || null;
}
