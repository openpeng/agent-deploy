# Agent Format Support

**Version**: 2.0  
**Last Updated**: 2026-06-06

agent-deploy now supports multiple Agent formats with intelligent fallback strategy.

---

## Supported Agent Formats

### Format A: Cross-Platform Agent (with instructions field)

**Best for**: AI coding assistants (Cursor, Claude Code, etc.)

```json
{
  "schema_version": "2.0",
  "identity": {
    "name": "my-agent",
    "version": "1.0.0",
    "display_name": "My Agent",
    "description": "A cross-platform agent",
    "author": "Your Name"
  },
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# My Agent\n\nAgent instructions here..."
  },
  "capabilities": [],
  "compatibility": {}
}
```

**Inline instructions** (source: "inline"):
- Instructions embedded directly in agent.json
- Best for short, simple agents
- Easy to version control

**File instructions** (source: "file"):
```json
{
  "instructions": {
    "format": "markdown",
    "source": "file",
    "file": "instructions.md"
  }
}
```
- Instructions in separate file
- Best for longer documentation
- Supports multiple formats

---

### Format B: PilotDeck Agent (with subagents)

**Best for**: Complex workflow automation

```json
{
  "identity": {
    "name": "workflow-agent",
    "version": "1.0.0",
    "display_name": "Workflow Agent",
    "description": "Complex multi-step workflow",
    "author": "Your Name"
  },
  "entry": {
    "main_subagent": "worker"
  },
  "subagents": [
    {
      "name": "worker",
      "path": "worker.yaml",
      "description": "Main workflow"
    },
    {
      "name": "helper",
      "path": "helper.yaml",
      "description": "Helper workflow"
    }
  ],
  "category": "utility",
  "type": "agent"
}
```

**How it works**:
- agent-deploy automatically generates instructions from subagents
- Workflow details extracted from YAML files
- Best for PilotDeck ecosystem integration

**Generated instructions example**:
```markdown
# Workflow Agent

Complex multi-step workflow

## Workflows

This agent contains 2 sub-workflow(s):

- **worker** (`worker.yaml`): Main workflow
- **helper** (`helper.yaml`): Helper workflow

Entry workflow: **worker**

## Usage

This agent is based on PilotDeck workflow orchestration. See individual `.yaml` files for detailed configuration.
```

---

### Format C: Legacy Agent (SKILL.md only)

**Deprecated but supported** for backward compatibility

```
my-agent/
├── agent.json      # Minimal metadata
└── SKILL.md        # Actual instructions
```

**Migration path**:
1. Keep SKILL.md for now
2. Add instructions field to agent.json
3. Test with both
4. Remove SKILL.md when ready

---

## Fallback Strategy

agent-deploy tries formats in order (priority → fallback):

```
1. agent.json instructions field (inline or file)
   ↓ not found
2. Generated from subagents (PilotDeck format)
   ↓ not found
3. SKILL.md file (Legacy format)
   ↓ not found
4. README.md file (Last resort)
   ↓ not found
5. Error: No instructions found
```

**Example**:
```javascript
// Agent with both instructions and subagents
// → Uses instructions (priority 1)

// Agent with only subagents
// → Auto-generates from subagents (priority 2)

// Agent with only SKILL.md
// → Uses SKILL.md (priority 3)

// Agent with only README.md
// → Uses README.md (priority 4)
```

---

## Compatibility

### New Identity Format
```json
{
  "identity": {
    "name": "...",
    "version": "...",
    ...
  }
}
```

### Old Flat Format (still supported)
```json
{
  "name": "...",
  "version": "...",
  ...
}
```

Both formats work seamlessly.

---

## Migration Guide

### From SKILL.md to agent.json

**Step 1**: Add instructions field (inline)
```json
{
  "identity": {...},
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "<paste your SKILL.md content here>"
  }
}
```

**Step 2**: Or reference external file
```json
{
  "instructions": {
    "source": "file",
    "file": "SKILL.md"
  }
}
```

**Step 3**: Test
```bash
npx @openpeng/agent-deploy adapt ./my-agent cursor
```

**Step 4**: (Optional) Remove SKILL.md when ready

---

### From PilotDeck to Cross-Platform

If you want your PilotDeck agent to work in other tools:

**Option 1**: Let agent-deploy auto-generate
- Keep your subagents structure
- agent-deploy will create instructions automatically
- Works for most cases

**Option 2**: Add explicit instructions
```json
{
  "identity": {...},
  "instructions": {
    "source": "inline",
    "content": "Custom instructions for other tools..."
  },
  "entry": {...},
  "subagents": [...]
}
```
- instructions used for cross-platform tools
- subagents used for PilotDeck
- Best of both worlds

---

## Testing Your Agent

### Test adaptation
```bash
# Test for Cursor
npx @openpeng/agent-deploy adapt ./my-agent cursor

# Test for Claude Code
npx @openpeng/agent-deploy adapt ./my-agent claude_code

# Test for PilotDeck
npx @openpeng/agent-deploy adapt ./my-agent codebuddy
```

### Run unit tests
```bash
cd agent-deploy/node
npm test
```

**Output**: 31 tests covering all formats

---

## Best Practices

### 1. Choose the Right Format

**Use Cross-Platform (instructions)**:
- ✅ Simple AI coding assistants
- ✅ Single-purpose agents
- ✅ Wide compatibility needed

**Use PilotDeck (subagents)**:
- ✅ Complex multi-step workflows
- ✅ Tool orchestration
- ✅ PilotDeck ecosystem integration

**Use Both**:
- ✅ Maximum compatibility
- ✅ Different experiences per tool
- ✅ Complex agents with simple fallback

### 2. Keep Instructions Clear

```json
{
  "instructions": {
    "content": "# Clear Title\n\n## What I Do\n\nClear explanation...\n\n## Usage\n\nSpecific examples..."
  }
}
```

### 3. Version Your Agents

```json
{
  "schema_version": "2.0",
  "identity": {
    "version": "1.2.3"
  }
}
```

Use semantic versioning:
- Major: Breaking changes
- Minor: New features
- Patch: Bug fixes

---

## FAQ

**Q: Can I use both instructions and subagents?**  
A: Yes! instructions takes priority for cross-platform tools, subagents for PilotDeck.

**Q: What if I only have SKILL.md?**  
A: It still works! agent-deploy automatically falls back to SKILL.md.

**Q: How do I migrate from SKILL.md?**  
A: Add instructions field to agent.json, test, then optionally remove SKILL.md.

**Q: Does this break existing agents?**  
A: No! 100% backward compatible. All existing agents continue to work.

**Q: Which format should I use for new agents?**  
A: Use instructions field for simplicity and cross-platform support.

---

## Examples

See `test-agents/` directory for complete examples:
- `json-only-agent/` - Cross-platform format
- `pilotdeck-agent/` - PilotDeck format
- More examples in test suite

---

## Learn More

- [agent.json v2.0 Spec](../../AGENT_JSON_SPEC_V2.md)
- [Improvement Proposal](../../IMPROVEMENT_PROPOSAL.md)
- [agent-maker-tutorial](../../downloads/agent-maker-tutorial/)

---

## Import: From AI Tools to agent.json

**New in v2.0** - Import agents from AI tool formats back to agent.json v2.0.

### Why Import?

**Use cases**:
- 📥 Migrate agents between AI tools
- 🔄 Backup agents from proprietary formats
- 📦 Share agents via agent.json standard
- 🔀 Cross-platform agent portability

### Supported Import Sources

| Tool | Source Format | Import Path |
|------|---------------|-------------|
| **Cursor** | Markdown | `.cursor/commands/*.md` |
| **Claude Code** | Markdown | `.claude/commands/*.md` |
| **CodeBuddy** | YAML+MD | `.codebuddy/skills/*/SKILL.md` |
| **GitHub Copilot** | Markdown | `.github/agents/*.md` |

---

### Import Conversion Rules

#### 1. Cursor Commands → agent.json

**Source**: `.cursor/commands/code-reviewer.md`
```markdown
# Code Reviewer

Review code for bugs and best practices.

## Instructions
...
```

**Imported to**: `imported-agents/code-reviewer/agent.json`
```json
{
  "schema_version": "2.0",
  "identity": {
    "name": "code-reviewer",
    "version": "1.0.0",
    "display_name": "Code Reviewer",
    "description": "Review code for bugs and best practices.",
    "author": "Imported from Cursor",
    "tags": ["cursor", "imported"]
  },
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# Code Reviewer\n\nReview code for bugs..."
  }
}
```

---

#### 2. Claude Code Commands → agent.json

**Source**: `.claude/commands/test-writer.md`
```markdown
# /test-writer — Test Writer

Generate unit tests for functions.

[description]
Analyzes code and writes comprehensive tests.
[/description]

Instructions here...
```

**Imported to**: `imported-agents/test-writer/agent.json`
```json
{
  "schema_version": "2.0",
  "identity": {
    "name": "test-writer",
    "version": "1.0.0",
    "display_name": "Test Writer",
    "description": "Analyzes code and writes comprehensive tests.",
    "author": "Imported from Claude Code",
    "tags": ["claude_code", "imported"]
  },
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# /test-writer — Test Writer\n\n..."
  }
}
```

---

#### 3. CodeBuddy Skills → agent.json

**Source**: `.codebuddy/skills/api-builder/SKILL.md`
```markdown
---
name: api-builder
description: Build REST APIs
tags:
  - api
  - backend
---

# API Builder

Build RESTful APIs with best practices.
```

**Imported to**: `imported-agents/api-builder/agent.json`
```json
{
  "schema_version": "2.0",
  "identity": {
    "name": "api-builder",
    "version": "1.0.0",
    "display_name": "API Builder",
    "description": "Build REST APIs",
    "author": "Imported from CodeBuddy",
    "tags": ["api", "backend", "codebuddy", "imported"]
  },
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# API Builder\n\nBuild RESTful APIs..."
  }
}
```

**Note**: CodeBuddy's YAML frontmatter tags are preserved and merged.

---

#### 4. GitHub Copilot Agents → agent.json

**Source**: `.github/agents/docs-writer.md`
```markdown
# Documentation Writer

Generate comprehensive documentation.

## Usage
...
```

**Imported to**: `imported-agents/docs-writer/agent.json`
```json
{
  "schema_version": "2.0",
  "identity": {
    "name": "docs-writer",
    "version": "1.0.0",
    "display_name": "Documentation Writer",
    "description": "Generate comprehensive documentation.",
    "author": "Imported from GitHub Copilot",
    "tags": ["github_copilot", "imported"]
  },
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# Documentation Writer\n\n..."
  }
}
```

---

### Import Methods

#### CLI Import
```bash
# Basic import
agent-deploy import .cursor/commands/my-agent.md

# Dry-run (preview)
agent-deploy import .claude/commands/skill.md --dry-run

# Custom output
agent-deploy import agent.md -o ./my-agents

# Force adapter
agent-deploy import agent.md -t cursor
```

#### MCP Import
```typescript
// Via AI assistant
"Import the agent from .cursor/commands/code-reviewer.md"

// MCP tool call
{
  "tool": "import_agent",
  "arguments": {
    "source_path": ".cursor/commands/agent.md",
    "output_dir": "./imported-agents",
    "dry_run": false
  }
}
```

---

### Bidirectional Workflow

**Complete cycle**: Import → Modify → Export

```bash
# 1. Import from Cursor
agent-deploy import .cursor/commands/my-agent.md
# → ./imported-agents/my-agent/agent.json

# 2. Modify agent.json
vim ./imported-agents/my-agent/agent.json

# 3. Export to Claude Code
# (via MCP or future CLI)
deploy_agent(./imported-agents/my-agent, "claude_code")
# → .claude/commands/my-agent.md
```

**Cross-platform migration**:
```bash
# Import from Cursor
agent-deploy import .cursor/commands/agent.md -o ./agents

# Deploy to multiple tools
deploy_agent(./agents/agent, "claude_code")
deploy_agent(./agents/agent, "codebuddy")
deploy_agent(./agents/agent, "github_copilot")
```

---

### Import Best Practices

#### 1. Always Review Imported Agents

```bash
# Preview first
agent-deploy import agent.md --dry-run

# Then import
agent-deploy import agent.md

# Review generated agent.json
cat ./imported-agents/agent/agent.json
```

#### 2. Organize by Source

```bash
# Separate directories per tool
agent-deploy import .cursor/commands/agent.md -o ./from-cursor
agent-deploy import .claude/commands/agent.md -o ./from-claude
```

#### 3. Preserve Metadata

Imported agents automatically include:
- Source tool in `author` field
- Source tool tag in `tags` array
- Original name and description
- Schema version 2.0

#### 4. Batch Import

```bash
# Import all from one tool
for f in .cursor/commands/*.md; do
  agent-deploy import "$f" -o ./all-agents
done

# Import from multiple tools
for tool in cursor claude codebuddy github; do
  find . -name "*.md" -path "*.$tool/*" -exec \
    agent-deploy import {} -o ./all-agents \;
done
```

---

### Import FAQ

**Q: Can I import agents back to their original format?**  
A: Yes! Import to agent.json, then deploy back using adapt/deploy tools.

**Q: What happens to custom metadata?**  
A: Basic metadata is extracted. Tool-specific fields may be lost.

**Q: Can I import from tools not listed?**  
A: Currently only 4 tools supported. New adapters can be added.

**Q: Does import modify the source file?**  
A: No. Import reads the source and creates a new agent.json.

**Q: Can I customize the conversion?**  
A: Use `--dry-run` to preview, then manually edit agent.json.

---

### Troubleshooting Import

#### Auto-detection fails

**Problem**: `No adapter found for: ./my-agent.md`

**Solution**: Use `-t` to force adapter
```bash
agent-deploy import ./my-agent.md -t cursor
```

#### Missing metadata

**Problem**: Imported agent has generic name/description

**Solution**: Edit agent.json after import
```bash
agent-deploy import agent.md
vim ./imported-agents/agent/agent.json
# Update identity fields
```

#### Format not supported

**Problem**: Want to import from unsupported tool

**Solution**:
1. Manually create agent.json
2. Or request adapter via GitHub issue
3. Or implement custom adapter (see DEVELOPMENT.md)

---

## Summary: Export vs Import

| Direction | Input | Output | Use Case |
|-----------|-------|--------|----------|
| **Export** | agent.json | AI tool format | Deploy agents to tools |
| **Import** | AI tool format | agent.json | Migrate agents, backup, share |

**Full cycle**:
```
agent.json → [Export] → AI tool → [Import] → agent.json
```

---

**Version History**:
- v2.0 (2026-06-06): Multi-format support + Import functionality
- v1.0 (2026-06-03): Initial release
