import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SubagentExecutor } from "../../src/runtime/subagent.js";
import { ExecutionContextManager } from "../../src/runtime/context.js";
import { ToolRegistry } from "../../src/runtime/tool-registry.js";
import { Tool } from "../../src/runtime/pipeline.js";
import { ExecutionContext, WorkerYaml } from "../../src/runtime/types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock tool for testing
class MockTool implements Tool {
  constructor(public name: string) {}

  async execute(args: any, context: ExecutionContext): Promise<any> {
    return {
      tool: this.name,
      args,
      cwd: context.cwd,
      agent: context.agent.name,
    };
  }
}

describe("SubagentExecutor", () => {
  let executor: SubagentExecutor;
  let parentRegistry: ToolRegistry;
  let parentContext: ExecutionContext;
  let testDir: string;

  beforeEach(() => {
    executor = new SubagentExecutor();

    // Create parent registry with some tools
    parentRegistry = new ToolRegistry();
    parentRegistry.register(new MockTool("parent_tool"));
    parentRegistry.register(new MockTool("shared_tool"));

    // Create parent context
    parentContext = ExecutionContextManager.create({
      agent: { name: "parent-agent" },
      initialArgs: { parentArg: "value" },
      cwd: process.cwd(),
    });

    // Create temporary test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-test-"));
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("executeInline", () => {
    it("should execute subagent with inherited tools", async () => {
      const workerYaml: WorkerYaml = {
        pipeline: [
          {
            step: "use_parent_tool",
            tool: "parent_tool",
            args: { test: "value" },
          },
        ],
      };

      const result = await executor.executeInline(
        workerYaml,
        { subArg: "test" },
        parentContext,
        parentRegistry
      );

      expect(result.tool).toBe("parent_tool");
      expect(result.args.test).toBe("value");
    });

    it("should create isolated execution context", async () => {
      const workerYaml: WorkerYaml = {
        pipeline: [
          {
            step: "check_context",
            tool: "parent_tool",
            args: {},
          },
        ],
      };

      const result = await executor.executeInline(
        workerYaml,
        {},
        parentContext,
        parentRegistry,
        { agentName: "child-agent", cwd: "/child/path" }
      );

      expect(result.agent).toBe("child-agent");
      expect(result.cwd).toBe("/child/path");
    });

    it("should inherit parent environment variables", async () => {
      const parentContextWithEnv = ExecutionContextManager.create({
        agent: { name: "parent" },
        initialArgs: {},
        cwd: process.cwd(),
        env: { PARENT_VAR: "parent_value" },
      });

      // Create tool that checks env
      const envCheckTool: Tool = {
        name: "env_check",
        async execute(args: any, context: ExecutionContext) {
          return context.env;
        },
      };
      parentRegistry.register(envCheckTool);

      const workerYaml: WorkerYaml = {
        pipeline: [
          {
            step: "check_env",
            tool: "env_check",
            args: {},
          },
        ],
      };

      const result = await executor.executeInline(
        workerYaml,
        {},
        parentContextWithEnv,
        parentRegistry
      );

      expect(result.PARENT_VAR).toBe("parent_value");
    });

    it("should allow subagent to register its own tools", async () => {
      const workerYaml: WorkerYaml = {
        pipeline: [
          {
            step: "use_parent",
            tool: "parent_tool",
            args: { step: 1 },
          },
        ],
      };

      // Execute first subagent
      const result1 = await executor.executeInline(
        workerYaml,
        {},
        parentContext,
        parentRegistry
      );

      expect(result1.tool).toBe("parent_tool");

      // Parent should still only have its original tools
      expect(parentRegistry.listLocal()).toHaveLength(2);
    });

    it("should handle multi-step pipelines", async () => {
      const workerYaml: WorkerYaml = {
        pipeline: [
          {
            step: "step1",
            tool: "parent_tool",
            args: { value: 1 },
            output: "result1",
          },
          {
            step: "step2",
            tool: "shared_tool",
            args: { value: 2 },
          },
        ],
      };

      const result = await executor.executeInline(
        workerYaml,
        {},
        parentContext,
        parentRegistry
      );

      // Should return result from last step
      expect(result.tool).toBe("shared_tool");
      expect(result.args.value).toBe(2);
    });

    it("should handle errors in subagent execution", async () => {
      const errorTool: Tool = {
        name: "error_tool",
        async execute() {
          throw new Error("Subagent error");
        },
      };
      parentRegistry.register(errorTool);

      const workerYaml: WorkerYaml = {
        pipeline: [
          {
            step: "fail",
            tool: "error_tool",
            args: {},
          },
        ],
      };

      await expect(
        executor.executeInline(workerYaml, {}, parentContext, parentRegistry)
      ).rejects.toThrow("Subagent error");
    });

    it("should pass initial arguments to subagent context", async () => {
      const argCheckTool: Tool = {
        name: "arg_check",
        async execute(args: any, context: ExecutionContext) {
          return {
            initialArgs: context.initialArgs,
            stepArgs: args,
          };
        },
      };
      parentRegistry.register(argCheckTool);

      const workerYaml: WorkerYaml = {
        pipeline: [
          {
            step: "check",
            tool: "arg_check",
            args: { stepArg: "step_value" },
          },
        ],
      };

      const result = await executor.executeInline(
        workerYaml,
        { subArg: "test_value" },
        parentContext,
        parentRegistry
      );

      expect(result.initialArgs.subArg).toBe("test_value");
      expect(result.stepArgs.stepArg).toBe("step_value");
    });

    it("should support shared_context initialization", async () => {
      const sharedCheckTool: Tool = {
        name: "shared_check",
        async execute(args: any, context: ExecutionContext) {
          return ExecutionContextManager.getShared(context, "initial_value");
        },
      };
      parentRegistry.register(sharedCheckTool);

      const workerYaml: WorkerYaml = {
        shared_context: {
          initial_value: 42,
        },
        pipeline: [
          {
            step: "read_shared",
            tool: "shared_check",
            args: {},
          },
        ],
      };

      const result = await executor.executeInline(
        workerYaml,
        {},
        parentContext,
        parentRegistry
      );

      expect(result).toBe(42);
    });

    it("should default agent name and cwd if not provided", async () => {
      const workerYaml: WorkerYaml = {
        pipeline: [
          {
            step: "check",
            tool: "parent_tool",
            args: {},
          },
        ],
      };

      const result = await executor.executeInline(
        workerYaml,
        {},
        parentContext,
        parentRegistry
      );

      expect(result.agent).toBe("inline-subagent");
      expect(result.cwd).toBe(parentContext.cwd);
    });
  });

  describe("execute (file-based)", () => {
    it("should load and execute subagent from directory", async () => {
      // Create test agent directory
      const agentDir = path.join(testDir, "test-agent");
      fs.mkdirSync(agentDir, { recursive: true });

      // Create agent.json
      const agentJson = {
        name: "test-subagent",
        version: "1.0.0",
      };
      fs.writeFileSync(
        path.join(agentDir, "agent.json"),
        JSON.stringify(agentJson, null, 2)
      );

      // Create worker.yaml
      const workerYaml = `
pipeline:
  - step: execute
    tool: parent_tool
    args:
      test: "file-based"
`;
      fs.writeFileSync(path.join(agentDir, "worker.yaml"), workerYaml);

      const result = await executor.execute(
        agentDir,
        {},
        parentContext,
        parentRegistry
      );

      expect(result.tool).toBe("parent_tool");
      expect(result.args.test).toBe("file-based");
      expect(result.agent).toBe("test-subagent");
    });

    it("should throw error if agent path not found", async () => {
      await expect(
        executor.execute(
          "/nonexistent/path",
          {},
          parentContext,
          parentRegistry
        )
      ).rejects.toThrow("Subagent path not found");
    });

    it("should throw error if worker.yaml not found", async () => {
      const agentDir = path.join(testDir, "no-worker");
      fs.mkdirSync(agentDir, { recursive: true });

      await expect(
        executor.execute(agentDir, {}, parentContext, parentRegistry)
      ).rejects.toThrow("worker.yaml not found");
    });

    it("should use directory name as agent name if agent.json missing", async () => {
      const agentDir = path.join(testDir, "my-agent");
      fs.mkdirSync(agentDir, { recursive: true });

      const workerYaml = `
pipeline:
  - step: execute
    tool: parent_tool
    args: {}
`;
      fs.writeFileSync(path.join(agentDir, "worker.yaml"), workerYaml);

      const result = await executor.execute(
        agentDir,
        {},
        parentContext,
        parentRegistry
      );

      expect(result.agent).toBe("my-agent");
    });

    it("should run subagent in its own directory", async () => {
      const agentDir = path.join(testDir, "dir-test-agent");
      fs.mkdirSync(agentDir, { recursive: true });

      const workerYaml = `
pipeline:
  - step: check_cwd
    tool: parent_tool
    args: {}
`;
      fs.writeFileSync(path.join(agentDir, "worker.yaml"), workerYaml);

      const result = await executor.execute(
        agentDir,
        {},
        parentContext,
        parentRegistry
      );

      expect(result.cwd).toBe(agentDir);
    });
  });
});
