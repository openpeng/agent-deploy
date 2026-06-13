import { describe, it, expect, beforeEach } from "vitest";
import { ExecutionContextManager } from "../src/runtime/context.js";
import { ExecutionContext, StepResult } from "../src/runtime/types.js";

describe("ExecutionContextManager", () => {
  let context: ExecutionContext;

  beforeEach(() => {
    context = ExecutionContextManager.create({
      agent: { name: "test-agent" },
      initialArgs: { input: "test" },
      cwd: "/test/dir",
      env: { TEST_VAR: "test_value" },
    });
  });

  describe("create", () => {
    it("should create execution context with all fields", () => {
      expect(context.agent).toEqual({ name: "test-agent" });
      expect(context.initialArgs).toEqual({ input: "test" });
      expect(context.sharedContext).toEqual({});
      expect(context.steps.size).toBe(0);
      expect(context.env.TEST_VAR).toBe("test_value");
      expect(context.cwd).toBe("/test/dir");
    });

    it("should use process.cwd and process.env as defaults", () => {
      const defaultContext = ExecutionContextManager.create({
        agent: {},
        initialArgs: {},
      });

      expect(defaultContext.cwd).toBe(process.cwd());
      expect(defaultContext.env).toBeDefined();
    });
  });

  describe("step results", () => {
    it("should store and retrieve step result", () => {
      const result: StepResult = {
        output: "test output",
        success: true,
        duration_ms: 100,
      };

      ExecutionContextManager.setStepResult(context, "step1", result);

      const retrieved = ExecutionContextManager.getStepResult(context, "step1");
      expect(retrieved).toEqual(result);
    });

    it("should return undefined for non-existent step", () => {
      const retrieved = ExecutionContextManager.getStepResult(
        context,
        "nonexistent"
      );
      expect(retrieved).toBeUndefined();
    });

    it("should check if step exists", () => {
      const result: StepResult = {
        output: null,
        success: false,
        duration_ms: 50,
      };

      ExecutionContextManager.setStepResult(context, "step1", result);

      expect(ExecutionContextManager.hasStep(context, "step1")).toBe(true);
      expect(ExecutionContextManager.hasStep(context, "step2")).toBe(false);
    });

    it("should get all step names", () => {
      ExecutionContextManager.setStepResult(context, "step1", {
        output: "a",
        success: true,
        duration_ms: 10,
      });
      ExecutionContextManager.setStepResult(context, "step2", {
        output: "b",
        success: true,
        duration_ms: 20,
      });

      const names = ExecutionContextManager.getStepNames(context);
      expect(names).toEqual(["step1", "step2"]);
    });

    it("should store failed step result with error", () => {
      const result: StepResult = {
        output: null,
        success: false,
        error: new Error("Test error"),
        duration_ms: 100,
      };

      ExecutionContextManager.setStepResult(context, "failed_step", result);

      const retrieved = ExecutionContextManager.getStepResult(
        context,
        "failed_step"
      );
      expect(retrieved?.success).toBe(false);
      expect(retrieved?.error?.message).toBe("Test error");
    });
  });

  describe("shared context", () => {
    it("should set and get shared value", () => {
      ExecutionContextManager.setShared(context, "key1", "value1");

      const value = ExecutionContextManager.getShared(context, "key1");
      expect(value).toBe("value1");
    });

    it("should return undefined for non-existent key", () => {
      const value = ExecutionContextManager.getShared(context, "nonexistent");
      expect(value).toBeUndefined();
    });

    it("should check if key exists", () => {
      ExecutionContextManager.setShared(context, "key1", "value1");

      expect(ExecutionContextManager.hasShared(context, "key1")).toBe(true);
      expect(ExecutionContextManager.hasShared(context, "key2")).toBe(false);
    });

    it("should store complex objects", () => {
      const complexObject = {
        nested: { data: [1, 2, 3] },
        flag: true,
      };

      ExecutionContextManager.setShared(context, "complex", complexObject);

      const retrieved = ExecutionContextManager.getShared(context, "complex");
      expect(retrieved).toEqual(complexObject);
    });
  });

  describe("environment variables", () => {
    it("should get environment variable", () => {
      const value = ExecutionContextManager.getEnv(context, "TEST_VAR");
      expect(value).toBe("test_value");
    });

    it("should return undefined for non-existent env var", () => {
      const value = ExecutionContextManager.getEnv(context, "NONEXISTENT");
      expect(value).toBeUndefined();
    });

    it("should get all environment variables", () => {
      const allEnv = ExecutionContextManager.getAllEnv(context);
      expect(allEnv.TEST_VAR).toBe("test_value");
    });
  });

  describe("accessors", () => {
    it("should get working directory", () => {
      const cwd = ExecutionContextManager.getCwd(context);
      expect(cwd).toBe("/test/dir");
    });

    it("should get agent", () => {
      const agent = ExecutionContextManager.getAgent(context);
      expect(agent).toEqual({ name: "test-agent" });
    });

    it("should get initial arguments", () => {
      const args = ExecutionContextManager.getInitialArgs(context);
      expect(args).toEqual({ input: "test" });
    });
  });

  describe("clone", () => {
    it("should clone context with independent data", () => {
      ExecutionContextManager.setShared(context, "key1", "value1");
      ExecutionContextManager.setStepResult(context, "step1", {
        output: "output1",
        success: true,
        duration_ms: 100,
      });

      const cloned = ExecutionContextManager.clone(context);

      // Modify original
      ExecutionContextManager.setShared(context, "key2", "value2");

      // Cloned should not have the new value
      expect(ExecutionContextManager.hasShared(cloned, "key2")).toBe(false);
      expect(ExecutionContextManager.hasShared(cloned, "key1")).toBe(true);
    });
  });

  describe("getSummary", () => {
    it("should calculate execution summary", () => {
      ExecutionContextManager.setStepResult(context, "step1", {
        output: "a",
        success: true,
        duration_ms: 100,
      });
      ExecutionContextManager.setStepResult(context, "step2", {
        output: "b",
        success: true,
        duration_ms: 200,
      });
      ExecutionContextManager.setStepResult(context, "step3", {
        output: null,
        success: false,
        error: new Error("Failed"),
        duration_ms: 50,
      });

      const summary = ExecutionContextManager.getSummary(context);

      expect(summary.total_steps).toBe(3);
      expect(summary.successful_steps).toBe(2);
      expect(summary.failed_steps).toBe(1);
      expect(summary.total_duration_ms).toBe(350);
    });

    it("should return zeros for empty context", () => {
      const summary = ExecutionContextManager.getSummary(context);

      expect(summary.total_steps).toBe(0);
      expect(summary.successful_steps).toBe(0);
      expect(summary.failed_steps).toBe(0);
      expect(summary.total_duration_ms).toBe(0);
    });
  });

  describe("clearSteps", () => {
    it("should clear all step results", () => {
      ExecutionContextManager.setStepResult(context, "step1", {
        output: "a",
        success: true,
        duration_ms: 100,
      });
      ExecutionContextManager.setStepResult(context, "step2", {
        output: "b",
        success: true,
        duration_ms: 200,
      });

      ExecutionContextManager.clearSteps(context);

      expect(context.steps.size).toBe(0);
      expect(ExecutionContextManager.hasStep(context, "step1")).toBe(false);
    });
  });

  describe("resetSharedContext", () => {
    it("should reset shared context", () => {
      ExecutionContextManager.setShared(context, "key1", "value1");
      ExecutionContextManager.setShared(context, "key2", "value2");

      ExecutionContextManager.resetSharedContext(context);

      expect(context.sharedContext).toEqual({});
      expect(ExecutionContextManager.hasShared(context, "key1")).toBe(false);
    });
  });
});
