# agent-deploy 🚀

> 双向部署：从 AI 工具导入 Agent，或将 Agent 部署到任意 AI 编码工具

[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-1.27.2-green.svg)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/Tests-62%2F62%20passing-brightgreen.svg)](tests/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## ✨ What's New in v2.0

**Bidirectional Agent Ecosystem** - 完整的双向工作流：

### Export (Phase 1) ✅
- ✅ **Multi-Format Support** - agent.json 支持多种格式（instructions、subagents、SKILL.md）
- ✅ **Cross-Platform Deploy** - 部署到 8+ AI 工具
- ✅ **100% Backward Compatible**

### Import (Phase 2) ✅
- ✅ **Import from 4 Platforms** - 从 Cursor、Claude Code、CodeBuddy、GitHub 导入
- ✅ **Auto-Detection** - 自动识别平台格式
- ✅ **CLI & MCP Support** - 命令行和 MCP 工具双模式
- ✅ **Dry-run Mode** - 预览导入结果

See [AGENT_FORMATS.md](AGENT_FORMATS.md) for format details.

---

## Installation

### Node.js (Recommended)
```bash
# Global install (for CLI)
npm install -g @openpeng/agent-deploy

# Or use directly
npx @openpeng/agent-deploy import .cursor/commands/my-agent.md
```

### Python
```bash
pip install agent-deploy
```

---

## Quick Start

### 🔽 Import Agents (New!)

**CLI Mode** - Import from command line:
```bash
# Import from Cursor
agent-deploy import .cursor/commands/my-agent.md

# Preview before import (dry-run)
agent-deploy import .claude/commands/skill.md --dry-run

# Custom output directory
agent-deploy import agent.md -o ./my-agents

# Force specific adapter
agent-deploy import agent.md -t cursor
```

**MCP Mode** - Import via AI assistant:
> **你：** Import the agent from .cursor/commands/code-reviewer.md

MCP calls `import_agent` and converts to agent.json v2.0 format.

**Supported Import Platforms**:
- ✅ Cursor (`.cursor/commands/*.md`)
- ✅ Claude Code (`.claude/commands/*.md`)
- ✅ CodeBuddy (`.codebuddy/skills/*/SKILL.md`)
- ✅ GitHub Copilot (`.github/agents/*.md`)

---

### 🔼 Deploy Agents

**MCP Mode** - Deploy via AI assistant:

> **你：** 帮我把 "code-reviewer" 这个 Agent 装到 Cursor 里。

MCP 会调用 `deploy_agent`，自动完成：

1. 🔍 检测当前环境中的 AI 工具（发现 Cursor 正在运行）
2. 📥 从 Market 下载 `code-reviewer` Agent
3. 🔄 将 agent.json 转换为 `.cursor/commands/code-reviewer.md` 格式
4. 📁 安装到项目目录的 `.cursor/commands/` 下

完成！输入 `/code-reviewer` 即可使用。

---

## MCP Configuration

### Node.js MCP Server

在你的 MCP 客户端配置中添加：

```json
{
  "mcpServers": {
    "agent-deploy": {
      "command": "node",
      "args": ["/path/to/agent-deploy/node/dist/index.js"],
      "env": {
        "MARKET_API_URL": "http://localhost:8321"
      }
    }
  }
}
```

### Python MCP Server

```json
{
  "mcpServers": {
    "agent-deploy": {
      "command": "python",
      "args": ["-m", "agent_deploy.server"],
      "cwd": "/path/to/agent-deploy",
      "env": {
        "PYTHONPATH": "/path/to/agent-deploy/src",
        "MARKET_API_URL": "http://localhost:8321"
      }
    }
  }
}
```

> 更多配置示例见 `mcp_config.example.json`。

---

## Supported Platforms

### Deploy Targets (8 platforms)

| 工具 | 格式 | 部署路径 |
|------|------|----------|
| **Cursor** | Markdown | `.cursor/commands/` |
| **Claude Code** | Markdown | `.claude/commands/` |
| **CodeBuddy** | YAML+MD | `.codebuddy/skills/` |
| **GitHub Copilot** | Markdown | `.github/agents/` |
| **OpenCode** | Markdown | `.opencode/commands/` |
| **Windsurf** | Markdown | `.windsurf/rules/` |
| **Trae** | Markdown | `.trae/rules/` |
| **Aider** | Markdown | `CONVENTIONS.md` |

### Import Sources (4 platforms)

| 工具 | 源格式 | 导入路径 |
|------|--------|----------|
| **Cursor** | Markdown | `.cursor/commands/*.md` |
| **Claude Code** | Markdown | `.claude/commands/*.md` |
| **CodeBuddy** | YAML+MD | `.codebuddy/skills/*/SKILL.md` |
| **GitHub Copilot** | Markdown | `.github/agents/*.md` |

---

## MCP Tools

| 工具 | 说明 |
|------|------|
| `import_agent` | ✨ **NEW** - 从 AI 工具导入 Agent 到 agent.json |
| `deploy_agent` | 一键部署：检测 → 下载 → 适配 → 安装 |
| `list_installed_tools` | 检测环境中已安装的 AI 工具 |
| `adapt_agent` | 将 Agent 转换为目标工具格式 |
| `install_agent` | 将适配后的 Agent 安装到目标目录 |

---

## CLI Commands

```bash
# Import agents
agent-deploy import <source> [options]
  -o, --output <dir>    Output directory (default: ./imported-agents)
  -t, --tool <name>     Force specific adapter (cursor, claude_code, etc.)
  -d, --dry-run         Preview import without writing files
  -h, --help            Show help message

# Show help
agent-deploy --help

# Show version
agent-deploy --version
```

### Examples

```bash
# Basic import
agent-deploy import .cursor/commands/my-agent.md

# Dry-run (preview)
agent-deploy import .claude/commands/skill.md --dry-run

# Custom output
agent-deploy import agent.md -o ~/agents

# Batch import
for f in .cursor/commands/*.md; do
  agent-deploy import "$f"
done
```

---

## Development

### Node.js

```bash
cd node/
npm install
npm test        # Run tests (62 tests)
npm run build   # Build TypeScript
npm run dev     # Development mode
```

### Python

```bash
cd python/
pip install -e ".[dev]"
pytest tests/ -v
```

---

## Test Coverage

**62/62 tests passing** ✅

| Test Suite | Tests | Status |
|-----------|-------|--------|
| Export (adapt.test.ts) | 22 | ✅ |
| Server (server.test.ts) | 9 | ✅ |
| Import Unit (import.test.ts) | 20 | ✅ |
| Import MCP (import-mcp.test.ts) | 11 | ✅ |

Coverage includes:
- Multi-format agent loading
- Platform adapters (8 export + 4 import)
- Fallback strategy
- Error handling
- Cross-platform paths (Windows/Unix)

---

## Documentation

### User Guides
- [SKILL.md](./SKILL.md) — 用户手册：快速开始、工具参考、FAQ
- [AGENT_FORMATS.md](./AGENT_FORMATS.md) — Agent 格式指南：多格式支持、迁移指南
- [CLI_IMPORT_GUIDE.md](../docs/phase2/CLI_IMPORT_GUIDE.md) — CLI 导入命令详细指南

### Technical Docs
- [DEVELOPMENT.md](./DEVELOPMENT.md) — 开发者文档：架构、扩展指南
- [MAINTENANCE.md](./MAINTENANCE.md) — 维护手册：发布流程、排错
- [IMPORT_ADAPTER_SPEC.md](../docs/phase2/IMPORT_ADAPTER_SPEC.md) — ImportAdapter 接口规范
- [IMPORT_AGENT_TOOL_GUIDE.md](../docs/phase2/IMPORT_AGENT_TOOL_GUIDE.md) — MCP import_agent 工具指南

---

## Project Structure

```
agent-deploy/
├── python/                    # Python MCP Server
│   ├── src/agent_deploy/
│   │   └── server.py
│   └── tests/
├── node/                      # Node.js Implementation
│   ├── src/
│   │   ├── index.ts          # MCP Server
│   │   ├── cli.ts            # ✨ CLI Entry Point (NEW)
│   │   ├── adapt.ts          # Export: agent.json → AI tools
│   │   ├── import.ts         # ✨ Import: AI tools → agent.json (NEW)
│   │   ├── import-manager.ts # ✨ Import orchestration (NEW)
│   │   ├── detect.ts
│   │   ├── install.ts
│   │   └── adapters/
│   │       ├── cursor-import.ts      # ✨ NEW
│   │       ├── claude-import.ts      # ✨ NEW
│   │       ├── codebuddy-import.ts   # ✨ NEW
│   │       └── github-import.ts      # ✨ NEW
│   └── tests/
│       ├── adapt.test.ts
│       ├── server.test.ts
│       ├── import.test.ts            # ✨ NEW
│       └── import-mcp.test.ts        # ✨ NEW
├── AGENT_FORMATS.md
├── SKILL.md
├── DEVELOPMENT.md
├── MAINTENANCE.md
└── README.md
```

---

## Workflows

### Import → Deploy (Cross-Platform)

```bash
# Step 1: Import from Cursor
agent-deploy import .cursor/commands/my-agent.md

# Step 2: Deploy to Claude Code
# (via MCP or future CLI feature)
deploy_agent(./imported-agents/my-agent, "claude_code")
```

### Batch Import All Agents

```bash
#!/bin/bash
# Import from multiple tools
for f in .cursor/commands/*.md; do
  agent-deploy import "$f" -o ./all-agents
done

for f in .claude/commands/*.md; do
  agent-deploy import "$f" -o ./all-agents
done

echo "All agents imported to ./all-agents/"
```

---

## Roadmap

### Phase 1: Export ✅ Complete
- [x] Multi-format agent loading
- [x] Deploy to 8+ platforms
- [x] 100% backward compatibility
- [x] Comprehensive tests

### Phase 2: Import ✅ Complete
- [x] Import from 4 platforms
- [x] Auto-detection
- [x] CLI command
- [x] MCP tool
- [x] Dry-run mode

### Phase 3: Market Integration 🚀 Next
- [ ] Upload imported agents to market
- [ ] Download from market for import
- [ ] Agent marketplace UI
- [ ] Version management

---

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new features
4. Ensure all tests pass (`npm test`)
5. Submit a pull request

---

## License

MIT

---

## Credits

**Author**: Peng Xiao  
**Repository**: [github:openpeng/agent-deploy](https://github.com/openpeng/agent-deploy)

Built with:
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- TypeScript / Node.js
- Python

---

## Support

- 📖 [Documentation](./SKILL.md)
- 🐛 [Report Issues](https://github.com/openpeng/agent-deploy/issues)
- 💬 [Discussions](https://github.com/openpeng/agent-deploy/discussions)

---

**Version**: 2.0.0  
**Last Updated**: 2026-06-06  
**Status**: ✅ Production Ready
