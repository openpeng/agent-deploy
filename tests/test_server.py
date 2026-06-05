"""Integration tests for the agent-deploy MCP server.

These tests exercise the four MCP tool implementations directly
(via the private ``_tool_*`` functions) without actually writing
files to a project tree. Run with::

    python -m pytest tests/test_server.py -v
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

# Make server importable
HERE = Path(__file__).resolve().parent
SRC = HERE.parent / "src"
sys.path.insert(0, str(SRC))

# We import the server module — this triggers sys.path bootstrap of
# the auto-adapter scripts.
import agent_deploy.server as server  # noqa: E402


SAMPLE_SKILL = """---
name: hello-world
description: A friendly greeting agent.
---

# Hello World

Greet the user warmly.

## Instructions
1. Say hello.
2. Ask how the user is doing.
"""


def _write_sample_agent(tmp: Path) -> Path:
    agent_dir = tmp / "hello-world"
    agent_dir.mkdir(parents=True, exist_ok=True)
    (agent_dir / "SKILL.md").write_text(SAMPLE_SKILL, encoding="utf-8")
    return agent_dir


class TestListInstalledTools(unittest.TestCase):
    def test_default_workspace(self):
        result = server._tool_list_installed_tools({})
        self.assertIn("detected_tools", result)
        self.assertIn("total_tools_found", result)
        self.assertIsInstance(result["detected_tools"], list)

    def test_explicit_workspace(self):
        with tempfile.TemporaryDirectory() as td:
            result = server._tool_list_installed_tools({"workspace_root": td})
            self.assertEqual(result["workspace_root"], str(Path(td).resolve()))

    def test_missing_workspace_raises(self):
        with self.assertRaises(FileNotFoundError):
            server._tool_list_installed_tools({"workspace_root": "/nonexistent/path/xyz"})


class TestAdaptAgent(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.agent_path = _write_sample_agent(Path(self.tmp.name))

    def test_adapt_to_opencode(self):
        result = server._tool_adapt_agent({
            "agent_path": str(self.agent_path),
            "target_tool": "opencode",
        })
        self.assertEqual(result["tool"], "opencode")
        self.assertIn("content", result)
        self.assertIn(".opencode/commands/", result["target_dir"])
        self.assertIn("hello-world", result["target_file"])

    def test_adapt_to_codebuddy_uses_frontmatter(self):
        result = server._tool_adapt_agent({
            "agent_path": str(self.agent_path),
            "target_tool": "codebuddy",
        })
        self.assertEqual(result["tool"], "codebuddy")
        self.assertTrue(result["content"].startswith("---"))
        self.assertIn("name: hello-world", result["content"])

    def test_adapt_to_agents_md(self):
        result = server._tool_adapt_agent({
            "agent_path": str(self.agent_path),
            "target_tool": "agents_md",
        })
        self.assertEqual(result["tool"], "agents_md")
        self.assertEqual(result["target_file"], "AGENTS.md")
        self.assertIn("## Agent: hello-world", result["content"])

    def test_missing_skill_md_raises(self):
        empty = Path(self.tmp.name) / "empty"
        empty.mkdir()
        with self.assertRaises(FileNotFoundError):
            server._tool_adapt_agent({
                "agent_path": str(empty),
                "target_tool": "opencode",
            })

    def test_unknown_target_raises(self):
        with self.assertRaises(ValueError):
            server._tool_adapt_agent({
                "agent_path": str(self.agent_path),
                "target_tool": "nonexistent-tool",
            })


class TestInstallAgent(unittest.TestCase):
    def test_dry_run_does_not_write(self):
        result = server._tool_install_agent({
            "adapted_content": "# hello",
            "agent_name": "hello-world",
            "target_tool": "opencode",
            "level": "project",
            "dry_run": True,
        })
        self.assertEqual(result["dry_run"], True)
        self.assertEqual(result["results"][0]["status"], "ok")

    def test_invalid_target(self):
        result = server._tool_install_agent({
            "adapted_content": "# x",
            "agent_name": "x",
            "target_tool": "no-such-tool",
            "dry_run": True,
        })
        self.assertEqual(result["results"][0]["status"], "error")
        self.assertIn("Unknown tool", result["results"][0]["error"])


class TestDeployAgent(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.agent_path = _write_sample_agent(Path(self.tmp.name))

    def test_local_path_to_specific_target_dry_run(self):
        result = server._tool_deploy_agent({
            "agent_path": str(self.agent_path),
            "target_tool": "opencode",
            "level": "project",
            "dry_run": True,
        })
        self.assertIn("install_results", result)
        self.assertIn("opencode", result["install_results"])
        rs = result["install_results"]["opencode"]
        self.assertTrue(all(r.get("status") == "ok" for r in rs))

    def test_local_path_to_all_targets_dry_run(self):
        result = server._tool_deploy_agent({
            "agent_path": str(self.agent_path),
            "target_tool": "all",
            "level": "project",
            "dry_run": True,
        })
        self.assertGreaterEqual(len(result["install_results"]), 3)
        for tool_name, rs in result["install_results"].items():
            self.assertTrue(
                all(r.get("status") == "ok" for r in rs),
                f"tool {tool_name} failed: {rs}",
            )

    def test_missing_inputs_raises(self):
        with self.assertRaises(ValueError):
            server._tool_deploy_agent({})

    def test_invalid_local_path_raises(self):
        with self.assertRaises(FileNotFoundError):
            server._tool_deploy_agent({
                "agent_path": "/no/such/path",
                "target_tool": "opencode",
                "dry_run": True,
            })

    def test_target_tool_auto_detects_primary(self):
        # auto-detection uses the real workspace root (WORKSPACE_ROOT in server.py).
        # On this host, opencode is installed so it should be the primary target.
        result = server._tool_deploy_agent({
            "agent_path": str(self.agent_path),
            "target_tool": "auto",
            "level": "project",
            "dry_run": True,
        })
        # Should resolve to the detected primary tool
        self.assertGreaterEqual(len(result["target_tools"]), 1)
        self.assertIn("opencode", result["target_tools"])


class TestMCPHandler(unittest.TestCase):
    """Verify the call_tool dispatcher routes to the right implementation."""

    def test_unknown_tool_returns_error(self):
        import asyncio
        out = asyncio.run(server.handle_call_tool("nope", {}))
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].type, "text")
        body = json.loads(out[0].text)
        self.assertTrue(body.get("error"))

    def test_list_installed_tools_via_handler(self):
        import asyncio
        out = asyncio.run(server.handle_call_tool("list_installed_tools", {}))
        body = json.loads(out[0].text)
        self.assertIn("detected_tools", body)

    def test_exception_in_tool_returns_error_envelope(self):
        # Missing required field will raise inside _tool_adapt_agent,
        # and the handler should catch it and return an error envelope.
        import asyncio
        out = asyncio.run(server.handle_call_tool("adapt_agent", {}))
        body = json.loads(out[0].text)
        self.assertTrue(body.get("error"))
        self.assertEqual(body["tool"], "adapt_agent")


class TestToolSchemas(unittest.TestCase):
    def test_all_schemas_have_type_object(self):
        for schema in (
            server.SCHEMA_LIST_INSTALLED_TOOLS,
            server.SCHEMA_ADAPT_AGENT,
            server.SCHEMA_INSTALL_AGENT,
            server.SCHEMA_DEPLOY_AGENT,
        ):
            self.assertEqual(schema["type"], "object")

    def test_adapt_requires_both_args(self):
        self.assertEqual(
            set(server.SCHEMA_ADAPT_AGENT["required"]),
            {"agent_path", "target_tool"},
        )

    def test_install_required(self):
        self.assertEqual(
            set(server.SCHEMA_INSTALL_AGENT["required"]),
            {"adapted_content", "agent_name", "target_tool"},
        )


if __name__ == "__main__":
    unittest.main()
