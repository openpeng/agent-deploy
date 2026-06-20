# Agent.json Specification v2.0

**Version**: 2.0  
**Date**: 2026-06-06  
**Status**: STABLE

## Overview

`agent.json` is the standard metadata and instruction format for PilotDeck Market agents. Version 2.0 introduces the `instructions` field, making agent.json the **single source of truth** for agent behavior, eliminating the need for separate SKILL.md files.

## Core Principles

1. **Single Source of Truth**: All agent information lives in agent.json
2. **Self-Contained**: Instructions can be inline or referenced
3. **Platform-Agnostic**: Describes capabilities independently of target AI tool
4. **Backward Compatible**: Supports migration from SKILL.md-based agents

---

## Schema

### Minimal Example

```json
{
  "schema_version": "2.0",
  "identity": {
    "name": "code-reviewer",
    "version": "1.0.0",
    "description": "Reviews code changes and provides feedback"
  },
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# Code Reviewer\n\n## What I do\n\nI review your code..."
  }
}
```

### Full Example

```json
{
  "schema_version": "2.0",
  
  "identity": {
    "name": "code-reviewer",
    "version": "1.2.3",
    "display_name": "Code Reviewer Agent",
    "description": "Reviews code changes and provides actionable feedback",
    "author": "Your Name <email@example.com>",
    "license": "MIT",
    "homepage_url": "https://github.com/yourusername/code-reviewer",
    "source_url": "https://github.com/yourusername/code-reviewer"
  },
  
  "classification": {
    "category": "utility",
    "type": "agent",
    "tags": ["code-review", "quality", "testing", "ci-cd"]
  },
  
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# Code Reviewer\n\n## What I do\n\nI review your code changes and provide actionable feedback...\n\n## How to use me\n\nSimply share your code diff or PR URL..."
  },
  
  "capabilities": [
    {
      "type": "tool_call",
      "name": "analyze_diff",
      "description": "Analyze git diff and identify potential issues"
    },
    {
      "type": "subagent",
      "name": "static_analyzer",
      "entry": "analyzers/static.yaml",
      "description": "Static code analysis subagent"
    }
  ],
  
  "compatibility": {
    "platforms": {
      "cursor": { "supported": true, "format": "slash_command" },
      "claude_code": { "supported": true, "format": "skill" },
      "github_copilot": { "supported": true, "format": "agent_instruction" }
    },
    "runtime_requirements": {
      "node": ">=18.0.0"
    }
  },
  
  "structure": {
    "entry_point": "main.yaml",
    "subagents": [
      { "name": "worker", "file": "subagents/worker.yaml" }
    ]
  },
  
  "dependencies": {
    "agents": ["linter-agent@^1.0.0"],
    "npm": ["@anthropic/sdk@^1.0.0"]
  }
}
```

---

## Field Reference

### Required Fields

#### `schema_version` (string, required)

Version of the agent.json specification. Use `"2.0"` for this version.

```json
{
  "schema_version": "2.0"
}
```

#### `identity` (object, required)

Core identification information.

**Required sub-fields:**
- `name` (string): Machine-readable identifier (lowercase, hyphen-separated)
- `version` (string): Semantic version (e.g., "1.2.3")
- `description` (string): One-line summary (max 200 chars)

**Optional sub-fields:**
- `display_name` (string): Human-readable name
- `author` (string): Author name and/or email
- `license` (string): License identifier (default: "MIT")
- `homepage_url` (string): Project homepage
- `source_url` (string): Source code repository

```json
{
  "identity": {
    "name": "my-agent",
    "version": "1.0.0",
    "description": "A helpful agent that does X",
    "display_name": "My Agent",
    "author": "Jane Doe <jane@example.com>",
    "license": "MIT"
  }
}
```

#### `instructions` (object, required)

**Agent behavior instructions**. This is the core field that replaces SKILL.md.

**Format options:**

1. **Inline content** (recommended for short instructions):

```json
{
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# My Agent\n\n## What I do\n\nI help with..."
  }
}
```

2. **External file reference** (for longer instructions):

```json
{
  "instructions": {
    "format": "markdown",
    "source": "file",
    "file": "instructions.md"
  }
}
```

**Fields:**
- `format` (string): Format of instructions. Options: `"markdown"`, `"yaml"`, `"json"`, `"text"`
- `source` (string): Source type. Options: `"inline"`, `"file"`
- `content` (string): Inline instruction content (required if `source="inline"`)
- `file` (string): Relative path to instruction file (required if `source="file"`)

---

### Optional Fields

#### `classification` (object)

Categorization metadata.

```json
{
  "classification": {
    "category": "utility",
    "type": "agent",
    "tags": ["code-review", "quality"]
  }
}
```

**Fields:**
- `category` (string): Primary category. Options: `"general"`, `"browser"`, `"data_analysis"`, `"content_creation"`, `"web_scraper"`, `"file_processor"`, `"ai_chat"`, `"utility"`, `"other"`
- `type` (string): Agent type. Options: `"agent"`, `"subagent"`, `"skill"`, `"workflow"`
- `tags` (array of strings): Searchable tags

#### `capabilities` (array)

Describes what the agent can do (for discovery and validation).

```json
{
  "capabilities": [
    {
      "type": "tool_call",
      "name": "search_web",
      "description": "Search the web for information"
    },
    {
      "type": "subagent",
      "name": "analyzer",
      "entry": "subagents/analyzer.yaml",
      "description": "Code analysis subagent"
    },
    {
      "type": "mcp_server",
      "command": "node",
      "args": ["dist/server.js"],
      "tools": ["read_file", "write_file"]
    }
  ]
}
```

**Capability types:**
- `tool_call`: Function/tool the agent can invoke
- `subagent`: Nested agent component
- `mcp_server`: Model Context Protocol server

**Naming conventions for tool_call:**

| MCP 类型 | 工具名示例 | 说明 |
|---------|-----------|------|
| 标准 stdio MCP | `tapd_create_story` | 工具名 = MCP server 前缀 + 工具名 |
| HTTP JSON MCP | `browser_navigate` | 市场声明时用 `browser_` 前缀 |
| HTTP JSON MCP | `webbridge_navigate` | 运行时注册时用 `webbridge_` 前缀 |

> ⚠️ **重要**：市场 `capabilities[].name` 与运行时 LLM 看到的工具名可能不同。例如 Kimi WebBridge 的 agent.json 中声明 `browser_navigate`，运行时同时注册 `webbridge_navigate`（LLM 调用用）和 `browser_navigate`（兼容声明名）。只要运行时注册了两套名字，LLM 就能正确调用。

#### `mcp_servers` (array)

声明 Agent 需要的 MCP servers。格式为数组，每项描述一个 MCP server。

> 注意：`mcp_servers` 是 agent-compose / Python 运行时使用的格式（schema v2）；Node/TypeScript 运行时使用 `mcp.config_path` 指向 `mcp/servers.json`。两者可以并存，运行时根据平台自动选择。

```json
{
  "mcp_servers": [
    {
      "name": "kimi-webbridge",
      "command": "npx",
      "args": ["@kimi/webbridge-mcp"]
    },
    {
      "name": "tapd",
      "command": "npx",
      "args": ["-y", "@myorg/mcp-tapd@^1.0.0"],
      "env": {
        "TAPD_API_KEY": "${TAPD_API_KEY}"
      }
    }
  ]
}
```

**mcp_servers 字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | MCP server 名称（用于路由工具调用） |
| `command` | string | 启动命令（stdio MCP）或声明性描述（HTTP MCP） |
| `args` | string[] | 命令参数 |
| `env` | object | 环境变量（stdio MCP），支持 `${VAR}` 格式引用 |
| `url` | string | HTTP MCP 时使用，如 `"http://127.0.0.1:10086"` |
| `type` | string | 可选：`stdio`、`sse`、`kimi-webbridge` |

**MCP server 类型自动检测逻辑：**

1. `name` 含 `webbridge` 或 `args` 含 `@kimi/webbridge` → **HTTP JSON**（不走 subprocess）
2. `type: "kimi-webbridge"` → **HTTP JSON**
3. `command` 是 `npx`/`node`/`npm` → **stdio 子进程**
4. `command` 是 `python`/`python3` → **stdio 子进程**
5. `url` 存在且 type 未知 → **SSE HTTP**

#### `compatibility` (object)

Platform support and requirements.

```json
{
  "compatibility": {
    "platforms": {
      "cursor": {
        "supported": true,
        "format": "slash_command",
        "notes": "Works best in project context"
      },
      "claude_code": {
        "supported": true,
        "format": "skill"
      }
    },
    "runtime_requirements": {
      "node": ">=18.0.0",
      "python": ">=3.10"
    }
  }
}
```

#### `structure` (object)

Package file structure.

```json
{
  "structure": {
    "entry_point": "main.yaml",
    "subagents": [
      { "name": "worker", "file": "subagents/worker.yaml" }
    ],
    "resources": [
      { "type": "prompt_template", "file": "prompts/review.md" },
      { "type": "config", "file": "config/rules.json" }
    ]
  }
}
```

#### `dependencies` (object)

External dependencies.

```json
{
  "dependencies": {
    "agents": ["linter-agent@^1.0.0"],
    "npm": ["@anthropic/sdk@^1.0.0"],
    "python": ["aiosqlite>=0.19.0"]
  }
}
```

---

## Migration from SKILL.md

### Option 1: Inline Instructions

Move SKILL.md content into agent.json:

**Before** (SKILL.md):
```markdown
---
name: my-agent
description: Does something useful
---

# My Agent

Instructions here...
```

**After** (agent.json):
```json
{
  "schema_version": "2.0",
  "identity": {
    "name": "my-agent",
    "version": "1.0.0",
    "description": "Does something useful"
  },
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# My Agent\n\nInstructions here..."
  }
}
```

### Option 2: File Reference

Keep instructions in a separate file:

**agent.json**:
```json
{
  "schema_version": "2.0",
  "identity": {
    "name": "my-agent",
    "version": "1.0.0",
    "description": "Does something useful"
  },
  "instructions": {
    "format": "markdown",
    "source": "file",
    "file": "instructions.md"
  }
}
```

**instructions.md**:
```markdown
# My Agent

Instructions here...
```

### Option 3: Keep SKILL.md Temporarily

Agent-deploy v2.0 automatically falls back to SKILL.md if no instructions field is found. You'll see a deprecation warning:

```
[DEPRECATED] agent.json found but no instructions field. Falling back to SKILL.md.
```

Add the instructions field when ready to migrate.

---

## Validation

### Required Field Check

```python
def validate_agent_json(data: dict) -> list[str]:
    errors = []
    
    if "schema_version" not in data:
        errors.append("Missing schema_version")
    
    if "identity" not in data:
        errors.append("Missing identity section")
    else:
        for field in ["name", "version", "description"]:
            if field not in data["identity"]:
                errors.append(f"Missing identity.{field}")
    
    if "instructions" not in data:
        errors.append("Missing instructions section")
    else:
        inst = data["instructions"]
        if inst.get("source") == "inline" and not inst.get("content"):
            errors.append("instructions.source='inline' but content is empty")
        elif inst.get("source") == "file" and not inst.get("file"):
            errors.append("instructions.source='file' but file path missing")
    
    return errors
```

---

## Kimi WebBridge Agent 示例（浏览器自动化）

以下是一个使用 Kimi WebBridge 实现浏览器自动化的完整 agent.json 示例（v1.1.0）：

```json
{
  "schema_version": "2.0",
  "identity": {
    "name": "kimi-webbridge-operator",
    "version": "1.1.0",
    "display_name": "🌉 Kimi WebBridge 浏览器操作专家",
    "description": "基于 Kimi WebBridge 的浏览器自动化专家。通过 HTTP JSON API (127.0.0.1:10086) 驱动浏览器，支持网页导航、元素交互、表单填写、JavaScript 执行、截图/PDF、多标签页管理等操作。",
    "author": "Agent Hub Team",
    "tags": ["browser", "automation", "webbridge", "kimi", "mcp"]
  },
  "classification": {
    "category": "browser",
    "type": "agent",
    "tags": ["browser-automation", "web-navigation", "web-scraping"]
  },
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# 🌉 Kimi WebBridge 浏览器操作专家\n\n你是一个专业的浏览器自动化操作专家，通过 Kimi WebBridge HTTP API 直接驱动浏览器。\n\n## 核心能力\n\n- `browser_navigate`: 打开 URL\n- `browser_snapshot`: 获取页面可访问性树\n- `browser_click` / `browser_fill` / `browser_type`: 元素交互\n- `browser_evaluate`: 执行 JavaScript\n- `browser_screenshot` / `browser_pdf`: 截图存档\n- `browser_list_tabs` / `browser_find_tab` / `browser_close_tab`: 多标签管理\n\n## 工作流程\n\n1. 先 `browser_navigate` 打开目标页面\n2. 用 `browser_snapshot` 获取页面结构\n3. 根据 selector 使用 `browser_click` / `browser_fill` 等操作\n4. 用 `browser_evaluate` 或 `browser_snapshot` 获取结果\n5. 必要时用 `browser_screenshot` 保存证据\n"
  },
  "mcp_servers": [
    {
      "name": "kimi-webbridge",
      "description": "Kimi WebBridge HTTP JSON API。浏览器扩展 + 本地 daemon，监听 127.0.0.1:10086。",
      "type": "kimi-webbridge",
      "base_url": "http://127.0.0.1:10086",
      "command": "npx",
      "args": ["-y", "@kimi/webbridge-mcp"],
      "env": {}
    }
  ],
  "capabilities": [
    {"type": "tool_call", "name": "browser_navigate", "description": "在浏览器中打开一个 URL。这是所有网页操作的第一步。"},
    {"type": "tool_call", "name": "browser_snapshot", "description": "获取当前页面的可访问性树快照，描述页面上的所有元素结构。"},
    {"type": "tool_call", "name": "browser_click", "description": "点击页面上的一个元素。必须先用 snapshot 了解页面结构，再使用 CSS selector。"},
    {"type": "tool_call", "name": "browser_fill", "description": "在表单元素中填入一个值。"},
    {"type": "tool_call", "name": "browser_type", "description": "在当前获得焦点的元素中输入文本。"},
    {"type": "tool_call", "name": "browser_keys", "description": "发送按键/特殊键。支持: enter, tab, escape, arrowup/down/left/right 等。"},
    {"type": "tool_call", "name": "browser_evaluate", "description": "在当前页面执行一段 JavaScript 代码并返回值。"},
    {"type": "tool_call", "name": "browser_screenshot", "description": "对当前页面截图并返回文件路径。"},
    {"type": "tool_call", "name": "browser_pdf", "description": "将当前页面保存为 PDF 文件。"},
    {"type": "tool_call", "name": "browser_list_tabs", "description": "列出当前浏览器所有打开的 tab。"},
    {"type": "tool_call", "name": "browser_find_tab", "description": "查找并切换到匹配 URL 的 tab。"},
    {"type": "tool_call", "name": "browser_close_tab", "description": "关闭当前 tab。"}
  ],
  "metadata": {
    "protocol": "HTTP JSON API (POST /command, GET /status)",
    "port": 10086,
    "tool_naming": "browser_* (运行时同时注册 webbridge_* 别名)",
    "updated_at": "2025-01-15"
  }
}
```

**部署前提：**

用户需要先安装 [Kimi WebBridge Chrome/Edge 扩展](https://chrome.google.com/webstore)。

验证方法：
```bash
curl http://127.0.0.1:10086/status
# 应返回: {"running": true, "extension_connected": true, "version": "v1.10.0"}
```

**运行时工具命名说明：**

- `agent.json capabilities` 中声明的工具名是 `browser_*` 前缀
- `AgentRuntime` 运行时实际注册 **两套** 工具 schema：`webbridge_*` 和 `browser_*` 各 12 个，共 24 个
- LLM 用任一套名字都能正确调用到底层 WebBridge HTTP API

| 层 | 命名 | 示例 |
|---|---|---|
| agent.json capabilities | `browser_*` | `browser_navigate` |
| LLM 工具 schema | `webbridge_*` + `browser_*` | `webbridge_navigate`, `browser_navigate` |
| WebBridge daemon action | `<action>` | `navigate` |

---

## Best Practices

### ✅ Do

- Use semantic versioning (major.minor.patch)
- Keep description under 200 characters
- Use inline instructions for simple agents (< 500 lines)
- Use file reference for complex agents (> 500 lines)
- Add tags for better discoverability
- Specify platform compatibility when known

### ❌ Don't

- Use special characters in `name` (stick to lowercase + hyphens)
- Embed binary data in instructions
- Make instructions format-specific (avoid tool-specific syntax)
- Skip version bumps when updating instructions

---

## FAQ

**Q: Do I need to delete SKILL.md?**  
A: No. Agent-deploy v2.0 will use it as fallback if `instructions` field is missing. But we recommend migrating.

**Q: Can I use both agent.json instructions and SKILL.md?**  
A: Yes, but agent.json instructions take priority. SKILL.md will be ignored if instructions field exists.

**Q: What format should instructions be in?**  
A: Markdown is recommended for maximum compatibility. Plain text, YAML, and JSON are also supported.

**Q: Can instructions include code examples?**  
A: Yes! Use markdown code blocks:
```json
{
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# My Agent\n\n```python\nprint('example')\n```"
  }
}
```

**Q: How do I test my agent.json?**  
A: Use the agent-deploy CLI:
```bash
npx @openpeng/agent-deploy adapt_agent --agent-path ./my-agent --target cursor
```

---

## Version History

- **2.0** (2026-06-06): Added `instructions` field, made agent.json self-contained
- **1.0** (2025-01-01): Initial specification (metadata only, required SKILL.md)

---

## References

- [Migration Guide](./MIGRATION_GUIDE.md)
- [Example Agents](../examples/)
- [Agent Deploy Documentation](../agent-deploy/README.md)
