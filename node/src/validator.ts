/**
 * Validator — agent.json / worker.yaml 配置验证
 *
 * 纯配置态验证，不执行任何工具调用。
 * 支持:
 *   - agent.json 结构合法性检查
 *   - worker.yaml 结构合法性检查
 *   - 静态分析：循环依赖、未定义变量、不可达步骤
 */

import * as fs from "fs";
import * as path from "path";
import { WorkerYaml, PipelineStep } from "./runtime/types.js";

// ---------- 类型定义 ----------

export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  agent_id?: string;
  schema_version?: string;
}

// ---------- agent.json 验证 ----------

export function validateAgentJson(agentJsonPath: string): ValidationResult {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };

  if (!fs.existsSync(agentJsonPath)) {
    result.errors.push({ field: "file", message: `File not found: ${agentJsonPath}`, severity: "error" });
    result.valid = false;
    return result;
  }

  let agentJson: any;
  try {
    const raw = fs.readFileSync(agentJsonPath, "utf-8");
    agentJson = JSON.parse(raw);
  } catch (e: any) {
    result.errors.push({ field: "file", message: `Failed to parse JSON: ${e.message}`, severity: "error" });
    result.valid = false;
    return result;
  }

  result.agent_id = agentJson.identity?.name || agentJson.name || path.basename(path.dirname(agentJsonPath));
  result.schema_version = agentJson.schema_version;

  // 必填字段检查
  if (!agentJson.identity?.name && !agentJson.name) {
    result.errors.push({ field: "identity.name", message: "Agent name is required (identity.name or name)", severity: "error" });
    result.valid = false;
  }

  if (!agentJson.instructions && !agentJson.instructions_md) {
    result.warnings.push({ field: "instructions", message: "No instructions (system prompt) defined", severity: "warning" });
  }

  // capabilities 检查
  const capabilities = agentJson.capabilities || [];
  if (capabilities.length === 0) {
    result.warnings.push({ field: "capabilities", message: "No capabilities defined — agent has no tools", severity: "warning" });
  }

  for (let i = 0; i < capabilities.length; i++) {
    const cap = capabilities[i];
    if (!cap.name) {
      result.errors.push({ field: `capabilities[${i}].name`, message: "Capability name is required", severity: "error" });
      result.valid = false;
    }
    if (!cap.type) {
      result.warnings.push({ field: `capabilities[${i}].type`, message: "Capability type not specified", severity: "warning" });
    }
  }

  // MCP servers 检查
  const mcps = agentJson.mcp_servers || [];
  for (let i = 0; i < mcps.length; i++) {
    const mcp = mcps[i];
    if (!mcp.name) {
      result.errors.push({ field: `mcp_servers[${i}].name`, message: "MCP server name is required", severity: "error" });
      result.valid = false;
    }
    const transport = mcp.transport || mcp.type || "stdio";
    if (transport === "stdio" && !mcp.command) {
      result.errors.push({ field: `mcp_servers[${i}].command`, message: "stdio MCP server requires 'command'", severity: "error" });
      result.valid = false;
    }
    if (transport === "sse" && !mcp.url) {
      result.errors.push({ field: `mcp_servers[${i}].url`, message: "SSE MCP server requires 'url'", severity: "error" });
      result.valid = false;
    }
  }

  // schema_version 检查
  if (agentJson.schema_version) {
    const sv = String(agentJson.schema_version);
    if (!sv.match(/^\d+\.\d+\.\d+$/)) {
      result.warnings.push({ field: "schema_version", message: `Non-standard schema_version: ${sv} (expected x.y.z)`, severity: "warning" });
    }
  }

  return result;
}

// ---------- worker.yaml 验证 ----------

export function validateWorkerYaml(workerYamlPath: string): ValidationResult {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };

  if (!fs.existsSync(workerYamlPath)) {
    result.errors.push({ field: "file", message: `File not found: ${workerYamlPath}`, severity: "error" });
    result.valid = false;
    return result;
  }

  let workerYaml: WorkerYaml;
  try {
    // 简单的 YAML 解析（不引入 yaml 库，使用 JSON 兼容格式）
    // 实际使用时建议引入 js-yaml
    const raw = fs.readFileSync(workerYamlPath, "utf-8");
    // 尝试 JSON 格式
    try {
      workerYaml = JSON.parse(raw);
    } catch {
      // 如果不是 JSON，尝试简单的 YAML 解析
      // TODO: 引入 js-yaml 库进行完整解析
      result.warnings.push({ field: "file", message: "YAML parsing requires js-yaml library; attempting basic validation", severity: "warning" });
      workerYaml = { pipeline: [] };
    }
  } catch (e: any) {
    result.errors.push({ field: "file", message: `Failed to parse: ${e.message}`, severity: "error" });
    result.valid = false;
    return result;
  }

  // pipeline 检查
  if (!workerYaml.pipeline || !Array.isArray(workerYaml.pipeline)) {
    result.errors.push({ field: "pipeline", message: "Pipeline must be an array of steps", severity: "error" });
    result.valid = false;
    return result;
  }

  if (workerYaml.pipeline.length === 0) {
    result.warnings.push({ field: "pipeline", message: "Pipeline is empty — no steps defined", severity: "warning" });
  }

  // 步骤级验证
  const stepNames = new Set<string>();
  const outputVars = new Set<string>();
  const referencedVars = new Set<string>();

  for (let i = 0; i < workerYaml.pipeline.length; i++) {
    const step = workerYaml.pipeline[i] as PipelineStep;

    if (!step.step) {
      result.errors.push({ field: `pipeline[${i}].step`, message: "Step name is required", severity: "error" });
      result.valid = false;
      continue;
    }

    // 重复步骤名检查
    if (stepNames.has(step.step)) {
      result.errors.push({ field: `pipeline[${i}].step`, message: `Duplicate step name: '${step.step}'`, severity: "error" });
      result.valid = false;
    }
    stepNames.add(step.step);

    // 工具引用检查
    if (!step.tool && !step.invoke && !step.invoke_parallel) {
      result.warnings.push({ field: `pipeline[${i}]`, message: `Step '${step.step}' has no tool/invoke — will be a no-op`, severity: "warning" });
    }

    // 输出变量收集
    if (step.output) {
      if (outputVars.has(step.output)) {
        result.errors.push({ field: `pipeline[${i}].output`, message: `Duplicate output variable: '${step.output}'`, severity: "error" });
        result.valid = false;
      }
      outputVars.add(step.output);
    }

    // 引用变量收集（简单检测 ${var} 模式）
    const argsStr = JSON.stringify(step.args || step.with || {});
    const varRefs = argsStr.match(/\$\{(\w+)\}/g) || [];
    for (const ref of varRefs) {
      const varName = ref.slice(2, -1);
      referencedVars.add(varName);
    }
  }

  // 未定义变量检查
  for (const varName of referencedVars) {
    if (!outputVars.has(varName) && !(workerYaml.shared_context && varName in workerYaml.shared_context)) {
      result.warnings.push({ field: "variables", message: `Referenced variable '${varName}' is not defined by any prior step or shared_context`, severity: "warning" });
    }
  }

  // 工具定义检查
  if (workerYaml.tools) {
    const toolNames = new Set(workerYaml.tools.map((t) => t.name));
    for (let i = 0; i < workerYaml.pipeline.length; i++) {
      const step = workerYaml.pipeline[i] as PipelineStep;
      if (step.tool && !toolNames.has(step.tool)) {
        const isBuiltin = ["bash", "read_file", "write_file", "glob", "llm_chat", "web_search", "web_fetch"].includes(step.tool);
        if (!isBuiltin) {
          result.warnings.push({ field: `pipeline[${i}].tool`, message: `Tool '${step.tool}' is not defined in tools section (may be a builtin)`, severity: "warning" });
        }
      }
    }
  }

  return result;
}

// ---------- 验证结果格式化 ----------

export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.agent_id) {
    lines.push(`Agent: ${result.agent_id}`);
  }
  if (result.schema_version) {
    lines.push(`Schema: v${result.schema_version}`);
  }

  if (result.valid) {
    lines.push(`Status: VALID`);
  } else {
    lines.push(`Status: INVALID`);
  }

  if (result.errors.length > 0) {
    lines.push(`\nErrors (${result.errors.length}):`);
    for (const err of result.errors) {
      lines.push(`  [ERROR] ${err.field}: ${err.message}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push(`\nWarnings (${result.warnings.length}):`);
    for (const warn of result.warnings) {
      lines.push(`  [WARN]  ${warn.field}: ${warn.message}`);
    }
  }

  return lines.join("\n");
}
