import { spawn } from "child_process";
import * as crypto from "crypto";

/**
 * Sandbox runtime options for containerized command execution
 */
export interface SandboxOptions {
  /** Container image to use */
  image: string;
  /** Working directory inside the container */
  workDir: string;
  /** Environment variables to pass to the container */
  env: Record<string, string>;
  /** CPU limit (e.g. "1.0") */
  cpuLimit: string;
  /** Memory limit (e.g. "512m") */
  memoryLimit: string;
  /** Network mode: none or bridge */
  network: "none" | "bridge";
  /** Timeout in milliseconds */
  timeoutMs: number;
}

/**
 * Result of a sandboxed command execution
 */
export interface SandboxResult {
  /** Exit code of the command */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Execution duration in milliseconds */
  durationMs: number;
}

/**
 * Sandbox runtime abstraction for executing commands in isolated containers
 */
export interface SandboxRuntime {
  /**
   * Execute a command inside a sandboxed container
   */
  execute(command: string, options: SandboxOptions): Promise<SandboxResult>;

  /**
   * Clean up any resources held by the sandbox runtime
   */
  cleanup(): Promise<void>;
}

/**
 * Sandbox configuration from policy.yaml
 */
export interface SandboxConfig {
  /** Whether sandbox is enabled */
  enabled: boolean;
  /** Runtime type: docker | gvisor | firecracker */
  runtime: string;
  /** Default container image */
  default_image: string;
  /** Resource limits */
  resources: {
    cpu: string;
    memory: string;
    network: "none" | "bridge";
  };
}

/**
 * Docker-based sandbox implementation using docker CLI
 */
export class DockerSandbox implements SandboxRuntime {
  private activeContainers = new Set<string>();
  private cleanedUp = false;

  /**
   * Execute a command in a Docker container with resource limits
   */
  async execute(command: string, options: SandboxOptions): Promise<SandboxResult> {
    if (this.cleanedUp) {
      throw new Error("DockerSandbox: already cleaned up, cannot execute new commands");
    }

    const containerName = `agent-deploy-${crypto.randomBytes(8).toString("hex")}`;
    this.activeContainers.add(containerName);

    const startTime = Date.now();

    try {
      const args = this.buildDockerArgs(containerName, options);
      const dockerCmd = ["run", "--rm", ...args, options.image, "sh", "-c", command];

      return await this.runDocker(dockerCmd, options.timeoutMs);
    } finally {
      this.activeContainers.delete(containerName);
    }
  }

  /**
   * Build docker run arguments from sandbox options
   */
  private buildDockerArgs(containerName: string, options: SandboxOptions): string[] {
    const args: string[] = [
      "--name", containerName,
      "--network", options.network,
      "--cpus", options.cpuLimit,
      "--memory", options.memoryLimit,
      "--memory-swap", options.memoryLimit,
      "-w", options.workDir,
    ];

    // Add environment variables
    for (const [key, value] of Object.entries(options.env)) {
      args.push("-e", `${key}=${value}`);
    }

    // Security options
    args.push("--security-opt", "no-new-privileges:true");
    args.push("--cap-drop", "ALL");

    return args;
  }

  /**
   * Spawn docker CLI and collect output
   */
  private runDocker(args: string[], timeoutMs: number): Promise<SandboxResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const child = spawn("docker", args, {
        timeout: timeoutMs,
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
          exitCode: code ?? -1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          durationMs: duration,
        });
      });

      child.on("error", (error: Error) => {
        reject(new Error(`DockerSandbox: failed to execute docker: ${error.message}`));
      });
    });
  }

  /**
   * Clean up any running containers created by this sandbox instance
   */
  async cleanup(): Promise<void> {
    if (this.cleanedUp) return;
    this.cleanedUp = true;

    const containers = Array.from(this.activeContainers);
    if (containers.length === 0) return;

    // Force remove any still-running containers
    await Promise.all(
      containers.map(async (name) => {
        try {
          await this.runDocker(["kill", "--force", name], 10000);
        } catch {
          // Ignore errors during cleanup
        }
        try {
          await this.runDocker(["rm", "--force", name], 10000);
        } catch {
          // Ignore errors during cleanup
        }
      })
    );

    this.activeContainers.clear();
  }
}

/**
 * Factory to create sandbox runtime based on configuration
 */
export function createSandbox(runtime: string): SandboxRuntime {
  switch (runtime) {
    case "docker":
      return new DockerSandbox();
    default:
      throw new Error(`Sandbox runtime '${runtime}' is not supported. Available: docker`);
  }
}
