# agent-deploy — 一键部署 Agent 到任意 AI 工具

> **状态：** 稳定 | **MCP 版本：** 1.27.2 | **支持的 AI 工具：** 9 种

## 概述

`agent-deploy` 是一个 MCP (Model Context Protocol) 服务器，让你用自然语言一键把 PilotDeck Market 上的 Agent 部署到你正在使用的 AI 编码工具中。它自动检测已安装的工具（如 Cursor、Claude Code、CodeBuddy 等），下载 Agent、转换为目标工具的格式，并安装到正确的目录。

不用手动找配置文件、不用记路径 —— 只需一句话，Agent 就到位了。

## 快速开始

### 1. 安装

```bash
cd skills/agent-deploy
pip install -e .
```

或者在 MCP 客户端配置里直接用源码路径运行。

### 2. 配置 MCP 客户端

在 MCP 客户端配置文件（如 Claude Desktop 的 `claude_desktop_config.json`）中加入：

```json
{
  "mcpServers": {
    "agent-deploy": {
      "command": "python",
      "args": ["-m", "agent_deploy.server"],
      "cwd": "/home/xiaopeng/mounts/new_volume/Sasa/skills/agent-deploy",
      "env": {
        "PYTHONPATH": "/home/xiaopeng/mounts/new_volume/Sasa/skills/agent-deploy/src",
        "MARKET_API_URL": "http://localhost:8321"
      }
    }
  }
}
```

> 参考文件：`mcp_config.example.json`，根据你的路径调整 `cwd` 和 `PYTHONPATH`。

### 3. 使用

配置完成后在你的 AI 工具中直接对话：

> **你：** 把 "weather-agent" 部署到我的 Cursor 里。

MCP 会调用 `deploy_agent`，自动完成检测 → 下载 → 适配 → 安装。

## 支持的目标工具

| 工具 ID | 工具名 | Agent 格式 | 安装目录 |
|---------|--------|-----------|----------|
| `codebuddy` | 腾讯云 CodeBuddy | YAML frontmatter + Markdown | `.codebuddy/skills/{name}/` |
| `claude_code` | Anthropic Claude Code | Markdown | `.claude/commands/{name}.md` |
| `cursor` | Cursor AI Editor | Markdown | `.cursor/commands/{name}.md` |
| `github_copilot` | GitHub Copilot | Markdown | `.github/agents/{name}.md` |
| `opencode` | OpenCode | Markdown | `.opencode/commands/{name}.md` |
| `windsurf` | Codeium Windsurf | Markdown | `.windsurf/rules/{name}.md` |
| `trae` | ByteDance Trae | Markdown | `.trae/rules/{name}.md` |
| `aider` | Aider | Markdown | `CONVENTIONS.md` |
| `agents_md` | AGENTS.md 通用格式 | Markdown | `AGENTS.md` |

## MCP 工具

### `deploy_agent` — 一键部署

最常用的工具。检测已安装的工具 → 下载/加载 Agent → 适配格式 → 安装。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agent_id` | string | 二选一 | Market 上的 Agent ID |
| `agent_path` | string | 二选一 | 本地 Agent 目录路径 |
| `target_tool` | string | 否 | 目标工具 ID，默认 `auto`（自动检测），也可用 `all`（全部） |
| `level` | string | 否 | 安装级别：`project` / `user` / `both`，默认 `both` |
| `dry_run` | boolean | 否 | 试运行，不实际写入文件 |

示例：

```json
// 从 Market 部署到自动检测到的工具
{ "agent_id": "weather-agent", "target_tool": "auto" }

// 从本地路径部署到所有工具
{ "agent_path": "/home/me/my-agent", "target_tool": "all", "dry_run": true }

// 只安装到项目级别
{ "agent_id": "weather-agent", "target_tool": "cursor", "level": "project" }
```

### `list_installed_tools` — 检测已安装的工具

扫描环境中的二进制、进程、配置文件，返回按置信度排序的工具列表。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workspace_root` | string | 否 | 扫描目录，默认为当前目录 |

### `adapt_agent` — 格式转换

将 Agent (SKILL.md) 转换为目标工具的格式，返回适配后的内容和目标路径。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agent_path` | string | 是 | Agent 目录路径（含 SKILL.md） |
| `target_tool` | string | 是 | 目标工具 ID，或 `all`（返回全部支持的格式） |

### `install_agent` — 安装到目标目录

将已适配的 Agent 内容安装到目标工具的发现目录。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `adapted_content` | string | 是 | adapt_agent 返回的适配内容 |
| `agent_name` | string | 是 | Agent 名称（用于路径模板） |
| `target_tool` | string | 是 | 目标工具 ID |
| `level` | string | 否 | 安装级别，默认 `both` |
| `backup` | boolean | 否 | 是否备份已有文件 |
| `dry_run` | boolean | 否 | 试运行模式 |

## 添加新的目标工具

编辑 `skills/auto-adapter/config/tools-registry.yaml`，在 `tools:` 下添加新条目：

```yaml
tools:
  my_new_tool:
    name: "My New Tool"
    type: cli
    detection:
      binaries: ["my-tool"]
      config_files: [".mytool/"]
      process_names: ["my-tool"]
    agent_format:
      type: "markdown_file"
      directory: ".mytool/commands/"
      main_file: "{agent_name}.md"
    install:
      project_level: ".mytool/commands/{agent_name}.md"
      user_level: "~/.mytool/commands/{agent_name}.md"
      registration: "auto-discovered on next launch"
```

然后在 `skills/auto-adapter/scripts/adapt.py` 的 `ADAPTERS` 字典中注册对应的适配函数。

## 常见问题

**Q: "找不到 SKILL.md" 错误？**
A: 确保 Agent 目录下确实有 `SKILL.md` 文件。Market 下载的 Agent 解压后会自动定位；本地路径请直接指向包含 SKILL.md 的目录。

**Q: 检测不到我安装的 AI 工具？**
A: 确保工具正在运行或有配置文件在项目目录下。`list_installed_tools` 依赖进程列表、`PATH` 上的二进制、以及项目级配置文件（如 `.cursor/`）。

**Q: `agent_id` 和 `agent_path` 都提供了会怎样？**
A: 会优先使用 `agent_path` 的本地路径，`agent_id` 仅作记录。

**Q: `target_tool=all` 会为所有 9 种工具都生成文件吗？**
A: 只会为既有 Registry 条目又有适配函数的工具生成（当前 9 种都满足）。

**Q: 怎么知道部署是否成功？**
A: 每个工具调用都返回 JSON 结果，包含 `status: ok` 或 `status: error` 及详细信息。`deploy_agent` 还会返回汇总统计。

## 相关文档

- [DEVELOPMENT.md](./DEVELOPMENT.md) — 开发者文档：架构、代码结构、如何扩展
- [MAINTENANCE.md](./MAINTENANCE.md) — 维护手册：发布流程、排错指南
