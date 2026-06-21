/**
 * Tests for validator module
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { validateAgentJson, validateWorkerYaml, formatValidationResult } from "../src/validator.js";

describe("validateAgentJson", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-deploy-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeAgentJson(content: any): string {
    const filePath = path.join(tmpDir, "agent.json");
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
    return filePath;
  }

  test("valid agent.json passes validation", () => {
    const filePath = writeAgentJson({
      schema_version: "1.0.0",
      identity: { name: "test-agent" },
      instructions: "You are a helpful assistant.",
      capabilities: [{ name: "web_search", type: "tool" }],
    });

    const result = validateAgentJson(filePath);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.agent_id).toBe("test-agent");
    expect(result.schema_version).toBe("1.0.0");
  });

  test("missing file returns error", () => {
    const result = validateAgentJson("/nonexistent/agent.json");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].field).toBe("file");
  });

  test("invalid JSON returns error", () => {
    const filePath = path.join(tmpDir, "agent.json");
    fs.writeFileSync(filePath, "{invalid json}");

    const result = validateAgentJson(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe("file");
  });

  test("missing name returns error", () => {
    const filePath = writeAgentJson({
      schema_version: "1.0.0",
      instructions: "test",
    });

    const result = validateAgentJson(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === "identity.name")).toBe(true);
  });

  test("missing instructions gives warning", () => {
    const filePath = writeAgentJson({
      identity: { name: "test-agent" },
    });

    const result = validateAgentJson(filePath);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.field === "instructions")).toBe(true);
  });

  test("empty capabilities gives warning", () => {
    const filePath = writeAgentJson({
      identity: { name: "test-agent" },
      instructions: "test",
      capabilities: [],
    });

    const result = validateAgentJson(filePath);
    expect(result.warnings.some(w => w.field === "capabilities")).toBe(true);
  });

  test("capability without name returns error", () => {
    const filePath = writeAgentJson({
      identity: { name: "test-agent" },
      capabilities: [{ type: "tool" }],
    });

    const result = validateAgentJson(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field.includes("capabilities"))).toBe(true);
  });

  test("stdio MCP without command returns error", () => {
    const filePath = writeAgentJson({
      identity: { name: "test-agent" },
      mcp_servers: [{ name: "test-mcp", transport: "stdio" }],
    });

    const result = validateAgentJson(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes("command"))).toBe(true);
  });

  test("SSE MCP without url returns error", () => {
    const filePath = writeAgentJson({
      identity: { name: "test-agent" },
      mcp_servers: [{ name: "test-mcp", transport: "sse" }],
    });

    const result = validateAgentJson(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes("url"))).toBe(true);
  });
});

describe("validateWorkerYaml", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-deploy-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeWorkerYaml(content: any): string {
    const filePath = path.join(tmpDir, "worker.yaml");
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
    return filePath;
  }

  test("valid worker.yaml passes validation", () => {
    const filePath = writeWorkerYaml({
      pipeline: [
        { step: "search", tool: "web_search", args: { query: "test" }, output: "results" },
        { step: "summarize", tool: "llm_chat", args: { prompt: "${results}" } },
      ],
    });

    const result = validateWorkerYaml(filePath);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test("missing file returns error", () => {
    const result = validateWorkerYaml("/nonexistent/worker.yaml");
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe("file");
  });

  test("empty pipeline gives warning", () => {
    const filePath = writeWorkerYaml({ pipeline: [] });

    const result = validateWorkerYaml(filePath);
    expect(result.warnings.some(w => w.field === "pipeline")).toBe(true);
  });

  test("duplicate step names returns error", () => {
    const filePath = writeWorkerYaml({
      pipeline: [
        { step: "dup", tool: "bash" },
        { step: "dup", tool: "bash" },
      ],
    });

    const result = validateWorkerYaml(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes("Duplicate"))).toBe(true);
  });

  test("undefined variable reference gives warning", () => {
    const filePath = writeWorkerYaml({
      pipeline: [
        { step: "use_undefined", tool: "bash", args: { cmd: "${nonexistent_var}" } },
      ],
    });

    const result = validateWorkerYaml(filePath);
    expect(result.warnings.some(w => w.message.includes("nonexistent_var"))).toBe(true);
  });

  test("shared_context variable is recognized", () => {
    const filePath = writeWorkerYaml({
      shared_context: { input_file: "data.txt" },
      pipeline: [
        { step: "read", tool: "read_file", args: { path: "${input_file}" } },
      ],
    });

    const result = validateWorkerYaml(filePath);
    expect(result.warnings.every(w => !w.message.includes("input_file"))).toBe(true);
  });
});

describe("formatValidationResult", () => {
  test("formats valid result", () => {
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      agent_id: "test-agent",
      schema_version: "1.0.0",
    };
    const output = formatValidationResult(result);
    expect(output).toContain("VALID");
    expect(output).toContain("test-agent");
  });

  test("formats invalid result with errors", () => {
    const result = {
      valid: false,
      errors: [{ field: "name", message: "Name is required", severity: "error" }],
      warnings: [],
    };
    const output = formatValidationResult(result);
    expect(output).toContain("INVALID");
    expect(output).toContain("[ERROR]");
    expect(output).toContain("Name is required");
  });
});
