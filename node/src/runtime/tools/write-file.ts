import * as fs from "fs";
import * as path from "path";
import { Tool } from "../pipeline.js";
import { ExecutionContext } from "../types.js";
import { getPolicyRegistry } from "../policy.js";

/**
 * Write file tool
 * Writes text content to a file with policy enforcement
 */
export class WriteFileTool implements Tool {
  name = "write_file";

  async execute(
    args: {
      path: string;
      content: string;
      mode?: "overwrite" | "append";
      create_dirs?: boolean;
      encoding?: string;
    },
    context: ExecutionContext
  ): Promise<{
    path: string;
    bytes_written: number;
  }> {
    // Validate args
    if (!args.path) {
      throw new Error("write_file: 'path' parameter is required");
    }

    if (args.content === undefined || args.content === null) {
      throw new Error("write_file: 'content' parameter is required");
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
          `write_file: Path '${filePath}' is in a blocked path. ` +
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
          `write_file: Path '${filePath}' is outside allowed paths. ` +
          `Agent '${agentName}' is restricted to: ${policy.allowedPaths.join(", ")}`
        );
      }
    }

    // Create parent directories if requested
    const createDirs = args.create_dirs !== false; // Default true
    if (createDirs) {
      const dirPath = path.dirname(filePath);
      if (!fs.existsSync(dirPath)) {
        try {
          fs.mkdirSync(dirPath, { recursive: true });
        } catch (error) {
          throw new Error(
            `write_file: Failed to create directory: ${(error as Error).message}`
          );
        }
      }
    }

    // Determine write mode
    const mode = args.mode || "overwrite";
    const encoding = (args.encoding || "utf-8") as BufferEncoding;

    try {
      let bytesWritten: number;

      if (mode === "append") {
        // Append mode
        fs.appendFileSync(filePath, args.content, { encoding });
        const stats = fs.statSync(filePath);
        bytesWritten = stats.size;
      } else {
        // Overwrite mode
        fs.writeFileSync(filePath, args.content, { encoding });
        const stats = fs.statSync(filePath);
        bytesWritten = stats.size;
      }

      return {
        path: filePath,
        bytes_written: bytesWritten,
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "EACCES" || err.code === "EPERM") {
        throw new Error(
          `write_file: Permission denied: ${filePath}`
        );
      } else if (err.code === "ENOSPC") {
        throw new Error(
          `write_file: No space left on device: ${filePath}`
        );
      } else {
        throw new Error(
          `write_file: Failed to write file: ${err.message}`
        );
      }
    }
  }
}
