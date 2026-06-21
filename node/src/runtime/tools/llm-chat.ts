import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Tool } from "../pipeline.js";
import { ExecutionContext } from "../types.js";

export type LLMProvider = "anthropic" | "openai" | "openai_compatible";

interface LLMCacheEntry {
  response: { content: string; model: string; tokens_used: number };
  timestamp: number;
}

interface LLMChatArgs {
  prompt: string;
  system_prompt?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  provider?: LLMProvider;
  api_key?: string;
  api_base?: string;
}

interface LLMChatResult {
  content: string;
  model: string;
  tokens_used: number;
  duration_ms: number;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface OpenAIUsage {
  promptTokens?: number;
  completionTokens?: number;
}

interface LLMErrorLike {
  status?: number;
  response?: { status?: number };
  message?: string;
}

const llmCache = new Map<string, LLMCacheEntry>();
const CACHE_TTL = 5 * 60 * 1000;
const FALLBACK_ORDER: LLMProvider[] = ["anthropic", "openai_compatible"];

export function autoDetectProvider(specified: LLMProvider | undefined, env: Record<string, string | undefined>): LLMProvider {
  if (specified) return specified;
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return "anthropic";
  if (env.LLM_BASE_URL) return "openai_compatible";
  if (env.OPENAI_API_KEY || env.OPENAI_AUTH_TOKEN) return "openai";
  return "anthropic";
}

function resolveApiKey(provider: LLMProvider, argsKey: string | undefined, env: Record<string, string | undefined>): string | undefined {
  if (argsKey) return argsKey;
  switch (provider) {
    case "anthropic": return env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN;
    case "openai": return env.OPENAI_API_KEY || env.OPENAI_AUTH_TOKEN;
    case "openai_compatible": return env.LLM_API_KEY || env.LLM_AUTH_TOKEN || env.OPENAI_API_KEY;
  }
}

function resolveApiBase(provider: LLMProvider, argsBase: string | undefined, env: Record<string, string | undefined>): string | undefined {
  if (argsBase) return argsBase;
  switch (provider) {
    case "anthropic": return env.ANTHROPIC_BASE_URL;
    case "openai": return env.OPENAI_BASE_URL;
    case "openai_compatible": return env.LLM_BASE_URL || env.OPENAI_BASE_URL;
  }
}

function resolveModel(provider: LLMProvider, argsModel: string | undefined, env: Record<string, string | undefined>): string {
  if (argsModel) return argsModel;
  if (env.LLM_MODEL) return env.LLM_MODEL;
  if (env.ANTHROPIC_MODEL) return env.ANTHROPIC_MODEL;
  if (env.OPENAI_MODEL) return env.OPENAI_MODEL;
  return provider === "anthropic" ? "claude-3-5-sonnet-latest" : "gpt-4o";
}

function formatLLMError(provider: LLMProvider, model: string, apiBase: string | undefined, error: LLMErrorLike): Error {
  const status = error?.status || error?.response?.status || "unknown";
  const lines = [
    "llm_chat: API call failed",
    "  Provider:  " + provider,
    "  Endpoint:  " + (apiBase || "(default)"),
    "  Model:     " + model,
    "  Status:    " + status,
  ];
  if (String(status).startsWith("4")) lines.push("  Hint: Check model name or API key validity");
  else if (String(status).startsWith("5")) lines.push("  Hint: Upstream temporarily unavailable — provider fallback will be attempted");
  return new Error(lines.join("\n"));
}

export class LLMChatTool implements Tool {
  name = "llm_chat";

  async execute(
    args: LLMChatArgs,
    context: ExecutionContext
  ): Promise<LLMChatResult> {
    if (!args.prompt) throw new Error("llm_chat: 'prompt' parameter is required");

    const temperature = args.temperature !== undefined ? args.temperature : 0.7;
    const maxTokens = args.max_tokens || 4096;
    const startTime = Date.now();

    // Cache check
    const cacheKey = args.model + ":" + (args.system_prompt || "").substring(0, 50) + ":" + args.prompt.substring(0, 100);
    const cached = llmCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      return { ...cached.response, duration_ms: Date.now() - startTime };
    }

    let lastError: LLMErrorLike | undefined;
    for (const provider of FALLBACK_ORDER) {
      const apiKey = resolveApiKey(provider, args.api_key, context.env);
      if (!apiKey) continue;

      const apiBase = resolveApiBase(provider, args.api_base, context.env);
      const model = resolveModel(provider, args.model, context.env);

      try {
        const result = provider === "anthropic"
          ? await this.callAnthropic(apiKey, args.prompt, args.system_prompt, model, temperature, maxTokens, apiBase, startTime)
          : await this.callOpenAI(apiKey, args.prompt, args.system_prompt, model, temperature, maxTokens, apiBase, startTime);

        llmCache.set(cacheKey, { response: result, timestamp: Date.now() });
        return result;
      } catch (error: unknown) {
        lastError = error as LLMErrorLike;
        const isRetryable = String((error as LLMErrorLike)?.status || "").startsWith("5") || ((error as LLMErrorLike)?.message || "").includes("timeout");
        if (isRetryable && provider !== FALLBACK_ORDER[FALLBACK_ORDER.length - 1]) {
          console.log("  \u21B3 llm_chat: '" + provider + "' failed, trying next provider...");
          continue;
        }
        throw formatLLMError(provider, model, apiBase, error as LLMErrorLike);
      }
    }
    throw formatLLMError(autoDetectProvider(args.provider, context.env), args.model || "unknown", undefined, lastError || new Error("No credentials"));
  }

  private async callAnthropic(apiKey: string, prompt: string, sys: string | undefined,
    model: string, temp: number, maxTok: number, apiBase: string | undefined, startTime: number): Promise<LLMChatResult> {
    const cfg: { anthropicApiKey: string; modelName: string; temperature: number; maxTokens: number; anthropicApiUrl?: string } =
      { anthropicApiKey: apiKey, modelName: model, temperature: temp, maxTokens: maxTok };
    if (apiBase) cfg.anthropicApiUrl = apiBase;
    const llm = new ChatAnthropic(cfg);
    const msgs: (SystemMessage | HumanMessage)[] = [];
    if (sys) msgs.push(new SystemMessage(sys));
    msgs.push(new HumanMessage(prompt));
    const resp = await llm.invoke(msgs);
    const dur = Date.now() - startTime;
    const content = typeof resp.content === "string" ? resp.content : (resp.content as Array<{ text?: string } | string>).map((c) => typeof c === "string" ? c : c.text || "").join("");
    const usage = resp.response_metadata?.usage as AnthropicUsage | undefined;
    return { content, model: (resp.response_metadata?.model as string) || model, tokens_used: usage ? (usage.input_tokens || 0) + (usage.output_tokens || 0) : 0, duration_ms: dur };
  }

  private async callOpenAI(apiKey: string, prompt: string, sys: string | undefined,
    model: string, temp: number, maxTok: number, apiBase: string | undefined, startTime: number): Promise<LLMChatResult> {
    const cfg: { openAIApiKey: string; modelName: string; temperature: number; maxTokens: number; configuration?: { baseURL: string } } =
      { openAIApiKey: apiKey, modelName: model, temperature: temp, maxTokens: maxTok };
    if (apiBase) cfg.configuration = { baseURL: apiBase };
    const llm = new ChatOpenAI(cfg);
    const msgs: (SystemMessage | HumanMessage)[] = [];
    if (sys) msgs.push(new SystemMessage(sys));
    msgs.push(new HumanMessage(prompt));
    const resp = await llm.invoke(msgs);
    const dur = Date.now() - startTime;
    const content = typeof resp.content === "string" ? resp.content : (resp.content as Array<{ text?: string } | string>).map((c) => typeof c === "string" ? c : c.text || "").join("");
    const usage = resp.response_metadata?.tokenUsage as OpenAIUsage | undefined;
    return { content, model: (resp.response_metadata?.model as string) || model, tokens_used: usage ? (usage.promptTokens || 0) + (usage.completionTokens || 0) : 0, duration_ms: dur };
  }
}
