# Agent.json Specification v2.0

**Version**: 2.0  
**Date**: 2026-06-06  
**Status**: STABLE

## Overview

`agent.json` is the standard metadata and instruction format for PilotDeck Market agents. Version 2.0 introduces the `instructions` field, making agent.json the **single source of truth** for agent behavior, eliminating the need for separate SKILL.md files.

## Core Principles

1. **Single Source of Truth**: All agent information lives in agent.json
2. **Self-Contained**: Instructions can be inline or referenced
3. **Platform-Agnostic**: Describes capabilities independently of target AI tool
4. **Backward Compatible**: Supports migration from SKILL.md-based agents

---

## Schema

### Minimal Example

```json
{
  "schema_version": "2.0",
  "identity": {
    "name": "code-reviewer",
    "version": "1.0.0",
    "description": "Reviews code changes and provides feedback"
  },
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# Code Reviewer\n\n## What I do\n\nI review your code..."
  }
}
```

### Full Example

```json
{
  "schema_version": "2.0",
  
  "identity": {
    "name": "code-reviewer",
    "version": "1.2.3",
    "display_name": "Code Reviewer Agent",
    "description": "Reviews code changes and provides actionable feedback",
    "author": "Your Name <email@example.com>",
    "license": "MIT",
    "homepage_url": "https://github.com/yourusername/code-reviewer",
    "source_url": "https://github.com/yourusername/code-reviewer"
  },
  
  "classification": {
    "category": "utility",
    "type": "agent",
    "tags": ["code-review", "quality", "testing", "ci-cd"]
  },
  
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# Code Reviewer\n\n## What I do\n\nI review your code changes and provide actionable feedback...\n\n## How to use me\n\nSimply share your code diff or PR URL..."
  },
  
  "capabilities": [
    {
      "type": "tool_call",
      "name": "analyze_diff",
      "description": "Analyze git diff and identify potential issues"
    },
    {
      "type": "subagent",
      "name": "static_analyzer",
      "entry": "analyzers/static.yaml",
      "description": "Static code analysis subagent"
    }
  ],
  
  "compatibility": {
    "platforms": {
      "cursor": { "supported": true, "format": "slash_command" },
      "claude_code": { "supported": true, "format": "skill" },
      "github_copilot": { "supported": true, "format": "agent_instruction" }
    },
    "runtime_requirements": {
      "node": ">=18.0.0"
    }
  },
  
  "structure": {
    "entry_point": "main.yaml",
    "subagents": [
      { "name": "worker", "file": "subagents/worker.yaml" }
    ]
  },
  
  "dependencies": {
    "agents": ["linter-agent@^1.0.0"],
    "npm": ["@anthropic/sdk@^1.0.0"]
  }
}
```

---

## Field Reference

### Required Fields

#### `schema_version` (string, required)

Version of the agent.json specification. Use `"2.0"` for this version.

```json
{
  "schema_version": "2.0"
}
```

#### `identity` (object, required)

Core identification information.

**Required sub-fields:**
- `name` (string): Machine-readable identifier (lowercase, hyphen-separated)
- `version` (string): Semantic version (e.g., "1.2.3")
- `description` (string): One-line summary (max 200 chars)

**Optional sub-fields:**
- `display_name` (string): Human-readable name
- `author` (string): Author name and/or email
- `license` (string): License identifier (default: "MIT")
- `homepage_url` (string): Project homepage
- `source_url` (string): Source code repository

```json
{
  "identity": {
    "name": "my-agent",
    "version": "1.0.0",
    "description": "A helpful agent that does X",
    "display_name": "My Agent",
    "author": "Jane Doe <jane@example.com>",
    "license": "MIT"
  }
}
```

#### `instructions` (object, required)

**Agent behavior instructions**. This is the core field that replaces SKILL.md.

**Format options:**

1. **Inline content** (recommended for short instructions):

```json
{
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# My Agent\n\n## What I do\n\nI help with..."
  }
}
```

2. **External file reference** (for longer instructions):

```json
{
  "instructions": {
    "format": "markdown",
    "source": "file",
    "file": "instructions.md"
  }
}
```

**Fields:**
- `format` (string): Format of instructions. Options: `"markdown"`, `"yaml"`, `"json"`, `"text"`
- `source` (string): Source type. Options: `"inline"`, `"file"`
- `content` (string): Inline instruction content (required if `source="inline"`)
- `file` (string): Relative path to instruction file (required if `source="file"`)

---

### Optional Fields

#### `classification` (object)

Categorization metadata.

```json
{
  "classification": {
    "category": "utility",
    "type": "agent",
    "tags": ["code-review", "quality"]
  }
}
```

**Fields:**
- `category` (string): Primary category. Options: `"general"`, `"browser"`, `"data_analysis"`, `"content_creation"`, `"web_scraper"`, `"file_processor"`, `"ai_chat"`, `"utility"`, `"other"`
- `type` (string): Agent type. Options: `"agent"`, `"subagent"`, `"skill"`, `"workflow"`
- `tags` (array of strings): Searchable tags

#### `capabilities` (array)

Describes what the agent can do (for discovery and validation).

```json
{
  "capabilities": [
    {
      "type": "tool_call",
      "name": "search_web",
      "description": "Search the web for information"
    },
    {
      "type": "subagent",
      "name": "analyzer",
      "entry": "subagents/analyzer.yaml",
      "description": "Code analysis subagent"
    },
    {
      "type": "mcp_server",
      "command": "node",
      "args": ["dist/server.js"],
      "tools": ["read_file", "write_file"]
    }
  ]
}
```

**Capability types:**
- `tool_call`: Function/tool the agent can invoke
- `subagent`: Nested agent component
- `mcp_server`: Model Context Protocol server

#### `compatibility` (object)

Platform support and requirements.

```json
{
  "compatibility": {
    "platforms": {
      "cursor": {
        "supported": true,
        "format": "slash_command",
        "notes": "Works best in project context"
      },
      "claude_code": {
        "supported": true,
        "format": "skill"
      }
    },
    "runtime_requirements": {
      "node": ">=18.0.0",
      "python": ">=3.10"
    }
  }
}
```

#### `structure` (object)

Package file structure.

```json
{
  "structure": {
    "entry_point": "main.yaml",
    "subagents": [
      { "name": "worker", "file": "subagents/worker.yaml" }
    ],
    "resources": [
      { "type": "prompt_template", "file": "prompts/review.md" },
      { "type": "config", "file": "config/rules.json" }
    ]
  }
}
```

#### `dependencies` (object)

External dependencies.

```json
{
  "dependencies": {
    "agents": ["linter-agent@^1.0.0"],
    "npm": ["@anthropic/sdk@^1.0.0"],
    "python": ["aiosqlite>=0.19.0"]
  }
}
```

---

## Migration from SKILL.md

### Option 1: Inline Instructions

Move SKILL.md content into agent.json:

**Before** (SKILL.md):
```markdown
---
name: my-agent
description: Does something useful
---

# My Agent

Instructions here...
```

**After** (agent.json):
```json
{
  "schema_version": "2.0",
  "identity": {
    "name": "my-agent",
    "version": "1.0.0",
    "description": "Does something useful"
  },
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# My Agent\n\nInstructions here..."
  }
}
```

### Option 2: File Reference

Keep instructions in a separate file:

**agent.json**:
```json
{
  "schema_version": "2.0",
  "identity": {
    "name": "my-agent",
    "version": "1.0.0",
    "description": "Does something useful"
  },
  "instructions": {
    "format": "markdown",
    "source": "file",
    "file": "instructions.md"
  }
}
```

**instructions.md**:
```markdown
# My Agent

Instructions here...
```

### Option 3: Keep SKILL.md Temporarily

Agent-deploy v2.0 automatically falls back to SKILL.md if no instructions field is found. You'll see a deprecation warning:

```
[DEPRECATED] agent.json found but no instructions field. Falling back to SKILL.md.
```

Add the instructions field when ready to migrate.

---

## Validation

### Required Field Check

```python
def validate_agent_json(data: dict) -> list[str]:
    errors = []
    
    if "schema_version" not in data:
        errors.append("Missing schema_version")
    
    if "identity" not in data:
        errors.append("Missing identity section")
    else:
        for field in ["name", "version", "description"]:
            if field not in data["identity"]:
                errors.append(f"Missing identity.{field}")
    
    if "instructions" not in data:
        errors.append("Missing instructions section")
    else:
        inst = data["instructions"]
        if inst.get("source") == "inline" and not inst.get("content"):
            errors.append("instructions.source='inline' but content is empty")
        elif inst.get("source") == "file" and not inst.get("file"):
            errors.append("instructions.source='file' but file path missing")
    
    return errors
```

---

## Best Practices

### ✅ Do

- Use semantic versioning (major.minor.patch)
- Keep description under 200 characters
- Use inline instructions for simple agents (< 500 lines)
- Use file reference for complex agents (> 500 lines)
- Add tags for better discoverability
- Specify platform compatibility when known

### ❌ Don't

- Use special characters in `name` (stick to lowercase + hyphens)
- Embed binary data in instructions
- Make instructions format-specific (avoid tool-specific syntax)
- Skip version bumps when updating instructions

---

## FAQ

**Q: Do I need to delete SKILL.md?**  
A: No. Agent-deploy v2.0 will use it as fallback if `instructions` field is missing. But we recommend migrating.

**Q: Can I use both agent.json instructions and SKILL.md?**  
A: Yes, but agent.json instructions take priority. SKILL.md will be ignored if instructions field exists.

**Q: What format should instructions be in?**  
A: Markdown is recommended for maximum compatibility. Plain text, YAML, and JSON are also supported.

**Q: Can instructions include code examples?**  
A: Yes! Use markdown code blocks:
```json
{
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# My Agent\n\n```python\nprint('example')\n```"
  }
}
```

**Q: How do I test my agent.json?**  
A: Use the agent-deploy CLI:
```bash
npx @openpeng/agent-deploy adapt_agent --agent-path ./my-agent --target cursor
```

---

## Version History

- **2.0** (2026-06-06): Added `instructions` field, made agent.json self-contained
- **1.0** (2025-01-01): Initial specification (metadata only, required SKILL.md)

---

## References

- [Migration Guide](./MIGRATION_GUIDE.md)
- [Example Agents](../examples/)
- [Agent Deploy Documentation](../agent-deploy/README.md)
