import {
  WorkerYaml,
  PipelineStep,
  ExecutionContext,
  StepResult,
  OnFailStrategy,
} from "./types.js";
import { ExecutionContextManager } from "./context.js";
import { TemplateResolver } from "./template.js";
import { ToolRegistry } from "./tool-registry.js";

/**
 * Tool interface for pipeline execution
 */
export interface Tool {
  name: string;
  execute(args: any, context: ExecutionContext): Promise<any>;
}

// Re-export ToolRegistry for backward compatibility
export { ToolRegistry };

/**
 * Simple logger interface
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: Error): void;
  debug(message: string): void;
}

/**
 * Console logger implementation
 */
export class ConsoleLogger implements Logger {
  constructor(private verbose: boolean = false) {}

  info(message: string): void {
    console.log(`[INFO] ${message}`);
  }

  warn(message: string): void {
    console.warn(`[WARN] ${message}`);
  }

  error(message: string, error?: Error): void {
    console.error(`[ERROR] ${message}`, error);
  }

  debug(message: string): void {
    if (this.verbose) {
      console.log(`[DEBUG] ${message}`);
    }
  }
}

/**
 * Pipeline execution engine
 */
export class PipelineEngine {
  private templateResolver: TemplateResolver;

  constructor(
    private toolRegistry: ToolRegistry,
    private logger: Logger = new ConsoleLogger()
  ) {
    this.templateResolver = new TemplateResolver();
  }

  /**
   * Execute a pipeline
   */
  async execute(
    yaml: WorkerYaml,
    context: ExecutionContext
  ): Promise<any> {
    this.logger.debug(`Starting pipeline execution with ${yaml.pipeline.length} steps`);

    // Initialize shared context from yaml
    if (yaml.shared_context) {
      for (const [key, value] of Object.entries(yaml.shared_context)) {
        ExecutionContextManager.setShared(context, key, value);
      }
    }

    // Execute each step
    for (const step of yaml.pipeline) {
      this.logger.debug(`Executing step: ${step.step}`);

      // Check condition
      if (step.when && !this.evaluateCondition(step.when, context)) {
        this.logger.debug(`Step '${step.step}' skipped by condition: ${step.when}`);
        continue;
      }

      // Resolve template variables in args
      const resolvedArgs = this.templateResolver.resolve(step.args || {}, context);

      // Execute step
      const result = await this.executeStep(step, resolvedArgs, context);

      // If step failed, handle the error
      if (!result.success && result.error) {
        const handled = await this.handleError(step, result.error, context);
        if (!handled) {
          throw result.error;
        }
      } else {
        // Store result for successful steps
        ExecutionContextManager.setStepResult(context, step.step, result);

        // Store output in shared context if specified
        if (step.output && result.success) {
          ExecutionContextManager.setShared(context, step.output, result.output);
        }
      }
    }

    return this.getFinalResult(context);
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: PipelineStep,
    args: any,
    context: ExecutionContext
  ): Promise<StepResult> {
    const tool = this.toolRegistry.get(step.tool);
    if (!tool) {
      throw new Error(`Tool not found: ${step.tool}`);
    }

    const startTime = Date.now();
    try {
      this.logger.debug(`Calling tool '${step.tool}' with args: ${JSON.stringify(args)}`);
      const output = await tool.execute(args, context);
      const duration = Date.now() - startTime;

      this.logger.debug(`Step '${step.step}' completed in ${duration}ms`);
      return {
        output,
        success: true,
        duration_ms: duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Step '${step.step}' failed: ${(error as Error).message}`, error as Error);

      // Return failed result instead of throwing
      return {
        output: null,
        success: false,
        error: error as Error,
        duration_ms: duration,
      };
    }
  }

  /**
   * Evaluate a condition string
   */
  private evaluateCondition(condition: string, context: ExecutionContext): boolean {
    try {
      // Replace template variables
      const resolved = this.templateResolver.resolve(condition, context);

      // Simple evaluation: check if it's a truthy value
      if (typeof resolved === "boolean") {
        return resolved;
      }

      if (typeof resolved === "string") {
        // Handle common string patterns
        if (resolved === "true") return true;
        if (resolved === "false") return false;
        if (resolved === "") return false;
        return true; // Non-empty string is truthy
      }

      // Other types
      return !!resolved;
    } catch (error) {
      this.logger.warn(`Failed to evaluate condition '${condition}': ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Handle step execution error
   */
  private async handleError(
    step: PipelineStep,
    error: Error,
    context: ExecutionContext
  ): Promise<boolean> {
    const strategy = step.on_fail || "abort";

    if (typeof strategy === "string") {
      switch (strategy) {
        case "abort":
          this.logger.error(`Step '${step.step}' failed, aborting pipeline`, error);
          return false; // Don't handle, let it throw

        case "skip":
          this.logger.warn(`Step '${step.step}' failed, skipping (on_fail: skip)`);
          ExecutionContextManager.setStepResult(context, step.step, {
            output: null,
            success: false,
            error,
            duration_ms: 0,
          });
          return true; // Handled

        case "continue":
          this.logger.warn(`Step '${step.step}' failed, continuing (on_fail: continue)`);
          ExecutionContextManager.setStepResult(context, step.step, {
            output: null,
            success: false,
            error,
            duration_ms: 0,
          });
          return true; // Handled

        default:
          return false;
      }
    } else if (typeof strategy === "object" && "retry" in strategy) {
      // Retry strategy
      const retries = strategy.retry;
      this.logger.info(`Step '${step.step}' failed, retrying ${retries} times`);

      for (let i = 0; i < retries; i++) {
        this.logger.debug(`Retry attempt ${i + 1}/${retries} for step '${step.step}'`);

        const resolvedArgs = this.templateResolver.resolve(step.args || {}, context);
        const result = await this.executeStep(step, resolvedArgs, context);

        if (result.success) {
          this.logger.info(`Step '${step.step}' succeeded on retry ${i + 1}`);
          ExecutionContextManager.setStepResult(context, step.step, result);

          if (step.output) {
            ExecutionContextManager.setShared(context, step.output, result.output);
          }
          return true; // Handled successfully
        }

        // If last retry also failed
        if (i === retries - 1) {
          this.logger.error(`Step '${step.step}' failed after ${retries} retries`, result.error);
          return false;
        }
      }
    }

    return false;
  }

  /**
   * Get final result from context
   */
  private getFinalResult(context: ExecutionContext): any {
    const summary = ExecutionContextManager.getSummary(context);

    // Find the last successful step's output
    const stepNames = ExecutionContextManager.getStepNames(context);
    for (let i = stepNames.length - 1; i >= 0; i--) {
      const result = ExecutionContextManager.getStepResult(context, stepNames[i]);
      if (result?.success) {
        return result.output;
      }
    }

    // If no successful steps, return the summary
    return {
      success: summary.failed_steps === 0,
      summary,
    };
  }
}
