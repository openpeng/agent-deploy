#!/usr/bin/env python3
"""
External AI tool detection for auto-adapter.

Detects which AI coding tools (CodeBuddy, Claude Code, Cursor, etc.) are
installed and active in the current environment. Reads detection rules from
config/tools-registry.yaml.

Usage:
    python detect.py [--format json|yaml|text] [--all]
"""
import argparse
import json
import os
import platform
import shutil
import sys
import yaml
from pathlib import Path
from typing import Any, Dict, List, Optional


def _load_registry() -> Dict:
    """Load the tools registry YAML."""
    registry_path = Path(__file__).resolve().parent / "tools-registry.yaml"
    with open(registry_path) as f:
        return yaml.safe_load(f)


def _which(cmd: str) -> Optional[str]:
    """Return the path to a command if it exists on PATH."""
    return shutil.which(cmd)


def _has_env_var(var: str) -> bool:
    """Check if an environment variable is set and non-empty."""
    return bool(os.environ.get(var))


def _has_file(path: str, workspace_root: Path) -> bool:
    """Check if a file or directory exists (supports glob and ~ expansion)."""
    expanded = os.path.expanduser(path)
    check_path = Path(expanded)
    if check_path.is_absolute():
        return check_path.exists()
    return (workspace_root / expanded).exists()


def _detect_tool(tool_key: str, tool_config: Dict, workspace_root: Path) -> Optional[Dict]:
    """Detect if a specific tool is installed/active. Returns detection info or None."""
    detection = tool_config.get("detection", {})

    # Check binaries
    for binary in detection.get("binaries", []):
        if _which(binary):
            return {
                "tool": tool_key,
                "name": tool_config["name"],
                "display_name": tool_config["display_name"],
                "type": tool_config["type"],
                "detected_by": f"binary:{binary}",
                "binary_path": _which(binary),
                "confidence": 0.9,
            }

    # Check config files (project-level)
    for cf in detection.get("config_files", []):
        if _has_file(cf, workspace_root):
            return {
                "tool": tool_key,
                "name": tool_config["name"],
                "display_name": tool_config["display_name"],
                "type": tool_config["type"],
                "detected_by": f"config:{cf}",
                "config_files": [cf],
                "confidence": 0.7,
            }

    # Check environment variables
    for env_var in detection.get("env_vars", []):
        if _has_env_var(env_var):
            return {
                "tool": tool_key,
                "name": tool_config["name"],
                "display_name": tool_config["display_name"],
                "type": tool_config["type"],
                "detected_by": f"env:{env_var}",
                "confidence": 0.5,
            }

    # Check process names — only for IDE tools (type "ide") where process
    # names are distinctive (e.g., "Cursor", "Windsurf"). CLI tools like
    # "claude" or "codebuddy" match too many unrelated processes via pgrep.
    if tool_config.get("type") == "ide":
        for proc in detection.get("process_names", []):
            try:
                # Use pgrep -x for exact process name match (no substring matching)
                result = os.popen(f"pgrep -x '{proc}' 2>/dev/null").read().strip()
                if result:
                    return {
                        "tool": tool_key,
                        "name": tool_config["name"],
                        "display_name": tool_config["display_name"],
                        "type": tool_config["type"],
                        "detected_by": f"process:{proc}",
                        "confidence": 0.3,
                    }
            except Exception:
                pass

    return None


def detect_all(registry: Dict, workspace_root: Path) -> List[Dict]:
    """Detect all installed/active AI tools."""
    detected = []
    tools = registry.get("tools", {})

    for tool_key, tool_config in tools.items():
        if tool_config.get("type") == "universal":
            continue  # Skip universal formats
        result = _detect_tool(tool_key, tool_config, workspace_root)
        if result:
            detected.append(result)

    # Sort by confidence descending
    detected.sort(key=lambda x: x["confidence"], reverse=True)
    return detected


def detect_primary(registry: Dict, workspace_root: Path) -> Optional[Dict]:
    """Detect the primary (most likely active) AI tool."""
    detected = detect_all(registry, workspace_root)
    if detected:
        return detected[0]
    return None


def build_workspace_fingerprint(workspace_root: Path) -> Dict:
    """Build a full environment fingerprint."""
    registry = _load_registry()
    tools = detect_all(registry, workspace_root)

    return {
        "platform": platform.system().lower(),
        "workspace_root": str(workspace_root.resolve()),
        "hostname": platform.node(),
        "python_version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "shell": os.environ.get("SHELL", os.environ.get("COMSPEC", "unknown")),
        "detected_tools": tools,
        "primary_tool": tools[0]["tool"] if tools else None,
        "total_tools_found": len(tools),
        "tool_names": [t["name"] for t in tools],
    }


def main():
    parser = argparse.ArgumentParser(description="Detect external AI coding tools")
    parser.add_argument("--format", choices=["json", "yaml", "text"], default="json")
    parser.add_argument("--all", action="store_true", help="Show all detected tools")
    parser.add_argument("--fingerprint", action="store_true",
                        help="Output full environment fingerprint")
    parser.add_argument("--workspace", default=".", help="Workspace root path")
    args = parser.parse_args()

    workspace_root = Path(args.workspace).resolve()
    registry = _load_registry()

    if args.fingerprint:
        output = build_workspace_fingerprint(workspace_root)
    elif args.all:
        output = {"detected_tools": detect_all(registry, workspace_root)}
    else:
        primary = detect_primary(registry, workspace_root)
        output = {"primary_tool": primary} if primary else {"primary_tool": None, "error": "no tool detected"}

    if args.format == "json":
        print(json.dumps(output, indent=2, ensure_ascii=False))
    elif args.format == "yaml":
        print(yaml.dump(output, allow_unicode=True, default_flow_style=False))
    else:
        _print_text(output)


def _print_text(output: Dict):
    """Print detection results in human-readable text."""
    if "detected_tools" in output:
        tools = output["detected_tools"]
        if not tools:
            print("No AI coding tools detected.")
            return
        for t in tools:
            conf_bar = "█" * int(t["confidence"] * 10) + "░" * (10 - int(t["confidence"] * 10))
            print(f"  {t['display_name']} ({t['name']}) [{conf_bar}] — detected by {t['detected_by']}")
    elif "primary_tool" in output:
        pt = output["primary_tool"]
        if pt:
            print(f"Primary: {pt['display_name']} ({pt['name']}) — detected by {pt['detected_by']}")
        else:
            print("No primary AI tool detected.")


if __name__ == "__main__":
    main()
