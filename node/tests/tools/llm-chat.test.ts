import { describe, it, expect, beforeEach, vi } from "vitest";
import { LLMChatTool } from "../../src/runtime/tools/llm-chat.js";
import { ExecutionContextManager } from "../../src/runtime/context.js";
import { ExecutionContext } from "../../src/runtime/types.js";

// Mock LangChain
vi.mock("@langchain/anthropic");
vi.mock("@langchain/openai");

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";

describe("LLMChatTool", () => {
  let tool: LLMChatTool;
  let context: ExecutionContext;
  let mockAnthropicInvoke: any;
  let mockOpenAIInvoke: any;

  beforeEach(() => {
    tool = new LLMChatTool();

    context = ExecutionContextManager.create({
      agent: { name: "test-agent" },
      initialArgs: {},
      cwd: process.cwd(),
      env: {
        ANTHROPIC_API_KEY: "test-anthropic-key",
        OPENAI_API_KEY: "test-openai-key",
      },
    });

    // Setup Anthropic mock
    mockAnthropicInvoke = vi.fn().mockResolvedValue({
      content: "Mocked Anthropic response",
      response_metadata: {
        model: "claude-3-5-sonnet-20241022",
        usage: {
          input_tokens: 10,
          output_tokens: 20,
        },
      },
    });

    (ChatAnthropic as any).mockImplementation(() => ({
      invoke: mockAnthropicInvoke,
    }));

    // Setup OpenAI mock
    mockOpenAIInvoke = vi.fn().mockResolvedValue({
      content: "Mocked OpenAI response",
      response_metadata: {
        model: "gpt-4",
        tokenUsage: {
          promptTokens: 15,
          completionTokens: 25,
        },
      },
    });

    (ChatOpenAI as any).mockImplementation(() => ({
      invoke: mockOpenAIInvoke,
    }));
  });

  describe("basic functionality", () => {
    it("should call Anthropic API by default", async () => {
      const result = await tool.execute(
        { prompt: "Hello, AI!" },
        context
      );

      expect(result.content).toBe("Mocked Anthropic response");
      expect(result.model).toBe("claude-3-5-sonnet-20241022");
      expect(result.tokens_used).toBe(30); // 10 + 20
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);

      expect(mockAnthropicInvoke).toHaveBeenCalled();
      const messages = mockAnthropicInvoke.mock.calls[0][0];
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Hello, AI!");
    });

    it("should call OpenAI API when provider is openai", async () => {
      const result = await tool.execute(
        { prompt: "Hello, AI!", provider: "openai" },
        context
      );

      expect(result.content).toBe("Mocked OpenAI response");
      expect(result.model).toBe("gpt-4");
      expect(result.tokens_used).toBe(40); // 15 + 25
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);

      expect(mockOpenAIInvoke).toHaveBeenCalled();
    });

    it("should include system prompt for Anthropic", async () => {
      await tool.execute(
        {
          prompt: "What is 2+2?",
          system_prompt: "You are a math teacher",
        },
        context
      );

      expect(mockAnthropicInvoke).toHaveBeenCalled();
      const messages = mockAnthropicInvoke.mock.calls[0][0];
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("You are a math teacher");
      expect(messages[1].content).toBe("What is 2+2?");
    });

    it("should include system prompt for OpenAI", async () => {
      await tool.execute(
        {
          prompt: "What is 2+2?",
          system_prompt: "You are a math teacher",
          provider: "openai",
        },
        context
      );

      expect(mockOpenAIInvoke).toHaveBeenCalled();
      const messages = mockOpenAIInvoke.mock.calls[0][0];
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("You are a math teacher");
      expect(messages[1].content).toBe("What is 2+2?");
    });
  });

  describe("parameter handling", () => {
    it("should use custom model", async () => {
      await tool.execute(
        { prompt: "Test", model: "claude-3-opus-20240229" },
        context
      );

      expect(ChatAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: "claude-3-opus-20240229",
        })
      );
    });

    it("should use custom temperature", async () => {
      await tool.execute(
        { prompt: "Test", temperature: 0.5 },
        context
      );

      expect(ChatAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.5,
        })
      );
    });

    it("should handle temperature 0", async () => {
      await tool.execute(
        { prompt: "Test", temperature: 0 },
        context
      );

      expect(ChatAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0,
        })
      );
    });

    it("should use custom max_tokens", async () => {
      await tool.execute(
        { prompt: "Test", max_tokens: 1000 },
        context
      );

      expect(ChatAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          maxTokens: 1000,
        })
      );
    });

    it("should use api_base if provided", async () => {
      await tool.execute(
        {
          prompt: "Test",
          api_base: "https://custom.api.com",
        },
        context
      );

      expect(ChatAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          anthropicApiUrl: "https://custom.api.com",
        })
      );
    });
  });

  describe("API key handling", () => {
    it("should use API key from environment for Anthropic", async () => {
      await tool.execute({ prompt: "Test" }, context);

      expect(ChatAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          anthropicApiKey: "test-anthropic-key",
        })
      );
    });

    it("should use API key from environment for OpenAI", async () => {
      await tool.execute(
        { prompt: "Test", provider: "openai" },
        context
      );

      expect(ChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          openAIApiKey: "test-openai-key",
        })
      );
    });

    it("should use API key from args if provided", async () => {
      await tool.execute(
        {
          prompt: "Test",
          api_key: "custom-key",
        },
        context
      );

      expect(ChatAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          anthropicApiKey: "custom-key",
        })
      );
    });

    it("should throw error if API key not found", async () => {
      const contextWithoutKey = ExecutionContextManager.create({
        agent: { name: "test-agent" },
        initialArgs: {},
        cwd: process.cwd(),
        env: {},
      });

      await expect(
        tool.execute({ prompt: "Test" }, contextWithoutKey)
      ).rejects.toThrow("API key not found");
    });

    it("should throw specific error for missing OpenAI key", async () => {
      const contextWithoutKey = ExecutionContextManager.create({
        agent: { name: "test-agent" },
        initialArgs: {},
        cwd: process.cwd(),
        env: {},
      });

      await expect(
        tool.execute(
          { prompt: "Test", provider: "openai" },
          contextWithoutKey
        )
      ).rejects.toThrow("OPENAI_API_KEY");
    });
  });

  describe("error handling", () => {
    it("should throw error if prompt is missing", async () => {
      await expect(
        tool.execute({} as any, context)
      ).rejects.toThrow("llm_chat: 'prompt' parameter is required");
    });

    it("should handle Anthropic API error", async () => {
      mockAnthropicInvoke.mockRejectedValue(new Error("API Error"));

      await expect(
        tool.execute({ prompt: "Test" }, context)
      ).rejects.toThrow("llm_chat: API call failed");
    });

    it("should handle OpenAI API error", async () => {
      mockOpenAIInvoke.mockRejectedValue(new Error("API Error"));

      await expect(
        tool.execute({ prompt: "Test", provider: "openai" }, context)
      ).rejects.toThrow("llm_chat: API call failed");
    });

    it("should include duration in error message", async () => {
      mockAnthropicInvoke.mockRejectedValue(new Error("Network timeout"));

      try {
        await tool.execute({ prompt: "Test" }, context);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.message).toMatch(/\(\d+ms\)/);
      }
    });
  });

  describe("response handling", () => {
    it("should handle empty content from OpenAI", async () => {
      mockOpenAIInvoke.mockResolvedValue({
        content: "",
        response_metadata: {
          model: "gpt-4",
          tokenUsage: { promptTokens: 10, completionTokens: 0 },
        },
      });

      const result = await tool.execute(
        { prompt: "Test", provider: "openai" },
        context
      );

      expect(result.content).toBe("");
      expect(result.tokens_used).toBe(10);
    });

    it("should handle missing usage from OpenAI", async () => {
      mockOpenAIInvoke.mockResolvedValue({
        content: "Response",
        response_metadata: {
          model: "gpt-4",
        },
      });

      const result = await tool.execute(
        { prompt: "Test", provider: "openai" },
        context
      );

      expect(result.tokens_used).toBe(0);
    });

    it("should handle array content from Anthropic", async () => {
      mockAnthropicInvoke.mockResolvedValue({
        content: [{ text: "Hello" }, { text: " world" }],
        response_metadata: {
          model: "claude-3-5-sonnet-20241022",
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      });

      const result = await tool.execute({ prompt: "Test" }, context);

      expect(result.content).toBe("Hello world");
    });

    it("should calculate tokens correctly", async () => {
      mockAnthropicInvoke.mockResolvedValue({
        content: "Response",
        response_metadata: {
          model: "claude-3-5-sonnet-20241022",
          usage: { input_tokens: 100, output_tokens: 200 },
        },
      });

      const result = await tool.execute({ prompt: "Test" }, context);

      expect(result.tokens_used).toBe(300);
    });

    it("should measure duration accurately", async () => {
      mockAnthropicInvoke.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          content: "Response",
          response_metadata: {
            model: "claude-3-5-sonnet-20241022",
            usage: { input_tokens: 10, output_tokens: 20 },
          },
        };
      });

      const result = await tool.execute({ prompt: "Test" }, context);

      expect(result.duration_ms).toBeGreaterThanOrEqual(50);
    });
  });

  describe("model defaults", () => {
    it("should use default Anthropic model", async () => {
      await tool.execute({ prompt: "Test" }, context);

      expect(ChatAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: "claude-3-5-sonnet-20241022",
        })
      );
    });

    it("should use default OpenAI model", async () => {
      await tool.execute(
        { prompt: "Test", provider: "openai" },
        context
      );

      expect(ChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: "gpt-4",
        })
      );
    });

    it("should use default temperature", async () => {
      await tool.execute({ prompt: "Test" }, context);

      expect(ChatAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
        })
      );
    });

    it("should use default max_tokens", async () => {
      await tool.execute({ prompt: "Test" }, context);

      expect(ChatAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          maxTokens: 4096,
        })
      );
    });
  });
});
