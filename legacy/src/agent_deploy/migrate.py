#!/usr/bin/env python3
"""
Agent 迁移工具 - v3.0 到 v3.1 自动迁移

将旧版 Agent 结构迁移到新版 skill.json 格式:
- skills/*/agent.json (type: "skill") -> skills/*/skill.json
- agent.json subagents type: "skill" -> skills 数组
- schema_version: "3.0" -> "3.1"

用法:
    python -m agent_deploy.migrate --from 3.0 --to 3.1 ./my-agent
    python -m agent_deploy.migrate --from 3.0 --to 3.1 ./my-agent --dry-run
"""
import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def load_json(path: Path) -> Dict[str, Any]:
    """加载 JSON 文件"""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: Dict[str, Any]):
    """保存 JSON 文件（保留备份）"""
    # 确保父目录存在
    path.parent.mkdir(parents=True, exist_ok=True)

    # 备份原文件
    backup_path = path.with_suffix(path.suffix + ".backup")
    if path.exists() and not backup_path.exists():
        shutil.copy2(path, backup_path)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def migrate_skill_json(old_skill_json: Dict[str, Any]) -> Dict[str, Any]:
    """将旧版 agent.json (type: "skill") 迁移为 skill.json"""
    identity = old_skill_json.get("identity", old_skill_json)

    # 提取 instructions 内容
    content = ""
    content_info = old_skill_json.get("instructions", {})
    if content_info.get("source") == "inline":
        content = content_info.get("content", "")
    elif content_info.get("source") == "file":
        # 文件引用，保持引用方式
        pass

    # 构建新版 skill.json
    skill_json = {
        "schema_version": "1.0.0",
        "identity": {
            "name": identity.get("name", ""),
            "version": identity.get("version", "1.0.0"),
            "display_name": identity.get("display_name", identity.get("name", "")),
            "description": identity.get("description", ""),
            "author": identity.get("author", ""),
            "license": identity.get("license", "MIT"),
            "tags": identity.get("tags", []),
        },
        "content": old_skill_json.get("instructions", {
            "format": "markdown",
            "source": "file",
            "file": "SKILL.md"
        }),
        "capabilities": old_skill_json.get("capabilities", []),
        "parameters": old_skill_json.get("parameters", {}),
        "scripts": old_skill_json.get("scripts", {}),
    }

    # 如果原文件有 content 字段直接存储内容
    if content:
        skill_json["content"] = {
            "format": "markdown",
            "source": "inline",
            "content": content
        }

    return skill_json


def find_skills_dir(agent_dir: Path) -> Optional[Path]:
    """查找 skills 目录"""
    skills_dir = agent_dir / "skills"
    if skills_dir.exists():
        return skills_dir
    return None


def migrate_agent_json(agent_json: Dict[str, Any], agent_dir: Path) -> Tuple[Dict[str, Any], List[str]]:
    """迁移 agent.json

    Returns:
        (new_agent_json, logs)
    """
    logs = []
    new_agent = dict(agent_json)

    # 更新 schema_version
    old_version = new_agent.get("schema_version", "3.0")
    new_agent["schema_version"] = "3.1"
    logs.append(f"schema_version: {old_version} -> 3.1")

    # 处理 subagents 中的 type: "skill"
    subagents = new_agent.get("subagents", [])
    skills_refs = []
    new_subagents = []

    for sa in subagents:
        if sa.get("type") == "skill":
            # 转换为 skills 数组引用
            skill_name = sa.get("name", "")
            skill_path = sa.get("path", "")

            if skill_name and skill_path:
                skills_refs.append({
                    "name": skill_name,
                    "path": skill_path,
                    "source": "local"
                })
                logs.append(f"subagent '{skill_name}' (type: skill) -> skills[]")
        else:
            new_subagents.append(sa)

    if skills_refs:
        # 添加或合并到 skills 数组
        existing_skills = new_agent.get("skills", [])
        if existing_skills:
            # 合并，避免重复
            existing_names = {s.get("name", "") for s in existing_skills}
            for ref in skills_refs:
                if ref["name"] not in existing_names:
                    existing_skills.append(ref)
                    logs.append(f"Added skill ref: {ref['name']}")
        else:
            new_agent["skills"] = skills_refs

        # 更新 subagents（移除 type: skill 的项）
        new_agent["subagents"] = new_subagents
        if not new_subagents:
            # 如果没有其他 subagents，删除该字段
            del new_agent["subagents"]
            logs.append("Removed empty subagents array")

    return new_agent, logs


def migrate_skills_directory(skills_dir: Path, dry_run: bool = False) -> List[str]:
    """迁移 skills 目录下的所有 skill

    将 skills/<name>/agent.json 重命名为 skills/<name>/skill.json
    """
    logs = []

    if not skills_dir.exists():
        return logs

    for skill_dir in skills_dir.iterdir():
        if not skill_dir.is_dir():
            continue

        old_path = skill_dir / "agent.json"
        new_path = skill_dir / "skill.json"

        if old_path.exists():
            try:
                old_json = load_json(old_path)

                # 检查是否为 type: "skill" 的旧格式
                if old_json.get("type") == "skill" or old_json.get("schema_version", "").startswith("3."):
                    new_json = migrate_skill_json(old_json)

                    if dry_run:
                        logs.append(f"[DRY-RUN] Would migrate: {old_path} -> {new_path}")
                    else:
                        # 保存新的 skill.json
                        save_json(new_path, new_json)
                        logs.append(f"Migrated: {old_path} -> {new_path}")

                        # 可选：删除旧的 agent.json（保留备份）
                        backup_path = old_path.with_suffix(".json.backup")
                        if backup_path.exists():
                            old_path.unlink()
                            logs.append(f"Removed old file: {old_path}")

            except (json.JSONDecodeError, IOError) as e:
                logs.append(f"Error processing {old_path}: {e}")

    return logs


def migrate_agent(agent_dir: str, dry_run: bool = False) -> Dict[str, Any]:
    """迁移整个 Agent 目录

    Returns:
        {"success": bool, "logs": List[str], "changes": List[str]}
    """
    agent_dir = Path(agent_dir).resolve()
    logs = []
    changes = []

    if not agent_dir.exists():
        return {"success": False, "logs": [f"Directory not found: {agent_dir}"], "changes": []}

    # 1. 迁移 skills 目录下的 agent.json -> skill.json
    skills_dir = find_skills_dir(agent_dir)
    if skills_dir:
        skill_logs = migrate_skills_directory(skills_dir, dry_run=dry_run)
        logs.extend(skill_logs)
        changes.extend([l for l in skill_logs if "Migrated:" in l or "[DRY-RUN]" in l])

    # 2. 迁移根目录的 agent.json
    agent_json_path = agent_dir / "agent.json"
    if agent_json_path.exists():
        try:
            agent_json = load_json(agent_json_path)
            old_version = agent_json.get("schema_version", "3.0")

            if old_version.startswith("3.0") or old_version.startswith("2."):
                new_agent_json, agent_logs = migrate_agent_json(agent_json, agent_dir)
                logs.extend(agent_logs)
                changes.extend(agent_logs)

                if dry_run:
                    logs.append(f"[DRY-RUN] Would update: {agent_json_path}")
                else:
                    save_json(agent_json_path, new_agent_json)
                    logs.append(f"Updated: {agent_json_path}")
            else:
                logs.append(f"Agent already at version {old_version}, skipping")

        except (json.JSONDecodeError, IOError) as e:
            logs.append(f"Error processing {agent_json_path}: {e}")
    else:
        logs.append(f"agent.json not found in {agent_dir}")

    return {
        "success": len([l for l in logs if l.startswith("Error")]) == 0,
        "logs": logs,
        "changes": changes,
        "dry_run": dry_run,
    }


def main():
    parser = argparse.ArgumentParser(
        prog="agent-deploy migrate",
        description="Migrate Agent from v3.0 to v3.1 format",
    )
    parser.add_argument("--from", dest="from_version", default="3.0", help="Source version")
    parser.add_argument("--to", dest="to_version", default="3.1", help="Target version")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without applying")
    parser.add_argument("agent_dir", help="Path to agent directory")

    args = parser.parse_args()

    print(f"Migrating Agent: {args.agent_dir}")
    print(f"Version: {args.from_version} -> {args.to_version}")
    if args.dry_run:
        print("Mode: DRY-RUN (no changes will be made)")
    print()

    result = migrate_agent(args.agent_dir, dry_run=args.dry_run)

    for log in result["logs"]:
        print(f"  {log}")

    print()
    if result["success"]:
        print(f"Migration completed successfully ({len(result['changes'])} changes)")
    else:
        print("Migration completed with errors")
        sys.exit(1)


if __name__ == "__main__":
    main()
