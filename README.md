# agent-deploy 🚀

> 一键将 PilotDeck Market Agent 部署到你正在使用的 AI 编码工具

[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![MCP](https://img.shields.io/badge/MCP-1.27.2-green.svg)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 安装

```bash
cd skills/agent-deploy
pip install -e .
```

## MCP 配置

在你的 MCP 客户端配置中添加：

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

> 更多配置示例见 `mcp_config.example.json`。

## 快速体验

配置完成后，直接在 AI 工具中说出你的需求：

> **你：** 帮我把 "code-reviewer" 这个 Agent 装到 Cursor 里。

MCP 会调用 `deploy_agent(agent_id="code-reviewer", target_tool="auto")`，自动完成：

1. 🔍 检测当前环境中的 AI 工具（发现 Cursor 正在运行）
2. 📥 从 Market 下载 `code-reviewer` Agent
3. 🔄 将 SKILL.md 转换为 `.cursor/commands/code-reviewer.md` 格式
4. 📁 安装到项目目录的 `.cursor/commands/` 下

完成！输入 `/code-reviewer` 即可使用。

## 支持的工具

| 工具 | 格式 | 安装路径 |
|------|------|----------|
| **Cursor** | Markdown | `.cursor/commands/` |
| **Claude Code** | Markdown | `.claude/commands/` |
| **CodeBuddy** | YAML+MD | `.codebuddy/skills/` |
| **GitHub Copilot** | Markdown | `.github/agents/` |
| **OpenCode** | Markdown | `.opencode/commands/` |
| **Windsurf** | Markdown | `.windsurf/rules/` |
| **Trae** | Markdown | `.trae/rules/` |
| **Aider** | Markdown | `CONVENTIONS.md` |
| **AGENTS.md** | Markdown | `AGENTS.md` |

## MCP 工具一览

| 工具 | 说明 |
|------|------|
| `deploy_agent` | 一键部署：检测 → 下载 → 适配 → 安装 |
| `list_installed_tools` | 检测环境中已安装的 AI 工具 |
| `adapt_agent` | 将 Agent 转换为目标工具格式 |
| `install_agent` | 将适配后的 Agent 安装到目标目录 |

## 文档

- [SKILL.md](./SKILL.md) — 用户手册：快速开始、工具参考、FAQ
- [DEVELOPMENT.md](./DEVELOPMENT.md) — 开发者文档：架构、桥接机制、扩展指南
- [MAINTENANCE.md](./MAINTENANCE.md) — 维护手册：发布流程、排错、安全

## 项目结构

```
skills/agent-deploy/
├── src/agent_deploy/
│   ├── __init__.py
│   └── server.py              # MCP Server 主文件
├── tests/
│   └── test_server.py
├── pyproject.toml
├── mcp_config.example.json
├── SKILL.md                   # 用户手册
├── DEVELOPMENT.md             # 开发者文档
├── MAINTENANCE.md             # 维护手册
└── README.md                  # 本文件
```

## License

MIT
