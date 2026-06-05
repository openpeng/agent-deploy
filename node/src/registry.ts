import { readFileSync } from "fs";
import { load } from "js-yaml";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, "tools-registry.yaml");

export interface ToolConfig {
  name: string;
  detection: {
    binaries?: string[];
    config_files?: string[];
    env_vars?: string[];
  };
  agent_format: {
    type: string;
    directory?: string;
    filename?: string;
    frontmatter?: boolean;
  };
  install: Record<string, string>;
}

export interface Registry {
  tools: Record<string, ToolConfig>;
}

let _registry: Registry | null = null;

/** Load and cache the tools registry from YAML. */
export function loadRegistry(): Registry {
  if (!_registry) {
    const raw = readFileSync(REGISTRY_PATH, "utf8");
    _registry = load(raw) as Registry;
  }
  return _registry!;
}

/** Return the tool config for a given tool key, or undefined. */
export function getToolConfig(toolKey: string): ToolConfig | undefined {
  const registry = loadRegistry();
  return registry.tools[toolKey];
}

/** List all registered tool keys. */
export function listToolKeys(): string[] {
  const registry = loadRegistry();
  return Object.keys(registry.tools);
}
