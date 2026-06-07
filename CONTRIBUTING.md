# 贡献指南

感谢你对 Agent Deploy 的关注！我们欢迎各种形式的贡献。

---

## 📋 目录

- [开发环境设置](#开发环境设置)
- [项目结构](#项目结构)
- [贡献流程](#贡献流程)
- [编码规范](#编码规范)
- [测试指南](#测试指南)
- [提交 Pull Request](#提交-pull-request)
- [报告问题](#报告问题)

---

## 🛠️ 开发环境设置

### 前置要求

- Node.js 18+ 或 Python 3.8+
- Git
- npm 或 pnpm（Node 版本）
- pip（Python 版本）

### 克隆仓库

```bash
git clone https://github.com/openpeng/agent-deploy.git
cd agent-deploy
```

### Node.js 版本设置

```bash
cd node
npm install
npm run build
npm test
```

### Python 版本设置

```bash
cd python
pip install -e ".[dev]"
pytest
```

---

## 📁 项目结构

```
agent-deploy/
├── node/                      # Node.js 实现
│   ├── src/
│   │   ├── adapt.ts          # Export 适配器
│   │   ├── import.ts         # Import 框架
│   │   ├── market.ts         # Market 集成
│   │   ├── cli.ts            # CLI 命令
│   │   ├── index.ts          # MCP Server
│   │   └── adapters/         # 平台适配器
│   │       ├── cursor-import.ts
│   │       ├── claude-import.ts
│   │       ├── codebuddy-import.ts
│   │       └── github-import.ts
│   ├── test/                 # 测试文件
│   └── package.json
│
├── python/                    # Python 实现
│   ├── src/agent_deploy/
│   └── tests/
│
└── docs/                      # 文档
    ├── specs/                # 规范文档
    └── guides/               # 使用指南
```

---

## 🔄 贡献流程

### 1. Fork 仓库

点击 GitHub 页面右上角的 "Fork" 按钮。

### 2. 创建分支

```bash
git checkout -b feature/my-new-feature
# 或
git checkout -b fix/issue-123
```

**分支命名规范**:
- `feature/` - 新功能
- `fix/` - Bug 修复
- `docs/` - 文档更新
- `refactor/` - 代码重构
- `test/` - 测试相关

### 3. 编写代码

遵循[编码规范](#编码规范)编写代码。

### 4. 运行测试

```bash
# Node.js
npm test

# Python
pytest
```

### 5. 提交代码

```bash
git add .
git commit -m "feat: add new feature"
```

**提交信息规范** (遵循 Conventional Commits):
- `feat:` - 新功能
- `fix:` - Bug 修复
- `docs:` - 文档更新
- `style:` - 代码格式（不影响功能）
- `refactor:` - 重构
- `test:` - 测试相关
- `chore:` - 构建/工具链

### 6. 推送分支

```bash
git push origin feature/my-new-feature
```

### 7. 创建 Pull Request

在 GitHub 上创建 Pull Request。

---

## 📝 编码规范

### TypeScript/JavaScript

**风格**:
- 使用 TypeScript 严格模式
- 2 空格缩进
- 单引号字符串
- 结尾加分号
- 驼峰命名（camelCase）

**示例**:
```typescript
// ✅ Good
export function adaptAgent(agent: AgentJsonV2, target: string): string {
  const adapter = getAdapter(target);
  return adapter.adapt(agent);
}

// ❌ Bad
export function adapt_agent(agent, target) {
  let adapter = getAdapter(target)
  return adapter.adapt(agent)
}
```

**类型定义**:
```typescript
// ✅ Good - 明确的类型定义
interface ImportOptions {
  sourcePath: string;
  outputDir?: string;
  dryRun?: boolean;
}

// ❌ Bad - 缺少类型
function importAgent(options) {
  // ...
}
```

### 错误处理

```typescript
// ✅ Good - 友好的错误信息
if (!existsSync(agentJsonPath)) {
  throw new Error(
    `Agent directory must contain agent.json: ${agentJsonPath}\n` +
    `Please run 'agent-deploy import' first to generate agent.json`
  );
}

// ❌ Bad - 简陋的错误信息
if (!existsSync(agentJsonPath)) {
  throw new Error("File not found");
}
```

### 文档注释

```typescript
/**
 * Import an agent from AI tool format to agent.json
 * 
 * @param sourcePath - Path to the source file (e.g., .cursor/commands/agent.md)
 * @param outputDir - Output directory for agent.json (default: ./imported-agents)
 * @param dryRun - Preview mode, don't write files
 * @returns Import result with agent path and metadata
 * 
 * @example
 * ```typescript
 * const result = await importAgent({
 *   sourcePath: '.cursor/commands/my-agent.md',
 *   outputDir: './agents'
 * });
 * ```
 */
export async function importAgent(options: ImportOptions): Promise<ImportResult> {
  // ...
}
```

---

## 🧪 测试指南

### 编写测试

**测试文件命名**:
- 单元测试: `*.test.ts`
- 集成测试: `*.integration.test.ts`

**测试结构**:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert";

describe("ImportAdapter", () => {
  describe("CursorImportAdapter", () => {
    it("should detect Cursor command files", () => {
      const adapter = new CursorImportAdapter();
      const result = adapter.canImport(".cursor/commands/test.md");
      assert.strictEqual(result, true);
    });

    it("should import agent with correct metadata", () => {
      const adapter = new CursorImportAdapter();
      const agent = adapter.importFrom("./test/fixtures/cursor-agent.md");
      
      assert.strictEqual(agent.schema_version, "2.0");
      assert.strictEqual(agent.identity.name, "test-agent");
      assert.ok(agent.instructions.content);
    });
  });
});
```

### 测试覆盖

确保新功能有对应的测试：

```bash
# 运行所有测试
npm test

# 查看覆盖率（如果配置）
npm run test:coverage
```

### 测试最佳实践

1. **测试命名清晰**: 描述测试的行为和预期结果
2. **独立性**: 每个测试应该独立运行
3. **边界条件**: 测试正常情况和异常情况
4. **使用 fixtures**: 为测试准备固定的输入数据

```typescript
// ✅ Good - 清晰的测试描述
it("should throw error when agent.json is missing", () => {
  assert.throws(() => {
    uploadAgent({ agentDir: "./non-existent" });
  }, /agent\.json/);
});

// ❌ Bad - 模糊的测试描述
it("test upload", () => {
  // ...
});
```

---

## 🔧 添加新的平台适配器

### Export 适配器

1. 在 `src/adapt.ts` 中添加平台定义：

```typescript
export const TOOLS = {
  // ... 现有工具
  new_tool: {
    name: "New Tool",
    adapter: adaptToNewTool,
    defaultDir: {
      user: "~/.newtool/agents",
      project: ".newtool/agents"
    }
  }
} as const;
```

2. 实现适配函数：

```typescript
function adaptToNewTool(agent: AgentJsonV2): string {
  // 转换 agent.json 为目标格式
  const content = `
# ${agent.identity.display_name}

${agent.identity.description}

${agent.instructions.content}
  `.trim();

  return content;
}
```

3. 添加测试：

```typescript
describe("adaptToNewTool", () => {
  it("should convert agent.json to New Tool format", () => {
    const agent = createTestAgent();
    const result = adaptToNewTool(agent);
    
    assert.ok(result.includes(agent.identity.display_name));
    assert.ok(result.includes(agent.identity.description));
  });
});
```

### Import 适配器

1. 创建适配器文件 `src/adapters/newtool-import.ts`:

```typescript
import type { ImportAdapter } from "../import.js";
import type { AgentJsonV2 } from "../types.js";

export class NewToolImportAdapter implements ImportAdapter {
  canImport(sourcePath: string): boolean {
    // 检测是否为该工具的文件格式
    return sourcePath.includes(".newtool/agents");
  }

  importFrom(sourcePath: string): AgentJsonV2 {
    // 读取并解析文件
    // 转换为 agent.json 格式
    return agentJson;
  }

  getToolInfo() {
    return {
      name: "new_tool",
      pattern: ".newtool/agents/*.md",
      description: "Import agents from New Tool"
    };
  }
}
```

2. 在 `src/import.ts` 中注册适配器：

```typescript
import { NewToolImportAdapter } from "./adapters/newtool-import.js";

export const IMPORT_ADAPTERS: ImportAdapter[] = [
  // ... 现有适配器
  new NewToolImportAdapter()
];
```

3. 添加测试 fixtures 和测试用例。

---

## 📤 提交 Pull Request

### PR 检查清单

提交前确保：

- [ ] 代码遵循项目编码规范
- [ ] 所有测试通过 (`npm test`)
- [ ] 添加了新功能的测试
- [ ] 更新了相关文档
- [ ] 提交信息遵循 Conventional Commits
- [ ] 没有引入不必要的依赖

### PR 描述模板

```markdown
## 变更类型
- [ ] 新功能
- [ ] Bug 修复
- [ ] 文档更新
- [ ] 重构
- [ ] 其他

## 变更描述
简要描述你的变更内容和原因。

## 相关 Issue
Fixes #123

## 测试
描述你如何测试这些变更。

## 截图（如适用）
添加截图帮助解释变更。

## 检查清单
- [ ] 代码遵循项目规范
- [ ] 所有测试通过
- [ ] 添加了新测试
- [ ] 更新了文档
```

### Code Review

- 耐心等待 maintainer 的 review
- 及时回应 review 意见
- 必要时更新代码

---

## 🐛 报告问题

### Issue 类型

- **Bug Report** - 报告软件缺陷
- **Feature Request** - 建议新功能
- **Documentation** - 文档问题
- **Question** - 使用问题

### Bug Report 模板

```markdown
## 问题描述
清晰简洁地描述问题。

## 重现步骤
1. 执行 '...'
2. 输入 '...'
3. 看到错误

## 期望行为
描述你期望发生什么。

## 实际行为
描述实际发生了什么。

## 环境信息
- OS: [e.g., Windows 10, macOS 12]
- Node.js: [e.g., 18.0.0]
- Agent Deploy: [e.g., 1.0.0]

## 附加信息
添加任何其他有助于解决问题的信息。
```

---

## 💬 交流渠道

- **GitHub Issues** - 问题报告和功能建议
- **GitHub Discussions** - 技术讨论和问答
- **Pull Requests** - 代码贡献

---

## 📜 许可证

贡献代码时，你同意你的代码将采用与项目相同的许可证发布。

---

## 🙏 感谢

感谢所有贡献者的付出！每一个 PR、Issue、建议都对项目的改进有重要意义。

---

**Happy Contributing!** 🎉
