/**
 * Integration tests for import_agent MCP tool
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock MCP tool handler (simulates the actual MCP server call)
import { ImportManager } from "../src/import-manager.js";
import { CursorImportAdapter } from "../src/adapters/cursor-import.js";
import { ClaudeImportAdapter } from "../src/adapters/claude-import.js";
import { CodeBuddyImportAdapter } from "../src/adapters/codebuddy-import.js";
import { GitHubImportAdapter } from "../src/adapters/github-import.js";

// Test data
const TEST_CURSOR_COMMAND = `# Test Agent

A test agent for integration testing.

## Features

- Feature 1
- Feature 2
`;

const TEST_CLAUDE_COMMAND = `# /test — Test Agent

## Description

A test agent for Claude Code.

## Usage

Just ask me to help.
`;

// Helper functions
function createTempDir(suffix: string): string {
  const dir = join(tmpdir(), `import-integration-${suffix}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Simulate MCP tool handler
async function handleImportAgent(args: {
  source_path: string;
  output_dir?: string;
  tool?: string;
  dry_run?: boolean;
}): Promise<{ status: string; [key: string]: any }> {
  const sourcePath = args.source_path;
  const outputDir = args.output_dir ?? "./imported-agents";
  const tool = args.tool;
  const dryRun = args.dry_run ?? false;

  if (!sourcePath) {
    throw new Error("source_path is required");
  }

  const manager = new ImportManager();
  manager.registerAdapter(new CursorImportAdapter());
  manager.registerAdapter(new ClaudeImportAdapter());
  manager.registerAdapter(new CodeBuddyImportAdapter());
  manager.registerAdapter(new GitHubImportAdapter());

  try {
    if (dryRun) {
      const descriptor = manager.dryRun(sourcePath, tool);
      return {
        status: "dry-run",
        source_path: sourcePath,
        detected_tool: tool || "auto",
        agent: {
          name: descriptor.identity.name,
          version: descriptor.identity.version,
          display_name: descriptor.identity.display_name,
          description: descriptor.identity.description,
        },
        output_path: `${outputDir}/${descriptor.identity.name}/agent.json`,
      };
    } else {
      const agentDir = manager.importAgent(sourcePath, outputDir, tool);
      const agentJsonPath = `${agentDir}/agent.json`;
      return {
        status: "success",
        source_path: sourcePath,
        output_path: agentJsonPath,
        agent_dir: agentDir,
      };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Import failed: ${msg}`);
  }
}

describe("MCP Tool: import_agent", () => {
  const testDirs: string[] = [];

  afterAll(() => {
    testDirs.forEach(dir => cleanupDir(dir));
  });

  describe("Dry-run mode", () => {
    let cursorDir = "";
    let sourcePath = "";

    beforeAll(() => {
      cursorDir = createTempDir("dry-run");
      testDirs.push(cursorDir);

      const commandsDir = join(cursorDir, ".cursor", "commands");
      mkdirSync(commandsDir, { recursive: true });
      sourcePath = join(commandsDir, "test-agent.md");
      writeFileSync(sourcePath, TEST_CURSOR_COMMAND);
    });

    it("should preview import without writing files", async () => {
      const result = await handleImportAgent({
        source_path: sourcePath,
        output_dir: join(cursorDir, "output"),
        dry_run: true,
      });

      expect(result.status).toBe("dry-run");
      expect(result.agent.name).toBe("test-agent");
      expect(result.agent.display_name).toContain("Test Agent");
      expect(result.output_path).toContain("test-agent/agent.json");

      // Verify no files were written
      expect(existsSync(join(cursorDir, "output"))).toBe(false);
    });

    it("should auto-detect tool format", async () => {
      const result = await handleImportAgent({
        source_path: sourcePath,
        dry_run: true,
      });

      expect(result.status).toBe("dry-run");
      expect(result.detected_tool).toBe("auto");
    });

    it("should force specific tool adapter", async () => {
      const result = await handleImportAgent({
        source_path: sourcePath,
        tool: "cursor",
        dry_run: true,
      });

      expect(result.status).toBe("dry-run");
      expect(result.detected_tool).toBe("cursor");
    });
  });

  describe("Real import mode", () => {
    let testDir = "";
    let cursorPath = "";
    let claudePath = "";

    beforeAll(() => {
      testDir = createTempDir("real-import");
      testDirs.push(testDir);

      // Create Cursor command
      const cursorDir = join(testDir, ".cursor", "commands");
      mkdirSync(cursorDir, { recursive: true });
      cursorPath = join(cursorDir, "cursor-agent.md");
      writeFileSync(cursorPath, TEST_CURSOR_COMMAND);

      // Create Claude command
      const claudeDir = join(testDir, ".claude", "commands");
      mkdirSync(claudeDir, { recursive: true });
      claudePath = join(claudeDir, "claude-agent.md");
      writeFileSync(claudePath, TEST_CLAUDE_COMMAND);
    });

    it("should import Cursor agent and write agent.json", async () => {
      const outputDir = join(testDir, "imported");
      const result = await handleImportAgent({
        source_path: cursorPath,
        output_dir: outputDir,
        dry_run: false,
      });

      expect(result.status).toBe("success");
      expect(result.agent_dir).toContain("cursor-agent");
      expect(existsSync(result.output_path)).toBe(true);

      // Verify agent.json content
      const agentJson = JSON.parse(readFileSync(result.output_path, "utf-8"));
      expect(agentJson.schema_version).toBe("2.0");
      expect(agentJson.identity.name).toBe("cursor-agent");
      expect(agentJson.instructions.source).toBe("inline");
      expect(agentJson.compatibility.cursor).toBe(true);
    });

    it("should import Claude Code agent", async () => {
      const outputDir = join(testDir, "imported");
      const result = await handleImportAgent({
        source_path: claudePath,
        output_dir: outputDir,
      });

      expect(result.status).toBe("success");
      expect(existsSync(result.output_path)).toBe(true);

      const agentJson = JSON.parse(readFileSync(result.output_path, "utf-8"));
      expect(agentJson.identity.name).toBe("claude-agent");
      expect(agentJson.identity.display_name).toContain("Test Agent");
      expect(agentJson.compatibility.claude_code).toBe(true);
    });

    it("should use default output directory", async () => {
      const result = await handleImportAgent({
        source_path: cursorPath,
      });

      expect(result.status).toBe("success");
      expect(result.output_path).toContain("imported-agents");
    });
  });

  describe("Error handling", () => {
    it("should throw error for missing source_path", async () => {
      await expect(
        handleImportAgent({} as any)
      ).rejects.toThrow("source_path is required");
    });

    it("should throw error for non-existent file", async () => {
      await expect(
        handleImportAgent({
          source_path: "/nonexistent/path/file.md",
        })
      ).rejects.toThrow("Import failed");
    });

    it("should throw error when no adapter found", async () => {
      const testDir = createTempDir("error");
      testDirs.push(testDir);

      const unknownFile = join(testDir, "unknown.txt");
      writeFileSync(unknownFile, "test content");

      await expect(
        handleImportAgent({
          source_path: unknownFile,
        })
      ).rejects.toThrow("No adapter found");
    });
  });

  describe("Tool parameter", () => {
    let testDir = "";
    let sourcePath = "";

    beforeAll(() => {
      testDir = createTempDir("tool-param");
      testDirs.push(testDir);

      const commandsDir = join(testDir, ".cursor", "commands");
      mkdirSync(commandsDir, { recursive: true });
      sourcePath = join(commandsDir, "agent.md");
      writeFileSync(sourcePath, TEST_CURSOR_COMMAND);
    });

    it("should use forced tool adapter", async () => {
      const result = await handleImportAgent({
        source_path: sourcePath,
        tool: "cursor",
        output_dir: join(testDir, "output"),
      });

      expect(result.status).toBe("success");

      const agentJson = JSON.parse(readFileSync(result.output_path, "utf-8"));
      expect(agentJson.compatibility.source).toBe("cursor");
    });

    it("should throw error for invalid tool", async () => {
      await expect(
        handleImportAgent({
          source_path: sourcePath,
          tool: "nonexistent",
        })
      ).rejects.toThrow("No adapter found for tool");
    });
  });
});
