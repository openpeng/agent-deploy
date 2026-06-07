# LangChain Migration - llm_chat Tool

## Overview
Successfully migrated the `llm_chat` builtin tool from direct SDK usage to LangChain for a more unified and extensible LLM integration.

## Migration Details

### Before (Direct SDKs)
```typescript
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// Separate implementations for each provider
const anthropicClient = new Anthropic({ apiKey });
const response = await anthropicClient.messages.create({...});

const openaiClient = new OpenAI({ apiKey });
const response = await openaiClient.chat.completions.create({...});
```

### After (LangChain)
```typescript
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// Unified interface for all providers
const llm = new ChatAnthropic({ anthropicApiKey: apiKey, modelName, temperature, maxTokens });
const messages = [new SystemMessage(systemPrompt), new HumanMessage(prompt)];
const response = await llm.invoke(messages);
```

## Benefits

### 1. Unified Interface
- Same message format across all providers (SystemMessage, HumanMessage, AIMessage)
- Consistent response structure with `response_metadata`
- Standard token tracking via `usage` or `tokenUsage` metadata

### 2. Better Extensibility
Easy to add new providers:
- ✅ Anthropic Claude (ChatAnthropic)
- ✅ OpenAI GPT (ChatOpenAI)
- 🔜 Azure OpenAI (ChatOpenAI with custom baseURL)
- 🔜 Google Gemini (@langchain/google-genai)
- 🔜 Cohere (@langchain/cohere)
- 🔜 HuggingFace (@langchain/community)
- 🔜 AWS Bedrock (@langchain/community)
- 🔜 Ollama (local models)

### 3. Community Best Practices
- Built-in retry logic
- Better error handling
- Standard prompt templates
- Streaming support (future)
- Token counting and cost tracking

### 4. Backward Compatibility
- All existing API parameters preserved
- Same return structure
- All 27 tests passing without changes to test expectations

## API Interface (Unchanged)

```typescript
await tool.execute({
  prompt: "Hello, AI!",
  system_prompt?: "You are a helpful assistant",
  model?: "claude-3-5-sonnet-20241022",
  temperature?: 0.7,
  max_tokens?: 4096,
  provider?: "anthropic" | "openai",
  api_key?: "custom-key",
  api_base?: "https://custom.api.com",
}, context);
```

## Response Structure (Unchanged)

```typescript
{
  content: string,        // Generated text
  model: string,          // Actual model used
  tokens_used: number,    // Input + output tokens
  duration_ms: number     // Request duration
}
```

## Dependencies

### Added
- `@langchain/core` - Core LangChain types and messages
- `@langchain/anthropic` - Anthropic/Claude integration
- `@langchain/openai` - OpenAI/GPT integration

### Removed
- `@anthropic-ai/sdk` - Replaced by LangChain
- `openai` - Replaced by LangChain

## Test Coverage

All 27 tests remain passing:
- ✅ Basic functionality (Anthropic/OpenAI)
- ✅ System prompts
- ✅ Parameter handling (model, temperature, max_tokens)
- ✅ API key management
- ✅ Error handling
- ✅ Response parsing
- ✅ Token counting
- ✅ Duration measurement

## Future Enhancements

With LangChain foundation in place, we can now easily add:

1. **Streaming Support**
   ```typescript
   const stream = await llm.stream(messages);
   for await (const chunk of stream) {
     yield chunk.content;
   }
   ```

2. **More Providers**
   ```typescript
   // Azure OpenAI
   new ChatOpenAI({
     azureOpenAIApiKey: key,
     azureOpenAIApiInstanceName: instance,
     azureOpenAIApiDeploymentName: deployment,
   });
   
   // Google Gemini
   import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
   new ChatGoogleGenerativeAI({ apiKey, modelName: "gemini-pro" });
   ```

3. **Prompt Templates**
   ```typescript
   import { ChatPromptTemplate } from "@langchain/core/prompts";
   const template = ChatPromptTemplate.fromMessages([
     ["system", "You are {role}"],
     ["human", "{input}"],
   ]);
   ```

4. **Tool Calling / Function Calling**
   ```typescript
   const llmWithTools = llm.bind({
     tools: [calculatorTool, searchTool],
   });
   ```

5. **Chains and Agents**
   ```typescript
   import { RunnableSequence } from "@langchain/core/runnables";
   const chain = RunnableSequence.from([
     prompt,
     llm,
     outputParser,
   ]);
   ```

## Migration Impact

- ✅ No breaking changes to external API
- ✅ All tests passing (276 total)
- ✅ Same performance characteristics
- ✅ Better error messages from LangChain
- ✅ Foundation for future enhancements

## Recommendation

This migration significantly improves the `llm_chat` tool's architecture and sets up the codebase for easy integration of additional LLM providers. The unified interface reduces maintenance burden and makes it trivial to support new providers as they emerge.
