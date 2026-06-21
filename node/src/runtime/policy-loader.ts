/**
 * Policy Loader — Load agent execution policies from policy.yaml files.
 *
 * Supports Policy-as-Code with layered overrides:
 *   1. Base policy from policy.yaml
 *   2. Per-agent override (agents.<agentName>)
 *   3. Per-user override (users.<username>)
 *   4. Environment override (env.<ENV_NAME>)
 *   5. CLI argument override (--policy-level)
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  PolicyConfig,
  PolicyLevel,
  LEVEL_POLICIES,
  DEFAULT_RESTRICTED_POLICY,
} from "./policy.js";

export interface PolicyYaml {
  /** Default policy settings */
  default?: Partial<PolicyConfig>;
  /** Per-agent overrides */
  agents?: Record<string, Partial<PolicyConfig>>;
  /** Per-user overrides */
  users?: Record<string, Partial<PolicyConfig>>;
  /** Per-environment overrides */
  env?: Record<string, Partial<PolicyConfig>>;
}

/**
 * Load policy configuration for a specific agent.
 *
 * @param agentName   The agent name to load policy for
 * @param policyFile  Optional explicit path to policy.yaml
 * @returns Resolved PolicyConfig
 */
export function loadPolicy(
  agentName: string,
  policyFile?: string
): PolicyConfig {
  // 1. Start with default restricted policy
  let config: PolicyConfig = { ...DEFAULT_RESTRICTED_POLICY };

  // 2. Locate policy.yaml
  const yamlPath = policyFile || findPolicyYaml();
  if (yamlPath && fs.existsSync(yamlPath)) {
    const parsed = parsePolicyYaml(yamlPath);

    // Apply default section
    if (parsed.default) {
      config = mergePolicy(config, parsed.default);
    }

    // Apply per-agent override
    if (parsed.agents?.[agentName]) {
      config = mergePolicy(config, parsed.agents[agentName]);
    }

    // Apply per-user override
    const username = getUsername();
    if (username && parsed.users?.[username]) {
      config = mergePolicy(config, parsed.users[username]);
    }

    // Apply environment override
    const envName = process.env.AGENT_DEPLOY_ENV || "default";
    if (parsed.env?.[envName]) {
      config = mergePolicy(config, parsed.env[envName]);
    }
  }

  // 3. Ensure level is valid
  if (!isValidPolicyLevel(config.level)) {
    config.level = "restricted";
  }

  return config;
}

/**
 * Load policy from a specific file path without agent/user/env layering.
 * Useful for testing or explicit file loading.
 */
export function loadPolicyFromFile(filePath: string): PolicyConfig {
  if (!fs.existsSync(filePath)) {
    return { ...DEFAULT_RESTRICTED_POLICY };
  }
  const parsed = parsePolicyYaml(filePath);
  let config: PolicyConfig = { ...DEFAULT_RESTRICTED_POLICY };
  if (parsed.default) {
    config = mergePolicy(config, parsed.default);
  }
  if (!isValidPolicyLevel(config.level)) {
    config.level = "restricted";
  }
  return config;
}

/**
 * Find policy.yaml in standard locations:
 *   1. ./policy.yaml
 *   2. ~/.agent-deploy/policy.yaml
 *   3. /etc/agent-deploy/policy.yaml
 */
function findPolicyYaml(): string | undefined {
  const candidates = [
    path.join(process.cwd(), "policy.yaml"),
    path.join(getHomeDir(), ".agent-deploy", "policy.yaml"),
    path.join("/etc", "agent-deploy", "policy.yaml"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function parsePolicyYaml(filePath: string): PolicyYaml {
  const content = fs.readFileSync(filePath, "utf-8");
  return yaml.load(content) as PolicyYaml;
}

function mergePolicy(
  base: PolicyConfig,
  override: Partial<PolicyConfig>
): PolicyConfig {
  return {
    ...base,
    ...override,
    // Deep merge arrays
    allowedPaths: override.allowedPaths ?? base.allowedPaths,
    blockedPaths: override.blockedPaths ?? base.blockedPaths,
    networkWhitelist: override.networkWhitelist ?? base.networkWhitelist,
  };
}

function isValidPolicyLevel(level: string): level is PolicyLevel {
  return level === "restricted" || level === "standard" || level === "trusted";
}

function getUsername(): string | undefined {
  return process.env.USER || process.env.USERNAME || undefined;
}

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || "/tmp";
}

/**
 * Get policy config for a given level, useful for CLI --policy-level.
 */
export function getPolicyByLevel(level: PolicyLevel): PolicyConfig {
  return { ...LEVEL_POLICIES[level] };
}
