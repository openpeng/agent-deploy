"""agent-deploy: MCP server for deploying PilotDeck agents to external AI tools.

This package exposes a Model Context Protocol (MCP) server that wraps the
`auto-adapter` skill's detect/adapt/install pipeline, plus market downloads,
behind a clean 4-tool interface consumable by any MCP-aware AI client.

Exposed MCP tools
-----------------
* ``list_installed_tools``   - Detect which AI coding tools are present.
* ``adapt_agent``            - Translate a PilotDeck agent to a target format.
* ``install_agent``          - Write adapted content to a tool's directory.
* ``deploy_agent``           - End-to-end: detect → download → adapt → install.
"""
from __future__ import annotations

__version__ = "0.1.0"
__all__ = ["__version__"]
