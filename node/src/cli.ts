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
import * as yaml from "js-yaml";
import { ImportManager } from "./import-manager.js";
import { CursorImportAdapter } from "./adapters/cursor-import.js";
import { ClaudeImportAdapter } from "./adapters/claude-import.js";
import { CodeBuddyImportAdapter } from "./adapters/codebuddy-import.js";
import { GitHubImportAdapter } from "./adapters/github-import.js";
import { uploadAgent, downloadAgent, MarketClient, listLocalAgents } from "./market.js";
import { adaptAgent } from "./adapt.js";
import { installAgent } from "./install.js";
import { detectAll } from "./detect.js";
import { ErrorHandlers, handleCommandError, UserFriendlyError } from "./errors.js";
import { listTemplates, getTemplate, initFromTemplate } from "./templates.js";
import { PipelineEngine, ConsoleLogger } from "./runtime/pipeline.js";
import { ToolRegistry } from "./runtime/tool-registry.js";
import { ExecutionContextManager } from "./runtime/context.js";
import { WorkerYaml } from "./runtime/types.js";
import { ReadFileTool } from "./runtime/tools/read-file.js";
import { WriteFileTool } from "./runtime/tools/write-file.js";
import { BashTool } from "./runtime/tools/bash.js";
import { GlobTool } from "./runtime/tools/glob.js";
import { LLMChatTool } from "./runtime/tools/llm-chat.js";
import { WebFetchTool } from "./runtime/tools/web-fetch.js";
import { WebSearchTool } from "./runtime/tools/web-search.js";
import { invokeAgentTool } from "./runtime/builtin-tools/invoke-agent.js";
import { V2CompatibilityLayer } from "./runtime/v2-compat.js";
import { getPolicyRegistry } from "./runtime/policy.js";
import { MCPToolLoader } from "./runtime/mcp-integration.js";
import { SkillLoader } from "./runtime/skill-integration.js";
import { registerMemoryTool } from "./runtime/memory-integration.js";
import { DependencyResolver } from "./runtime/dependency-resolver.js";

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
  agent-deploy run <agent-dir> [options]
  agent-deploy use <agent-id|agent-dir> [options]
  agent-deploy list [options]
  agent-deploy search <query> [options]
  agent-deploy info <agent-id> [options]
  agent-deploy init <template> [options]
  agent-deploy templates
  agent-deploy --help
  agent-deploy --version

Commands:
  import <source>       Import agent from AI tool format to agent.json
  upload <agent-dir>    Upload agent to Market
  deploy <agent-dir>    Deploy agent to AI coding tool(s)
  run <agent-dir>       Execute agent with runtime engine
  use <agent-id|dir>    Download from market + adapt + install in one step
  list                  List local agents
  search <query>        Search agents in Market
  info <agent-id>       Show detailed agent information
  init <template>       Create new agent from template
  templates             List available agent templates

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
  -h, --help            Show this help message

Run Options:
  --args <json>         Arguments to pass to agent (JSON object)
  --cwd <dir>           Working directory for agent execution (default: agent directory)
  --env <json>          Environment variables (JSON object)
  -v, --verbose         Verbose output (show step details)
  --trusted            Grant full trust to agent (allows bash, network, filesystem access)
  -h, --help            Show this help message

Use Options:
  -m, --market <url>    Market API URL (for downloading from market)
  -o, --output <dir>    Download output directory (default: ./downloaded-agents)
  -l, --level <level>   Install level: project, user, or both (default: both)
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

  # Run agent with runtime engine
  agent-deploy run ./agents/my-agent
  agent-deploy run ./agents/my-agent --args '{"input": "data"}'
  agent-deploy run ./agents/my-agent --verbose

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
        const adapted = await adaptAgent(resolvedPath, tool);

        // Install agent
        await installAgent(adapted.content, agentName, tool, level, false);

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

      console.log(`\n💡 Download with: agent-deploy download ${agent.id}`);
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
 * Handle run command
 */
async function handleRunCommand(args: string[]) {
  try {
    // Parse arguments
    const { values, positionals } = parseArgs({
      args,
      options: {
        args: { type: "string", multiple: true },
        cwd: { type: "string" },
        env: { type: "string", multiple: true },
        verbose: { type: "boolean", short: "v", default: false },
        trusted: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });

    if (values.help) {
      console.log(`
Usage: agent-deploy run <agent-dir> [options]

Execute an agent using the runtime engine.

Arguments:
  <agent-dir>           Path to agent directory (containing agent.json and worker.yaml)

Options:
  --args <key=value>    Arguments to pass to agent (key=value or JSON object, repeatable)
  --cwd <dir>           Working directory for agent execution (default: agent directory)
  --env <key=value>     Environment variables (key=value or JSON object, repeatable)
  -v, --verbose         Verbose output (show step details)
  -h, --help            Show this help message

Examples:
  agent-deploy run ./agents/my-agent
  agent-deploy run ./agents/processor --args file_path=data.txt --args lang=en
  agent-deploy run ./agents/processor --args '{"file_path":"data.txt"}'
  agent-deploy run ./agents/builder --cwd ./project --verbose
      `);
      return;
    }

    // Get agent directory
    const agentDir = positionals[0];
    if (!agentDir) {
      console.error("❌ Error: agent directory is required\n");
      console.error("Usage: agent-deploy run <agent-dir> [options]");
      console.error("Run 'agent-deploy run --help' for more information");
      process.exit(1);
    }

    // Resolve paths
    const resolvedAgentDir = resolve(agentDir);

    // Verify directory exists
    if (!existsSync(resolvedAgentDir)) {
      throw ErrorHandlers.fileNotFound(resolvedAgentDir, "directory");
    }

    // Verify agent.json exists
    const agentJsonPath = path.join(resolvedAgentDir, "agent.json");
    if (!existsSync(agentJsonPath)) {
      throw ErrorHandlers.missingAgentJson(resolvedAgentDir);
    }

    // Load agent.json
    const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
    const agentName = agentJson.identity?.name || agentJson.name || path.basename(resolvedAgentDir);

    // Use compatibility layer to get worker.yaml (supports v2 agents)
    const v2Compat = new V2CompatibilityLayer();
    let workerYaml: WorkerYaml;

    try {
      workerYaml = v2Compat.getWorkerYaml(resolvedAgentDir);

      // Show v2 compatibility message if applicable
      if (v2Compat.isV2Agent(agentJsonPath)) {
        console.log("ℹ️  v2 agent detected - running in compatibility mode\n");
      }
    } catch (error) {
      throw new Error(`Failed to load agent: ${(error as Error).message}`);
    }

    // Parse arguments: supports --args '{"key":"val"}' or --args key=value (multiple)
    let initialArgs: Record<string, any> = {};
    if (values.args) {
      const argsList = values.args as string[];
      // Single JSON object
      if (argsList.length === 1 && argsList[0].trimStart().startsWith("{")) {
        try {
          initialArgs = JSON.parse(argsList[0]);
        } catch (error) {
          console.error("❌ Error: Invalid JSON for --args");
          console.error(`   ${(error as Error).message}`);
          process.exit(1);
        }
      } else {
        // key=value pairs (one or more --args)
        for (const entry of argsList) {
          const eq = entry.indexOf("=");
          if (eq === -1) {
            initialArgs[entry] = true;
          } else {
            const k = entry.slice(0, eq);
            const v = entry.slice(eq + 1);
            // Try to coerce numbers and booleans
            if (v === "true") initialArgs[k] = true;
            else if (v === "false") initialArgs[k] = false;
            else if (!isNaN(Number(v)) && v !== "") initialArgs[k] = Number(v);
            else initialArgs[k] = v;
          }
        }
      }
    }

    // Parse environment variables: start with process.env, then override with --env
    let envVars: Record<string, string> = { ...process.env as Record<string, string> };
    if (values.env) {
      const envList = values.env as string[];
      if (envList.length === 1 && envList[0].trimStart().startsWith("{")) {
        try {
          envVars = JSON.parse(envList[0]);
        } catch (error) {
          console.error("❌ Error: Invalid JSON for --env");
          console.error(`   ${(error as Error).message}`);
          process.exit(1);
        }
      } else {
        for (const entry of envList) {
          const eq = entry.indexOf("=");
          if (eq !== -1) {
            envVars[entry.slice(0, eq)] = entry.slice(eq + 1);
          }
        }
      }
    }

    // Determine working directory
    const workingDir = values.cwd ? resolve(values.cwd as string) : resolvedAgentDir;

    // Display execution info
    console.log(`🚀 Running agent: ${agentName}\n`);
    console.log(`Agent directory: ${resolvedAgentDir}`);
    console.log(`Working directory: ${workingDir}`);
    if (Object.keys(initialArgs).length > 0) {
      console.log(`Arguments: ${JSON.stringify(initialArgs)}`);
    }
    if (Object.keys(envVars).length > 0) {
      console.log(`Environment: ${JSON.stringify(envVars)}`);
    }
    console.log();

    // Create tool registry with all builtin tools
    const registry = new ToolRegistry();
    registry.register(new ReadFileTool());
    registry.register(new WriteFileTool());
    registry.register(new BashTool());
    registry.register(new GlobTool());
    registry.register(new LLMChatTool());
    registry.register(new WebFetchTool());
    registry.register(new WebSearchTool());
    registry.register(invokeAgentTool);

    // Register MCP tools from agent's mcp/ directory (non-fatal if unavailable)
    const mcpLoader = new MCPToolLoader();
    await mcpLoader.registerMCPTools(resolvedAgentDir, registry);

    // Register skills from agent's skills/ directory
    const skillLoader = new SkillLoader();
    skillLoader.registerSkills(resolvedAgentDir, registry);

    // Register memory tool bound to agent directory
    registerMemoryTool(resolvedAgentDir, registry);

    // Security: apply execution policy
    const policyRegistry = getPolicyRegistry();
    if (values.trusted) {
      policyRegistry.trust(agentName);
      if (values.verbose) {
        console.log(`[SECURITY] Agent '${agentName}' is running in TRUSTED mode (full access granted)`);
      }
    } else {
      if (values.verbose) {
        console.log(`[SECURITY] Agent '${agentName}' is running in RESTRICTED mode (no bash, no network, cwd-only fs)`);
      }
    }

    // Create execution context, seeding sharedContext from worker.yaml
    const context = ExecutionContextManager.create({
      agent: { name: agentName, identity: { name: agentName } },
      initialArgs,
      cwd: workingDir,
      env: envVars,
      sharedContext: workerYaml.shared_context || {},
    });

    // Attach registry to context for invoke_agent (Phase 6 improvement)
    ToolRegistry.attach(registry, context);

    // Resolve dependencies declared in agent.json (Phase 6.3)
    const resolver = new DependencyResolver();
    try {
      console.log("📦 Resolving dependencies...");
      const deps = await resolver.resolve(resolvedAgentDir);

      if (deps.size > 0) {
        console.log(`  Dependencies found: ${deps.size}`);
        for (const [name, dep] of deps) {
          const sourceLabel = dep.source === "cache" ? "cached" : "downloaded";
          console.log(`    ✓ ${name}@${dep.version} (${sourceLabel})`);
        }
        console.log();
      }
    } catch (error) {
      // Dependency resolution failure is non-fatal — continues with execution
      console.log(`  ⚠️  Dependency resolution: ${(error as Error).message}`);
      console.log();
    }

    // Create pipeline engine with optional verbose logging
    const logger = new ConsoleLogger(values.verbose as boolean);
    const engine = new PipelineEngine(registry, logger);

    // Execute pipeline
    console.log("⏳ Executing pipeline...\n");
    const startTime = Date.now();

    const result = await engine.execute(workerYaml, context);

    const duration = Date.now() - startTime;

    // Display results
    console.log("\n✅ Pipeline execution completed!\n");
    console.log(`Duration: ${duration}ms`);

    // Show execution summary
    const summary = ExecutionContextManager.getSummary(context);
    console.log(`\nExecution Summary:`);
    console.log(`  Total steps:    ${summary.total_steps}`);
    console.log(`  Successful:     ${summary.successful_steps}`);
    console.log(`  Failed:         ${summary.failed_steps}`);

    // Show result
    if (result !== null && result !== undefined) {
      console.log(`\nResult:`);
      if (typeof result === "object") {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(result);
      }
    }

    // Exit with appropriate code
    if (summary.failed_steps > 0) {
      process.exit(1);
    }
  } catch (error) {
    handleCommandError(error as Error, "run");
  }
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
        level: { type: "string", short: "l", default: "both" },
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

    const level = (values.level as string) || "both";
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
      const outputDir = values.output ? resolve(values.output as string) : resolve("./downloaded-agents");

      const result = await downloadAgent({
        agentId: input,
        outputDir,
        marketUrl,
      });

      agentPath = result.output_path;
      console.log(`✅ Downloaded to: ${agentPath}\n`);
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

    // Auto-detect installed tools, always include codebuddy_agent
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
  } else {
    console.error(`❌ Unknown command: ${command}\n`);
    console.error("Available commands: import, upload, deploy, run, use, list, search, info, init, templates");
    console.error("Run 'agent-deploy --help' for more information");
    process.exit(1);
  }
}

// Run CLI
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
