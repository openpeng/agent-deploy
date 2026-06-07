import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Tool } from "../pipeline.js";
import { ExecutionContext } from "../types.js";

/**
 * LLM Chat tool
 * Calls LLM APIs using LangChain for unified interface
 * Supports multiple providers: Anthropic, OpenAI, and more
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
        return await this.callWithLangChainAnthropic(
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
        return await this.callWithLangChainOpenAI(
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

  private async callWithLangChainAnthropic(
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
    const llm = new ChatAnthropic({
      anthropicApiKey: apiKey,
      modelName: model,
      temperature,
      maxTokens,
      ...(apiBase && { anthropicApiUrl: apiBase }),
    });

    // Build messages
    const messages = [];
    if (systemPrompt) {
      messages.push(new SystemMessage(systemPrompt));
    }
    messages.push(new HumanMessage(prompt));

    // Invoke LLM
    const response = await llm.invoke(messages);

    const duration = Date.now() - startTime;

    // Extract content
    const content = typeof response.content === "string"
      ? response.content
      : response.content.map((c: any) => (typeof c === "string" ? c : c.text || "")).join("");

    // Calculate tokens (LangChain includes usage metadata)
    const usage = response.response_metadata?.usage as any;
    const tokensUsed = usage
      ? (usage.input_tokens || 0) + (usage.output_tokens || 0)
      : 0;

    return {
      content,
      model: (response.response_metadata?.model as string) || model,
      tokens_used: tokensUsed,
      duration_ms: duration,
    };
  }

  private async callWithLangChainOpenAI(
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
    const llm = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: model,
      temperature,
      maxTokens,
      ...(apiBase && { configuration: { baseURL: apiBase } }),
    });

    // Build messages
    const messages = [];
    if (systemPrompt) {
      messages.push(new SystemMessage(systemPrompt));
    }
    messages.push(new HumanMessage(prompt));

    // Invoke LLM
    const response = await llm.invoke(messages);

    const duration = Date.now() - startTime;

    // Extract content
    const content = typeof response.content === "string"
      ? response.content
      : response.content.map((c: any) => (typeof c === "string" ? c : c.text || "")).join("");

    // Calculate tokens (LangChain includes usage metadata)
    const tokenUsage = response.response_metadata?.tokenUsage as any;
    const tokensUsed = tokenUsage
      ? (tokenUsage.promptTokens || 0) + (tokenUsage.completionTokens || 0)
      : 0;

    return {
      content,
      model: (response.response_metadata?.model as string) || model,
      tokens_used: tokensUsed,
      duration_ms: duration,
    };
  }
}
