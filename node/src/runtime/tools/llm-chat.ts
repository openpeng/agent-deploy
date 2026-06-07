import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Tool } from "../pipeline.js";
import { ExecutionContext } from "../types.js";

/**
 * Supported LLM provider types.
 *
 * - anthropic:         Anthropic Claude API (native protocol)
 * - openai:            OpenAI API (native protocol)
 * - openai_compatible: Any OpenAI-compatible endpoint (private proxies, 轻课, etc.)
 */
export type LLMProvider = "anthropic" | "openai" | "openai_compatible";

/**
 * Auto-detect the best provider based on available environment variables.
 * Priority: args.provider > env var pattern > default "anthropic"
 */
export function autoDetectProvider(
  specified: LLMProvider | undefined,
  env: Record<string, string | undefined>
): LLMProvider {
  if (specified) return specified;

  // Check for Anthropic-specific env vars
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return "anthropic";

  // Check for generic/custom LLM endpoint (most proxies are OpenAI-compatible)
  if (env.LLM_BASE_URL) return "openai_compatible";

  // Check for OpenAI-specific env vars
  if (env.OPENAI_API_KEY || env.OPENAI_AUTH_TOKEN) return "openai";

  return "anthropic";
}

/**
 * Resolve the API key for a given provider from args and environment.
 */
function resolveApiKey(
  provider: LLMProvider,
  argsKey: string | undefined,
  env: Record<string, string | undefined>
): string | undefined {
  if (argsKey) return argsKey;

  switch (provider) {
    case "anthropic":
      return env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN;
    case "openai":
      return env.OPENAI_API_KEY || env.OPENAI_AUTH_TOKEN;
    case "openai_compatible":
      return env.LLM_API_KEY || env.LLM_AUTH_TOKEN || env.OPENAI_API_KEY;
  }
}

/**
 * Resolve the API base URL for a provider.
 */
function resolveApiBase(
  provider: LLMProvider,
  argsBase: string | undefined,
  env: Record<string, string | undefined>
): string | undefined {
  if (argsBase) return argsBase;

  switch (provider) {
    case "anthropic":
      return env.ANTHROPIC_BASE_URL;
    case "openai":
      return env.OPENAI_BASE_URL;
    case "openai_compatible":
      return env.LLM_BASE_URL || env.OPENAI_BASE_URL;
  }
}

/**
 * Resolve the model name with fallback chain.
 */
function resolveModel(
  provider: LLMProvider,
  argsModel: string | undefined,
  env: Record<string, string | undefined>
): string {
  if (argsModel) return argsModel;
  if (env.LLM_MODEL) return env.LLM_MODEL;
  if (env.ANTHROPIC_MODEL) return env.ANTHROPIC_MODEL;
  if (env.OPENAI_MODEL) return env.OPENAI_MODEL;

  switch (provider) {
    case "anthropic":
      return "claude-3-5-sonnet-latest";
    case "openai":
      return "gpt-4o";
    case "openai_compatible":
      return "gpt-4o"; // Most proxies default to gpt-4o compatible
  }
}

/**
 * Format a user-friendly error message with diagnostic context.
 */
function formatLLMError(
  provider: LLMProvider,
  model: string,
  apiBase: string | undefined,
  error: any
): Error {
  const status = error?.status || error?.response?.status || "unknown";
  const body = typeof error?.message === "string" ? error.message : JSON.stringify(error);

  // Extract API error details if present
  let apiDetail = "";
  try {
    if (error?.error?.message) {
      apiDetail = error.error.message;
    } else if (error?.response?.data?.error?.message) {
      apiDetail = error.response.data.error.message;
    }
  } catch {
    // Ignore
  }

  const lines = [
    `llm_chat: API call failed`,
    `  Provider:  ${provider}`,
    `  Endpoint:  ${apiBase || "(default)"}`,
    `  Model:     ${model}`,
    `  Status:    ${status}`,
  ];

  if (apiDetail) {
    lines.push(`  API Error: ${apiDetail}`);
  }

  // Add actionable hints based on error pattern
  if (String(status).startsWith("4") || String(status) === "400" || String(status) === "401") {
    lines.push(`  Hint: Check that the model name is supported by this endpoint`);
    lines.push(`        Verify API key / auth token is valid`);
  } else if (String(status).startsWith("5")) {
    lines.push(`  Hint: The upstream service is temporarily unavailable`);
    lines.push(`        Try again later or check the service status`);
  } else if (body.includes("timeout") || body.includes("ETIMEDOUT")) {
    lines.push(`  Hint: Network timeout — check endpoint reachability and firewall rules`);
  }

  return new Error(lines.join("\n"));
}

/**
 * LLM Chat tool — unified interface for multiple LLM providers.
 *
 * Supports:
 * - anthropic (Claude native API)
 * - openai (OpenAI native API)
 * - openai_compatible (any OpenAI-compatible endpoint, e.g. 轻课/private proxies)
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
      provider?: LLMProvider;
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

    // Auto-detect provider
    const provider = autoDetectProvider(args.provider, context.env);

    // Resolve credentials
    const apiKey = resolveApiKey(provider, args.api_key, context.env);
    const apiBase = resolveApiBase(provider, args.api_base, context.env);
    const model = resolveModel(provider, args.model, context.env);
    const temperature = args.temperature !== undefined ? args.temperature : 0.7;
    const maxTokens = args.max_tokens || 4096;

    if (!apiKey) {
      const envHints = provider === "anthropic"
        ? "ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN"
        : provider === "openai"
        ? "OPENAI_API_KEY or OPENAI_AUTH_TOKEN"
        : "LLM_API_KEY or LLM_AUTH_TOKEN or OPENAI_API_KEY";
      throw new Error(
        `llm_chat: API key not found for provider '${provider}'. ` +
        `Set ${envHints} environment variable, or pass api_key parameter`
      );
    }

    const startTime = Date.now();

    try {
      let result: { content: string; model: string; tokens_used: number; duration_ms: number };

      if (provider === "anthropic") {
        result = await this.callAnthropic(apiKey, args.prompt, args.system_prompt, model, temperature, maxTokens, apiBase, startTime);
      } else {
        // Both "openai" and "openai_compatible" use ChatOpenAI under the hood
        result = await this.callOpenAI(apiKey, args.prompt, args.system_prompt, model, temperature, maxTokens, apiBase, startTime);
      }

      return result;
    } catch (error: any) {
      throw formatLLMError(provider, model, apiBase, error);
    }
  }

  private async callAnthropic(
    apiKey: string, prompt: string, systemPrompt: string | undefined,
    model: string, temperature: number, maxTokens: number,
    apiBase: string | undefined, startTime: number
  ): Promise<{ content: string; model: string; tokens_used: number; duration_ms: number }> {
    const llm = new ChatAnthropic({
      anthropicApiKey: apiKey,
      modelName: model,
      temperature,
      maxTokens,
      ...(apiBase && { anthropicApiUrl: apiBase }),
    });

    const messages = [];
    if (systemPrompt) messages.push(new SystemMessage(systemPrompt));
    messages.push(new HumanMessage(prompt));

    const response = await llm.invoke(messages);
    const duration = Date.now() - startTime;

    const content = typeof response.content === "string"
      ? response.content
      : (response.content as any[]).map((c: any) => typeof c === "string" ? c : c.text || "").join("");

    const usage = response.response_metadata?.usage as any;
    const tokensUsed = usage ? (usage.input_tokens || 0) + (usage.output_tokens || 0) : 0;

    return {
      content,
      model: (response.response_metadata?.model as string) || model,
      tokens_used: tokensUsed,
      duration_ms: duration,
    };
  }

  private async callOpenAI(
    apiKey: string, prompt: string, systemPrompt: string | undefined,
    model: string, temperature: number, maxTokens: number,
    apiBase: string | undefined, startTime: number
  ): Promise<{ content: string; model: string; tokens_used: number; duration_ms: number }> {
    const config: any = {
      openAIApiKey: apiKey,
      modelName: model,
      temperature,
      maxTokens,
    };

    if (apiBase) {
      config.configuration = { baseURL: apiBase };
    }

    const llm = new ChatOpenAI(config);

    const messages = [];
    if (systemPrompt) messages.push(new SystemMessage(systemPrompt));
    messages.push(new HumanMessage(prompt));

    const response = await llm.invoke(messages);
    const duration = Date.now() - startTime;

    const content = typeof response.content === "string"
      ? response.content
      : (response.content as any[]).map((c: any) => typeof c === "string" ? c : c.text || "").join("");

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
