# Agent Deploy - 用户指南

**版本**: 1.0.0  
**更新日期**: 2026-06-07

欢迎使用 Agent Deploy！这是一个强大的工具，让你可以在不同的 AI 编码工具之间自由迁移和部署 Agent。

---

## 📋 目录

- [快速开始](#快速开始)
- [核心功能](#核心功能)
- [使用场景](#使用场景)
- [命令参考](#命令参考)
- [MCP 工具](#mcp-工具)
- [常见问题](#常见问题)
- [最佳实践](#最佳实践)

---

## 🚀 快速开始

### 安装

```bash
# 全局安装
npm install -g @openpeng/agent-deploy

# 或在项目中安装
npm install @openpeng/agent-deploy
```

### 第一个命令

```bash
# 查看帮助
agent-deploy --help

# 导入一个 Agent
agent-deploy import .cursor/commands/my-agent.md

# 上传到 Market
agent-deploy upload ./imported-agents/my-agent

# 部署到 AI 工具
agent-deploy deploy ./imported-agents/my-agent -t claude_code
```

---

## 🎯 核心功能

### 1. Import - 从 AI 工具导入

从其他 AI 工具导入 Agent 到标准的 agent.json 格式。

**支持的平台**:
- ✅ Cursor (`.cursor/commands/*.md`)
- ✅ Claude Code (`.claude/commands/*.md`)
- ✅ CodeBuddy (`.codebuddy/skills/*/SKILL.md`)
- ✅ GitHub Copilot (`.github/agents/*.md`)

**基础用法**:
```bash
# 自动检测格式
agent-deploy import .cursor/commands/code-reviewer.md

# 指定输出目录
agent-deploy import .claude/commands/skill.md -o ./my-agents

# 强制指定平台
agent-deploy import ./agent.md -t cursor

# 预览模式（不写入文件）
agent-deploy import .codebuddy/skills/test/SKILL.md --dry-run
```

**输出**:
```
📥 Importing agent...

✅ Successfully imported agent!

Source:  .cursor/commands/code-reviewer.md
Output:  ./imported-agents/code-reviewer/agent.json

Next steps:
  1. Review the generated agent.json
  2. Upload to agent market
  3. Deploy to other AI tools
```

---

### 2. Upload - 上传到 Market

将 Agent 上传到 Market，与他人分享。

**基础用法**:
```bash
# 基础上传
agent-deploy upload ./imported-agents/my-agent

# 自定义 Market URL
agent-deploy upload ./my-agent -m http://market.example.com

# 使用 API Key
agent-deploy upload ./my-agent -k your-api-key

# 强制覆盖已存在的版本
agent-deploy upload ./my-agent --force
```

**环境变量**:
```bash
# 设置默认 Market URL
export MARKET_API_URL=http://market.example.com

# 设置 API Key
export MARKET_API_KEY=your-api-key

# 然后直接上传
agent-deploy upload ./my-agent
```

**输出**:
```
📤 Uploading agent to Market...

✅ Successfully uploaded agent!

Agent ID:     my-agent
Name:         my-agent
Version:      1.0.0
Market URL:   http://localhost:8321/agents/my-agent

Next steps:
  1. Share the Market URL with others
  2. Deploy to AI tools with 'agent-deploy deploy'
```

---

### 3. Deploy - 部署到 AI 工具

将 Agent 部署到一个或多个 AI 编码工具。

**基础用法**:
```bash
# 自动检测工具
agent-deploy deploy ./my-agent

# 部署到指定工具
agent-deploy deploy ./my-agent -t cursor

# 部署到多个工具
agent-deploy deploy ./my-agent -t cursor -t claude_code

# 部署到所有检测到的工具
agent-deploy deploy ./my-agent --tool all
```

**安装级别**:
```bash
# 用户级安装（默认）
agent-deploy deploy ./my-agent -l user

# 项目级安装
agent-deploy deploy ./my-agent -l project

# 同时安装到用户和项目级
agent-deploy deploy ./my-agent -l both
```

**输出**:
```
🔍 Auto-detected: cursor

📦 Deploying to cursor...
✅ Successfully deployed to cursor

==================================================
📊 Deployment Summary:
   ✅ Successful: 1
   ❌ Failed: 0
   📍 Total: 1

🎉 Agent deployed successfully!

Next steps:
   - Open Cursor and type '//my-agent' to use the agent
```

---

## 💡 使用场景

### 场景 1: 迁移 Agent（Cursor → Claude Code）

```bash
# 1. 从 Cursor 导入
agent-deploy import .cursor/commands/code-reviewer.md

# 2. 部署到 Claude Code
agent-deploy deploy ./imported-agents/code-reviewer -t claude_code

# 完成！现在可以在 Claude Code 中使用 /code-reviewer
```

---

### 场景 2: 分享 Agent 到 Market

```bash
# 1. 导入你的 Agent
agent-deploy import .cursor/commands/awesome-agent.md

# 2. 上传到 Market
agent-deploy upload ./imported-agents/awesome-agent

# 3. 分享 Market URL
# http://market.example.com/agents/awesome-agent
```

---

### 场景 3: 从 Market 安装 Agent

```bash
# 1. 从 Market 下载（通过 MCP）
# 使用 Claude Code 或其他支持 MCP 的工具
# 调用 download_agent 工具

# 2. 部署到本地工具
agent-deploy deploy ./downloaded-agents/awesome-agent -t cursor
```

---

### 场景 4: 批量迁移 Agent

```bash
# 导入所有 Cursor commands
for file in .cursor/commands/*.md; do
  agent-deploy import "$file"
done

# 批量部署到 Claude Code
for dir in ./imported-agents/*; do
  agent-deploy deploy "$dir" -t claude_code
done
```

---

## 📚 命令参考

### import

从 AI 工具格式导入到 agent.json。

```bash
agent-deploy import <source> [options]
```

**选项**:
- `-o, --output <dir>` - 输出目录（默认: `./imported-agents`）
- `-t, --tool <name>` - 强制指定工具适配器
- `-d, --dry-run` - 预览模式，不写入文件
- `-h, --help` - 显示帮助

**支持的工具**:
- `cursor` - Cursor commands
- `claude_code` - Claude Code commands
- `codebuddy` - CodeBuddy skills
- `github_copilot` - GitHub Copilot agents

---

### upload

上传 Agent 到 Market。

```bash
agent-deploy upload <agent-dir> [options]
```

**选项**:
- `-m, --market <url>` - Market API URL
- `-k, --api-key <key>` - API Key
- `-f, --force` - 强制覆盖
- `-h, --help` - 显示帮助

**环境变量**:
- `MARKET_API_URL` - 默认 Market URL
- `MARKET_API_KEY` - 默认 API Key

---

### deploy

部署 Agent 到 AI 工具。

```bash
agent-deploy deploy <agent-dir> [options]
```

**选项**:
- `-t, --tool <name>` - 目标工具（支持多次使用）
- `-l, --level <level>` - 安装级别: `user`, `project`, `both`
- `-h, --help` - 显示帮助

**特殊值**:
- `auto` - 自动检测（默认）
- `all` - 所有检测到的工具

---

## 🔧 MCP 工具

Agent Deploy 同时作为 MCP 服务器运行，提供 7 个工具。

### 可用工具

1. **list_installed_tools** - 检测已安装的 AI 工具
2. **adapt_agent** - 将 agent.json 适配为目标格式
3. **install_agent** - 安装 Agent 到工具目录
4. **deploy_agent** - 完整部署流程
5. **import_agent** - 导入 Agent
6. **upload_agent** - 上传到 Market
7. **download_agent** - 从 Market 下载

### 使用示例

在支持 MCP 的工具中（如 Claude Code）：

```javascript
// 导入 Agent
{
  "tool": "import_agent",
  "arguments": {
    "source_path": ".cursor/commands/my-agent.md",
    "output_dir": "./imported-agents"
  }
}

// 上传到 Market
{
  "tool": "upload_agent",
  "arguments": {
    "agent_dir": "./imported-agents/my-agent",
    "market_url": "http://localhost:8321"
  }
}

// 部署到工具
{
  "tool": "deploy_agent",
  "arguments": {
    "agent_path": "./imported-agents/my-agent",
    "target_tool": "cursor"
  }
}
```

---

## ❓ 常见问题

### Q: 导入时显示"未找到适配器"

**A**: 检查文件路径是否符合格式：
- Cursor: `.cursor/commands/*.md`
- Claude Code: `.claude/commands/*.md`
- CodeBuddy: `.codebuddy/skills/*/SKILL.md`
- GitHub: `.github/agents/*.md`

或使用 `-t` 参数强制指定适配器。

---

### Q: 上传时显示 401 错误

**A**: 需要提供有效的 API Key：
```bash
# 方式 1: 命令行参数
agent-deploy upload ./my-agent -k your-api-key

# 方式 2: 环境变量
export MARKET_API_KEY=your-api-key
agent-deploy upload ./my-agent
```

---

### Q: 上传时显示 409 错误（已存在）

**A**: Agent 版本已存在，使用 `--force` 覆盖：
```bash
agent-deploy upload ./my-agent --force
```

或更新 `agent.json` 中的版本号。

---

### Q: 部署时没有检测到工具

**A**: 确保对应的 AI 工具已安装并运行。或使用 `-t` 参数手动指定：
```bash
agent-deploy deploy ./my-agent -t cursor
```

---

### Q: 如何批量导入多个 Agent？

**A**: 使用 shell 循环：
```bash
# Bash/Zsh
for file in .cursor/commands/*.md; do
  agent-deploy import "$file"
done

# PowerShell
Get-ChildItem .cursor/commands/*.md | ForEach-Object {
  agent-deploy import $_.FullName
}
```

---

### Q: 导入的 agent.json 放在哪里？

**A**: 默认在 `./imported-agents/<agent-name>/agent.json`。

可以用 `-o` 参数自定义：
```bash
agent-deploy import ./source.md -o ./my-custom-dir
```

---

### Q: 如何查看导入结果而不写入文件？

**A**: 使用 `--dry-run` 参数：
```bash
agent-deploy import ./source.md --dry-run
```

---

## 💎 最佳实践

### 1. 版本管理

在 `agent.json` 中使用语义化版本：

```json
{
  "identity": {
    "version": "1.2.3"
  }
}
```

- **1.x.x** - 主版本（破坏性更改）
- **x.2.x** - 次版本（新功能）
- **x.x.3** - 补丁版本（Bug 修复）

---

### 2. 标签使用

添加有意义的标签便于搜索：

```json
{
  "identity": {
    "tags": ["code-review", "typescript", "security"]
  }
}
```

---

### 3. 描述清晰

写清楚 Agent 的功能和使用方法：

```json
{
  "identity": {
    "description": "智能代码审查工具，检查 TypeScript 代码的安全性和性能问题"
  }
}
```

---

### 4. 备份 Agent

上传到 Market 前先备份：

```bash
# 导入后立即备份
cp -r ./imported-agents/my-agent ./backups/

# 或使用 tar 打包
tar -czf my-agent-backup.tar.gz ./imported-agents/my-agent
```

---

### 5. 测试部署

先在测试环境部署：

```bash
# 项目级部署（不影响全局）
agent-deploy deploy ./my-agent -l project

# 测试通过后再用户级部署
agent-deploy deploy ./my-agent -l user
```

---

### 6. 使用环境变量

设置常用配置：

```bash
# ~/.bashrc 或 ~/.zshrc
export MARKET_API_URL=http://your-market.com
export MARKET_API_KEY=your-api-key
```

---

### 7. 批量操作脚本化

创建自动化脚本：

```bash
#!/bin/bash
# migrate-agents.sh

SOURCE_DIR=".cursor/commands"
OUTPUT_DIR="./imported-agents"
TARGET_TOOL="claude_code"

# 导入所有 Agent
for file in "$SOURCE_DIR"/*.md; do
  echo "Importing: $file"
  agent-deploy import "$file" -o "$OUTPUT_DIR"
done

# 部署所有 Agent
for dir in "$OUTPUT_DIR"/*; do
  echo "Deploying: $dir"
  agent-deploy deploy "$dir" -t "$TARGET_TOOL"
done

echo "✅ All agents migrated!"
```

---

## 🔗 相关资源

- [Agent JSON 规范](./docs/specs/AGENT_JSON_SPEC_V2.md)
- [Import 适配器规范](./docs/guides/IMPORT_ADAPTER_SPEC.md)
- [GitHub 仓库](https://github.com/openpeng/agent-deploy)
- [问题反馈](https://github.com/openpeng/agent-deploy/issues)

---

## 📞 获取帮助

- **命令行帮助**: `agent-deploy --help`
- **GitHub Issues**: https://github.com/openpeng/agent-deploy/issues
- **文档**: https://github.com/openpeng/agent-deploy/tree/main/docs

---

**最后更新**: 2026-06-07  
**版本**: 1.0.0
