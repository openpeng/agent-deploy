/**
 * Execution Policy — Runtime security sandbox for Agent execution.
 *
 * Supports 3-level policy model:
 *   - restricted: no bash, no network, cwd-only fs access
 *   - standard:   read-only network, limited fs access
 *   - trusted:    full capabilities
 *
 * Policies can be loaded from policy.yaml (Policy-as-Code).
 */

export type PolicyLevel = 'restricted' | 'standard' | 'trusted';

export interface PolicyConfig {
  /** Policy level */
  level: PolicyLevel;

  /** Allow shell command execution via bash tool */
  allowBash: boolean;

  /** File system paths the agent can read/write */
  allowedPaths: string[];

  /** File system paths explicitly blocked */
  blockedPaths: string[];

  /** Allow outbound HTTP requests via web_fetch */
  allowNetwork: boolean;

  /** Allow web search via web_search */
  allowWebSearch: boolean;

  /** Network host whitelist (empty = allow all when allowNetwork is true) */
  networkWhitelist: string[];

  /** Maximum file size in bytes */
  maxFileSize: number;

  /** Maximum execution time in milliseconds */
  maxExecutionTime: number;

  /** Maximum number of concurrent sub-agent invocations */
  maxConcurrentAgents: number;

  /** Global timeout in milliseconds for the entire pipeline */
  timeoutMs: number;
}

/** Default restricted policy — minimal permissions */
export const DEFAULT_RESTRICTED_POLICY: PolicyConfig = {
  level: 'restricted',
  allowBash: false,
  allowedPaths: [],
  blockedPaths: [],
  allowNetwork: false,
  allowWebSearch: false,
  networkWhitelist: [],
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxExecutionTime: 300000, // 5 min
  maxConcurrentAgents: 1,
  timeoutMs: 300000,
};

/** Standard policy — limited network, controlled fs access */
export const DEFAULT_STANDARD_POLICY: PolicyConfig = {
  level: 'standard',
  allowBash: false,
  allowedPaths: [],
  blockedPaths: [],
  allowNetwork: true,
  allowWebSearch: true,
  networkWhitelist: [],
  maxFileSize: 50 * 1024 * 1024, // 50MB
  maxExecutionTime: 600000, // 10 min
  maxConcurrentAgents: 3,
  timeoutMs: 600000,
};

/** Trusted policy — grants full access */
export const DEFAULT_TRUSTED_POLICY: PolicyConfig = {
  level: 'trusted',
  allowBash: true,
  allowedPaths: [],
  blockedPaths: [],
  allowNetwork: true,
  allowWebSearch: true,
  networkWhitelist: [],
  maxFileSize: 100 * 1024 * 1024, // 100MB
  maxExecutionTime: 600000, // 10 min
  maxConcurrentAgents: 10,
  timeoutMs: 600000,
};

export const LEVEL_POLICIES: Record<PolicyLevel, PolicyConfig> = {
  restricted: DEFAULT_RESTRICTED_POLICY,
  standard: DEFAULT_STANDARD_POLICY,
  trusted: DEFAULT_TRUSTED_POLICY,
};

/**
 * Dangerous shell command patterns that are always blocked,
 * even in trusted mode.
 */
export const DANGEROUS_COMMAND_PATTERNS = [
  /rm\s+-rf\s+\/$/,
  /rm\s+-rf\s+\/\*/,
  /chmod\s+(-R\s+)?777/,
  />\s*\/dev\/sda/,
  /dd\s+if=/,
  /mkfs\./,
  /:\s*\(\)\s*\{/,     // fork bomb pattern
];

/**
 * Internal IP ranges that web_fetch must not access.
 */
export const BLOCKED_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\.0\.0\.0$/,
];

/**
 * PolicyRegistry — stores per-agent execution policies.
 */
export class PolicyRegistry {
  private policies = new Map<string, PolicyConfig>();
  private defaultPolicy: PolicyConfig;

  constructor(defaultPolicy: PolicyConfig = DEFAULT_RESTRICTED_POLICY) {
    this.defaultPolicy = defaultPolicy;
  }

  /** Get the policy for an agent, returning defaults if none set */
  get(agentName: string): PolicyConfig {
    return this.policies.get(agentName) || this.defaultPolicy;
  }

  /** Set a custom policy for an agent */
  set(agentName: string, policy: PolicyConfig): void {
    this.policies.set(agentName, policy);
  }

  /** Set policy level for an agent */
  setLevel(agentName: string, level: PolicyLevel): void {
    this.set(agentName, { ...LEVEL_POLICIES[level] });
  }

  /** Grant full trust to an agent */
  trust(agentName: string): void {
    this.setLevel(agentName, 'trusted');
  }

  /** Reset an agent to the default restricted policy */
  reset(agentName: string): void {
    this.policies.delete(agentName);
  }

  /** Check if an agent is currently trusted */
  isTrusted(agentName: string): boolean {
    const policy = this.policies.get(agentName);
    return policy ? policy.level === 'trusted' : false;
  }

  /** Get the policy level for an agent */
  getLevel(agentName: string): PolicyLevel {
    return this.get(agentName).level;
  }

  /**
   * Propagate trust from parent agent to child agent.
   * If parent is trusted, child also gets full access.
   */
  propagateTrust(parentName: string, childName: string): void {
    if (this.isTrusted(parentName)) {
      this.trust(childName);
    }
  }

  /** Get the current default policy */
  getDefault(): PolicyConfig {
    return this.defaultPolicy;
  }
}

/** Singleton policy registry */
const globalPolicyRegistry = new PolicyRegistry();

export function getPolicyRegistry(): PolicyRegistry {
  return globalPolicyRegistry;
}
