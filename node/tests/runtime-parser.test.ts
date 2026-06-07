import { describe, it, expect } from "vitest";
import { WorkerYamlParser } from "../src/runtime/parser.js";
import { WorkerYaml } from "../src/runtime/types.js";

describe("WorkerYamlParser", () => {
  const parser = new WorkerYamlParser();

  describe("parseString", () => {
    it("should parse valid worker.yaml", () => {
      const yamlContent = `
tools:
  - name: llm_chat
    type: builtin

pipeline:
  - step: process
    tool: llm_chat
    args:
      prompt: "Test"
    output: result
`;

      const result = parser.parseString(yamlContent);

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe("llm_chat");
      expect(result.tools[0].type).toBe("builtin");
      expect(result.pipeline).toHaveLength(1);
      expect(result.pipeline[0].step).toBe("process");
      expect(result.pipeline[0].tool).toBe("llm_chat");
    });

    it("should parse shared_context", () => {
      const yamlContent = `
tools:
  - name: test
    type: builtin

shared_context:
  key1: value1
  key2: 123

pipeline:
  - step: test_step
    tool: test
`;

      const result = parser.parseString(yamlContent);

      expect(result.shared_context).toEqual({
        key1: "value1",
        key2: 123,
      });
    });

    it("should throw error for invalid YAML", () => {
      const invalidYaml = `
tools:
  - name: test
    type: builtin
  invalid yaml syntax [
`;

      expect(() => parser.parseString(invalidYaml)).toThrow(
        "Failed to parse YAML"
      );
    });

    it("should throw error if tools is not an array", () => {
      const yamlContent = `
tools: not_an_array
pipeline:
  - step: test
    tool: test
`;

      expect(() => parser.parseString(yamlContent)).toThrow(
        "'tools' must be an array"
      );
    });
  });

  describe("validate", () => {
    it("should validate correct worker.yaml", () => {
      const workerYaml: WorkerYaml = {
        tools: [
          { name: "llm_chat", type: "builtin" },
          { name: "read_file", type: "builtin" },
        ],
        pipeline: [
          {
            step: "read",
            tool: "read_file",
            args: { path: "test.txt" },
            output: "content",
          },
          {
            step: "process",
            tool: "llm_chat",
            args: { prompt: "{{content}}" },
            output: "result",
          },
        ],
      };

      const result = parser.validate(workerYaml);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect missing tools array", () => {
      const workerYaml: any = {
        tools: [],
        pipeline: [{ step: "test", tool: "test" }],
      };

      const result = parser.validate(workerYaml);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "'tools' array is required and must not be empty"
      );
    });

    it("should detect missing pipeline array", () => {
      const workerYaml: any = {
        tools: [{ name: "test", type: "builtin" }],
        pipeline: [],
      };

      const result = parser.validate(workerYaml);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "'pipeline' array is required and must not be empty"
      );
    });

    it("should detect duplicate tool names", () => {
      const workerYaml: WorkerYaml = {
        tools: [
          { name: "test", type: "builtin" },
          { name: "test", type: "builtin" },
        ],
        pipeline: [{ step: "test_step", tool: "test" }],
      };

      const result = parser.validate(workerYaml);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Duplicate tool name: test");
    });

    it("should detect duplicate step names", () => {
      const workerYaml: WorkerYaml = {
        tools: [{ name: "test", type: "builtin" }],
        pipeline: [
          { step: "step1", tool: "test" },
          { step: "step1", tool: "test" },
        ],
      };

      const result = parser.validate(workerYaml);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Duplicate step name: step1");
    });

    it("should detect undefined tool reference", () => {
      const workerYaml: WorkerYaml = {
        tools: [{ name: "llm_chat", type: "builtin" }],
        pipeline: [
          { step: "read", tool: "read_file" }, // read_file not defined
        ],
      };

      const result = parser.validate(workerYaml);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Step 'read' references undefined tool: read_file"
      );
    });

    it("should validate on_fail strategies", () => {
      const workerYaml: WorkerYaml = {
        tools: [{ name: "test", type: "builtin" }],
        pipeline: [
          { step: "step1", tool: "test", on_fail: "abort" },
          { step: "step2", tool: "test", on_fail: "skip" },
          { step: "step3", tool: "test", on_fail: "continue" },
          { step: "step4", tool: "test", on_fail: { retry: 3 } },
        ],
      };

      const result = parser.validate(workerYaml);

      expect(result.valid).toBe(true);
    });

    it("should detect invalid on_fail strategy", () => {
      const workerYaml: any = {
        tools: [{ name: "test", type: "builtin" }],
        pipeline: [{ step: "step1", tool: "test", on_fail: "invalid" }],
      };

      const result = parser.validate(workerYaml);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Step 'step1' has invalid on_fail strategy: invalid"
      );
    });
  });
});
