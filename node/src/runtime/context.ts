import { ExecutionContext, StepResult } from "./types.js";

/**
 * Manages execution context for pipeline execution
 */
export class ExecutionContextManager {
  /**
   * Create a new execution context
   */
  static create(options: {
    agent: any;
    initialArgs: Record<string, any>;
    cwd?: string;
    env?: Record<string, string>;
  }): ExecutionContext {
    return {
      agent: options.agent,
      initialArgs: options.initialArgs,
      sharedContext: {},
      steps: new Map<string, StepResult>(),
      env: options.env || (process.env as Record<string, string>),
      cwd: options.cwd || process.cwd(),
    };
  }

  /**
   * Store a step result
   */
  static setStepResult(
    context: ExecutionContext,
    stepName: string,
    result: StepResult
  ): void {
    context.steps.set(stepName, result);
  }

  /**
   * Get a step result
   */
  static getStepResult(
    context: ExecutionContext,
    stepName: string
  ): StepResult | undefined {
    return context.steps.get(stepName);
  }

  /**
   * Check if a step has been executed
   */
  static hasStep(context: ExecutionContext, stepName: string): boolean {
    return context.steps.has(stepName);
  }

  /**
   * Get all step names
   */
  static getStepNames(context: ExecutionContext): string[] {
    return Array.from(context.steps.keys());
  }

  /**
   * Set a value in shared context
   */
  static setShared(
    context: ExecutionContext,
    key: string,
    value: any
  ): void {
    context.sharedContext[key] = value;
  }

  /**
   * Get a value from shared context
   */
  static getShared(context: ExecutionContext, key: string): any {
    return context.sharedContext[key];
  }

  /**
   * Check if a key exists in shared context
   */
  static hasShared(context: ExecutionContext, key: string): boolean {
    return key in context.sharedContext;
  }

  /**
   * Get an environment variable
   */
  static getEnv(context: ExecutionContext, key: string): string | undefined {
    return context.env[key];
  }

  /**
   * Get all environment variables
   */
  static getAllEnv(context: ExecutionContext): Record<string, string> {
    return { ...context.env };
  }

  /**
   * Get the working directory
   */
  static getCwd(context: ExecutionContext): string {
    return context.cwd;
  }

  /**
   * Get the agent
   */
  static getAgent(context: ExecutionContext): any {
    return context.agent;
  }

  /**
   * Get initial arguments
   */
  static getInitialArgs(context: ExecutionContext): Record<string, any> {
    return { ...context.initialArgs };
  }

  /**
   * Clone the context (useful for subagent execution)
   */
  static clone(context: ExecutionContext): ExecutionContext {
    return {
      agent: context.agent,
      initialArgs: { ...context.initialArgs },
      sharedContext: { ...context.sharedContext },
      steps: new Map(context.steps),
      env: { ...context.env },
      cwd: context.cwd,
    };
  }

  /**
   * Get execution summary
   */
  static getSummary(context: ExecutionContext): {
    total_steps: number;
    successful_steps: number;
    failed_steps: number;
    total_duration_ms: number;
  } {
    let successful = 0;
    let failed = 0;
    let totalDuration = 0;

    for (const result of context.steps.values()) {
      if (result.success) {
        successful++;
      } else {
        failed++;
      }
      totalDuration += result.duration_ms;
    }

    return {
      total_steps: context.steps.size,
      successful_steps: successful,
      failed_steps: failed,
      total_duration_ms: totalDuration,
    };
  }

  /**
   * Clear all step results (useful for retries)
   */
  static clearSteps(context: ExecutionContext): void {
    context.steps.clear();
  }

  /**
   * Reset shared context
   */
  static resetSharedContext(context: ExecutionContext): void {
    context.sharedContext = {};
  }
}
