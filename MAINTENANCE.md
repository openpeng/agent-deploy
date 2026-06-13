# agent-deploy — 维护手册

## 发布清单 (Node.js)

每次发布新版本时按此清单操作：

1. **更新版本号**: 修改 `node/package.json` 中的 `version` 字段
2. **更新 CHANGELOG**: 记录本次变更
3. **运行全部测试**: `cd node && npm test`，确保 345+ 测试全部通过
4. **运行 Lint**: `cd node && npm run lint && npm run format`
5. **构建**: `cd node && npm run build`（tsc + 复制模板 JSON）
6. **本地验证**: `cd node && node dist/cli.js --help`
7. **提交 & 打标签**: `git tag vX.Y.Z && git push --tags`
8. **发布 (npm)**: `cd node && npm publish`

### 发布前检查清单

```bash
cd agent-deploy/node

# 1. 类型检查
npx tsc --noEmit

# 2. 测试
npm test

# 3. Lint
npm run lint

# 4. 构建验证
npm run build
node dist/cli.js deploy --help
node dist/cli.js run --help
```

## 依赖管理 (Node.js)

```
agent-deploy (Node.js)
├── @modelcontextprotocol/sdk   ← MCP 协议
├── @anthropic-ai/sdk           ← Anthropic API
├── @langchain/anthropic        ← LangChain Anthropic
├── @langchain/openai           ← LangChain OpenAI
├── openai                       ← OpenAI API
├── js-yaml                      ← YAML 解析
├── semver                       ← 版本比较
├── tar                          ← tar.gz 处理
├── glob                         ← 文件匹配
└── typescript 5.7+              ← 编译
```

**更新 MCP SDK**:
```bash
cd node && npm update @modelcontextprotocol/sdk
# 检查 API 兼容性
node -e "const { Server } = require('@modelcontextprotocol/sdk/server'); console.log('OK')"
```

## 版本兼容性

| Node.js | TypeScript | 状态 |
|---------|-----------|------|
| 18.x | 5.7+ | 支持 |
| 20.x | 5.7+ | 支持 (推荐) |
| 22.x | 5.7+ | 支持 |

## 排错指南 (Node.js)

### `npm run build` 后模板 JSON 不生效

**原因**: tsc 不会自动复制 `.json` 文件到 `dist/`。

**修复**: 确认 `package.json` build 脚本为：
```json
{
  "scripts": {
    "build": "tsc && cp src/templates/*.json dist/templates/"
  }
}
```

### `Market download failed (HTTP 404)`

**原因**: Market API 返回 404，Agent 不存在或 Market 服务未启动。

**修复**:
1. 检查 Market 服务状态: `curl http://localhost:8321/api/v1/health`
2. 确认 Agent 名称拼写正确: `agent-deploy search "keyword"`
3. 检查 `--market-url` 参数或 `MARKET_URL` 环境变量

### `invoke_agent: Sub-agent directory not found`

**原因**: worker.yaml 中引用的子Agent路径不存在。

**修复**:
1. 确认 agent.json 中 `subagents` 声明了该Agent
2. 路径相对于主 Agent 目录
3. 使用 `list_agents` 工具检查运行时注册的Agent

### `Cannot reach market`

**原因**: 无法连接到 Market API。

**修复**:
1. 检查 Market 是否启动: `curl $MARKET_URL/api/v1/health`
2. 检查默认 Market URL: `http://localhost:8321`
3. 通过 `--market-url` 或 `MARKET_URL` 环境变量覆盖

### `llm_chat: API key not found`

**原因**: LLM 环境变量未设置。

**修复**:
```bash
export ANTHROPIC_API_KEY=sk-xxx
# 或
export ANTHROPIC_AUTH_TOKEN=sk-xxx
# 自定义 endpoint
export ANTHROPIC_BASE_URL=https://custom.example.com
export LLM_MODEL=gpt-4o
```

### `--trusted` 下工具仍被拦截

**原因**: ExecutionContext 中 agent identity 缺失，安全策略判断失败。

**修复**: 
- CLI: 确保 `agent.json` 中有 `identity.name` 字段
- Runtime: 确保创建 context 时同时设置 `name` 和 `identity.name`
- 已修复: Phase 7 bug — cli.ts 和工具文件中 context.agent 路径修正

### Windows 路径问题

**原因**: 使用反斜杠 `\` 路径。

**修复**: 全局使用正斜杠 `/`，使用 `path.resolve()` 规范化。

## 安全注意事项

### Runtime 沙箱
- Agent 默认受限模式，禁止 bash / web_fetch / 跨目录文件操作
- 使用 `--trusted` 标志方可解除限制
- 危险命令 denyList 在信任模式下也生效（rm -rf /, chmod 777, sudo 等）

### 子Agent 信任传播
- invoke_agent 需调用 `PolicyRegistry.propagateTrust(parent, child)`
- 父Agent可信 ≠ 子Agent自动可信，需显式传播

### Market 安全
- API Key SHA-256 哈希存储
- 上传包自动扫描（路径遍历/符号链接/大小）
- 下载包 SHA-256 完整性校验
- Rate Limiting 分层防护

### 文件写入
- `write_file` 默认仅限 Agent 工作目录
- `dry-run` 模式可预览操作而不实际写入

### 网络
- `web_fetch` 内网 IP 硬编码拦截 (127., 10., 172.16-31., 192.168.)
- 仅 `upload_agent` / `download_agent` / `search` / `list_agents(market)` 发起外部请求
