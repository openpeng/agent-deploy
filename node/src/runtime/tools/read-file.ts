import * as fs from "fs";
import * as path from "path";
import { Tool } from "../pipeline.js";
import { ExecutionContext } from "../types.js";
import { getPolicyRegistry } from "../policy.js";

/**
 * Read file tool
 * Reads text content from a file with policy enforcement
 */
export class ReadFileTool implements Tool {
  name = "read_file";

  async execute(
    args: {
      path: string;
      encoding?: string;
      max_size?: number;
    },
    context: ExecutionContext
  ): Promise<string> {
    // Validate args
    if (!args.path) {
      throw new Error("read_file: 'path' parameter is required");
    }

    // Resolve path (relative to cwd or absolute)
    const filePath = path.isAbsolute(args.path)
      ? args.path
      : path.resolve(context.cwd, args.path);

    const agentName = context.agent?.identity?.name || context.agent?.name || "unknown";
    const policy = getPolicyRegistry().get(agentName);

    // Security: check blocked paths
    if (policy.blockedPaths.length > 0) {
      const resolved = path.resolve(filePath);
      const blocked = policy.blockedPaths.some((p) =>
        resolved.startsWith(path.resolve(p))
      );
      if (blocked) {
        throw new Error(
          `read_file: Path '${filePath}' is in a blocked path. ` +
          `Agent '${agentName}' cannot access blocked paths.`
        );
      }
    }

    // Security: check allowed paths
    if (policy.allowedPaths.length > 0) {
      const resolved = path.resolve(filePath);
      const allowed = policy.allowedPaths.some((p) =>
        resolved.startsWith(path.resolve(p))
      );
      if (!allowed) {
        throw new Error(
          `read_file: Path '${filePath}' is outside allowed paths. ` +
          `Agent '${agentName}' is restricted to: ${policy.allowedPaths.join(", ")}`
        );
      }
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`read_file: File not found: ${filePath}`);
    }

    // Check if it's a file (not directory)
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      throw new Error(`read_file: Path is not a file: ${filePath}`);
    }

    // Check file size against policy
    const maxSize = Math.min(
      args.max_size || policy.maxFileSize,
      policy.maxFileSize
    );
    if (stats.size > maxSize) {
      throw new Error(
        `read_file: File size (${stats.size} bytes) exceeds max_size (${maxSize} bytes): ${filePath}`
      );
    }

    // Read file
    const encoding = (args.encoding || "utf-8") as BufferEncoding;
    try {
      const content = fs.readFileSync(filePath, { encoding });
      return content;
    } catch (error) {
      throw new Error(
        `read_file: Failed to read file: ${(error as Error).message}`
      );
    }
  }
}
