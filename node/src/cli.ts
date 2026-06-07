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
        args: { type: "string" },
        cwd: { type: "string" },
        env: { type: "string" },
        verbose: { type: "boolean", short: "v", default: false },
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
  --args <json>         Arguments to pass to agent (JSON object)
  --cwd <dir>           Working directory for agent execution (default: agent directory)
  --env <json>          Environment variables (JSON object)
  -v, --verbose         Verbose output (show step details)
  -h, --help            Show this help message

Examples:
  agent-deploy run ./agents/my-agent
  agent-deploy run ./agents/processor --args '{"input": "data.txt"}'
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

    // Verify worker.yaml exists
    const workerYamlPath = path.join(resolvedAgentDir, "worker.yaml");
    if (!existsSync(workerYamlPath)) {
      throw new Error(`worker.yaml not found in agent directory: ${resolvedAgentDir}`);
    }

    // Load agent.json
    const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
    const agentName = agentJson.identity?.name || agentJson.name || path.basename(resolvedAgentDir);

    // Load worker.yaml
    const workerYaml = yaml.load(fs.readFileSync(workerYamlPath, "utf-8")) as WorkerYaml;

    // Parse arguments
    let initialArgs: Record<string, any> = {};
    if (values.args) {
      try {
        initialArgs = JSON.parse(values.args as string);
      } catch (error) {
        console.error("❌ Error: Invalid JSON for --args");
        console.error(`   ${(error as Error).message}`);
        process.exit(1);
      }
    }

    // Parse environment variables
    let envVars: Record<string, string> = {};
    if (values.env) {
      try {
        envVars = JSON.parse(values.env as string);
      } catch (error) {
        console.error("❌ Error: Invalid JSON for --env");
        console.error(`   ${(error as Error).message}`);
        process.exit(1);
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

    // Create execution context
    const context = ExecutionContextManager.create({
      agent: { name: agentName },
      initialArgs,
      cwd: workingDir,
      env: envVars,
    });

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
    console.error("Available commands: import, upload, deploy, run, list, search, info, init, templates");
    console.error("Run 'agent-deploy --help' for more information");
    process.exit(1);
  }
}

// Run CLI
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
