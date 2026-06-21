import { spawn } from "child_process";
import { Tool } from "../pipeline.js";
import { ExecutionContext } from "../types.js";
import { getPolicyRegistry, DANGEROUS_COMMAND_PATTERNS } from "../policy.js";
import { SandboxRuntime, SandboxOptions, createSandbox, SandboxConfig } from "../sandbox.js";

/**
 * Bash tool
 * Executes shell commands with policy enforcement
 */
export class BashTool implements Tool {
  name = "bash";
  private sandbox?: SandboxRuntime;
  private sandboxConfig?: SandboxConfig;

  constructor(sandboxConfig?: SandboxConfig) {
    if (sandboxConfig?.enabled && sandboxConfig.runtime) {
      this.sandboxConfig = sandboxConfig;
      this.sandbox = createSandbox(sandboxConfig.runtime);
    }
  }

  async execute(
    args: {
      command: string;
      timeout?: number;
      cwd?: string;
      env?: Record<string, string>;
    },
    context: ExecutionContext
  ): Promise<{
    stdout: string;
    stderr: string;
    exit_code: number;
    duration_ms: number;
  }> {
    if (!args.command) {
      throw new Error("bash: 'command' parameter is required");
    }

    // Policy check
    const agentName = context.agent?.identity?.name || context.agent?.name || "unknown";
    const policy = getPolicyRegistry().get(agentName);
    if (!policy.allowBash) {
      throw new Error(
        `bash: Shell execution is blocked by security policy. ` +
        `Agent '${agentName}' policy level: ${policy.level}. ` +
        `Use --policy-level trusted to allow bash execution.`
      );
    }

    // Dangerous command check (always enforced, even in trusted mode)
    for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
      if (pattern.test(args.command)) {
        throw new Error(
          `bash: Command blocked by security policy: dangerous pattern detected.`
        );
      }
    }

    const timeout = Math.min(
      args.timeout || policy.maxExecutionTime,
      policy.maxExecutionTime
    );
    const cwd = args.cwd || context.cwd || process.cwd();
    const env = { ...context.env, ...(args.env || {}) };

    // Use sandbox if configured and policy level is trusted
    if (this.sandbox && this.sandboxConfig && policy.level === "trusted") {
      const sandboxOptions: SandboxOptions = {
        image: this.sandboxConfig.default_image || "node:20-alpine",
        workDir: cwd,
        env,
        cpuLimit: this.sandboxConfig.resources?.cpu || "1.0",
        memoryLimit: this.sandboxConfig.resources?.memory || "512m",
        network: this.sandboxConfig.resources?.network || "none",
        timeoutMs: timeout,
      };

      const result = await this.sandbox.execute(args.command, sandboxOptions);
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
        duration_ms: result.durationMs,
      };
    }

    // Fallback to local execution
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      // Use platform-appropriate shell
      const isWindows = process.platform === "win32";
      const shell = isWindows ? "cmd" : "bash";
      const shellFlag = isWindows ? "/c" : "-c";

      const child = spawn(shell, [shellFlag, args.command], {
        cwd,
        env,
        timeout,
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("close", (code: number | null) => {
        const duration = Date.now() - startTime;
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exit_code: code ?? -1,
          duration_ms: duration,
        });
      });

      child.on("error", (error: Error) => {
        reject(new Error(`bash: Failed to execute command: ${error.message}`));
      });
    });
  }

  /**
   * Clean up sandbox resources
   */
  async cleanup(): Promise<void> {
    if (this.sandbox) {
      await this.sandbox.cleanup();
    }
  }
}
