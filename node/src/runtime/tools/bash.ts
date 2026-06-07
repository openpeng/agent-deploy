import { execSync } from "child_process";
import { Tool } from "../pipeline.js";
import { ExecutionContext } from "../types.js";

/**
 * Bash tool
 * Executes shell commands
 */
export class BashTool implements Tool {
  name = "bash";

  async execute(
    args: {
      command: string;
      cwd?: string;
      timeout?: number;
      env?: Record<string, string>;
    },
    context: ExecutionContext
  ): Promise<{
    stdout: string;
    stderr: string;
    exit_code: number;
    duration_ms: number;
  }> {
    // Validate args
    if (!args.command) {
      throw new Error("bash: 'command' parameter is required");
    }

    // Determine working directory
    const cwd = args.cwd || context.cwd;

    // Merge environment variables
    const env = {
      ...context.env,
      ...(args.env || {}),
    };

    // Timeout (default 2 minutes)
    const timeout = args.timeout || 120000;

    const startTime = Date.now();

    try {
      // Execute command
      const stdout = execSync(args.command, {
        cwd,
        env,
        timeout,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
      });

      const duration = Date.now() - startTime;

      return {
        stdout: stdout || "",
        stderr: "",
        exit_code: 0,
        duration_ms: duration,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;

      // Handle timeout - check both killed flag and error code
      if (error.killed || (error.code === "ETIMEDOUT")) {
        throw new Error(
          `bash: Command timed out after ${timeout}ms: ${args.command}`
        );
      }

      // Handle non-zero exit code
      const stdout = error.stdout ? error.stdout.toString("utf-8") : "";
      const stderr = error.stderr ? error.stderr.toString("utf-8") : "";
      const exitCode = error.status !== undefined ? error.status : 1;

      // For non-zero exit codes, return the result instead of throwing
      if (exitCode !== 0) {
        return {
          stdout,
          stderr,
          exit_code: exitCode,
          duration_ms: duration,
        };
      }

      // For other errors, throw
      throw new Error(
        `bash: Command failed: ${error.message}`
      );
    }
  }
}
