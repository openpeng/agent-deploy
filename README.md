# agent-deploy 🚀

> 完整的 Agent 生态工具：导入 → Market → 部署，在不同 AI 编码工具间自由迁移

[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-1.27.2-green.svg)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/Tests-62%2F62%20passing-brightgreen.svg)](tests/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## ✨ What's New in v3.0

**Complete Agent Ecosystem** - 完整的双向闭环：

### Export (Phase 1) ✅
- ✅ **Multi-Format Support** - agent.json 支持多种格式（instructions、subagents、SKILL.md）
- ✅ **Cross-Platform Deploy** - 部署到 8+ AI 工具
- ✅ **100% Backward Compatible**

### Import (Phase 2) ✅
- ✅ **Import from 4 Platforms** - 从 Cursor、Claude Code、CodeBuddy、GitHub 导入
- ✅ **Auto-Detection** - 自动识别平台格式
- ✅ **CLI & MCP Support** - 命令行和 MCP 工具双模式
- ✅ **Dry-run Mode** - 预览导入结果

### Market Integration (Phase 3) ✅
- ✅ **Upload to Market** - 一键上传分享 Agent
- ✅ **Download from Market** - 从 Market 下载他人分享的 Agent
- ✅ **Auto Deploy** - 自动检测并部署到 AI 工具
- ✅ **Complete Workflow** - Import → Upload → Download → Deploy

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

### Complete Workflow Example

```bash
# 1️⃣ Import from Cursor
agent-deploy import .cursor/commands/my-agent.md

# 2️⃣ Upload to Market
agent-deploy upload ./imported-agents/my-agent

# 3️⃣ Deploy to Claude Code
agent-deploy deploy ./imported-agents/my-agent -t claude_code

# Done! Now use /my-agent in Claude Code
```

---

### 🔽 Import Agents

**CLI Mode**:
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

**MCP Mode**:
> **You:** Import the agent from .cursor/commands/code-reviewer.md

MCP calls `import_agent` and converts to agent.json v2.0 format.

**Supported Import Platforms**:
- ✅ Cursor (`.cursor/commands/*.md`)
- ✅ Claude Code (`.claude/commands/*.md`)
- ✅ CodeBuddy (`.codebuddy/skills/*/SKILL.md`)
- ✅ GitHub Copilot (`.github/agents/*.md`)

---

### 📤 Upload to Market

```bash
# Upload agent to market
agent-deploy upload ./imported-agents/my-agent

# With custom Market URL
agent-deploy upload ./my-agent -m http://market.example.com

# Force overwrite existing version
agent-deploy upload ./my-agent --force

# Use environment variables
export MARKET_API_URL=http://localhost:8321
export MARKET_API_KEY=your-api-key
agent-deploy upload ./my-agent
```

**Output**:
```
📤 Uploading agent to Market...
✅ Successfully uploaded agent!

Agent ID:     my-agent
Market URL:   http://localhost:8321/agents/my-agent
```

---

### 📥 Download from Market

**MCP Mode**:
```javascript
// Call via MCP tool
download_agent({
  agent_id: "my-agent",
  output_dir: "./downloaded-agents"
})
```

---

### 🚀 Deploy to AI Tools

```bash
# Auto-detect and deploy
agent-deploy deploy ./my-agent

# Deploy to specific tool
agent-deploy deploy ./my-agent -t cursor

# Deploy to multiple tools
agent-deploy deploy ./my-agent -t cursor -t claude_code

# Deploy to all detected tools
agent-deploy deploy ./my-agent --tool all

# Choose installation level
agent-deploy deploy ./my-agent -l user      # User-level
agent-deploy deploy ./my-agent -l project   # Project-level
agent-deploy deploy ./my-agent -l both      # Both
```

**Output**:
```
🔍 Auto-detected: cursor

📦 Deploying to cursor...
✅ Successfully deployed to cursor

📊 Deployment Summary:
   ✅ Successful: 1
   ❌ Failed: 0

🎉 Agent deployed successfully!

Next steps:
   - Open Cursor and type '//my-agent' to use the agent
```

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
| `import_agent` | ✨ 从 AI 工具导入 Agent 到 agent.json |
| `upload_agent` | ✨ 上传 Agent 到 Market |
| `download_agent` | ✨ 从 Market 下载 Agent |
| `deploy_agent` | 一键部署：检测 → 适配 → 安装 |
| `list_installed_tools` | 检测环境中已安装的 AI 工具 |
| `adapt_agent` | 将 Agent 转换为目标工具格式 |
| `install_agent` | 将适配后的 Agent 安装到目标目录 |

---

## CLI Commands

```bash
# Import agents from AI tools
agent-deploy import <source> [options]
  -o, --output <dir>    Output directory (default: ./imported-agents)
  -t, --tool <name>     Force specific adapter (cursor, claude_code, etc.)
  -d, --dry-run         Preview import without writing files
  -h, --help            Show help message

# Upload agents to Market
agent-deploy upload <agent-dir> [options]
  -m, --market <url>    Market API URL (default: $MARKET_API_URL)
  -k, --api-key <key>   API Key (default: $MARKET_API_KEY)
  -f, --force           Force overwrite existing version
  -h, --help            Show help message

# Deploy agents to AI tools
agent-deploy deploy <agent-dir> [options]
  -t, --tool <name>     Target tool (can be used multiple times)
                        Special: 'auto' (default) or 'all'
  -l, --level <level>   Installation level: user, project, both
  -h, --help            Show help message

# Show help
agent-deploy --help

# Show version
agent-deploy --version
```

### Command Examples

```bash
# Import
agent-deploy import .cursor/commands/my-agent.md
agent-deploy import .claude/commands/skill.md --dry-run
agent-deploy import agent.md -o ~/agents

# Upload
agent-deploy upload ./imported-agents/my-agent
agent-deploy upload ./my-agent -m http://market.example.com
agent-deploy upload ./my-agent --force

# Deploy
agent-deploy deploy ./my-agent
agent-deploy deploy ./my-agent -t cursor
agent-deploy deploy ./my-agent --tool all
agent-deploy deploy ./my-agent -l project

# Batch operations
for f in .cursor/commands/*.md; do
  agent-deploy import "$f"
done

for dir in ./imported-agents/*; do
  agent-deploy upload "$dir"
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
- [USER_GUIDE.md](./docs/guides/USER_GUIDE.md) — 完整用户指南：场景、命令参考、FAQ、最佳实践
- [QUICK_START.md](./docs/guides/QUICK_START.md) — 快速开始：5 分钟上手指南
- [SKILL.md](./SKILL.md) — Agent Deploy 使用手册
- [AGENT_FORMATS.md](./AGENT_FORMATS.md) — Agent 格式指南
- [CLI_IMPORT_GUIDE.md](./docs/guides/CLI_IMPORT_GUIDE.md) — CLI 导入命令详细指南

### Technical Docs
- [PROJECT_OVERVIEW.md](./docs/PROJECT_OVERVIEW.md) — 项目概览：架构、协议、API 参考、快速入门
- [AGENT_JSON_SPEC_V2.md](./docs/specs/AGENT_JSON_SPEC_V2.md) — agent.json v2.0 规范
- [IMPORT_ADAPTER_SPEC.md](./docs/guides/IMPORT_ADAPTER_SPEC.md) — ImportAdapter 接口规范
- [IMPORT_AGENT_TOOL_GUIDE.md](./docs/guides/IMPORT_AGENT_TOOL_GUIDE.md) — MCP import_agent 工具指南
- [DEVELOPMENT.md](./DEVELOPMENT.md) — 开发者文档：架构、扩展指南
- [MAINTENANCE.md](./MAINTENANCE.md) — 维护手册：发布流程、排错
- [CONTRIBUTING.md](./CONTRIBUTING.md) — 贡献指南：如何参与项目

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
│   │   ├── cli.ts            # CLI Entry Point
│   │   ├── adapt.ts          # Export: agent.json → AI tools
│   │   ├── import.ts         # Import: AI tools → agent.json
│   │   ├── import-manager.ts # Import orchestration
│   │   ├── market.ts         # Market API integration
│   │   ├── detect.ts         # AI tool detection
│   │   ├── install.ts        # Agent installation
│   │   └── adapters/
│   │       ├── cursor-import.ts
│   │       ├── claude-import.ts
│   │       ├── codebuddy-import.ts
│   │       └── github-import.ts
│   └── tests/
│       ├── adapt.test.ts
│       ├── server.test.ts
│       ├── import.test.ts
│       └── import-mcp.test.ts
├── docs/
│   ├── specs/                # Specifications
│   │   └── AGENT_JSON_SPEC_V2.md
│   └── guides/               # User guides
│       ├── USER_GUIDE.md
│       ├── QUICK_START.md
│       ├── CLI_IMPORT_GUIDE.md
│       ├── IMPORT_ADAPTER_SPEC.md
│       └── IMPORT_AGENT_TOOL_GUIDE.md
├── AGENT_FORMATS.md
├── SKILL.md
├── DEVELOPMENT.md
├── MAINTENANCE.md
├── CONTRIBUTING.md
└── README.md
```

---

## Workflows

### Complete Lifecycle

```bash
# 1. Import from Cursor
agent-deploy import .cursor/commands/code-reviewer.md

# 2. Upload to Market
agent-deploy upload ./imported-agents/code-reviewer

# 3. Share with others
# Market URL: http://market.example.com/agents/code-reviewer

# 4. Others download from Market (via MCP)
download_agent({ agent_id: "code-reviewer" })

# 5. Deploy to their tool
agent-deploy deploy ./downloaded-agents/code-reviewer -t claude_code
```

### Cross-Platform Migration

```bash
# Migrate from Cursor to Claude Code
agent-deploy import .cursor/commands/my-agent.md
agent-deploy deploy ./imported-agents/my-agent -t claude_code
```

### Batch Operations

```bash
#!/bin/bash
# Import all agents from Cursor
for f in .cursor/commands/*.md; do
  agent-deploy import "$f" -o ./all-agents
done

# Upload all to Market
for dir in ./all-agents/*; do
  agent-deploy upload "$dir"
done

# Deploy all to Claude Code
for dir in ./all-agents/*; do
  agent-deploy deploy "$dir" -t claude_code
done

echo "✅ All agents migrated!"
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

### Phase 3: Market Integration ✅ Complete
- [x] Upload to Market
- [x] Download from Market
- [x] Auto-deploy to AI tools
- [x] Complete workflow (Import → Market → Deploy)

### Phase 4: Advanced Features (Future)
- [ ] Version management
- [ ] Batch operations CLI enhancements
- [ ] List & search commands
- [ ] More platform support (VS Code, JetBrains, etc.)
- [ ] Web UI for Market
- [ ] Agent templates
- [ ] CI/CD integration

---

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for:
- Development environment setup
- Coding standards
- Testing guidelines
- How to add new platform adapters
- Pull request process

Quick start:
```bash
# Fork and clone
git clone https://github.com/yourusername/agent-deploy.git
cd agent-deploy/node

# Install and test
npm install
npm test

# Create a branch
git checkout -b feature/my-feature

# Make changes and test
npm test

# Submit PR
git push origin feature/my-feature
```

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

- 📖 [Complete User Guide](./docs/guides/USER_GUIDE.md)
- 🚀 [Quick Start Guide](./docs/guides/QUICK_START.md)
- 🐛 [Report Issues](https://github.com/openpeng/agent-deploy/issues)
- 💬 [Discussions](https://github.com/openpeng/agent-deploy/discussions)
- 🤝 [Contributing Guide](./CONTRIBUTING.md)

---

**Version**: 3.0.0  
**Last Updated**: 2026-06-07  
**Status**: ✅ Production Ready (Phase 1+2+3 Complete)
