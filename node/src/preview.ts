/**
 * Preview — Pipeline 执行流程预览
 *
 * 纯配置态预览，不执行任何工具调用。
 * 支持:
 *   - 生成 Pipeline 步骤列表（文本格式）
 *   - 生成 Mermaid 流程图
 *   - Dry-run 模式：模拟执行，输出每个步骤的输入/输出模板
 */

import * as fs from "fs";
import * as path from "path";
import { PipelineStep, WorkerYaml } from "./runtime/types.js";

// ---------- 文本预览 ----------

export interface StepPreview {
  index: number;
  name: string;
  tool: string;
  description: string;
  has_condition: boolean;
  condition?: string;
  on_fail: string;
  timeout_ms?: number;
  inputs: string[];
  outputs: string[];
}

export function previewPipeline(workerYaml: WorkerYaml): StepPreview[] {
  const steps: StepPreview[] = [];
  const sharedContextKeys = Object.keys(workerYaml.shared_context || {});

  for (let i = 0; i < workerYaml.pipeline.length; i++) {
    const step = workerYaml.pipeline[i] as PipelineStep;

    // 确定工具
    let tool = step.tool || "noop";
    let description = "";

    if (step.invoke) {
      tool = `invoke:${step.invoke}`;
      description = `Invoke sub-agent '${step.invoke}'`;
    } else if (step.invoke_parallel) {
      tool = "invoke_parallel";
      const agents = step.invoke_parallel.map((p) => p.agent).join(", ");
      description = `Invoke ${step.invoke_parallel.length} agents in parallel: ${agents}`;
    } else {
      const toolDescriptions: Record<string, string> = {
        bash: "Execute shell command",
        read_file: "Read file content",
        write_file: "Write content to file",
        glob: "Find files by pattern",
        llm_chat: "LLM conversation",
        web_search: "Search the web",
        web_fetch: "Fetch web page content",
      };
      description = toolDescriptions[tool] || `Custom tool: ${tool}`;
    }

    // 收集输入变量引用
    const argsStr = JSON.stringify(step.args || step.with || {});
    const inputRefs = (argsStr.match(/\$\{(\w+)\}/g) || []).map((r) => r.slice(2, -1));

    // 收集输出
    const outputs: string[] = [];
    if (step.output) outputs.push(step.output);
    if (step.as) outputs.push(...Object.keys(step.as));

    steps.push({
      index: i + 1,
      name: step.step,
      tool,
      description,
      has_condition: !!step.when,
      condition: step.when,
      on_fail: typeof step.on_fail === "string" ? step.on_fail : JSON.stringify(step.on_fail),
      timeout_ms: step.timeout_ms,
      inputs: inputRefs,
      outputs,
    });
  }

  return steps;
}

export function formatPipelinePreview(previews: StepPreview[]): string {
  const lines: string[] = [];

  lines.push("Pipeline Execution Preview");
  lines.push("=".repeat(50));

  for (const step of previews) {
    lines.push(`\nStep ${step.index}: ${step.name}`);
    lines.push(`  Tool:     ${step.tool}`);
    lines.push(`  Desc:     ${step.description}`);

    if (step.inputs.length > 0) {
      lines.push(`  Inputs:   ${step.inputs.join(", ")}`);
    }
    if (step.outputs.length > 0) {
      lines.push(`  Outputs:  ${step.outputs.join(", ")}`);
    }
    if (step.has_condition) {
      lines.push(`  When:     ${step.condition}`);
    }
    lines.push(`  On Fail:  ${step.on_fail}`);
    if (step.timeout_ms) {
      lines.push(`  Timeout:  ${step.timeout_ms}ms`);
    }
  }

  lines.push(`\nTotal: ${previews.length} step(s)`);
  return lines.join("\n");
}

// ---------- Mermaid 流程图 ----------

export function generateMermaidDiagram(workerYaml: WorkerYaml): string {
  const lines: string[] = [];
  lines.push("flowchart TD");

  // 起始节点
  lines.push("    START((Start))");

  let prevNode = "START";

  for (let i = 0; i < workerYaml.pipeline.length; i++) {
    const step = workerYaml.pipeline[i] as PipelineStep;
    const nodeId = `step${i}`;
    const label = step.invoke
      ? `Invoke: ${step.invoke}`
      : step.invoke_parallel
        ? `Parallel: ${step.invoke_parallel.length} agents`
        : step.tool || step.step;

    lines.push(`    ${nodeId}["${i + 1}. ${step.step}\\n${label}"]`);

    // 连接前一个节点
    if (step.when) {
      lines.push(`    ${prevNode} -->|${step.when}| ${nodeId}`);
    } else {
      lines.push(`    ${prevNode} --> ${nodeId}`);
    }

    // 失败策略标注
    if (step.on_fail) {
      const failLabel = typeof step.on_fail === "string" ? step.on_fail : "retry";
      lines.push(`    ${nodeId} -.->|fail: ${failLabel}| END_FAIL(((Fail)))`);
    }

    prevNode = nodeId;
  }

  // 结束节点
  lines.push("    END(((Done)))");
  lines.push(`    ${prevNode} --> END`);

  return lines.join("\n");
}

// ---------- Dry-run 模拟 ----------

export interface DryRunStep {
  step: string;
  tool: string;
  simulated_input: Record<string, unknown>;
  simulated_output: Record<string, unknown>;
  status: "simulated";
}

export function dryRunPipeline(workerYaml: WorkerYaml): DryRunStep[] {
  const results: DryRunStep[] = [];
  const sharedContext: Record<string, unknown> = { ...(workerYaml.shared_context || {}) };

  for (let i = 0; i < workerYaml.pipeline.length; i++) {
    const step = workerYaml.pipeline[i] as PipelineStep;

    // 解析输入（替换 ${var} 引用）
    const simulatedInput = resolveTemplate(step.args || step.with || {}, sharedContext);

    // 模拟输出
    let simulatedOutput: Record<string, unknown> = {};
    if (step.output) {
      simulatedOutput = { [step.output]: `<simulated output of step '${step.step}'>` };
      sharedContext[step.output] = simulatedOutput[step.output];
    }
    if (step.as) {
      for (const [key, srcField] of Object.entries(step.as)) {
        simulatedOutput[key] = `<simulated: ${srcField}>`;
        sharedContext[key] = simulatedOutput[key];
      }
    }

    // 确定工具名
    let tool = step.tool || "noop";
    if (step.invoke) tool = `invoke:${step.invoke}`;
    if (step.invoke_parallel) tool = `invoke_parallel`;

    results.push({
      step: step.step,
      tool,
      simulated_input: simulatedInput,
      simulated_output: simulatedOutput,
      status: "simulated",
    });
  }

  return results;
}

export function formatDryRunResult(results: DryRunStep[]): string {
  const lines: string[] = [];

  lines.push("Pipeline Dry-Run Results");
  lines.push("=".repeat(50));

  for (const r of results) {
    lines.push(`\nStep: ${r.step}`);
    lines.push(`  Tool:   ${r.tool}`);
    lines.push(`  Status: ${r.status}`);
    if (Object.keys(r.simulated_input).length > 0) {
      lines.push(`  Input:  ${JSON.stringify(r.simulated_input, null, 2).split("\n").join("\n          ")}`);
    }
    if (Object.keys(r.simulated_output).length > 0) {
      lines.push(`  Output: ${JSON.stringify(r.simulated_output, null, 2).split("\n").join("\n          ")}`);
    }
  }

  lines.push(`\nTotal: ${results.length} step(s) simulated`);
  return lines.join("\n");
}

// ---------- 内部工具 ----------

function resolveTemplate(
  template: Record<string, unknown>,
  context: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(template)) {
    if (typeof value === "string") {
      result[key] = value.replace(/\$\{(\w+)\}/g, (_, varName) => {
        return String(context[varName] ?? `\${${varName}}`);
      });
    } else {
      result[key] = value;
    }
  }
  return result;
}
