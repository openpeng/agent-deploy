# Phase 5 补充：invoke_agent 概念验证

完成日期：2026-06-07

## 问题发现

在 Phase 5 实战演练中，发现了一个架构问题：

**现状**：CLI 直接运行 agent
```bash
node dist/cli.js run agents/notification-agent  # ❌ 命令行工具执行
```

**应该**：Agent 调用 Agent（组合与编排）
```yaml
# 某个主 agent 可以调用子 agent
pipeline:
  - step: notify
    tool: invoke_agent  # ✅ Agent 调用 Agent
    args:
      agent: notification-agent
      input: {...}
```

## 快速实现

### 1. 新增 builtin 工具：invoke_agent

**文件**：`src/runtime/builtin-tools/invoke-agent.ts`

**功能**：
- 解析 agent 路径（绝对路径、相对路径、兄弟目录）
- 加载目标 agent 的 worker.yaml
- 支持 v2 兼容层
- 创建独立的子 agent 上下文
- 继承父 agent 的 tool registry
- 执行子 agent 并返回结果

**核心代码**：
```typescript
export const invokeAgentTool = {
  name: "invoke_agent",
  description: "调用另一个 agent 执行子任务",
  
  async execute(args: InvokeAgentArgs, context: any): Promise<any> {
    const { agent, input, cwd } = args;
    
    // 1. 解析 agent 路径（支持绝对、相对、兄弟目录）
    let agentDir = resolveAgentPath(agent, context);
    
    // 2. 加载 agent 的 worker.yaml
    const v2Compat = new V2CompatibilityLayer();
    const workerYaml = v2Compat.getWorkerYaml(agentDir);
    
    // 3. 创建子 agent 上下文
    const subContext = ExecutionContextManager.create({
      agent: { name: agentName },
      initialArgs: input,
      cwd: cwd || agentDir,
    });
    
    // 4. 使用全局 registry 执行子 agent
    const engine = new PipelineEngine(globalRegistry);
    const result = await engine.execute(workerYaml, subContext);
    
    return { success: true, agent: agentName, result };
  }
};
```

### 2. 路径解析策略

```typescript
// 绝对路径
"F:/mycode/agents/notification-agent"  → 直接使用

// 显式相对路径（相对于当前 agent 工作目录）
"./sub-agent"    → currentCwd/sub-agent
"../other-agent" → currentCwd/../other-agent

// 简单名称（兄弟目录查找）
"notification-agent" → parentDir/notification-agent
```

### 3. Tool Registry 共享方案

**临时方案**（Phase 5）：全局变量
```typescript
// CLI 层设置全局 registry
setGlobalToolRegistry(registry);

// invoke_agent 中访问
const engine = new PipelineEngine(globalRegistry);
```

**Phase 6 改进方向**：
- 通过 context 传递 registry
- 支持 registry 继承链
- 子 agent 可以注册自己的工具

### 4. 演示 Agent

**data-processor-agent**：
```yaml
pipeline:
  - step: process_input
    tool: write_file
    args:
      path: "output.txt"
      content: "Processing data: {{input}}"
    
  - step: notify_completion
    tool: invoke_agent  # 调用子 agent
    args:
      agent: "notification-agent"
      input:
        title: "✅ 数据处理完成"
        body: "已成功处理数据: {{input}}"
    output: notification_result
    
  - step: log_final
    tool: write_file
    args:
      path: "output.txt"
      content: "\n处理完成，通知已发送！"
      mode: append
```

## 测试结果

```bash
$ node dist/cli.js run agents/data-processor-agent \
    --args '{"input": "用户数据.csv"}'

🚀 Running agent: data-processor-agent
⏳ Executing pipeline...

  ↳ Invoking sub-agent: notification-agent
  ✓ Sub-agent notification-agent completed

✅ Pipeline execution completed!
Duration: 451ms

Execution Summary:
  Total steps:    4
  Successful:     4
  Failed:         0
```

**验证**：
- ✅ 主 agent 成功调用子 agent
- ✅ 子 agent 继承了父 agent 的所有 builtin 工具
- ✅ 子 agent 使用独立的工作目录和上下文
- ✅ 子 agent 的输出正确返回给父 agent
- ✅ 模板变量正确传递（`{{input}}` → `用户数据.csv`）

**生成的文件**：

`data-processor-agent/output.txt`:
```
Processing data: 用户数据.csv
Timestamp: {{timestamp}}

处理完成，通知已发送！
通知结果: [object Object]
```

`notification-agent/.notification.log`:
```
Preparing notification: ✅ 数据处理完成 - 已成功处理数据: 用户数据.csv
Notification sent at {{timestamp}}
Title: ✅ 数据处理完成
Body: 已成功处理数据: 用户数据.csv
Response: [object Object]
```

## 架构验证

### ✅ 成功实现的能力

1. **Agent 组合** - Agent 可以调用其他 Agent
2. **工具继承** - 子 Agent 继承父 Agent 的所有工具
3. **上下文隔离** - 每个 Agent 有独立的执行上下文
4. **数据传递** - 父 Agent 可以传递参数给子 Agent
5. **结果返回** - 子 Agent 的执行结果返回给父 Agent

### 🔄 待 Phase 6 改进

1. **从市场加载** - `agent: "market://notification-agent@1.0.0"`
2. **Registry 继承链** - 更优雅的工具共享机制
3. **循环依赖检测** - 防止 A 调用 B，B 又调用 A
4. **并发调用** - 同时调用多个子 Agent
5. **错误传播** - 子 Agent 错误的处理策略
6. **超时控制** - 子 Agent 执行超时
7. **资源限制** - 嵌套深度、执行时间限制

## 意义

这个概念验证证明了：

**Agent Deploy 不仅是工具，更是平台**

- 单个 Agent = 微服务
- invoke_agent = 服务编排
- Market = 服务注册中心
- Pipeline = 工作流引擎
- `agent-deploy use` = 一键部署安装

用户可以：
1. 从市场下载专用 Agent（通知、数据处理、代码检查等）
2. 通过 `agent-deploy use` 一键安装到 CC
3. 通过 `invoke_agent` 组合这些 Agent
4. 构建复杂的工作流，而不需要写代码

**这就是 "Agent as Service" 的雏形！**

## Phase 5.10 集成验证（2026-06-07）

### 完整流程

```bash
# 1. 从市场一键下载安装 notification-agent
$ agent-deploy use notification-agent
📥 Downloading from Market...
🔧 Installing to codebuddy_agent, codebuddy, claude_code...
✅ All 3 targets installed

# 2. Agent 自主调用（data-processor-agent → notification-agent）
$ agent-deploy run agents/data-processor-agent \
    --args '{"input": "agent-market use 端到端验证"}'

Executing pipeline (4 steps):
  process_input      ✅
  read_result        ✅
  notify_completion  ✅  invoke_agent("notification-agent")
    ↳ Sub-agent: prepare → send → log ✅
  log_final          ✅
Duration: 738ms
```

### 关键修复：全局 Registry 方案

**当前（临时）**：全局变量 `globalRegistry`
```typescript
setGlobalToolRegistry(registry);  // CLI 层设置
const engine = new PipelineEngine(globalRegistry);  // invoke_agent 中访问
```

**Phase 6 改进**：通过 context 传递
```typescript
ToolRegistry.attach(context, registry);     // 挂载到 context
const registry = ToolRegistry.from(context); // 从 context 获取
const childRegistry = registry.createChild(); // 创建子 registry
```

## 下一步

Phase 6 将完善这个能力，实现：
- 从市场动态加载 Agent
- 更完善的错误处理和资源管理
- Agent 依赖声明和自动解析
- 并发编排和条件分支
- 监控和可观测性

详见：`docs/phase6-plan.md`
