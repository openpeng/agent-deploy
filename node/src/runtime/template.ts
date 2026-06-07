import { ExecutionContext, ExecutionContextManager } from "./context.js";

/**
 * Template variable resolver
 * Resolves {{variable}} syntax in strings, objects, and arrays
 */
export class TemplateResolver {
  /**
   * Resolve template variables in any value
   */
  resolve(template: any, context: ExecutionContext): any {
    if (typeof template === "string") {
      return this.resolveString(template, context);
    } else if (Array.isArray(template)) {
      return template.map((item) => this.resolve(item, context));
    } else if (typeof template === "object" && template !== null) {
      const result: any = {};
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
  private resolveString(str: string, context: ExecutionContext): any {
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
   * - {{var}} → context.initialArgs.var
   * - {{steps.step_name.output}} → context.steps.get('step_name').output
   * - {{steps.step_name.success}} → context.steps.get('step_name').success
   * - {{shared_context.key}} → context.sharedContext.key
   * - {{env.VAR}} → context.env.VAR
   */
  private resolveVariable(varPath: string, context: ExecutionContext): any {
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
  private resolveStepPath(parts: string[], context: ExecutionContext): any {
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
    switch (field) {
      case "output":
        return result.output;
      case "success":
        return result.success;
      case "error":
        return result.error;
      case "duration_ms":
        return result.duration_ms;
      default:
        return undefined;
    }
  }

  /**
   * Resolve shared_context.* path
   */
  private resolveSharedContextPath(
    parts: string[],
    context: ExecutionContext
  ): any {
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
  private resolveEnvPath(parts: string[], context: ExecutionContext): any {
    // {{env.VAR}}
    if (parts.length < 2) return undefined;
    return ExecutionContextManager.getEnv(context, parts[1]);
  }

  /**
   * Resolve initial args path
   */
  private resolveInitialArgsPath(
    parts: string[],
    context: ExecutionContext
  ): any {
    // {{var}} or {{obj.nested.field}}
    const value = context.initialArgs[parts[0]];

    // Support nested path like {{obj.nested.field}}
    if (parts.length > 1 && value && typeof value === "object") {
      return this.resolveNestedPath(value, parts.slice(1));
    }

    return value;
  }

  /**
   * Resolve nested path in an object
   */
  private resolveNestedPath(obj: any, parts: string[]): any {
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
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
    let match;

    while ((match = pattern.exec(str)) !== null) {
      matches.push(match[1].trim());
    }

    return matches;
  }
}
