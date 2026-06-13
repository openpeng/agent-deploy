import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { V2CompatibilityLayer } from "../../src/runtime/v2-compat.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("V2CompatibilityLayer", () => {
  let compat: V2CompatibilityLayer;
  let testDir: string;

  beforeEach(() => {
    compat = new V2CompatibilityLayer();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "v2-compat-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("isV2Agent", () => {
    it("should detect v2 agent by schema_version", () => {
      const agentJsonPath = path.join(testDir, "agent.json");
      const v2Agent = {
        schema_version: "2.0",
        identity: { name: "test" },
        instructions: { content: "Test instructions" },
      };

      fs.writeFileSync(agentJsonPath, JSON.stringify(v2Agent, null, 2));

      expect(compat.isV2Agent(agentJsonPath)).toBe(true);
    });

    it("should detect v2 agent by instructions field without worker.yaml", () => {
      const agentJsonPath = path.join(testDir, "agent.json");
      const v2Agent = {
        identity: { name: "test" },
        instructions: { content: "Test instructions" },
      };

      fs.writeFileSync(agentJsonPath, JSON.stringify(v2Agent, null, 2));

      expect(compat.isV2Agent(agentJsonPath)).toBe(true);
    });

    it("should not detect v3 agent with worker.yaml", () => {
      const agentJsonPath = path.join(testDir, "agent.json");
      const workerYamlPath = path.join(testDir, "worker.yaml");

      const v3Agent = {
        schema_version: "3.0",
        identity: { name: "test" },
      };

      fs.writeFileSync(agentJsonPath, JSON.stringify(v3Agent, null, 2));
      fs.writeFileSync(workerYamlPath, "pipeline: []");

      expect(compat.isV2Agent(agentJsonPath)).toBe(false);
    });

    it("should return false for non-existent file", () => {
      expect(compat.isV2Agent("/nonexistent/path.json")).toBe(false);
    });

    it("should return false for invalid JSON", () => {
      const agentJsonPath = path.join(testDir, "agent.json");
      fs.writeFileSync(agentJsonPath, "{ invalid json");

      expect(compat.isV2Agent(agentJsonPath)).toBe(false);
    });
  });

  describe("convertToV3WorkerYaml", () => {
    it("should convert v2 agent to worker.yaml", () => {
      const agentJsonPath = path.join(testDir, "agent.json");
      const v2Agent = {
        schema_version: "2.0",
        identity: {
          name: "code-reviewer",
          version: "1.0.0",
        },
        instructions: {
          format: "markdown",
          source: "inline",
          content: "You are a code reviewer. Find bugs and suggest improvements.",
        },
      };

      fs.writeFileSync(agentJsonPath, JSON.stringify(v2Agent, null, 2));

      const workerYaml = compat.convertToV3WorkerYaml(agentJsonPath);

      expect(workerYaml).toBeDefined();
      expect(workerYaml.pipeline).toHaveLength(1);
      expect(workerYaml.pipeline[0].tool).toBe("llm_chat");
      expect(workerYaml.pipeline[0].args.system_prompt).toContain("code reviewer");
      expect(workerYaml.pipeline[0].args.prompt).toBe("{{input}}");
      expect(workerYaml.pipeline[0].output).toBe("result");
    });

    it("should handle agent without instructions", () => {
      const agentJsonPath = path.join(testDir, "agent.json");
      const v2Agent = {
        identity: { name: "test" },
      };

      fs.writeFileSync(agentJsonPath, JSON.stringify(v2Agent, null, 2));

      const workerYaml = compat.convertToV3WorkerYaml(agentJsonPath);

      expect(workerYaml.pipeline[0].args.system_prompt).toBe("");
    });

    it("should use agent name from identity", () => {
      const agentJsonPath = path.join(testDir, "agent.json");
      const v2Agent = {
        identity: {
          name: "my-special-agent",
        },
        instructions: {
          content: "Test",
        },
      };

      fs.writeFileSync(agentJsonPath, JSON.stringify(v2Agent, null, 2));

      const workerYaml = compat.convertToV3WorkerYaml(agentJsonPath);

      // Worker yaml should work for any agent name
      expect(workerYaml.pipeline).toBeDefined();
    });

    it("should set default model and temperature", () => {
      const agentJsonPath = path.join(testDir, "agent.json");
      const v2Agent = {
        identity: { name: "test" },
        instructions: { content: "Test" },
      };

      fs.writeFileSync(agentJsonPath, JSON.stringify(v2Agent, null, 2));

      const workerYaml = compat.convertToV3WorkerYaml(agentJsonPath);

      expect(workerYaml.pipeline[0].args.model).toBe("claude-3-5-sonnet-20241022");
      expect(workerYaml.pipeline[0].args.temperature).toBe(0.7);
    });
  });

  describe("getWorkerYaml", () => {
    it("should load existing worker.yaml for v3 agent", () => {
      const workerYamlPath = path.join(testDir, "worker.yaml");
      const agentJsonPath = path.join(testDir, "agent.json");

      const v3Agent = {
        schema_version: "3.0",
        identity: { name: "test" },
      };

      const workerYamlContent = `
pipeline:
  - step: test
    tool: bash
    args:
      command: echo "test"
`;

      fs.writeFileSync(agentJsonPath, JSON.stringify(v3Agent, null, 2));
      fs.writeFileSync(workerYamlPath, workerYamlContent);

      const workerYaml = compat.getWorkerYaml(testDir);

      expect(workerYaml.pipeline).toHaveLength(1);
      expect(workerYaml.pipeline[0].tool).toBe("bash");
    });

    it("should auto-convert v2 agent", () => {
      const agentJsonPath = path.join(testDir, "agent.json");
      const v2Agent = {
        schema_version: "2.0",
        identity: { name: "test" },
        instructions: { content: "Do something" },
      };

      fs.writeFileSync(agentJsonPath, JSON.stringify(v2Agent, null, 2));

      const workerYaml = compat.getWorkerYaml(testDir);

      expect(workerYaml.pipeline).toHaveLength(1);
      expect(workerYaml.pipeline[0].tool).toBe("llm_chat");
    });

    it("should throw for agent without worker.yaml and not v2", () => {
      const agentJsonPath = path.join(testDir, "agent.json");
      const invalidAgent = {
        schema_version: "3.0",
        identity: { name: "test" },
        // No instructions, no worker.yaml
      };

      fs.writeFileSync(agentJsonPath, JSON.stringify(invalidAgent, null, 2));

      expect(() => compat.getWorkerYaml(testDir)).toThrow();
    });
  });

  describe("getMigrationInfo", () => {
    it("should provide info for v2 agent without worker.yaml", () => {
      const agentJsonPath = path.join(testDir, "agent.json");
      const v2Agent = {
        schema_version: "2.0",
        identity: { name: "test" },
        instructions: { content: "Test" },
      };

      fs.writeFileSync(agentJsonPath, JSON.stringify(v2Agent, null, 2));

      const info = compat.getMigrationInfo(agentJsonPath);

      expect(info.is_v2).toBe(true);
      expect(info.has_worker_yaml).toBe(false);
      expect(info.can_auto_convert).toBe(true);
      expect(info.suggestions).toHaveLength(3);
      expect(info.suggestions[0]).toContain("v2 agent");
    });

    it("should provide info for v3 agent with worker.yaml", () => {
      const agentJsonPath = path.join(testDir, "agent.json");
      const workerYamlPath = path.join(testDir, "worker.yaml");

      const v3Agent = {
        schema_version: "3.0",
        identity: { name: "test" },
      };

      fs.writeFileSync(agentJsonPath, JSON.stringify(v3Agent, null, 2));
      fs.writeFileSync(workerYamlPath, "pipeline: []");

      const info = compat.getMigrationInfo(agentJsonPath);

      expect(info.is_v2).toBe(false);
      expect(info.has_worker_yaml).toBe(true);
      expect(info.suggestions).toHaveLength(0);
    });
  });

  describe("generateWorkerYamlFile", () => {
    it("should generate and save worker.yaml file", () => {
      const agentJsonPath = path.join(testDir, "agent.json");
      const v2Agent = {
        schema_version: "2.0",
        identity: { name: "test" },
        instructions: { content: "Test instructions" },
      };

      fs.writeFileSync(agentJsonPath, JSON.stringify(v2Agent, null, 2));

      const outputPath = compat.generateWorkerYamlFile(agentJsonPath);

      expect(fs.existsSync(outputPath)).toBe(true);
      expect(outputPath).toBe(path.join(testDir, "worker.yaml"));

      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain("pipeline:");
      expect(content).toContain("llm_chat");
      expect(content).toContain("system_prompt:");
    });

    it("should save to custom output path", () => {
      const agentJsonPath = path.join(testDir, "agent.json");
      const customPath = path.join(testDir, "custom-worker.yaml");

      const v2Agent = {
        identity: { name: "test" },
        instructions: { content: "Test" },
      };

      fs.writeFileSync(agentJsonPath, JSON.stringify(v2Agent, null, 2));

      const outputPath = compat.generateWorkerYamlFile(agentJsonPath, customPath);

      expect(outputPath).toBe(customPath);
      expect(fs.existsSync(customPath)).toBe(true);
    });

    it("should generate valid YAML format", () => {
      const agentJsonPath = path.join(testDir, "agent.json");
      const v2Agent = {
        identity: { name: "test" },
        instructions: {
          content: "Multi-line\ninstructions\nhere",
        },
      };

      fs.writeFileSync(agentJsonPath, JSON.stringify(v2Agent, null, 2));

      compat.generateWorkerYamlFile(agentJsonPath);

      const workerYamlPath = path.join(testDir, "worker.yaml");
      const yaml = require("js-yaml");

      // Should be parseable
      const parsed = yaml.load(fs.readFileSync(workerYamlPath, "utf-8"));
      expect(parsed.pipeline).toBeDefined();
    });
  });

  describe("integration with real v2 agent", () => {
    it("should handle cursor-agent v2 format", () => {
      const agentJsonPath = path.join(testDir, "agent.json");
      const cursorAgent = {
        schema_version: "2.0",
        identity: {
          name: "cursor-agent",
          version: "1.0.0",
          display_name: "Cursor Agent",
          description: "Test agent",
          author: "Test",
          tags: ["cursor"],
        },
        instructions: {
          format: "markdown",
          source: "inline",
          content: "# Cursor Agent\n\nYou are a helpful coding assistant.",
        },
        capabilities: [],
        compatibility: {
          cursor: true,
        },
      };

      fs.writeFileSync(agentJsonPath, JSON.stringify(cursorAgent, null, 2));

      const workerYaml = compat.getWorkerYaml(testDir);

      expect(workerYaml.pipeline).toHaveLength(1);
      expect(workerYaml.pipeline[0].args.system_prompt).toContain("Cursor Agent");
      expect(workerYaml.pipeline[0].args.system_prompt).toContain("coding assistant");
    });
  });
});
