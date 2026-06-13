import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WriteFileTool } from "../../src/runtime/tools/write-file.js";
import { ExecutionContextManager } from "../../src/runtime/context.js";
import { ExecutionContext } from "../../src/runtime/types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("WriteFileTool", () => {
  let tool: WriteFileTool;
  let context: ExecutionContext;
  let testDir: string;

  beforeEach(() => {
    tool = new WriteFileTool();

    // Create a temporary test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "write-file-test-"));

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
    it("should write new file", async () => {
      const testFile = path.join(testDir, "new.txt");

      const result = await tool.execute(
        { path: testFile, content: "Hello, World!" },
        context
      );

      expect(result.path).toBe(testFile);
      expect(result.bytes_written).toBeGreaterThan(0);
      expect(fs.readFileSync(testFile, "utf-8")).toBe("Hello, World!");
    });

    it("should write file with relative path", async () => {
      const result = await tool.execute(
        { path: "relative.txt", content: "Relative content" },
        context
      );

      expect(result.path).toBe(path.join(testDir, "relative.txt"));
      expect(fs.existsSync(result.path)).toBe(true);
      expect(fs.readFileSync(result.path, "utf-8")).toBe("Relative content");
    });

    it("should write multiline content", async () => {
      const content = "Line 1\nLine 2\nLine 3";

      await tool.execute({ path: "multiline.txt", content }, context);

      expect(fs.readFileSync(path.join(testDir, "multiline.txt"), "utf-8")).toBe(
        content
      );
    });

    it("should write empty file", async () => {
      const result = await tool.execute(
        { path: "empty.txt", content: "" },
        context
      );

      expect(result.bytes_written).toBe(0);
      expect(fs.readFileSync(path.join(testDir, "empty.txt"), "utf-8")).toBe("");
    });
  });

  describe("overwrite mode", () => {
    it("should overwrite existing file by default", async () => {
      const testFile = path.join(testDir, "overwrite.txt");
      fs.writeFileSync(testFile, "Original content");

      await tool.execute(
        { path: testFile, content: "New content" },
        context
      );

      expect(fs.readFileSync(testFile, "utf-8")).toBe("New content");
    });

    it("should overwrite when mode is explicitly set", async () => {
      const testFile = path.join(testDir, "explicit.txt");
      fs.writeFileSync(testFile, "Original");

      await tool.execute(
        { path: testFile, content: "Replaced", mode: "overwrite" },
        context
      );

      expect(fs.readFileSync(testFile, "utf-8")).toBe("Replaced");
    });
  });

  describe("append mode", () => {
    it("should append to existing file", async () => {
      const testFile = path.join(testDir, "append.txt");
      fs.writeFileSync(testFile, "First line\n");

      await tool.execute(
        { path: testFile, content: "Second line\n", mode: "append" },
        context
      );

      expect(fs.readFileSync(testFile, "utf-8")).toBe(
        "First line\nSecond line\n"
      );
    });

    it("should create file if it does not exist in append mode", async () => {
      const testFile = path.join(testDir, "new-append.txt");

      await tool.execute(
        { path: testFile, content: "New content", mode: "append" },
        context
      );

      expect(fs.readFileSync(testFile, "utf-8")).toBe("New content");
    });
  });

  describe("directory creation", () => {
    it("should create parent directories by default", async () => {
      const testFile = path.join(testDir, "sub", "dir", "file.txt");

      await tool.execute(
        { path: testFile, content: "Content" },
        context
      );

      expect(fs.existsSync(testFile)).toBe(true);
      expect(fs.readFileSync(testFile, "utf-8")).toBe("Content");
    });

    it("should create nested directories", async () => {
      const testFile = path.join(testDir, "a", "b", "c", "d", "file.txt");

      await tool.execute(
        { path: testFile, content: "Deep content" },
        context
      );

      expect(fs.existsSync(testFile)).toBe(true);
    });

    it("should fail if create_dirs is false and directory does not exist", async () => {
      const testFile = path.join(testDir, "nonexistent", "file.txt");

      await expect(
        tool.execute(
          { path: testFile, content: "Content", create_dirs: false },
          context
        )
      ).rejects.toThrow();
    });
  });

  describe("error handling", () => {
    it("should throw error if path is missing", async () => {
      await expect(
        tool.execute({ content: "content" } as any, context)
      ).rejects.toThrow("write_file: 'path' parameter is required");
    });

    it("should throw error if content is missing", async () => {
      await expect(
        tool.execute({ path: "test.txt" } as any, context)
      ).rejects.toThrow("write_file: 'content' parameter is required");
    });
  });

  describe("encoding", () => {
    it("should use utf-8 encoding by default", async () => {
      const testFile = path.join(testDir, "utf8.txt");

      await tool.execute(
        { path: testFile, content: "UTF-8: 你好世界" },
        context
      );

      expect(fs.readFileSync(testFile, "utf-8")).toBe("UTF-8: 你好世界");
    });

    it("should support custom encoding", async () => {
      const testFile = path.join(testDir, "ascii.txt");

      await tool.execute(
        { path: testFile, content: "ASCII only", encoding: "ascii" },
        context
      );

      expect(fs.readFileSync(testFile, "ascii")).toBe("ASCII only");
    });
  });

  describe("return value", () => {
    it("should return correct path and bytes_written", async () => {
      const testFile = path.join(testDir, "result.txt");
      const content = "Test content";

      const result = await tool.execute(
        { path: testFile, content },
        context
      );

      expect(result.path).toBe(testFile);
      expect(result.bytes_written).toBe(Buffer.from(content, "utf-8").length);
    });

    it("should return updated bytes_written after append", async () => {
      const testFile = path.join(testDir, "append-result.txt");

      await tool.execute(
        { path: testFile, content: "First" },
        context
      );

      const result = await tool.execute(
        { path: testFile, content: "Second", mode: "append" },
        context
      );

      // Total size should be "FirstSecond"
      expect(result.bytes_written).toBe(
        Buffer.from("FirstSecond", "utf-8").length
      );
    });
  });
});
