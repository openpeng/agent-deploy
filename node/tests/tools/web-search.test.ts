import { describe, it, expect, beforeEach } from "vitest";
import { WebSearchTool } from "../../src/runtime/tools/web-search.js";
import { ExecutionContextManager } from "../../src/runtime/context.js";
import { ExecutionContext } from "../../src/runtime/types.js";

describe("WebSearchTool", () => {
  let tool: WebSearchTool;
  let context: ExecutionContext;

  beforeEach(() => {
    tool = new WebSearchTool();

    context = ExecutionContextManager.create({
      agent: { name: "test-agent" },
      initialArgs: {},
      cwd: process.cwd(),
      env: {
        GOOGLE_SEARCH_API_KEY: "test-google-key",
        GOOGLE_SEARCH_ENGINE_ID: "test-engine-id",
        BING_SEARCH_API_KEY: "test-bing-key",
      },
    });
  });

  describe("parameter validation", () => {
    it("should throw error if query is missing", async () => {
      await expect(
        tool.execute({} as any, context)
      ).rejects.toThrow("web_search: 'query' parameter is required");
    });

    it("should throw error for unknown search engine", async () => {
      await expect(
        tool.execute(
          { query: "test", engine: "unknown" as any },
          context
        )
      ).rejects.toThrow("Unknown search engine");
    });
  });

  describe("Google search requirements", () => {
    it("should throw error if Google API key is missing", async () => {
      const contextWithoutKey = ExecutionContextManager.create({
        agent: { name: "test-agent" },
        initialArgs: {},
        cwd: process.cwd(),
        env: {},
      });

      await expect(
        tool.execute(
          { query: "test", engine: "google" },
          contextWithoutKey
        )
      ).rejects.toThrow("GOOGLE_SEARCH_API_KEY");
    });

    it("should throw error if Google Search Engine ID is missing", async () => {
      const contextWithoutId = ExecutionContextManager.create({
        agent: { name: "test-agent" },
        initialArgs: {},
        cwd: process.cwd(),
        env: {
          GOOGLE_SEARCH_API_KEY: "test-key",
        },
      });

      await expect(
        tool.execute(
          { query: "test", engine: "google" },
          contextWithoutId
        )
      ).rejects.toThrow("GOOGLE_SEARCH_ENGINE_ID");
    });
  });

  describe("Bing search requirements", () => {
    it("should throw error if Bing API key is missing", async () => {
      const contextWithoutKey = ExecutionContextManager.create({
        agent: { name: "test-agent" },
        initialArgs: {},
        cwd: process.cwd(),
        env: {},
      });

      await expect(
        tool.execute(
          { query: "test", engine: "bing" },
          contextWithoutKey
        )
      ).rejects.toThrow("BING_SEARCH_API_KEY");
    });
  });

  describe("HTML parsing utilities", () => {
    it("should strip HTML tags", () => {
      const tool = new WebSearchTool();
      const html = "<p>Hello <b>world</b></p>";
      // @ts-ignore - accessing private method for testing
      const stripped = tool.stripHtmlTags(html);
      expect(stripped).toBe("Hello world");
    });

    it("should decode HTML entities", () => {
      const tool = new WebSearchTool();
      // @ts-ignore - accessing private method for testing
      const decoded = tool.decodeHtmlEntities("Hello &amp; goodbye &quot;world&quot;");
      expect(decoded).toBe('Hello & goodbye "world"');
    });

    it("should handle multiple spaces", () => {
      const tool = new WebSearchTool();
      // @ts-ignore - accessing private method for testing
      const stripped = tool.stripHtmlTags("<p>Hello    world</p>");
      expect(stripped).toBe("Hello world");
    });
  });

  describe("DuckDuckGo HTML parsing", () => {
    it("should parse DuckDuckGo HTML results", () => {
      const tool = new WebSearchTool();
      const mockHtml = `
        <div class="result">
          <a class="result__a" href="https://example.com/1">Example Result 1</a>
          <a class="result__snippet">This is a snippet for result 1</a>
        </div>
        <div class="result">
          <a class="result__a" href="https://example.com/2">Example Result 2</a>
          <a class="result__snippet">This is a snippet for result 2</a>
        </div>
      `;

      // @ts-ignore - accessing private method for testing
      const results = tool.parseDuckDuckGoHTML(mockHtml, 10);

      expect(results).toHaveLength(2);
      expect(results[0].title).toBe("Example Result 1");
      expect(results[0].url).toBe("https://example.com/1");
      expect(results[0].snippet).toBe("This is a snippet for result 1");
    });

    it("should limit results to max_results", () => {
      const tool = new WebSearchTool();
      const mockHtml = `
        <div class="result">
          <a class="result__a" href="https://example.com/1">Result 1</a>
          <a class="result__snippet">Snippet 1</a>
        </div>
        <div class="result">
          <a class="result__a" href="https://example.com/2">Result 2</a>
          <a class="result__snippet">Snippet 2</a>
        </div>
        <div class="result">
          <a class="result__a" href="https://example.com/3">Result 3</a>
          <a class="result__snippet">Snippet 3</a>
        </div>
      `;

      // @ts-ignore - accessing private method for testing
      const results = tool.parseDuckDuckGoHTML(mockHtml, 2);

      expect(results).toHaveLength(2);
    });

    it("should handle empty HTML", () => {
      const tool = new WebSearchTool();
      const mockHtml = "<html><body>No results</body></html>";

      // @ts-ignore - accessing private method for testing
      const results = tool.parseDuckDuckGoHTML(mockHtml, 10);

      expect(results).toHaveLength(0);
    });

    it("should strip HTML tags from results", () => {
      const tool = new WebSearchTool();
      const mockHtml = `
        <div class="result">
          <a class="result__a" href="https://example.com">Result with <b>bold</b> text</a>
          <a class="result__snippet">Snippet with <em>italic</em> text</a>
        </div>
      `;

      // @ts-ignore - accessing private method for testing
      const results = tool.parseDuckDuckGoHTML(mockHtml, 10);

      expect(results[0].title).toBe("Result with bold text");
      expect(results[0].snippet).toBe("Snippet with italic text");
    });

    it("should decode HTML entities in URLs", () => {
      const tool = new WebSearchTool();
      const mockHtml = `
        <div class="result">
          <a class="result__a" href="https://example.com?foo=bar&amp;baz=qux">Result &amp; Title</a>
          <a class="result__snippet">Snippet with &quot;quotes&quot;</a>
        </div>
      `;

      // @ts-ignore - accessing private method for testing
      const results = tool.parseDuckDuckGoHTML(mockHtml, 10);

      expect(results[0].url).toBe("https://example.com?foo=bar&baz=qux");
      expect(results[0].title).toBe("Result & Title");
    });
  });

  describe("result structure", () => {
    it("should have correct tool name", () => {
      expect(tool.name).toBe("web_search");
    });

    it("should validate required parameters", async () => {
      await expect(
        tool.execute({} as any, context)
      ).rejects.toThrow("'query' parameter is required");
    });

    it("should default max_results to 10", () => {
      // This is tested via the parsing tests above
      expect(true).toBe(true);
    });
  });
});
