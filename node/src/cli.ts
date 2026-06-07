#!/usr/bin/env node
/**
 * agent-deploy CLI
 * Command-line interface for deploying and importing agents
 */

import { parseArgs } from "node:util";
import { existsSync } from "fs";
import { resolve } from "path";
import { ImportManager } from "./import-manager.js";
import { CursorImportAdapter } from "./adapters/cursor-import.js";
import { ClaudeImportAdapter } from "./adapters/claude-import.js";
import { CodeBuddyImportAdapter } from "./adapters/codebuddy-import.js";
import { GitHubImportAdapter } from "./adapters/github-import.js";
import { uploadAgent, downloadAgent } from "./market.js";
import { adaptAgent } from "./adapt.js";
import { installAgent } from "./install.js";
import { detectAll } from "./detect.js";

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
  agent-deploy --help
  agent-deploy --version

Commands:
  import <source>       Import agent from AI tool format to agent.json
  upload <agent-dir>    Upload agent to Market
  deploy <agent-dir>    Deploy agent to AI coding tool(s)

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

Examples:
  # Import from AI tool
  agent-deploy import .cursor/commands/my-agent.md

  # Upload to Market
  agent-deploy upload ./imported-agents/my-agent

  # Deploy to specific tool
  agent-deploy deploy ./imported-agents/my-agent -t cursor

  # Deploy to all detected tools
  agent-deploy deploy ./my-agent --tool all

  # Auto-detect and deploy
  agent-deploy deploy ./my-agent

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
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Import failed: ${msg}`);
    process.exit(1);
  }
}

/**
 * Handle upload command
 */
async function handleUploadCommand(args: string[]) {
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
    console.error(`❌ Error: agent directory not found: ${resolvedPath}`);
    process.exit(1);
  }

  // Verify agent.json exists
  const agentJsonPath = resolve(resolvedPath, "agent.json");
  if (!existsSync(agentJsonPath)) {
    console.error(`❌ Error: agent.json not found in ${resolvedPath}`);
    console.error("\nMake sure the directory contains a valid agent.json file");
    process.exit(1);
  }

  try {
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
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Upload failed: ${msg}`);

    if (msg.includes("401") || msg.includes("403")) {
      console.error("\n💡 Hint: Make sure you have a valid API key");
      console.error("   Set MARKET_API_KEY environment variable or use --api-key");
    } else if (msg.includes("409")) {
      console.error("\n💡 Hint: Agent version already exists");
      console.error("   Use --force to overwrite, or update version in agent.json");
    }

    process.exit(1);
  }
}

/**
 * Handle deploy command
 */
async function handleDeployCommand(args: string[]) {
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
    console.error(`❌ Error: agent directory not found: ${resolvedPath}`);
    process.exit(1);
  }

  // Verify agent.json exists
  const agentJsonPath = resolve(resolvedPath, "agent.json");
  if (!existsSync(agentJsonPath)) {
    console.error(`❌ Error: agent.json not found in ${resolvedPath}`);
    console.error("\nMake sure the directory contains a valid agent.json file");
    process.exit(1);
  }

  try {
    const targetTool = (values.tool as string) || "auto";
    const level = (values.level as string) || "both";

    // Detect tools if auto
    let toolsToInstall: string[] = [];

    if (targetTool === "auto") {
      const detected = detectAll();
      if (detected.length === 0) {
        console.error("❌ No AI coding tools detected");
        console.error("\nPlease specify a tool with --tool option");
        process.exit(1);
      }
      toolsToInstall = [detected[0].tool];
      console.log(`🔍 Auto-detected: ${detected[0].tool}\n`);
    } else if (targetTool === "all") {
      const detected = detectAll();
      if (detected.length === 0) {
        console.error("❌ No AI coding tools detected");
        process.exit(1);
      }
      toolsToInstall = detected.map(d => d.tool);
      console.log(`🔍 Detected ${detected.length} tool(s): ${toolsToInstall.join(", ")}\n`);
    } else {
      toolsToInstall = [targetTool];
    }

    // Read agent name
    const agentJson = JSON.parse(require("fs").readFileSync(agentJsonPath, "utf-8"));
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
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Deploy failed: ${msg}`);
    process.exit(1);
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
  } else {
    console.error(`❌ Unknown command: ${command}\n`);
    console.error("Available commands: import, upload, deploy");
    console.error("Run 'agent-deploy --help' for more information");
    process.exit(1);
  }
}

// Run CLI
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
