#!/usr/bin/env python3
"""
Agent adaptation script - REFACTORED to use agent.json as primary source.

Converts a PilotDeck market agent into the target AI tool's native format.
Now prioritizes agent.json with instructions field, falls back to SKILL.md
for backward compatibility.

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
# Agent Descriptor - Unified internal format
# ---------------------------------------------------------------------------

class AgentDescriptor:
    """Unified agent representation from agent.json or SKILL.md."""

    def __init__(self, name: str, display_name: str, version: str,
                 description: str, instructions: str, capabilities: list = None,
                 compatibility: dict = None, metadata: dict = None):
        self.name = name
        self.display_name = display_name
        self.version = version
        self.description = description
        self.instructions = instructions
        self.capabilities = capabilities or []
        self.compatibility = compatibility or {}
        self.metadata = metadata or {}

    def to_dict(self) -> Dict:
        return {
            "name": self.name,
            "display_name": self.display_name,
            "version": self.version,
            "description": self.description,
            "instructions": self.instructions,
            "capabilities": self.capabilities,
            "compatibility": self.compatibility,
            "metadata": self.metadata,
        }


# ---------------------------------------------------------------------------
# Agent.json parser (NEW - Primary)
# ---------------------------------------------------------------------------

def load_agent_descriptor(agent_path: Path) -> AgentDescriptor:
    """Load agent from agent.json (primary) or SKILL.md (fallback).

    Priority:
    1. agent.json with instructions field
    2. agent.json + external instruction file
    3. SKILL.md (deprecated, backward compatibility)
    """
    agent_json_path = agent_path / "agent.json"
    skill_md_path = agent_path / "SKILL.md"

    # Try agent.json first
    if agent_json_path.exists():
        try:
            agent_json = json.loads(agent_json_path.read_text(encoding="utf-8"))
            return _parse_agent_json(agent_json, agent_path)
        except Exception as e:
            print(f"Warning: Failed to parse agent.json: {e}", file=sys.stderr)
            print(f"Falling back to SKILL.md...", file=sys.stderr)

    # Fallback to SKILL.md
    if skill_md_path.exists():
        print(f"[DEPRECATED] Using SKILL.md as fallback. "
              f"Consider migrating to agent.json with instructions field.",
              file=sys.stderr)
        return _parse_skill_md(skill_md_path)

    raise FileNotFoundError(
        f"No agent.json or SKILL.md found in {agent_path}. "
        f"Agent directory must contain at least one of these files."
    )


def _parse_agent_json(agent_json: Dict, agent_path: Path) -> AgentDescriptor:
    """Parse agent.json into AgentDescriptor."""

    # Support both new (identity) and old (flat) format
    identity = agent_json.get("identity", agent_json)

    name = identity.get("name", agent_path.name)
    display_name = identity.get("display_name", name)
    version = identity.get("version", "1.0.0")
    description = identity.get("description", "")

    # Extract instructions (CORE CHANGE)
    instructions = ""

    if "instructions" in agent_json:
        inst = agent_json["instructions"]

        if inst.get("source") == "inline":
            instructions = inst.get("content", "")

        elif inst.get("source") == "file":
            inst_file = inst.get("file", "")
            if inst_file:
                inst_path = agent_path / inst_file
                if inst_path.exists():
                    instructions = inst_path.read_text(encoding="utf-8")
                else:
                    print(f"Warning: instruction file not found: {inst_path}", file=sys.stderr)

    # Fallback to SKILL.md if no instructions in agent.json
    if not instructions:
        skill_md_path = agent_path / "SKILL.md"
        if skill_md_path.exists():
            print(f"[DEPRECATED] agent.json found but no instructions field. "
                  f"Falling back to SKILL.md.", file=sys.stderr)
            instructions = skill_md_path.read_text(encoding="utf-8")
            # Strip YAML frontmatter for cleaner output
            instructions = _strip_frontmatter(instructions)

    if not instructions:
        raise ValueError(
            f"No instructions found in agent.json or SKILL.md. "
            f"Add 'instructions' field to agent.json or create SKILL.md."
        )

    capabilities = agent_json.get("capabilities", [])
    compatibility = agent_json.get("compatibility", {})

    metadata = {
        "schema_version": agent_json.get("schema_version", "1.0"),
        "author": identity.get("author", ""),
        "license": identity.get("license", "MIT"),
    }

    return AgentDescriptor(
        name=name,
        display_name=display_name,
        version=version,
        description=description,
        instructions=instructions,
        capabilities=capabilities,
        compatibility=compatibility,
        metadata=metadata,
    )


def _strip_frontmatter(text: str) -> str:
    """Remove YAML frontmatter from markdown."""
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n', text, re.DOTALL)
    if match:
        return text[match.end():].strip()
    return text


# ---------------------------------------------------------------------------
# SKILL.md parser (LEGACY - Backward compatibility)
# ---------------------------------------------------------------------------

def _parse_skill_md(filepath: Path) -> AgentDescriptor:
    """Parse a PilotDeck SKILL.md file (legacy format)."""
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

    name = frontmatter.get("name", filepath.parent.name)
    description = frontmatter.get("description", "").strip()

    return AgentDescriptor(
        name=name,
        display_name=frontmatter.get("display_name", name),
        version=frontmatter.get("version", "1.0.0"),
        description=description,
        instructions=body,  # Full markdown body
        capabilities=[],
        compatibility={},
        metadata={"source": "skill_md", "frontmatter": frontmatter},
    )


# ---------------------------------------------------------------------------
# Adapters for each target tool - Now using AgentDescriptor
# ---------------------------------------------------------------------------

def adapt_for_codebuddy(descriptor: AgentDescriptor) -> Dict:
    """
    CodeBuddy format: .codebuddy/skills/<name>/SKILL.md
    YAML frontmatter + markdown body.
    """
    fm = {
        "name": descriptor.name,
        "description": descriptor.description or f"Auto-adapted agent: {descriptor.name}",
        "version": descriptor.version,
    }
    body = f"""# {descriptor.display_name}

{descriptor.instructions}

---
*Adapted from PilotDeck Market by agent-deploy v2.0*
"""
    return {
        "tool": "codebuddy",
        "format": "markdown_yaml_frontmatter",
        "target_dir": f".codebuddy/skills/{descriptor.name}/",
        "target_file": "SKILL.md",
        "content": _render_skill_md(fm, body),
    }


def adapt_for_codebuddy_agent(descriptor: AgentDescriptor) -> Dict:
    """
    CodeBuddy Agent format: .codebuddy/agents/<name>.md
    Plain markdown file (NEW - added per user request).
    """
    body = f"""# {descriptor.display_name}

**Version**: {descriptor.version}
**Description**: {descriptor.description}

{descriptor.instructions}

---
*Adapted from PilotDeck Market by agent-deploy v2.0*
"""
    return {
        "tool": "codebuddy_agent",
        "format": "markdown_file",
        "target_dir": ".codebuddy/agents/",
        "target_file": f"{descriptor.name.replace(' ', '-')}.md",
        "content": body,
    }


def adapt_for_claude_code(descriptor: AgentDescriptor) -> Dict:
    """
    Claude Code format: .claude/commands/<name>.md
    Plain markdown file.
    """
    body = f"""# {descriptor.display_name}

**Description**: {descriptor.description}

{descriptor.instructions}

---
*Adapted from PilotDeck Market by agent-deploy v2.0*
"""
    return {
        "tool": "claude_code",
        "format": "markdown_file",
        "target_dir": ".claude/commands/",
        "target_file": f"{descriptor.name.replace(' ', '-')}.md",
        "content": body,
    }


def adapt_for_cursor(descriptor: AgentDescriptor) -> Dict:
    """
    Cursor format: .cursor/commands/<name>.md
    Plain markdown file for custom slash commands.
    """
    body = f"""# {descriptor.display_name}

{descriptor.description}

{descriptor.instructions}
"""
    return {
        "tool": "cursor",
        "format": "markdown_file",
        "target_dir": ".cursor/commands/",
        "target_file": f"{descriptor.name.replace(' ', '-')}.md",
        "content": body,
    }


def adapt_for_copilot(descriptor: AgentDescriptor) -> Dict:
    """
    GitHub Copilot format: .github/agents/<name>.md
    Plain markdown file.
    """
    body = f"""# Agent: {descriptor.display_name}

{descriptor.description}

{descriptor.instructions}
"""
    return {
        "tool": "github_copilot",
        "format": "markdown_file",
        "target_dir": ".github/agents/",
        "target_file": f"{descriptor.name.replace(' ', '-')}.md",
        "content": body,
    }


def adapt_for_opencode(descriptor: AgentDescriptor) -> Dict:
    """
    OpenCode format: .opencode/commands/<name>.md
    Plain markdown file for custom commands.
    """
    body = f"""# {descriptor.display_name}

{descriptor.description}

{descriptor.instructions}
"""
    return {
        "tool": "opencode",
        "format": "markdown_file",
        "target_dir": ".opencode/commands/",
        "target_file": f"{descriptor.name.replace(' ', '-')}.md",
        "content": body,
    }


def adapt_for_windsurf(descriptor: AgentDescriptor) -> Dict:
    """
    Windsurf format: .windsurf/rules/<name>.md
    Plain markdown file.
    """
    body = f"""# {descriptor.display_name}

{descriptor.description}

{descriptor.instructions}
"""
    return {
        "tool": "windsurf",
        "format": "markdown_file",
        "target_dir": ".windsurf/rules/",
        "target_file": f"{descriptor.name.replace(' ', '-')}.md",
        "content": body,
    }


def adapt_for_trae(descriptor: AgentDescriptor) -> Dict:
    """
    Trae format: .trae/rules/<name>.md
    Plain markdown file.
    """
    body = f"""# {descriptor.display_name}

{descriptor.description}

{descriptor.instructions}
"""
    return {
        "tool": "trae",
        "format": "markdown_file",
        "target_dir": ".trae/rules/",
        "target_file": f"{descriptor.name.replace(' ', '-')}.md",
        "content": body,
    }


def adapt_for_aider(descriptor: AgentDescriptor) -> Dict:
    """
    Aider format: CONVENTIONS.md (appended) or standalone .aider/ file.
    """
    body = f"""## Agent: {descriptor.display_name}

{descriptor.description}

{descriptor.instructions}
"""
    return {
        "tool": "aider",
        "format": "conventions_markdown",
        "target_dir": ".",
        "target_file": "CONVENTIONS.md",
        "content": body,
        "notes": "Append to existing CONVENTIONS.md or create new one",
    }


def adapt_for_agents_md(descriptor: AgentDescriptor) -> Dict:
    """
    Universal AGENTS.md format: append a section to AGENTS.md in project root.
    Supported by Cursor, Copilot, CodeBuddy, Claude Code, Windsurf, etc.
    """
    section = f"""## Agent: {descriptor.display_name}

**Description**: {descriptor.description}

{descriptor.instructions}

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
    "codebuddy_agent": adapt_for_codebuddy_agent,  # NEW
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
    """Adapt a PilotDeck agent to a target tool's format.

    Now uses load_agent_descriptor() which prioritizes agent.json.
    """
    # Load unified AgentDescriptor
    descriptor = load_agent_descriptor(agent_path)

    if target == "all":
        results = {}
        for tool_name, adapter_fn in ADAPTERS.items():
            results[tool_name] = adapter_fn(descriptor)
        return {"multi": True, "results": results}

    adapter_fn = ADAPTERS.get(target)
    if not adapter_fn:
        print(f"Error: Unknown target tool '{target}'. Available: {', '.join(ADAPTERS.keys())}")
        return None

    return adapter_fn(descriptor)


def write_adapted(adapted: Dict, output_dir: Path):
    """Write adapted agent to the output directory."""
    if adapted.get("multi"):
        for tool_name, result in adapted["results"].items():
            tool_dir = output_dir / tool_name
            tool_dir.mkdir(parents=True, exist_ok=True)
            filepath = tool_dir / result["target_file"]
            filepath.parent.mkdir(parents=True, exist_ok=True)
            filepath.write_text(result["content"], encoding="utf-8")
            print(f"  -> {filepath}")
        return

    filepath = output_dir / adapted["target_file"]
    output_dir.mkdir(parents=True, exist_ok=True)
    filepath.write_text(adapted["content"], encoding="utf-8")
    print(f"  -> {filepath}")


def main():
    parser = argparse.ArgumentParser(description="Adapt PilotDeck agent to target AI tool format")
    parser.add_argument("--agent-path", required=True, help="Path to the agent directory (contains agent.json or SKILL.md)")
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
