import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebFetchTool } from "../../src/runtime/tools/web-fetch.js";
import { ExecutionContextManager } from "../../src/runtime/context.js";
import { ExecutionContext } from "../../src/runtime/types.js";
import * as http from "http";
import type { Server } from "http";

describe("WebFetchTool", () => {
  let tool: WebFetchTool;
  let context: ExecutionContext;
  let server: Server;
  let serverPort: number;
  let serverUrl: string;

  beforeEach(async () => {
    tool = new WebFetchTool();
    context = ExecutionContextManager.create({
      agent: { name: "test-agent" },
      initialArgs: {},
      cwd: process.cwd(),
    });

    // Create a test HTTP server
    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        const url = req.url || "/";

        // Handle different routes
        if (url === "/") {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Hello, World!");
        } else if (url === "/json") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "JSON response", status: "ok" }));
        } else if (url === "/headers") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(req.headers));
        } else if (url === "/redirect") {
          res.writeHead(302, { Location: "/redirected" });
          res.end();
        } else if (url === "/redirected") {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Redirected content");
        } else if (url === "/redirect-loop") {
          res.writeHead(302, { Location: "/redirect-loop" });
          res.end();
        } else if (url === "/redirect-chain") {
          res.writeHead(302, { Location: "/redirect-chain-2" });
          res.end();
        } else if (url === "/redirect-chain-2") {
          res.writeHead(302, { Location: "/redirect-chain-3" });
          res.end();
        } else if (url === "/redirect-chain-3") {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("End of chain");
        } else if (url === "/404") {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
        } else if (url === "/500") {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Internal Server Error");
        } else if (url === "/slow") {
          // Simulate slow response
          setTimeout(() => {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("Slow response");
          }, 5000);
        } else {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
        }
      });

      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === "object") {
          serverPort = address.port;
          serverUrl = `http://localhost:${serverPort}`;
          resolve();
        }
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe("basic functionality", () => {
    it("should fetch content successfully", async () => {
      const result = await tool.execute(
        { url: serverUrl },
        context
      );

      expect(result.status_code).toBe(200);
      expect(result.body).toBe("Hello, World!");
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
      expect(result.final_url).toBe(serverUrl + "/");
    });

    it("should fetch JSON content", async () => {
      const result = await tool.execute(
        { url: `${serverUrl}/json` },
        context
      );

      expect(result.status_code).toBe(200);
      expect(result.headers["content-type"]).toBe("application/json");

      const parsed = JSON.parse(result.body);
      expect(parsed.message).toBe("JSON response");
      expect(parsed.status).toBe("ok");
    });

    it("should return headers", async () => {
      const result = await tool.execute(
        { url: serverUrl },
        context
      );

      expect(result.headers).toBeDefined();
      expect(result.headers["content-type"]).toBe("text/plain");
    });

    it("should measure duration", async () => {
      const result = await tool.execute(
        { url: serverUrl },
        context
      );

      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe("custom headers", () => {
    it("should send custom headers", async () => {
      const result = await tool.execute(
        {
          url: `${serverUrl}/headers`,
          headers: {
            "X-Custom-Header": "custom-value",
            "Authorization": "Bearer token123",
          },
        },
        context
      );

      const receivedHeaders = JSON.parse(result.body);
      expect(receivedHeaders["x-custom-header"]).toBe("custom-value");
      expect(receivedHeaders["authorization"]).toBe("Bearer token123");
    });

    it("should include default User-Agent", async () => {
      const result = await tool.execute(
        { url: `${serverUrl}/headers` },
        context
      );

      const receivedHeaders = JSON.parse(result.body);
      expect(receivedHeaders["user-agent"]).toBe("agent-deploy/1.0");
    });
  });

  describe("redirects", () => {
    it("should follow redirects by default", async () => {
      const result = await tool.execute(
        { url: `${serverUrl}/redirect` },
        context
      );

      expect(result.status_code).toBe(200);
      expect(result.body).toBe("Redirected content");
      expect(result.final_url).toContain("/redirected");
    });

    it("should not follow redirects when disabled", async () => {
      const result = await tool.execute(
        {
          url: `${serverUrl}/redirect`,
          follow_redirects: false,
        },
        context
      );

      expect(result.status_code).toBe(302);
      expect(result.headers.location).toBe("/redirected");
    });

    it("should follow redirect chain", async () => {
      const result = await tool.execute(
        { url: `${serverUrl}/redirect-chain` },
        context
      );

      expect(result.status_code).toBe(200);
      expect(result.body).toBe("End of chain");
    });

    it("should handle too many redirects", async () => {
      await expect(
        tool.execute(
          {
            url: `${serverUrl}/redirect-loop`,
            max_redirects: 5,
          },
          context
        )
      ).rejects.toThrow("Too many redirects");
    });
  });

  describe("error handling", () => {
    it("should throw error if URL is missing", async () => {
      await expect(
        tool.execute({} as any, context)
      ).rejects.toThrow("web_fetch: 'url' parameter is required");
    });

    it("should throw error for invalid URL", async () => {
      await expect(
        tool.execute({ url: "not-a-valid-url" }, context)
      ).rejects.toThrow("web_fetch: Invalid URL");
    });

    it("should handle 404 status", async () => {
      const result = await tool.execute(
        { url: `${serverUrl}/404` },
        context
      );

      expect(result.status_code).toBe(404);
      expect(result.body).toBe("Not Found");
    });

    it("should handle 500 status", async () => {
      const result = await tool.execute(
        { url: `${serverUrl}/500` },
        context
      );

      expect(result.status_code).toBe(500);
      expect(result.body).toBe("Internal Server Error");
    });

    it("should handle timeout", async () => {
      await expect(
        tool.execute(
          {
            url: `${serverUrl}/slow`,
            timeout: 100,
          },
          context
        )
      ).rejects.toThrow("Request timed out");
    }, 10000);

    it("should handle network errors", async () => {
      // Use a valid URL but non-existent host
      await expect(
        tool.execute(
          { url: "http://non-existent-host-12345.local" },
          context
        )
      ).rejects.toThrow("web_fetch: Request failed");
    });
  });

  describe("methods", () => {
    it("should use GET by default", async () => {
      const result = await tool.execute(
        { url: serverUrl },
        context
      );

      expect(result.status_code).toBe(200);
    });

    it("should use custom method", async () => {
      const result = await tool.execute(
        {
          url: serverUrl,
          method: "GET",
        },
        context
      );

      expect(result.status_code).toBe(200);
    });
  });

  describe("timeout", () => {
    it("should use default timeout", async () => {
      const result = await tool.execute(
        { url: serverUrl },
        context
      );

      expect(result.duration_ms).toBeLessThan(30000);
    });

    it("should use custom timeout", async () => {
      const result = await tool.execute(
        {
          url: serverUrl,
          timeout: 5000,
        },
        context
      );

      expect(result.duration_ms).toBeLessThan(5000);
    });
  });
});
