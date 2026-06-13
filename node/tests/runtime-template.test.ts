import { describe, it, expect, beforeEach } from "vitest";
import { TemplateResolver } from "../src/runtime/template.js";
import { ExecutionContextManager } from "../src/runtime/context.js";
import { ExecutionContext } from "../src/runtime/types.js";

describe("TemplateResolver", () => {
  let resolver: TemplateResolver;
  let context: ExecutionContext;

  beforeEach(() => {
    resolver = new TemplateResolver();
    context = ExecutionContextManager.create({
      agent: { name: "test-agent" },
      initialArgs: {
        name: "Alice",
        age: 30,
        flag: true,
        nested: { value: "nested-value", count: 42 },
      },
      env: { API_KEY: "secret-key", PORT: "3000" },
    });

    // Add some step results
    ExecutionContextManager.setStepResult(context, "step1", {
      output: "result1",
      success: true,
      duration_ms: 100,
    });

    ExecutionContextManager.setStepResult(context, "step2", {
      output: { data: "complex", number: 123 },
      success: true,
      duration_ms: 200,
    });

    ExecutionContextManager.setStepResult(context, "failed_step", {
      output: null,
      success: false,
      error: new Error("Step failed"),
      duration_ms: 50,
    });

    // Add shared context
    ExecutionContextManager.setShared(context, "greeting", "Hello");
    ExecutionContextManager.setShared(context, "config", { timeout: 5000 });
  });

  describe("resolve simple variables", () => {
    it("should resolve initial args", () => {
      const result = resolver.resolve("{{name}}", context);
      expect(result).toBe("Alice");
    });

    it("should resolve number and preserve type", () => {
      const result = resolver.resolve("{{age}}", context);
      expect(result).toBe(30);
      expect(typeof result).toBe("number");
    });

    it("should resolve boolean and preserve type", () => {
      const result = resolver.resolve("{{flag}}", context);
      expect(result).toBe(true);
      expect(typeof result).toBe("boolean");
    });

    it("should resolve in the middle of string", () => {
      const result = resolver.resolve("Hello {{name}}!", context);
      expect(result).toBe("Hello Alice!");
    });

    it("should resolve multiple variables in string", () => {
      const result = resolver.resolve("{{name}} is {{age}} years old", context);
      expect(result).toBe("Alice is 30 years old");
    });

    it("should return undefined for non-existent variable", () => {
      const result = resolver.resolve("{{nonexistent}}", context);
      expect(result).toBeUndefined();
    });

    it("should keep placeholder for undefined in string", () => {
      const result = resolver.resolve("Value: {{nonexistent}}", context);
      expect(result).toBe("Value: {{nonexistent}}");
    });
  });

  describe("resolve nested paths", () => {
    it("should resolve nested object path", () => {
      const result = resolver.resolve("{{nested.value}}", context);
      expect(result).toBe("nested-value");
    });

    it("should resolve deeply nested path", () => {
      const result = resolver.resolve("{{nested.count}}", context);
      expect(result).toBe(42);
    });

    it("should return undefined for invalid nested path", () => {
      const result = resolver.resolve("{{nested.invalid.path}}", context);
      expect(result).toBeUndefined();
    });
  });

  describe("resolve step outputs", () => {
    it("should resolve step output", () => {
      const result = resolver.resolve("{{steps.step1.output}}", context);
      expect(result).toBe("result1");
    });

    it("should resolve step success flag", () => {
      const result = resolver.resolve("{{steps.step1.success}}", context);
      expect(result).toBe(true);
    });

    it("should resolve failed step success flag", () => {
      const result = resolver.resolve("{{steps.failed_step.success}}", context);
      expect(result).toBe(false);
    });

    it("should resolve complex step output", () => {
      const result = resolver.resolve("{{steps.step2.output}}", context);
      expect(result).toEqual({ data: "complex", number: 123 });
    });

    it("should return undefined for non-existent step", () => {
      const result = resolver.resolve("{{steps.nonexistent.output}}", context);
      expect(result).toBeUndefined();
    });
  });

  describe("resolve shared context", () => {
    it("should resolve shared context value", () => {
      const result = resolver.resolve("{{shared_context.greeting}}", context);
      expect(result).toBe("Hello");
    });

    it("should resolve shared context object", () => {
      const result = resolver.resolve("{{shared_context.config}}", context);
      expect(result).toEqual({ timeout: 5000 });
    });

    it("should resolve nested shared context", () => {
      const result = resolver.resolve(
        "{{shared_context.config.timeout}}",
        context
      );
      expect(result).toBe(5000);
    });
  });

  describe("resolve environment variables", () => {
    it("should resolve env variable", () => {
      const result = resolver.resolve("{{env.API_KEY}}", context);
      expect(result).toBe("secret-key");
    });

    it("should resolve env variable in string", () => {
      const result = resolver.resolve("Key: {{env.API_KEY}}", context);
      expect(result).toBe("Key: secret-key");
    });

    it("should return undefined for non-existent env var", () => {
      const result = resolver.resolve("{{env.NONEXISTENT}}", context);
      expect(result).toBeUndefined();
    });
  });

  describe("resolve arrays", () => {
    it("should resolve variables in array", () => {
      const template = ["{{name}}", "{{age}}", "static"];
      const result = resolver.resolve(template, context);
      expect(result).toEqual(["Alice", 30, "static"]);
    });

    it("should resolve nested arrays", () => {
      const template = [["{{name}}", "{{age}}"], ["{{flag}}"]];
      const result = resolver.resolve(template, context);
      expect(result).toEqual([["Alice", 30], [true]]);
    });
  });

  describe("resolve objects", () => {
    it("should resolve variables in object", () => {
      const template = {
        user: "{{name}}",
        age: "{{age}}",
        greeting: "Hello {{name}}",
      };
      const result = resolver.resolve(template, context);
      expect(result).toEqual({
        user: "Alice",
        age: 30,
        greeting: "Hello Alice",
      });
    });

    it("should resolve nested objects", () => {
      const template = {
        user: {
          name: "{{name}}",
          age: "{{age}}",
        },
        meta: {
          active: "{{flag}}",
        },
      };
      const result = resolver.resolve(template, context);
      expect(result).toEqual({
        user: {
          name: "Alice",
          age: 30,
        },
        meta: {
          active: true,
        },
      });
    });

    it("should resolve mixed array and object", () => {
      const template = {
        names: ["{{name}}", "Bob"],
        ages: { alice: "{{age}}", bob: 25 },
      };
      const result = resolver.resolve(template, context);
      expect(result).toEqual({
        names: ["Alice", "Bob"],
        ages: { alice: 30, bob: 25 },
      });
    });
  });

  describe("hasTemplateVars", () => {
    it("should detect template variables", () => {
      expect(resolver.hasTemplateVars("{{var}}")).toBe(true);
      expect(resolver.hasTemplateVars("Hello {{name}}")).toBe(true);
      expect(resolver.hasTemplateVars("No vars here")).toBe(false);
      expect(resolver.hasTemplateVars("")).toBe(false);
    });
  });

  describe("extractVariablePaths", () => {
    it("should extract single variable", () => {
      const paths = resolver.extractVariablePaths("{{name}}");
      expect(paths).toEqual(["name"]);
    });

    it("should extract multiple variables", () => {
      const paths = resolver.extractVariablePaths("{{name}} is {{age}}");
      expect(paths).toEqual(["name", "age"]);
    });

    it("should extract complex paths", () => {
      const paths = resolver.extractVariablePaths(
        "{{steps.step1.output}} and {{shared_context.key}}"
      );
      expect(paths).toEqual(["steps.step1.output", "shared_context.key"]);
    });

    it("should return empty array for no variables", () => {
      const paths = resolver.extractVariablePaths("No vars");
      expect(paths).toEqual([]);
    });
  });

  describe("edge cases", () => {
    it("should handle null and undefined", () => {
      expect(resolver.resolve(null, context)).toBeNull();
      expect(resolver.resolve(undefined, context)).toBeUndefined();
    });

    it("should handle numbers", () => {
      expect(resolver.resolve(42, context)).toBe(42);
    });

    it("should handle booleans", () => {
      expect(resolver.resolve(true, context)).toBe(true);
    });

    it("should handle empty string", () => {
      expect(resolver.resolve("", context)).toBe("");
    });

    it("should handle string without variables", () => {
      expect(resolver.resolve("plain text", context)).toBe("plain text");
    });
  });
});
