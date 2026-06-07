import { describe, it, expect, beforeEach, vi } from "vitest";
import { LLMChatTool } from "../../src/runtime/tools/llm-chat.js";
import { ExecutionContextManager } from "../../src/runtime/context.js";
import { ExecutionContext } from "../../src/runtime/types.js";

// Mock the SDKs
vi.mock("@anthropic-ai/sdk");
vi.mock("openai");

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

describe("LLMChatTool", () => {
  let tool: LLMChatTool;
  let context: ExecutionContext;
  let mockAnthropicCreate: any;
  let mockOpenAICreate: any;

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
    mockAnthropicCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Mocked Anthropic response" }],
      model: "claude-3-5-sonnet-20241022",
      usage: {
        input_tokens: 10,
        output_tokens: 20,
      },
    });

    (Anthropic as any).mockImplementation(() => ({
      messages: {
        create: mockAnthropicCreate,
      },
    }));

    // Setup OpenAI mock
    mockOpenAICreate = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: "Mocked OpenAI response",
          },
        },
      ],
      model: "gpt-4",
      usage: {
        prompt_tokens: 15,
        completion_tokens: 25,
      },
    });

    (OpenAI as any).mockImplementation(() => ({
      chat: {
        completions: {
          create: mockOpenAICreate,
        },
      },
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

      expect(mockAnthropicCreate).toHaveBeenCalledWith({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        temperature: 0.7,
        system: undefined,
        messages: [{ role: "user", content: "Hello, AI!" }],
      });
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

      expect(mockOpenAICreate).toHaveBeenCalledWith({
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello, AI!" }],
        temperature: 0.7,
        max_tokens: 4096,
      });
    });

    it("should include system prompt for Anthropic", async () => {
      await tool.execute(
        {
          prompt: "What is 2+2?",
          system_prompt: "You are a math teacher",
        },
        context
      );

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: "You are a math teacher",
        })
      );
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

      expect(mockOpenAICreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: "system", content: "You are a math teacher" },
            { role: "user", content: "What is 2+2?" },
          ],
        })
      );
    });
  });

  describe("parameter handling", () => {
    it("should use custom model", async () => {
      await tool.execute(
        { prompt: "Test", model: "claude-3-opus-20240229" },
        context
      );

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "claude-3-opus-20240229",
        })
      );
    });

    it("should use custom temperature", async () => {
      await tool.execute(
        { prompt: "Test", temperature: 0.5 },
        context
      );

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
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

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
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

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 1000,
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

      expect(Anthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: "https://custom.api.com",
        })
      );
    });
  });

  describe("API key handling", () => {
    it("should use API key from environment for Anthropic", async () => {
      await tool.execute({ prompt: "Test" }, context);

      expect(Anthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "test-anthropic-key",
        })
      );
    });

    it("should use API key from environment for OpenAI", async () => {
      await tool.execute(
        { prompt: "Test", provider: "openai" },
        context
      );

      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "test-openai-key",
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

      expect(Anthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "custom-key",
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
      mockAnthropicCreate.mockRejectedValue(new Error("API Error"));

      await expect(
        tool.execute({ prompt: "Test" }, context)
      ).rejects.toThrow("llm_chat: API call failed");
    });

    it("should handle OpenAI API error", async () => {
      mockOpenAICreate.mockRejectedValue(new Error("API Error"));

      await expect(
        tool.execute({ prompt: "Test", provider: "openai" }, context)
      ).rejects.toThrow("llm_chat: API call failed");
    });

    it("should include duration in error message", async () => {
      mockAnthropicCreate.mockRejectedValue(new Error("Network timeout"));

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
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
        model: "gpt-4",
        usage: { prompt_tokens: 10, completion_tokens: 0 },
      });

      const result = await tool.execute(
        { prompt: "Test", provider: "openai" },
        context
      );

      expect(result.content).toBe("");
      expect(result.tokens_used).toBe(10);
    });

    it("should handle missing usage from OpenAI", async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: "Response" } }],
        model: "gpt-4",
        usage: undefined,
      });

      const result = await tool.execute(
        { prompt: "Test", provider: "openai" },
        context
      );

      expect(result.tokens_used).toBe(0);
    });

    it("should handle non-text content from Anthropic", async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: "other", data: "something" }],
        model: "claude-3-5-sonnet-20241022",
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const result = await tool.execute({ prompt: "Test" }, context);

      expect(result.content).toBe("");
    });

    it("should calculate tokens correctly", async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: "text", text: "Response" }],
        model: "claude-3-5-sonnet-20241022",
        usage: { input_tokens: 100, output_tokens: 200 },
      });

      const result = await tool.execute({ prompt: "Test" }, context);

      expect(result.tokens_used).toBe(300);
    });

    it("should measure duration accurately", async () => {
      mockAnthropicCreate.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          content: [{ type: "text", text: "Response" }],
          model: "claude-3-5-sonnet-20241022",
          usage: { input_tokens: 10, output_tokens: 20 },
        };
      });

      const result = await tool.execute({ prompt: "Test" }, context);

      expect(result.duration_ms).toBeGreaterThanOrEqual(50);
    });
  });

  describe("model defaults", () => {
    it("should use default Anthropic model", async () => {
      await tool.execute({ prompt: "Test" }, context);

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "claude-3-5-sonnet-20241022",
        })
      );
    });

    it("should use default OpenAI model", async () => {
      await tool.execute(
        { prompt: "Test", provider: "openai" },
        context
      );

      expect(mockOpenAICreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-4",
        })
      );
    });

    it("should use default temperature", async () => {
      await tool.execute({ prompt: "Test" }, context);

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
        })
      );
    });

    it("should use default max_tokens", async () => {
      await tool.execute({ prompt: "Test" }, context);

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 4096,
        })
      );
    });
  });
});
