import { describe, it, expect, beforeAll } from "vitest";
import { detectAll, detectPrimary } from "../src/detect.js";
import { adaptAgent } from "../src/adapt.js";
import { installAgent } from "../src/install.js";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_AGENT_SKILL = `---
name: Test Agent
version: "1.0"
---

# Test Agent

This is a test agent for unit testing.
`;

function createTestAgentDir() {
  const dir = join(tmpdir(), `agent-deploy-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), TEST_AGENT_SKILL);
  return dir;
}

describe("detect", () => {
  it("detectAll returns array", () => {
    const tools = detectAll();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("detectPrimary returns highest confidence", () => {
    const primary = detectPrimary();
    if (primary) {
      expect(primary).toHaveProperty("tool");
      expect(primary).toHaveProperty("confidence");
      expect(typeof primary.tool).toBe("string");
    }
  });

  it("results have required fields", () => {
    const tools = detectAll();
    for (const t of tools) {
      expect(t).toHaveProperty("tool");
      expect(t).toHaveProperty("name");
      expect(t).toHaveProperty("confidence");
      expect(t).toHaveProperty("detected_by");
    }
  });
});

describe("adapt", () => {
  let agentDir = "";

  beforeAll(() => { agentDir = createTestAgentDir(); });

  it("adapts for opencode", async () => {
    const result = await adaptAgent(agentDir, "opencode");
    expect(result.content).toBeTruthy();
    expect(result.target_file).toContain(".opencode");
  });

  it("adapts for codebuddy", async () => {
    const result = await adaptAgent(agentDir, "codebuddy");
    expect(result.content).toBeTruthy();
    expect(result.target_file).toContain(".codebuddy");
  });

  it("adapts for agents_md", async () => {
    const result = await adaptAgent(agentDir, "agents_md");
    expect(result.content).toBeTruthy();
    expect(result.target_file).toBe("AGENTS.md");
  });

  it("returns error for unknown tool", async () => {
    const result = adaptAgent(agentDir, "nonexistent");
    expect(result.content).toContain("Unknown target tool");
    expect(result.target_file).toContain("unknown");
  });
});

describe("install", () => {
  it("dry-run returns paths without writing", async () => {
    const results = await installAgent("# Test", "test-agent", "opencode", "project", true);
    expect(Array.isArray(results)).toBe(true);
    expect(results[0].status).toBe("dry-run");
  });

  it("rejects unknown tool", async () => {
    const results = await installAgent("# Test", "test", "nonexistent", "project", false);
    expect(results[0].status).toBe("error");
  });
});
