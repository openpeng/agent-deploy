# agent-deploy — 开发者文档

## 架构概览

```
┌─────────────────────────────────┐
│   MCP Client (Claude/Cursor)    │  ← 发送 JSON-RPC 请求
└──────────────┬──────────────────┘
               ↕ stdio / JSON-RPC
┌──────────────┴──────────────────┐
│   server.py (MCP Server)        │  ← 4 个 tool handler
│   src/agent_deploy/server.py    │
└──────────────┬──────────────────┘
               ↕ Python `import`
┌──────────────┴──────────────────┐
│   auto-adapter 脚本              │
│   detect.py / adapt.py /        │
│   install.py                    │
└──────────────┬──────────────────┘
               ↕ I/O
┌──────────────┴──────────────────┐
│   tools-registry.yaml           │
│   目标工具配置目录               │
│   (.cursor/, .claude/, ...)     │
└─────────────────────────────────┘
```

## 桥接机制

`server.py` 通过以下方式桥接到 `auto-adapter` 脚本：

### 路径引导

```python
THIS_FILE = Path(__file__).resolve()
WORKSPACE_ROOT = THIS_FILE.parents[4]  # src/agent_deploy → workspace root
AUTO_ADAPTER_SCRIPTS = WORKSPACE_ROOT / "skills" / "auto-adapter" / "scripts"
sys.path.insert(0, str(AUTO_ADAPTER_SCRIPTS))
```

这允许 `from detect import detect_all` 直接从脚本文件导入，而不需要将 `auto-adapter` 作为正式 Python 包安装。

### Registry 键名修补

`tools-registry.yaml` 使用 `project_level` / `user_level` 作为 install 块的键名，但 `install.py` 期望 `project` / `user`。`server.py` 中的 `_patched_load_registry()` 在内存中重写这些键，确保两边的代码都不需要修改。

```python
def _patched_load_registry() -> Dict[str, Any]:
    data = _load_registry()
    for _tool_key, tool_cfg in data.get("tools", {}).items():
        install_cfg = tool_cfg.get("install") or {}
        if "project_level" in install_cfg and "project" not in install_cfg:
            install_cfg["project"] = install_cfg["project_level"]
        if "user_level" in install_cfg and "user" not in install_cfg:
            install_cfg["user"] = install_cfg["user_level"]
        tool_cfg["install"] = install_cfg
    return data
```

在 `_tool_install_agent` 和 `_tool_deploy_agent` 中，我们临时 monkey-patch `install.load_registry`：

```python
import install as _install_mod
_original_load_registry = _install_mod.load_registry
_install_mod.load_registry = _patched_load_registry
try:
    results = install_agent(...)
finally:
    _install_mod.load_registry = _original_load_registry
```

## 添加新的 MCP 工具

1. 在 `server.py` 顶部定义 JSON Schema：

```python
SCHEMA_MY_TOOL: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "my_param": {"type": "string", "description": "..."},
    },
    "required": ["my_param"],
    "additionalProperties": False,
}
```

2. 在 `handle_list_tools()` 中注册：

```python
Tool(name="my_tool", description="...", inputSchema=SCHEMA_MY_TOOL),
```

3. 实现 handler 函数：

```python
def _tool_my_tool(args: Dict[str, Any]) -> Dict[str, Any]:
    # 业务逻辑
    return {"result": "ok"}
```

4. 在 `handle_call_tool()` 的 dispatch 分支中添加：

```python
elif name == "my_tool":
    result = _tool_my_tool(arguments or {})
```

## 添加新的目标工具

分两步：

### 1. 注册（tools-registry.yaml）

在 `skills/auto-adapter/config/tools-registry.yaml` 的 `tools:` 下添加新条目，包含 `detection`、`agent_format`、`install` 三个必需块。参考已有的条目（如 `cursor`）作为模板。

### 2. 适配器（adapt.py）

在 `skills/auto-adapter/scripts/adapt.py` 的 `ADAPTERS` 字典中注册一个函数：

```python
def _adapt_for_my_tool(agent_path: Path) -> Dict[str, Any]:
    skill_md = (agent_path / "SKILL.md").read_text()
    frontmatter, body = _parse_skill(skill_md)
    return {
        "content": body,
        "path": f".mytool/commands/{agent_path.name}.md",
        "tool": "my_tool",
    }

ADAPTERS["my_tool"] = _adapt_for_my_tool
```

## 测试

### 运行单元测试

```bash
cd skills/agent-deploy
pip install -e ".[dev]"
pytest tests/ -v
```

当前测试覆盖：
- Server 模块导入
- 4 个工具 handler 的 smoke test（参数校验）
- Registry patching 正确性
- Target selection 逻辑

### 手动冒烟测试

```bash
# 启动 MCP server（在 stdio 模式下）
python -m agent_deploy.server

# 或用 mcp CLI 工具测试
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python -m agent_deploy.server
```

### 端到端测试

```bash
# 用一个本地 Agent 目录测试完整流程
python -c "
from agent_deploy.server import _tool_list_installed_tools, _tool_deploy_agent
print(_tool_list_installed_tools({}))
print(_tool_deploy_agent({'agent_path': '/tmp/test-agent', 'dry_run': True}))
"
```

## 代码风格

- **类型注解**：所有函数签名使用 `from __future__ import annotations` + 完整的类型注解
- **导入顺序**：标准库 → 第三方 → 本地，路径引导后的导入用 `# noqa: E402` 标注
- **错误处理**：tool handler 内不吞异常；所有异常在 `handle_call_tool` 的 dispatch 层统一捕获并返回结构化错误
- **工具函数**：handler 为同步函数（非 async），因为在 MCP server 的 async 上下文中通过 `asyncio.to_thread` 运行
- **临时文件**：`deploy_agent` 中 Market 下载使用 `tempfile.TemporaryDirectory`，在 finally 中清理
