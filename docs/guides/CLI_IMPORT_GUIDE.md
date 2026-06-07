# CLI Import Command Guide

**Version**: 1.0  
**Status**: ✅ Implemented  
**Last Updated**: 2026-06-06

---

## Overview

The `agent-deploy import` CLI command provides a command-line interface for importing agents from AI tool formats to agent.json v2.0 format.

**Use Case**: Quickly import agents from the terminal without writing scripts or using the MCP server.

---

## Installation

```bash
npm install -g @openpeng/agent-deploy
```

---

## Basic Usage

```bash
agent-deploy import <source> [options]
```

### Quick Examples

```bash
# Auto-detect and import
agent-deploy import .cursor/commands/my-agent.md

# Preview import (dry-run)
agent-deploy import .claude/commands/skill.md --dry-run

# Custom output directory
agent-deploy import .codebuddy/skills/test/SKILL.md -o ./my-agents

# Force specific adapter
agent-deploy import ./agent.md -t cursor
```

---

## Command Syntax

```
agent-deploy import <source> [options]

Arguments:
  <source>              Path to agent file or directory (required)

Options:
  -o, --output <dir>    Output directory (default: ./imported-agents)
  -t, --tool <name>     Force specific tool adapter
  -d, --dry-run         Preview import without writing files
  -h, --help            Show help message

Global Options:
  --version             Show version number
  --help                Show help message
```

---

## Options

### source (required)

Path to the agent file to import.

**Supported formats**:
- `.cursor/commands/*.md` - Cursor commands
- `.claude/commands/*.md` - Claude Code commands
- `.codebuddy/skills/*/SKILL.md` - CodeBuddy skills
- `.github/agents/*.md` - GitHub Copilot agents

**Examples**:
```bash
agent-deploy import .cursor/commands/code-reviewer.md
agent-deploy import .claude/commands/my-skill.md
agent-deploy import .codebuddy/skills/test-skill/SKILL.md
```

---

### -o, --output <dir>

Specify output directory for imported agents.

**Default**: `./imported-agents`

**Output structure**:
```
output-dir/
└── agent-name/
    └── agent.json
```

**Examples**:
```bash
# Use default output
agent-deploy import .cursor/commands/agent.md
# → ./imported-agents/agent/agent.json

# Custom output directory
agent-deploy import .cursor/commands/agent.md -o ./my-agents
# → ./my-agents/agent/agent.json

# Absolute path
agent-deploy import agent.md -o /home/user/agents
# → /home/user/agents/agent/agent.json
```

---

### -t, --tool <name>

Force a specific import adapter instead of auto-detection.

**Valid values**:
- `cursor` - Cursor commands
- `claude_code` - Claude Code commands
- `codebuddy` - CodeBuddy skills
- `github_copilot` - GitHub Copilot agents

**When to use**:
- File is not in standard location
- Auto-detection fails
- Manual override needed

**Examples**:
```bash
# Auto-detect (default)
agent-deploy import .cursor/commands/agent.md

# Force Cursor adapter
agent-deploy import ./my-agent.md -t cursor

# Force Claude Code adapter
agent-deploy import ./skill.md -t claude_code
```

---

### -d, --dry-run

Preview the import without writing any files.

**Output includes**:
- Detected tool
- Agent metadata (name, version, description, author, tags)
- Output path

**Use cases**:
- Verify correct adapter is detected
- Preview extracted metadata
- Check output before committing

**Example**:
```bash
agent-deploy import .cursor/commands/agent.md --dry-run
```

**Output**:
```
🔍 Dry-run mode: previewing import...

✅ Import preview successful!

Agent Details:
  Name:         my-agent
  Version:      1.0.0
  Display Name: My Agent
  Description:  A helpful coding assistant
  Author:       Imported from Cursor
  Tags:         cursor, imported

Output Path:  ./imported-agents/my-agent/agent.json

💡 Run without --dry-run to write files
```

---

## Examples

### Example 1: Basic Import

Import a Cursor command with auto-detection:

```bash
agent-deploy import .cursor/commands/code-reviewer.md
```

**Output**:
```
📥 Importing agent...

✅ Successfully imported agent!

Source:  /path/to/.cursor/commands/code-reviewer.md
Output:  ./imported-agents/code-reviewer/agent.json

Next steps:
  1. Review the generated agent.json
  2. Upload to agent market (coming soon)
  3. Deploy to other AI tools with 'agent-deploy deploy'
```

---

### Example 2: Dry-run Preview

Preview before importing:

```bash
agent-deploy import .claude/commands/my-skill.md --dry-run
```

**Output**:
```
🔍 Dry-run mode: previewing import...

✅ Import preview successful!

Agent Details:
  Name:         my-skill
  Version:      1.0.0
  Display Name: My Skill
  Description:  A Claude Code skill
  Author:       Imported from Claude Code
  Tags:         claude_code, imported

Output Path:  ./imported-agents/my-skill/agent.json

💡 Run without --dry-run to write files
```

---

### Example 3: Custom Output Directory

Import to a specific directory:

```bash
agent-deploy import .codebuddy/skills/test/SKILL.md -o ~/my-agents
```

**Output**:
```
📥 Importing agent...

✅ Successfully imported agent!

Source:  /path/to/.codebuddy/skills/test/SKILL.md
Output:  /home/user/my-agents/test/agent.json

Next steps:
  1. Review the generated agent.json
  2. Upload to agent market (coming soon)
  3. Deploy to other AI tools with 'agent-deploy deploy'
```

---

### Example 4: Force Specific Adapter

Import a file with manual adapter selection:

```bash
agent-deploy import ./docs/my-agent.md -t cursor
```

**Output**:
```
📥 Importing agent...

✅ Successfully imported agent!

Source:  /path/to/docs/my-agent.md
Output:  ./imported-agents/my-agent/agent.json

Next steps:
  1. Review the generated agent.json
  2. Upload to agent market (coming soon)
  3. Deploy to other AI tools with 'agent-deploy deploy'
```

---

### Example 5: Batch Import

Import multiple files using shell scripting:

```bash
# Import all Cursor commands
for file in .cursor/commands/*.md; do
  agent-deploy import "$file" -o ./agents
done

# Import with progress
for file in .claude/commands/*.md; do
  echo "Importing: $file"
  agent-deploy import "$file" || echo "Failed: $file"
done
```

---

## Error Handling

### Error: Source file not found

```bash
agent-deploy import nonexistent.md
```

**Output**:
```
❌ Error: source file not found: /path/to/nonexistent.md
```

**Solution**: Check the file path exists

---

### Error: Source path is required

```bash
agent-deploy import
```

**Output**:
```
❌ Error: source path is required

Usage: agent-deploy import <source> [options]
Run 'agent-deploy import --help' for more information
```

**Solution**: Provide source path argument

---

### Error: No adapter found

```bash
agent-deploy import unknown.txt
```

**Output**:
```
❌ Import failed: No adapter found for: /path/to/unknown.txt
Tried 4 adapter(s). Supported formats: cursor, claude_code, codebuddy, github_copilot
```

**Solution**: 
- Check file is in correct format
- Use `-t` to force specific adapter
- Verify file extension is `.md` or `SKILL.md`

---

### Error: Invalid tool adapter

```bash
agent-deploy import agent.md -t nonexistent
```

**Output**:
```
❌ Import failed: No adapter found for tool: nonexistent
```

**Solution**: Use valid tool name: cursor, claude_code, codebuddy, github_copilot

---

## Help Commands

### Show general help

```bash
agent-deploy --help
# or
agent-deploy -h
```

### Show import command help

```bash
agent-deploy import --help
# or
agent-deploy import -h
```

### Show version

```bash
agent-deploy --version
# or
agent-deploy -v
```

---

## Workflows

### Workflow 1: Import → Review → Deploy

```bash
# Step 1: Import from Cursor
agent-deploy import .cursor/commands/my-agent.md

# Step 2: Review generated agent.json
cat ./imported-agents/my-agent/agent.json

# Step 3: Deploy to Claude Code (future feature)
agent-deploy deploy ./imported-agents/my-agent --tool claude_code
```

---

### Workflow 2: Dry-run → Import

```bash
# Step 1: Preview
agent-deploy import .claude/commands/skill.md --dry-run

# Step 2: If preview looks good, import
agent-deploy import .claude/commands/skill.md
```

---

### Workflow 3: Batch Import All Agents

```bash
#!/bin/bash

# Import all agents from multiple tools
echo "Importing from Cursor..."
for f in .cursor/commands/*.md; do
  agent-deploy import "$f" -o ./all-agents
done

echo "Importing from Claude Code..."
for f in .claude/commands/*.md; do
  agent-deploy import "$f" -o ./all-agents
done

echo "Importing from CodeBuddy..."
for f in .codebuddy/skills/*/SKILL.md; do
  agent-deploy import "$f" -o ./all-agents
done

echo "Done! All agents imported to ./all-agents/"
```

---

## Supported Platforms

| Platform | Input Pattern | Auto-detect | Status |
|----------|---------------|-------------|--------|
| **Cursor** | `.cursor/commands/*.md` | ✅ | ✅ |
| **Claude Code** | `.claude/commands/*.md` | ✅ | ✅ |
| **CodeBuddy** | `.codebuddy/skills/*/SKILL.md` | ✅ | ✅ |
| **GitHub Copilot** | `.github/agents/*.md` | ✅ | ✅ |

---

## Comparison: CLI vs MCP Tool

| Feature | CLI | MCP Tool |
|---------|-----|----------|
| **Usage** | Terminal | AI assistant |
| **Automation** | Scripts | Conversational |
| **Batch ops** | Shell loops | Multiple calls |
| **Preview** | `--dry-run` | `dry_run: true` |
| **Output** | Formatted text | JSON response |

**When to use CLI**:
- Scripting and automation
- Terminal-based workflows
- Batch operations
- Direct command execution

**When to use MCP**:
- Conversational interface
- AI-assisted workflows
- GUI-based tools (Cursor, Claude Code)
- Complex multi-step tasks

---

## Tips & Best Practices

### 1. Always Dry-run First

Preview imports before writing:
```bash
agent-deploy import agent.md --dry-run
```

### 2. Use Descriptive Output Directories

Organize by source:
```bash
agent-deploy import .cursor/commands/agent.md -o ./from-cursor
agent-deploy import .claude/commands/agent.md -o ./from-claude
```

### 3. Check Exit Codes in Scripts

```bash
if agent-deploy import agent.md; then
  echo "Success!"
else
  echo "Failed!"
fi
```

### 4. Use Absolute Paths for Reliability

```bash
agent-deploy import "$(pwd)/.cursor/commands/agent.md" -o "$(pwd)/agents"
```

### 5. Version Control Imported Agents

```bash
agent-deploy import agent.md -o ./agents
git add ./agents
git commit -m "Import agent from Cursor"
```

---

## Troubleshooting

### Issue: Command not found

**Problem**: `agent-deploy: command not found`

**Solution**:
```bash
# Install globally
npm install -g @openpeng/agent-deploy

# Or use npx
npx @openpeng/agent-deploy import agent.md
```

---

### Issue: Permission denied

**Problem**: `EACCES: permission denied`

**Solution**:
```bash
# Use sudo (Linux/Mac)
sudo npm install -g @openpeng/agent-deploy

# Or install without sudo
npm config set prefix ~/.npm-global
export PATH=~/.npm-global/bin:$PATH
npm install -g @openpeng/agent-deploy
```

---

### Issue: Import succeeds but file not found

**Problem**: File imported but can't find it

**Solution**: Check current directory
```bash
pwd  # Show current directory
ls -la ./imported-agents/  # List imported agents
```

---

## References

- [ImportAdapter Spec](./IMPORT_ADAPTER_SPEC.md)
- [Import Agent MCP Tool](./IMPORT_AGENT_TOOL_GUIDE.md)
- [Phase 2 Plan](./PHASE2_PLAN.md)

---

**Document Version**: 1.0  
**Implementation Status**: ✅ Complete  
**Last Updated**: 2026-06-06
