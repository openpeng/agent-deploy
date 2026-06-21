import { ExecutionContext } from "./types.js";
import { ExecutionContextManager } from "./context.js";

/**
 * Template variable resolver
 * Resolves {{variable}} syntax in strings, objects, and arrays
 */
export class TemplateResolver {
  /**
   * Resolve template variables in any value
   */
  resolve(template: unknown, context: ExecutionContext): unknown {
    if (typeof template === "string") {
      return this.resolveString(template, context);
    } else if (Array.isArray(template)) {
      return template.map((item) => this.resolve(item, context));
    } else if (typeof template === "object" && template !== null) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(template)) {
        result[key] = this.resolve(value, context);
      }
      return result;
    }
    return template;
  }

  /**
   * Resolve template variables in a string
   */
  private resolveString(str: string, context: ExecutionContext): unknown {
    // Pattern: {{variable}}
    const pattern = /\{\{([^}]+)\}\}/g;

    // Check if the entire string is a single variable reference
    const singleVarMatch = str.match(/^\{\{([^}]+)\}\}$/);
    if (singleVarMatch) {
      const varPath = singleVarMatch[1].trim();
      const value = this.resolveVariable(varPath, context);
      return value; // Return as-is to preserve type
    }

    // Replace all variables in the string
    return str.replace(pattern, (match, varPath) => {
      const value = this.resolveVariable(varPath.trim(), context);
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Resolve a variable path
   *
   * Supported paths:
   * - {{var}} -> context.initialArgs.var
   * - {{steps.step_name.output}} -> context.steps.get('step_name').output
   * - {{steps.step_name.success}} -> context.steps.get('step_name').success
   * - {{shared_context.key}} -> context.sharedContext.key
   * - {{env.VAR}} -> context.env.VAR
   */
  private resolveVariable(varPath: string, context: ExecutionContext): unknown {
    const parts = varPath.split(".");

    if (parts[0] === "steps") {
      return this.resolveStepPath(parts, context);
    } else if (parts[0] === "shared_context") {
      return this.resolveSharedContextPath(parts, context);
    } else if (parts[0] === "env") {
      return this.resolveEnvPath(parts, context);
    } else {
      // Direct reference to initial args: {{var}}
      return this.resolveInitialArgsPath(parts, context);
    }
  }

  /**
   * Resolve steps.* path
   */
  private resolveStepPath(parts: string[], context: ExecutionContext): unknown {
    // {{steps.step_name.output}} or {{steps.step_name.success}}
    if (parts.length < 2) return undefined;

    const stepName = parts[1];
    const result = ExecutionContextManager.getStepResult(context, stepName);

    if (!result) return undefined;

    if (parts.length === 2) {
      // {{steps.step_name}} returns the whole StepResult
      return result;
    }

    // Access specific field
    const field = parts[2];
    let value: unknown;
    switch (field) {
      case "output":
        value = result.output;
        break;
      case "success":
        value = result.success;
        break;
      case "error":
        value = result.error;
        break;
      case "duration_ms":
        value = result.duration_ms;
        break;
      default:
        return undefined;
    }

    // Support deeper nested access: {{steps.stepname.output.field.subfield}}
    for (let i = 3; i < parts.length && value !== undefined && value !== null; i++) {
      if (typeof value === "object") {
        value = (value as Record<string, unknown>)[parts[i]];
      } else {
        return undefined;
      }
    }
    return value;
  }

  /**
   * Resolve shared_context.* path
   */
  private resolveSharedContextPath(
    parts: string[],
    context: ExecutionContext
  ): unknown {
    // {{shared_context.key}}
    if (parts.length < 2) return undefined;

    const key = parts[1];
    const value = ExecutionContextManager.getShared(context, key);

    // Support nested path like {{shared_context.obj.nested}}
    if (parts.length > 2 && value && typeof value === "object") {
      return this.resolveNestedPath(value, parts.slice(2));
    }

    return value;
  }

  /**
   * Resolve env.* path
   */
  private resolveEnvPath(parts: string[], context: ExecutionContext): unknown {
    // {{env.VAR}}
    if (parts.length < 2) return undefined;
    return ExecutionContextManager.getEnv(context, parts[1]);
  }

  /**
   * Resolve initial args path, with fallback to sharedContext
   */
  private resolveInitialArgsPath(
    parts: string[],
    context: ExecutionContext
  ): unknown {
    // {{var}} or {{obj.nested.field}}
    const value = context.initialArgs[parts[0]];

    // Support nested path like {{obj.nested.field}}
    if (parts.length > 1 && value && typeof value === "object") {
      return this.resolveNestedPath(value, parts.slice(1));
    }

    // Fallback: check sharedContext for bare {{key}} references
    if (value === undefined && parts.length === 1) {
      return context.sharedContext[parts[0]];
    }

    return value;
  }

  /**
   * Resolve nested path in an object
   */
  private resolveNestedPath(obj: unknown, parts: string[]): unknown {
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  /**
   * Check if a string contains template variables
   */
  hasTemplateVars(str: string): boolean {
    return /\{\{[^}]+\}\}/.test(str);
  }

  /**
   * Extract all variable paths from a string
   */
  extractVariablePaths(str: string): string[] {
    const pattern = /\{\{([^}]+)\}\}/g;
    const matches: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(str)) !== null) {
      matches.push(match[1].trim());
    }

    return matches;
  }
}
