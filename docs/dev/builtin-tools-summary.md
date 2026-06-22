# Runtime Builtin Tools - Implementation Summary

## Overview

All 7 builtin tools have been successfully implemented for the Agent Protocol v3 Runtime layer.

## Kimi WebBridge — External HTTP JSON MCP (不是 builtin tool)

Kimi WebBridge 是一个特殊的 MCP 工具：**不走 builtin tool 体系，而是作为外部 HTTP MCP 集成**。

### 与 builtin tools 的区别

| | Builtin Tools | Kimi WebBridge |
|---|---|---|
| 定义位置 | `src/runtime/tools/*.ts` | `agent_compose/kimi_webbridge_client.py` |
| 传输方式 | 直接函数调用 | HTTP JSON API (`POST http://127.0.0.1:10086/command`) |
| 协议 | TypeScript 函数 | Chrome DevTools Protocol |
| 运行环境 | Node.js 进程内 | 浏览器扩展 + 本地 daemon |
| Shell 权限 | ❌ 需要（有 bash.ts） | ✅ **不需要** |
| 子进程 | ❌ 需要（有 StdioTransport） | ✅ **不需要** |

### 工具命名（重要）

Kimi WebBridge agent.json 中声明的工具名是 `browser_*` 前缀，但 **LLM 实际看到的工具名是 `webbridge_*` 前缀**。Python 运行时同时注册两套名字，LLM 用哪个都能调用。

| agent.json capability 声明 | LLM 调用名 | daemon action | 说明 |
|---|---|---|---|
| `browser_navigate` | `webbridge_navigate` | `navigate` | 打开 URL |
| `browser_snapshot` | `webbridge_snapshot` | `snapshot` | 获取可访问性树 |
| `browser_click` | `webbridge_click` | `click` | 点击元素 |
| `browser_fill` | `webbridge_fill` | `fill` | 填写表单 |
| `browser_type` | `webbridge_type` | `key_type` | 输入文本 |
| `browser_keys` | `webbridge_keys` | `send_keys` | 发送按键 |
| `browser_evaluate` | `webbridge_evaluate` | `evaluate` | 执行 JavaScript |
| `browser_screenshot` | `webbridge_screenshot` | `screenshot` | 截图 |
| `browser_pdf` | `webbridge_pdf` | `save_as_pdf` | 保存 PDF |
| `browser_list_tabs` | `webbridge_list_tabs` | `list_tabs` | 列出 tabs |
| `browser_find_tab` | `webbridge_find_tab` | `find_tab` | 查找切换 tab |
| `browser_close_tab` | `webbridge_close_tab` | `close_tab` | 关闭 tab |

### 端到端验证结果（2026-06-20）

```
Step 1: health_check   ✅ running=True, extension_connected=True, v1.10.0
Step 2: load_agent     ✅ market fetch + agent.json 解析
Step 3: mcp_init       ✅ connected=['kimi-webbridge'], 24 tools (12 webbridge_* + 12 browser_*)
Step 4: direct_tools   ✅ navigate → success, snapshot → content, evaluate → "Example Domain"
Step 5: llm_chat      ✅ LLM 调用 browser_navigate + webbridge_snapshot，返回 "Example Domain"
Step 6: interactive    ✅ 多轮对话正常
总计: 6/6 ✅
```

### 在 Node/TypeScript 运行时集成 WebBridge

Node 运行时通过 `MCPToolLoader` 集成 HTTP MCP 时，需要特殊处理 `kimi-webbridge` 类型：

```typescript
// 在 mcp-integration.ts 中扩展检测逻辑
async listToolsFromWebBridge(
  serverName: string,
  entry: MCPHttpServerConfig
): Promise<MCPToolDefinition[]> {
  // GET /status 健康检查
  const status = await httpMCPRequest(entry.url, "status", {});
  if (!status.running || !status.extension_connected) {
    console.warn(`[WebBridge] ${serverName} daemon not ready:`, status);
    return [];
  }

  // 硬编码 12 个工具 schema（因为 WebBridge 不提供 tools/list 接口）
  return WEBBRIDGE_TOOL_DEFINITIONS;
}
```

> **注意**：WebBridge daemon (`/command` 接口) 目前不提供 `tools/list` 接口，因此需要运行时**硬编码工具 schema 定义**。这也是 `agent_compose` 的 Python 运行时在 `kimi_webbridge_client.py` 中用 `_WEBBRIDGE_TOOLS` 列表驱动的原因。

---

## Completed Tools

### 1. read_file (15 tests)
- **Purpose**: Read text files with encoding support
- **Features**:
  - Path resolution (relative/absolute)
  - Encoding support (utf-8, ascii, etc.)
  - Size limits (default 10MB)
  - Error handling (missing files, directories, size exceeded)
- **File**: `src/runtime/tools/read-file.ts`

### 2. write_file (17 tests)
- **Purpose**: Write text to files
- **Features**:
  - Overwrite and append modes
  - Auto-create parent directories
  - Encoding support
  - Return bytes written
- **File**: `src/runtime/tools/write-file.ts`

### 3. bash (14 tests)
- **Purpose**: Execute shell commands
- **Features**:
  - Timeout support (default 2min)
  - Environment variable merging
  - Working directory support
  - Cross-platform (Windows cmd.exe / Unix bash)
  - Non-zero exit codes handled gracefully
- **File**: `src/runtime/tools/bash.ts`

### 4. glob (18 tests)
- **Purpose**: File pattern matching
- **Features**:
  - Glob patterns (*.txt, **/*.js)
  - Ignore patterns
  - Max results limit
  - Custom working directory
  - Returns absolute paths
- **File**: `src/runtime/tools/glob.ts`

### 5. llm_chat (27 tests) ⭐
- **Purpose**: Call LLM APIs for inference
- **Features**:
  - Anthropic Claude API support
  - OpenAI GPT API support
  - Parameter overrides (model, temperature, max_tokens)
  - System prompts
  - API keys from environment
  - Token usage tracking
  - Duration measurement
- **File**: `src/runtime/tools/llm-chat.ts`
- **Dependencies**: `@anthropic-ai/sdk`, `openai`

### 6. web_fetch (20 tests)
- **Purpose**: HTTP/HTTPS requests
- **Features**:
  - GET/POST methods
  - Custom headers
  - Timeout support
  - Redirect following (with max limit)
  - Status code, headers, body return
  - Duration measurement
- **File**: `src/runtime/tools/web-fetch.ts`

### 7. web_search (16 tests)
- **Purpose**: Web search via search engine APIs
- **Features**:
  - DuckDuckGo (default, no API key required)
  - Google Custom Search API
  - Bing Search API
  - Max results limit
  - Language and region support
  - HTML parsing and entity decoding
- **File**: `src/runtime/tools/web-search.ts`

## Test Coverage

| Tool | Tests | Status |
|------|-------|--------|
| read_file | 15 | ✅ |
| write_file | 17 | ✅ |
| bash | 14 | ✅ |
| glob | 18 | ✅ |
| llm_chat | 27 | ✅ |
| web_fetch | 20 | ✅ |
| web_search | 16 | ✅ |
| **Pipeline Engine** | 87 | ✅ |
| **Tool Tests Total** | **127** | ✅ |
| **All Tests Total** | **276** | ✅ |

## Architecture Highlights

### Tool Interface
All tools implement the `Tool` interface:
```typescript
interface Tool {
  name: string;
  execute(args: any, context: ExecutionContext): Promise<any>;
}
```

### Execution Context
Tools receive shared context:
- `agent`: Agent configuration
- `cwd`: Current working directory
- `env`: Environment variables
- `sharedContext`: Cross-step data
- `steps`: Execution history

### Cross-Platform Support
- Bash tool detects Windows vs Unix and uses appropriate shell
- Path handling works on both platforms
- Tests handle platform-specific commands

### Error Handling
- Consistent error message format: `tool_name: Error description`
- Validation of required parameters
- Graceful handling of timeouts, network errors, API errors
- Duration tracking even on errors

## Next Steps (Task 5.3)

**Tool Inheritance Architecture** (CRITICAL):
- Implement `ToolRegistry` with parent pointer
- Subagents inherit parent agent's builtin tools automatically
- Design approved, ready for implementation in Task 5.3

```typescript
export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private parent?: ToolRegistry;
  
  constructor(parent?: ToolRegistry) {
    this.parent = parent;
  }
  
  get(name: string): Tool | undefined {
    const local = this.tools.get(name);
    if (local) return local;
    if (this.parent) return this.parent.get(name);
    return undefined;
  }
  
  createChild(): ToolRegistry {
    return new ToolRegistry(this);
  }
}
```

## Performance Notes

- **llm_chat**: Most expensive (API calls), tracks duration and tokens
- **web_fetch**: Network-dependent, includes timeout support
- **web_search**: DuckDuckGo parsing may be slower, Google/Bing are faster with API keys
- **bash**: Cross-platform timeout detection varies
- All tools track execution duration in ms

## Dependencies Added

- `@anthropic-ai/sdk` - Claude API client
- `openai` - OpenAI API client  
- `glob` - File pattern matching
- `js-yaml` - YAML parsing (for pipeline engine)

## Git History

1. ✅ Pipeline Engine Core (87 tests)
2. ✅ read_file tool (15 tests)
3. ✅ write_file tool (17 tests)
4. ✅ bash tool (14 tests)
5. ✅ glob tool (18 tests)
6. ✅ llm_chat tool (27 tests)
7. ✅ web_fetch tool (20 tests)
8. ✅ web_search tool (16 tests)

**Branch**: `phase5-runtime`
**Commits**: 7 feature commits
**Total Lines Added**: ~3000+ lines of implementation + tests
