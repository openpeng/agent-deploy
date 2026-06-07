// Runtime types for Agent Protocol v3

export interface WorkerYaml {
  tools?: ToolDefinition[]; // Optional - builtin tools are always available
  shared_context?: Record<string, any>;
  pipeline: PipelineStep[];
}

export interface ToolDefinition {
  name: string;
  type: ToolType;
  // For subagent tools
  subagent?: string;
  // For MCP tools
  server?: string;
  // For skill tools
  skill_name?: string;
}

export type ToolType = "builtin" | "custom" | "subagent" | "mcp" | "skill";

export interface PipelineStep {
  step: string;
  tool: string;
  args?: Record<string, any>;
  output?: string;
  when?: string;
  on_fail?: OnFailStrategy;
  timeout_ms?: number;  // Per-step timeout in milliseconds
}

export interface RetryConfig {
  max_attempts: number;
  backoff?: "fixed" | "exponential";
  initial_delay_ms?: number;
  max_delay_ms?: number;
}

export type OnFailStrategy =
  | "abort"
  | "skip"
  | "continue"
  | { retry: number }
  | { retry: RetryConfig };

export interface ExecutionContext {
  agent: any; // Will be defined later
  initialArgs: Record<string, any>;
  sharedContext: Record<string, any>;
  steps: Map<string, StepResult>;
  env: Record<string, string>;
  cwd: string;
}

export interface StepResult {
  output: any;
  success: boolean;
  error?: Error;
  duration_ms: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
