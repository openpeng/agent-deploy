# agent-deploy — 开发者文档

## 技术架构

agent-deploy 有两个实现层：

| 层 | 语言 | 路径 | 职责 |
|----|------|------|------|
| **CLI + MCP Server (主)** | TypeScript | `node/` | CLI 10+ 命令、9 MCP 工具、Runtime Engine、Market Client |
| **Auto-Adapter (辅)** | Python | `src/agent_deploy/` | 工具检测、格式适配、文件安装 |

### Node.js 主实现架构

```
┌─────────────────────────────────────────────────────┐
│ MCP Host (Claude Code / CodeBuddy / Cursor)          │
│   ↕ stdio / JSON-RPC 2.0                             │
├─────────────────────────────────────────────────────┤
│ node/src/index.ts             ← MCP Server (9 工具)   │
│   ├── deploy_agent                                     │
│   ├── import_agent                                     │
│   ├── upload_agent                                     │
│   ├── download_agent                                   │
│   ├── adapt_agent                                      │
│   ├── install_agent                                    │
│   ├── list_installed_tools                             │
│   ├── execute_agent       ← ★ Phase 8 新增             │
│   └── list_agents         ← ★ Phase 8 新增             │
│                                                         │
│ node/src/cli.ts              ← CLI 入口 (11 命令)       │
│   ├── import / deploy / upload                          │
│   ├── list / search / info                              │
│   ├── init / templates                                  │
│   ├── run / use / clean                                 │
│                                                         │
│ node/src/runtime/             ← Runtime Engine          │
│   ├── agent-executor.ts       ← ★ 核心编排 (Phase 8)     │
│   ├── pipeline.ts             ← Pipeline 执行引擎        │
│   ├── parser.ts               ← YAML Pipeline 解析器    │
│   ├── context.ts              ← ExecutionContext         │
│   ├── tool-registry.ts        ← 分层工具注册表           │
│   ├── template.ts             ← 模板变量解析器           │
│   ├── policy.ts               ← 安全策略与沙箱           │
│   ├── mcp-integration.ts      ← MCP 工具集成             │
│   ├── skill-integration.ts    ← Skill 集成              │
│   ├── memory-integration.ts   ← Memory 系统集成         │
│   ├── agent-cache.ts          ← Agent 缓存              │
│   ├── agent-loader.ts         ← Agent 来源解析          │
│   ├── dependency-resolver.ts  ← DFS 依赖解析            │
│   ├── subagent.ts             ← 子Agent 调用            │
│   ├── v2-compat.ts            ← V2 兼容层               │
│   └── tools/                  ← 7 内置工具               │
│   └── builtin-tools/          ← invoke_agent + list_agents │
│                                                         │
│ node/src/adapters/            ← Import 适配器            │
│   ├── cursor-import.ts                                  │
│   ├── claude-import.ts                                  │
│   ├── codebuddy-import.ts                               │
│   └── github-import.ts                                  │
└─────────────────────────────────────────────────────┘
```

## 核心模块详解

### agent-executor.ts (Phase 8)
核心编排模块，CLI `run` 命令和 MCP `execute_agent` 工具共用。处理：
1. Agent 来源解析 (local → sibling → cwd → market:// 回退)
2. Overrides 合并（instructions / skills / MCP / shared_context / trusted / cwd / env）
3. ToolRegistry 构建（builtin + MCP config + skill defs + sub-agent wrappers）
4. ExecutionContext 创建
5. PipelineEngine 调用

### pipeline.ts (Phase 5)
YAML Pipeline 执行引擎 (87 tests)：
- 串行步骤执行
- `invoke_parallel` 并行子Agent调用
- `on_fail` 错误处理: `abort | skip | continue | { retry }`
- `when` 条件求值
- Step级超时 (Promise.race) + Pipeline级超时 (AbortController)
- `as` 结果映射到 shared_context

### tool-registry.ts (Phase 5-6)
分层工具注册表，无全局状态：
```
ToolRegistry
├── Layer 0: Builtin tools (7 个)
├── Layer 1: MCP tools (从配置文件)
├── Layer 2: Skills (从 skill 目录/运行时注入)
├── Layer 3: Sub-agents (agent/xxx)
└── Layer 4: Dynamic (运行时注册)
```

### template.ts (Phase 5)
变量解析器，支持：
- `{{var}}` — 简单变量
- `{{steps.X.output}}` — 步骤输出
- `{{steps.X.output.field.subfield}}` — 嵌套属性
- `{{shared.key}}` — 共享上下文
- `{{env.KEY}}` — 环境变量
- 单变量保持类型，多变量字符串中 String(value) 转换

## 新增 Runtime 工具

### 添加内置工具
1. 在 `node/src/runtime/tools/` 创建 `my-tool.ts`：
```typescript
import { ExecutionContext } from '../context';
import { ToolParams } from '../types';

export async function myTool(
  ctx: ExecutionContext,
  params: ToolParams & { param1: string }
) {
  // 安全策略检查
  if (!ctx.policy.isToolAllowed('my_tool')) {
    return { success: false, error: 'Tool not allowed' };
  }
  // 业务逻辑
  return { success: true, result: 'ok' };
}
```

2. 在 `tool-registry.ts` 中注册：
```typescript
registry.register('my_tool', {
  execute: (ctx, params) => myTool(ctx, params),
  // ...
});
```

### 添加 MCP 工具
1. 在 `node/src/index.ts` 中注册 handler：
```typescript
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  switch (name) {
    case 'my_tool':
      return { content: [{ type: 'text', text: JSON.stringify(await myHandler(args)) }] };
  }
});
```

## 测试

### Node.js 主测试 (Vitest)

```bash
cd agent-deploy/node
npm test          # 345+ 测试
npm run test:coverage
```

| 测试套件 | 文件 | 测试数 |
|----------|------|--------|
| Export | adapt.test.ts | 22 |
| Import | import*.test.ts | 31 |
| Pipeline | runtime-pipeline.test.ts | 87 |
| Built-in Tools | tools/*.test.ts | 127 |
| Subagent | subagent.test.ts | 36 |
| V2 Compat | v2-compat.test.ts | 18 |
| CLI/E2E | integration/*.test.ts | 13 |

### Python 辅助测试

```bash
cd agent-deploy && pip install -e ".[dev]" && pytest tests/ -v
```

## 构建流程

```bash
cd agent-deploy/node
npm run build     # tsc && cp src/templates/*.json dist/templates/
```

**重要**: tsc 不会自动复制 `.json` 文件，需要在 build 脚本中显式复制。

## 代码约定

1. **Context-based 无全局状态** — ToolRegistry 通过 ExecutionContext 传递
2. **默认不信任** — 所有 Agent 默认受限，需 `--trusted` 显式授权
3. **工具返回对象** — `{ success: true/false, result/error }` 格式
4. **invoke_agent 失败 throw** — 让 Pipeline `on_fail` / `retry` 接管
5. **agent context 双路径** — 同时设置 `{ name }` 和 `{ identity: { name } }`
6. **Windows 路径正斜杠** — 使用 `/` 非 `\`
7. **环境变量继承链** — `process.env → ExecutionContext.env → 子Agent → 孙Agent`
