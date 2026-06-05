"""MCP server implementation for the agent-deploy skill.

Bridges the four high-level deployment operations onto the lower-level
`auto-adapter` scripts. Imports ``detect_all``, ``detect_primary``,
``adapt_agent`` and ``install_agent`` directly from those scripts.

The server speaks the Model Context Protocol over stdio. Run it with::

    python -m agent_deploy.server
or, after `pip install -e .`::

    agent-deploy
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tarfile
import tempfile
import traceback
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# Local vendored modules — self-contained, no external path dependencies
# ---------------------------------------------------------------------------
from .detect import _load_registry, detect_all, detect_primary
from .adapt import ADAPTERS, adapt_agent
from .install import install_agent


# ---------------------------------------------------------------------------
# Registry shims — work around quirks in the underlying scripts/config.
# ---------------------------------------------------------------------------
def _patched_load_registry() -> Dict[str, Any]:
    """Load the registry and normalize the `install` block keys.

    The YAML uses `project_level` / `user_level`, but ``install.py`` reads
    ``project`` / ``user``. We rewrite the dict in memory (without touching
    the source file) so the install routine finds the paths.
    """
    data = _load_registry()
    tools = data.get("tools", {})
    for _tool_key, tool_cfg in tools.items():
        install_cfg = tool_cfg.get("install") or {}
        if "project_level" in install_cfg and "project" not in install_cfg:
            install_cfg["project"] = install_cfg["project_level"]
        if "user_level" in install_cfg and "user" not in install_cfg:
            install_cfg["user"] = install_cfg["user_level"]
        tool_cfg["install"] = install_cfg
    return tools  # Return only the tools dict, matching install.load_registry() shape


def _supported_target_tools() -> List[str]:
    """Tool IDs that have BOTH a registry entry and an adapter function."""
    reg = _patched_load_registry()
    return [k for k in reg.keys() if k in ADAPTERS]

# ---------------------------------------------------------------------------
# MCP imports
# ---------------------------------------------------------------------------
try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import TextContent, Tool
except ImportError as e:  # pragma: no cover
    raise SystemExit(
        "The `mcp` package is required. Install it with:\n"
        "    pip install 'mcp>=1.0'\n"
        f"Original error: {e}"
    )

# ---------------------------------------------------------------------------
# Server instance
# ---------------------------------------------------------------------------
server = Server("agent-deploy")

MARKET_API_URL = os.environ.get("MARKET_API_URL", "http://localhost:8321")
MARKET_API_BASE = f"{MARKET_API_URL}/api/v1"


# ===========================================================================
# Tool input schemas (JSON Schema dicts)
# ===========================================================================
SCHEMA_LIST_INSTALLED_TOOLS: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "workspace_root": {
            "type": "string",
            "description": (
                "Optional. Directory to scan for tool config files "
                "(.cursor/, .claude/, etc.). Defaults to current working directory."
            ),
        },
    },
    "required": [],
    "additionalProperties": False,
}

SCHEMA_ADAPT_AGENT: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "agent_path": {
            "type": "string",
            "description": "Filesystem path to the agent directory containing SKILL.md.",
        },
        "target_tool": {
            "type": "string",
            "description": (
                "Target tool ID. One of: codebuddy, claude_code, cursor, "
                "github_copilot, opencode, windsurf, trae, aider, agents_md, "
                "or 'all' to adapt for every supported tool."
            ),
        },
    },
    "required": ["agent_path", "target_tool"],
    "additionalProperties": False,
}

SCHEMA_INSTALL_AGENT: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "adapted_content": {
            "type": "string",
            "description": "The adapted agent content (markdown / yaml).",
        },
        "agent_name": {
            "type": "string",
            "description": "Name of the agent. Used for path templating.",
        },
        "target_tool": {
            "type": "string",
            "description": "Target tool ID (from tools-registry.yaml).",
        },
        "level": {
            "type": "string",
            "enum": ["project", "user", "both"],
            "default": "both",
            "description": "Install level: project, user, or both.",
        },
        "backup": {
            "type": "boolean",
            "default": False,
            "description": "Backup any existing files before overwriting.",
        },
        "dry_run": {
            "type": "boolean",
            "default": False,
            "description": "If true, simulate the install without writing files.",
        },
    },
    "required": ["adapted_content", "agent_name", "target_tool"],
    "additionalProperties": False,
}

SCHEMA_DEPLOY_AGENT: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "agent_id": {
            "type": "string",
            "description": (
                "Market agent ID to download and deploy. If omitted, "
                "agent_path must be provided."
            ),
        },
        "agent_path": {
            "type": "string",
            "description": (
                "Path to a local agent directory (containing SKILL.md). "
                "Use this to skip the market download."
            ),
        },
        "target_tool": {
            "type": "string",
            "enum": ["auto", "all"] + [
                "codebuddy", "claude_code", "cursor", "github_copilot",
                "opencode", "windsurf", "trae", "aider", "agents_md",
            ],
            "default": "auto",
            "description": (
                "Target tool. 'auto' picks the most likely active tool. "
                "'all' deploys to every detected tool."
            ),
        },
        "level": {
            "type": "string",
            "enum": ["project", "user", "both"],
            "default": "both",
            "description": "Install level.",
        },
        "dry_run": {
            "type": "boolean",
            "default": False,
            "description": "If true, simulate the install.",
        },
    },
    "required": [],
    "additionalProperties": False,
}


# ===========================================================================
# Tool list
# ===========================================================================
@server.list_tools()
async def handle_list_tools() -> List[Tool]:
    """Advertise the four MCP tools to clients."""
    return [
        Tool(
            name="list_installed_tools",
            description=(
                "Detect which external AI coding tools are installed or active "
                "in the current environment. Reads binaries on PATH, "
                "environment variables, IDE process names, and config files "
                "(.cursor/, .claude/, etc.). Returns a confidence-sorted list."
            ),
            inputSchema=SCHEMA_LIST_INSTALLED_TOOLS,
        ),
        Tool(
            name="adapt_agent",
            description=(
                "Convert a PilotDeck Market agent (SKILL.md) into the native "
                "agent format of a target AI tool. Returns the adapted content "
                "plus the path where it should be installed. Use `target_tool="
                "all` to adapt for every supported tool in one call."
            ),
            inputSchema=SCHEMA_ADAPT_AGENT,
        ),
        Tool(
            name="install_agent",
            description=(
                "Install an adapted agent to the directory a target AI tool "
                "auto-discovers (e.g. .claude/commands/, .cursor/commands/). "
                "Supports project-level, user-level, or both. Optionally "
                "backs up existing files. Use `dry_run=true` to preview."
            ),
            inputSchema=SCHEMA_INSTALL_AGENT,
        ),
        Tool(
            name="deploy_agent",
            description=(
                "One-call deployment pipeline: detect installed tools → "
                "download (or load local) agent → adapt to target format → "
                "install. This is the easiest tool to use when you just want "
                "to ship an agent to whatever tool the user is running."
            ),
            inputSchema=SCHEMA_DEPLOY_AGENT,
        ),
    ]


# ===========================================================================
# Tool implementations
# ===========================================================================
def _tool_list_installed_tools(args: Dict[str, Any]) -> Dict[str, Any]:
    workspace_root_str = args.get("workspace_root") or "."
    workspace_root = Path(workspace_root_str).resolve()
    if not workspace_root.exists():
        raise FileNotFoundError(f"workspace_root not found: {workspace_root}")
    # detect_all works on the raw registry, so pass the unpatched version
    # (we only patch the `install` block, which detect_all doesn't read).
    registry = _load_registry()
    tools = detect_all(registry, workspace_root)
    return {
        "workspace_root": str(workspace_root),
        "detected_tools": tools,
        "primary_tool": tools[0]["tool"] if tools else None,
        "total_tools_found": len(tools),
    }


def _tool_adapt_agent(args: Dict[str, Any]) -> Dict[str, Any]:
    agent_path = Path(args["agent_path"]).resolve()
    target_tool = args["target_tool"]
    if not agent_path.exists():
        raise FileNotFoundError(f"agent_path not found: {agent_path}")
    if not (agent_path / "SKILL.md").exists():
        raise FileNotFoundError(f"SKILL.md not found in {agent_path}")
    result = adapt_agent(agent_path, target_tool)
    if result is None:
        raise ValueError(f"adapt_agent returned None for target={target_tool!r}")
    return result


def _tool_install_agent(args: Dict[str, Any]) -> Dict[str, Any]:
    # Patch install.load_registry in place to use the key-normalized version
    # so the project_level / user_level → project / user mapping is honored.
    from . import install as _install_mod
    _original_load_registry = _install_mod.load_registry
    _install_mod.load_registry = _patched_load_registry
    try:
        results = install_agent(
            adapted_content=args["adapted_content"],
            agent_name=args["agent_name"],
            target_tool=args["target_tool"],
            level=args.get("level", "both"),
            backup=bool(args.get("backup", False)),
            dry_run=bool(args.get("dry_run", False)),
        )
    finally:
        _install_mod.load_registry = _original_load_registry
    return {
        "agent_name": args["agent_name"],
        "target_tool": args["target_tool"],
        "level": args.get("level", "both"),
        "dry_run": bool(args.get("dry_run", False)),
        "results": results,
    }


# ---------------------------------------------------------------------------
# deploy_agent helpers
# ---------------------------------------------------------------------------
def _download_market_agent(agent_id: str, out_dir: Path) -> Path:
    """Download an agent tarball from the market and return the extracted dir.

    Returns the path to the directory that contains the agent's SKILL.md.
    """
    url = f"{MARKET_API_BASE}/agents/{agent_id}/download"
    tarball_path = out_dir / f"{agent_id}.tar.gz"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req) as resp:
            with open(tarball_path, "wb") as f:
                f.write(resp.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(
            f"Market download failed (HTTP {e.code}): {e.read().decode(errors='replace')}"
        ) from e
    except urllib.error.URLError as e:
        raise RuntimeError(
            f"Cannot reach market at {MARKET_API_URL}. "
            f"Set MARKET_API_URL env var or use agent_path. Original: {e}"
        ) from e

    # Extract
    extract_dir = out_dir / agent_id
    extract_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tarball_path, "r:gz") as tf:
        # Strip the leading top-level dir if present (common in agent tarballs)
        members = tf.getmembers()
        # Find the common prefix to strip
        prefixes = {m.name.split("/")[0] for m in members if m.name}
        strip_prefix = ""
        if len(prefixes) == 1:
            strip_prefix = next(iter(prefixes)) + "/"
        for m in members:
            if strip_prefix and m.name.startswith(strip_prefix):
                m.name = m.name[len(strip_prefix):]
            tf.extract(m, extract_dir)

    # Find the SKILL.md
    skill_candidates = list(extract_dir.rglob("SKILL.md"))
    if not skill_candidates:
        raise FileNotFoundError(
            f"Downloaded tarball contains no SKILL.md. Extracted to {extract_dir}."
        )
    # Prefer the shortest path (top-level)
    skill_candidates.sort(key=lambda p: (len(p.parts), str(p)))
    return skill_candidates[0].parent


def _resolve_local_agent(agent_path_str: str) -> Path:
    p = Path(agent_path_str).resolve()
    if not p.exists():
        raise FileNotFoundError(f"agent_path not found: {p}")
    if (p / "SKILL.md").exists():
        return p
    # If they pointed at a SKILL.md directly
    if p.is_file() and p.name == "SKILL.md":
        return p.parent
    raise FileNotFoundError(f"SKILL.md not found in {p}")


def _select_targets(requested: str, workspace_root: Path) -> List[str]:
    """Resolve the target_tool argument into a concrete list of tool IDs."""
    if requested == "all":
        # Only return tools that have BOTH a registry entry and an adapter
        return _supported_target_tools()
    if requested == "auto":
        registry = _load_registry()
        primary = detect_primary(registry, workspace_root)
        if primary is None:
            # No tool detected — fall back to the universal AGENTS.md format
            return ["agents_md"]
        # Make sure the primary is actually supported
        if primary["tool"] not in ADAPTERS:
            return ["agents_md"]
        return [primary["tool"]]
    # Explicit tool id
    if requested not in ADAPTERS:
        supported = ", ".join(sorted(ADAPTERS.keys()))
        raise ValueError(
            f"Unknown target tool {requested!r}. Supported: {supported}"
        )
    return [requested]


def _tool_deploy_agent(args: Dict[str, Any]) -> Dict[str, Any]:
    agent_id = args.get("agent_id")
    agent_path_str = args.get("agent_path")
    if not agent_id and not agent_path_str:
        raise ValueError("Must provide either `agent_id` or `agent_path`.")
    if agent_id and agent_path_str:
        # Both → prefer local path but record the market id
        pass

    workspace_root = Path.cwd()
    target_tool_arg = args.get("target_tool", "auto")
    level = args.get("level", "both")
    dry_run = bool(args.get("dry_run", False))

    report: Dict[str, Any] = {
        "input": {
            "agent_id": agent_id,
            "agent_path": agent_path_str,
            "target_tool": target_tool_arg,
            "level": level,
            "dry_run": dry_run,
        },
        "steps": [],
    }

    # --- Step 1: Detect installed tools (informational) ---
    registry = _load_registry()
    detected = detect_all(registry, workspace_root)
    report["steps"].append({
        "step": "detect",
        "workspace_root": str(workspace_root),
        "detected_tools": [t["tool"] for t in detected],
        "primary_tool": detected[0]["tool"] if detected else None,
    })

    # --- Step 2: Resolve agent source ---
    tmp_ctx: Optional[tempfile.TemporaryDirectory] = None
    try:
        if agent_path_str:
            source_dir = _resolve_local_agent(agent_path_str)
            report["steps"].append({
                "step": "load_agent",
                "source": "local",
                "path": str(source_dir),
            })
        else:
            tmp_ctx = tempfile.TemporaryDirectory(prefix="agent-deploy-")
            tmp_path = Path(tmp_ctx.name)
            source_dir = _download_market_agent(agent_id, tmp_path)  # type: ignore[arg-type]
            report["steps"].append({
                "step": "download_agent",
                "source": "market",
                "agent_id": agent_id,
                "market_url": MARKET_API_URL,
                "extracted_to": str(source_dir),
            })
    except Exception:
        if tmp_ctx is not None:
            tmp_ctx.cleanup()
        raise

    # --- Step 3: Determine target tools ---
    target_tools = _select_targets(target_tool_arg, workspace_root)
    report["target_tools"] = target_tools

    # --- Step 4: Adapt + Install for each target ---
    agent_name = source_dir.name
    install_results: Dict[str, List[Dict[str, Any]]] = {}
    # Patch install.load_registry for this batch of installs (project_level
    # → project key fix).
    from . import install as _install_mod
    _original_load_registry = _install_mod.load_registry
    _install_mod.load_registry = _patched_load_registry
    try:
        for tt in target_tools:
            try:
                adapted = adapt_agent(source_dir, tt)
                if adapted is None:
                    install_results[tt] = [{"status": "error", "error": "adapt_agent returned None"}]
                    continue
                if "results" in adapted and adapted.get("multi"):
                    install_results[tt] = [{"status": "skipped", "note": "multi-result from adapt_agent"}]
                    continue
                install_out = install_agent(
                    adapted_content=adapted["content"],
                    agent_name=agent_name,
                    target_tool=tt,
                    level=level,
                    backup=False,
                    dry_run=dry_run,
                )
                install_results[tt] = install_out
            except Exception as e:  # noqa: BLE001
                install_results[tt] = [{
                    "status": "error",
                    "error": str(e),
                    "traceback": traceback.format_exc(),
                }]
    finally:
        _install_mod.load_registry = _original_load_registry

    report["install_results"] = install_results
    report["dry_run"] = dry_run
    report["summary"] = {
        "target_count": len(target_tools),
        "ok_count": sum(
            1 for rs in install_results.values()
            if all(r.get("status") == "ok" for r in rs)
        ),
        "error_count": sum(
            1 for rs in install_results.values()
            if any(r.get("status") == "error" for r in rs)
        ),
    }

    # Cleanup temp dir
    if tmp_ctx is not None:
        tmp_ctx.cleanup()

    return report


# ===========================================================================
# Tool dispatch
# ===========================================================================
@server.call_tool()
async def handle_call_tool(name: str, arguments: Dict[str, Any]) -> List[TextContent]:
    """Dispatch a tool call to its implementation."""
    try:
        if name == "list_installed_tools":
            result = _tool_list_installed_tools(arguments or {})
        elif name == "adapt_agent":
            result = _tool_adapt_agent(arguments or {})
        elif name == "install_agent":
            result = _tool_install_agent(arguments or {})
        elif name == "deploy_agent":
            result = _tool_deploy_agent(arguments or {})
        else:
            result = {"error": f"Unknown tool: {name}"}
    except Exception as e:  # noqa: BLE001
        result = {
            "error": True,
            "tool": name,
            "exception": type(e).__name__,
            "message": str(e),
            "traceback": traceback.format_exc(),
        }
    return [TextContent(type="text", text=json.dumps(result, indent=2, ensure_ascii=False))]


# ===========================================================================
# Entry point
# ===========================================================================
async def _main() -> None:
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )


def main() -> None:
    """Synchronous entry point for `python -m agent_deploy.server`."""
    asyncio.run(_main())


if __name__ == "__main__":
    main()
