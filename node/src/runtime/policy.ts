/**
 * Execution Policy — Runtime security sandbox for Agent execution.
 *
 * All Agents run in restricted mode by default. Users must explicitly
 * `--trusted` to grant full capabilities. The PolicyRegistry manages
 * per-agent policy settings.
 */

export interface ExecutionPolicy {
  /** Allow shell command execution via bash tool */
  allowBash: boolean;

  /** File system paths the agent can read/write (default: agent working dir only) */
  allowedPaths: string[];

  /** Allow outbound HTTP requests via web_fetch */
  allowNetwork: boolean;

  /** Allow web search via web_search */
  allowWebSearch: boolean;

  /** Maximum number of concurrent sub-agent invocations */
  maxConcurrentAgents: number;

  /** Global timeout in milliseconds for the entire pipeline */
  timeoutMs: number;
}

/** Default restricted policy — no bash, no network, cwd-only fs access */
export const DEFAULT_RESTRICTED_POLICY: ExecutionPolicy = {
  allowBash: false,
  allowedPaths: [],
  allowNetwork: false,
  allowWebSearch: false,
  maxConcurrentAgents: 1,
  timeoutMs: 300000,
};

/** Trusted policy — grants full access (equivalent to current behavior) */
export const TRUSTED_POLICY: ExecutionPolicy = {
  allowBash: true,
  allowedPaths: [],
  allowNetwork: true,
  allowWebSearch: true,
  maxConcurrentAgents: 10,
  timeoutMs: 600000,
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
  private policies = new Map<string, ExecutionPolicy>();
  private defaultPolicy: ExecutionPolicy;

  constructor(defaultPolicy: ExecutionPolicy = DEFAULT_RESTRICTED_POLICY) {
    this.defaultPolicy = defaultPolicy;
  }

  /** Get the policy for an agent, returning defaults if none set */
  get(agentName: string): ExecutionPolicy {
    return this.policies.get(agentName) || this.defaultPolicy;
  }

  /** Set a custom policy for an agent (e.g., when --trusted is used) */
  set(agentName: string, policy: ExecutionPolicy): void {
    this.policies.set(agentName, policy);
  }

  /** Grant full trust to an agent */
  trust(agentName: string): void {
    this.set(agentName, { ...TRUSTED_POLICY });
  }

  /** Reset an agent to the default restricted policy */
  reset(agentName: string): void {
    this.policies.delete(agentName);
  }

  /** Check if an agent is currently trusted */
  isTrusted(agentName: string): boolean {
    return this.policies.has(agentName) &&
      this.policies.get(agentName)!.allowBash === true;
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
  getDefault(): ExecutionPolicy {
    return this.defaultPolicy;
  }
}

/** Singleton policy registry */
const globalPolicyRegistry = new PolicyRegistry();

export function getPolicyRegistry(): PolicyRegistry {
  return globalPolicyRegistry;
}
