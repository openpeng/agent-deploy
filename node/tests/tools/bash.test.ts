import { describe, it, expect, beforeEach } from "vitest";
import { BashTool } from "../../src/runtime/tools/bash.js";
import { ExecutionContextManager } from "../../src/runtime/context.js";
import { ExecutionContext } from "../../src/runtime/types.js";
import * as path from "path";

describe("BashTool", () => {
  let tool: BashTool;
  let context: ExecutionContext;

  beforeEach(() => {
    tool = new BashTool();
    context = ExecutionContextManager.create({
      agent: { name: "test-agent" },
      initialArgs: {},
      cwd: process.cwd(),
      env: { TEST_VAR: "test_value" },
    });
  });

  describe("basic functionality", () => {
    it("should execute simple command", async () => {
      const result = await tool.execute(
        { command: process.platform === "win32" ? "echo hello" : "echo hello" },
        context
      );

      expect(result.stdout.trim()).toBe("hello");
      expect(result.exit_code).toBe(0);
      expect(result.duration_ms).toBeGreaterThan(0);
    });

    it("should capture stdout", async () => {
      const cmd = process.platform === "win32"
        ? "echo Line1 & echo Line2"
        : "echo Line1; echo Line2";

      const result = await tool.execute({ command: cmd }, context);

      expect(result.stdout).toContain("Line1");
      expect(result.stdout).toContain("Line2");
      expect(result.exit_code).toBe(0);
    });

    it("should return duration", async () => {
      const result = await tool.execute(
        { command: process.platform === "win32" ? "echo test" : "echo test" },
        context
      );

      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe("error handling", () => {
    it("should throw error if command is missing", async () => {
      await expect(
        tool.execute({} as any, context)
      ).rejects.toThrow("bash: 'command' parameter is required");
    });

    it("should handle non-zero exit code", async () => {
      const cmd = process.platform === "win32" ? "exit 1" : "exit 1";

      const result = await tool.execute({ command: cmd }, context);

      expect(result.exit_code).toBe(1);
    });

    it("should handle command not found", async () => {
      const result = await tool.execute(
        { command: "nonexistentcommand12345" },
        context
      );

      expect(result.exit_code).not.toBe(0);
    });

    it("should handle timeout", async () => {
      // Use a cross-platform sleep command
      const cmd = process.platform === "win32"
        ? "ping 127.0.0.1 -n 6 > nul"  // Sleep for 5 seconds on Windows
        : "sleep 5";

      await expect(
        tool.execute({ command: cmd, timeout: 100 }, context)
      ).rejects.toThrow("bash: Command timed out");
    }, 10000);
  });

  describe("environment variables", () => {
    it("should use environment from context", async () => {
      const cmd = process.platform === "win32"
        ? "echo %TEST_VAR%"
        : "echo $TEST_VAR";

      const result = await tool.execute({ command: cmd }, context);

      expect(result.stdout.trim()).toBe("test_value");
    });

    it("should merge custom environment variables", async () => {
      const cmd = process.platform === "win32"
        ? "echo %CUSTOM_VAR%"
        : "echo $CUSTOM_VAR";

      const result = await tool.execute(
        {
          command: cmd,
          env: { CUSTOM_VAR: "custom_value" },
        },
        context
      );

      expect(result.stdout.trim()).toBe("custom_value");
    });

    it("should override context env with custom env", async () => {
      const cmd = process.platform === "win32"
        ? "echo %TEST_VAR%"
        : "echo $TEST_VAR";

      const result = await tool.execute(
        {
          command: cmd,
          env: { TEST_VAR: "overridden" },
        },
        context
      );

      expect(result.stdout.trim()).toBe("overridden");
    });
  });

  describe("working directory", () => {
    it("should use cwd from context by default", async () => {
      const cmd = process.platform === "win32" ? "cd" : "pwd";

      const result = await tool.execute({ command: cmd }, context);

      expect(result.stdout.trim()).toBe(context.cwd);
    });

    it("should use custom cwd", async () => {
      const customCwd = path.dirname(process.cwd());
      const cmd = process.platform === "win32" ? "cd" : "pwd";

      const result = await tool.execute(
        { command: cmd, cwd: customCwd },
        context
      );

      expect(result.stdout.trim()).toBe(customCwd);
    });
  });

  describe("complex commands", () => {
    it("should handle piped commands", async () => {
      if (process.platform === "win32") {
        const result = await tool.execute(
          { command: "echo hello | findstr hello" },
          context
        );
        expect(result.stdout.trim()).toBe("hello");
      } else {
        const result = await tool.execute(
          { command: "echo hello | grep hello" },
          context
        );
        expect(result.stdout.trim()).toBe("hello");
      }
    });

    it("should handle command with redirects", async () => {
      const cmd = process.platform === "win32"
        ? "echo test > nul & echo visible"
        : "echo test > /dev/null; echo visible";

      const result = await tool.execute({ command: cmd }, context);

      expect(result.stdout.trim()).toBe("visible");
    });
  });
});
