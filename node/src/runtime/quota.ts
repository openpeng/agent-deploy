import { ExecutionContext } from "./types.js";
import { recordQuotaExceeded } from "../metrics.js";

/**
 * Quota options for resource limits
 */
export interface QuotaOptions {
  /** Maximum execution time in milliseconds (default: 30000) */
  maxExecutionTimeMs?: number;
  /** Memory limit in MB (default: 512) */
  maxMemoryMB?: number;
  /** Maximum network request count (default: 100) */
  maxNetworkRequests?: number;
  /** Maximum file operation count (default: 1000) */
  maxFileOperations?: number;
  /** Token usage budget for LLM calls (default: 100000) */
  maxTokenUsage?: number;
  /** CPU time limit in milliseconds (default: 30000) */
  maxCpuTimeMs?: number;
}

/**
 * Usage statistics for an agent execution
 */
export interface UsageStats {
  agentName: string;
  executionTimeMs: number;
  memoryMB: number;
  networkRequests: number;
  fileOperations: number;
  tokenUsage: number;
  cpuTimeMs: number;
  startTime: number;
  warnings: string[];
  exceeded: string[];
}

/**
 * Error thrown when a quota limit is exceeded
 */
export class QuotaExceededError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly quotaType: string,
    public readonly limit: number,
    public readonly actual: number
  ) {
    super(
      `Quota exceeded for agent '${agentName}': ${quotaType} limit=${limit}, actual=${actual}`
    );
    this.name = "QuotaExceededError";
  }
}

/**
 * Default quota options
 */
const DEFAULT_QUOTAS: Required<QuotaOptions> = {
  maxExecutionTimeMs: 30000,
  maxMemoryMB: 512,
  maxNetworkRequests: 100,
  maxFileOperations: 1000,
  maxTokenUsage: 100000,
  maxCpuTimeMs: 30000,
};

/**
 * Tracks resource usage for a single execution
 */
class ExecutionTracker {
  private startTime: number;
  private startCpuUsage: NodeJS.CpuUsage;
  private networkRequests = 0;
  private fileOperations = 0;
  private tokenUsage = 0;
  private warnings: string[] = [];
  private exceeded: string[] = [];

  constructor(
    public readonly agentName: string,
    private quotas: Required<QuotaOptions>
  ) {
    this.startTime = Date.now();
    this.startCpuUsage = process.cpuUsage();
  }

  get elapsedTimeMs(): number {
    return Date.now() - this.startTime;
  }

  get cpuTimeMs(): number {
    const usage = process.cpuUsage(this.startCpuUsage);
    return (usage.user + usage.system) / 1000; // microseconds to ms
  }

  get memoryMB(): number {
    const mem = process.memoryUsage();
    return Math.round(mem.heapUsed / 1024 / 1024);
  }

  incrementNetworkRequests(): void {
    this.networkRequests++;
  }

  incrementFileOperations(): void {
    this.fileOperations++;
  }

  addTokenUsage(tokens: number): void {
    this.tokenUsage += tokens;
  }

  addWarning(message: string): void {
    this.warnings.push(message);
  }

  addExceeded(quotaType: string): void {
    this.exceeded.push(quotaType);
  }

  getStats(): UsageStats {
    return {
      agentName: this.agentName,
      executionTimeMs: this.elapsedTimeMs,
      memoryMB: this.memoryMB,
      networkRequests: this.networkRequests,
      fileOperations: this.fileOperations,
      tokenUsage: this.tokenUsage,
      cpuTimeMs: this.cpuTimeMs,
      startTime: this.startTime,
      warnings: [...this.warnings],
      exceeded: [...this.exceeded],
    };
  }

  checkLimit(
    quotaType: keyof Required<QuotaOptions>,
    actual: number,
    softRatio = 0.8
  ): "ok" | "warning" | "exceeded" {
    const limit = this.quotas[quotaType];
    if (actual >= limit) {
      return "exceeded";
    }
    if (actual >= limit * softRatio) {
      return "warning";
    }
    return "ok";
  }

  get quotasRef(): Required<QuotaOptions> {
    return this.quotas;
  }
}

/**
 * Manages resource quotas for agent executions
 */
export class QuotaManager {
  private executions = new Map<string, ExecutionTracker>();
  private globalQuotas: Required<QuotaOptions>;

  constructor(globalQuotas?: QuotaOptions) {
    this.globalQuotas = { ...DEFAULT_QUOTAS, ...globalQuotas };
  }

  /**
   * Start tracking an agent execution
   */
  trackExecution(agentName: string, options?: QuotaOptions): void {
    const quotas = { ...this.globalQuotas, ...options };
    const tracker = new ExecutionTracker(agentName, quotas);
    this.executions.set(agentName, tracker);
  }

  /**
   * Stop tracking an agent execution
   */
  stopExecution(agentName: string): UsageStats | undefined {
    const tracker = this.executions.get(agentName);
    if (!tracker) return undefined;
    const stats = tracker.getStats();
    this.executions.delete(agentName);
    return stats;
  }

  /**
   * Check if current usage is within limits.
   * Returns true if ok, throws QuotaExceededError if hard limit exceeded.
   */
  checkLimits(context: ExecutionContext): boolean {
    const agentName = context.agent.name;
    const tracker = this.executions.get(agentName);
    if (!tracker) {
      // Auto-start tracking if not already tracked
      this.trackExecution(agentName);
      return true;
    }

    const quotas = tracker.quotasRef;

    // Check execution time
    const execTime = tracker.elapsedTimeMs;
    const execStatus = tracker.checkLimit("maxExecutionTimeMs", execTime);
    if (execStatus === "exceeded") {
      tracker.addExceeded("maxExecutionTimeMs");
      recordQuotaExceeded(agentName, "maxExecutionTimeMs");
      throw new QuotaExceededError(
        agentName,
        "maxExecutionTimeMs",
        quotas.maxExecutionTimeMs,
        execTime
      );
    } else if (execStatus === "warning") {
      tracker.addWarning(
        `Execution time ${execTime}ms approaching limit ${quotas.maxExecutionTimeMs}ms`
      );
    }

    // Check memory
    const mem = tracker.memoryMB;
    const memStatus = tracker.checkLimit("maxMemoryMB", mem);
    if (memStatus === "exceeded") {
      tracker.addExceeded("maxMemoryMB");
      recordQuotaExceeded(agentName, "maxMemoryMB");
      throw new QuotaExceededError(
        agentName,
        "maxMemoryMB",
        quotas.maxMemoryMB,
        mem
      );
    } else if (memStatus === "warning") {
      tracker.addWarning(
        `Memory usage ${mem}MB approaching limit ${quotas.maxMemoryMB}MB`
      );
    }

    // Check network requests
    const netStatus = tracker.checkLimit(
      "maxNetworkRequests",
      tracker["networkRequests"]
    );
    if (netStatus === "exceeded") {
      tracker.addExceeded("maxNetworkRequests");
      recordQuotaExceeded(agentName, "maxNetworkRequests");
      throw new QuotaExceededError(
        agentName,
        "maxNetworkRequests",
        quotas.maxNetworkRequests,
        tracker["networkRequests"]
      );
    } else if (netStatus === "warning") {
      tracker.addWarning(
        `Network requests ${tracker["networkRequests"]} approaching limit ${quotas.maxNetworkRequests}`
      );
    }

    // Check file operations
    const fileStatus = tracker.checkLimit(
      "maxFileOperations",
      tracker["fileOperations"]
    );
    if (fileStatus === "exceeded") {
      tracker.addExceeded("maxFileOperations");
      recordQuotaExceeded(agentName, "maxFileOperations");
      throw new QuotaExceededError(
        agentName,
        "maxFileOperations",
        quotas.maxFileOperations,
        tracker["fileOperations"]
      );
    } else if (fileStatus === "warning") {
      tracker.addWarning(
        `File operations ${tracker["fileOperations"]} approaching limit ${quotas.maxFileOperations}`
      );
    }

    // Check token usage
    const tokenStatus = tracker.checkLimit("maxTokenUsage", tracker["tokenUsage"]);
    if (tokenStatus === "exceeded") {
      tracker.addExceeded("maxTokenUsage");
      recordQuotaExceeded(agentName, "maxTokenUsage");
      throw new QuotaExceededError(
        agentName,
        "maxTokenUsage",
        quotas.maxTokenUsage,
        tracker["tokenUsage"]
      );
    } else if (tokenStatus === "warning") {
      tracker.addWarning(
        `Token usage ${tracker["tokenUsage"]} approaching limit ${quotas.maxTokenUsage}`
      );
    }

    // Check CPU time
    const cpu = tracker.cpuTimeMs;
    const cpuStatus = tracker.checkLimit("maxCpuTimeMs", cpu);
    if (cpuStatus === "exceeded") {
      tracker.addExceeded("maxCpuTimeMs");
      recordQuotaExceeded(agentName, "maxCpuTimeMs");
      throw new QuotaExceededError(
        agentName,
        "maxCpuTimeMs",
        quotas.maxCpuTimeMs,
        cpu
      );
    } else if (cpuStatus === "warning") {
      tracker.addWarning(
        `CPU time ${cpu}ms approaching limit ${quotas.maxCpuTimeMs}ms`
      );
    }

    return true;
  }

  /**
   * Get current usage stats for an agent
   */
  getUsage(agentName: string): UsageStats | undefined {
    const tracker = this.executions.get(agentName);
    if (!tracker) return undefined;
    return tracker.getStats();
  }

  /**
   * Increment network request counter for an agent
   */
  recordNetworkRequest(agentName: string): void {
    const tracker = this.executions.get(agentName);
    if (tracker) {
      tracker.incrementNetworkRequests();
    }
  }

  /**
   * Increment file operation counter for an agent
   */
  recordFileOperation(agentName: string): void {
    const tracker = this.executions.get(agentName);
    if (tracker) {
      tracker.incrementFileOperations();
    }
  }

  /**
   * Add token usage for an agent
   */
  recordTokenUsage(agentName: string, tokens: number): void {
    const tracker = this.executions.get(agentName);
    if (tracker) {
      tracker.addTokenUsage(tokens);
    }
  }

  /**
   * Get all active execution stats
   */
  getAllUsages(): UsageStats[] {
    return Array.from(this.executions.values()).map((t) => t.getStats());
  }

  /**
   * Clear all tracked executions
   */
  clear(): void {
    this.executions.clear();
  }
}
