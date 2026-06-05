# agent-deploy — 维护手册

## 发布清单

每次发布新版本时按此清单操作：

1. **更新版本号**：修改 `pyproject.toml` 中的 `version` 字段
2. **更新 CHANGELOG**：记录本次变更
3. **运行全部测试**：`pytest tests/ -v`，确保全部通过
4. **运行类型检查**：`mypy src/`
5. **构建**：`python -m build`
6. **本地安装验证**：`pip install dist/agent_deploy-*.whl && agent-deploy --help`
7. **提交 & 打标签**：`git tag vX.Y.Z && git push --tags`
8. **发布**：`twine upload dist/*`（如有 PyPI 发布流程）

## 依赖管理

```
agent-deploy
├── mcp>=1.0                ← MCP 协议库（当前使用 1.27.2）
├── pyyaml>=6.0            ← tools-registry.yaml 解析
├── detect.py (auto-adapter) ← 工具检测
├── adapt.py (auto-adapter)  ← 格式适配
├── install.py (auto-adapter)← 文件安装
└── tools-registry.yaml      ← 工具注册表
```

**更新 mcp 包**：

```bash
pip install --upgrade 'mcp>=1.0'
# 检查 API 兼容性
python -c "from mcp.server import Server; from mcp.server.stdio import stdio_server; print('OK')"
```

**更新 PyYAML**：

```bash
pip install --upgrade 'pyyaml>=6.0'
```

## 版本兼容性

| Python 版本 | mcp 版本 | 状态 |
|------------|---------|------|
| 3.10 | 1.x | 支持 |
| 3.11 | 1.x | 支持 |
| 3.12 | 1.x | 支持 |
| 3.13 | 1.27+ | 支持 |

## 排错指南

### `ModuleNotFoundError: No module named 'detect'`

**原因**：`sys.path` 引导失败，找不到 `auto-adapter/scripts/` 目录。

**修复**：
1. 确认目录结构：`ls skills/auto-adapter/scripts/detect.py` 必须存在
2. 确认 `PYTHONPATH` 设置：MCP 配置中的 `cwd` 应为 `skills/agent-deploy/`
3. 手动测试路径引导：
   ```python
   from pathlib import Path
   p = Path("src/agent_deploy/server.py").resolve()
   print(p.parents[4] / "skills" / "auto-adapter" / "scripts")
   ```

### `Market download failed (HTTP 404)`

**原因**：Market API 返回 404，Agent ID 不存在或 Market 服务未启动。

**修复**：
1. 检查 `MARKET_API_URL` 环境变量是否正确
2. 确认 Market 服务正在运行：`curl $MARKET_API_URL/api/v1/agents/`
3. 确认 Agent ID 拼写正确
4. 作为替代方案，先用本地路径部署：提供 `agent_path` 参数

### `Cannot reach market at ...`

**原因**：无法连接到 Market API 服务器。

**修复**：
1. 检查 Market 服务是否启动：`curl $MARKET_API_URL/api/v1/health`
2. 检查网络/防火墙
3. 设置 `MARKET_API_URL` 为正确的地址

### `SKILL.md not found in ...`

**原因**：指定的 Agent 目录中没有 `SKILL.md`。

**修复**：
1. 检查路径是否正确：`ls <agent_path>/SKILL.md`
2. Market 下载的 Agent 如果是非标准结构，检查解压后的目录层级
3. 可以通过 `agent_path` 直接指向 `SKILL.md` 文件本身

### `adapt_agent returned None`

**原因**：目标工具在 `ADAPTERS` 字典中不存在或适配函数返回了 `None`。

**修复**：
1. 检查 `target_tool` 拼写
2. 运行 `_supported_target_tools()` 查看当前支持的工具列表
3. 检查 `skills/auto-adapter/scripts/adapt.py` 中的 `ADAPTERS` 字典

## Registry 更新流程

`tools-registry.yaml` 是关键配置文件，修改时需要特别小心：

1. **备份**：修改前先备份 `cp tools-registry.yaml tools-registry.yaml.bak`
2. **验证 YAML 语法**：`python -c "import yaml; yaml.safe_load(open('skills/auto-adapter/config/tools-registry.yaml'))"`
3. **验证工具 ID 一致性**：新工具的 key 必须在 `adapt.py` 的 `ADAPTERS` 中也有对应条目
4. **验证 install 块**：确保 `project_level` 和 `user_level` 字段存在（server.py 会自动映射为 `project` / `user`）
5. **运行测试**：`pytest tests/ -v`，确认 Registry 加载测试通过
6. **提交变更**：在 commit message 中注明改了哪个工具

## 安全注意事项

### 路径访问

- `server.py` 通过 `Path.resolve()` 解析所有输入的路径
- `deploy_agent` 使用 `tempfile.TemporaryDirectory` 存放下载的 Agent，完成后自动清理
- 安装路径限制在项目目录和用户 home 目录下的工具特定子目录（如 `.cursor/commands/`）

### 输入验证

- `target_tool` 参数有严格的 enum 校验（`SCHEMA_DEPLOY_AGENT` 中的 `enum` 列表）
- `level` 参数限制为 `project` / `user` / `both`
- `agent_id` 通过 URL 拼接传递给 Market API — Market 服务端负责防止路径遍历
- `agent_path` 会被验证存在且包含 `SKILL.md`

### 网络

- 只有 `deploy_agent` 工具会发起网络请求（从 Market 下载）
- 请求目标由 `MARKET_API_URL` 环境变量控制，默认 `http://localhost:8321`
- 使用标准库 `urllib`，不依赖第三方 HTTP 客户端

### 文件写入

- `install.py` 在写入前会检查目标路径是否在允许的目录范围内
- `dry_run=True` 可预览将要创建的文件而不实际写入
- `backup=True` 会在覆盖前备份已有文件
