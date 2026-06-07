import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ReadFileTool } from "../../src/runtime/tools/read-file.js";
import { ExecutionContextManager } from "../../src/runtime/context.js";
import { ExecutionContext } from "../../src/runtime/types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("ReadFileTool", () => {
  let tool: ReadFileTool;
  let context: ExecutionContext;
  let testDir: string;

  beforeEach(() => {
    tool = new ReadFileTool();

    // Create a temporary test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "read-file-test-"));

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
    it("should read existing file", async () => {
      const testFile = path.join(testDir, "test.txt");
      fs.writeFileSync(testFile, "Hello, World!");

      const result = await tool.execute({ path: testFile }, context);

      expect(result).toBe("Hello, World!");
    });

    it("should read file with relative path", async () => {
      const testFile = path.join(testDir, "relative.txt");
      fs.writeFileSync(testFile, "Relative path content");

      const result = await tool.execute({ path: "relative.txt" }, context);

      expect(result).toBe("Relative path content");
    });

    it("should read file with absolute path", async () => {
      const testFile = path.join(testDir, "absolute.txt");
      fs.writeFileSync(testFile, "Absolute path content");

      const result = await tool.execute({ path: testFile }, context);

      expect(result).toBe("Absolute path content");
    });

    it("should read multiline file", async () => {
      const testFile = path.join(testDir, "multiline.txt");
      const content = "Line 1\nLine 2\nLine 3";
      fs.writeFileSync(testFile, content);

      const result = await tool.execute({ path: testFile }, context);

      expect(result).toBe(content);
    });

    it("should read empty file", async () => {
      const testFile = path.join(testDir, "empty.txt");
      fs.writeFileSync(testFile, "");

      const result = await tool.execute({ path: testFile }, context);

      expect(result).toBe("");
    });
  });

  describe("error handling", () => {
    it("should throw error if path is missing", async () => {
      await expect(tool.execute({} as any, context)).rejects.toThrow(
        "read_file: 'path' parameter is required"
      );
    });

    it("should throw error for non-existent file", async () => {
      await expect(
        tool.execute({ path: "nonexistent.txt" }, context)
      ).rejects.toThrow("read_file: File not found");
    });

    it("should throw error if path is a directory", async () => {
      const subDir = path.join(testDir, "subdir");
      fs.mkdirSync(subDir);

      await expect(tool.execute({ path: subDir }, context)).rejects.toThrow(
        "read_file: Path is not a file"
      );
    });

    it("should throw error if file exceeds max_size", async () => {
      const testFile = path.join(testDir, "large.txt");
      fs.writeFileSync(testFile, "x".repeat(1000));

      await expect(
        tool.execute({ path: testFile, max_size: 500 }, context)
      ).rejects.toThrow("read_file: File size");
    });
  });

  describe("encoding", () => {
    it("should use utf-8 encoding by default", async () => {
      const testFile = path.join(testDir, "utf8.txt");
      fs.writeFileSync(testFile, "UTF-8 content: 你好世界", "utf-8");

      const result = await tool.execute({ path: testFile }, context);

      expect(result).toBe("UTF-8 content: 你好世界");
    });

    it("should support custom encoding", async () => {
      const testFile = path.join(testDir, "ascii.txt");
      fs.writeFileSync(testFile, "ASCII content", "ascii");

      const result = await tool.execute(
        { path: testFile, encoding: "ascii" },
        context
      );

      expect(result).toBe("ASCII content");
    });
  });

  describe("max_size", () => {
    it("should allow file within max_size", async () => {
      const testFile = path.join(testDir, "small.txt");
      fs.writeFileSync(testFile, "x".repeat(100));

      const result = await tool.execute(
        { path: testFile, max_size: 200 },
        context
      );

      expect(result).toHaveLength(100);
    });

    it("should use default max_size of 10MB", async () => {
      const testFile = path.join(testDir, "medium.txt");
      // Create a 1KB file
      fs.writeFileSync(testFile, "x".repeat(1024));

      const result = await tool.execute({ path: testFile }, context);

      expect(result).toHaveLength(1024);
    });
  });

  describe("path resolution", () => {
    it("should resolve relative path from cwd", async () => {
      const subDir = path.join(testDir, "subdir");
      fs.mkdirSync(subDir);
      const testFile = path.join(subDir, "test.txt");
      fs.writeFileSync(testFile, "Content");

      const result = await tool.execute({ path: "subdir/test.txt" }, context);

      expect(result).toBe("Content");
    });

    it("should handle parent directory references", async () => {
      const subDir = path.join(testDir, "subdir");
      fs.mkdirSync(subDir);
      const testFile = path.join(testDir, "test.txt");
      fs.writeFileSync(testFile, "Parent content");

      // Change cwd to subdir
      const subContext = ExecutionContextManager.create({
        agent: { name: "test-agent" },
        initialArgs: {},
        cwd: subDir,
      });

      const result = await tool.execute({ path: "../test.txt" }, subContext);

      expect(result).toBe("Parent content");
    });
  });
});
