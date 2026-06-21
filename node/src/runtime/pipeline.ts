import * as fs from "fs";
import * as path from "path";
import {
  WorkerYaml,
  PipelineStep,
  ExecutionContext,
  StepResult,
  OnFailStrategy,
  RetryConfig,
} from "./types.js";
import { ExecutionContextManager } from "./context.js";
import { TemplateResolver } from "./template.js";
import { ToolRegistry } from "./tool-registry.js";
import { invokeAgentTool } from "./builtin-tools/invoke-agent.js";
import { QuotaManager, QuotaOptions } from "./quota.js";
import { AuditLogger, AuditLoggerOptions } from "./audit.js";
import { getTracer, withContextAsync, deserializeTraceContext } from "../telemetry.js";
import { SpanStatusCode, context as otelContext } from "@opentelemetry/api";
import {
  recordPipelineStep,
  recordAgentExecution,
  recordQuotaExceeded,
  recordPolicyViolation,
} from "../metrics.js";

// Simple UUID v4 generator (no dependency needed)
function generateTraceId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * Tool interface for pipeline execution
 */
export interface Tool {
  name: string;
  execute(args: unknown, context: ExecutionContext): Promise<unknown>;
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

const pipelineTracer = getTracer("agent-deploy-pipeline");

/**
 * Pipeline execution engine
 */
export class PipelineEngine {
  private templateResolver: TemplateResolver;
  private quotaManager: QuotaManager;
  private auditLogger: AuditLogger;
  private pipelineStartTime: number = 0;

  constructor(
    private toolRegistry: ToolRegistry,
    private logger: Logger = new ConsoleLogger(),
    quotaOptions?: QuotaOptions,
    auditOptions?: AuditLoggerOptions
  ) {
    this.templateResolver = new TemplateResolver();
    this.quotaManager = new QuotaManager(quotaOptions);
    this.auditLogger = new AuditLogger(auditOptions);
  }

  /**
   * Execute parallel invocations — all sub-agents run concurrently.
   * Returns aggregated step result.
   */
  private async executeParallel(
    step: PipelineStep,
    context: ExecutionContext
  ): Promise<StepResult> {
    const invocations = step.invoke_parallel!;
    const startTime = Date.now();
    const results: Array<{ agent: string; success: boolean; output?: unknown; error?: string }> = [];

    const promises = invocations.map(async (inv) => {
      const expandedStep = this.expandInvokeShorthand({
        step: `${step.step}/${inv.agent}`,
        invoke: inv.agent,
        with: inv.with || {},
      });
      const resolvedArgs = this.templateResolver.resolve(expandedStep.args || {}, context);
      return this.executeStep(expandedStep, resolvedArgs, context);
    });

    // Map invocation index to agent name for result tracking
    const agentNames = invocations.map(inv => inv.agent);

    const settled = await Promise.allSettled(promises);

    let allSuccess = true;
    let firstError: Error | undefined;

    for (let i = 0; i < settled.length; i++) {
      const r = settled[i];
      const agentName = agentNames[i] || step.step;
      if (r.status === "fulfilled") {
        const sr = r.value;
        results.push({ agent: agentName, success: sr.success, output: sr.output, error: sr.error?.message });
        if (!sr.success) {
          allSuccess = false;
          if (!firstError && sr.error) firstError = sr.error;
        }
      } else {
        results.push({ agent: agentName, success: false, error: r.reason?.message });
        allSuccess = false;
        if (!firstError) firstError = r.reason;
      }
    }

    const duration = Date.now() - startTime;
    this.logger.info(`Parallel step '${step.step}' completed in ${duration}ms — ${results.filter(r => r.success).length}/${results.length} succeeded`);

    return {
      output: { agents: results, total: results.length, succeeded: results.filter(r => r.success).length },
      success: allSuccess,
      error: firstError,
      duration_ms: duration,
    };
  }

  /**
   * Apply result mapping (`as` field) to extract sub-agent output fields
   * into shared_context for downstream steps.
   *
   * worker.yaml:
   *   as:
   *     summary: "{{output.content}}"
   *     model:   "{{output.model}}"
   */
  private applyResultMapping(step: PipelineStep, result: StepResult, context: ExecutionContext): void {
    if (!step.as || !result.success) return;

    for (const [key, template] of Object.entries(step.as)) {
      const fakeContext = {
        output: result.output,
        result: result,
      };
      // Use template resolver in a context that has `output` as a variable
      try {
        const resolved = template.replace(/\{\{([^}]+)\}\}/g, (_match, path) => {
          const parts = path.trim().split(".");
          let value: unknown = fakeContext;
          for (const p of parts) {
            if (value && typeof value === "object") value = (value as Record<string, unknown>)[p];
            else return "";
          }
          return value !== undefined && value !== null ? String(value) : "";
        });
        ExecutionContextManager.setShared(context, key, resolved);
      } catch (e) {
        this.logger.warn(`Failed to resolve 'as' mapping for ${key}: ${template}`);
      }
    }
  }

  /**
   * Execute a pipeline with optional global timeout.
   */
  async execute(
    yaml: WorkerYaml,
    context: ExecutionContext,
    timeoutMs?: number
  ): Promise<unknown> {
    const effectiveTimeout = timeoutMs || 300000; // Default 5 min
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error("Pipeline timeout")), effectiveTimeout);

    // Track pipeline execution start
    this.pipelineStartTime = Date.now();
    const agentName = context.agent.name;

    // Restore OTel context from ExecutionContext if present
    const parentCtx = context.otelContext
      ? deserializeTraceContext(context.otelContext)
      : otelContext.active();

    return pipelineTracer.startActiveSpan(
      "pipeline.execute",
      {},
      parentCtx,
      async (pipelineSpan) => {
        pipelineSpan.setAttribute("pipeline.agent_name", agentName);
        pipelineSpan.setAttribute("pipeline.step_count", yaml.pipeline.length);
        if (context.trace_id) {
          pipelineSpan.setAttribute("pipeline.trace_id", context.trace_id);
        }

        try {
          // Generate trace_id for this execution
          if (!context.trace_id) context.trace_id = generateTraceId();

          // Start quota tracking for this agent
          this.quotaManager.trackExecution(agentName);

          this.logger.debug(`Starting pipeline execution with ${yaml.pipeline.length} steps`);

          // Initialize shared context from yaml
          if (yaml.shared_context) {
            for (const [key, value] of Object.entries(yaml.shared_context)) {
              ExecutionContextManager.setShared(context, key, value);
            }
          }

          // Execute each step
          for (const step of yaml.pipeline) {
            if (controller.signal.aborted) break;

            // Check quota limits before step execution
            this.quotaManager.checkLimits(context);

            // Check condition
            if (step.when && !this.evaluateCondition(step.when, context)) {
              this.logger.debug(`Step '${step.step}' skipped by condition: ${step.when}`);
              continue;
            }

            // Handle parallel invocation
            if (step.invoke_parallel && step.invoke_parallel.length > 0) {
              const result = await this.executeParallel(step, context);

              // Audit log for parallel execution
              this.auditLogger.logToolCall({
                agent_name: agentName,
                tool_name: step.step,
                arguments: { parallel: step.invoke_parallel.map((inv) => inv.agent) },
                result_status: result.success ? "success" : "failure",
                duration_ms: result.duration_ms,
                trace_id: context.trace_id,
              });

              recordPipelineStep(agentName, step.step, result.success ? "success" : "failure");

              if (!result.success && result.error) {
                const handled = await this.handleError(step, result.error, context);
                if (!handled) throw result.error;
              } else {
                ExecutionContextManager.setStepResult(context, step.step, result);
                if (step.output) {
                  ExecutionContextManager.setShared(context, step.output, result.output);
                }
                this.applyResultMapping(step, result, context);
              }
              continue;
            }

            // Expand `invoke` shorthand to `tool: invoke_agent + args: { agent, input }`
            const expandedStep = this.expandInvokeShorthand(step);

            this.logger.debug(`Executing step: ${expandedStep.step}`);

            // Resolve template variables in args
            const resolvedArgs = this.templateResolver.resolve(expandedStep.args || {}, context);

            // Audit log before tool execution
            this.auditLogger.logToolCall({
              agent_name: agentName,
              tool_name: expandedStep.tool || "unknown",
              arguments: (resolvedArgs as Record<string, unknown>) || {},
              result_status: "success",
              duration_ms: 0,
              trace_id: context.trace_id,
            });

            // Execute step (with step-level timeout if specified)
            const result = await this.executeStep(expandedStep, resolvedArgs, context);

            // Audit log after tool execution
            this.auditLogger.logToolCall({
              agent_name: agentName,
              tool_name: expandedStep.tool || "unknown",
              arguments: (resolvedArgs as Record<string, unknown>) || {},
              result_status: result.success ? "success" : "failure",
              duration_ms: result.duration_ms,
              error_message: result.error?.message,
              trace_id: context.trace_id,
            });

            recordPipelineStep(agentName, expandedStep.step, result.success ? "success" : "failure");

            // Check quota limits after step execution
            this.quotaManager.checkLimits(context);

            // Structured JSON log
            this.jsonLog(context.trace_id, expandedStep.step, result);

            // If step failed, handle the error
            if (!result.success && result.error) {
              const handled = await this.handleError(expandedStep, result.error, context);
              if (!handled) {
                throw result.error;
              }
            } else if (result.success) {
              // Store result for successful steps
              ExecutionContextManager.setStepResult(context, expandedStep.step, result);

              // Store output in shared context if specified
              if (expandedStep.output) {
                ExecutionContextManager.setShared(context, expandedStep.output, result.output);
              }

              // Apply result mapping for invoke steps
              this.applyResultMapping(step, result, context);
            }
          }

          const pipelineDuration = Date.now() - this.pipelineStartTime;

          // Log agent execution completion
          this.auditLogger.logAgentExecution({
            agent_name: agentName,
            pipeline_steps: yaml.pipeline.length,
            result_status: "success",
            duration_ms: pipelineDuration,
            trace_id: context.trace_id,
          });
          recordAgentExecution(agentName, "success");

          pipelineSpan.setStatus({ code: SpanStatusCode.OK });
          pipelineSpan.setAttribute("pipeline.duration_ms", pipelineDuration);

          // Log quota usage warnings if any
          const usage = this.quotaManager.getUsage(agentName);
          if (usage && usage.warnings.length > 0) {
            this.logger.warn(`Quota warnings for ${agentName}: ${usage.warnings.join("; ")}`);
          }

          return this.getFinalResult(context);
        } catch (error) {
          const pipelineDuration = Date.now() - this.pipelineStartTime;

          // Log agent execution failure
          this.auditLogger.logAgentExecution({
            agent_name: agentName,
            pipeline_steps: yaml.pipeline.length,
            result_status: "failure",
            duration_ms: pipelineDuration,
            error_message: (error as Error).message,
            trace_id: context.trace_id,
          });
          recordAgentExecution(agentName, "failure");

          pipelineSpan.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
          pipelineSpan.recordException(error as Error);
          pipelineSpan.setAttribute("pipeline.duration_ms", pipelineDuration);

          // Log quota exceeded as policy violation
          if ((error as Error).name === "QuotaExceededError") {
            this.auditLogger.logPolicyViolation({
              agent_name: agentName,
              violation_type: "quota_exceeded",
              details: { error: (error as Error).message },
              trace_id: context.trace_id,
            });
            const qe = error as { quotaType?: string };
            recordQuotaExceeded(agentName, qe.quotaType || "unknown");
            recordPolicyViolation(agentName, "quota", "quota_exceeded");
          }

          throw error;
        } finally {
          clearTimeout(timeoutId);

          // Stop quota tracking and flush audit logs
          this.quotaManager.stopExecution(agentName);
          this.auditLogger.flush();
        }
      }
    );
  }

  /**
   * Expand `invoke` shorthand to a full `invoke_agent` tool call.
   *
   * worker.yaml:
   *   - step: do_thing
   *     invoke: text-summarizer
   *     with:
   *       input_file: "data.md"
   *
   * Expands to:
   *   - step: do_thing
   *     tool: invoke_agent
   *     args:
   *       agent: "text-summarizer"
   *       input:
   *         input_file: "data.md"
   */
  private expandInvokeShorthand(step: PipelineStep): PipelineStep {
    if (!step.invoke) return step;

    return {
      step: step.step,
      tool: "invoke_agent",
      args: {
        agent: step.invoke,
        input: step.with || {},
      },
      output: step.output,
      when: step.when,
      on_fail: step.on_fail,
      timeout_ms: step.timeout_ms,
    };
  }

  /**
   * Register sub-agents from agent.json into the tool registry.
   * This makes all declared subagents callable via `invoke: name`
   * without needing to specify paths.
   */
  registerSubagents(agentDir: string, registry: ToolRegistry): void {
    const agentJsonPath = path.join(agentDir, "agent.json");
    if (!fs.existsSync(agentJsonPath)) return;

    try {
      const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
      const subagents = agentJson.subagents;
      if (!subagents || !Array.isArray(subagents)) return;

      for (const sa of subagents) {
        if (!sa.name || sa.name === "worker") continue; // Skip self-reference

        let agentPath = sa.path || "";
        if (agentPath && !path.isAbsolute(agentPath) && !agentPath.startsWith("market://")) {
          // Resolve relative to agentDir, but if path is a YAML file, use its parent dir
          const resolved = path.resolve(agentDir, agentPath);
          agentPath = fs.existsSync(path.join(resolved, "agent.json")) ? resolved
            : fs.existsSync(path.join(path.dirname(resolved), "agent.json")) ? path.dirname(resolved)
            : resolved;
        }

        // Register a wrapper that calls invoke_agent with the resolved path
        const toolName = `agent/${sa.name}`;
        const wrapper: Tool = {
          name: toolName,
          async execute(inputArgs: unknown, ctx: ExecutionContext) {
            return await invokeAgentTool.execute(
              { agent: agentPath, input: inputArgs },
              ctx
            );
          },
        };

        registry.register(wrapper);
        this.logger.debug(`Registered sub-agent: ${sa.name} → ${agentPath}`);
      }
    } catch (e) {
      this.logger.warn(`Failed to register subagents from ${agentDir}: ${(e as Error).message}`);
    }
  }

  private async executeStep(
    step: PipelineStep,
    args: unknown,
    context: ExecutionContext
  ): Promise<StepResult> {
    const tool = this.toolRegistry.get(step.tool || "");
    if (!tool) {
      return {
        output: null,
        success: false,
        error: new Error(`Tool not found: ${step.tool}`),
        duration_ms: 0,
      };
    }

    const startTime = Date.now();

    return pipelineTracer.startActiveSpan(
      `pipeline.step.${step.step}`,
      async (stepSpan) => {
        stepSpan.setAttribute("step.name", step.step);
        stepSpan.setAttribute("step.tool", step.tool || "unknown");
        if (step.invoke) {
          stepSpan.setAttribute("step.invoke_agent", step.invoke);
        }

        try {
          this.logger.debug(`Calling tool '${step.tool}' with args: ${JSON.stringify(args)}`);

          // Step-level timeout support
          let executePromise = tool.execute(args, context);
          if (step.timeout_ms) {
            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error(`Step '${step.step}' timed out after ${step.timeout_ms}ms`)), step.timeout_ms);
            });
            executePromise = Promise.race([executePromise, timeoutPromise]);
          }

          const output = await executePromise;
          const duration = Date.now() - startTime;

          this.logger.debug(`Step '${step.step}' completed in ${duration}ms`);
          stepSpan.setStatus({ code: SpanStatusCode.OK });
          stepSpan.setAttribute("step.duration_ms", duration);
          stepSpan.end();
          return {
            output,
            success: true,
            duration_ms: duration,
          };
        } catch (error) {
          const duration = Date.now() - startTime;
          this.logger.error(`Step '${step.step}' failed: ${(error as Error).message}`, error as Error);

          stepSpan.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
          stepSpan.recordException(error as Error);
          stepSpan.setAttribute("step.duration_ms", duration);
          stepSpan.end();

          // Return failed result instead of throwing
          return {
            output: null,
            success: false,
            error: error as Error,
            duration_ms: duration,
          };
        }
      }
    );
  }

  /**
   * Evaluate a condition string
   */
  private evaluateCondition(condition: string, context: ExecutionContext): boolean {
    try {
      // Replace template variables
      let resolved: unknown = this.templateResolver.resolve(condition, context);

      // Simple boolean/string evaluation
      if (typeof resolved === "boolean") return resolved;
      if (typeof resolved === "number") return resolved !== 0;

      if (typeof resolved === "string") {
        const expr = resolved.trim();

        // Handle logical AND/OR
        if (expr.includes(" && ") || expr.includes(" || ")) {
          const parts = expr.includes(" || ") ? expr.split(" || ") : expr.split(" && ");
          const isAnd = expr.includes(" && ");
          const results = parts.map((p) => this.evaluateSimple(p.trim()));
          return isAnd ? results.every(Boolean) : results.some(Boolean);
        }

        // Handle comparison operators (==, !=, >, <, >=, <=)
        const cmpMatch = expr.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
        if (cmpMatch) {
          const left = this.normalizeValue(cmpMatch[1].trim());
          const op = cmpMatch[2];
          const right = this.normalizeValue(cmpMatch[3].trim());
          return this.compareValues(left, op, right);
        }

        return this.evaluateSimple(expr);
      }

      return !!resolved;
    } catch (error) {
      this.logger.warn(`Failed to evaluate condition '${condition}': ${(error as Error).message}`);
      return false;
    }
  }

  private evaluateSimple(val: string): boolean {
    if (val === "true") return true;
    if (val === "false") return false;
    if (val === "") return false;
    return true;
  }

  private normalizeValue(val: string): string | number | boolean {
    // Strip quotes
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      return val.slice(1, -1);
    }
    if (val === "true") return true;
    if (val === "false") return false;
    if (val === "0") return 0;
    const num = Number(val);
    if (!isNaN(num) && val.trim() !== "") return num;
    return val;
  }

  private compareValues(left: string | number | boolean, op: string, right: string | number | boolean): boolean {
    switch (op) {
      case "==": return left == right;
      case "!=": return left != right;
      case ">": return left > right;
      case "<": return left < right;
      case ">=": return left >= right;
      case "<=": return left <= right;
      default: return false;
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

    return pipelineTracer.startActiveSpan(
      `pipeline.on_fail.${step.step}`,
      async (failSpan) => {
        failSpan.setAttribute("step.name", step.step);
        failSpan.setAttribute("on_fail.strategy", typeof strategy === "string" ? strategy : "retry");
        failSpan.setAttribute("error.message", error.message);

        if (typeof strategy === "string") {
          switch (strategy) {
            case "abort":
              this.logger.error(`Step '${step.step}' failed, aborting pipeline`, error);
              failSpan.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
              failSpan.recordException(error);
              failSpan.end();
              return false;

            case "skip":
              this.logger.warn(`Step '${step.step}' failed, skipping (on_fail: skip)`);
              ExecutionContextManager.setStepResult(context, step.step, {
                output: null,
                success: false,
                // skip does NOT record error — it's a deliberate skip, not a failure
                duration_ms: 0,
              });
              failSpan.setStatus({ code: SpanStatusCode.OK });
              failSpan.setAttribute("on_fail.action", "skipped");
              failSpan.end();
              return true;

            case "continue":
              this.logger.warn(`Step '${step.step}' failed, continuing with error recorded (on_fail: continue)`);
              ExecutionContextManager.setStepResult(context, step.step, {
                output: null,
                success: false,
                error,  // continue DOES record error so subsequent when: can detect
                duration_ms: 0,
              });
              failSpan.setStatus({ code: SpanStatusCode.OK });
              failSpan.setAttribute("on_fail.action", "continued");
              failSpan.end();
              return true;

            default:
              failSpan.end();
              return false;
          }
        } else if (typeof strategy === "object" && "retry" in strategy) {
          const retryVal = strategy.retry;

          // Support both old {retry: number} and new {retry: RetryConfig}
          const config: RetryConfig = typeof retryVal === "number"
            ? { max_attempts: retryVal, backoff: "fixed", initial_delay_ms: 500 }
            : retryVal as RetryConfig;

          failSpan.setAttribute("retry.max_attempts", config.max_attempts);
          failSpan.setAttribute("retry.backoff", config.backoff || "fixed");

          this.logger.info(`Step '${step.step}' failed, retrying ${config.max_attempts} times (backoff: ${config.backoff || "fixed"})`);

          for (let i = 0; i < config.max_attempts; i++) {
            // Exponential or fixed backoff with jitter
            if (i > 0) {
              const delay = this.computeBackoff(i, config);
              this.logger.debug(`Retry delay: ${delay}ms for attempt ${i + 1}/${config.max_attempts}`);
              await this.sleep(delay);
            }

            this.logger.debug(`Retry attempt ${i + 1}/${config.max_attempts} for step '${step.step}'`);

            const resolvedArgs = this.templateResolver.resolve(step.args || {}, context);
            const result = await this.executeStep(step, resolvedArgs, context);

            if (result.success) {
              this.logger.info(`Step '${step.step}' succeeded on retry ${i + 1}`);
              ExecutionContextManager.setStepResult(context, step.step, result);

              if (step.output) {
                ExecutionContextManager.setShared(context, step.output, result.output);
              }
              failSpan.setStatus({ code: SpanStatusCode.OK });
              failSpan.setAttribute("retry.succeeded_on_attempt", i + 1);
              failSpan.end();
              return true;
            }

            if (i === config.max_attempts - 1) {
              this.logger.error(`Step '${step.step}' failed after ${config.max_attempts} retries`, result.error);
              failSpan.setStatus({ code: SpanStatusCode.ERROR, message: result.error?.message || "Retry exhausted" });
              if (result.error) failSpan.recordException(result.error);
              failSpan.setAttribute("retry.exhausted", true);
              failSpan.end();
              return false;
            }
          }
        }

        failSpan.end();
        return false;
      }
    );
  }

  private computeBackoff(attempt: number, config: RetryConfig): number {
    const initial = config.initial_delay_ms || 500;
    const max = config.max_delay_ms || 30000;

    let delay: number;
    if (config.backoff === "exponential") {
      delay = initial * Math.pow(2, attempt - 1);
    } else {
      delay = initial;
    }

    // Add jitter (±25%)
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    delay = Math.round(delay + jitter);

    return Math.min(delay, max);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Output structured JSON log for monitoring/observability.
   */
  private jsonLog(traceId: string | undefined, stepName: string, result: StepResult): void {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      trace_id: traceId,
      step: stepName,
      success: result.success,
      duration_ms: result.duration_ms,
      error: result.error?.message || undefined,
    }));
  }

  /**
   * Get final result from context
   */
  private getFinalResult(context: ExecutionContext): unknown {
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
