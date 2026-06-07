# ImportAdapter Interface Specification

**Version**: 1.0  
**Status**: ✅ Implemented  
**Last Updated**: 2026-06-06

---

## Overview

The `ImportAdapter` interface enables importing agents from various AI tool formats into the standardized `agent.json v2.0` format. This is the reverse operation of the export/deploy functionality.

**Purpose**: Enable agents to be imported from AI coding tools back into the agent-market, creating a bidirectional ecosystem.

---

## Interface Definition

```typescript
interface ImportAdapter {
  /**
   * Import an agent from the source path and convert to AgentJsonV2 format
   *
   * @param sourcePath - Path to the agent file or directory
   * @returns AgentJsonV2 descriptor ready to be written as agent.json
   * @throws Error if import fails or format is invalid
   */
  importFrom(sourcePath: string): AgentJsonV2;

  /**
   * Check if this adapter can import from the given path
   *
   * @param sourcePath - Path to check
   * @returns true if this adapter recognizes the format
   */
  canImport(sourcePath: string): boolean;

  /**
   * Get metadata about this adapter's capabilities
   *
   * @returns Tool information for registration and discovery
   */
  getToolInfo(): {
    /** Tool identifier (e.g., "cursor", "claude_code") */
    name: string;
    /** File/directory pattern this adapter matches */
    pattern: string;
    /** Human-readable description */
    description: string;
  };
}
```

---

## Core Concepts

### 1. Detection

Each adapter implements `canImport()` to detect if it can handle a given path:

```typescript
canImport(sourcePath: string): boolean {
  const normalized = sourcePath.replace(/\\/g, "/");
  return normalized.includes(".cursor/commands") && normalized.endsWith(".md");
}
```

**Key Points**:
- Normalize paths (Windows backslashes → forward slashes)
- Check both directory pattern and file extension
- Return `true` only if format is recognized

### 2. Parsing

Each adapter implements `importFrom()` to parse the source format:

```typescript
importFrom(sourcePath: string): AgentJsonV2 {
  // 1. Read source file
  const content = readFileSync(sourcePath, "utf-8");
  
  // 2. Parse frontmatter (if present)
  const { frontmatter, body } = parseFrontmatter(content);
  
  // 3. Extract metadata
  const name = slugify(extractName(content, frontmatter));
  const description = extractDescription(body);
  
  // 4. Build agent.json v2.0
  return {
    schema_version: "2.0",
    identity: { name, version, display_name, description, author, tags },
    instructions: { format: "markdown", source: "inline", content: body },
    capabilities: [],
    compatibility: { [toolName]: true, source: toolName, original_path: sourcePath }
  };
}
```

### 3. Metadata Extraction

Adapters extract metadata from:
- **YAML frontmatter** (if present)
- **Markdown titles** (first # heading)
- **File names** (as fallback)
- **Content structure** (e.g., ## Description sections)

---

## Supported Platforms

### 1. Cursor

**Input**: `.cursor/commands/my-agent.md`

```markdown
# Code Reviewer

A thorough code reviewer that checks for bugs and best practices.

## What I Do

I analyze your code and provide feedback.
```

**Output**:
```json
{
  "schema_version": "2.0",
  "identity": {
    "name": "code-reviewer",
    "display_name": "Code Reviewer",
    "description": "A thorough code reviewer that checks for bugs and best practices.",
    "author": "Imported from Cursor",
    "tags": ["cursor", "imported"]
  },
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# Code Reviewer\n\nA thorough code reviewer..."
  }
}
```

**Detection**: `path.includes(".cursor/commands") && path.endsWith(".md")`

---

### 2. Claude Code

**Input**: `.claude/commands/code-review.md`

```markdown
# /code-review — Code Review Assistant

## Description

Reviews code for quality and best practices.

## What I Do

- Check for bugs
- Suggest improvements
```

**Output**:
```json
{
  "schema_version": "2.0",
  "identity": {
    "name": "code-review",
    "display_name": "Code Review Assistant",
    "description": "Reviews code for quality and best practices.",
    "author": "Imported from Claude Code",
    "tags": ["claude_code", "imported"]
  },
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# /code-review — Code Review Assistant\n\n## Description..."
  }
}
```

**Special Handling**:
- Extract display name from slash command format: `# /command — Display Name`
- Parse `## Description` section for description

**Detection**: `path.includes(".claude/commands") && path.endsWith(".md")`

---

### 3. CodeBuddy

**Input**: `.codebuddy/skills/test-skill/SKILL.md`

```markdown
---
name: test-skill
version: 1.0.0
description: A test skill
author: Test Author
tags:
  - testing
  - example
---

# Test Skill

This is a CodeBuddy skill.
```

**Output**:
```json
{
  "schema_version": "2.0",
  "identity": {
    "name": "test-skill",
    "version": "1.0.0",
    "display_name": "Test Skill",
    "description": "A test skill",
    "author": "Test Author",
    "tags": ["testing", "example", "codebuddy", "imported"]
  },
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# Test Skill\n\nThis is a CodeBuddy skill."
  }
}
```

**Special Handling**:
- YAML frontmatter is **required**
- Parse arrays (tags, capabilities)
- Preserve existing tags and add "codebuddy", "imported"

**Detection**: `path.includes(".codebuddy/skills") && path.endsWith("SKILL.md")`

---

### 4. GitHub Copilot

**Input**: `.github/agents/doc-generator.md`

```markdown
# Documentation Generator

An agent that generates documentation for your code.

## Capabilities

- Generate API docs
- Create README files
```

**Output**:
```json
{
  "schema_version": "2.0",
  "identity": {
    "name": "doc-generator",
    "display_name": "Documentation Generator",
    "description": "An agent that generates documentation for your code.",
    "author": "Imported from GitHub Copilot",
    "tags": ["github_copilot", "imported"]
  },
  "instructions": {
    "format": "markdown",
    "source": "inline",
    "content": "# Documentation Generator\n\nAn agent that generates..."
  }
}
```

**Detection**: `path.includes(".github/agents") && path.endsWith(".md")`

---

## Helper Functions

### slugify()

Convert names to URL-safe slugs:

```typescript
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

**Examples**:
- `"Code Reviewer"` → `"code-reviewer"`
- `"My Agent v2.0"` → `"my-agent-v2-0"`

---

### extractDescription()

Extract first paragraph from markdown:

```typescript
function extractDescription(content: string, maxLength: number = 200): string {
  // Remove frontmatter and title
  const withoutTitle = content.replace(/^#[^\n]*\n+/, "");
  
  // Get first paragraph
  const firstParagraph = withoutTitle.split("\n\n")[0] || "";
  const cleaned = firstParagraph.trim().replace(/\n/g, " ");
  
  // Truncate at word boundary
  if (cleaned.length <= maxLength) return cleaned;
  const truncated = cleaned.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > 0 ? truncated.slice(0, lastSpace) + "..." : truncated + "...";
}
```

---

### parseFrontmatter()

Parse YAML frontmatter from markdown:

```typescript
function parseFrontmatter(content: string): {
  frontmatter: Record<string, any>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  
  const yamlText = match[1];
  const body = match[2];
  
  // Parse YAML (supports key: value and arrays)
  const frontmatter = parseSimpleYaml(yamlText);
  
  return { frontmatter, body };
}
```

**Supported YAML**:
- `key: value` pairs
- Arrays:
  ```yaml
  tags:
    - testing
    - example
  ```
- Quoted strings: `name: "My Agent"`

---

## ImportManager

Orchestrates multiple adapters:

```typescript
class ImportManager {
  private adapters: ImportAdapter[] = [];
  
  registerAdapter(adapter: ImportAdapter): void;
  detectAdapter(sourcePath: string): ImportAdapter | null;
  getAdapterByName(toolName: string): ImportAdapter | null;
  
  importAgent(sourcePath: string, outputDir: string, toolName?: string): string;
  dryRun(sourcePath: string, toolName?: string): AgentJsonV2;
  listAdapters(): Array<{ name: string; pattern: string; description: string }>;
}
```

### Usage

```typescript
const manager = new ImportManager();

// Register adapters
manager.registerAdapter(new CursorImportAdapter());
manager.registerAdapter(new ClaudeImportAdapter());
manager.registerAdapter(new CodeBuddyImportAdapter());
manager.registerAdapter(new GitHubImportAdapter());

// Auto-detect and import
const agentDir = manager.importAgent(
  ".cursor/commands/my-agent.md",
  "./imported-agents"
);
// Result: ./imported-agents/my-agent/agent.json

// Force specific adapter
const agentDir2 = manager.importAgent(
  "./some-file.md",
  "./imported",
  "cursor"
);

// Dry-run (preview without writing)
const descriptor = manager.dryRun(".claude/commands/test.md");
console.log(descriptor.identity.name);
```

---

## Error Handling

### Adapter Not Found

```typescript
try {
  manager.importAgent("./unknown.txt", "./output");
} catch (error) {
  // Error: No adapter found for: ./unknown.txt
  // Tried 4 adapter(s). Supported formats: cursor, claude_code, codebuddy, github_copilot
}
```

### File Not Found

```typescript
try {
  adapter.importFrom("./nonexistent.md");
} catch (error) {
  // Error: Cursor command file not found: ./nonexistent.md
}
```

### Invalid Format

```typescript
// CodeBuddy requires YAML frontmatter with 'name' field
try {
  adapter.importFrom(".codebuddy/skills/test/SKILL.md");
} catch (error) {
  // Error: CodeBuddy SKILL.md must have YAML frontmatter with 'name' field.
}
```

---

## Best Practices

### 1. Path Normalization

Always normalize paths in `canImport()`:

```typescript
canImport(sourcePath: string): boolean {
  const normalized = sourcePath.replace(/\\/g, "/");
  return normalized.includes(".cursor/commands");
}
```

**Why**: Windows uses backslashes, but patterns use forward slashes.

### 2. Metadata Fallbacks

Provide sensible defaults:

```typescript
const displayName = frontmatter.name ||
                   extractTitle(content) ||
                   fileName;

const description = frontmatter.description ||
                   extractDescription(body) ||
                   `Imported from ${toolName}: ${fileName}`;
```

**Why**: Not all formats have complete metadata.

### 3. Preserve Original Context

Store original path and source tool:

```typescript
compatibility: {
  cursor: true,
  source: "cursor",
  original_path: sourcePath
}
```

**Why**: Enables round-trip conversion and debugging.

### 4. Tag Consistently

Add consistent tags:

```typescript
tags: [
  ...userTags,
  toolName,  // "cursor", "claude_code", etc.
  "imported"
]
```

**Why**: Makes imported agents discoverable and filterable.

---

## Testing

Test coverage: **20 tests** across 4 adapters + ImportManager.

### Adapter Tests

For each adapter, test:
1. **Detection**: `canImport()` recognizes correct paths
2. **Import**: `importFrom()` produces valid agent.json
3. **Metadata**: Extract name, version, description, author
4. **Frontmatter**: Parse YAML correctly (if applicable)
5. **Tool info**: `getToolInfo()` returns correct values

### ImportManager Tests

1. Registration: `registerAdapter()` adds adapters
2. Detection: `detectAdapter()` finds correct adapter
3. Import: `importAgent()` writes agent.json to output directory
4. Force: `importAgent(..., toolName)` uses specific adapter
5. Error: Throws when no adapter found
6. Dry-run: `dryRun()` returns descriptor without writing
7. List: `listAdapters()` returns all registered adapters

---

## Implementation Checklist

- [x] ImportAdapter interface
- [x] Helper functions (slugify, extractDescription, parseFrontmatter)
- [x] CursorImportAdapter
- [x] ClaudeImportAdapter
- [x] CodeBuddyImportAdapter
- [x] GitHubImportAdapter
- [x] ImportManager class
- [x] 20 unit tests (all passing)
- [x] Documentation

**Next Steps**: MCP tool integration (Phase 2, Task 4)

---

## References

- [agent.json v2.0 Spec](../../docs/specs/AGENT_JSON_SPEC_V2.md)
- [Phase 2 Plan](./PHASE2_PLAN.md)
- [Export Adapter](../../agent-deploy/node/src/adapt.ts)

---

**Document Version**: 1.0  
**Implementation Status**: ✅ Complete  
**Tests**: 20/20 passing  
**Last Updated**: 2026-06-06
