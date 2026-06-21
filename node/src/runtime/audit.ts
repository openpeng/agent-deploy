import * as fs from "fs";
import * as path from "path";

/**
 * Audit event types
 */
export type AuditEventType = "tool_call" | "agent_execution" | "policy_violation";

/**
 * Policy levels
 */
export type PolicyLevel = "standard" | "restricted" | "privileged";

/**
 * Tool call audit record
 */
export interface ToolCallRecord {
  agent_name: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  result_status: "success" | "failure";
  duration_ms: number;
  policy_level?: PolicyLevel;
  error_message?: string;
  trace_id?: string;
}

/**
 * Agent execution audit record
 */
export interface AgentExecutionRecord {
  agent_name: string;
  pipeline_steps: number;
  result_status: "success" | "failure" | "partial";
  duration_ms: number;
  policy_level?: PolicyLevel;
  error_message?: string;
  trace_id?: string;
}

/**
 * Policy violation audit record
 */
export interface PolicyViolationRecord {
  agent_name: string;
  violation_type: string;
  details: Record<string, unknown>;
  policy_level?: PolicyLevel;
  trace_id?: string;
}

/**
 * Base audit log entry
 */
interface AuditLogEntry {
  timestamp: string;
  event_type: AuditEventType;
  agent_name: string;
  duration_ms?: number;
  result_status?: string;
  policy_level: PolicyLevel;
  trace_id?: string;
  [key: string]: unknown;
}

/**
 * Configuration for AuditLogger
 */
export interface AuditLoggerOptions {
  /** Directory to store audit log files (default: "logs") */
  logDir?: string;
  /** Whether to output to stderr in DEBUG mode (default: false) */
  debugMode?: boolean;
  /** Default policy level (default: "standard") */
  defaultPolicyLevel?: PolicyLevel;
}

/**
 * Audit logger for agent execution events
 */
export class AuditLogger {
  private logDir: string;
  private debugMode: boolean;
  private defaultPolicyLevel: PolicyLevel;
  private currentFile: string | null = null;
  private buffer: string[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private readonly BUFFER_SIZE = 10;
  private readonly FLUSH_INTERVAL_MS = 5000;

  constructor(options: AuditLoggerOptions = {}) {
    this.logDir = options.logDir || "logs";
    this.debugMode = options.debugMode || false;
    this.defaultPolicyLevel = options.defaultPolicyLevel || "standard";

    this.ensureLogDir();
    this.updateCurrentFile();
    this.startFlushTimer();
  }

  /**
   * Ensure the log directory exists
   */
  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Update the current log file path based on today's date
   */
  private updateCurrentFile(): void {
    const date = new Date().toISOString().split("T")[0];
    this.currentFile = path.join(this.logDir, `audit-${date}.jsonl`);
  }

  /**
   * Start the periodic flush timer
   */
  private startFlushTimer(): void {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.FLUSH_INTERVAL_MS);

    // Ensure flush on process exit
    process.on("exit", () => this.flushSync());
    process.on("SIGINT", () => {
      this.flushSync();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      this.flushSync();
      process.exit(0);
    });
  }

  /**
   * Get the current timestamp in ISO format
   */
  private getTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Write a log entry to file and optionally stderr
   */
  private write(entry: AuditLogEntry): void {
    const line = JSON.stringify(entry);

    // Add to buffer
    this.buffer.push(line);

    // Debug output to stderr
    if (this.debugMode) {
      console.error(`[AUDIT] ${line}`);
    }

    // Flush if buffer is full
    if (this.buffer.length >= this.BUFFER_SIZE) {
      this.flush();
    }
  }

  /**
   * Flush buffered log entries to file
   */
  flush(): void {
    if (this.buffer.length === 0 || !this.currentFile) return;

    // Check if date has changed
    const expectedFile = path.join(
      this.logDir,
      `audit-${new Date().toISOString().split("T")[0]}.jsonl`
    );
    if (this.currentFile !== expectedFile) {
      this.updateCurrentFile();
    }

    try {
      const data = this.buffer.join("\n") + "\n";
      fs.appendFileSync(this.currentFile, data, "utf-8");
      this.buffer = [];
    } catch (error) {
      console.error(
        `[AUDIT ERROR] Failed to write audit log: ${(error as Error).message}`
      );
    }
  }

  /**
   * Synchronous flush for process exit
   */
  private flushSync(): void {
    if (this.buffer.length === 0 || !this.currentFile) return;

    try {
      const data = this.buffer.join("\n") + "\n";
      fs.appendFileSync(this.currentFile, data, "utf-8");
      this.buffer = [];
    } catch (error) {
      console.error(
        `[AUDIT ERROR] Failed to flush audit log: ${(error as Error).message}`
      );
    }
  }

  /**
   * Log a tool call event
   */
  logToolCall(record: ToolCallRecord): void {
    const entry: AuditLogEntry = {
      timestamp: this.getTimestamp(),
      event_type: "tool_call",
      agent_name: record.agent_name,
      tool_name: record.tool_name,
      arguments: this.sanitizeArguments(record.arguments),
      result_status: record.result_status,
      duration_ms: record.duration_ms,
      policy_level: record.policy_level || this.defaultPolicyLevel,
      trace_id: record.trace_id,
    };

    if (record.error_message) {
      entry.error_message = record.error_message;
    }

    this.write(entry);
  }

  /**
   * Log an agent execution event
   */
  logAgentExecution(record: AgentExecutionRecord): void {
    const entry: AuditLogEntry = {
      timestamp: this.getTimestamp(),
      event_type: "agent_execution",
      agent_name: record.agent_name,
      pipeline_steps: record.pipeline_steps,
      result_status: record.result_status,
      duration_ms: record.duration_ms,
      policy_level: record.policy_level || this.defaultPolicyLevel,
      trace_id: record.trace_id,
    };

    if (record.error_message) {
      entry.error_message = record.error_message;
    }

    this.write(entry);
  }

  /**
   * Log a policy violation event
   */
  logPolicyViolation(record: PolicyViolationRecord): void {
    const entry: AuditLogEntry = {
      timestamp: this.getTimestamp(),
      event_type: "policy_violation",
      agent_name: record.agent_name,
      violation_type: record.violation_type,
      details: record.details,
      policy_level: record.policy_level || this.defaultPolicyLevel,
      trace_id: record.trace_id,
    };

    this.write(entry);
  }

  /**
   * Sanitize arguments to remove sensitive data
   */
  private sanitizeArguments(
    args: Record<string, unknown>
  ): Record<string, unknown> {
    const sensitiveKeys = [
      "password",
      "token",
      "secret",
      "api_key",
      "apikey",
      "auth",
      "credential",
      "private_key",
    ];

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
        sanitized[key] = "***REDACTED***";
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = this.sanitizeArguments(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Get the current log file path
   */
  getCurrentLogFile(): string | null {
    return this.currentFile;
  }

  /**
   * Read audit logs for a specific date
   */
  readLogs(date?: string): AuditLogEntry[] {
    const targetDate = date || new Date().toISOString().split("T")[0];
    const filePath = path.join(this.logDir, `audit-${targetDate}.jsonl`);

    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((entry): entry is AuditLogEntry => entry !== null);
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flushSync();
  }
}
