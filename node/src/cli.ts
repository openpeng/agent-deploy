#!/usr/bin/env node
/**
 * agent-deploy CLI
 * Command-line interface for deploying and importing agents
 */

import { parseArgs } from "node:util";
import { existsSync } from "fs";
import fs from "fs";
import { resolve } from "path";
import * as path from "path";
import { homedir } from "os";
import * as yaml from "js-yaml";
import { ImportManager } from "./import-manager.js";
import { CursorImportAdapter } from "./adapters/cursor-import.js";
import { ClaudeImportAdapter } from "./adapters/claude-import.js";
import { CodeBuddyImportAdapter } from "./adapters/codebuddy-import.js";
import { GitHubImportAdapter } from "./adapters/github-import.js";
import {
  uploadAgent,
  downloadAgent,
  MarketClient,
  listLocalAgents,
  uploadTeam,
  downloadTeam,
  searchTeams,
  getTeam,
  uploadWorkflow,
  downloadWorkflow,
  searchWorkflows,
  getWorkflow,
  packDirectoryToTarGz,
} from "./market.js";
import { UpdateChecker } from "./check-updates.js";
import { AgentCache } from "./runtime/agent-cache.js";
import { adaptAgent } from "./adapt.js";
import { installAgent } from "./install.js";
import { detectAll } from "./detect.js";
import { ErrorHandlers, handleCommandError, UserFriendlyError } from "./errors.js";
import { listTemplates, getTemplate, initFromTemplate } from "./templates.js";
// [DEPRECATED] Runtime imports — preserved for reference, not used in CLI
// These modules are being migrated to agent-compose (Runtime Engine).
// import { PipelineEngine, ConsoleLogger } from "./runtime/pipeline.js";
// import { AgentExecutor } from "./runtime/agent-executor.js";
// import { ToolRegistry } from "./runtime/tool-registry.js";
// import { ExecutionContextManager } from "./runtime/context.js";
// import { WorkerYaml } from "./runtime/types.js";
// import { ReadFileTool } from "./runtime/tools/read-file.js";
// import { WriteFileTool } from "./runtime/tools/write-file.js";
// import { BashTool } from "./runtime/tools/bash.js";
// import { GlobTool } from "./runtime/tools/glob.js";
// import { LLMChatTool } from "./runtime/tools/llm-chat.js";
// import { WebFetchTool } from "./runtime/tools/web-fetch.js";
// import { WebSearchTool } from "./runtime/tools/web-search.js";
// import { invokeAgentTool } from "./runtime/builtin-tools/invoke-agent.js";
// import { listAgentsTool } from "./runtime/builtin-tools/list-agents.js";
// import { V2CompatibilityLayer } from "./runtime/v2-compat.js";
// import { getPolicyRegistry } from "./runtime/policy.js";
// import { MCPToolLoader } from "./runtime/mcp-integration.js";
// import { SkillLoader } from "./runtime/skill-integration.js";
// import { registerMemoryTool } from "./runtime/memory-integration.js";
import { DependencyResolver } from "./runtime/dependency-resolver.js";
import { AgentLockFile } from "./lockfile.js";
import { validateAgentJson, validateWorkerYaml, formatValidationResult } from "./validator.js";
import { previewPipeline, formatPipelinePreview, generateMermaidDiagram, dryRunPipeline, formatDryRunResult } from "./preview.js";

const VERSION = "1.0.0";

/**
 * Print help message
 */
function printHelp() {
  console.log(`
agent-deploy v${VERSION}

Usage:
  agent-deploy import <source> [options]
  agent-deploy upload <agent-dir> [options]
  agent-deploy deploy <agent-dir> [options]
  agent-deploy use <agent-id|agent-dir> [options]
  agent-deploy list [options]
  agent-deploy search <query> [options]
  agent-deploy info <agent-id> [options]
  agent-deploy init <template> [options]
  agent-deploy templates
  agent-deploy team package <team-dir> [-o <dir>]
  agent-deploy team upload <team-dir> [--market <url>] [--api-key <key>] [--force]
  agent-deploy team download <team-name> [-o <dir>] [--version <ver>] [--market <url>]
  agent-deploy team list [--tag <tag>] [--category <cat>] [--market <url>]
  agent-deploy team validate <team-dir>

  agent-deploy workflow package <workflow-dir> [-o <dir>]
  agent-deploy workflow upload <workflow-dir> [--market <url>] [--api-key <key>] [--force]
  agent-deploy workflow download <workflow-name> [-o <dir>] [--version <ver>] [--market <url>]
  agent-deploy workflow list [--tag <tag>] [--category <cat>] [--market <url>]
  agent-deploy workflow validate <workflow-dir>

  agent-deploy check-updates [options]
  agent-deploy clean [agent-id]
  agent-deploy --help
  agent-deploy --version

Commands:
  import <source>       Import agent from AI tool format to agent.json
  upload <agent-dir>    Upload agent to Market
  deploy <agent-dir>    Deploy agent to AI coding tool(s)
  use <agent-id|dir>    Download + adapt + install (local by default)
  clean [agent-id]      Clean global agent installations
  validate <agent-dir>   Validate agent.json / worker.yaml structure
  preview <agent-dir>    Preview pipeline execution flow (dry-run)
  list                  List local agents
  search <query>        Search agents in Market
  info <agent-id>       Show detailed agent information
  init <template>       Create new agent from template
  templates             List available agent templates
  team <action>         Manage teams (package/upload/download/list/validate)
  workflow <action>     Manage workflows (package/upload/download/list/validate)
  check-updates         Check for updates to deployed agents

Import Options:
  -o, --output <dir>    Output directory (default: ./imported-agents)
  -t, --tool <name>     Force specific tool adapter
                        Options: cursor, claude_code, codebuddy, github_copilot
  -d, --dry-run         Preview import without writing files
  -h, --help            Show this help message

Upload Options:
  -m, --market <url>    Market API URL (default: $MARKET_API_URL or http://localhost:8321)
  -k, --api-key <key>   API key for authentication (default: $MARKET_API_KEY)
  -f, --force           Force overwrite existing version
  -h, --help            Show this help message

Deploy Options:
  -t, --tool <name>     Target tool (cursor, claude_code, codebuddy, etc.)
                        Use 'auto' for auto-detect, 'all' for all detected tools
  -l, --level <level>   Install level: project, user, or both (default: both)
  -f, --target-file <path>  Target file path (relative) where agent should be installed (required)
  -h, --help            Show this help message

Use Options:
  -m, --market <url>    Market API URL (for downloading from market)
  -o, --output <dir>    Download output directory (default: ./downloaded-agents)
  -l, --level <level>   Install level: project, user, or both (default: both)
  --with-deps           Resolve and install dependencies recursively
  --no-deps             Skip dependency resolution (default: auto-resolve)
  -h, --help            Show this help message

List Options:
  --type <type>         Filter by type: imported, downloaded, or all (default: all)
  -o, --output <dir>    Base directory to scan (default: ./)
  -h, --help            Show this help message

Search Options:
  --tag <tag>           Filter by tag
  --category <cat>      Filter by category
  --limit <n>           Max results (default: 20)
  -m, --market <url>    Market API URL
  -h, --help            Show this help message

Info Options:
  --local               Show local agent info (default: search Market)
  -m, --market <url>    Market API URL (for Market info)
  -h, --help            Show this help message

Init Options:
  -n, --name <name>     Agent name (default: use template name)
  -o, --output <dir>    Output directory (default: ./agents)
  -h, --help            Show this help message

Examples:
  # Import from AI tool
  agent-deploy import .cursor/commands/my-agent.md

  # Upload to Market
  agent-deploy upload ./imported-agents/my-agent

  # Deploy to specific tool
  agent-deploy deploy ./imported-agents/my-agent -t cursor

  # Download and install agent from Market
  agent-deploy use my-agent
  agent-deploy use my-agent -m http://market.example.com
  agent-deploy use ./test-agents/my-agent

  # List local agents
  agent-deploy list
  agent-deploy list --type imported

  # Search Market
  agent-deploy search "code review"
  agent-deploy search typescript --tag security

  # Show agent info
  agent-deploy info my-agent
  agent-deploy info my-agent --local

  # Create from template
  agent-deploy init agent-builder -n my-builder
  agent-deploy templates

Supported Platforms:
  - Cursor           (.cursor/commands/*.md)
  - Claude Code      (.claude/commands/*.md)
  - CodeBuddy        (.codebuddy/skills/*/SKILL.md)
  - GitHub Copilot   (.github/agents/*.md)

For MCP server mode, run without arguments.
  `);
}

/**
 * Print version
 */
function printVersion() {
  console.log(`agent-deploy v${VERSION}`);
}

/**
 * Handle import command
 */
async function handleImportCommand(args: string[]) {
  // Parse arguments
  const { values, positionals } = parseArgs({
    args,
    options: {
      output: { type: "string", short: "o" },
      tool: { type: "string", short: "t" },
      "dry-run": { type: "boolean", short: "d", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  // Show help if requested
  if (values.help) {
    printHelp();
    return;
  }

  // Validate source path
  const sourcePath = positionals[0];
  if (!sourcePath) {
    console.error("❌ Error: source path is required\n");
    console.error("Usage: agent-deploy import <source> [options]");
    console.error("Run 'agent-deploy import --help' for more information");
    process.exit(1);
  }

  // Resolve paths
  const resolvedSource = resolve(sourcePath);
  const outputDir = values.output ? resolve(values.output) : resolve("./imported-agents");
  const tool = values.tool as string | undefined;
  const dryRun = values["dry-run"] as boolean;

  // Validate source exists
  if (!existsSync(resolvedSource)) {
    console.error(`❌ Error: source file not found: ${resolvedSource}`);
    process.exit(1);
  }

  // Create ImportManager and register adapters
  const manager = new ImportManager();
  manager.registerAdapter(new CursorImportAdapter());
  manager.registerAdapter(new ClaudeImportAdapter());
  manager.registerAdapter(new CodeBuddyImportAdapter());
  manager.registerAdapter(new GitHubImportAdapter());

  try {
    if (dryRun) {
      // Dry-run mode
      console.log("🔍 Dry-run mode: previewing import...\n");

      const descriptor = manager.dryRun(resolvedSource, tool);

      console.log("✅ Import preview successful!\n");
      console.log("Agent Details:");
      console.log(`  Name:         ${descriptor.identity.name}`);
      console.log(`  Version:      ${descriptor.identity.version}`);
      console.log(`  Display Name: ${descriptor.identity.display_name}`);
      console.log(`  Description:  ${descriptor.identity.description}`);
      console.log(`  Author:       ${descriptor.identity.author}`);
      console.log(`  Tags:         ${descriptor.identity.tags?.join(", ") || "none"}`);
      console.log();
      console.log(`Output Path:  ${outputDir}/${descriptor.identity.name}/agent.json`);
      console.log();
      console.log("💡 Run without --dry-run to write files");
    } else {
      // Real import
      console.log("📥 Importing agent...\n");

      const agentDir = manager.importAgent(resolvedSource, outputDir, tool);
      const agentJsonPath = `${agentDir}/agent.json`;

      console.log("✅ Successfully imported agent!\n");
      console.log(`Source:  ${resolvedSource}`);
      console.log(`Output:  ${agentJsonPath}`);
      console.log();
      console.log("Next steps:");
      console.log("  1. Review the generated agent.json");
      console.log("  2. Upload to agent market (coming soon)");
      console.log("  3. Deploy to other AI tools with 'agent-deploy deploy'");
    }
  } catch (error) {
    handleCommandError(error as Error, 'import');
  }
}

/**
 * Handle upload command
 */
async function handleUploadCommand(args: string[]) {
  try {
    // Parse arguments
    const { values, positionals } = parseArgs({
      args,
      options: {
        market: { type: "string", short: "m" },
        "api-key": { type: "string", short: "k" },
        force: { type: "boolean", short: "f", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });

    // Show help if requested
    if (values.help) {
      printHelp();
      return;
    }

    // Get agent directory from positionals
    const agentDir = positionals[0];

    if (!agentDir) {
      console.error("❌ Error: agent directory is required\n");
      console.error("Usage: agent-deploy upload <agent-dir> [options]");
      console.error("Run 'agent-deploy upload --help' for more information");
      process.exit(1);
    }

    // Resolve path
    const resolvedPath = resolve(agentDir);

    // Verify directory exists
    if (!existsSync(resolvedPath)) {
      throw ErrorHandlers.fileNotFound(resolvedPath, 'directory');
    }

    // Verify agent.json exists
    const agentJsonPath = resolve(resolvedPath, "agent.json");
    if (!existsSync(agentJsonPath)) {
      throw ErrorHandlers.missingAgentJson(resolvedPath);
    }

    console.log("📤 Uploading agent to Market...\n");

    // Upload agent
    const result = await uploadAgent({
      agentDir: resolvedPath,
      marketUrl: values.market as string | undefined,
      apiKey: values["api-key"] as string | undefined,
      force: values.force as boolean,
    });

    console.log("✅ Successfully uploaded agent!\n");
    console.log(`Agent ID:     ${result.agent_id}`);
    console.log(`Name:         ${result.agent_name}`);
    console.log(`Version:      ${result.version}`);
    console.log(`Market URL:   ${result.market_url}\n`);

    console.log("Next steps:");
    console.log("  1. Share the Market URL with others");
    console.log("  2. Deploy to AI tools with 'agent-deploy deploy'");
    console.log("  3. Check agent status in Market UI");
  } catch (error) {
    handleCommandError(error as Error, 'upload');
  }
}

/**
 * Handle deploy command
 */
async function handleDeployCommand(args: string[]) {
  try {
    // Parse arguments
    const { values, positionals } = parseArgs({
      args,
      options: {
        tool: { type: "string", short: "t" },
        level: { type: "string", short: "l", default: "both" },
        target_file: { type: "string", short: "f" },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });

    // Show help if requested
    if (values.help) {
      printHelp();
      return;
    }

    // Get agent directory from positionals
    const agentDir = positionals[0];

    if (!agentDir) {
      console.error("❌ Error: agent directory is required\n");
      console.error("Usage: agent-deploy deploy <agent-dir> [options]");
      console.error("Run 'agent-deploy deploy --help' for more information");
      process.exit(1);
    }

    // Resolve path
    const resolvedPath = resolve(agentDir);

    // Verify directory exists
    if (!existsSync(resolvedPath)) {
      throw ErrorHandlers.fileNotFound(resolvedPath, 'directory');
    }

    // Verify agent.json exists
    const agentJsonPath = resolve(resolvedPath, "agent.json");
    if (!existsSync(agentJsonPath)) {
      throw ErrorHandlers.missingAgentJson(resolvedPath);
    }

    const targetTool = (values.tool as string) || "auto";
    const level = (values.level as string) || "both";
    const targetFile = values.target_file as string | undefined;

    if (!targetFile) {
      console.error("Error: --target-file (-f) is required\n");
      console.error("Usage: agent-deploy deploy <agent-dir> -f <target-file> [options]");
      console.error("Run 'agent-deploy deploy --help' for more information");
      process.exit(1);
    }

    // Detect tools if auto
    let toolsToInstall: string[] = [];

    if (targetTool === "auto") {
      const detected = detectAll();
      if (detected.length === 0) {
        throw ErrorHandlers.toolNotDetected();
      }
      toolsToInstall = [detected[0].tool];
      console.log(`🔍 Auto-detected: ${detected[0].tool}\n`);
    } else if (targetTool === "all") {
      const detected = detectAll();
      if (detected.length === 0) {
        throw ErrorHandlers.toolNotDetected();
      }
      toolsToInstall = detected.map(d => d.tool);
      console.log(`🔍 Detected ${detected.length} tool(s): ${toolsToInstall.join(", ")}\n`);
    } else {
      toolsToInstall = [targetTool];
    }

    // Read agent name
    const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
    const agentName = agentJson.identity?.name || agentJson.name || "agent";

    // Deploy to each tool
    const results: Array<{ tool: string; success: boolean; error?: string }> = [];

    for (const tool of toolsToInstall) {
      try {
        console.log(`📦 Deploying to ${tool}...`);

        // Adapt agent
        const adapted = await adaptAgent(resolvedPath, tool, targetFile);

        // Install agent
        await installAgent(adapted.content, agentName, tool, level, false, targetFile);

        console.log(`✅ Successfully deployed to ${tool}\n`);
        results.push({ tool, success: true });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to deploy to ${tool}: ${msg}\n`);
        results.push({ tool, success: false, error: msg });
      }
    }

    // Summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log("=" .repeat(50));
    console.log(`📊 Deployment Summary:`);
    console.log(`   ✅ Successful: ${successful}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📍 Total: ${results.length}`);

    if (failed > 0) {
      console.log("\nFailed deployments:");
      results.filter(r => !r.success).forEach(r => {
        console.log(`   - ${r.tool}: ${r.error}`);
      });
    }

    if (successful > 0) {
      console.log("\n🎉 Agent deployed successfully!");
      console.log("\nNext steps:");
      results.filter(r => r.success).forEach(r => {
        if (r.tool === "cursor") {
          console.log(`   - Open Cursor and type '//${agentName}' to use the agent`);
        } else if (r.tool === "claude_code") {
          console.log(`   - Open Claude Code and type '/${agentName}' to use the agent`);
        } else {
          console.log(`   - Check ${r.tool} for the deployed agent`);
        }
      });
    }

    // Exit with error if all failed
    if (failed === results.length) {
      process.exit(1);
    }
  } catch (error) {
    handleCommandError(error as Error, 'deploy');
  }
}

/**
 * Handle list command
 */
async function handleListCommand(args: string[]) {
  try {
    // Parse arguments
    const { values } = parseArgs({
      args,
      options: {
        type: { type: "string" },
        output: { type: "string", short: "o" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });

    if (values.help) {
      console.log(`
Usage: agent-deploy list [options]

List local imported or downloaded agents.

Options:
  --type <type>         Filter by type: imported, downloaded, or all (default: all)
  -o, --output <dir>    Base directory to scan (default: ./)
  -h, --help            Show this help message

Examples:
  agent-deploy list
  agent-deploy list --type imported
  agent-deploy list --type downloaded
      `);
      return;
    }

    console.log("📋 Listing local agents...\n");

    const agents = await listLocalAgents({
      type: values.type as any,
      outputDir: values.output as string,
    });

    if (agents.length === 0) {
      console.log("No agents found.");
      console.log("\n💡 Tip: Import agents with 'agent-deploy import' or download from Market");
      return;
    }

    // Display agents
    console.log(`Found ${agents.length} agent(s):\n`);

    agents.forEach((agent, idx) => {
      console.log(`${idx + 1}. ${agent.display_name} (${agent.name})`);
      console.log(`   Version:     ${agent.version}`);
      console.log(`   Description: ${agent.description.substring(0, 60)}${agent.description.length > 60 ? '...' : ''}`);
      console.log(`   Author:      ${agent.author}`);
      if (agent.tags.length > 0) {
        console.log(`   Tags:        ${agent.tags.join(', ')}`);
      }
      console.log(`   Updated:     ${new Date(agent.updated_at).toLocaleDateString()}`);
      console.log();
    });

    console.log(`Total: ${agents.length} agent(s)`);
  } catch (error) {
    handleCommandError(error as Error, 'list');
  }
}

/**
 * Handle search command
 */
async function handleSearchCommand(args: string[]) {
  try {
    // Parse arguments
    const { values, positionals } = parseArgs({
      args,
      options: {
        tag: { type: "string" },
        category: { type: "string" },
        limit: { type: "string" },
        market: { type: "string", short: "m" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });

    if (values.help) {
      console.log(`
Usage: agent-deploy search <query> [options]

Search for agents in the Market.

Arguments:
  <query>               Search query (keywords)

Options:
  --tag <tag>           Filter by tag
  --category <cat>      Filter by category
  --limit <n>           Max results (default: 20)
  -m, --market <url>    Market API URL (default: $MARKET_API_URL or http://localhost:8321)
  -h, --help            Show this help message

Examples:
  agent-deploy search "code review"
  agent-deploy search typescript --tag security
  agent-deploy search refactor --category productivity --limit 10
      `);
      return;
    }

    const query = positionals[0];
    if (!query) {
      console.error("❌ Error: Search query is required\n");
      console.log("Usage: agent-deploy search <query> [options]");
      console.log("Try: agent-deploy search --help");
      process.exit(1);
    }

    console.log(`🔍 Searching Market for: "${query}"...\n`);

    const marketUrl = values.market as string || process.env.MARKET_API_URL || "http://localhost:8321";
    const client = new MarketClient({ baseUrl: marketUrl });

    const result = await client.searchAgents({
      query,
      tag: values.tag as string,
      category: values.category as string,
      limit: values.limit ? parseInt(values.limit as string) : 20,
    });

    if (result.agents.length === 0) {
      console.log("No agents found matching your search.");
      console.log("\n💡 Try different keywords or remove filters");
      return;
    }

    // Display results
    console.log(`Found ${result.agents.length} agent(s) (total: ${result.total}):\n`);

    result.agents.forEach((agent, idx) => {
      console.log(`${idx + 1}. ${agent.display_name} (${agent.name})`);
      console.log(`   Version:     ${agent.version}`);
      console.log(`   Description: ${agent.description.substring(0, 60)}${agent.description.length > 60 ? '...' : ''}`);
      console.log(`   Author:      ${agent.author}`);
      if (agent.tags.length > 0) {
        console.log(`   Tags:        ${agent.tags.join(', ')}`);
      }
      console.log(`   Downloads:   ${agent.downloads}`);
      if (agent.rating > 0) {
        console.log(`   Rating:      ${'⭐'.repeat(Math.round(agent.rating))} (${agent.rating.toFixed(1)})`);
      }
      console.log();
    });

    console.log(`Showing ${result.agents.length} of ${result.total} results`);
    if (result.total > result.agents.length) {
      console.log("💡 Use --limit to see more results");
    }
  } catch (error) {
    handleCommandError(error as Error, 'search');
  }
}

/**
 * Handle info command
 */
async function handleInfoCommand(args: string[]) {
  try {
    // Parse arguments
    const { values, positionals } = parseArgs({
      args,
      options: {
        local: { type: "boolean" },
        market: { type: "string", short: "m" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });

    if (values.help) {
      console.log(`
Usage: agent-deploy info <agent-id> [options]

Show detailed information about an agent.

Arguments:
  <agent-id>            Agent ID or name

Options:
  --local               Show local agent info (default: search Market)
  -m, --market <url>    Market API URL (default: $MARKET_API_URL or http://localhost:8321)
  -h, --help            Show this help message

Examples:
  agent-deploy info my-agent
  agent-deploy info my-agent --local
  agent-deploy info code-reviewer -m http://market.example.com
      `);
      return;
    }

    const agentId = positionals[0];
    if (!agentId) {
      console.error("❌ Error: Agent ID is required\n");
      console.log("Usage: agent-deploy info <agent-id> [options]");
      console.log("Try: agent-deploy info --help");
      process.exit(1);
    }

    if (values.local) {
      // Search local agents
      console.log(`📋 Searching for local agent: ${agentId}...\n`);

      const agents = await listLocalAgents({});
      const agent = agents.find(a => a.id === agentId || a.name === agentId);

      if (!agent) {
        console.log(`Agent '${agentId}' not found locally.`);
        console.log("\n💡 List all local agents with: agent-deploy list");
        process.exit(1);
      }

      // Display detailed info
      console.log(`📦 ${agent.display_name}\n`);
      console.log(`ID:          ${agent.id}`);
      console.log(`Name:        ${agent.name}`);
      console.log(`Version:     ${agent.version}`);
      console.log(`Author:      ${agent.author}`);
      console.log(`Category:    ${agent.category}`);
      if (agent.tags.length > 0) {
        console.log(`Tags:        ${agent.tags.join(', ')}`);
      }
      console.log(`\nDescription:`);
      console.log(agent.description);
      console.log(`\nCreated:     ${new Date(agent.created_at).toLocaleString()}`);
      console.log(`Updated:     ${new Date(agent.updated_at).toLocaleString()}`);
    } else {
      // Search Market
      console.log(`🔍 Fetching agent info from Market: ${agentId}...\n`);

      const marketUrl = values.market as string || process.env.MARKET_API_URL || "http://localhost:8321";
      const client = new MarketClient({ baseUrl: marketUrl });

      const agent = await client.getAgent(agentId);

      // Display detailed info
      console.log(`📦 ${agent.display_name}\n`);
      console.log(`ID:          ${agent.id}`);
      console.log(`Name:        ${agent.name}`);
      console.log(`Version:     ${agent.version}`);
      console.log(`Author:      ${agent.author}`);
      console.log(`Category:    ${agent.category}`);
      if (agent.tags.length > 0) {
        console.log(`Tags:        ${agent.tags.join(', ')}`);
      }
      console.log(`Downloads:   ${agent.downloads}`);
      if (agent.rating > 0) {
        console.log(`Rating:      ${'⭐'.repeat(Math.round(agent.rating))} (${agent.rating.toFixed(1)})`);
      }
      console.log(`\nDescription:`);
      console.log(agent.description);
      console.log(`\nCreated:     ${new Date(agent.created_at).toLocaleString()}`);
      console.log(`Updated:     ${new Date(agent.updated_at).toLocaleString()}`);
      console.log(`\nMarket URL:  ${marketUrl}/agents/${agent.id}`);

      console.log(`\n💡 Install with: agent-deploy use ${agent.id}`);
    }
  } catch (error) {
    handleCommandError(error as Error, 'info');
  }
}

/**
 * Handle init command
 */
async function handleInitCommand(args: string[]) {
  try {
    // Parse arguments
    const { values, positionals } = parseArgs({
      args,
      options: {
        name: { type: "string", short: "n" },
        output: { type: "string", short: "o" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });

    if (values.help) {
      console.log(`
Usage: agent-deploy init <template> [options]

Create a new agent from a template.

Arguments:
  <template>            Template ID (use 'agent-deploy templates' to list)

Options:
  -n, --name <name>     Agent name (default: use template name)
  -o, --output <dir>    Output directory (default: ./agents)
  -h, --help            Show this help message

Examples:
  agent-deploy init agent-builder
  agent-deploy init code-reviewer -n my-reviewer
  agent-deploy init test-writer -o ./my-agents
      `);
      return;
    }

    const template = positionals[0];
    if (!template) {
      console.error("❌ Error: Template ID is required\n");
      console.log("Usage: agent-deploy init <template> [options]");
      console.log("Try: agent-deploy templates");
      process.exit(1);
    }

    console.log(`🎨 Creating agent from template: ${template}...\n`);

    const agentDir = initFromTemplate({
      template,
      name: values.name as string,
      outputDir: values.output as string || './agents',
    });

    console.log("✅ Successfully created agent!\n");
    console.log(`Location: ${agentDir}`);
    console.log("\nNext steps:");
    console.log("  1. Review and customize agent.json");
    console.log("  2. Test the agent instructions");
    console.log(`  3. Upload to Market: agent-deploy upload ${agentDir}`);
    console.log(`  4. Deploy locally: agent-deploy deploy ${agentDir} -t claude_code`);
  } catch (error) {
    handleCommandError(error as Error, 'init');
  }
}

/**
 * Handle run command — DEPRECATED
 * Agent execution has been moved to agent-compose (Runtime Engine).
 * This command is preserved for backward compatibility but will not execute.
 */
async function handleRunCommand(args: string[]) {
  console.error("⚠️  The 'run' command has been deprecated and moved to agent-compose.");
  console.error("");
  console.error("Agent execution is now handled by the agent-compose Runtime Engine.");
  console.error("Please use agent-compose to run agents:");
  console.error("");
  console.error("  agent-compose run <agent-dir>");
  console.error("  agent-compose market run <agent-name>");
  console.error("");
  console.error("If you need the legacy runtime, it is still available in:");
  console.error("  node/src/runtime/ (deprecated — will be removed in a future version)");
  process.exit(1);
}

/**
 * Handle use command - download from market + adapt + install
 */
async function handleUseCommand(args: string[]) {
  try {
    // Parse arguments
    const { values, positionals } = parseArgs({
      args,
      options: {
        market: { type: "string", short: "m" },
        output: { type: "string", short: "o" },
        level: { type: "string", short: "l" },
        global: { type: "boolean", default: false },
        "with-deps": { type: "boolean", default: false },
        "no-deps": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });

    if (values.help) {
      console.log(`
Usage: agent-deploy use <agent-id|agent-dir> [options]

Download from Market (if needed), adapt, and install agent to all detected AI tools.
This is the fastest way to make a Market agent directly usable.

Arguments:
  <agent-id|agent-dir>  Agent ID (Market) or local agent directory

Options:
  -m, --market <url>    Market API URL (default: $MARKET_API_URL or http://localhost:8321)
  -o, --output <dir>    Download output directory (default: ./downloaded-agents)
  -l, --level <level>   Install level: project, user, or both (default: both)
  --with-deps           Resolve and install dependencies recursively
  --no-deps             Skip dependency resolution (default: auto-resolve)
  -h, --help            Show this help message

Examples:
  agent-deploy use my-agent
  agent-deploy use code-reviewer -m http://market.example.com
  agent-deploy use ./test-agents/pilotdeck-agent
      `);
      return;
    }

    const input = positionals[0];
    if (!input) {
      console.error("❌ Error: agent ID or directory is required\n");
      console.error("Usage: agent-deploy use <agent-id|agent-dir> [options]");
      console.error("Run 'agent-deploy use --help' for more information");
      process.exit(1);
    }

    const isGlobal = values.global as boolean;
    let agentPath: string;

    // Determine if input is a local directory or a market agent ID
    const localCandidate = resolve(input);
    if (existsSync(localCandidate) && existsSync(path.join(localCandidate, "agent.json"))) {
      // Local directory mode
      agentPath = localCandidate;
      console.log(`📂 Using local agent: ${input}\n`);
    } else {
      // Market download mode
      console.log(`📥 Downloading agent from Market: ${input}...\n`);

      const marketUrl = values.market as string || process.env.MARKET_API_URL || "http://localhost:8321";
      const outputDir = values.output ? resolve(values.output as string) : resolve("./agents");

      const result = await downloadAgent({
        agentId: input,
        outputDir,
        marketUrl,
      });

      agentPath = result.output_path;
      console.log(`✅ Downloaded to: ${agentPath}\n`);
      console.log(`📁 Agent stored locally (not installed globally). Use 'agent-deploy run ${agentPath}' to execute.\n`);
    }

    // Verify agent.json exists
    const agentJsonPath = path.join(agentPath, "agent.json");
    if (!existsSync(agentJsonPath)) {
      throw ErrorHandlers.missingAgentJson(agentPath);
    }

    // Read agent metadata
    const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
    const agentName = agentJson.identity?.name || agentJson.name || path.basename(agentPath);
    const agentAuthor = agentJson.identity?.author || "Unknown";
    const agentVersion = agentJson.identity?.version || "0.0.0";
    const agentSource = agentJson.identity?.repository || "Market";

    // Security: show agent source info
    console.log(`\n🔒 Security Notice:`);
    console.log(`   Agent: ${agentName} v${agentVersion}`);
    console.log(`   Author: ${agentAuthor}`);
    console.log(`   Source: ${agentSource}`);
    console.log(`   This agent will run in RESTRICTED mode by default.`);
    console.log(`   Use 'agent-deploy run --trusted' if you trust this publisher.\n`);

    // Dependency resolution
    const withDeps = values["with-deps"] as boolean;
    const noDeps = values["no-deps"] as boolean;
    const shouldResolveDeps = withDeps || (!noDeps && agentJson.dependencies?.agents);

    if (shouldResolveDeps && !noDeps) {
      console.log(`📦 Resolving dependencies...\n`);
      const marketUrl = values.market as string || process.env.MARKET_API_URL || "http://localhost:8321";
      const resolver = new DependencyResolver(marketUrl);

      try {
        const deps = await resolver.resolve(agentPath);
        if (deps.size > 0) {
          console.log(`Found ${deps.size} dependency(ies):`);
          for (const [name, dep] of deps) {
            console.log(`  - ${name}@${dep.version} (${dep.source})`);
          }
          console.log();

          // Install dependencies to agent's deps directory
          const depsDir = path.join(agentPath, "deps");
          await resolver.installDependencies(Array.from(deps.values()), depsDir);
          console.log(`✅ Dependencies installed to: ${depsDir}\n`);

          // Update lock file
          const lockFile = new AgentLockFile(agentPath);
          lockFile.update(agentName, agentVersion, Array.from(deps.values()));
          console.log(`🔒 Lock file updated: ${lockFile.getPath()}\n`);
        } else {
          console.log(`No dependencies found.\n`);
        }
      } catch (depError) {
        const msg = depError instanceof Error ? depError.message : String(depError);
        console.error(`❌ Dependency resolution failed: ${msg}\n`);
        if (withDeps) {
          // --with-deps was explicitly requested, fail hard
          process.exit(1);
        }
        // Otherwise continue without deps
      }
    } else if (noDeps) {
      console.log(`⏭️  Skipping dependency resolution (--no-deps)\n`);
    }

    if (!isGlobal) {
      console.log(`📁 Local mode: Agent stored at ${agentPath}`);
      console.log(`   Use: agent-deploy run ${path.relative(process.cwd(), agentPath)} --trusted`);
      console.log(`   Or add --global flag to install to AI tools globally.\n`);
      return; // Don't install globally
    }

    // --global mode: auto-detect and install to AI tools
    const level = (values.level as string) || "both"; // read from --level flag, default to both
    const detected = detectAll();
    const toolsToInstall = new Set<string>();

    // Always include codebuddy_agent
    toolsToInstall.add("codebuddy_agent");

    // Add detected tools
    for (const d of detected) {
      toolsToInstall.add(d.tool);
    }
    // Also add codebuddy (skill format) if codebuddy_agent is included
    if (detected.some(d => d.tool === "codebuddy")) {
      toolsToInstall.add("codebuddy");
    }

    const installList = Array.from(toolsToInstall);
    console.log(`🔧 Installing to ${installList.length} target(s): ${installList.join(", ")}\n`);

    // Deploy to each tool
    const results: Array<{ tool: string; success: boolean; error?: string }> = [];

    for (const tool of installList) {
      try {
        const toolLabel = tool === "codebuddy_agent" ? `${tool} (CC Agent)` : tool;
        console.log(`📦 Deploying to ${toolLabel}...`);

        // Adapt agent
        const adapted = adaptAgent(agentPath, tool);

        // Install agent
        await installAgent(adapted.content, agentName, tool, level, false);

        console.log(`✅ Successfully deployed to ${toolLabel}\n`);
        results.push({ tool, success: true });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to deploy to ${tool}: ${msg}\n`);
        results.push({ tool, success: false, error: msg });
      }
    }

    // Summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log("=".repeat(50));
    console.log(`📊 Installation Summary:`);
    console.log(`   ✅ Successful: ${successful}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📍 Total: ${results.length}`);

    if (failed > 0) {
      console.log("\nFailed installations:");
      results.filter(r => !r.success).forEach(r => {
        console.log(`   - ${r.tool}: ${r.error}`);
      });
    }

    if (successful > 0) {
      console.log(`\n🎉 Agent "${agentName}" is ready to use!`);
      console.log("\nHow to use:");
      const hasCCAgent = results.some(r => r.success && r.tool === "codebuddy_agent");
      if (hasCCAgent) {
        console.log(`   - CC: Restart CodeBuddy Code to discover the agent`);
        console.log(`   - CC: The agent will appear in .codebuddy/agents/${agentName}.md`);
      }
      console.log(`   - Run pipeline: agent-deploy run ${agentPath}`);
    }

    if (failed === results.length) {
      process.exit(1);
    }
  } catch (error) {
    handleCommandError(error as Error, 'use');
  }
}

/**
 * Handle check-updates command
 */
async function handleCheckUpdatesCommand(args: string[]) {
  try {
    const { values } = parseArgs({
      args,
      options: {
        market: { type: "string", short: "m" },
        "include-local": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });

    if (values.help) {
      console.log(`
Usage: agent-deploy check-updates [options]

Check for updates to deployed agents by comparing local versions with Market versions.

Options:
  -m, --market <url>     Market API URL (default: $MARKET_API_URL or http://localhost:8321)
  --include-local        Also check local agents not tracked in deployment state
  -h, --help             Show this help message

Examples:
  agent-deploy check-updates
  agent-deploy check-updates -m http://market.example.com
  agent-deploy check-updates --include-local
      `);
      return;
    }

    console.log("🔍 Checking for agent updates...\n");

    const marketUrl = values.market as string || process.env.MARKET_API_URL || "http://localhost:8321";
    const checker = new UpdateChecker({
      marketUrl,
      includeLocalAgents: values["include-local"] as boolean,
    });

    const updates = await checker.checkAll();
    const summary = checker["summarizeUpdates"](updates);

    if (updates.length === 0) {
      console.log("No deployed agents found.");
      console.log("\n💡 Deploy agents first with 'agent-deploy deploy' or 'agent-deploy use --global'");
      return;
    }

    // Display results
    const upToDate = updates.filter(u => !u.isUpdateAvailable && !u.error);
    const hasUpdates = updates.filter(u => u.isUpdateAvailable);
    const failed = updates.filter(u => u.error);

    if (hasUpdates.length > 0) {
      console.log(`📦 ${hasUpdates.length} update(s) available:\n`);
      hasUpdates.forEach((u, idx) => {
        console.log(`${idx + 1}. ${u.agentId}`);
        console.log(`   Current:  ${u.currentVersion}`);
        console.log(`   Latest:   ${u.latestVersion}`);
        if (u.updateLevel) {
          const levelEmoji = u.updateLevel === "major" ? "🔴" : u.updateLevel === "minor" ? "🟡" : "🟢";
          console.log(`   Level:    ${levelEmoji} ${u.updateLevel}`);
        }
        if (u.releaseDate) {
          console.log(`   Released: ${new Date(u.releaseDate).toLocaleDateString()}`);
        }
        if (u.changelog) {
          const shortLog = u.changelog.length > 80 ? u.changelog.substring(0, 80) + "..." : u.changelog;
          console.log(`   Changes:  ${shortLog}`);
        }
        console.log();
      });
    }

    if (upToDate.length > 0) {
      console.log(`✅ ${upToDate.length} agent(s) up to date:`);
      upToDate.forEach(u => {
        console.log(`   - ${u.agentId} @ ${u.currentVersion}`);
      });
      console.log();
    }

    if (failed.length > 0) {
      console.log(`⚠️  ${failed.length} check(s) failed:`);
      failed.forEach(u => {
        console.log(`   - ${u.agentId}: ${u.error}`);
      });
      console.log();
    }

    // Summary
    console.log("=".repeat(50));
    console.log("📊 Summary:");
    console.log(`   Total checked: ${updates.length}`);
    console.log(`   Up to date:    ${summary.upToDate}`);
    console.log(`   Has updates:   ${summary.hasUpdates}`);
    if (summary.hasUpdates > 0) {
      console.log(`      - Major: ${summary.updatesByLevel.major}`);
      console.log(`      - Minor: ${summary.updatesByLevel.minor}`);
      console.log(`      - Patch: ${summary.updatesByLevel.patch}`);
    }
    console.log(`   Check failed:  ${summary.checkFailed}`);

    if (hasUpdates.length > 0) {
      console.log("\n💡 Update an agent:");
      console.log("   agent-deploy use <agent-id> --global");
    }
  } catch (error) {
    handleCommandError(error as Error, "check-updates");
  }
}

/**
 * Handle templates command
 */
async function handleTemplatesCommand(args: string[]) {
  try {
    // Parse arguments
    const { values } = parseArgs({
      args,
      options: {
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });

    if (values.help) {
      console.log(`
Usage: agent-deploy templates

List all available agent templates.

Templates provide quick-start agents for common use cases.

Examples:
  agent-deploy templates
  agent-deploy init agent-builder
      `);
      return;
    }

    console.log("📚 Available Agent Templates:\n");

    const templates = listTemplates();

    if (templates.length === 0) {
      console.log("No templates found.");
      return;
    }

    // Group by category
    const byCategory: Record<string, typeof templates> = {};
    for (const template of templates) {
      if (!byCategory[template.category]) {
        byCategory[template.category] = [];
      }
      byCategory[template.category].push(template);
    }

    // Display by category
    for (const [category, categoryTemplates] of Object.entries(byCategory)) {
      console.log(`\n${category.toUpperCase()}`);
      console.log("=".repeat(50));

      for (const template of categoryTemplates) {
        console.log(`\n${template.name} (${template.id})`);
        console.log(`  ${template.description}`);
        console.log(`  Tags: ${template.tags.join(', ')}`);
        console.log(`  Author: ${template.author}`);
      }
    }

    console.log(`\n\nTotal: ${templates.length} template(s)`);
    console.log("\n💡 Use a template:");
    console.log("   agent-deploy init <template-id> [-n <your-agent-name>]");
  } catch (error) {
    handleCommandError(error as Error, 'templates');
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // No arguments - show help
  if (args.length === 0) {
    console.error("❌ No command specified\n");
    printHelp();
    process.exit(1);
  }

  // Handle flags
  if (args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return;
  }

  if (args[0] === "--version" || args[0] === "-v") {
    printVersion();
    return;
  }

  // Handle commands
  const command = args[0];

  if (command === "import") {
    await handleImportCommand(args.slice(1));
  } else if (command === "upload") {
    await handleUploadCommand(args.slice(1));
  } else if (command === "deploy") {
    await handleDeployCommand(args.slice(1));
  } else if (command === "run") {
    await handleRunCommand(args.slice(1));
  } else if (command === "use") {
    await handleUseCommand(args.slice(1));
  } else if (command === "list") {
    await handleListCommand(args.slice(1));
  } else if (command === "search") {
    await handleSearchCommand(args.slice(1));
  } else if (command === "info") {
    await handleInfoCommand(args.slice(1));
  } else if (command === "init") {
    await handleInitCommand(args.slice(1));
  } else if (command === "templates") {
    await handleTemplatesCommand(args.slice(1));
  } else if (command === "team") {
    await handleTeamCommand(args.slice(1));
  } else if (command === "workflow") {
    await handleWorkflowCommand(args.slice(1));
  } else if (command === "check-updates") {
    await handleCheckUpdatesCommand(args.slice(1));
  } else if (command === "clean") {
    await handleCleanCommand(args.slice(1));
  } else if (command === "validate") {
    await handleValidateCommand(args.slice(1));
  } else if (command === "preview") {
    await handlePreviewCommand(args.slice(1));
  } else {
    console.error(`❌ Unknown command: ${command}\n`);
    console.error("Available commands: import, upload, deploy, run, use, list, search, info, init, templates, team, workflow, clean, validate, preview");
    console.error("Run 'agent-deploy --help' for more information");
    process.exit(1);
  }
}

/**
 * Validate agent.json / worker.yaml structure (config-only, no execution).
 */
async function handleValidateCommand(args: string[]) {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: {
        help: { type: "boolean", short: "h", default: false },
        "worker-yaml": { type: "string" },
        json: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    if (values.help) {
      console.log(`
Usage: agent-deploy validate <agent-dir> [options]

Validate agent.json and/or worker.yaml structure without executing.

Arguments:
  <agent-dir>           Path to agent directory containing agent.json

Options:
  --worker-yaml <path>  Path to worker.yaml (default: <agent-dir>/worker.yaml)
  --json                Output result as JSON
  -h, --help            Show this help message

Examples:
  agent-deploy validate ./agents/my-agent
  agent-deploy validate ./agents/my-agent --worker-yaml ./agents/my-agent/pipeline.yaml
      `);
      return;
    }

    const agentDir = positionals[0];
    if (!agentDir) {
      console.error("Error: agent directory is required\n");
      console.error("Usage: agent-deploy validate <agent-dir>");
      process.exit(1);
    }

    const resolvedDir = resolve(agentDir);
    const agentJsonPath = path.join(resolvedDir, "agent.json");

    // Validate agent.json
    const agentResult = validateAgentJson(agentJsonPath);

    // Validate worker.yaml (if exists)
    const workerYamlPath = values["worker-yaml"]
      ? resolve(values["worker-yaml"] as string)
      : path.join(resolvedDir, "worker.yaml");
    let workerResult = null;
    if (existsSync(workerYamlPath)) {
      try {
        const raw = fs.readFileSync(workerYamlPath, "utf-8");
        const workerYaml = yaml.load(raw) as any;
        workerResult = validateWorkerYaml(workerYamlPath);
        // Store parsed data for potential preview use
        (workerResult as any)._parsed = workerYaml;
      } catch (e: any) {
        workerResult = {
          valid: false,
          errors: [{ field: "file", message: `Failed to parse worker.yaml: ${e.message}`, severity: "error" as const }],
          warnings: [],
        };
      }
    }

    // Output
    if (values.json) {
      console.log(JSON.stringify({ agent: agentResult, worker: workerResult }, null, 2));
    } else {
      console.log(formatValidationResult(agentResult));
      if (workerResult) {
        console.log("\n--- worker.yaml ---");
        console.log(formatValidationResult(workerResult));
      } else {
        console.log("\n(No worker.yaml found — skipping pipeline validation)");
      }

      const allValid = agentResult.valid && (workerResult === null || workerResult.valid);
      console.log(`\nOverall: ${allValid ? "VALID" : "INVALID"}`);
      if (!allValid) {
        process.exit(1);
      }
    }
  } catch (error) {
    handleCommandError(error as Error, "validate");
  }
}

/**
 * Preview pipeline execution flow (dry-run, no execution).
 */
async function handlePreviewCommand(args: string[]) {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: {
        help: { type: "boolean", short: "h", default: false },
        "worker-yaml": { type: "string" },
        format: { type: "string", default: "text" },
        "dry-run": { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    if (values.help) {
      console.log(`
Usage: agent-deploy preview <agent-dir> [options]

Preview pipeline execution flow without executing.

Arguments:
  <agent-dir>           Path to agent directory containing worker.yaml

Options:
  --worker-yaml <path>  Path to worker.yaml (default: <agent-dir>/worker.yaml)
  --format <format>     Output format: text, mermaid (default: text)
  --dry-run             Simulate execution with mock inputs/outputs
  -h, --help            Show this help message

Examples:
  agent-deploy preview ./agents/my-agent
  agent-deploy preview ./agents/my-agent --format mermaid
  agent-deploy preview ./agents/my-agent --dry-run
      `);
      return;
    }

    const agentDir = positionals[0];
    if (!agentDir) {
      console.error("Error: agent directory is required\n");
      console.error("Usage: agent-deploy preview <agent-dir>");
      process.exit(1);
    }

    const resolvedDir = resolve(agentDir);
    const workerYamlPath = values["worker-yaml"]
      ? resolve(values["worker-yaml"] as string)
      : path.join(resolvedDir, "worker.yaml");

    if (!existsSync(workerYamlPath)) {
      console.error(`Error: worker.yaml not found at ${workerYamlPath}`);
      process.exit(1);
    }

    const raw = fs.readFileSync(workerYamlPath, "utf-8");
    const workerYaml = yaml.load(raw) as any;

    if (!workerYaml.pipeline || !Array.isArray(workerYaml.pipeline)) {
      console.error("Error: worker.yaml must contain a 'pipeline' array");
      process.exit(1);
    }

    const format = values.format as string;

    if (format === "mermaid") {
      console.log(generateMermaidDiagram(workerYaml));
    } else if (values["dry-run"]) {
      const results = dryRunPipeline(workerYaml);
      console.log(formatDryRunResult(results));
    } else {
      const previews = previewPipeline(workerYaml);
      console.log(formatPipelinePreview(previews));
    }
  } catch (error) {
    handleCommandError(error as Error, "preview");
  }
}

/**
 * Clean global agent installations from AI tool directories.
 */
async function handleCleanCommand(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Usage: agent-deploy clean [agent-name]

Remove globally installed agents from AI tool directories.
Without arguments, lists all global installations.

Arguments:
  [agent-name]    Name of agent to remove (optional)

Examples:
  agent-deploy clean                      # List global installations
  agent-deploy clean code-reviewer        # Remove code-reviewer from all tools
`);
    return;
  }

  const targetName = positionals[0];

  // Safety whitelist — never clean these (user's own tools/MCP skills)
  const SAFE_LIST = ["tapd", "flow-mcp", "aliyun-sls-logs", "bark", "commit"];

  if (targetName && SAFE_LIST.includes(targetName)) {
    console.log(`⚠️  '${targetName}' is protected. Use system tools to manage this skill.\n`);
    return;
  }

  const globalPaths = [
    path.join(homedir(), ".codebuddy", "skills"),
    path.join(homedir(), ".codebuddy", "agents"),
    path.join(homedir(), ".claude", "commands"),
  ];

  let cleaned = 0;

  for (const dir of globalPaths) {
    if (!fs.existsSync(dir)) continue;

    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (targetName && entry !== targetName && !entry.startsWith(targetName + ".") && !entry.startsWith(targetName)) continue;

      // Skip protected entries
      if (!targetName && SAFE_LIST.some(s => entry === s || entry.startsWith(s + ".") || entry.startsWith(s))) {
        continue;
      }

      const fullPath = path.join(dir, entry);
      if (fs.statSync(fullPath).isFile() || fs.statSync(fullPath).isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`🧹 Removed: ${fullPath}`);
        cleaned++;
      }
    }
  }

  if (cleaned === 0) {
    console.log("📁 No global installations found" + (targetName ? ` for '${targetName}'` : "") + ".");
  } else {
    console.log(`\n✅ Cleaned ${cleaned} file(s). Agents now only exist locally in ./agents/`);
  }
}

/**
 * Handle team subcommand
 */
async function handleTeamCommand(args: string[]) {
  const action = args[0] || "help";

  if (action === "help" || action === "--help" || action === "-h") {
    console.log(`
Usage: agent-deploy team <action> [options]

Actions:
  package <team-dir> [-o <dir>]           Package team directory into tar.gz
  upload <team-dir> [options]             Upload team to Market
  download <team-name> [-o <dir>] [opts]  Download team from Market
  list [options]                          List teams (search Market)
  validate <team-dir>                     Validate team.json structure

Upload Options:
  --market <url>     Market API URL (default: $MARKET_API_URL or http://localhost:8321)
  --api-key <key>    API key for authentication (default: $MARKET_API_KEY)
  --force            Force overwrite existing version

Download Options:
  -o, --output <dir>  Output directory (default: ./downloaded-teams)
  --version <ver>     Specific version to download
  --market <url>      Market API URL

List Options:
  --tag <tag>         Filter by tag
  --category <cat>    Filter by category
  --market <url>      Market API URL

Examples:
  agent-deploy team package ./my-team -o ./dist
  agent-deploy team upload ./my-team --market http://localhost:8321 --api-key mykey --force
  agent-deploy team download content-gen-team -o ./output --market http://localhost:8321
  agent-deploy team list --tag automation
  agent-deploy team validate ./my-team
`);
    return;
  }

  if (action === "package") {
    try {
      const { values, positionals } = parseArgs({
        args: args.slice(1),
        options: {
          output: { type: "string", short: "o" },
          help: { type: "boolean", short: "h", default: false },
        },
        allowPositionals: true,
      });

      if (values.help) {
        console.log("Package a team directory into a tar.gz archive.\n");
        console.log("Usage: agent-deploy team package <team-dir> [-o <dir>]");
        return;
      }

      const teamDir = positionals[0];
      if (!teamDir) {
        console.error("❌ Error: team directory is required\n");
        console.error("Usage: agent-deploy team package <team-dir> [-o <dir>]");
        process.exit(1);
      }

      const resolvedPath = resolve(teamDir);
      if (!existsSync(resolvedPath)) {
        throw ErrorHandlers.fileNotFound(resolvedPath, 'directory');
      }

      const teamJsonPath = path.join(resolvedPath, "team.json");
      if (!existsSync(teamJsonPath)) {
        console.error(`❌ Error: team.json not found in ${resolvedPath}`);
        process.exit(1);
      }

      const teamJson = JSON.parse(fs.readFileSync(teamJsonPath, "utf-8"));
      const teamName = teamJson.identity?.name || teamJson.name || path.basename(resolvedPath);
      const version = teamJson.identity?.version || teamJson.version || "0.0.0";

      const outputDir = values.output ? resolve(values.output as string) : resolve("./dist");

      console.log("📦 Packaging team...\n");
      const packagePath = await packDirectoryToTarGz(resolvedPath, outputDir, teamName, version);

      console.log(`✅ Team packaged successfully!\n`);
      console.log(`Team:    ${teamName} v${version}`);
      console.log(`Output:  ${packagePath}`);
    } catch (error) {
      handleCommandError(error as Error, "team package");
    }
    return;
  }

  if (action === "upload") {
    try {
      const { values, positionals } = parseArgs({
        args: args.slice(1),
        options: {
          market: { type: "string" },
          "api-key": { type: "string" },
          force: { type: "boolean", default: false },
          help: { type: "boolean", short: "h", default: false },
        },
        allowPositionals: true,
      });

      if (values.help) {
        console.log("Upload a team to the Market.\n");
        console.log("Usage: agent-deploy team upload <team-dir> [options]");
        return;
      }

      const teamDir = positionals[0];
      if (!teamDir) {
        console.error("❌ Error: team directory is required\n");
        console.error("Usage: agent-deploy team upload <team-dir> [options]");
        process.exit(1);
      }

      const resolvedPath = resolve(teamDir);
      if (!existsSync(resolvedPath)) {
        throw ErrorHandlers.fileNotFound(resolvedPath, 'directory');
      }

      console.log("📤 Uploading team to Market...\n");

      const result = await uploadTeam({
        teamDir: resolvedPath,
        marketUrl: values.market as string | undefined,
        apiKey: values["api-key"] as string | undefined,
        force: values.force as boolean,
      });

      console.log("✅ Successfully uploaded team!\n");
      console.log(`Team ID:    ${result.team_id}`);
      console.log(`Name:       ${result.team_name}`);
      console.log(`Version:    ${result.version}`);
      console.log(`Market URL: ${result.market_url}\n`);
    } catch (error) {
      handleCommandError(error as Error, "team upload");
    }
    return;
  }

  if (action === "download") {
    try {
      const { values, positionals } = parseArgs({
        args: args.slice(1),
        options: {
          output: { type: "string", short: "o" },
          version: { type: "string" },
          market: { type: "string" },
          help: { type: "boolean", short: "h", default: false },
        },
        allowPositionals: true,
      });

      if (values.help) {
        console.log("Download a team from the Market.\n");
        console.log("Usage: agent-deploy team download <team-name> [-o <dir>] [options]");
        return;
      }

      const teamName = positionals[0];
      if (!teamName) {
        console.error("❌ Error: team name is required\n");
        console.error("Usage: agent-deploy team download <team-name> [options]");
        process.exit(1);
      }

      const outputDir = values.output ? resolve(values.output as string) : resolve("./downloaded-teams");

      console.log(`📥 Downloading team: ${teamName}...\n`);

      const result = await downloadTeam({
        teamId: teamName,
        outputDir,
        version: values.version as string | undefined,
        marketUrl: values.market as string | undefined,
      });

      console.log("✅ Successfully downloaded team!\n");
      console.log(`Output: ${result.output_path}`);
    } catch (error) {
      handleCommandError(error as Error, "team download");
    }
    return;
  }

  if (action === "list") {
    try {
      const { values } = parseArgs({
        args: args.slice(1),
        options: {
          tag: { type: "string" },
          category: { type: "string" },
          market: { type: "string" },
          help: { type: "boolean", short: "h", default: false },
        },
        allowPositionals: true,
      });

      if (values.help) {
        console.log("List teams from the Market.\n");
        console.log("Usage: agent-deploy team list [options]");
        return;
      }

      console.log("📋 Listing teams...\n");

      const result = await searchTeams({
        tag: values.tag as string | undefined,
        category: values.category as string | undefined,
      }, values.market as string | undefined);

      if (!result.teams || result.teams.length === 0) {
        console.log("No teams found.");
        return;
      }

      const header = ["NAME", "VERSION", "AUTHOR", "CATEGORY", "TAGS", "DOWNLOADS"];
      const rows = result.teams.map(t => [
        t.name,
        t.version,
        t.author || "-",
        t.category || "-",
        (t.tags || []).join(", ") || "-",
        String(t.downloads || 0),
      ]);

      printTable(header, rows);
      console.log(`\nTotal: ${result.total} team(s)`);
    } catch (error) {
      handleCommandError(error as Error, "team list");
    }
    return;
  }

  if (action === "validate") {
    try {
      const { values, positionals } = parseArgs({
        args: args.slice(1),
        options: {
          help: { type: "boolean", short: "h", default: false },
        },
        allowPositionals: true,
      });

      if (values.help) {
        console.log("Validate team.json structure.\n");
        console.log("Usage: agent-deploy team validate <team-dir>");
        return;
      }

      const teamDir = positionals[0];
      if (!teamDir) {
        console.error("❌ Error: team directory is required\n");
        console.error("Usage: agent-deploy team validate <team-dir>");
        process.exit(1);
      }

      const resolvedPath = resolve(teamDir);
      if (!existsSync(resolvedPath)) {
        throw ErrorHandlers.fileNotFound(resolvedPath, 'directory');
      }

      const teamJsonPath = path.join(resolvedPath, "team.json");
      if (!existsSync(teamJsonPath)) {
        console.error(`❌ Error: team.json not found in ${resolvedPath}`);
        process.exit(1);
      }

      console.log("🔍 Validating team.json...\n");

      const teamJson = JSON.parse(fs.readFileSync(teamJsonPath, "utf-8"));
      const errors: string[] = [];

      const identity = teamJson.identity || teamJson;
      if (!identity.name || typeof identity.name !== "string") {
        errors.push("Missing required field: identity.name");
      }
      if (!identity.version || typeof identity.version !== "string") {
        errors.push("Missing required field: identity.version");
      }

      if (errors.length > 0) {
        console.error("❌ Validation failed:\n");
        errors.forEach(e => console.error(`  - ${e}`));
        process.exit(1);
      }

      console.log("✅ team.json is valid!\n");
      console.log(`Name:    ${identity.name}`);
      console.log(`Version: ${identity.version}`);
      if (identity.display_name) console.log(`Display: ${identity.display_name}`);
      if (identity.description) console.log(`Desc:    ${identity.description.substring(0, 80)}`);
      if (identity.author) console.log(`Author:  ${identity.author}`);
      if (identity.tags && identity.tags.length > 0) {
        console.log(`Tags:    ${identity.tags.join(", ")}`);
      }
    } catch (error) {
      handleCommandError(error as Error, "team validate");
    }
    return;
  }

  console.error(`❌ Unknown team action: ${action}\n`);
  console.error("Available actions: package, upload, download, list, validate");
  console.error("Run 'agent-deploy team help' for more information");
  process.exit(1);
}

/**
 * Handle workflow subcommand
 */
async function handleWorkflowCommand(args: string[]) {
  const action = args[0] || "help";

  if (action === "help" || action === "--help" || action === "-h") {
    console.log(`
Usage: agent-deploy workflow <action> [options]

Actions:
  package <workflow-dir> [-o <dir>]           Package workflow directory into tar.gz
  upload <workflow-dir> [options]             Upload workflow to Market
  download <workflow-name> [-o <dir>] [opts]  Download workflow from Market
  list [options]                              List workflows (search Market)
  validate <workflow-dir>                     Validate workflow.json structure

Upload Options:
  --market <url>     Market API URL (default: $MARKET_API_URL or http://localhost:8321)
  --api-key <key>    API key for authentication (default: $MARKET_API_KEY)
  --force            Force overwrite existing version

Download Options:
  -o, --output <dir>  Output directory (default: ./downloaded-workflows)
  --version <ver>     Specific version to download
  --market <url>      Market API URL

List Options:
  --tag <tag>         Filter by tag
  --category <cat>    Filter by category
  --market <url>      Market API URL

Examples:
  agent-deploy workflow package ./my-workflow -o ./dist
  agent-deploy workflow upload ./my-workflow --market http://localhost:8321 --api-key mykey --force
  agent-deploy workflow download data-pipeline -o ./output --market http://localhost:8321
  agent-deploy workflow list --tag automation
  agent-deploy workflow validate ./my-workflow
`);
    return;
  }

  if (action === "package") {
    try {
      const { values, positionals } = parseArgs({
        args: args.slice(1),
        options: {
          output: { type: "string", short: "o" },
          help: { type: "boolean", short: "h", default: false },
        },
        allowPositionals: true,
      });

      if (values.help) {
        console.log("Package a workflow directory into a tar.gz archive.\n");
        console.log("Usage: agent-deploy workflow package <workflow-dir> [-o <dir>]");
        return;
      }

      const workflowDir = positionals[0];
      if (!workflowDir) {
        console.error("❌ Error: workflow directory is required\n");
        console.error("Usage: agent-deploy workflow package <workflow-dir> [-o <dir>]");
        process.exit(1);
      }

      const resolvedPath = resolve(workflowDir);
      if (!existsSync(resolvedPath)) {
        throw ErrorHandlers.fileNotFound(resolvedPath, 'directory');
      }

      const workflowJsonPath = path.join(resolvedPath, "workflow.json");
      if (!existsSync(workflowJsonPath)) {
        console.error(`❌ Error: workflow.json not found in ${resolvedPath}`);
        process.exit(1);
      }

      const workflowJson = JSON.parse(fs.readFileSync(workflowJsonPath, "utf-8"));
      const workflowName = workflowJson.identity?.name || workflowJson.name || path.basename(resolvedPath);
      const version = workflowJson.identity?.version || workflowJson.version || "0.0.0";

      const outputDir = values.output ? resolve(values.output as string) : resolve("./dist");

      console.log("📦 Packaging workflow...\n");
      const packagePath = await packDirectoryToTarGz(resolvedPath, outputDir, workflowName, version);

      console.log(`✅ Workflow packaged successfully!\n`);
      console.log(`Workflow:  ${workflowName} v${version}`);
      console.log(`Output:    ${packagePath}`);
    } catch (error) {
      handleCommandError(error as Error, "workflow package");
    }
    return;
  }

  if (action === "upload") {
    try {
      const { values, positionals } = parseArgs({
        args: args.slice(1),
        options: {
          market: { type: "string" },
          "api-key": { type: "string" },
          force: { type: "boolean", default: false },
          help: { type: "boolean", short: "h", default: false },
        },
        allowPositionals: true,
      });

      if (values.help) {
        console.log("Upload a workflow to the Market.\n");
        console.log("Usage: agent-deploy workflow upload <workflow-dir> [options]");
        return;
      }

      const workflowDir = positionals[0];
      if (!workflowDir) {
        console.error("❌ Error: workflow directory is required\n");
        console.error("Usage: agent-deploy workflow upload <workflow-dir> [options]");
        process.exit(1);
      }

      const resolvedPath = resolve(workflowDir);
      if (!existsSync(resolvedPath)) {
        throw ErrorHandlers.fileNotFound(resolvedPath, 'directory');
      }

      console.log("📤 Uploading workflow to Market...\n");

      const result = await uploadWorkflow({
        workflowDir: resolvedPath,
        marketUrl: values.market as string | undefined,
        apiKey: values["api-key"] as string | undefined,
        force: values.force as boolean,
      });

      console.log("✅ Successfully uploaded workflow!\n");
      console.log(`Workflow ID: ${result.workflow_id}`);
      console.log(`Name:        ${result.workflow_name}`);
      console.log(`Version:     ${result.version}`);
      console.log(`Market URL:  ${result.market_url}\n`);
    } catch (error) {
      handleCommandError(error as Error, "workflow upload");
    }
    return;
  }

  if (action === "download") {
    try {
      const { values, positionals } = parseArgs({
        args: args.slice(1),
        options: {
          output: { type: "string", short: "o" },
          version: { type: "string" },
          market: { type: "string" },
          help: { type: "boolean", short: "h", default: false },
        },
        allowPositionals: true,
      });

      if (values.help) {
        console.log("Download a workflow from the Market.\n");
        console.log("Usage: agent-deploy workflow download <workflow-name> [-o <dir>] [options]");
        return;
      }

      const workflowName = positionals[0];
      if (!workflowName) {
        console.error("❌ Error: workflow name is required\n");
        console.error("Usage: agent-deploy workflow download <workflow-name> [options]");
        process.exit(1);
      }

      const outputDir = values.output ? resolve(values.output as string) : resolve("./downloaded-workflows");

      console.log(`📥 Downloading workflow: ${workflowName}...\n`);

      const result = await downloadWorkflow({
        workflowId: workflowName,
        outputDir,
        version: values.version as string | undefined,
        marketUrl: values.market as string | undefined,
      });

      console.log("✅ Successfully downloaded workflow!\n");
      console.log(`Output: ${result.output_path}`);
    } catch (error) {
      handleCommandError(error as Error, "workflow download");
    }
    return;
  }

  if (action === "list") {
    try {
      const { values } = parseArgs({
        args: args.slice(1),
        options: {
          tag: { type: "string" },
          category: { type: "string" },
          market: { type: "string" },
          help: { type: "boolean", short: "h", default: false },
        },
        allowPositionals: true,
      });

      if (values.help) {
        console.log("List workflows from the Market.\n");
        console.log("Usage: agent-deploy workflow list [options]");
        return;
      }

      console.log("📋 Listing workflows...\n");

      const result = await searchWorkflows({
        tag: values.tag as string | undefined,
        category: values.category as string | undefined,
      }, values.market as string | undefined);

      if (!result.workflows || result.workflows.length === 0) {
        console.log("No workflows found.");
        return;
      }

      const header = ["NAME", "VERSION", "AUTHOR", "CATEGORY", "TAGS", "DOWNLOADS"];
      const rows = result.workflows.map(w => [
        w.name,
        w.version,
        w.author || "-",
        w.category || "-",
        (w.tags || []).join(", ") || "-",
        String(w.downloads || 0),
      ]);

      printTable(header, rows);
      console.log(`\nTotal: ${result.total} workflow(s)`);
    } catch (error) {
      handleCommandError(error as Error, "workflow list");
    }
    return;
  }

  if (action === "validate") {
    try {
      const { values, positionals } = parseArgs({
        args: args.slice(1),
        options: {
          help: { type: "boolean", short: "h", default: false },
        },
        allowPositionals: true,
      });

      if (values.help) {
        console.log("Validate workflow.json structure.\n");
        console.log("Usage: agent-deploy workflow validate <workflow-dir>");
        return;
      }

      const workflowDir = positionals[0];
      if (!workflowDir) {
        console.error("❌ Error: workflow directory is required\n");
        console.error("Usage: agent-deploy workflow validate <workflow-dir>");
        process.exit(1);
      }

      const resolvedPath = resolve(workflowDir);
      if (!existsSync(resolvedPath)) {
        throw ErrorHandlers.fileNotFound(resolvedPath, 'directory');
      }

      const workflowJsonPath = path.join(resolvedPath, "workflow.json");
      if (!existsSync(workflowJsonPath)) {
        console.error(`❌ Error: workflow.json not found in ${resolvedPath}`);
        process.exit(1);
      }

      console.log("🔍 Validating workflow.json...\n");

      const workflowJson = JSON.parse(fs.readFileSync(workflowJsonPath, "utf-8"));
      const errors: string[] = [];

      const identity = workflowJson.identity || workflowJson;
      if (!identity.name || typeof identity.name !== "string") {
        errors.push("Missing required field: identity.name");
      }
      if (!identity.version || typeof identity.version !== "string") {
        errors.push("Missing required field: identity.version");
      }

      if (errors.length > 0) {
        console.error("❌ Validation failed:\n");
        errors.forEach(e => console.error(`  - ${e}`));
        process.exit(1);
      }

      console.log("✅ workflow.json is valid!\n");
      console.log(`Name:    ${identity.name}`);
      console.log(`Version: ${identity.version}`);
      if (identity.display_name) console.log(`Display: ${identity.display_name}`);
      if (identity.description) console.log(`Desc:    ${identity.description.substring(0, 80)}`);
      if (identity.author) console.log(`Author:  ${identity.author}`);
      if (identity.tags && identity.tags.length > 0) {
        console.log(`Tags:    ${identity.tags.join(", ")}`);
      }
    } catch (error) {
      handleCommandError(error as Error, "workflow validate");
    }
    return;
  }

  console.error(`❌ Unknown workflow action: ${action}\n`);
  console.error("Available actions: package, upload, download, list, validate");
  console.error("Run 'agent-deploy workflow help' for more information");
  process.exit(1);
}

/**
 * Print a simple table to console
 */
function printTable(header: string[], rows: string[][]) {
  const allRows = [header, ...rows];
  const colWidths = header.map((_, colIdx) =>
    Math.max(...allRows.map(row => (row[colIdx] || "").length))
  );

  const formatRow = (row: string[]) =>
    row.map((cell, i) => (cell || "").padEnd(colWidths[i])).join("  ");

  const separator = colWidths.map(w => "─".repeat(w)).join("  ");

  console.log(formatRow(header));
  console.log(separator);
  rows.forEach(row => console.log(formatRow(row)));
}

// Run CLI
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

