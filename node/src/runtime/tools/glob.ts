import { glob as globFn } from "glob";
import { Tool } from "../pipeline.js";
import { ExecutionContext } from "../types.js";

/**
 * Glob tool
 * Finds files matching glob patterns
 */
export class GlobTool implements Tool {
  name = "glob";

  async execute(
    args: {
      pattern: string;
      cwd?: string;
      ignore?: string[];
      absolute?: boolean;
    },
    context: ExecutionContext
  ): Promise<{
    files: string[];
    pattern: string;
    count: number;
  }> {
    if (!args.pattern) {
      throw new Error("glob: 'pattern' parameter is required");
    }

    const cwd = args.cwd || context.cwd || process.cwd();

    const files = await globFn(args.pattern, {
      cwd,
      ignore: args.ignore || ["**/node_modules/**", "**/.git/**"],
      absolute: args.absolute !== false,
    });

    return {
      files,
      pattern: args.pattern,
      count: files.length,
    };
  }
}
