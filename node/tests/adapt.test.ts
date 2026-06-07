import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adaptAgent } from "../src/adapt.js";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Test suite for the improved adapt.ts with multi-format support
 */

// Test data
const TEST_AGENT_JSON_INSTRUCTIONS_INLINE = {
  schema_version: "2.0",
  identity: {
    name: "test-inline",
    version: "1.0.0",
    display_name: "Test Inline Agent",
    description: "Test agent with inline instructions",
    author: "Test"
  },
  instructions: {
    format: "markdown",
    source: "inline",
    content: "# Test Agent\n\nThis is an inline instruction test."
  },
  capabilities: [],
  compatibility: {}
};

const TEST_AGENT_JSON_INSTRUCTIONS_FILE = {
  schema_version: "2.0",
  identity: {
    name: "test-file",
    version: "1.0.0",
    display_name: "Test File Agent",
    description: "Test agent with file instructions",
    author: "Test"
  },
  instructions: {
    format: "markdown",
    source: "file",
    file: "instructions.md"
  },
  capabilities: []
};

const TEST_AGENT_JSON_PILOTDECK = {
  identity: {
    name: "test-pilotdeck",
    version: "1.0.0",
    display_name: "Test PilotDeck Agent",
    description: "Test PilotDeck-style agent",
    author: "Test"
  },
  entry: {
    main_subagent: "worker"
  },
  subagents: [
    {
      name: "worker",
      path: "worker.yaml",
      description: "Main workflow"
    },
    {
      name: "helper",
      path: "helper.yaml",
      description: "Helper workflow"
    }
  ],
  category: "utility",
  type: "agent"
};

const TEST_AGENT_JSON_LEGACY = {
  name: "test-legacy",
  version: "1.0.0",
  description: "Test legacy agent"
};

const TEST_SKILL_MD = `---
name: Test Agent
version: "1.0"
---

# Test Agent

This is a test agent using SKILL.md format.
`;

const TEST_INSTRUCTIONS_MD = `# Test Instructions

This is a separate instructions file.

## Usage

Run the agent with the provided parameters.
`;

const TEST_README_MD = `# Test Agent

This agent uses README.md as fallback.

## Description

A simple test agent.
`;

// Helper functions
function createTempDir(suffix: string): string {
  const dir = join(tmpdir(), `agent-deploy-test-${suffix}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("adapt.ts - Multi-format support", () => {
  const testDirs: string[] = [];

  afterAll(() => {
    testDirs.forEach(dir => cleanupDir(dir));
  });

  describe("Format A: agent.json with inline instructions", () => {
    let agentDir = "";

    beforeAll(() => {
      agentDir = createTempDir("inline");
      testDirs.push(agentDir);
      writeFileSync(
        join(agentDir, "agent.json"),
        JSON.stringify(TEST_AGENT_JSON_INSTRUCTIONS_INLINE, null, 2)
      );
    });

    it("should load instructions from agent.json inline", () => {
      const result = adaptAgent(agentDir, "cursor");
      expect(result.content).toContain("Test Agent");
      expect(result.content).toContain("inline instruction test");
      expect(result.format).toBe("markdown");
    });

    it("should adapt to multiple targets", () => {
      const targets = ["cursor", "claude_code", "github_copilot"];
      for (const target of targets) {
        const result = adaptAgent(agentDir, target);
        expect(result.content).toBeTruthy();
        expect(result.target_file).toBeTruthy();
      }
    });
  });

  describe("Format B: agent.json with file instructions", () => {
    let agentDir = "";

    beforeAll(() => {
      agentDir = createTempDir("file");
      testDirs.push(agentDir);
      writeFileSync(
        join(agentDir, "agent.json"),
        JSON.stringify(TEST_AGENT_JSON_INSTRUCTIONS_FILE, null, 2)
      );
      writeFileSync(join(agentDir, "instructions.md"), TEST_INSTRUCTIONS_MD);
    });

    it("should load instructions from external file", () => {
      const result = adaptAgent(agentDir, "cursor");
      expect(result.content).toContain("Test Instructions");
      expect(result.content).toContain("Run the agent with the provided parameters");
    });

    it("should use correct file path", () => {
      const result = adaptAgent(agentDir, "cursor");
      expect(result.slug).toBe("test-file");
    });
  });

  describe("Format C: PilotDeck agent (subagents)", () => {
    let agentDir = "";

    beforeAll(() => {
      agentDir = createTempDir("pilotdeck");
      testDirs.push(agentDir);
      writeFileSync(
        join(agentDir, "agent.json"),
        JSON.stringify(TEST_AGENT_JSON_PILOTDECK, null, 2)
      );
    });

    it("should generate instructions from subagents", () => {
      const result = adaptAgent(agentDir, "cursor");
      expect(result.content).toContain("Test PilotDeck Agent");
      expect(result.content).toContain("Workflows");
      expect(result.content).toContain("worker");
      expect(result.content).toContain("helper");
      expect(result.content).toContain("Main workflow");
    });

    it("should mention entry workflow", () => {
      const result = adaptAgent(agentDir, "cursor");
      expect(result.content).toContain("Entry workflow");
      expect(result.content).toContain("worker");
    });

    it("should list all subagents", () => {
      const result = adaptAgent(agentDir, "cursor");
      expect(result.content).toContain("2 sub-workflow(s)");
      expect(result.content).toContain("worker.yaml");
      expect(result.content).toContain("helper.yaml");
    });
  });

  describe("Format D: Legacy agent (SKILL.md fallback)", () => {
    let agentDir = "";

    beforeAll(() => {
      agentDir = createTempDir("legacy");
      testDirs.push(agentDir);
      writeFileSync(
        join(agentDir, "agent.json"),
        JSON.stringify(TEST_AGENT_JSON_LEGACY, null, 2)
      );
      writeFileSync(join(agentDir, "SKILL.md"), TEST_SKILL_MD);
    });

    it("should fallback to SKILL.md", () => {
      const result = adaptAgent(agentDir, "cursor");
      expect(result.content).toContain("Test Agent");
      expect(result.content).toContain("SKILL.md format");
    });

    it("should strip YAML frontmatter", () => {
      const result = adaptAgent(agentDir, "cursor");
      expect(result.content).not.toContain("---");
      expect(result.content).not.toContain("name: Test Agent");
    });
  });

  describe("Format E: README.md fallback", () => {
    let agentDir = "";

    beforeAll(() => {
      agentDir = createTempDir("readme");
      testDirs.push(agentDir);
      writeFileSync(
        join(agentDir, "agent.json"),
        JSON.stringify(TEST_AGENT_JSON_LEGACY, null, 2)
      );
      writeFileSync(join(agentDir, "README.md"), TEST_README_MD);
    });

    it("should fallback to README.md when no other source", () => {
      const result = adaptAgent(agentDir, "cursor");
      expect(result.content).toContain("Test Agent");
      expect(result.content).toContain("README.md as fallback");
    });
  });

  describe("Fallback priority", () => {
    it("should prefer instructions over subagents", () => {
      const agentDir = createTempDir("priority1");
      testDirs.push(agentDir);

      const agentJson = {
        ...TEST_AGENT_JSON_INSTRUCTIONS_INLINE,
        subagents: TEST_AGENT_JSON_PILOTDECK.subagents,
        entry: TEST_AGENT_JSON_PILOTDECK.entry
      };

      writeFileSync(join(agentDir, "agent.json"), JSON.stringify(agentJson, null, 2));

      const result = adaptAgent(agentDir, "cursor");
      expect(result.content).toContain("inline instruction test");
      expect(result.content).not.toContain("Workflows");
    });

    it("should prefer subagents over SKILL.md", () => {
      const agentDir = createTempDir("priority2");
      testDirs.push(agentDir);

      writeFileSync(
        join(agentDir, "agent.json"),
        JSON.stringify(TEST_AGENT_JSON_PILOTDECK, null, 2)
      );
      writeFileSync(join(agentDir, "SKILL.md"), TEST_SKILL_MD);

      const result = adaptAgent(agentDir, "cursor");
      expect(result.content).toContain("Workflows");
      expect(result.content).not.toContain("SKILL.md format");
    });

    it("should prefer SKILL.md over README.md", () => {
      const agentDir = createTempDir("priority3");
      testDirs.push(agentDir);

      writeFileSync(
        join(agentDir, "agent.json"),
        JSON.stringify(TEST_AGENT_JSON_LEGACY, null, 2)
      );
      writeFileSync(join(agentDir, "SKILL.md"), TEST_SKILL_MD);
      writeFileSync(join(agentDir, "README.md"), TEST_README_MD);

      const result = adaptAgent(agentDir, "cursor");
      expect(result.content).toContain("SKILL.md format");
      expect(result.content).not.toContain("README.md as fallback");
    });
  });

  describe("Error handling", () => {
    it("should throw error when no instructions source found", () => {
      const agentDir = createTempDir("error1");
      testDirs.push(agentDir);

      writeFileSync(
        join(agentDir, "agent.json"),
        JSON.stringify(TEST_AGENT_JSON_LEGACY, null, 2)
      );

      expect(() => adaptAgent(agentDir, "cursor")).toThrow(/No agent.json or SKILL.md found/);
    });

    it("should throw error when agent.json not found", () => {
      const agentDir = createTempDir("error2");
      testDirs.push(agentDir);

      expect(() => adaptAgent(agentDir, "cursor")).toThrow(/No agent.json or SKILL.md found/);
    });

    it("should throw error when instructions file not found", () => {
      const agentDir = createTempDir("error3");
      testDirs.push(agentDir);

      const agentJson = {
        ...TEST_AGENT_JSON_INSTRUCTIONS_FILE,
        instructions: {
          format: "markdown",
          source: "file",
          file: "nonexistent.md"
        }
      };

      writeFileSync(join(agentDir, "agent.json"), JSON.stringify(agentJson, null, 2));

      expect(() => adaptAgent(agentDir, "cursor")).toThrow(/No agent.json or SKILL.md found/);
    });
  });

  describe("Identity field compatibility", () => {
    it("should handle new identity format", () => {
      const agentDir = createTempDir("identity-new");
      testDirs.push(agentDir);

      writeFileSync(
        join(agentDir, "agent.json"),
        JSON.stringify(TEST_AGENT_JSON_INSTRUCTIONS_INLINE, null, 2)
      );

      const result = adaptAgent(agentDir, "cursor");
      expect(result.slug).toBe("test-inline");
    });

    it("should handle old flat format", () => {
      const agentDir = createTempDir("identity-old");
      testDirs.push(agentDir);

      writeFileSync(
        join(agentDir, "agent.json"),
        JSON.stringify(TEST_AGENT_JSON_LEGACY, null, 2)
      );
      writeFileSync(join(agentDir, "SKILL.md"), TEST_SKILL_MD);

      const result = adaptAgent(agentDir, "cursor");
      expect(result.slug).toBe("test-legacy");
    });
  });

  describe("Target platform adaptation", () => {
    let agentDir = "";

    beforeAll(() => {
      agentDir = createTempDir("platforms");
      testDirs.push(agentDir);
      writeFileSync(
        join(agentDir, "agent.json"),
        JSON.stringify(TEST_AGENT_JSON_INSTRUCTIONS_INLINE, null, 2)
      );
    });

    it("should adapt for cursor", () => {
      const result = adaptAgent(agentDir, "cursor");
      expect(result.target_file).toContain(".cursor/commands");
      expect(result.format).toBe("markdown");
    });

    it("should adapt for claude_code", () => {
      const result = adaptAgent(agentDir, "claude_code");
      expect(result.target_file).toContain(".claude/commands");
      expect(result.content).toContain("/test-inline");
    });

    it("should adapt for codebuddy", () => {
      const result = adaptAgent(agentDir, "codebuddy");
      expect(result.target_file).toContain(".codebuddy/skills");
      expect(result.format).toBe("yaml+markdown");
    });

    it("should adapt for github_copilot", () => {
      const result = adaptAgent(agentDir, "github_copilot");
      expect(result.target_file).toContain(".github/agents");
    });
  });
});
