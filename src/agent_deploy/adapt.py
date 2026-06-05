#!/usr/bin/env python3
"""
Agent adaptation script for auto-adapter.

Converts a PilotDeck market agent (SKILL.md format) into the target AI tool's
native agent format. Reads the PilotDeck SKILL.md, extracts YAML frontmatter
and markdown body, and transforms them to match the target tool's specification.

Usage:
    python adapt.py --agent-path <dir> --target <tool_name> [--output-dir <dir>]
    python adapt.py --agent-path <dir> --target all [--output-dir <dir>]
"""
import argparse
import json
import os
import re
import shutil
import sys
import yaml
from pathlib import Path
from typing import Any, Dict, Optional, Tuple


# ---------------------------------------------------------------------------
# PilotDeck SKILL.md parser
# ---------------------------------------------------------------------------

def parse_skill_md(filepath: Path) -> Dict:
    """Parse a PilotDeck SKILL.md file into its components."""
    if not filepath.exists():
        raise FileNotFoundError(f"SKILL.md not found at {filepath}")

    text = filepath.read_text(encoding="utf-8")

    frontmatter = {}
    body = text

    # Extract YAML frontmatter
    fm_match = re.match(r'^---\s*\n(.*?)\n---\s*\n', text, re.DOTALL)
    if fm_match:
        try:
            frontmatter = yaml.safe_load(fm_match.group(1)) or {}
        except yaml.YAMLError:
            frontmatter = {}
        body = text[fm_match.end():].strip()

    agent_name = frontmatter.get("name", filepath.parent.name)
    description = frontmatter.get("description", "").strip()

    # Extract headings for structure
    sections = _extract_markdown_sections(body)

    return {
        "name": agent_name,
        "description": description,
        "frontmatter": frontmatter,
        "body": body,
        "sections": sections,
    }


def _extract_markdown_sections(md_text: str) -> Dict:
    """Extract sections from markdown by heading."""
    sections = {}
    current_heading = "_intro"
    current_content = []

    for line in md_text.split("\n"):
        heading_match = re.match(r'^##\s+(.+)$', line)
        if heading_match:
            if current_content:
                sections[current_heading] = "\n".join(current_content).strip()
            current_heading = heading_match.group(1).strip().lower().replace(" ", "_")
            current_content = []
        else:
            current_content.append(line)

    if current_content:
        sections[current_heading] = "\n".join(current_content).strip()

    return sections


# ---------------------------------------------------------------------------
# Adapters for each target tool
# ---------------------------------------------------------------------------

def adapt_for_codebuddy(agent: Dict) -> Dict:
    """
    CodeBuddy format: .codebuddy/skills/<name>/SKILL.md
    Same as PilotDeck — YAML frontmatter + markdown body.
    """
    fm = {
        "name": agent["name"],
        "description": agent["description"] or f"Auto-adapted agent: {agent['name']}",
    }
    body = f"""# {agent['name']}

{agent['body']}

---
*Adapted from PilotDeck Market by auto-adapter*
"""
    return {
        "tool": "codebuddy",
        "format": "markdown_yaml_frontmatter",
        "target_dir": f".codebuddy/skills/{agent['name']}/",
        "target_file": "SKILL.md",
        "content": _render_skill_md(fm, body),
    }


def adapt_for_claude_code(agent: Dict) -> Dict:
    """
    Claude Code format: .claude/commands/<name>.md
    Plain markdown file (possibly with YAML frontmatter for skills).
    The file name becomes the /slash-command name.
    """
    body = f"""# {agent['name']}

**Description**: {agent['description']}

{agent['body']}

---
*Adapted from PilotDeck Market by auto-adapter*
"""
    return {
        "tool": "claude_code",
        "format": "markdown_file",
        "target_dir": ".claude/commands/",
        "target_file": f"{agent['name'].replace(' ', '-')}.md",
        "content": body,
    }


def adapt_for_cursor(agent: Dict) -> Dict:
    """
    Cursor format: .cursor/commands/<name>.md
    Plain markdown file for custom slash commands.
    """
    body = f"""# {agent['name']}

{agent['description']}

{agent['body']}
"""
    return {
        "tool": "cursor",
        "format": "markdown_file",
        "target_dir": ".cursor/commands/",
        "target_file": f"{agent['name'].replace(' ', '-')}.md",
        "content": body,
    }


def adapt_for_copilot(agent: Dict) -> Dict:
    """
    GitHub Copilot format: .github/agents/<name>.md
    Plain markdown file.
    """
    body = f"""# Agent: {agent['name']}

{agent['description']}

{agent['body']}
"""
    return {
        "tool": "github_copilot",
        "format": "markdown_file",
        "target_dir": ".github/agents/",
        "target_file": f"{agent['name'].replace(' ', '-')}.md",
        "content": body,
    }


def adapt_for_opencode(agent: Dict) -> Dict:
    """
    OpenCode format: .opencode/commands/<name>.md
    Plain markdown file for custom commands.
    """
    body = f"""# {agent['name']}

{agent['description']}

{agent['body']}
"""
    return {
        "tool": "opencode",
        "format": "markdown_file",
        "target_dir": ".opencode/commands/",
        "target_file": f"{agent['name'].replace(' ', '-')}.md",
        "content": body,
    }


def adapt_for_windsurf(agent: Dict) -> Dict:
    """
    Windsurf format: .windsurf/rules/<name>.md
    Plain markdown file.
    """
    body = f"""# {agent['name']}

{agent['description']}

{agent['body']}
"""
    return {
        "tool": "windsurf",
        "format": "markdown_file",
        "target_dir": ".windsurf/rules/",
        "target_file": f"{agent['name'].replace(' ', '-')}.md",
        "content": body,
    }


def adapt_for_trae(agent: Dict) -> Dict:
    """
    Trae format: .trae/rules/<name>.md
    Plain markdown file.
    """
    body = f"""# {agent['name']}

{agent['description']}

{agent['body']}
"""
    return {
        "tool": "trae",
        "format": "markdown_file",
        "target_dir": ".trae/rules/",
        "target_file": f"{agent['name'].replace(' ', '-')}.md",
        "content": body,
    }


def adapt_for_aider(agent: Dict) -> Dict:
    """
    Aider format: CONVENTIONS.md (appended) or standalone .aider/ file.
    """
    body = f"""## Agent: {agent['name']}

{agent['description']}

{agent['body']}
"""
    return {
        "tool": "aider",
        "format": "conventions_markdown",
        "target_dir": ".",
        "target_file": "CONVENTIONS.md",
        "content": body,
        "notes": "Append to existing CONVENTIONS.md or create new one",
    }


def adapt_for_agents_md(agent: Dict) -> Dict:
    """
    Universal AGENTS.md format: append a section to AGENTS.md in project root.
    Supported by Cursor, Copilot, CodeBuddy, Claude Code, Windsurf, etc.
    """
    section = f"""## Agent: {agent['name']}

**Description**: {agent['description']}

{agent['body']}

"""
    return {
        "tool": "agents_md",
        "format": "markdown_section",
        "target_dir": ".",
        "target_file": "AGENTS.md",
        "content": section,
        "notes": "Append to existing AGENTS.md or create new one. Compatible with all tools that support AGENTS.md.",
    }


# ---------------------------------------------------------------------------
# Adapter registry
# ---------------------------------------------------------------------------

ADAPTERS = {
    "codebuddy": adapt_for_codebuddy,
    "claude_code": adapt_for_claude_code,
    "cursor": adapt_for_cursor,
    "github_copilot": adapt_for_copilot,
    "opencode": adapt_for_opencode,
    "windsurf": adapt_for_windsurf,
    "trae": adapt_for_trae,
    "aider": adapt_for_aider,
    "agents_md": adapt_for_agents_md,
}


def _render_skill_md(frontmatter: Dict, body: str) -> str:
    """Render a SKILL.md file from frontmatter and body."""
    fm_yaml = yaml.dump(frontmatter, allow_unicode=True, default_flow_style=False).strip()
    return f"---\n{fm_yaml}\n---\n\n{body}"


def adapt_agent(agent_path: Path, target: str) -> Optional[Dict]:
    """Adapt a PilotDeck agent to a target tool's format."""
    skill_md = agent_path / "SKILL.md"
    agent_data = parse_skill_md(skill_md)

    if target == "all":
        results = {}
        for tool_name, adapter_fn in ADAPTERS.items():
            results[tool_name] = adapter_fn(agent_data)
        return {"multi": True, "results": results}

    adapter_fn = ADAPTERS.get(target)
    if not adapter_fn:
        print(f"Error: Unknown target tool '{target}'. Available: {', '.join(ADAPTERS.keys())}")
        return None

    return adapter_fn(agent_data)


def write_adapted(adapted: Dict, output_dir: Path):
    """Write adapted agent to the output directory."""
    if adapted.get("multi"):
        for tool_name, result in adapted["results"].items():
            tool_dir = output_dir / tool_name
            tool_dir.mkdir(parents=True, exist_ok=True)
            filepath = tool_dir / result["target_file"]
            filepath.write_text(result["content"], encoding="utf-8")
            print(f"  -> {filepath}")
        return

    filepath = output_dir / adapted["target_file"]
    output_dir.mkdir(parents=True, exist_ok=True)
    filepath.write_text(adapted["content"], encoding="utf-8")
    print(f"  -> {filepath}")


def main():
    parser = argparse.ArgumentParser(description="Adapt PilotDeck agent to target AI tool format")
    parser.add_argument("--agent-path", required=True, help="Path to the agent directory (contains SKILL.md)")
    parser.add_argument("--target", default="all",
                        help=f"Target tool: {', '.join(ADAPTERS.keys())}, or 'all'")
    parser.add_argument("--output-dir", default="auto-adapter-output",
                        help="Output directory for adapted agents")
    parser.add_argument("--format", choices=["json", "files"], default="files",
                        help="Output format: 'json' returns content as JSON, 'files' writes to disk")
    args = parser.parse_args()

    agent_path = Path(args.agent_path).resolve()
    if not agent_path.exists():
        print(f"Error: Agent path not found: {agent_path}")
        sys.exit(1)

    adapted = adapt_agent(agent_path, args.target)
    if adapted is None:
        sys.exit(1)

    if args.format == "json":
        print(json.dumps(adapted, indent=2, ensure_ascii=False))
    else:
        output_dir = Path(args.output_dir).resolve()
        write_adapted(adapted, output_dir)
        print(f"\nAdapted {args.target} to {output_dir}/")


if __name__ == "__main__":
    main()
