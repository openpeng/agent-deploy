#!/usr/bin/env python3
"""
Install adapted agents into target AI tool directories.

Reads tools-registry.yaml to determine where each tool expects its agents.
Handles project-level and user-level install paths, plus special formats
(Aider CONVENTIONS.md, AGENTS.md, CodeBuddy skills directory).

Usage:
    python install.py --adapted-path <dir> --target <tool> [options]
    python install.py --adapted-content <str> --agent-name <name> --target <tool> [options]

Options:
    --level        project, user, or both (default: both)
    --backup       Backup existing files before overwriting
    --dry-run      Simulate without writing files
    --format json  Output results as JSON
"""

import argparse
import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────
WORKSPACE_ROOT = Path.cwd()
REGISTRY_PATH = Path(__file__).resolve().parent / "tools-registry.yaml"


def load_registry():
    """Load tools-registry.yaml. Returns dict keyed by tool ID."""
    import yaml
    with open(REGISTRY_PATH) as f:
        data = yaml.safe_load(f)
    return data.get("tools", {})



def resolve_path(base: str, agent_name: str, target_dir: str) -> Path:
    """Resolve a target install path.

    - base: 'project' or 'user'
    - target_dir: path template like '.codebuddy/skills/{agent_name}/SKILL.md'
    - Returns absolute Path.
    """
    resolved = target_dir.replace("{agent_name}", agent_name)
    if base == "project":
        return WORKSPACE_ROOT / resolved
    else:  # user
        return Path.home() / resolved


def install_aider(adapted_content: str, agent_name: str, target_path: Path,
                  backup: bool, dry_run: bool, append: bool = False) -> dict:
    """Install to Aider CONVENTIONS.md (append mode)."""
    result = {"tool": "aider", "path": str(target_path), "action": "append" if append else "create", "status": "ok"}
    if dry_run:
        return result

    try:
        if append and target_path.exists():
            if backup:
                shutil.copy2(target_path, str(target_path) + ".bak")
            with open(target_path, "a", encoding="utf-8") as f:
                f.write("\n\n" + adapted_content)
        else:
            if backup and target_path.exists():
                shutil.copy2(target_path, str(target_path) + ".bak")
            target_path.parent.mkdir(parents=True, exist_ok=True)
            with open(target_path, "w", encoding="utf-8") as f:
                f.write(adapted_content)
    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)
    return result


def install_agents_md(adapted_content: str, agent_name: str, target_path: Path,
                      backup: bool, dry_run: bool) -> dict:
    """Install to AGENTS.md (append section)."""
    section_header = f"\n\n<!-- BEGIN AGENT: {agent_name} (via PilotDeck auto-adapter) -->"
    section_footer = f"<!-- END AGENT: {agent_name} -->\n"

    # Check if section already exists; if so, replace it
    full_content = section_header + "\n" + adapted_content + "\n" + section_footer

    result = {"tool": "agents.md", "path": str(target_path), "action": "upsert", "status": "ok"}
    if dry_run:
        return result

    try:
        if target_path.exists():
            if backup:
                shutil.copy2(target_path, str(target_path) + ".bak")
            existing = target_path.read_text(encoding="utf-8")
            # Replace existing section if present
            import re
            pattern = re.compile(
                r"\n*<!-- BEGIN AGENT: " + re.escape(agent_name) + r" .*?END AGENT: "
                + re.escape(agent_name) + r" -->\n*", re.DOTALL
            )
            existing = pattern.sub("", existing)
            existing = existing.rstrip() + full_content
            with open(target_path, "w", encoding="utf-8") as f:
                f.write(existing)
        else:
            target_path.parent.mkdir(parents=True, exist_ok=True)
            with open(target_path, "w", encoding="utf-8") as f:
                f.write(full_content.lstrip())
    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)
    return result


def install_generic(adapted_content: str, agent_name: str, target_path: Path,
                    backup: bool, dry_run: bool) -> dict:
    """Install to a generic file path."""
    result = {"path": str(target_path), "action": "create", "status": "ok"}
    if dry_run:
        return result

    try:
        if backup and target_path.exists():
            shutil.copy2(target_path, str(target_path) + ".bak")
        target_path.parent.mkdir(parents=True, exist_ok=True)
        with open(target_path, "w", encoding="utf-8") as f:
            f.write(adapted_content)
    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)
    return result


def install_agent(adapted_content: str, agent_name: str, target_tool: str,
                  level: str, backup: bool, dry_run: bool) -> list:
    """Install one agent to one target tool at the specified level(s).

    Returns list of result dicts.
    """
    registry = load_registry()
    tool_cfg = registry.get(target_tool)
    if not tool_cfg:
        return [{"tool": target_tool, "status": "error", "error": f"Unknown tool: {target_tool}"}]

    agent_format = tool_cfg.get("agent_format", {})
    results = []

    levels = [level] if level != "both" else ["project", "user"]

    for lvl in levels:
        install_cfg = tool_cfg.get("install", {})
        target_dir = install_cfg.get(lvl, "")

        if target_tool == "aider" and agent_format.get("type") == "conventions":
            rules_dir = install_cfg.get(lvl, "").replace("{agent_name}", agent_name)
            if not rules_dir:
                rules_dir = ".aider/rules"
            if lvl == "project":
                target_path = WORKSPACE_ROOT / rules_dir / f"{agent_name}.md"
            else:
                target_path = Path.home() / rules_dir / f"{agent_name}.md"
            target_path = Path(str(target_path).replace("//", "/"))
            results.append(install_aider(
                adapted_content, agent_name, target_path, backup, dry_run,
                append=False
            ))
            continue

        if target_tool == "agents.md" and agent_format.get("type") == "markdown_section":
            if lvl == "project":
                target_path = WORKSPACE_ROOT / "AGENTS.md"
            else:
                target_path = Path.home() / ".agents" / "AGENTS.md"
            results.append(install_agents_md(
                adapted_content, agent_name, target_path, backup, dry_run
            ))
            continue

        # Generic install — file path from registry
        if target_dir:
            target_path = resolve_path(lvl, agent_name, target_dir)
            if not target_path.suffix:  # directory: append SKILL.md
                target_path = target_path / "SKILL.md"
            res = install_generic(adapted_content, agent_name, target_path, backup, dry_run)
            res["tool"] = target_tool
            res["level"] = lvl
            results.append(res)

    return results


def main():
    parser = argparse.ArgumentParser(description="Install adapted agent into target tool directory")
    parser.add_argument("--adapted-path", type=str, help="Path to adapted agent directory or file")
    parser.add_argument("--adapted-content", type=str, help="Adapted content string (alternative to --adapted-path)")
    parser.add_argument("--agent-name", type=str, required=True, help="Name of the agent")
    parser.add_argument("--target", type=str, required=True, help="Target tool ID (from tools-registry.yaml)")
    parser.add_argument("--level", choices=["project", "user", "both"], default="both",
                        help="Install level (default: both)")
    parser.add_argument("--backup", action="store_true", help="Backup existing files before overwriting")
    parser.add_argument("--dry-run", action="store_true", help="Simulate without writing files")
    parser.add_argument("--format", choices=["text", "json"], default="text",
                        help="Output format (default: text)")
    args = parser.parse_args()

    # Resolve adapted content
    adapted_content = ""
    if args.adapted_content:
        adapted_content = args.adapted_content
    elif args.adapted_path:
        adapted_path = Path(args.adapted_path)
        if adapted_path.is_dir():
            skill_md = adapted_path / "SKILL.md"
            if skill_md.exists():
                adapted_content = skill_md.read_text(encoding="utf-8")
            else:
                # Try agent.md or first .md file
                md_files = list(adapted_path.glob("*.md"))
                if md_files:
                    adapted_content = md_files[0].read_text(encoding="utf-8")
                else:
                    print(f"Error: No markdown file found in {adapted_path}", file=sys.stderr)
                    sys.exit(1)
        elif adapted_path.is_file():
            adapted_content = adapted_path.read_text(encoding="utf-8")
        else:
            print(f"Error: Path not found: {adapted_path}", file=sys.stderr)
            sys.exit(1)
    else:
        print("Error: Must provide --adapted-path or --adapted-content", file=sys.stderr)
        sys.exit(1)

    if not adapted_content.strip():
        print("Error: Adapted content is empty", file=sys.stderr)
        sys.exit(1)

    # Install
    results = install_agent(
        adapted_content, args.agent_name, args.target,
        args.level, args.backup, args.dry_run
    )

    # Output
    if args.format == "json":
        output = {
            "agent_name": args.agent_name,
            "target": args.target,
            "level": args.level,
            "dry_run": args.dry_run,
            "results": results,
        }
        print(json.dumps(output, indent=2, ensure_ascii=False))
    else:
        for r in results:
            status_icon = "✓" if r["status"] == "ok" else "✗"
            extra = f" ({r['level']})" if "level" in r else ""
            if r["status"] == "ok":
                print(f"{status_icon} [{r.get('tool', args.target)}{extra}] {r['action']} → {r['path']}")
            else:
                print(f"{status_icon} [{r.get('tool', args.target)}{extra}] Error: {r.get('error', 'unknown')}")
        if args.dry_run:
            print("\n[Dry-run mode — no files written]")

    # Exit with error if any install failed
    if any(r["status"] == "error" for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
