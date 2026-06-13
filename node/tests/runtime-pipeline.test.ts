import { describe, it, expect, beforeEach } from "vitest";
import {
  PipelineEngine,
  ToolRegistry,
  Tool,
  ConsoleLogger,
} from "../src/runtime/pipeline.js";
import { ExecutionContextManager } from "../src/runtime/context.js";
import { WorkerYaml, ExecutionContext } from "../src/runtime/types.js";

// Mock tool for testing
class MockTool implements Tool {
  constructor(
    public name: string,
    private handler: (args: any, context: ExecutionContext) => Promise<any>
  ) {}

  async execute(args: any, context: ExecutionContext): Promise<any> {
    return this.handler(args, context);
  }
}

describe("PipelineEngine", () => {
  let engine: PipelineEngine;
  let registry: ToolRegistry;
  let context: ExecutionContext;
  let logger: ConsoleLogger;

  beforeEach(() => {
    registry = new ToolRegistry();
    logger = new ConsoleLogger(false); // Disable verbose logging in tests
    engine = new PipelineEngine(registry, logger);

    context = ExecutionContextManager.create({
      agent: { name: "test-agent" },
      initialArgs: { input: "test-input" },
    });
  });

  describe("basic execution", () => {
    it("should execute a simple pipeline", async () => {
      const echoTool = new MockTool("echo", async (args) => args.message);
      registry.register(echoTool);

      const yaml: WorkerYaml = {
        tools: [{ name: "echo", type: "builtin" }],
        pipeline: [
          {
            step: "step1",
            tool: "echo",
            args: { message: "hello" },
            output: "result",
          },
        ],
      };

      const result = await engine.execute(yaml, context);

      expect(result).toBe("hello");
      expect(ExecutionContextManager.hasStep(context, "step1")).toBe(true);
      expect(ExecutionContextManager.getShared(context, "result")).toBe("hello");
    });

    it("should execute multiple steps in sequence", async () => {
      const addTool = new MockTool("add", async (args) => args.a + args.b);
      const multiplyTool = new MockTool("multiply", async (args) => args.x * args.y);
      registry.register(addTool);
      registry.register(multiplyTool);

      const yaml: WorkerYaml = {
        tools: [
          { name: "add", type: "builtin" },
          { name: "multiply", type: "builtin" },
        ],
        pipeline: [
          { step: "add_step", tool: "add", args: { a: 5, b: 3 }, output: "sum" },
          {
            step: "multiply_step",
            tool: "multiply",
            args: { x: 10, y: 2 },
            output: "product",
          },
        ],
      };

      await engine.execute(yaml, context);

      expect(ExecutionContextManager.getShared(context, "sum")).toBe(8);
      expect(ExecutionContextManager.getShared(context, "product")).toBe(20);
    });

    it("should throw error for non-existent tool", async () => {
      const yaml: WorkerYaml = {
        tools: [{ name: "nonexistent", type: "builtin" }],
        pipeline: [{ step: "step1", tool: "nonexistent" }],
      };

      await expect(engine.execute(yaml, context)).rejects.toThrow(
        "Tool not found: nonexistent"
      );
    });
  });

  describe("template variables", () => {
    it("should resolve initial args", async () => {
      const echoTool = new MockTool("echo", async (args) => args.message);
      registry.register(echoTool);

      const yaml: WorkerYaml = {
        tools: [{ name: "echo", type: "builtin" }],
        pipeline: [
          {
            step: "step1",
            tool: "echo",
            args: { message: "{{input}}" },
          },
        ],
      };

      const result = await engine.execute(yaml, context);

      expect(result).toBe("test-input");
    });

    it("should resolve step outputs", async () => {
      const echoTool = new MockTool("echo", async (args) => args.message);
      registry.register(echoTool);

      const yaml: WorkerYaml = {
        tools: [{ name: "echo", type: "builtin" }],
        pipeline: [
          {
            step: "step1",
            tool: "echo",
            args: { message: "hello" },
            output: "greeting",
          },
          {
            step: "step2",
            tool: "echo",
            args: { message: "{{steps.step1.output}}" },
          },
        ],
      };

      const result = await engine.execute(yaml, context);

      expect(result).toBe("hello");
    });

    it("should resolve shared context", async () => {
      const echoTool = new MockTool("echo", async (args) => args.message);
      registry.register(echoTool);

      const yaml: WorkerYaml = {
        tools: [{ name: "echo", type: "builtin" }],
        shared_context: { prefix: "Hello" },
        pipeline: [
          {
            step: "step1",
            tool: "echo",
            args: { message: "{{shared_context.prefix}} World" },
          },
        ],
      };

      const result = await engine.execute(yaml, context);

      expect(result).toBe("Hello World");
    });

    it("should resolve environment variables", async () => {
      const echoTool = new MockTool("echo", async (args) => args.message);
      registry.register(echoTool);

      context = ExecutionContextManager.create({
        agent: { name: "test-agent" },
        initialArgs: {},
        env: { TEST_VAR: "test-value" },
      });

      const yaml: WorkerYaml = {
        tools: [{ name: "echo", type: "builtin" }],
        pipeline: [
          {
            step: "step1",
            tool: "echo",
            args: { message: "{{env.TEST_VAR}}" },
          },
        ],
      };

      const result = await engine.execute(yaml, context);

      expect(result).toBe("test-value");
    });

    it("should preserve type for single variable references", async () => {
      const returnTool = new MockTool("return", async (args) => args.value);
      registry.register(returnTool);

      context = ExecutionContextManager.create({
        agent: { name: "test-agent" },
        initialArgs: { number: 42, flag: true, obj: { nested: "value" } },
      });

      const yaml: WorkerYaml = {
        tools: [{ name: "return", type: "builtin" }],
        pipeline: [
          { step: "step1", tool: "return", args: { value: "{{number}}" } },
        ],
      };

      const result = await engine.execute(yaml, context);

      expect(result).toBe(42);
      expect(typeof result).toBe("number");
    });
  });

  describe("conditional execution", () => {
    it("should skip step when condition is false", async () => {
      const echoTool = new MockTool("echo", async (args) => args.message);
      registry.register(echoTool);

      const yaml: WorkerYaml = {
        tools: [{ name: "echo", type: "builtin" }],
        pipeline: [
          {
            step: "step1",
            tool: "echo",
            args: { message: "should skip" },
            when: "false",
          },
        ],
      };

      await engine.execute(yaml, context);

      expect(ExecutionContextManager.hasStep(context, "step1")).toBe(false);
    });

    it("should execute step when condition is true", async () => {
      const echoTool = new MockTool("echo", async (args) => args.message);
      registry.register(echoTool);

      const yaml: WorkerYaml = {
        tools: [{ name: "echo", type: "builtin" }],
        pipeline: [
          {
            step: "step1",
            tool: "echo",
            args: { message: "should execute" },
            when: "true",
          },
        ],
      };

      const result = await engine.execute(yaml, context);

      expect(result).toBe("should execute");
    });

    it("should evaluate condition based on step success", async () => {
      const successTool = new MockTool("success", async () => "ok");
      const echoTool = new MockTool("echo", async (args) => args.message);
      registry.register(successTool);
      registry.register(echoTool);

      const yaml: WorkerYaml = {
        tools: [
          { name: "success", type: "builtin" },
          { name: "echo", type: "builtin" },
        ],
        pipeline: [
          { step: "step1", tool: "success", output: "result" },
          {
            step: "step2",
            tool: "echo",
            args: { message: "success!" },
            when: "{{steps.step1.success}}",
          },
        ],
      };

      const result = await engine.execute(yaml, context);

      expect(result).toBe("success!");
    });
  });

  describe("error handling", () => {
    it("should abort pipeline on error by default", async () => {
      const failTool = new MockTool("fail", async () => {
        throw new Error("Test error");
      });
      registry.register(failTool);

      const yaml: WorkerYaml = {
        tools: [{ name: "fail", type: "builtin" }],
        pipeline: [{ step: "step1", tool: "fail" }],
      };

      await expect(engine.execute(yaml, context)).rejects.toThrow("Test error");
    });

    it("should skip failed step with on_fail: skip", async () => {
      const failTool = new MockTool("fail", async () => {
        throw new Error("Test error");
      });
      const successTool = new MockTool("success", async () => "ok");
      registry.register(failTool);
      registry.register(successTool);

      const yaml: WorkerYaml = {
        tools: [
          { name: "fail", type: "builtin" },
          { name: "success", type: "builtin" },
        ],
        pipeline: [
          { step: "step1", tool: "fail", on_fail: "skip" },
          { step: "step2", tool: "success" },
        ],
      };

      const result = await engine.execute(yaml, context);

      expect(result).toBe("ok");
      expect(ExecutionContextManager.hasStep(context, "step1")).toBe(true);
      expect(ExecutionContextManager.getStepResult(context, "step1")?.success).toBe(
        false
      );
    });

    it("should continue after error with on_fail: continue", async () => {
      const failTool = new MockTool("fail", async () => {
        throw new Error("Test error");
      });
      const successTool = new MockTool("success", async () => "ok");
      registry.register(failTool);
      registry.register(successTool);

      const yaml: WorkerYaml = {
        tools: [
          { name: "fail", type: "builtin" },
          { name: "success", type: "builtin" },
        ],
        pipeline: [
          { step: "step1", tool: "fail", on_fail: "continue" },
          { step: "step2", tool: "success" },
        ],
      };

      const result = await engine.execute(yaml, context);

      expect(result).toBe("ok");
    });

    it("should retry failed step with on_fail: retry", async () => {
      let attempts = 0;
      const flakeyTool = new MockTool("flakey", async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Fail");
        }
        return "success";
      });
      registry.register(flakeyTool);

      const yaml: WorkerYaml = {
        tools: [{ name: "flakey", type: "builtin" }],
        pipeline: [
          {
            step: "step1",
            tool: "flakey",
            on_fail: { retry: 3 },
          },
        ],
      };

      const result = await engine.execute(yaml, context);

      expect(result).toBe("success");
      expect(attempts).toBe(3);
    });

    it("should fail after exhausting retries", async () => {
      const failTool = new MockTool("fail", async () => {
        throw new Error("Always fails");
      });
      registry.register(failTool);

      const yaml: WorkerYaml = {
        tools: [{ name: "fail", type: "builtin" }],
        pipeline: [
          {
            step: "step1",
            tool: "fail",
            on_fail: { retry: 2 },
          },
        ],
      };

      await expect(engine.execute(yaml, context)).rejects.toThrow("Always fails");
    });
  });

  describe("data passing between steps", () => {
    it("should pass data through output variable", async () => {
      const producerTool = new MockTool("producer", async () => ({
        data: "test-data",
      }));
      const consumerTool = new MockTool("consumer", async (args) => args.input);
      registry.register(producerTool);
      registry.register(consumerTool);

      const yaml: WorkerYaml = {
        tools: [
          { name: "producer", type: "builtin" },
          { name: "consumer", type: "builtin" },
        ],
        pipeline: [
          { step: "produce", tool: "producer", output: "data" },
          {
            step: "consume",
            tool: "consumer",
            args: { input: "{{shared_context.data}}" },
          },
        ],
      };

      const result = await engine.execute(yaml, context);

      expect(result).toEqual({ data: "test-data" });
    });
  });
});
