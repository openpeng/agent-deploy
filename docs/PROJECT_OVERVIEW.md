# Agent Hub — 项目概览

> Agent 是 AI 能力的完整载体 — 自有工具、自有状态、自洽运行。
> **项目一：Agent Runtime** 让 Agent 跑起来；**项目二：Agent Market** 让 Agent 流通起来。
> 两个独立项目，一个统一协议，共同构建开放的 AI Agent 生态。

**核心特性：**

- 🧬 Agent = 完整的 AI 能力世界
- 🔧 子Agent 自治运行时
- 🔗 多Agent 协作协议
- 🔐 安全沙箱 权限审计
- 🌐 开放市场 一键发布
- 🤖 llm_chat 配置自动继承

---

## 1. 核心模块

OpenAgent 由两个开源仓库组成，三大模块：

### 🔧 Agent Runtime (`src/agents/`)

**让 Agent 跑起来。** 加载 agent.json → 审计权限 → 注入配置 → 启动 Pipeline — 从声明到执行的完整引擎。支持旧 SKILL.md 自动兼容。

📦 与 Market 同仓库

### 🌐 Agent Market (`src/market/`)

**让 Agent 流通起来。** FastAPI 市场服务 + Python SDK — 搜索、发布、下载、评分。SQLite 存储，零外部依赖，本地优先。

→ [github.com/openpeng/agent-market](https://github.com/openpeng/agent-market)

### 🚀 Agent Deploy (`skills/agent-deploy/`)

**一键部署到任意 AI 工具。** MCP Server 自动检测 Cursor / Claude Code / CodeBuddy / Copilot 等 9 种工具，下载适配，一条命令搞定。

→ [github.com/openpeng/agent-deploy](https://github.com/openpeng/agent-deploy)

### 项目结构

```
两个仓库，一份协议，三大模块：

🔧 Agent Runtime                        🌐 Agent Market
让 Agent 跑起来                          让 Agent 流通起来
├── MainAgent 顶层入口                   ├── server.py     FastAPI 服务
├── AgentLoader 包加载校验               ├── MarketClient   Python SDK
├── Auditor 安全审计                      ├── database.py   SQLite 存储
├── SubAgentRuntime 隔离执行              ├── search.py     全文搜索
├── MessageBus 协作文通                   ├── ratings.py    评分系统
└── ToolRegistry 工具注册                 └── cache.py      本地缓存

            ← 同一份 agent.json + worker.yaml 定义 →
```

---

## 2. 设计哲学：为什么是 Agent？—— 超越 Skill 的范式跃迁

Skill 解决**上下文爆炸**的表面问题，Agent 回答的是**AI 能力的组织方式**这一根本问题：

|            | Skill（技能）                     | Agent（智能体）                                        |
| ---------- | --------------------------------- | ------------------------------------------------------ |
| 本质       | 一个可调用的函数片段              | **一个拥有独立世界的完整存在**                         |
| 状态       | 无状态，每次调用重新开始          | **有状态，拥有记忆和生命周期**                         |
| 工具       | 被动被编排                        | **主动声明需求，自治执行**                             |
| 配置       | 依赖调用方传入一切                | **自包含 LLM 配置、环境变量、权限**                    |
| 复杂度     | 上限是单次调用的复杂度            | **从一行代码到百Agent协同，同一抽象**                  |
| 协作       | 由编排层统一调度                  | **Agent 可以直接发现和调用其他 Agent**                 |
| 可分享性   | 分享一个代码片段                  | **分享一个完整的 AI 能力世界**                         |

Skill 到 Agent 的升级，不是「更好的函数」，而是**从碎片到整体**的范式跃迁。Agent 是 AI 能力的最小完整单元 — 它既是原子，也可以组成分子。

---

## 3. 项目亮点

- **🧬 原子化设计** — 每个 Agent 是完备的自治单元：工具、Pipeline、状态、LLM 配置自包含
- **🔄 配置自动继承** — LLM 配置从主 Agent 自动注入子 Agent，声明即用
- **🔧 自由伸缩** — 从「读取文件」到「多Agent协作数据分析系统」，同一套抽象
- **🔗 多Agent 协作** — 标准化协议通信，串行、并行、条件路由，Agent 编排 Agent
- **🔐 安全沙箱** — 文件、网络、子进程、资源四维审计，每个Agent都有权限边界
- **🌐 市场生态** — 一键发布、搜索、下载、评分，Agent 像 App 一样流通
- **📦 自动发现** — 安装即用，MainAgent 自动发现 market 下所有 Agent

---

## 4. 快速开始

### 从市场下载到运行 Agent（3 行代码）

1. **安装** — `client.install("file-summarizer")`
2. **加载** — `main.load_package(path)`（自动注入 LLM 配置）
3. **运行** — `result = main.run_sync(initial_args={"file_path": "..."})`

### 使用 curl 调用市场 API

```bash
# 健康检查 & 搜索
curl http://localhost:8321/api/v1/health
curl "http://localhost:8321/api/v1/agents?q=web&category=browser"

# 发布 / 下载
curl -X POST -H "Authorization: Bearer pd_mkt_..." -F file=@agent.tar.gz \
  http://localhost:8321/api/v1/agents
curl -OJ http://localhost:8321/api/v1/agents/my-agent/download
```

### 使用 agent-deploy CLI

```bash
# 下载并运行
agent-deploy use <agent-id> -m http://localhost:8321
agent-deploy run ./agents/<agent-id> --trusted --args "key=value"

# 本地开发
agent-deploy init agent-builder -n my-agent
agent-deploy run . --verbose --trusted
```

---

## 5. Agent 包格式

Agent 包的标准目录结构（支持 `.tar.gz` / `.zip`）：

```
my-agent/
├── agent.json              # [必填] 包元数据 + 入口定义
├── worker.yaml             # [必填] 入口工作流定义
├── libs/                   # [可选] 共享 Python 脚本
│   └── helper.py
├── templates/              # [可选] 模板文件
└── README.md               # [推荐] 说明文档
```

---

## 6. agent.json 协议

`agent.json` 是 Agent 包的核心声明式配置（**worker.yaml** 位于包根目录）：

```json
{
  // 身份信息（必填）
  "identity": {
    "name": "my-agent",         // 唯一标识
    "version": "1.0.0",        // semver
    "description": "...",
    "author": "your-name",
    "display_name": "显示名称",
    "tags": ["tag1", "tag2"]
  },
  // 入口配置（必填）
  "entry": { "main_subagent": "worker" },
  // 子Agent引用列表（必填）
  "subagents": [
    {"name": "worker", "path": "worker.yaml"}
  ],
  "category": "utility",
  "type": "agent",
  "license": "MIT",
  "dependencies": { "python3": ">=3.10" }
}
```

> 完整规范参见 → [AGENT_JSON_SPEC_V2.md](specs/AGENT_JSON_SPEC_V2.md)

---

## 7. 安全与权限模型

每个子Agent声明所需权限，Auditor 自动审计拒绝越权访问：

```yaml
# 权限声明示例
permissions:
  filesystem:
    read: ["data/**"]
    write: ["output/**"]
  network:
    outbound: true
    allowed_hosts: ["api.example.com"]
  subprocess:
    max_concurrent: 2
    allowed_commands: ["python3", "node"]
  resources:
    memory_limit: "1GB"
    timeout: 300
```

四维审计：**文件系统** · **网络** · **子进程** · **资源**

---

## 8. LLM Chat 与配置自动继承

子Agent 声明 `llm_chat` 即可调用大模型，**无需配置 API Key**：

```yaml
# worker.yaml — llm_chat 使用示例
tools:
  - name: llm_chat
    type: builtin

pipeline:
  - step: analyze
    tool: llm_chat
    args:
      prompt: "分析: {{raw_text}}"
      system_prompt: "你是一个助手"
    # model / api_key 不传 → 从主Agent自动继承
    on_fail: continue
```

### 配置优先级

| 优先级 | 读取位置                          | 示例                                        |
| ------ | --------------------------------- | ------------------------------------------- |
| ① 最高 | `args.model` / `args.api_key`     | `model: "gpt-4o"` 覆盖默认值               |
| ② 默认 | `shared_context.llm_config`       | MainAgent 启动时从环境变量读取并注入         |
| ③ 兜底 | 环境变量                          | `LLM_MODEL` / `OPENROUTER_API_KEY`          |

支持的 provider: **openai** | **openrouter** | **anthropic**

```yaml
# 方式1: 不传 model/api_key → 自动继承
pipeline:
  - step: use_default
    tool: llm_chat
    args:
      prompt: "用默认模型分析..."
    # ✅ 无需 model/api_key — 自动从MainAgent.llm_config继承

# 方式2: 显式指定 → 覆盖默认值
  - step: use_custom
    tool: llm_chat
    args:
      prompt: "用特定模型分析..."
      model: "claude-3-opus-20240229"
      api_key: "sk-ant-xxxxx"
      provider: "anthropic"
```

---

## 9. 自定义 MCP 工具

子Agent 可连接 MCP 服务器导入任意工具，支持 stdio 与 JSON-RPC：

```yaml
# worker.yaml — MCP 工具声明
tools:
  - name: fs
    type: mcp
    server:
      command: "npx"
      args: ["-y", "@anthropic/mcp-server-filesystem", "/tmp"]
    allowed_tools: ["read_file", "write_file"]
    timeout: 30

pipeline:
  - step: read_it
    tool: fs__read_file       # 命名空间: <name>__<tool>
    args:
      path: "/tmp/data.txt"
      output: content
```

### MCP 工具配置字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `name` | string | ✅ | MCP 服务器别名（用于命名空间前缀） |
| `type` | string | ✅ | 固定为 `mcp` |
| `server.command` | string | ✅ | MCP 服务器启动命令 |
| `server.args` | string[] | ✅ | 命令行参数 |
| `server.env` | dict | | 环境变量覆盖 |
| `server.cwd` | string | | 工作目录 |
| `allowed_tools` | string[] | | 允许的工具列表（空 = 全部导入） |
| `timeout` | int | 30 | 每个工具调用的超时时间（秒） |

> MCP 服务器自动启动并 JSON-RPC 握手 · 工具列表自动发现 · 命名空间隔离避免冲突 · **每个子 Agent 可绑定独立的 MCP 服务器**

---

## 10. Agent Runtime 架构

### 10.1 子Agent 配置规范 (worker.yaml)

每个子Agent由一个 YAML 文件定义，包含工具声明、Pipeline 步骤和权限配置：

```yaml
# worker.yaml — 完整示例（根目录）
name: worker
version: "1.0.0"
description: "数据处理 + LLM 分析子Agent"

# 工具声明：子Agent只能调用此处列出的工具
tools:
  - name: read_file
    type: builtin
  - name: llm_chat
    type: builtin
    # ★ 自动继承主Agent的 model/api_key/provider
  - name: bash
    type: builtin

# Pipeline 步骤（顺序执行）
pipeline:
  - step: read_input
    tool: read_file
    args:
      path: "{{file_path}}"
    output: raw_data
    on_fail: fail

  - step: analyze_llm
    tool: llm_chat
    args:
      prompt: "分析: {{raw_data}}"
      system_prompt: "你是一个数据分析师"
    # model 不传 → 从主Agent自动继承
    output: llm_result
    on_fail: continue   # LLM不可用时不中止

  - step: fallback
    tool: bash
    args:
      command: "python3 {{package_dir}}/libs/analyze.py"
      timeout: 30
    output: done
    on_fail: fail

# 权限声明
permissions:
  filesystem:
    read: ["data/**", "libs/**"]
    write: ["output/**"]
  subprocess:
    max_concurrent: 1
    allowed_commands: ["python3", "cat", "echo"]
  resources:
    memory_limit: "128MB"
    timeout: 60

# 环境变量（可选）
env:
  LOG_LEVEL: "info"
```

**字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `tools` | array | 工具声明列表。类型：`builtin`（内置）、`skill`（技能）、`custom`（自定义）、`mcp`（MCP协议） |
| `pipeline[]` | array | 顺序执行的步骤列表 |
| `pipeline[].on_fail` | string | 失败策略：`abort`（中止）、`skip`（跳过）、`retry(N)`（重试N次） |
| `permissions` | object | 文件系统、网络、子进程、资源的权限声明 |
| `collaboration` | object | 协作配置（详见下节） |
| `healthcheck` | object | 健康检查配置 |

### 10.2 协作配置 (Collaboration)

`CollaborationConfig` 控制子Agent在协作中的角色和行为：

| 字段 | 默认值 | 可选值 | 说明 |
|------|--------|--------|------|
| `execution_mode` | sync | sync / async / async_wait | 同步等待 / 异步不等待 / 异步可等待 |
| `trigger` | auto | auto / manual / on_complete / on_fail / conditional / scheduled | 子Agent激活条件 |
| `coordination` | sequential | sequential / parallel_all / parallel_any / parallel_quorum / conditional / dynamic | 协作策略 |
| `data_exchange` | file | file / message / shared_context / stream | 数据交换方式 |
| `merge_strategy` | concat | concat / merge_dict / union / intersect / custom | 并行结果合并策略 |
| `depends_on` | [] | string[] | 依赖的子Agent列表（完成后才能启动） |
| `input_mapping` | {} | dict | 输入映射：从共享上下文映射到子Agent参数 |
| `output_mapping` | {} | dict | 输出映射：子Agent结果写入共享上下文 |
| `timeout` | 300 | int | 最大执行时间（秒） |
| `max_retries` | 0 | int | 失败时最大重试次数 |
| `priority` | 0 | int | 执行优先级（数字越大越优先） |

**协作策略详解：**
- `sequential` — 串行执行，一个完成后再启动下一个
- `parallel_all` — 并行执行所有，等待全部完成
- `parallel_any` — 并行执行，任一完成即继续
- `parallel_quorum` — 并行执行，超过半数完成即继续
- `conditional` — 条件判断后路由到不同子Agent
- `dynamic` — 运行时由父Agent动态决定

### 10.3 工作流编排 (Workflow)

在 `agent.json` 的 `entry` 中定义，支持三种编排方式：

**1. Chain（链式编排）**

```json
"entry": {
  "chain": [
    {"subagent": "fetcher",  "output_key": "raw_html"},
    {"subagent": "parser",   "input_key": "raw_html",  "output_key": "data"},
    {"subagent": "reporter", "input_key": "data",    "output_key": "report"}
  ]
}
```

**2. Fan-out（并行分发）**

```json
"entry": {
  "fan_out": [{
    "group_name": "analyzers",
    "targets": ["analyzer-a", "analyzer-b", "analyzer-c"],
    "strategy": "parallel_all",
    "merge_strategy": "concat",
    "output_key": "merged_results"
  }]
}
```

**3. Conditional Routes（条件路由）**

```json
"conditional_routes": [{
  "condition": "{{steps.check.output.status}} == 'ok'",
  "target": "process-ok",
  "fallback": "process-error"
}]
```

### 10.4 消息总线协议 (MessageBus)

MessageBus 是父子Agent间的通信中枢，所有交互通过标准消息类型进行：

| 分类 | 消息类型 | 说明 |
|------|----------|------|
| 控制 | `subagent.create` | 创建子Agent实例 |
| 控制 | `subagent.destroy` | 销毁子Agent |
| 控制 | `subagent.pause` | 暂停子Agent |
| 控制 | `subagent.resume` | 恢复子Agent |
| 任务 | `task.assign` | 分配任务 |
| 任务 | `task.progress` | 任务进度通知 |
| 任务 | `task.complete` | 任务完成 |
| 任务 | `task.fail` | 任务失败 |
| 工具 | `tool.call` | 工具调用请求 |
| 工具 | `tool.result` | 工具调用结果 |
| 工具 | `tool.request` | 工具权限请求 |
| 状态 | `status.report` | 状态报告 |
| 状态 | `log.emit` | 日志输出 |
| 状态 | `health.check` | 健康检查 |
| 协作 | `collab.request_help` | 子Agent请求其他Agent帮助 |
| 协作 | `collab.forward` | 转发任务给兄弟Agent |
| 协作 | `collab.merge` | 合并来自多个Agent的结果 |

### 10.5 工具系统 (Tool System)

工具是子Agent执行任务的最小单元，有三种类型：

| 类型 | 标识 | 说明 | 示例 |
|------|------|------|------|
| builtin | `type: builtin` | AgentRuntime 内置的标准工具 | read_file, bash, web_fetch, web_search, glob |
| skill | `type: skill` | 通过 SKILL.md 注册的技能工具 | 自定义数据分析/处理技能 |
| custom | `type: custom` | 用户自定义工具（Python/JS 脚本） | internal_api.py, reporter.py |

工具注册表（ToolRegistry）维护全局工具实例，子Agent声明工具后通过注册表获取实例副本。未声明的工具调用会抛出 `ToolNotDeclaredError`。

### 10.6 Pipeline 执行机制

子Agent的 Pipeline 按步骤顺序执行，每个步骤经过以下流程：

```
┌──────────────────────────────────────────────────┐
│               Pipeline 步骤执行流程                │
├──────────────────────────────────────────────────┤
│  1. 模板变量解析                                   │
│     TemplateResolver 递归解析 args 中的模板变量    │
│     • {{var}} → 运行时参数                         │
│     • {{steps.step_name.output}} → 上一步输出      │
│     • {{shared_context.key}} → 共享上下文           │
│     • {{state.key}} → 子Agent私有状态              │
│                                                     │
│  2. 工具参数注入                                   │
│     将解析后的参数传递给声明的工具                   │
│                                                     │
│  3. 工具调用                                       │
│     call_tool(tool_name, **resolved_args)            │
│     检查工具是否已声明 → 调用 → 返回 ToolResult      │
│                                                     │
│  4. 错误处理                                       │
│     on_fail=abort  → 抛出异常，Pipeline中止          │
│     on_fail=skip   → 跳过当前步骤，继续下一步        │
│     on_fail=retry(N) → 最多重试N次                   │
│                                                     │
│  5. 结果保存                                       │
│     步骤结果保存到 _step_results[step_name]          │
│                                                     │
│  6. 进度通知                                       │
│     通过 MessageBus 发送 TASK_PROGRESS 消息          │
└──────────────────────────────────────────────────┘
```

### 10.7 生命周期管理

每个子Agent实例遵循严格的状态机：

```
  加载    校验    批准    创建    运行
LOADED → VALIDATED → APPROVED → CREATED → RUNNING
                                   │
                          ┌────────┼────────┐
                          ▼        ▼        ▼
                      PAUSED  COMPLETED  FAILED
                          │                  │
                          └─────▶ DESTROYED ◄─────┘
```

| 状态 | 说明 |
|------|------|
| `loaded` | 子Agent配置已从YAML加载 |
| `validated` | 配置校验通过 |
| `approved` | 安全审计通过，权限已批准 |
| `created` | 运行时实例已创建 |
| `running` | 正在执行 Pipeline |
| `paused` | 已暂停（可恢复） |
| `completed` | Pipeline 执行成功完成 |
| `failed` | 执行失败（记录错误信息） |
| `destroyed` | 资源已清理，实例已销毁 |

---

## 11. Market API 参考

### 基础信息

| 项目 | 值 |
|------|-----|
| Base URL | `http://localhost:8321/api/v1` |
| 认证方式 | `Authorization: Bearer pd_mkt_xxxxxxxxxxxxxxxx` |
| 端口 | 8321 |
| 数据目录 | `./data/market/` |
| 包存储 | `./data/market/packages/` |
| 数据库 | `./data/market/market.db` (SQLite) |

### 全部端点

| 方法 | 路径 | 认证 | 说明 |
|:----:|------|------|------|
| GET | `/` | — | 前端页面入口 |
| GET | `/api/v1/health` | — | 健康检查 |
| POST | `/api/v1/agents` | publisher+ | 注册/上传 Agent 包 |
| GET | `/api/v1/agents` | — | 搜索/列表 Agent |
| GET | `/api/v1/agents/batch?ids=a,b,c` | — | 批量查询 Agent |
| GET | `/api/v1/agents/{id}` | — | 获取 Agent 详情 |
| GET | `/api/v1/agents/{id}/download` | — | 下载 Agent 包文件 |
| POST | `/api/v1/agents/{id}/ratings` | publisher+ | 评分 Agent |
| GET | `/api/v1/agents/{id}/ratings` | — | 获取评分列表 |
| DELETE | `/api/v1/agents/{id}` | admin | 删除 Agent |
| POST | `/api/v1/api-keys` | master/admin | 创建 API Key |
| GET | `/api/v1/api-keys` | admin | 列出 API Keys |
| DELETE | `/api/v1/api-keys/{key}` | admin | 撤销 API Key |

### 搜索参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `q` | string | "" | 关键词搜索（匹配 name/display_name/description） |
| `category` | string | "" | 分类过滤 |
| `type` | string | "" | 类型过滤 |
| `tags` | string | "" | 标签过滤（逗号分隔） |
| `sort` | string | "downloads" | 排序：downloads, rating, created, name |
| `order` | string | "desc" | 方向：asc, desc |
| `page` | int | 1 | 页码 |
| `page_size` | int | 20 | 每页条数（最大100） |

---

## 12. MarketClient Python SDK

`MarketClient` 提供完整的 Python SDK 无缝对接市场：

```python
from market.client import MarketClient
from agents import MainAgent

client = MarketClient(server_url="http://localhost:8321",
                       api_key="pd_mkt_xxxxxxxxxxxxxxxx")
main = MainAgent()

# 搜索
client.search(query="web", category="browser", sort="downloads")

# 安装后直接运行（自动发现 LLM 配置）
path = client.install("file-summarizer")
main.load_package(str(path))
result = main.run_sync(initial_args={"file_path": "data.txt"})

# 发布 / 更新
client.publish("./my-agent-pkg", force=True)
client.check_updates("my-agent")
client.clean_cache(max_age_days=30)
client.list_installed()
client.uninstall("old-agent")
```

---

## 13. 未来判断 — Agent 是 AI 能力的原子载体

我们相信，Agent 将成为 AI 时代最基础的**能力封装单位**。就像函数是代码的原子、容器是部署的原子、App 是移动互联网的原子 — **Agent 是 AI 的原子**。

1. **Function 时代** — 一个函数解决一个计算问题。AI 调用函数，但函数不理解 AI。
2. **Skill 时代** — 一个 Skill 解决一个领域任务。上下文膨胀，仍是被动片段。
3. **Agent 时代 ← 我们在这一步** — Agent 拥有完整世界：工具、状态、配置、权限、记忆。从单功能到复杂系统，同一套抽象自由伸缩。
4. **Agent 协作网络** — Agent 发现 Agent、Agent 编排 Agent、Agent 交易 Agent。市场成为 Agent 的 App Store。
5. **数字组织** — 成百上千个 Agent 组成自组织系统。像细胞形成组织、组织形成器官、器官形成生命体。

**核心判断：** 不要做更大的 Skill，要做**完整的 Agent**。Agent 的简单与复杂不是对立面 — 一个只读文件的 Agent 和一个多Agent协作的数据分析系统，**都是同一个 Agent 抽象**。这让复杂度可以递进叠加，而非一次性膨胀。

---

## 14. Agent 协议概述

OpenAgent 协议是一套声明式、可组合的 AI Agent 定义规范，核心设计理念：

| 理念 | 说明 |
|------|------|
| 声明式 | agent.json + YAML 声明 Agent 行为，无需编码 |
| 工具自治 | 每个子Agent自行声明和注册所需工具，不依赖父Agent代劳 |
| Pipeline 驱动 | 按步骤顺序执行，每步调用一个工具，支持重试/跳过/中止 |
| 模板变量 | `{{var}}`、`{{steps.x.output}}`、`{{shared_context.x}}` 等运行时变量解析 |
| 协作策略 | 串行/并行/条件路由/动态路由，支持复杂工作流编排 |
| 安全沙箱 | 声明式权限 + Auditor 审计，细粒度控制资源访问 |

---

## 相关文档

- [README](../README.md) — Agent Deploy 工具概述
- [USER_GUIDE](guides/USER_GUIDE.md) — 用户使用指南
- [AGENT_JSON_SPEC_V2](specs/AGENT_JSON_SPEC_V2.md) — agent.json 完整规范
- [AGENT_DEV_GUIDE](../../docs/AGENT_DEV_GUIDE.md) — Agent 开发指南
- [ARCHITECTURE](../../docs/ARCHITECTURE.md) — 架构设计文档
- [SECURITY](../../docs/SECURITY.md) — 安全模型详解
- [API](../../docs/API.md) — Market API 文档
