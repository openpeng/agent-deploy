import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { PipelineEngine, ConsoleLogger } from "../../src/runtime/pipeline.js";
import { ToolRegistry } from "../../src/runtime/tool-registry.js";
import { ExecutionContextManager } from "../../src/runtime/context.js";
import { ReadFileTool } from "../../src/runtime/tools/read-file.js";
import { WriteFileTool } from "../../src/runtime/tools/write-file.js";
import { BashTool } from "../../src/runtime/tools/bash.js";
import { GlobTool } from "../../src/runtime/tools/glob.js";
import { WorkerYaml } from "../../src/runtime/types.js";

describe("CLI run command integration", () => {
  let testDir: string;
  let registry: ToolRegistry;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-run-integration-"));

    // Set up registry with builtin tools
    registry = new ToolRegistry();
    registry.register(new ReadFileTool());
    registry.register(new WriteFileTool());
    registry.register(new BashTool());
    registry.register(new GlobTool());
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should execute agent with all builtin tools", async () => {
    const workerYaml: WorkerYaml = {
      pipeline: [
        {
          step: "write_data",
          tool: "write_file",
          args: {
            path: "data.txt",
            content: "Test Data",
          },
          output: "write_result",
        },
        {
          step: "read_data",
          tool: "read_file",
          args: {
            path: "data.txt",
          },
          output: "content",
        },
        {
          step: "verify",
          tool: "bash",
          args: {
            command: "cat data.txt",
          },
        },
      ],
    };

    const context = ExecutionContextManager.create({
      agent: { name: "test-agent" },
      initialArgs: {},
      cwd: testDir,
    });

    const engine = new PipelineEngine(registry, new ConsoleLogger(false));
    const result = await engine.execute(workerYaml, context);

    expect(result).toBeDefined();
    expect(result.stdout).toContain("Test Data");

    const summary = ExecutionContextManager.getSummary(context);
    expect(summary.total_steps).toBe(3);
    expect(summary.successful_steps).toBe(3);
    expect(summary.failed_steps).toBe(0);
  });

  it("should pass arguments to agent", async () => {
    const workerYaml: WorkerYaml = {
      pipeline: [
        {
          step: "use_args",
          tool: "write_file",
          args: {
            path: "output.txt",
            content: "Hello {{name}}!",
          },
        },
      ],
    };

    const context = ExecutionContextManager.create({
      agent: { name: "test-agent" },
      initialArgs: { name: "World" },
      cwd: testDir,
    });

    const engine = new PipelineEngine(registry, new ConsoleLogger(false));
    await engine.execute(workerYaml, context);

    const content = fs.readFileSync(path.join(testDir, "output.txt"), "utf-8");
    expect(content).toBe("Hello World!");
  });

  it("should use custom working directory", async () => {
    const customDir = path.join(testDir, "custom");
    fs.mkdirSync(customDir, { recursive: true });

    const workerYaml: WorkerYaml = {
      pipeline: [
        {
          step: "write_in_cwd",
          tool: "write_file",
          args: {
            path: "output.txt",
            content: "In custom dir",
          },
        },
      ],
    };

    const context = ExecutionContextManager.create({
      agent: { name: "test-agent" },
      initialArgs: {},
      cwd: customDir,
    });

    const engine = new PipelineEngine(registry, new ConsoleLogger(false));
    await engine.execute(workerYaml, context);

    const outputPath = path.join(customDir, "output.txt");
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.readFileSync(outputPath, "utf-8")).toBe("In custom dir");
  });

  it("should handle shared context", async () => {
    const workerYaml: WorkerYaml = {
      shared_context: {
        prefix: "Hello",
        suffix: "World",
      },
      pipeline: [
        {
          step: "use_shared",
          tool: "write_file",
          args: {
            path: "greeting.txt",
            content: "{{shared_context.prefix}} {{shared_context.suffix}}!",
          },
        },
      ],
    };

    const context = ExecutionContextManager.create({
      agent: { name: "test-agent" },
      initialArgs: {},
      cwd: testDir,
    });

    const engine = new PipelineEngine(registry, new ConsoleLogger(false));
    await engine.execute(workerYaml, context);

    const content = fs.readFileSync(path.join(testDir, "greeting.txt"), "utf-8");
    expect(content).toBe("Hello World!");
  });

  it("should provide execution summary", async () => {
    const workerYaml: WorkerYaml = {
      pipeline: [
        {
          step: "step1",
          tool: "write_file",
          args: { path: "f1.txt", content: "1" },
        },
        {
          step: "step2",
          tool: "write_file",
          args: { path: "f2.txt", content: "2" },
        },
      ],
    };

    const context = ExecutionContextManager.create({
      agent: { name: "test-agent" },
      initialArgs: {},
      cwd: testDir,
    });

    const engine = new PipelineEngine(registry, new ConsoleLogger(false));
    await engine.execute(workerYaml, context);

    const summary = ExecutionContextManager.getSummary(context);
    expect(summary.total_steps).toBe(2);
    expect(summary.successful_steps).toBe(2);
    expect(summary.failed_steps).toBe(0);
    expect(summary.total_duration_ms).toBeGreaterThan(0);
  });

  it("should handle pipeline failures", async () => {
    const workerYaml: WorkerYaml = {
      pipeline: [
        {
          step: "success",
          tool: "write_file",
          args: { path: "ok.txt", content: "ok" },
        },
        {
          step: "fail",
          tool: "bash",
          args: { command: "exit 1" },
        },
      ],
    };

    const context = ExecutionContextManager.create({
      agent: { name: "test-agent" },
      initialArgs: {},
      cwd: testDir,
    });

    const engine = new PipelineEngine(registry, new ConsoleLogger(false));

    // Execute - bash tool returns exit_code but doesn't throw
    const result = await engine.execute(workerYaml, context);

    // Check that the bash step completed with non-zero exit code
    const failStepResult = ExecutionContextManager.getStepResult(context, "fail");
    expect(failStepResult).toBeDefined();
    expect(failStepResult?.output.exit_code).toBe(1);

    const summary = ExecutionContextManager.getSummary(context);
    expect(summary.total_steps).toBe(2);
    expect(summary.successful_steps).toBe(2); // Both steps succeeded (bash returned a result)
  });
});
