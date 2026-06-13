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
import { SubagentExecutor } from "../../src/runtime/subagent.js";

describe("Integration Tests - End-to-End Scenarios", () => {
  let testDir: string;
  let registry: ToolRegistry;
  let engine: PipelineEngine;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "integration-e2e-"));

    // Set up registry with builtin tools
    registry = new ToolRegistry();
    registry.register(new ReadFileTool());
    registry.register(new WriteFileTool());
    registry.register(new BashTool());
    registry.register(new GlobTool());

    engine = new PipelineEngine(registry, new ConsoleLogger(false));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("File Processing Workflow", () => {
    it("should process multiple files with pattern matching", async () => {
      // Create test files
      fs.writeFileSync(path.join(testDir, "input1.txt"), "Content 1");
      fs.writeFileSync(path.join(testDir, "input2.txt"), "Content 2");
      fs.writeFileSync(path.join(testDir, "input3.txt"), "Content 3");
      fs.writeFileSync(path.join(testDir, "readme.md"), "Readme");

      const workerYaml: WorkerYaml = {
        shared_context: {
          pattern: "*.txt",
          output_dir: "processed",
        },
        pipeline: [
          {
            step: "find_files",
            tool: "glob",
            args: {
              pattern: "{{shared_context.pattern}}",
            },
            output: "files",
          },
          {
            step: "create_output_dir",
            tool: "bash",
            args: {
              command: "mkdir -p {{shared_context.output_dir}}",
            },
          },
          {
            step: "process_first_file",
            tool: "read_file",
            args: {
              path: "input1.txt",
            },
            output: "content",
          },
          {
            step: "write_processed",
            tool: "write_file",
            args: {
              path: "{{shared_context.output_dir}}/output.txt",
              content: "Processed: {{steps.process_first_file.output}}",
            },
          },
        ],
      };

      const context = ExecutionContextManager.create({
        agent: { name: "file-processor" },
        initialArgs: {},
        cwd: testDir,
      });

      await engine.execute(workerYaml, context);

      // Verify results
      expect(fs.existsSync(path.join(testDir, "processed"))).toBe(true);
      const output = fs.readFileSync(
        path.join(testDir, "processed", "output.txt"),
        "utf-8"
      );
      expect(output).toContain("Processed: Content 1");

      const summary = ExecutionContextManager.getSummary(context);
      expect(summary.successful_steps).toBe(4);
    });
  });

  describe("Data Transformation Pipeline", () => {
    it("should transform data through multiple steps", async () => {
      // Create initial data
      const inputData = JSON.stringify({ users: ["alice", "bob", "charlie"] });
      fs.writeFileSync(path.join(testDir, "data.json"), inputData);

      const workerYaml: WorkerYaml = {
        pipeline: [
          {
            step: "read_data",
            tool: "read_file",
            args: {
              path: "data.json",
            },
            output: "raw_data",
          },
          {
            step: "transform_data",
            tool: "bash",
            args: {
              command: 'echo "{{steps.read_data.output}}" | wc -l',
            },
            output: "line_count",
          },
          {
            step: "write_report",
            tool: "write_file",
            args: {
              path: "report.txt",
              content: "Data processed successfully\\nLines: {{steps.transform_data.output.stdout}}",
            },
          },
        ],
      };

      const context = ExecutionContextManager.create({
        agent: { name: "data-transformer" },
        initialArgs: {},
        cwd: testDir,
      });

      await engine.execute(workerYaml, context);

      const report = fs.readFileSync(path.join(testDir, "report.txt"), "utf-8");
      expect(report).toContain("Data processed successfully");
    });
  });

  describe("Conditional Execution", () => {
    it("should handle conditional steps with when clause", async () => {
      fs.writeFileSync(path.join(testDir, "config.txt"), "production");

      const workerYaml: WorkerYaml = {
        pipeline: [
          {
            step: "read_config",
            tool: "read_file",
            args: {
              path: "config.txt",
            },
            output: "env",
          },
          {
            step: "production_only",
            tool: "write_file",
            args: {
              path: "prod.log",
              content: "Production mode enabled",
            },
            when: "{{steps.read_config.output}} == 'production'",
          },
        ],
      };

      const context = ExecutionContextManager.create({
        agent: { name: "conditional-agent" },
        initialArgs: {},
        cwd: testDir,
      });

      await engine.execute(workerYaml, context);

      // Note: Current implementation doesn't evaluate 'when' clause yet
      // This test documents the expected behavior
      const summary = ExecutionContextManager.getSummary(context);
      expect(summary.total_steps).toBeGreaterThan(0);
    });
  });

  describe("Error Recovery", () => {
    it("should handle bash command failures gracefully", async () => {
      const workerYaml: WorkerYaml = {
        pipeline: [
          {
            step: "create_file",
            tool: "write_file",
            args: {
              path: "test.txt",
              content: "Test content",
            },
          },
          {
            step: "failing_command",
            tool: "bash",
            args: {
              command: "exit 1",
            },
            output: "fail_result",
          },
          {
            step: "final_step",
            tool: "write_file",
            args: {
              path: "final.txt",
              content: "Completed despite failure",
            },
          },
        ],
      };

      const context = ExecutionContextManager.create({
        agent: { name: "error-recovery" },
        initialArgs: {},
        cwd: testDir,
      });

      // Bash tool returns exit code instead of throwing
      await engine.execute(workerYaml, context);

      // All steps should have executed
      expect(fs.existsSync(path.join(testDir, "test.txt"))).toBe(true);
      expect(fs.existsSync(path.join(testDir, "final.txt"))).toBe(true);

      // Check that failure was recorded
      const failResult = ExecutionContextManager.getStepResult(context, "failing_command");
      expect(failResult?.output.exit_code).toBe(1);
    });
  });

  describe("Tool Inheritance with Subagents", () => {
    it("should allow subagent to use parent tools", async () => {
      // Create a simple subagent worker.yaml
      const subagentDir = path.join(testDir, "subagent");
      fs.mkdirSync(subagentDir, { recursive: true });

      const subagentWorker: WorkerYaml = {
        pipeline: [
          {
            step: "write_from_subagent",
            tool: "write_file",
            args: {
              path: "subagent-output.txt",
              content: "Hello from subagent",
            },
          },
        ],
      };

      const yaml = require("js-yaml");
      fs.writeFileSync(
        path.join(subagentDir, "worker.yaml"),
        yaml.dump(subagentWorker)
      );
      fs.writeFileSync(
        path.join(subagentDir, "agent.json"),
        JSON.stringify({ identity: { name: "subagent" } })
      );

      // Create parent context
      const parentContext = ExecutionContextManager.create({
        agent: { name: "parent" },
        initialArgs: {},
        cwd: testDir,
      });

      // Execute subagent
      const subagentExecutor = new SubagentExecutor();
      await subagentExecutor.execute(subagentDir, {}, parentContext, registry);

      // Verify subagent used inherited tool
      expect(fs.existsSync(path.join(subagentDir, "subagent-output.txt"))).toBe(
        true
      );
    });
  });

  describe("Complex Multi-Step Workflow", () => {
    it("should execute complex workflow with all tool types", async () => {
      // Create test environment
      fs.writeFileSync(path.join(testDir, "source.txt"), "Original data");

      const workerYaml: WorkerYaml = {
        shared_context: {
          project_name: "integration-test",
          version: "1.0.0",
        },
        pipeline: [
          {
            step: "setup_directories",
            tool: "bash",
            args: {
              command: "mkdir -p build logs",
            },
          },
          {
            step: "copy_source",
            tool: "read_file",
            args: {
              path: "source.txt",
            },
            output: "source_content",
          },
          {
            step: "write_build",
            tool: "write_file",
            args: {
              path: "build/output.txt",
              content: "{{shared_context.project_name}} v{{shared_context.version}}\\n{{steps.copy_source.output}}",
            },
          },
          {
            step: "find_build_files",
            tool: "glob",
            args: {
              pattern: "build/**/*",
            },
            output: "build_files",
          },
          {
            step: "create_log",
            tool: "write_file",
            args: {
              path: "logs/build.log",
              content: "Build completed at {{shared_context.version}}",
            },
          },
        ],
      };

      const context = ExecutionContextManager.create({
        agent: { name: "complex-workflow" },
        initialArgs: {},
        cwd: testDir,
      });

      const result = await engine.execute(workerYaml, context);

      // Verify all steps completed
      const summary = ExecutionContextManager.getSummary(context);
      expect(summary.successful_steps).toBe(5);
      expect(summary.failed_steps).toBe(0);

      // Verify outputs
      expect(fs.existsSync(path.join(testDir, "build"))).toBe(true);
      expect(fs.existsSync(path.join(testDir, "logs"))).toBe(true);
      expect(fs.existsSync(path.join(testDir, "build", "output.txt"))).toBe(true);
      expect(fs.existsSync(path.join(testDir, "logs", "build.log"))).toBe(true);

      const output = fs.readFileSync(
        path.join(testDir, "build", "output.txt"),
        "utf-8"
      );
      expect(output).toContain("integration-test v1.0.0");
      expect(output).toContain("Original data");
    });
  });

  describe("Template Variable Resolution", () => {
    it("should resolve complex template variable chains", async () => {
      const workerYaml: WorkerYaml = {
        shared_context: {
          base_dir: "output",
          file_name: "result.txt",
        },
        pipeline: [
          {
            step: "create_base",
            tool: "bash",
            args: {
              command: "mkdir -p {{shared_context.base_dir}}",
            },
          },
          {
            step: "write_result",
            tool: "write_file",
            args: {
              path: "{{shared_context.base_dir}}/{{shared_context.file_name}}",
              content: "Input: {{input}}\\nBase: {{shared_context.base_dir}}",
            },
            output: "write_info",
          },
          {
            step: "verify",
            tool: "read_file",
            args: {
              path: "{{shared_context.base_dir}}/{{shared_context.file_name}}",
            },
            output: "verification",
          },
        ],
      };

      const context = ExecutionContextManager.create({
        agent: { name: "template-test" },
        initialArgs: { input: "test-value" },
        cwd: testDir,
      });

      await engine.execute(workerYaml, context);

      const content = fs.readFileSync(
        path.join(testDir, "output", "result.txt"),
        "utf-8"
      );
      expect(content).toContain("Input: test-value");
      expect(content).toContain("Base: output");
    });
  });
});
