import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GlobTool } from "../../src/runtime/tools/glob.js";
import { ExecutionContextManager } from "../../src/runtime/context.js";
import { ExecutionContext } from "../../src/runtime/types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("GlobTool", () => {
  let tool: GlobTool;
  let context: ExecutionContext;
  let testDir: string;

  beforeEach(() => {
    tool = new GlobTool();

    // Create a temporary test directory with file structure
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "glob-test-"));

    // Create test files
    fs.writeFileSync(path.join(testDir, "file1.txt"), "");
    fs.writeFileSync(path.join(testDir, "file2.txt"), "");
    fs.writeFileSync(path.join(testDir, "file3.md"), "");
    fs.writeFileSync(path.join(testDir, "test.js"), "");

    // Create subdirectories with files
    fs.mkdirSync(path.join(testDir, "subdir1"));
    fs.writeFileSync(path.join(testDir, "subdir1", "nested1.txt"), "");
    fs.writeFileSync(path.join(testDir, "subdir1", "nested2.js"), "");

    fs.mkdirSync(path.join(testDir, "subdir2"));
    fs.writeFileSync(path.join(testDir, "subdir2", "deep.txt"), "");

    fs.mkdirSync(path.join(testDir, "subdir2", "deeper"));
    fs.writeFileSync(path.join(testDir, "subdir2", "deeper", "nested.txt"), "");

    context = ExecutionContextManager.create({
      agent: { name: "test-agent" },
      initialArgs: {},
      cwd: testDir,
    });
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("basic functionality", () => {
    it("should match simple pattern", async () => {
      const results = await tool.execute({ pattern: "*.txt" }, context);

      expect(results).toHaveLength(2);
      expect(results.some((r) => r.endsWith("file1.txt"))).toBe(true);
      expect(results.some((r) => r.endsWith("file2.txt"))).toBe(true);
    });

    it("should match by extension", async () => {
      const results = await tool.execute({ pattern: "*.js" }, context);

      expect(results).toHaveLength(1);
      expect(results[0]).toContain("test.js");
    });

    it("should match all files with wildcard", async () => {
      const results = await tool.execute({ pattern: "*" }, context);

      // Should match 4 files in root directory
      expect(results.length).toBeGreaterThanOrEqual(4);
    });

    it("should return empty array for no matches", async () => {
      const results = await tool.execute({ pattern: "*.nonexistent" }, context);

      expect(results).toEqual([]);
    });
  });

  describe("recursive patterns", () => {
    it("should match recursive pattern", async () => {
      const results = await tool.execute({ pattern: "**/*.txt" }, context);

      // Should match all .txt files recursively
      expect(results.length).toBeGreaterThanOrEqual(5);
      expect(results.some((r) => r.includes("file1.txt"))).toBe(true);
      expect(results.some((r) => r.includes("nested1.txt"))).toBe(true);
      expect(results.some((r) => r.includes("deep.txt"))).toBe(true);
    });

    it("should match files in subdirectories", async () => {
      const results = await tool.execute({ pattern: "subdir1/*.txt" }, context);

      expect(results).toHaveLength(1);
      expect(results[0]).toContain("nested1.txt");
    });

    it("should match deeply nested files", async () => {
      const results = await tool.execute(
        { pattern: "**/deeper/*.txt" },
        context
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toContain("nested.txt");
    });
  });

  describe("ignore patterns", () => {
    it("should ignore specified patterns", async () => {
      const results = await tool.execute(
        {
          pattern: "**/*.txt",
          ignore: ["**/subdir1/**"],
        },
        context
      );

      // Should not include files from subdir1
      expect(results.some((r) => r.includes("nested1.txt"))).toBe(false);
      // Should still include other .txt files
      expect(results.some((r) => r.includes("file1.txt"))).toBe(true);
    });

    it("should ignore multiple patterns", async () => {
      const results = await tool.execute(
        {
          pattern: "**/*.txt",
          ignore: ["**/subdir1/**", "**/subdir2/**"],
        },
        context
      );

      // Should only include root .txt files
      expect(results).toHaveLength(2);
      expect(results.every((r) => !r.includes("subdir"))).toBe(true);
    });
  });

  describe("max_results", () => {
    it("should limit results to max_results", async () => {
      const results = await tool.execute(
        { pattern: "**/*.txt", max_results: 2 },
        context
      );

      expect(results).toHaveLength(2);
    });

    it("should return all results if max_results not specified", async () => {
      const results = await tool.execute({ pattern: "**/*.txt" }, context);

      expect(results.length).toBeGreaterThan(2);
    });

    it("should handle max_results larger than actual results", async () => {
      const results = await tool.execute(
        { pattern: "*.md", max_results: 100 },
        context
      );

      expect(results).toHaveLength(1);
    });
  });

  describe("working directory", () => {
    it("should use cwd from context by default", async () => {
      const results = await tool.execute({ pattern: "*.txt" }, context);

      expect(results.every((r) => r.startsWith(testDir))).toBe(true);
    });

    it("should use custom cwd", async () => {
      const subdir = path.join(testDir, "subdir1");

      const results = await tool.execute(
        { pattern: "*.txt", cwd: subdir },
        context
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toContain("nested1.txt");
    });
  });

  describe("error handling", () => {
    it("should throw error if pattern is missing", async () => {
      await expect(tool.execute({} as any, context)).rejects.toThrow(
        "glob: 'pattern' parameter is required"
      );
    });

    it("should handle invalid cwd gracefully", async () => {
      const results = await tool.execute(
        { pattern: "*.txt", cwd: "/nonexistent/directory" },
        context
      );

      // Should return empty array for non-existent directory
      expect(results).toEqual([]);
    });
  });

  describe("path formats", () => {
    it("should return absolute paths", async () => {
      const results = await tool.execute({ pattern: "*.txt" }, context);

      expect(results.every((r) => path.isAbsolute(r))).toBe(true);
    });

    it("should normalize path separators", async () => {
      const results = await tool.execute({ pattern: "**/*.txt" }, context);

      // All paths should be valid absolute paths
      expect(results.every((r) => path.isAbsolute(r))).toBe(true);
    });
  });
});
