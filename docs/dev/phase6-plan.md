# Phase 6 规划：Agent 组合与编排平台

**目标**：将 Agent Deploy 从工具升级为平台，实现 "Agent as Service"

**创建日期**：2026-06-07  
**最后更新**：2026-06-07  
**进度**：Phase 6.0 ✅ 完成 | Phase 6.1+ 📋 规划中  
**依赖**：Phase 5 完成（345 tests, Runtime Engine + invoke_agent + use 命令）

---

## 一、愿景

```
单个 Agent      = 微服务
invoke_agent   = 服务编排
Market         = 服务注册中心
Pipeline       = 工作流引擎
agent-deploy use = 一键部署安装
```

**核心理念**：用户可以像使用 npm 包一样从市场下载 Agent，通过声明式配置组合编排，构建复杂工作流而无需编写胶水代码。

---

## 二、当前状态（Phase 5 完成）

### 2.1 已完成能力

| 能力 | 状态 | 说明 |
|------|------|------|
| Runtime Engine | ✅ | Pipeline 执行、模板变量、上下文管理 |
| 7 Builtin Tools | ✅ | read/write/bash/glob/llm_chat/web_fetch/web_search |
| invoke_agent | ✅ | Agent 间调用，全局 registry 共享 |
| V2 兼容层 | ✅ | 自动转换 v2 agents |
| CLI Run | ✅ | `agent-deploy run <agent-dir>` |
| CLI Use | ✅ | `agent-deploy use <agent-id|dir>` 一键下载安装 |
| codebuddy_agent Adapter | ✅ | Pipeline 感知，CC 可直接发现 |
| 测试覆盖 | ✅ | 345 tests, 100% pass |

### 2.2 已验证的 E2E 链路

```
Market → agent-deploy use → .codebuddy/agents/
  → invoke_agent("notification-agent")
  → Bark API 推送通知 → 手机接收 ✅
```

### 2.3 已知限制

1. **全局 registry** — 使用全局变量传递工具注册表，不够优雅
2. **路径解析简单** — 仅支持文件系统路径，不支持 `market://` URL
3. **无版本管理** — invoke_agent 无法指定 agent 版本
4. **无并发支持** — 只能顺序调用子 agent
5. **缺少错误处理** — 无重试、超时、循环依赖检测
6. **无资源管理** — 无嵌套深度限制、无调用链追踪

---

## 三、架构演进

### Phase 5 架构
```
CLI (process.argv)
  → PipelineEngine (sequential)
    → ToolRegistry (global var)
      → Builtin Tools + invoke_agent
```

### Phase 6 目标架构
```
CLI (process.argv)
  → AgentRuntime
    → DependencyResolver (market:// → 本地缓存)
    → ToolRegistry (context-based, 父子继承)
    → PipelineEngine (sequential/parallel)
      → invoke_agent / invoke_agent_parallel
        → AgentLoader (market/file/relative)
          → MarketClient (下载 + 缓存)
    → AgentMonitor (trace/metrics/log)
```

---

## 四、任务清单

### Phase 6.0：平台基础（P0，✅ 已完成 2026-06-07）

#### 6.0a `use` 命令增强 ✅

已实现 base 版本：

| 任务 | 状态 |
|------|------|
| 基础版：下载+适配+安装一站式 | ✅ |
| `--project-root` | ⏳ 待实现 |
| 版本下载 | `use notification-agent@1.0.0` |
| `--dry-run` | 预览模式，不写文件 |
| 冲突提示 | 检测已存在 Agent 时是否覆盖 |
| MCP Tool | `use_agent` MCP server tool |

#### 6.1 Tool Registry 重构 ✅

**目标**：移除全局变量，通过 ExecutionContext 传递 registry

```typescript
// 当前（临时方案）
let globalRegistry: ToolRegistry | null = null;
setGlobalToolRegistry(registry);

// Phase 6（context 传递）
ToolRegistry.attach(context, registry);    // 挂载
const registry = ToolRegistry.from(context); // 获取
const childRegistry = registry.createChild(); // 子 registry
```

**任务**：
- [x] ExecutionContext 添加 `__registry` 字段
- [x] 实现 `ToolRegistry.attach()` / `from()`
- [x] PipelineEngine 从 context 获取 registry
- [x] 移除全局 registry
- [x] 更新所有测试

#### 6.2 从市场动态加载 Agent + 缓存策略 ✅

**目标**：支持 `market://` URL schema + 本地缓存

**URL Schema**：
```
market://notification-agent@1.0.0  → 市场 ID + 版本
market://notification-agent         → 最新版本
file:///path/to/agent              → 本地绝对路径
./relative/path                    → 相对路径
```

**缓存目录结构**：
```
~/.agent-deploy/cache/
├── notification-agent@1.0.0/
│   ├── agent.json
│   └── worker.yaml
├── logger-agent@0.5.2/
│   ├── agent.json
│   └── worker.yaml
└── manifest.json  # 缓存元数据
```

**manifest.json**：
```json
{
  "notification-agent": {
    "installed": ["1.0.0", "1.0.1"],
    "resolved": "1.0.1",
    "downloaded_at": "2026-06-07T...",
    "last_used": "2026-06-07T..."
  }
}
```

**AgentCache 实现**：
```typescript
class AgentCache {
  get(name: string, versionSpec: string): string | null {
    const installed = this.manifest.list(name);
    const matched = semver.maxSatisfying(installed, versionSpec);
    if (matched) {
      return path.join(this.cacheDir, `${name}@${matched}`);
    }
    return null;
  }

  async install(packagePath: string): Promise<string> {
    const agentDir = await extract(packagePath, this.cacheDir);
    this.manifest.add(agentDir);
    return agentDir;
  }
}
```

**任务（6.2）**：
- [x] 定义 `AgentLoader` 接口 + `MarketAgentLoader` + `FileSystemAgentLoader`
- [x] 实现 `AgentCache`（manifest.json + semver 匹配 + LRU 淘汰）
- [x] invoke_agent 集成 loader，运行时自动下载
- [x] 版本解析（semver）

#### 6.3 依赖声明和自动解析 ✅

**目标**：agent.json 中声明依赖，`agent-deploy run` 时自动下载解析

**完整流程**：
```
agent-deploy run my-agent
    │
    ├─ 1. 解析 agent.json
    │      { "dependencies": { "agents": {"notification-agent": "^1.0.0"} } }
    │
    ├─ 2. 检查依赖
    │      ├─ notification-agent@^1.0.0 在缓存？
    │      │   YES → 使用缓存
    │      │   NO  → 从 Market 下载到 ~/.agent-deploy/cache/
    │      │
    │      └─ 递归解析子依赖（notification-agent 的 agent.json）
    │
    ├─ 3. 构建依赖图
    │      ├─ 检测循环依赖（DFS）
    │      └─ 拓扑排序确定加载顺序
    │
    ├─ 4. 加载所有 agent 到 registry
    │
    └─ 5. 执行 pipeline
           └─ invoke_agent("notification-agent") 直接命中缓存，零延迟
```

**DependencyResolver**：
```typescript
class DependencyResolver {
  async resolve(agentDir: string): Promise<Map<string, string>> {
    const visited = new Set<string>();
    const resolved = new Map<string, string>();

    await this.resolveRecursive(agentDir, visited, resolved);

    // 循环依赖检测
    this.assertNoCycles(resolved);

    return resolved;
  }

  private async resolveRecursive(
    agentDir: string,
    visited: Set<string>,
    resolved: Map<string, string>
  ): Promise<void> {
    const name = getAgentName(agentDir);
    if (visited.has(name)) return; // 已解析
    visited.add(name);

    const deps = loadAgentJson(agentDir).dependencies?.agents || {};
    for (const [depName, version] of Object.entries(deps)) {
      // 1. 先查缓存
      let depPath = this.cache.get(depName, version);

      // 2. 缓存未命中 → 从 Market 下载
      if (!depPath) {
        const pkg = await this.market.download(depName, version);
        depPath = await this.cache.install(pkg);
      }

      resolved.set(depName, depPath);

      // 3. 递归解析子依赖
      await this.resolveRecursive(depPath, visited, resolved);
    }
  }
}
```

**用户体验对比**：
```bash
# ❌ Phase 5 - 手动操作
$ agent-deploy download notification-agent
$ agent-deploy download logger-agent
# worker.yaml 中手动写路径: agent: "../notification-agent"

# ✅ Phase 6 - 自动解析
$ agent-deploy run my-agent

📦 Resolving dependencies...
  ⬇️  Downloading notification-agent@1.0.0  → cache
  ⬇️  Downloading logger-agent@0.5.2        → cache
  ✓  All dependencies resolved

🚀 Running agent: my-agent
  ↳ Invoking sub-agent: notification-agent (cached)
  ✓ Completed
```

**任务**：
- [x] 扩展 agent.json schema（`dependencies.agents`）
- [x] 实现 `DependencyResolver`（递归解析 + 循环检测 + 拓扑排序）
- [x] 集成到 `handleRunCommand`，加载阶段预解析所有依赖
- [x] semver 版本匹配

---

### Phase 6.1：编排能力（P1，⏳ 待开发）

#### 6.4 并发调用

**目标**：同时调用多个子 agent

**worker.yaml 语法**：
```yaml
pipeline:
  - step: notify_all
    tool: invoke_agent_parallel
    args:
      agents:
        - agent: notification-agent
          input: {title: "Task A"}
        - agent: webhook-agent
          input: {url: "..."}
    output: parallel_results
```

**实现**：`Promise.allSettled()`，支持部分失败继续

**任务**：
- [ ] 实现 `invoke_agent_parallel` 工具
- [ ] 部分失败策略配置
- [ ] 并发数限制
- [ ] 超时控制

#### 6.5 错误处理和重试

**目标**：细粒度的错误控制

**worker.yaml 扩展**：
```yaml
pipeline:
  - step: call_api
    tool: invoke_agent
    args:
      agent: api-client-agent
    retry:
      max_attempts: 3
      backoff: exponential
      initial_delay_ms: 1000
    on_fail: continue      # abort | continue | fallback
    fallback:
      agent: fallback-agent # on_fail=fallback 时使用
```

**任务**：
- [ ] PipelineStep 添加 retry 配置
- [ ] 指数退避实现
- [ ] fallback agent 支持
- [ ] 错误传播策略

#### 6.6 资源管理

**目标**：安全可靠的资源控制

**agent.json 声明**：
```json
{
  "resources": {
    "max_depth": 5,
    "max_duration_ms": 30000,
    "max_memory_mb": 512
  }
}
```

**任务**：
- [ ] 嵌套深度限制
- [ ] 超时控制（单 agent + 总时间）
- [ ] 调用链追踪（trace ID）
- [ ] 性能指标收集
- [ ] 日志聚合

---

### Phase 6.2：高级特性（P2，后续迭代）

#### 6.7 高级编排模式

- [ ] `for_each` 工具 — 循环调用 agent
- [ ] `map` / `filter` / `reduce` 模式
- [ ] 条件分支增强
- [ ] 动态 pipeline 生成

#### 6.8 Subagent 声明式配置

**agent.json 扩展**：
```json
{
  "subagents": {
    "notifier": {
      "source": "market://notification-agent@1.0.0",
      "alias": "notifier"
    }
  }
}
```

**worker.yaml 中使用别名**：
```yaml
pipeline:
  - step: notify
    tool: notifier.send
    args:
      title: "Hello"
```

- [ ] 扩展 agent.json subagents 字段
- [ ] 加载时预初始化
- [ ] 工具名称映射
- [ ] 自动生成工具包装器

---

## 五、实施路线图

```
Phase 5 完成 ──────────────────────────────────────────────→  ✅
Phase 6.0 (P0)  │  6.0a use 增强  ████████   ✅ 完成
                │  6.1  Registry   ████████   ✅ 完成
                │  6.2  Market加载  ████████   ✅ 完成
                │  6.3  依赖解析    ████████   ✅ 完成
                │
Phase 6.1 (P1)  │  6.4  并发调用    ░░░░░░░░   待开发
                │  6.5  错误重试    ░░░░░░░░   待开发
                │  6.6  资源管理    ░░░░░░░░   待开发
                │
Phase 6.2 (P2)  │  6.7  高级编排    ░░░░░░░░   待开发
                │  6.8  声明式配置  ░░░░░░░░   待开发
                │
Phase 6.0 完成 ──────────────────────────────────────────────→  ✅
```

---

## 六、成功标准

| 指标 | 目标 |
|------|------|
| Market 加载成功率 | > 99% |
| Agent 调用延迟（缓存命中） | < 50ms |
| 嵌套深度支持 | ≥ 10 层 |
| 循环依赖检测准确率 | 100% |
| 并发调用数量 | ≥ 20 个 agent |
| 调用链追踪 | 完整 trace |
| 测试覆盖率 | > 90% |
| 测试数量 | ≥ 400 tests |

---

## 七、技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 循环依赖 (A→B→A) | 死循环，资源耗尽 | 构建依赖图，DFS 检测 |
| 版本冲突 (X需Y@1.0, Z需Y@2.0) | 运行时错误 | 多版本共存，隔离加载目录 |
| 深度嵌套延迟累积 | 用户体验差 | 并发执行、本地缓存、超时控制 |
| 恶意 agent 资源消耗 | 安全风险 | 沙箱隔离、资源配额、权限控制 |
| 网络不可用（Market 宕机） | 无法加载 agent | 本地缓存 + 离线模式降级 |

---

## 八、与已有功能的关系

| Phase | 集成点 |
|-------|--------|
| Phase 3 Market | `MarketClient.downloadAgent()` 作为 loader 后端 |
| Phase 4 Templates | 模板包含依赖声明 `dependencies.agents` 示例 |
| Phase 5 Runtime | 在现有 PipelineEngine / ToolRegistry 上扩展 |
| Phase 5 invoke_agent | 从简单名称升级为 `market://` URL 加载 |

---

## 九、参考文档

- [Phase 5 完成总结](../phase5/phase5-complete.md)
- [invoke_agent 概念验证](../phase5/phase5-invoke-agent-poc.md)
- [Phase 5 实战演练](../phase5/phase5-practical-exercise.md)
- [Phase 5 最终总结](../phase5/phase5-final-summary.md)
- [Agent Protocol v3](../../agent-protocol/docs/agent-json-spec.md)
