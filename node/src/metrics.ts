/**
 * Prometheus Metrics Module
 *
 * Provides custom metrics for the agent-deploy MCP server.
 * All metrics use the `agent_deploy_` prefix.
 */

import client from "prom-client";

// ---------------------------------------------------------------------------
// Registry & Initialization
// ---------------------------------------------------------------------------

const register = new client.Registry();

export function initMetrics(): void {
  // Collect default Node.js metrics (event loop, GC, memory, etc.)
  client.collectDefaultMetrics({ register });
}

export function getRegister(): client.Registry {
  return register;
}

// ---------------------------------------------------------------------------
// Custom Metrics
// ---------------------------------------------------------------------------

/** MCP request total counter — labels: tool_name, status */
export const requestsTotal = new client.Counter({
  name: "agent_deploy_requests_total",
  help: "Total number of MCP requests received",
  labelNames: ["tool_name", "status"],
  registers: [register],
});

/** Request duration histogram — labels: tool_name */
export const requestDurationSeconds = new client.Histogram({
  name: "agent_deploy_request_duration_seconds",
  help: "Request duration in seconds",
  labelNames: ["tool_name"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register],
});

/** Active connections gauge */
export const activeConnections = new client.Gauge({
  name: "agent_deploy_active_connections",
  help: "Number of active SSE/stream connections",
  registers: [register],
});

/** Tool calls total counter — labels: tool_name, agent_name */
export const toolCallsTotal = new client.Counter({
  name: "agent_deploy_tool_calls_total",
  help: "Total number of tool calls processed",
  labelNames: ["tool_name", "agent_name"],
  registers: [register],
});

/** Agent executions total counter — labels: agent_name, status */
export const agentExecutionsTotal = new client.Counter({
  name: "agent_deploy_agent_executions_total",
  help: "Total number of agent executions",
  labelNames: ["agent_name", "status"],
  registers: [register],
});

/** Pipeline steps total counter — labels: agent_name, step_name, status */
export const pipelineStepsTotal = new client.Counter({
  name: "agent_deploy_pipeline_steps_total",
  help: "Total number of pipeline steps executed",
  labelNames: ["agent_name", "step_name", "status"],
  registers: [register],
});

/** Policy violations total counter — labels: agent_name, policy_level, violation_type */
export const policyViolationsTotal = new client.Counter({
  name: "agent_deploy_policy_violations_total",
  help: "Total number of policy violations",
  labelNames: ["agent_name", "policy_level", "violation_type"],
  registers: [register],
});

/** Quota exceeded total counter — labels: agent_name, quota_type */
export const quotaExceededTotal = new client.Counter({
  name: "agent_deploy_quota_exceeded_total",
  help: "Total number of quota exceeded events",
  labelNames: ["agent_name", "quota_type"],
  registers: [register],
});

/** Cache hits total counter */
export const cacheHitsTotal = new client.Counter({
  name: "agent_deploy_cache_hits_total",
  help: "Total number of cache hits",
  registers: [register],
});

/** Cache misses total counter */
export const cacheMissesTotal = new client.Counter({
  name: "agent_deploy_cache_misses_total",
  help: "Total number of cache misses",
  registers: [register],
});

/** Market API requests total counter — labels: method, endpoint, status */
export const marketRequestsTotal = new client.Counter({
  name: "agent_deploy_market_requests_total",
  help: "Total number of Market API requests",
  labelNames: ["method", "endpoint", "status"],
  registers: [register],
});

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/** Record an MCP request with duration */
export function recordRequest(
  toolName: string,
  status: "success" | "error",
  durationMs: number
): void {
  requestsTotal.inc({ tool_name: toolName, status });
  requestDurationSeconds.observe({ tool_name: toolName }, durationMs / 1000);
}

/** Update active connections gauge */
export function setActiveConnections(n: number): void {
  activeConnections.set(n);
}

/** Record a tool call */
export function recordToolCallMetric(toolName: string, agentName: string): void {
  toolCallsTotal.inc({ tool_name: toolName, agent_name: agentName });
}

/** Record an agent execution */
export function recordAgentExecution(agentName: string, status: "success" | "failure"): void {
  agentExecutionsTotal.inc({ agent_name: agentName, status });
}

/** Record a pipeline step */
export function recordPipelineStep(
  agentName: string,
  stepName: string,
  status: "success" | "failure" | "skipped"
): void {
  pipelineStepsTotal.inc({ agent_name: agentName, step_name: stepName, status });
}

/** Record a policy violation */
export function recordPolicyViolation(
  agentName: string,
  policyLevel: string,
  violationType: string
): void {
  policyViolationsTotal.inc({ agent_name: agentName, policy_level: policyLevel, violation_type: violationType });
}

/** Record a quota exceeded event */
export function recordQuotaExceeded(agentName: string, quotaType: string): void {
  quotaExceededTotal.inc({ agent_name: agentName, quota_type: quotaType });
}

/** Record cache hit */
export function recordCacheHit(): void {
  cacheHitsTotal.inc();
}

/** Record cache miss */
export function recordCacheMiss(): void {
  cacheMissesTotal.inc();
}

/** Record a Market API request */
export function recordMarketRequest(
  method: string,
  endpoint: string,
  status: "success" | "error"
): void {
  marketRequestsTotal.inc({ method, endpoint, status });
}
