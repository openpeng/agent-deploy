# agent-deploy (Node.js)

> 配置态管理器 (Configuration-state Manager) -- MCP Server & CLI for AI Agent deployment

`agent-deploy` 是一个 MCP (Model Context Protocol) Server，提供 Agent 的跨平台部署、导入导出、Market 分发等全生命周期管理能力。支持 Stdio 和 HTTP 双传输模式。

**Version:** 1.0.0 | **Package:** `@openpeng/agent-deploy` | **Node.js >= 18**

---

## MCP Tools

共注册 **22 个 MCP Tools**，分为以下几类：

### Agent 管理 (9 tools)

| Tool | Description |
|------|-------------|
| `list_installed_tools` | 检测宿主机上已安装的 AI 编程工具 |
| `adapt_agent` | 将 Market Agent 适配为目标工具的原生格式 |
| `install_agent` | 将适配后的 Agent 内容安装到目标工具的自动发现目录 |
| `deploy_agent` | 完整 Pipeline：检测工具 -> 下载 -> 适配 -> 安装，一步完成 |
| `scan_deployed` | 扫描所有已部署的 Agent |
| `uninstall_agent` | 从目标工具卸载 Agent |
| `check_updates` | 检查已部署 Agent 的更新（含版本对比、更新级别、changelog） |
| `import_agent` | 从 AI 工具格式导入为 agent.json v2.0 格式 |
| `list_agents` | 列出本地 Agent、Market Agent、缓存状态及更新提示 |

### Market 分发 (4 tools)

| Tool | Description |
|------|-------------|
| `upload_agent` | 上传 Agent 到 Market |
| `download_agent` | 从 Market 下载 Agent（支持缓存） |

### Team 管理 (5 tools)

| Tool | Description |
|------|-------------|
| `upload_team` | 上传 Team 到 Market |
| `download_team` | 从 Market 下载 Team |
| `list_teams` | 列出 Market 上的 Team |
| `get_team` | 获取 Team 详情 |
| `validate_team` | 验证 team.json 格式 |

### Workflow 管理 (5 tools)

| Tool | Description |
|------|-------------|
| `upload_workflow` | 上传 Workflow 到 Market |
| `download_workflow` | 从 Market 下载 Workflow |
| `list_workflows` | 列出 Market 上的 Workflow |
| `get_workflow` | 获取 Workflow 详情 |
| `validate_workflow` | 验证 workflow.json 格式 |

---

## Import Adapters

支持 **7 种** AI 工具格式的导入适配：

| Adapter | Source Format | Auto-detect Pattern |
|---------|--------------|-------------------|
| `CursorImportAdapter` | Cursor `.cursor/commands/*.md` | `.cursor/` 目录 |
| `ClaudeImportAdapter` | Claude Code `CLAUDE.md` / `.claude/` | `CLAUDE.md` 或 `.claude/` |
| `CodeBuddyImportAdapter` | CodeBuddy `.codebuddy/` | `.codebuddy/` 目录 |
| `GitHubImportAdapter` | GitHub Copilot `.github/copilot-instructions.md` | `.github/` 目录 |
| `VSCodeImportAdapter` | VSCode `.vscode/` settings | `.vscode/` 目录 |
| `JetBrainsImportAdapter` | JetBrains `.idea/` config | `.idea/` 目录 |
| `OpenAIGPTsImportAdapter` | OpenAI GPTs JSON export | JSON 格式检测 |

所有适配器统一输出 `agent.json v2.0` 格式，支持 `dry_run` 预览模式。

---

## CLI Commands

```bash
agent-deploy <command> [options]
```

### Agent 命令

| Command | Description |
|---------|-------------|
| `import <source>` | 从 AI 工具格式导入为 agent.json |
| `upload <agent-dir>` | 上传 Agent 到 Market |
| `deploy <agent-dir>` | 部署 Agent 到 AI 编程工具 |
| `use <agent-id\|dir>` | 下载 + 适配 + 安装（一站式） |
| `list` | 列出本地 Agent |
| `search <query>` | 在 Market 搜索 Agent |
| `info <agent-id>` | 显示 Agent 详细信息 |
| `init <template>` | 从模板创建新 Agent |
| `templates` | 列出可用模板 |
| `clean [agent-id]` | 清理全局 Agent 安装 |
| `validate <agent-dir>` | 验证 agent.json / worker.yaml 结构 |
| `preview <agent-dir>` | 预览 Pipeline 执行流程 (dry-run) |
| `check-updates` | 检查已部署 Agent 的更新 |

### Team 命令

| Command | Description |
|---------|-------------|
| `team package <team-dir>` | 打包 Team |
| `team upload <team-dir>` | 上传 Team 到 Market |
| `team download <team-name>` | 从 Market 下载 Team |
| `team list` | 列出 Market 上的 Team |
| `team validate <team-dir>` | 验证 team.json |

### Workflow 命令

| Command | Description |
|---------|-------------|
| `workflow package <workflow-dir>` | 打包 Workflow |
| `workflow upload <workflow-dir>` | 上传 Workflow 到 Market |
| `workflow download <workflow-name>` | 从 Market 下载 Workflow |
| `workflow list` | 列出 Market 上的 Workflow |
| `workflow validate <workflow-dir>` | 验证 workflow.json |

---

## Module Descriptions

### 核心模块

| Module | Description |
|--------|-------------|
| `index.ts` | MCP Server 入口，注册所有 Tools，支持 Stdio/HTTP 双传输模式 |
| `cli.ts` | CLI 命令行界面，支持中英文双语，含 i18n 和彩色输出 |
| `import-manager.ts` | 导入管理器，编排多个 ImportAdapter，支持自动检测和 dry-run |
| `adapt.ts` | 跨平台适配导出，将 Agent Descriptor 转换为目标工具的原生格式 |
| `detect.ts` | 自动检测宿主机上已安装的 AI 编程工具 |
| `install.ts` | 将适配后的 Agent 安装到目标工具的自动发现目录 |
| `uninstall.ts` | 从目标工具卸载 Agent |
| `scan-deployed.ts` | 扫描所有已部署 Agent 并生成摘要 |
| `check-updates.ts` | 检查 Agent 更新，支持版本对比和 changelog |
| `market.ts` | Market Client，处理 Agent/Team/Workflow 的上传下载和搜索 |
| `state.ts` | 部署状态持久化管理 |
| `lockfile.ts` | Agent Lock 文件管理，锁定依赖版本 |
| `errors.ts` | 统一错误处理和用户友好错误信息 |
| `watch.ts` | 文件监听，自动重新部署 |

### 配置验证 & 预览

| Module | Description |
|--------|-------------|
| `validator.ts` | **配置验证** -- 纯配置态验证，不执行工具调用。支持 agent.json 结构检查、worker.yaml Pipeline 验证、循环依赖检测、未定义变量检查、不可达步骤检测 |
| `preview.ts` | **Pipeline 预览** -- 纯配置态预览。支持文本格式步骤列表、Mermaid 流程图生成、Dry-run 模式模拟执行（含输入/输出模板解析） |

### 模板系统

| Module | Description |
|--------|-------------|
| `templates.ts` | **模板系统** -- 管理 Agent 模板，支持快速创建 Agent。提供 `listTemplates`、`getTemplate`、`initFromTemplate` API |

### HTTP Server

| Module | Description |
|--------|-------------|
| `http-server.ts` | **HTTP Server** -- 基于 Node.js 内置 http 模块，提供 Streamable HTTP + SSE 端点：`POST /message`、`GET /sse`、`GET /health`、`GET /metrics` |
| `http-transport.ts` | HTTP Transport 层，管理 Session 和路由 |

### 认证

| Module | Description |
|--------|-------------|
| `auth.ts` | **认证中间件** -- 支持 API Key、JWT Token、OAuth2/OIDC 多种认证方式，提供 UserInfo 和权限校验 |
| `auth-oidc.ts` | **OIDC SSO 集成** -- 标准 OIDC Authorization Code Flow，支持 IdP 重定向、Callback 处理、Token 交换与验证 |

### 多租户

| Module | Description |
|--------|-------------|
| `tenant.ts` | **多租户管理** -- 提供租户隔离，每个租户拥有独立的部署目录、缓存、日志和策略。支持租户级配额配置 |

### 审计

| Module | Description |
|--------|-------------|
| `runtime/audit.ts` | **审计** -- 记录 tool_call、agent_execution、policy_violation 事件，含 trace_id 关联和 policy level 标记 |

### 配额

| Module | Description |
|--------|-------------|
| `runtime/quota.ts` | **配额管理** -- 资源限制控制，包括执行时间、内存、网络请求次数、文件操作次数、Token 用量和 CPU 时间 |

### 沙箱

| Module | Description |
|--------|-------------|
| `runtime/sandbox.ts` | **沙箱** -- 容器化命令执行，支持 Docker 容器隔离，可配置 CPU/内存限制、网络模式（none/bridge）和超时 |

### 遥测

| Module | Description |
|--------|-------------|
| `telemetry.ts` | **遥测** -- 基于 OpenTelemetry 的分布式追踪，支持 OTLP HTTP Exporter、Auto-instrumentations 和 Span 上下文传播 |

### 指标

| Module | Description |
|--------|-------------|
| `metrics.ts` | **指标** -- 基于 Prometheus 的自定义指标，`agent_deploy_` 前缀，含请求计数、活跃连接数等 |

### Runtime

| Module | Description |
|--------|-------------|
| `runtime/pipeline.ts` | Pipeline 执行引擎 |
| `runtime/agent-executor.ts` | Agent 执行器（已迁移至 agent-compose） |
| `runtime/agent-cache.ts` | Agent 下载缓存管理 |
| `runtime/agent-loader.ts` | Agent 加载器 |
| `runtime/dependency-resolver.ts` | 依赖解析器 |
| `runtime/policy.ts` | 策略配置（standard/restricted/privileged） |
| `runtime/context.ts` | 执行上下文管理 |
| `runtime/mcp-integration.ts` | MCP Server 动态集成 |
| `runtime/skill-integration.ts` | Skill 注入集成 |
| `runtime/memory-integration.ts` | Memory 集成 |
| `runtime/subagent.ts` | 子 Agent 调用 |
| `runtime/tool-registry.ts` | 工具注册表 |
| `runtime/template.ts` | 模板引擎 |
| `runtime/v2-compat.ts` | v1/v2 格式兼容层 |

---

## Development Setup

```bash
# 安装依赖
npm install

# 构建
npm run build

# 开发模式（watch）
npm run dev

# 运行 MCP Server (stdio)
npm start

# 运行 MCP Server (HTTP)
TRANSPORT=http PORT=3000 npm start

# 直接运行 TypeScript
npx tsx src/index.ts

# CLI 命令
npx tsx src/cli.ts --help
npx tsx src/cli.ts list
npx tsx src/cli.ts import .cursor/commands/my-agent.md

# 测试
npm test
npm run test:watch

# 代码质量
npm run lint
npm run format
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TRANSPORT` | 传输模式：`stdio` 或 `http` | `stdio` |
| `PORT` | HTTP 端口 | `3000` |
| `MARKET_API_URL` | Market API 地址 | `http://localhost:8321` |
| `MARKET_API_KEY` | Market API Key | - |
| `DEBUG` | 调试模式 | `false` |
| `OIDC_ISSUER` | OIDC Issuer URL | - |
| `OIDC_CLIENT_ID` | OAuth2 Client ID | - |

---

## Architecture

```
                         +------------------+
                         |   AI Coding Tool |
                         | (Cursor/Claude/  |
                         |  CodeBuddy/...)  |
                         +--------+---------+
                                  |
                         install / uninstall
                                  |
+------------------+    +---------v----------+
|    Market API    |<-->|   agent-deploy    |
|  (Upload/Download|    |   (MCP Server)    |
|   Search/Share) |    +---------+----------+
+------------------+              |
                                  | stdio / HTTP (SSE)
                                  |
                         +--------v----------+
                         |   MCP Client      |
                         | (AI IDE / Agent)  |
                         +------------------+

  +---------------------------------------------------+
  |                  Core Modules                      |
  |                                                     |
  |  detect.ts  -->  adapt.ts  -->  install.ts         |
  |       |              |              |               |
  |  scan-deployed.ts    |         uninstall.ts         |
  |       |              |              |               |
  |  check-updates.ts    |         state.ts              |
  +---------------------------------------------------+
  |                                                     |
  |  import-manager.ts  +  7 Import Adapters           |
  |  market.ts  (Agent/Team/Workflow CRUD)              |
  |  validator.ts  (agent.json / worker.yaml)           |
  |  preview.ts  (Pipeline preview / Mermaid / dry-run)  |
  |  templates.ts  (Agent template system)              |
  +---------------------------------------------------+
  |                                                     |
  |  Cross-cutting Concerns                             |
  |  +-----------+  +----------+  +--------+  +--------+ |
  |  | auth.ts   |  | tenant.ts|  | audit  |  | quota  | |
  |  | auth-oidc |  |          |  |        |  |        | |
  |  +-----------+  +----------+  +--------+  +--------+ |
  |  +-----------+  +----------+  +--------+  +--------+ |
  |  | telemetry |  | metrics  |  |sandbox |  | errors | |
  |  +-----------+  +----------+  +--------+  +--------+ |
  +---------------------------------------------------+
```

---

## License

MIT
