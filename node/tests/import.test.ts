/**
 * Test suite for import functionality - Phase 2
 * Tests ImportAdapter implementations and ImportManager
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ImportManager } from "../src/import-manager.js";
import { CursorImportAdapter } from "../src/adapters/cursor-import.js";
import { ClaudeImportAdapter } from "../src/adapters/claude-import.js";
import { CodeBuddyImportAdapter } from "../src/adapters/codebuddy-import.js";
import { GitHubImportAdapter } from "../src/adapters/github-import.js";

// Test data - Cursor format
const TEST_CURSOR_COMMAND = `# Code Reviewer

A thorough code reviewer that checks for bugs, security issues, and best practices.

## What I Do

I analyze your code and provide detailed feedback on:
- Potential bugs and edge cases
- Security vulnerabilities
- Performance issues
- Code style and best practices

## Usage

Select code and ask me to review it.
`;

const TEST_CURSOR_COMMAND_WITH_FRONTMATTER = `---
name: Test Agent
version: 2.0.0
author: Test Author
description: A test agent with frontmatter
---

# Test Agent

This agent has YAML frontmatter.
`;

// Test data - Claude Code format
const TEST_CLAUDE_COMMAND = `# /code-review — Code Review Assistant

## Description

Reviews code for quality and best practices.

## What I Do

- Check for bugs
- Suggest improvements
- Verify security

## Usage

Ask me to review your code.
`;

// Test data - CodeBuddy format
const TEST_CODEBUDDY_SKILL = `---
name: test-skill
version: 1.0.0
description: A test skill for unit testing
author: Test Author
tags:
  - testing
  - example
---

# Test Skill

This is a CodeBuddy skill with proper YAML frontmatter.

## Features

- Feature 1
- Feature 2
`;

// Test data - GitHub format
const TEST_GITHUB_AGENT = `# Documentation Generator

An agent that generates comprehensive documentation for your code.

## Capabilities

- Generate API documentation
- Create README files
- Write inline comments

## Usage

Point me to your code and I'll document it.
`;

// Helper functions
function createTempDir(suffix: string): string {
  const dir = join(tmpdir(), `import-test-${suffix}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("ImportAdapter - Cursor", () => {
  const testDirs: string[] = [];
  let cursorDir = "";
  let commandPath = "";

  beforeAll(() => {
    cursorDir = createTempDir("cursor");
    testDirs.push(cursorDir);

    const commandsDir = join(cursorDir, ".cursor", "commands");
    mkdirSync(commandsDir, { recursive: true });

    commandPath = join(commandsDir, "code-reviewer.md");
    writeFileSync(commandPath, TEST_CURSOR_COMMAND);
  });

  afterAll(() => {
    testDirs.forEach(dir => cleanupDir(dir));
  });

  it("should detect Cursor format", () => {
    const adapter = new CursorImportAdapter();
    expect(adapter.canImport(commandPath)).toBe(true);
    expect(adapter.canImport("/some/other/path.md")).toBe(false);
  });

  it("should import Cursor command to agent.json", () => {
    const adapter = new CursorImportAdapter();
    const result = adapter.importFrom(commandPath);

    expect(result.schema_version).toBe("2.0");
    expect(result.identity.name).toBe("code-reviewer");
    expect(result.identity.display_name).toContain("Code Reviewer");
    expect(result.identity.description).toBeTruthy();
    expect(result.instructions?.source).toBe("inline");
    expect(result.instructions?.content).toContain("code reviewer");
    expect(result.compatibility?.cursor).toBe(true);
  });

  it("should extract frontmatter if present", () => {
    const pathWithFrontmatter = join(cursorDir, ".cursor", "commands", "with-frontmatter.md");
    writeFileSync(pathWithFrontmatter, TEST_CURSOR_COMMAND_WITH_FRONTMATTER);

    const adapter = new CursorImportAdapter();
    const result = adapter.importFrom(pathWithFrontmatter);

    expect(result.identity.version).toBe("2.0.0");
    expect(result.identity.author).toBe("Test Author");
  });

  it("should return correct tool info", () => {
    const adapter = new CursorImportAdapter();
    const info = adapter.getToolInfo();

    expect(info.name).toBe("cursor");
    expect(info.pattern).toContain(".cursor/commands");
  });
});

describe("ImportAdapter - Claude Code", () => {
  const testDirs: string[] = [];
  let claudeDir = "";
  let commandPath = "";

  beforeAll(() => {
    claudeDir = createTempDir("claude");
    testDirs.push(claudeDir);

    const commandsDir = join(claudeDir, ".claude", "commands");
    mkdirSync(commandsDir, { recursive: true });

    commandPath = join(commandsDir, "code-review.md");
    writeFileSync(commandPath, TEST_CLAUDE_COMMAND);
  });

  afterAll(() => {
    testDirs.forEach(dir => cleanupDir(dir));
  });

  it("should detect Claude Code format", () => {
    const adapter = new ClaudeImportAdapter();
    expect(adapter.canImport(commandPath)).toBe(true);
  });

  it("should import Claude Code command", () => {
    const adapter = new ClaudeImportAdapter();
    const result = adapter.importFrom(commandPath);

    expect(result.schema_version).toBe("2.0");
    expect(result.identity.name).toBe("code-review");
    expect(result.identity.display_name).toContain("Code Review Assistant");
    expect(result.instructions?.content).toContain("Reviews code");
    expect(result.compatibility?.claude_code).toBe(true);
  });

  it("should extract slash command name", () => {
    const adapter = new ClaudeImportAdapter();
    const result = adapter.importFrom(commandPath);

    expect(result.identity.display_name).not.toContain("/");
  });
});

describe("ImportAdapter - CodeBuddy", () => {
  const testDirs: string[] = [];
  let codebuddyDir = "";
  let skillPath = "";

  beforeAll(() => {
    codebuddyDir = createTempDir("codebuddy");
    testDirs.push(codebuddyDir);

    const skillDir = join(codebuddyDir, ".codebuddy", "skills", "test-skill");
    mkdirSync(skillDir, { recursive: true });

    skillPath = join(skillDir, "SKILL.md");
    writeFileSync(skillPath, TEST_CODEBUDDY_SKILL);
  });

  afterAll(() => {
    testDirs.forEach(dir => cleanupDir(dir));
  });

  it("should detect CodeBuddy format", () => {
    const adapter = new CodeBuddyImportAdapter();
    expect(adapter.canImport(skillPath)).toBe(true);
  });

  it("should import CodeBuddy skill", () => {
    const adapter = new CodeBuddyImportAdapter();
    const result = adapter.importFrom(skillPath);

    expect(result.schema_version).toBe("2.0");
    expect(result.identity.name).toBe("test-skill");
    expect(result.identity.version).toBe("1.0.0");
    expect(result.identity.author).toBe("Test Author");
    expect(result.instructions?.content).toContain("Test Skill");
    expect(result.compatibility?.codebuddy).toBe(true);
  });

  it("should parse YAML frontmatter", () => {
    const adapter = new CodeBuddyImportAdapter();
    const result = adapter.importFrom(skillPath);

    expect(result.identity.tags).toContain("testing");
    expect(result.identity.tags).toContain("codebuddy");
  });
});

describe("ImportAdapter - GitHub", () => {
  const testDirs: string[] = [];
  let githubDir = "";
  let agentPath = "";

  beforeAll(() => {
    githubDir = createTempDir("github");
    testDirs.push(githubDir);

    const agentsDir = join(githubDir, ".github", "agents");
    mkdirSync(agentsDir, { recursive: true });

    agentPath = join(agentsDir, "doc-generator.md");
    writeFileSync(agentPath, TEST_GITHUB_AGENT);
  });

  afterAll(() => {
    testDirs.forEach(dir => cleanupDir(dir));
  });

  it("should detect GitHub format", () => {
    const adapter = new GitHubImportAdapter();
    expect(adapter.canImport(agentPath)).toBe(true);
  });

  it("should import GitHub agent", () => {
    const adapter = new GitHubImportAdapter();
    const result = adapter.importFrom(agentPath);

    expect(result.schema_version).toBe("2.0");
    expect(result.identity.name).toBe("doc-generator");
    expect(result.identity.display_name).toContain("Documentation Generator");
    expect(result.instructions?.content).toContain("documentation");
    expect(result.compatibility?.github_copilot).toBe(true);
  });
});

describe("ImportManager", () => {
  const testDirs: string[] = [];
  let testDir = "";
  let cursorPath = "";
  let claudePath = "";

  beforeAll(() => {
    testDir = createTempDir("manager");
    testDirs.push(testDir);

    // Create test files
    const cursorDir = join(testDir, ".cursor", "commands");
    mkdirSync(cursorDir, { recursive: true });
    cursorPath = join(cursorDir, "test.md");
    writeFileSync(cursorPath, TEST_CURSOR_COMMAND);

    const claudeDir = join(testDir, ".claude", "commands");
    mkdirSync(claudeDir, { recursive: true });
    claudePath = join(claudeDir, "test.md");
    writeFileSync(claudePath, TEST_CLAUDE_COMMAND);
  });

  afterAll(() => {
    testDirs.forEach(dir => cleanupDir(dir));
  });

  it("should register adapters", () => {
    const manager = new ImportManager();
    manager.registerAdapter(new CursorImportAdapter());
    manager.registerAdapter(new ClaudeImportAdapter());

    expect(manager.getAdapters().length).toBe(2);
  });

  it("should detect correct adapter", () => {
    const manager = new ImportManager();
    manager.registerAdapter(new CursorImportAdapter());
    manager.registerAdapter(new ClaudeImportAdapter());

    const cursorAdapter = manager.detectAdapter(cursorPath);
    expect(cursorAdapter?.getToolInfo().name).toBe("cursor");

    const claudeAdapter = manager.detectAdapter(claudePath);
    expect(claudeAdapter?.getToolInfo().name).toBe("claude_code");
  });

  it("should import agent to output directory", () => {
    const manager = new ImportManager();
    manager.registerAdapter(new CursorImportAdapter());

    const outputDir = join(testDir, "imported");
    const agentDir = manager.importAgent(cursorPath, outputDir);

    expect(existsSync(agentDir)).toBe(true);
    expect(existsSync(join(agentDir, "agent.json"))).toBe(true);

    const agentJson = JSON.parse(readFileSync(join(agentDir, "agent.json"), "utf-8"));
    expect(agentJson.schema_version).toBe("2.0");
    expect(agentJson.identity.name).toBeTruthy();
  });

  it("should force specific adapter by name", () => {
    const manager = new ImportManager();
    manager.registerAdapter(new CursorImportAdapter());
    manager.registerAdapter(new ClaudeImportAdapter());

    const outputDir = join(testDir, "imported-forced");
    const agentDir = manager.importAgent(cursorPath, outputDir, "cursor");

    expect(existsSync(agentDir)).toBe(true);
  });

  it("should throw error if no adapter found", () => {
    const manager = new ImportManager();
    manager.registerAdapter(new CursorImportAdapter());

    const unknownPath = join(testDir, "unknown.txt");
    writeFileSync(unknownPath, "test");

    expect(() => manager.importAgent(unknownPath, testDir)).toThrow(/No adapter found/);
  });

  it("should support dry-run", () => {
    const manager = new ImportManager();
    manager.registerAdapter(new CursorImportAdapter());

    const result = manager.dryRun(cursorPath);

    expect(result.schema_version).toBe("2.0");
    expect(result.identity.name).toBeTruthy();
  });

  it("should list all adapters", () => {
    const manager = new ImportManager();
    manager.registerAdapter(new CursorImportAdapter());
    manager.registerAdapter(new ClaudeImportAdapter());
    manager.registerAdapter(new CodeBuddyImportAdapter());
    manager.registerAdapter(new GitHubImportAdapter());

    const adapters = manager.listAdapters();
    expect(adapters.length).toBe(4);
    expect(adapters[0]).toHaveProperty("name");
    expect(adapters[0]).toHaveProperty("pattern");
    expect(adapters[0]).toHaveProperty("description");
  });

  it("should get adapter by name", () => {
    const manager = new ImportManager();
    manager.registerAdapter(new CursorImportAdapter());
    manager.registerAdapter(new ClaudeImportAdapter());

    const adapter = manager.getAdapterByName("cursor");
    expect(adapter).toBeTruthy();
    expect(adapter?.getToolInfo().name).toBe("cursor");

    const notFound = manager.getAdapterByName("nonexistent");
    expect(notFound).toBeNull();
  });
});
