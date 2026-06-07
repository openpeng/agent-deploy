import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { Tool } from "../pipeline.js";
import { ExecutionContext } from "../types.js";

/**
 * LLM Chat tool
 * Calls LLM APIs (Anthropic Claude or OpenAI GPT)
 */
export class LLMChatTool implements Tool {
  name = "llm_chat";

  async execute(
    args: {
      prompt: string;
      system_prompt?: string;
      model?: string;
      temperature?: number;
      max_tokens?: number;
      provider?: "anthropic" | "openai";
      api_key?: string;
      api_base?: string;
    },
    context: ExecutionContext
  ): Promise<{
    content: string;
    model: string;
    tokens_used: number;
    duration_ms: number;
  }> {
    // Validate args
    if (!args.prompt) {
      throw new Error("llm_chat: 'prompt' parameter is required");
    }

    // Determine provider (default to anthropic)
    const provider = args.provider || "anthropic";

    // Get API key from args or environment
    const apiKey =
      args.api_key ||
      (provider === "anthropic"
        ? context.env.ANTHROPIC_API_KEY
        : context.env.OPENAI_API_KEY);

    if (!apiKey) {
      throw new Error(
        `llm_chat: API key not found. Set ${
          provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"
        } environment variable or pass api_key parameter`
      );
    }

    // Default parameters
    const model =
      args.model ||
      (provider === "anthropic" ? "claude-3-5-sonnet-20241022" : "gpt-4");
    const temperature = args.temperature !== undefined ? args.temperature : 0.7;
    const maxTokens = args.max_tokens || 4096;

    const startTime = Date.now();

    try {
      if (provider === "anthropic") {
        return await this.callAnthropic(
          apiKey,
          args.prompt,
          args.system_prompt,
          model,
          temperature,
          maxTokens,
          args.api_base,
          startTime
        );
      } else {
        return await this.callOpenAI(
          apiKey,
          args.prompt,
          args.system_prompt,
          model,
          temperature,
          maxTokens,
          args.api_base,
          startTime
        );
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;
      throw new Error(
        `llm_chat: API call failed (${duration}ms): ${error.message}`
      );
    }
  }

  private async callAnthropic(
    apiKey: string,
    prompt: string,
    systemPrompt: string | undefined,
    model: string,
    temperature: number,
    maxTokens: number,
    apiBase: string | undefined,
    startTime: number
  ): Promise<{
    content: string;
    model: string;
    tokens_used: number;
    duration_ms: number;
  }> {
    const client = new Anthropic({
      apiKey,
      baseURL: apiBase,
    });

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const duration = Date.now() - startTime;

    // Extract text content
    const content =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Calculate tokens used
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

    return {
      content,
      model: response.model,
      tokens_used: tokensUsed,
      duration_ms: duration,
    };
  }

  private async callOpenAI(
    apiKey: string,
    prompt: string,
    systemPrompt: string | undefined,
    model: string,
    temperature: number,
    maxTokens: number,
    apiBase: string | undefined,
    startTime: number
  ): Promise<{
    content: string;
    model: string;
    tokens_used: number;
    duration_ms: number;
  }> {
    const client = new OpenAI({
      apiKey,
      baseURL: apiBase,
    });

    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const response = await client.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    });

    const duration = Date.now() - startTime;

    // Extract content
    const content = response.choices[0]?.message?.content || "";

    // Calculate tokens used
    const tokensUsed = response.usage
      ? response.usage.prompt_tokens + response.usage.completion_tokens
      : 0;

    return {
      content,
      model: response.model,
      tokens_used: tokensUsed,
      duration_ms: duration,
    };
  }
}
