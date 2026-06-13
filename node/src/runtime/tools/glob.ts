import { glob } from "glob";
import * as path from "path";
import { Tool } from "../pipeline.js";
import { ExecutionContext } from "../types.js";

/**
 * Glob tool
 * Matches files using glob patterns
 */
export class GlobTool implements Tool {
  name = "glob";

  async execute(
    args: {
      pattern: string;
      cwd?: string;
      max_results?: number;
      ignore?: string[];
    },
    context: ExecutionContext
  ): Promise<string[]> {
    // Validate args
    if (!args.pattern) {
      throw new Error("glob: 'pattern' parameter is required");
    }

    // Determine working directory
    const cwd = args.cwd || context.cwd;

    // Prepare glob options
    const options: any = {
      cwd,
      nodir: true, // Only match files, not directories
      absolute: false, // Return relative paths
      ignore: args.ignore || [],
    };

    try {
      // Execute glob
      let matches = await glob(args.pattern, options);

      // Apply max_results limit
      if (args.max_results !== undefined && args.max_results > 0) {
        matches = matches.slice(0, args.max_results);
      }

      // Convert to absolute paths for consistency
      const absolutePaths = matches.map((match) =>
        path.resolve(cwd, match)
      );

      return absolutePaths;
    } catch (error) {
      throw new Error(
        `glob: Failed to match pattern: ${(error as Error).message}`
      );
    }
  }
}
