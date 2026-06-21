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
import { DependencyResolver } from "./runtime/dependency-resolver.js";
import { AgentLockFile } from "./lockfile.js";
import { validateAgentJson, validateWorkerYaml, formatValidationResult } from "./validator.js";
import { previewPipeline, formatPipelinePreview, generateMermaidDiagram, dryRunPipeline, formatDryRunResult } from "./preview.js";

const VERSION = "1.0.0";

// ============================================================
// i18n / Bilingual helpers
// ============================================================

function t(en: string, zh: string): string {
  return isZh() ? zh : en;
}

function isZh(): boolean {
  const envLang = process.env.LC_ALL || process.env.LANG || process.env.LANGUAGE || "";
  return envLang.toLowerCase().startsWith("zh");
}

// ============================================================
// Color / Style helpers
// ============================================================

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

function colorize(text: string, color: string): string {
  return `${color}${text}${ANSI.reset}`;
}

function success(text: string): string { return colorize(text, ANSI.green); }
function error(text: string): string { return colorize(text, ANSI.red); }
function warning(text: string): string { return colorize(text, ANSI.yellow); }
function info(text: string): string { return colorize(text, ANSI.cyan); }
function bold(text: string): string { return colorize(text, ANSI.bold); }

// ============================================================
// Progress Spinner
// ============================================================

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

class Spinner {
  private message: string;
  private delay: number;
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;

  constructor(message = "", delay = 80) {
    this.message = message || t("Processing ...", "处理中 ...");
    this.delay = delay;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.frameIndex = 0;
    this.timer = setInterval(() => {
      const frame = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length];
      process.stdout.write(`\r  ${frame} ${this.message}`);
      this.frameIndex++;
    }, this.delay);
  }

  stop(finalMessage?: string) {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    process.stdout.write("\r" + " ".repeat(this.message.length + 10) + "\r");
    if (finalMessage) {
      console.log(`  ${success("✓")} ${finalMessage}`);
    }
  }
}

// ============================================================
// Print help message (bilingual)
// ============================================================

function printHelp() {
  console.log(`
${bold("agent-deploy")} v${VERSION}

${t("Usage:", "用法:")}
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

${t("Commands:", "命令:")}
  import <source>       ${t("Import agent from AI tool format to agent.json", "从 AI 工具格式导入为 agent.json")}
  upload <agent-dir>    ${t("Upload agent to Market", "上传 Agent 到市场")}
  deploy <agent-dir>    ${t("Deploy agent to AI coding tool(s)", "部署 Agent 到 AI 编程工具")}
  use <agent-id|dir>    ${t("Download + adapt + install (local by default)", "下载 + 适配 + 安装 (默认本地)")}
  clean [agent-id]      ${t("Clean global agent installations", "清理全局 Agent 安装")}
  validate <agent-dir>  ${t("Validate agent.json / worker.yaml structure", "验证 agent.json / worker.yaml 结构")}
  preview <agent-dir>   ${t("Preview pipeline execution flow (dry-run)", "预览流水线执行流程 (dry-run)")}
  list                  ${t("List local agents", "列出本地 Agent")}
  search <query>        ${t("Search agents in Market", "在市场搜索 Agent")}
  info <agent-id>       ${t("Show detailed agent information", "显示 Agent 详细信息")}
  init <template>       ${t("Create new agent from template", "从模板创建新 Agent")}
  templates             ${t("List available agent templates", "列出可用模板")}
  team <action>         ${t("Manage teams (package/upload/download/list/validate)", "管理团队 (打包/上传/下载/列出/验证)")}
  workflow <action>     ${t("Manage workflows (package/upload/download/list/validate)", "管理工作流 (打包/上传/下载/列出/验证)")}
  check-updates         ${t("Check for updates to deployed agents", "检查已部署 Agent 的更新")}

${t("Import Options:", "导入选项:")}
  -o, --output <dir>    ${t("Output directory (default: ./imported-agents)", "输出目录 (默认: ./imported-agents)")}
  -t, --tool <name>     ${t("Force specific tool adapter", "强制指定工具适配器")}
                        ${t("Options: cursor, claude_code, codebuddy, github_copilot", "选项: cursor, claude_code, codebuddy, github_copilot")}
  -d, --dry-run         ${t("Preview import without writing files", "预览导入而不写入文件")}
  -h, --help            ${t("Show this help message", "显示此帮助信息")}

${t("Upload Options:", "上传选项:")}
  -m, --market <url>    ${t("Market API URL (default: $MARKET_API_URL or http://localhost:8321)", "市场 API URL (默认: $MARKET_API_URL 或 http://localhost:8321)")}
  -k, --api-key <key>   ${t("API key for authentication (default: $MARKET_API_KEY)", "API 认证密钥 (默认: $MARKET_API_KEY)")}
  -f, --force           ${t("Force overwrite existing version", "强制覆盖已有版本")}
  -h, --help            ${t("Show this help message", "显示此帮助信息")}

${t("Deploy Options:", "部署选项:")}
  -t, --tool <name>     ${t("Target tool (cursor, claude_code, codebuddy, etc.)", "目标工具 (cursor, claude_code, codebuddy 等)")}
                        ${t("Use 'auto' for auto-detect, 'all' for all detected tools", "使用 'auto' 自动检测, 'all' 部署到所有检测到的工具")}
  -l, --level <level>   ${t("Install level: project, user, or both (default: both)", "安装级别: project, user, 或 both (默认: both)")}
  -f, --target-file <path>  ${t("Target file path (relative) where agent should be installed (required)", "Agent 应安装到的目标文件路径 (相对路径, 必填)")}
  -h, --help            ${t("Show this help message", "显示此帮助信息")}

${t("Use Options:", "Use 选项:")}
  -m, --market <url>    ${t("Market API URL (for downloading from market)", "市场 API URL (用于从市场下载)")}
  -o, --output <dir>    ${t("Download output directory (default: ./downloaded-agents)", "下载输出目录 (默认: ./downloaded-agents)")}
  -l, --level <level>   ${t("Install level: project, user, or both (default: both)", "安装级别: project, user, 或 both (默认: both)")}
  --with-deps           ${t("Resolve and install dependencies recursively", "递归解析并安装依赖")}
  --no-deps             ${t("Skip dependency resolution (default: auto-resolve)", "跳过依赖解析 (默认: 自动解析)")}
  -h, --help            ${t("Show this help message", "显示此帮助信息")}

${t("List Options:", "List 选项:")}
  --type <type>         ${t("Filter by type: imported, downloaded, or all (default: all)", "按类型过滤: imported, downloaded, 或 all (默认: all)")}
  -o, --output <dir>    ${t("Base directory to scan (default: ./)", "扫描的基础目录 (默认: ./)")}
  -h, --help            ${t("Show this help message", "显示此帮助信息")}

${t("Search Options:", "Search 选项:")}
  --tag <tag>           ${t("Filter by tag", "按标签过滤")}
  --category <cat>      ${t("Filter by category", "按分类过滤")}
  --limit <n>           ${t("Max results (default: 20)", "最大结果数 (默认: 20)")}
  -m, --market <url>    ${t("Market API URL", "市场 API URL")}
  -h, --help            ${t("Show this help message", "显示此帮助信息")}

${t("Info Options:", "Info 选项:")}
  --local               ${t("Show local agent info (default: search Market)", "显示本地 Agent 信息 (默认: 搜索市场)")}
  -m, --market <url>    ${t("Market API URL (for Market info)", "市场 API URL (用于市场信息)")}
  -h, --help            ${t("Show this help message", "显示此帮助信息")}

${t("Init Options:", "Init 选项:")}
  -n, --name <name>     ${t("Agent name (default: use template name)", "Agent 名称 (默认: 使用模板名称)")}
  -o, --output <dir>    ${t("Output directory (default: ./agents)", "输出目录 (默认: ./agents)")}
  -h, --help            ${t("Show this help message", "显示此帮助信息")}

${t("Examples:", "示例:")}
  # ${t("Import from AI tool", "从 AI 工具导入")}
  agent-deploy import .cursor/commands/my-agent.md

  # ${t("Upload to Market", "上传到市场")}
  agent-deploy upload ./imported-agents/my-agent

  # ${t("Deploy to specific tool", "部署到指定工具")}
  agent-deploy deploy ./imported-agents/my-agent -t cursor

  # ${t("Download and install agent from Market", "从市场下载并安装 Agent")}
  agent-deploy use my-agent
  agent-deploy use my-agent -m http://market.example.com
  agent-deploy use ./test-agents/my-agent

  # ${t("List local agents", "列出本地 Agent")}
  agent-deploy list
  agent-deploy list --type imported

  # ${t("Search Market", "搜索市场")}
  agent-deploy search "code review"
  agent-deploy search typescript --tag security

  # ${t("Show agent info", "显示 Agent 信息")}
  agent-deploy info my-agent
  agent-deploy info my-agent --local

  # ${t("Create from template", "从模板创建")}
  agent-deploy init agent-builder -n my-builder
  agent-deploy templates

${t("Supported Platforms:", "支持的平台:")}
  - Cursor           (.cursor/commands/*.md)
  - Claude Code      (.claude/commands/*.md)
  - CodeBuddy        (.codebuddy/skills/*/SKILL.md)
  - GitHub Copilot   (.github/agents/*.md)

${t("For MCP server mode, run without arguments.", "MCP 服务器模式下, 不带参数运行即可。")}
  `);
}

/**
 * Print version
 */
function printVersion() {
  console.log(`agent-deploy v${VERSION}`);
}

// ============================================================
// Command handlers
// ============================================================

/**
 * Handle import command
 */
async function handleImportCommand(args: string[]) {
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

  if (values.help) {
    printHelp();
    return;
  }

  const sourcePath = positionals[0];
  if (!sourcePath) {
    console.error(error(t("Error: source path is required\n", "错误: 需要提供源路径\n")));
    console.error(t("Usage: agent-deploy import <source> [options]", "用法: agent-deploy import <source> [options]"));
    console.error(t("Run 'agent-deploy import --help' for more information", "运行 'agent-deploy import --help' 获取更多信息"));
    process.exit(1);
  }

  const resolvedSource = resolve(sourcePath);
  const outputDir = values.output ? resolve(values.output) : resolve("./imported-agents");
  const tool = values.tool as string | undefined;
  const dryRun = values["dry-run"] as boolean;

  if (!existsSync(resolvedSource)) {
    console.error(error(t(`Error: source file not found: ${resolvedSource}`, `错误: 找不到源文件: ${resolvedSource}`)));
    process.exit(1);
  }

  const manager = new ImportManager();
  manager.registerAdapter(new CursorImportAdapter());
  manager.registerAdapter(new ClaudeImportAdapter());
  manager.registerAdapter(new CodeBuddyImportAdapter());
  manager.registerAdapter(new GitHubImportAdapter());

  try {
    if (dryRun) {
      const spinner = new Spinner(t("Previewing import...", "正在预览导入..."));
      spinner.start();
      const descriptor = manager.dryRun(resolvedSource, tool);
      spinner.stop(t("Import preview ready", "导入预览就绪"));

      console.log(success(t("Import preview successful!\n", "导入预览成功!\n")));
      console.log(bold(t("Agent Details:", "Agent 详情:")));
      console.log(`  ${info(t("Name:", "名称:"))}         ${descriptor.identity.name}`);
      console.log(`  ${info(t("Version:", "版本:"))}      ${descriptor.identity.version}`);
      console.log(`  ${info(t("Display Name:", "显示名称:"))} ${descriptor.identity.display_name}`);
      console.log(`  ${info(t("Description:", "描述:"))}  ${descriptor.identity.description}`);
      console.log(`  ${info(t("Author:", "作者:"))}       ${descriptor.identity.author}`);
      console.log(`  ${info(t("Tags:", "标签:"))}         ${descriptor.identity.tags?.join(", ") || t("none", "无")}`);
      console.log();
      console.log(`${t("Output Path:", "输出路径:")}  ${outputDir}/${descriptor.identity.name}/agent.json`);
      console.log();
      console.log(warning(t("Run without --dry-run to write files", "去掉 --dry-run 以写入文件")));
    } else {
      const spinner = new Spinner(t("Importing agent...", "正在导入 Agent..."));
      spinner.start();
      const agentDir = manager.importAgent(resolvedSource, outputDir, tool);
      const agentJsonPath = `${agentDir}/agent.json`;
      spinner.stop(t("Import complete", "导入完成"));

      console.log(success(t("Successfully imported agent!\n", "成功导入 Agent!\n")));
      console.log(`${info(t("Source:", "源:"))}  ${resolvedSource}`);
      console.log(`${info(t("Output:", "输出:"))}  ${agentJsonPath}`);
      console.log();
      console.log(t("Next steps:", "下一步:"));
      console.log(t("  1. Review the generated agent.json", "  1. 检查生成的 agent.json"));
      console.log(t("  2. Upload to agent market (coming soon)", "  2. 上传到 Agent 市场 (即将推出)"));
      console.log(t("  3. Deploy to other AI tools with 'agent-deploy deploy'", "  3. 使用 'agent-deploy deploy' 部署到其他 AI 工具"));
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

    if (values.help) {
      printHelp();
      return;
    }

    const agentDir = positionals[0];
    if (!agentDir) {
      console.error(error(t("Error: agent directory is required\n", "错误: 需要提供 Agent 目录\n")));
      console.error(t("Usage: agent-deploy upload <agent-dir> [options]", "用法: agent-deploy upload <agent-dir> [options]"));
      console.error(t("Run 'agent-deploy upload --help' for more information", "运行 'agent-deploy upload --help' 获取更多信息"));
      process.exit(1);
    }

    const resolvedPath = resolve(agentDir);
    if (!existsSync(resolvedPath)) {
      throw ErrorHandlers.fileNotFound(resolvedPath, 'directory');
    }

    const agentJsonPath = resolve(resolvedPath, "agent.json");
    if (!existsSync(agentJsonPath)) {
      throw ErrorHandlers.missingAgentJson(resolvedPath);
    }

    const spinner = new Spinner(t("Uploading agent to Market...", "正在上传 Agent 到市场..."));
    spinner.start();
    const result = await uploadAgent({
      agentDir: resolvedPath,
      marketUrl: values.market as string | undefined,
      apiKey: values["api-key"] as string | undefined,
      force: values.force as boolean,
    });
    spinner.stop(t("Upload complete", "上传完成"));

    console.log(success(t("Successfully uploaded agent!\n", "成功上传 Agent!\n")));
    console.log(`${info(t("Agent ID:", "Agent ID:"))}     ${result.agent_id}`);
    console.log(`${info(t("Name:", "名称:"))}         ${result.agent_name}`);
    console.log(`${info(t("Version:", "版本:"))}      ${result.version}`);
    console.log(`${info(t("Market URL:", "市场 URL:"))}   ${result.market_url}\n`);

    console.log(t("Next steps:", "下一步:"));
    console.log(t("  1. Share the Market URL with others", "  1. 与他人分享市场 URL"));
    console.log(t("  2. Deploy to AI tools with 'agent-deploy deploy'", "  2. 使用 'agent-deploy deploy' 部署到 AI 工具"));
    console.log(t("  3. Check agent status in Market UI", "  3. 在市场 UI 中检查 Agent 状态"));
  } catch (error) {
    handleCommandError(error as Error, 'upload');
  }
}

/**
 * Handle deploy command
 */
async function handleDeployCommand(args: string[]) {
  try {
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

    if (values.help) {
      printHelp();
      return;
    }

    const agentDir = positionals[0];
    if (!agentDir) {
      console.error(error(t("Error: agent directory is required\n", "错误: 需要提供 Agent 目录\n")));
      console.error(t("Usage: agent-deploy deploy <agent-dir> [options]", "用法: agent-deploy deploy <agent-dir> [options]"));
      console.error(t("Run 'agent-deploy deploy --help' for more information", "运行 'agent-deploy deploy --help' 获取更多信息"));
      process.exit(1);
    }

    const resolvedPath = resolve(agentDir);
    if (!existsSync(resolvedPath)) {
      throw ErrorHandlers.fileNotFound(resolvedPath, 'directory');
    }

    const agentJsonPath = resolve(resolvedPath, "agent.json");
    if (!existsSync(agentJsonPath)) {
      throw ErrorHandlers.missingAgentJson(resolvedPath);
    }

    const targetTool = (values.tool as string) || "auto";
    const level = (values.level as string) || "both";
    const targetFile = values.target_file as string | undefined;

    if (!targetFile) {
      console.error(error(t("Error: --target-file (-f) is required\n", "错误: 需要提供 --target-file (-f)\n")));
      console.error(t("Usage: agent-deploy deploy <agent-dir> -f <target-file> [options]", "用法: agent-deploy deploy <agent-dir> -f <target-file> [options]"));
      console.error(t("Run 'agent-deploy deploy --help' for more information", "运行 'agent-deploy deploy --help' 获取更多信息"));
      process.exit(1);
    }

    let toolsToInstall: string[] = [];

    if (targetTool === "auto") {
      const detected = detectAll();
      if (detected.length === 0) {
        throw ErrorHandlers.toolNotDetected();
      }
      toolsToInstall = [detected[0].tool];
      console.log(`${info(t("Auto-detected:", "自动检测到:"))} ${detected[0].tool}\n`);
    } else if (targetTool === "all") {
      const detected = detectAll();
      if (detected.length === 0) {
        throw ErrorHandlers.toolNotDetected();
      }
      toolsToInstall = detected.map(d => d.tool);
      console.log(`${info(t("Detected", "检测到"))} ${detected.length} ${t("tool(s):", "个工具:")} ${toolsToInstall.join(", ")}\n`);
    } else {
      toolsToInstall = [targetTool];
    }

    const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
    const agentName = agentJson.identity?.name || agentJson.name || "agent";

    const results: Array<{ tool: string; success: boolean; error?: string }> = [];

    for (const tool of toolsToInstall) {
      try {
        const spinner = new Spinner(t(`Deploying to ${tool}...`, `正在部署到 ${tool}...`));
        spinner.start();
        const adapted = await adaptAgent(resolvedPath, tool, targetFile);
        await installAgent(adapted.content, agentName, tool, level, false, targetFile);
        spinner.stop(t("Done", "完成"));

        console.log(success(t(`Successfully deployed to ${tool}\n`, `成功部署到 ${tool}\n`)));
        results.push({ tool, success: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(error(t(`Failed to deploy to ${tool}: ${msg}\n`, `部署到 ${tool} 失败: ${msg}\n`)));
        results.push({ tool, success: false, error: msg });
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log("=".repeat(50));
    console.log(bold(t("Deployment Summary:", "部署摘要:")));
    console.log(`   ${success(t("Successful:", "成功:"))} ${successful}`);
    console.log(`   ${error(t("Failed:", "失败:"))} ${failed}`);
    console.log(`   ${info(t("Total:", "总计:"))} ${results.length}`);

    if (failed > 0) {
      console.log(t("\nFailed deployments:", "\n失败的部署:"));
      results.filter(r => !r.success).forEach(r => {
        console.log(`   - ${r.tool}: ${r.error}`);
      });
    }

    if (successful > 0) {
      console.log(t("\nAgent deployed successfully!", "\nAgent 部署成功!"));
      console.log(t("\nNext steps:", "\n下一步:"));
      results.filter(r => r.success).forEach(r => {
        if (r.tool === "cursor") {
          console.log(t(`   - Open Cursor and type '//${agentName}' to use the agent`, `   - 打开 Cursor 并输入 '//${agentName}' 使用该 Agent`));
        } else if (r.tool === "claude_code") {
          console.log(t(`   - Open Claude Code and type '/${agentName}' to use the agent`, `   - 打开 Claude Code 并输入 '/${agentName}' 使用该 Agent`));
        } else {
          console.log(t(`   - Check ${r.tool} for the deployed agent`, `   - 在 ${r.tool} 中查看已部署的 Agent`));
        }
      });
    }

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
${t("Usage: agent-deploy list [options]", "用法: agent-deploy list [options]")}

${t("List local imported or downloaded agents.", "列出本地已导入或已下载的 Agent。")}

${t("Options:", "选项:")}
  --type <type>         ${t("Filter by type: imported, downloaded, or all (default: all)", "按类型过滤: imported, downloaded, 或 all (默认: all)")}
  -o, --output <dir>    ${t("Base directory to scan (default: ./)", "扫描的基础目录 (默认: ./)")}
  -h, --help            ${t("Show this help message", "显示此帮助信息")}

${t("Examples:", "示例:")}
  agent-deploy list
  agent-deploy list --type imported
  agent-deploy list --type downloaded
      `);
      return;
    }

    const spinner = new Spinner(t("Listing local agents...", "正在列出本地 Agent..."));
    spinner.start();
    const agents = await listLocalAgents({
      type: values.type as any,
      outputDir: values.output as string,
    });
    spinner.stop(t("Done", "完成"));

    if (agents.length === 0) {
      console.log(t("No agents found.", "未找到 Agent。"));
      console.log(t("\nTip: Import agents with 'agent-deploy import' or download from Market", "\n提示: 使用 'agent-deploy import' 导入 Agent 或从市场下载"));
      return;
    }

    console.log(t(`Found ${agents.length} agent(s):\n`, `找到 ${agents.length} 个 Agent:\n`));

    agents.forEach((agent, idx) => {
      console.log(`${idx + 1}. ${bold(agent.display_name)} (${agent.name})`);
      console.log(`   ${info(t("Version:", "版本:"))}     ${agent.version}`);
      console.log(`   ${info(t("Description:", "描述:"))} ${agent.description.substring(0, 60)}${agent.description.length > 60 ? '...' : ''}`);
      console.log(`   ${info(t("Author:", "作者:"))}      ${agent.author}`);
      if (agent.tags.length > 0) {
        console.log(`   ${info(t("Tags:", "标签:"))}        ${agent.tags.join(', ')}`);
      }
      console.log(`   ${info(t("Updated:", "更新:"))}     ${new Date(agent.updated_at).toLocaleDateString()}`);
      console.log();
    });

    console.log(`${t("Total:", "总计:")} ${agents.length} ${t("agent(s)", "个 Agent")}`);
  } catch (error) {
    handleCommandError(error as Error, 'list');
  }
}

/**
 * Handle search command
 */
async function handleSearchCommand(args: string[]) {
  try {
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
${t("Usage: agent-deploy search <query> [options]", "用法: agent-deploy search <query> [options]")}

${t("Search for agents in the Market.", "在市场搜索 Agent。")}

${t("Arguments:", "参数:")}
  <query>               ${t("Search query (keywords)", "搜索查询 (关键词)")}

${t("Options:", "选项:")}
  --tag <tag>           ${t("Filter by tag", "按标签过滤")}
  --category <cat>      ${t("Filter by category", "按分类过滤")}
  --limit <n>           ${t("Max results (default: 20)", "最大结果数 (默认: 20)")}
  -m, --market <url>    ${t("Market API URL (default: $MARKET_API_URL or http://localhost:8321)", "市场 API URL (默认: $MARKET_API_URL 或 http://localhost:8321)")}
  -h, --help            ${t("Show this help message", "显示此帮助信息")}

${t("Examples:", "示例:")}
  agent-deploy search "code review"
  agent-deploy search typescript --tag security
  agent-deploy search refactor --category productivity --limit 10
      `);
      return;
    }

    const query = positionals[0];
    if (!query) {
      console.error(error(t("Error: Search query is required\n", "错误: 需要提供搜索查询\n")));
      console.log(t("Usage: agent-deploy search <query> [options]", "用法: agent-deploy search <query> [options]"));
      console.log(t("Try: agent-deploy search --help", "尝试: agent-deploy search --help"));
      process.exit(1);
    }

    const spinner = new Spinner(t(`Searching Market for: "${query}"...`, `正在市场搜索: "${query}"...`));
    spinner.start();
    const marketUrl = values.market as string || process.env.MARKET_API_URL || "http://localhost:8321";
    const client = new MarketClient({ baseUrl: marketUrl });
    const result = await client.searchAgents({
      query,
      tag: values.tag as string,
      category: values.category as string,
      limit: values.limit ? parseInt(values.limit as string) : 20,
    });
    spinner.stop(t("Search complete", "搜索完成"));

    if (result.agents.length === 0) {
      console.log(t("No agents found matching your search.", "未找到匹配的 Agent。"));
      console.log(t("\nTry different keywords or remove filters", "\n尝试不同的关键词或移除过滤条件"));
      return;
    }

    console.log(t(`Found ${result.agents.length} agent(s) (total: ${result.total}):\n`, `找到 ${result.agents.length} 个 Agent (总计: ${result.total}):\n`));

    result.agents.forEach((agent, idx) => {
      console.log(`${idx + 1}. ${bold(agent.display_name)} (${agent.name})`);
      console.log(`   ${info(t("Version:", "版本:"))}     ${agent.version}`);
      console.log(`   ${info(t("Description:", "描述:"))} ${agent.description.substring(0, 60)}${agent.description.length > 60 ? '...' : ''}`);
      console.log(`   ${info(t("Author:", "作者:"))}      ${agent.author}`);
      if (agent.tags.length > 0) {
        console.log(`   ${info(t("Tags:", "标签:"))}        ${agent.tags.join(', ')}`);
      }
      console.log(`   ${info(t("Downloads:", "下载:"))}   ${agent.downloads}`);
      if (agent.rating > 0) {
        console.log(`   ${info(t("Rating:", "评分:"))}      ${'⭐'.repeat(Math.round(agent.rating))} (${agent.rating.toFixed(1)})`);
      }
      console.log();
    });

    console.log(t(`Showing ${result.agents.length} of ${result.total} results`, `显示 ${result.total} 个结果中的 ${result.agents.length} 个`));
    if (result.total > result.agents.length) {
      console.log(t("Use --limit to see more results", "使用 --limit 查看更多结果"));
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
${t("Usage: agent-deploy info <agent-id> [options]", "用法: agent-deploy info <agent-id> [options]")}

${t("Show detailed information about an agent.", "显示 Agent 的详细信息。")}

${t("Arguments:", "参数:")}
  <agent-id>            ${t("Agent ID or name", "Agent ID 或名称")}

${t("Options:", "选项:")}
  --local               ${t("Show local agent info (default: search Market)", "显示本地 Agent 信息 (默认: 搜索市场)")}
  -m, --market <url>    ${t("Market API URL (default: $MARKET_API_URL or http://localhost:8321)", "市场 API URL (默认: $MARKET_API_URL 或 http://localhost:8321)")}
  -h, --help            ${t("Show this help message", "显示此帮助信息")}

${t("Examples:", "示例:")}
  agent-deploy info my-agent
  agent-deploy info my-agent --local
  agent-deploy info code-reviewer -m http://market.example.com
      `);
      return;
    }

    const agentId = positionals[0];
    if (!agentId) {
      console.error(error(t("Error: Agent ID is required\n", "错误: 需要提供 Agent ID\n")));
      console.log(t("Usage: agent-deploy info <agent-id> [options]", "用法: agent-deploy info <agent-id> [options]"));
      console.log(t("Try: agent-deploy info --help", "尝试: agent-deploy info --help"));
      process.exit(1);
    }

    if (values.local) {
      const spinner = new Spinner(t(`Searching for local agent: ${agentId}...`, `正在搜索本地 Agent: ${agentId}...`));
      spinner.start();
      const agents = await listLocalAgents({});
      spinner.stop(t("Done", "完成"));
      const agent = agents.find(a => a.id === agentId || a.name === agentId);

      if (!agent) {
        console.log(t(`Agent '${agentId}' not found locally.`, `本地未找到 Agent '${agentId}'。`));
        console.log(t("\nList all local agents with: agent-deploy list", "\n使用以下命令列出所有本地 Agent: agent-deploy list"));
        process.exit(1);
      }

      console.log(`${bold(agent.display_name)}\n`);
      console.log(`${info(t("ID:", "ID:"))}          ${agent.id}`);
      console.log(`${info(t("Name:", "名称:"))}        ${agent.name}`);
      console.log(`${info(t("Version:", "版本:"))}     ${agent.version}`);
      console.log(`${info(t("Author:", "作者:"))}      ${agent.author}`);
      console.log(`${info(t("Category:", "分类:"))}    ${agent.category}`);
      if (agent.tags.length > 0) {
        console.log(`${info(t("Tags:", "标签:"))}        ${agent.tags.join(', ')}`);
      }
      console.log(`\n${bold(t("Description:", "描述:"))}`);
      console.log(agent.description);
      console.log(`\n${info(t("Created:", "创建:"))}     ${new Date(agent.created_at).toLocaleString()}`);
      console.log(`${info(t("Updated:", "更新:"))}     ${new Date(agent.updated_at).toLocaleString()}`);
    } else {
      const spinner = new Spinner(t(`Fetching agent info from Market: ${agentId}...`, `正在从市场获取 Agent 信息: ${agentId}...`));
      spinner.start();
      const marketUrl = values.market as string || process.env.MARKET_API_URL || "http://localhost:8321";
      const client = new MarketClient({ baseUrl: marketUrl });
      const agent = await client.getAgent(agentId);
      spinner.stop(t("Done", "完成"));

      console.log(`${bold(agent.display_name)}\n`);
      console.log(`${info(t("ID:", "ID:"))}          ${agent.id}`);
      console.log(`${info(t("Name:", "名称:"))}        ${agent.name}`);
      console.log(`${info(t("Version:", "版本:"))}     ${agent.version}`);
      console.log(`${info(t("Author:", "作者:"))}      ${agent.author}`);
      console.log(`${info(t("Category:", "分类:"))}    ${agent.category}`);
      if (agent.tags.length > 0) {
        console.log(`${info(t("Tags:", "标签:"))}        ${agent.tags.join(', ')}`);
      }
      console.log(`${info(t("Downloads:", "下载:"))}   ${agent.downloads}`);
      if (agent.rating > 0) {
        console.log(`${info(t("Rating:", "评分:"))}      ${'⭐'.repeat(Math.round(agent.rating))} (${agent.rating.toFixed(1)})`);
      }
      console.log(`\n${bold(t("Description:", "描述:"))}`);
      console.log(agent.description);
      console.log(`\n${info(t("Created:", "创建:"))}     ${new Date(agent.created_at).toLocaleString()}`);
      console.log(`${info(t("Updated:", "更新:"))}     ${new Date(agent.updated_at).toLocaleString()}`);
      console.log(`\n${info(t("Market URL:", "市场 URL:"))}  ${marketUrl}/agents/${agent.id}`);

      console.log(`\n${warning(t("Install with:", "安装命令:"))} agent-deploy use ${agent.id}`);
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
${t("Usage: agent-deploy init <template> [options]", "用法: agent-deploy init <template> [options]")}

${t("Create a new agent from a template.", "从模板创建新 Agent。")}

${t("Arguments:", "参数:")}
  <template>            ${t("Template ID (use 'agent-deploy templates' to list)", "模板 ID (使用 'agent-deploy templates' 列出)")}

${t("Options:", "选项:")}
  -n, --name <name>     ${t("Agent name (default: use template name)", "Agent 名称 (默认: 使用模板名称)")}
  -o, --output <dir>    ${t("Output directory (default: ./agents)", "输出目录 (默认: ./agents)")}
  -h, --help            ${t("Show this help message", "显示此帮助信息")}

${t("Examples:", "示例:")}
  agent-deploy init agent-builder
  agent-deploy init code-reviewer -n my-reviewer
  agent-deploy init test-writer -o ./my-agents
      `);
      return;
    }

    const template = positionals[0];
    if (!template) {
      console.error(error(t("Error: Template ID is required\n", "错误: 需要提供模板 ID\n")));
      console.log(t("Usage: agent-deploy init <template> [options]", "用法: agent-deploy init <template> [options]"));
      console.log(t("Try: agent-deploy templates", "尝试: agent-deploy templates"));
      process.exit(1);
    }

    const spinner = new Spinner(t(`Creating agent from template: ${template}...`, `正在从模板创建 Agent: ${template}...`));
    spinner.start();
    const agentDir = initFromTemplate({
      template,
      name: values.name as string,
      outputDir: values.output as string || './agents',
    });
    spinner.stop(t("Done", "完成"));

    console.log(success(t("Successfully created agent!\n", "成功创建 Agent!\n")));
    console.log(`${info(t("Location:", "位置:"))} ${agentDir}`);
    console.log(t("\nNext steps:", "\n下一步:"));
    console.log(t("  1. Review and customize agent.json", "  1. 检查并自定义 agent.json"));
    console.log(t("  2. Test the agent instructions", "  2. 测试 Agent 指令"));
    console.log(t(`  3. Upload to Market: agent-deploy upload ${agentDir}`, `  3. 上传到市场: agent-deploy upload ${agentDir}`));
    console.log(t(`  4. Deploy locally: agent-deploy deploy ${agentDir} -t claude_code`, `  4. 本地部署: agent-deploy deploy ${agentDir} -t claude_code`));
  } catch (error) {
    handleCommandError(error as Error, 'init');
  }
}

/**
 * Handle run command — DEPRECATED
 */
async function handleRunCommand(args: string[]) {
  console.error(warning(t("The 'run' command has been deprecated and moved to agent-compose.", "'run' 命令已弃用并移至 agent-compose。")));
  console.error("");
  console.error(t("Agent execution is now handled by the agent-compose Runtime Engine.", "Agent 执行现在由 agent-compose 运行时引擎处理。"));
  console.error(t("Please use agent-compose to run agents:", "请使用 agent-compose 运行 Agent:"));
  console.error("");
  console.error("  agent-compose run <agent-dir>");
  console.error("  agent-compose market run <agent-name>");
  console.error("");
  console.error(t("If you need the legacy runtime, it is still available in:", "如需旧版运行时, 仍可在以下位置找到:"));
  console.error("  node/src/runtime/ (deprecated — will be removed in a future version)");
  process.exit(1);
}

/**
 * Handle use command - download from market + adapt + install
 */
async function handleUseCommand(args: string[]) {
  try {
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
${t("Usage: agent-deploy use <agent-id|agent-dir> [options]", "用法: agent-deploy use <agent-id|agent-dir> [options]")}

${t("Download from Market (if needed), adapt, and install agent to all detected AI tools.", "从市场下载 (如需要), 适配并安装 Agent 到所有检测到的 AI 工具。")}
${t("This is the fastest way to make a Market agent directly usable.", "这是让市场 Agent 立即可用的最快方式。")}

${t("Arguments:", "参数:")}
  <agent-id|agent-dir>  ${t("Agent ID (Market) or local agent directory", "Agent ID (市场) 或本地 Agent 目录")}

${t("Options:", "选项:")}
  -m, --market <url>    ${t("Market API URL (default: $MARKET_API_URL or http://localhost:8321)", "市场 API URL (默认: $MARKET_API_URL 或 http://localhost:8321)")}
  -o, --output <dir>    ${t("Download output directory (default: ./downloaded-agents)", "下载输出目录 (默认: ./downloaded-agents)")}
  -l, --level <level>   ${t("Install level: project, user, or both (default: both)", "安装级别: project, user, 或 both (默认: both)")}
  --with-deps           ${t("Resolve and install dependencies recursively", "递归解析并安装依赖")}
  --no-deps             ${t("Skip dependency resolution (default: auto-resolve)", "跳过依赖解析 (默认: 自动解析)")}
  -h, --help            ${t("Show this help message", "显示此帮助信息")}

${t("Examples:", "示例:")}
  agent-deploy use my-agent
  agent-deploy use code-reviewer -m http://market.example.com
  agent-deploy use ./test-agents/pilotdeck-agent
      `);
      return;
    }

    const input = positionals[0];
    if (!input) {
      console.error(error(t("Error: agent ID or directory is required\n", "错误: 需要提供 Agent ID 或目录\n")));
      console.error(t("Usage: agent-deploy use <agent-id|agent-dir> [options]", "用法: agent-deploy use <agent-id|agent-dir> [options]"));
      console.error(t("Run 'agent-deploy use --help' for more information", "运行 'agent-deploy use --help' 获取更多信息"));
      process.exit(1);
    }

    const isGlobal = values.global as boolean;
    let agentPath: string;

    const localCandidate = resolve(input);
    if (existsSync(localCandidate) && existsSync(path.join(localCandidate, "agent.json"))) {
      agentPath = localCandidate;
      console.log(`${info(t("Using local agent:", "使用本地 Agent:"))} ${input}\n`);
    } else {
      const spinner = new Spinner(t(`Downloading agent from Market: ${input}...`, `正在从市场下载 Agent: ${input}...`));
      spinner.start();
      const marketUrl = values.market as string || process.env.MARKET_API_URL || "http://localhost:8321";
      const outputDir = values.output ? resolve(values.output as string) : resolve("./agents");
      const result = await downloadAgent({
        agentId: input,
        outputDir,
        marketUrl,
      });
      agentPath = result.output_path;
      spinner.stop(t("Download complete", "下载完成"));

      console.log(`${success(t("Downloaded to:", "下载到:"))} ${agentPath}\n`);
      console.log(`${info(t("Agent stored locally (not installed globally). Use 'agent-deploy run' to execute.", "Agent 已本地存储 (未全局安装)。使用 'agent-deploy run' 执行。"))}\n`);
    }

    const agentJsonPath = path.join(agentPath, "agent.json");
    if (!existsSync(agentJsonPath)) {
      throw ErrorHandlers.missingAgentJson(agentPath);
    }

    const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
    const agentName = agentJson.identity?.name || agentJson.name || path.basename(agentPath);
    const agentAuthor = agentJson.identity?.author || "Unknown";
    const agentVersion = agentJson.identity?.version || "0.0.0";
    const agentSource = agentJson.identity?.repository || "Market";

    console.log(`\n${warning(t("Security Notice:", "安全提示:"))}`);
    console.log(`   ${t("Agent:", "Agent:")} ${agentName} v${agentVersion}`);
    console.log(`   ${t("Author:", "作者:")} ${agentAuthor}`);
    console.log(`   ${t("Source:", "来源:")} ${agentSource}`);
    console.log(`   ${t("This agent will run in RESTRICTED mode by default.", "此 Agent 默认将以受限模式运行。")}`);
    console.log(`   ${t("Use 'agent-deploy run --trusted' if you trust this publisher.", "如果信任此发布者, 请使用 'agent-deploy run --trusted'。")}\n`);

    const withDeps = values["with-deps"] as boolean;
    const noDeps = values["no-deps"] as boolean;
    const shouldResolveDeps = withDeps || (!noDeps && agentJson.dependencies?.agents);

    if (shouldResolveDeps && !noDeps) {
      const spinner = new Spinner(t("Resolving dependencies...", "正在解析依赖..."));
      spinner.start();
      const marketUrl = values.market as string || process.env.MARKET_API_URL || "http://localhost:8321";
      const resolver = new DependencyResolver(marketUrl);

      try {
        const deps = await resolver.resolve(agentPath);
        spinner.stop(t("Dependencies resolved", "依赖解析完成"));
        if (deps.size > 0) {
          console.log(t(`Found ${deps.size} dependency(ies):`, `找到 ${deps.size} 个依赖:`));
          for (const [name, dep] of deps) {
            console.log(`  - ${name}@${dep.version} (${dep.source})`);
          }
          console.log();

          const depsDir = path.join(agentPath, "deps");
          await resolver.installDependencies(Array.from(deps.values()), depsDir);
          console.log(`${success(t("Dependencies installed to:", "依赖已安装到:"))} ${depsDir}\n`);

          const lockFile = new AgentLockFile(agentPath);
          lockFile.update(agentName, agentVersion, Array.from(deps.values()));
          console.log(`${info(t("Lock file updated:", "锁定文件已更新:"))} ${lockFile.getPath()}\n`);
        } else {
          console.log(t("No dependencies found.\n", "未找到依赖。\n"));
        }
      } catch (depError) {
        spinner.stop();
        const msg = depError instanceof Error ? depError.message : String(depError);
        console.error(error(t(`Dependency resolution failed: ${msg}\n`, `依赖解析失败: ${msg}\n`)));
        if (withDeps) {
          process.exit(1);
        }
      }
    } else if (noDeps) {
      console.log(t("Skipping dependency resolution (--no-deps)\n", "跳过依赖解析 (--no-deps)\n"));
    }

    if (!isGlobal) {
      console.log(`${info(t("Local mode: Agent stored at", "本地模式: Agent 存储于"))} ${agentPath}`);
      console.log(`   ${t("Use:", "使用:")} agent-deploy run ${path.relative(process.cwd(), agentPath)} --trusted`);
      console.log(`   ${t("Or add --global flag to install to AI tools globally.", "或添加 --global 标志以全局安装到 AI 工具。")}\n`);
      return;
    }

    const level = (values.level as string) || "both";
    const detected = detectAll();
    const toolsToInstall = new Set<string>();
    toolsToInstall.add("codebuddy_agent");
    for (const d of detected) {
      toolsToInstall.add(d.tool);
    }
    if (detected.some(d => d.tool === "codebuddy")) {
      toolsToInstall.add("codebuddy");
    }

    const installList = Array.from(toolsToInstall);
    console.log(`${info(t("Installing to", "正在安装到"))} ${installList.length} ${t("target(s):", "个目标:")} ${installList.join(", ")}\n`);

    const results: Array<{ tool: string; success: boolean; error?: string }> = [];

    for (const tool of installList) {
      try {
        const toolLabel = tool === "codebuddy_agent" ? `${tool} (CC Agent)` : tool;
        const spinner = new Spinner(t(`Deploying to ${toolLabel}...`, `正在部署到 ${toolLabel}...`));
        spinner.start();
        const adapted = adaptAgent(agentPath, tool);
        await installAgent(adapted.content, agentName, tool, level, false);
        spinner.stop(t("Done", "完成"));

        console.log(success(t(`Successfully deployed to ${toolLabel}\n`, `成功部署到 ${toolLabel}\n`)));
        results.push({ tool, success: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(error(t(`Failed to deploy to ${tool}: ${msg}\n`, `部署到 ${tool} 失败: ${msg}\n`)));
        results.push({ tool, success: false, error: msg });
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log("=".repeat(50));
    console.log(bold(t("Installation Summary:", "安装摘要:")));
    console.log(`   ${success(t("Successful:", "成功:"))} ${successful}`);
    console.log(`   ${error(t("Failed:", "失败:"))} ${failed}`);
    console.log(`   ${info(t("Total:", "总计:"))} ${results.length}`);

    if (failed > 0) {
      console.log(t("\nFailed installations:", "\n失败的安装:"));
      results.filter(r => !r.success).forEach(r => {
        console.log(`   - ${r.tool}: ${r.error}`);
      });
    }

    if (successful > 0) {
      console.log(t(`\nAgent "${agentName}" is ready to use!`, `\nAgent "${agentName}" 已就绪!`));
      console.log(t("\nHow to use:", "\n使用方法:"));
      const hasCCAgent = results.some(r => r.success && r.tool === "codebuddy_agent");
      if (hasCCAgent) {
        console.log(t("   - CC: Restart CodeBuddy Code to discover the agent", "   - CC: 重启 CodeBuddy Code 以发现该 Agent"));
        console.log(t(`   - CC: The agent will appear in .codebuddy/agents/${agentName}.md`, `   - CC: Agent 将出现在 .codebuddy/agents/${agentName}.md`));
      }
      console.log(`   - ${t("Run pipeline:", "运行流水线:")} agent-deploy run ${agentPath}`);
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
${t("Usage: agent-deploy check-updates [options]", "用法: agent-deploy check-updates [options]")}

${t("Check for updates to deployed agents by comparing local versions with Market versions.", "通过比较本地版本与市场版本, 检查已部署 Agent 的更新。")}

${t("Options:", "选项:")}
  -m, --market <url>     ${t("Market API URL (default: $MARKET_API_URL or http://localhost:8321)", "市场 API URL (默认: $MARKET_API_URL 或 http://localhost:8321)")}
  --include-local        ${t("Also check local agents not tracked in deployment state", "同时检查未在部署状态中跟踪的本地 Agent")}
  -h, --help             ${t("Show this help message", "显示此帮助信息")}

${t("Examples:", "示例:")}
  agent-deploy check-updates
  agent-deploy check-updates -m http://market.example.com
  agent-deploy check-updates --include-local
      `);
      return;
    }

    const spinner = new Spinner(t("Checking for agent updates...", "正在检查 Agent 更新..."));
    spinner.start();
    const marketUrl = values.market as string || process.env.MARKET_API_URL || "http://localhost:8321";
    const checker = new UpdateChecker({
      marketUrl,
      includeLocalAgents: values["include-local"] as boolean,
    });
    const updates = await checker.checkAll();
    const summary = checker["summarizeUpdates"](updates);
    spinner.stop(t("Check complete", "检查完成"));

    if (updates.length === 0) {
      console.log(t("No deployed agents found.", "未找到已部署的 Agent。"));
      console.log(t("\nDeploy agents first with 'agent-deploy deploy' or 'agent-deploy use --global'", "\n先使用 'agent-deploy deploy' 或 'agent-deploy use --global' 部署 Agent"));
      return;
    }

    const upToDate = updates.filter(u => !u.isUpdateAvailable && !u.error);
    const hasUpdates = updates.filter(u => u.isUpdateAvailable);
    const failed = updates.filter(u => u.error);

    if (hasUpdates.length > 0) {
      console.log(`${warning(t(`${hasUpdates.length} update(s) available:`, `${hasUpdates.length} 个更新可用:`))}\n`);
      hasUpdates.forEach((u, idx) => {
        console.log(`${idx + 1}. ${u.agentId}`);
        console.log(`   ${info(t("Current:", "当前:"))}  ${u.currentVersion}`);
        console.log(`   ${info(t("Latest:", "最新:"))}   ${u.latestVersion}`);
        if (u.updateLevel) {
          const levelEmoji = u.updateLevel === "major" ? "🔴" : u.updateLevel === "minor" ? "🟡" : "🟢";
          console.log(`   ${t("Level:", "级别:")}    ${levelEmoji} ${u.updateLevel}`);
        }
        if (u.releaseDate) {
          console.log(`   ${t("Released:", "发布:")} ${new Date(u.releaseDate).toLocaleDateString()}`);
        }
        if (u.changelog) {
          const shortLog = u.changelog.length > 80 ? u.changelog.substring(0, 80) + "..." : u.changelog;
          console.log(`   ${t("Changes:", "变更:")}  ${shortLog}`);
        }
        console.log();
      });
    }

    if (upToDate.length > 0) {
      console.log(`${success(t(`${upToDate.length} agent(s) up to date:`, `${upToDate.length} 个 Agent 已是最新:`))}`);
      upToDate.forEach(u => {
        console.log(`   - ${u.agentId} @ ${u.currentVersion}`);
      });
      console.log();
    }

    if (failed.length > 0) {
      console.log(`${warning(t(`${failed.length} check(s) failed:`, `${failed.length} 次检查失败:`))}`);
      failed.forEach(u => {
        console.log(`   - ${u.agentId}: ${u.error}`);
      });
      console.log();
    }

    console.log("=".repeat(50));
    console.log(bold(t("Summary:", "摘要:")));
    console.log(`   ${t("Total checked:", "总计检查:")} ${updates.length}`);
    console.log(`   ${success(t("Up to date:", "已是最新:"))}    ${summary.upToDate}`);
    console.log(`   ${warning(t("Has updates:", "有更新:"))}   ${summary.hasUpdates}`);
    if (summary.hasUpdates > 0) {
      console.log(`      - ${t("Major:", "主要:")} ${summary.updatesByLevel.major}`);
      console.log(`      - ${t("Minor:", "次要:")} ${summary.updatesByLevel.minor}`);
      console.log(`      - ${t("Patch:", "补丁:")} ${summary.updatesByLevel.patch}`);
    }
    console.log(`   ${error(t("Check failed:", "检查失败:"))}  ${summary.checkFailed}`);

    if (hasUpdates.length > 0) {
      console.log(t("\nUpdate an agent:", "\n更新 Agent:"));
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
    const { values } = parseArgs({
      args,
      options: {
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });

    if (values.help) {
      console.log(`
${t("Usage: agent-deploy templates", "用法: agent-deploy templates")}

${t("List all available agent templates.", "列出所有可用的 Agent 模板。")}

${t("Templates provide quick-start agents for common use cases.", "模板为常见用例提供快速启动 Agent。")}

${t("Examples:", "示例:")}
  agent-deploy templates
  agent-deploy init agent-builder
      `);
      return;
    }

    console.log(bold(t("Available Agent Templates:\n", "可用的 Agent 模板:\n")));

    const templates = listTemplates();

    if (templates.length === 0) {
      console.log(t("No templates found.", "未找到模板。"));
      return;
    }

    const byCategory: Record<string, typeof templates> = {};
    for (const template of templates) {
      if (!byCategory[template.category]) {
        byCategory[template.category] = [];
      }
      byCategory[template.category].push(template);
    }

    for (const [category, categoryTemplates] of Object.entries(byCategory)) {
      console.log(`\n${category.toUpperCase()}`);
      console.log("=".repeat(50));

      for (const template of categoryTemplates) {
        console.log(`\n${template.name} (${template.id})`);
        console.log(`  ${template.description}`);
        console.log(`  ${info(t("Tags:", "标签:"))} ${template.tags.join(', ')}`);
        console.log(`  ${info(t("Author:", "作者:"))} ${template.author}`);
      }
    }

    console.log(`\n\n${t("Total:", "总计:")} ${templates.length} ${t("template(s)", "个模板")}`);
    console.log(t("\nUse a template:", "\n使用模板:"));
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

  if (args.length === 0) {
    console.error(error(t("No command specified\n", "未指定命令\n")));
    printHelp();
    process.exit(1);
  }

  if (args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return;
  }

  if (args[0] === "--version" || args[0] === "-v") {
    printVersion();
    return;
  }

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
    console.error(error(t(`Unknown command: ${command}\n`, `未知命令: ${command}\n`)));
    console.error(t("Available commands: import, upload, deploy, run, use, list, search, info, init, templates, team, workflow, clean, validate, preview", "可用命令: import, upload, deploy, run, use, list, search, info, init, templates, team, workflow, clean, validate, preview"));
    console.error(t("Run 'agent-deploy --help' for more information", "运行 'agent-deploy --help' 获取更多信息"));
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
${t("Usage: agent-deploy validate <agent-dir> [options]", "用法: agent-deploy validate <agent-dir> [options]")}

${t("Validate agent.json and/or worker.yaml structure without executing.", "在不执行的情况下验证 agent.json 和/或 worker.yaml 结构。")}

${t("Arguments:", "参数:")}
  <agent-dir>           ${t("Path to agent directory containing agent.json", "包含 agent.json 的 Agent 目录路径")}

${t("Options:", "选项:")}
  --worker-yaml <path>  ${t("Path to worker.yaml (default: <agent-dir>/worker.yaml)", "worker.yaml 路径 (默认: <agent-dir>/worker.yaml)")}
  --json                ${t("Output result as JSON", "以 JSON 格式输出结果")}
  -h, --help            ${t("Show this help message", "显示此帮助信息")}

${t("Examples:", "示例:")}
  agent-deploy validate ./agents/my-agent
  agent-deploy validate ./agents/my-agent --worker-yaml ./agents/my-agent/pipeline.yaml
      `);
      return;
    }

    const agentDir = positionals[0];
    if (!agentDir) {
      console.error(error(t("Error: agent directory is required\n", "错误: 需要提供 Agent 目录\n")));
      console.error(t("Usage: agent-deploy validate <agent-dir>", "用法: agent-deploy validate <agent-dir>"));
      process.exit(1);
    }

    const resolvedDir = resolve(agentDir);
    const agentJsonPath = path.join(resolvedDir, "agent.json");

    const agentResult = validateAgentJson(agentJsonPath);

    const workerYamlPath = values["worker-yaml"]
      ? resolve(values["worker-yaml"] as string)
      : path.join(resolvedDir, "worker.yaml");
    let workerResult = null;
    if (existsSync(workerYamlPath)) {
      try {
        const raw = fs.readFileSync(workerYamlPath, "utf-8");
        const workerYaml = yaml.load(raw) as any;
        workerResult = validateWorkerYaml(workerYamlPath);
        (workerResult as any)._parsed = workerYaml;
      } catch (e: any) {
        workerResult = {
          valid: false,
          errors: [{ field: "file", message: `Failed to parse worker.yaml: ${e.message}`, severity: "error" as const }],
          warnings: [],
        };
      }
    }

    if (values.json) {
      console.log(JSON.stringify({ agent: agentResult, worker: workerResult }, null, 2));
    } else {
      console.log(formatValidationResult(agentResult));
      if (workerResult) {
        console.log("\n--- worker.yaml ---");
        console.log(formatValidationResult(workerResult));
      } else {
        console.log(t("\n(No worker.yaml found — skipping pipeline validation)", "\n(未找到 worker.yaml — 跳过流水线验证)"));
      }

      const allValid = agentResult.valid && (workerResult === null || workerResult.valid);
      console.log(`\n${bold(t("Overall:", "总体:"))} ${allValid ? success("VALID") : error("INVALID")}`);
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
${t("Usage: agent-deploy preview <agent-dir> [options]", "用法: agent-deploy preview <agent-dir> [options]")}

${t("Preview pipeline execution flow without executing.", "在不执行的情况下预览流水线执行流程。")}

${t("Arguments:", "参数:")}
  <agent-dir>           ${t("Path to agent directory containing worker.yaml", "包含 worker.yaml 的 Agent 目录路径")}

${t("Options:", "选项:")}
  --worker-yaml <path>  ${t("Path to worker.yaml (default: <agent-dir>/worker.yaml)", "worker.yaml 路径 (默认: <agent-dir>/worker.yaml)")}
  --format <format>     ${t("Output format: text, mermaid (default: text)", "输出格式: text, mermaid (默认: text)")}
  --dry-run             ${t("Simulate execution with mock inputs/outputs", "使用模拟输入/输出模拟执行")}
  -h, --help            ${t("Show this help message", "显示此帮助信息")}

${t("Examples:", "示例:")}
  agent-deploy preview ./agents/my-agent
  agent-deploy preview ./agents/my-agent --format mermaid
  agent-deploy preview ./agents/my-agent --dry-run
      `);
      return;
    }

    const agentDir = positionals[0];
    if (!agentDir) {
      console.error(error(t("Error: agent directory is required\n", "错误: 需要提供 Agent 目录\n")));
      console.error(t("Usage: agent-deploy preview <agent-dir>", "用法: agent-deploy preview <agent-dir>"));
      process.exit(1);
    }

    const resolvedDir = resolve(agentDir);
    const workerYamlPath = values["worker-yaml"]
      ? resolve(values["worker-yaml"] as string)
      : path.join(resolvedDir, "worker.yaml");

    if (!existsSync(workerYamlPath)) {
      console.error(error(t(`Error: worker.yaml not found at ${workerYamlPath}`, `错误: 在 ${workerYamlPath} 未找到 worker.yaml`)));
      process.exit(1);
    }

    const raw = fs.readFileSync(workerYamlPath, "utf-8");
    const workerYaml = yaml.load(raw) as any;

    if (!workerYaml.pipeline || !Array.isArray(workerYaml.pipeline)) {
      console.error(error(t("Error: worker.yaml must contain a 'pipeline' array", "错误: worker.yaml 必须包含 'pipeline' 数组")));
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
${t("Usage: agent-deploy clean [agent-name]", "用法: agent-deploy clean [agent-name]")}

${t("Remove globally installed agents from AI tool directories.", "从 AI 工具目录中移除全局安装的 Agent。")}
${t("Without arguments, lists all global installations.", "不带参数时, 列出所有全局安装。")}

${t("Arguments:", "参数:")}
  [agent-name]    ${t("Name of agent to remove (optional)", "要移除的 Agent 名称 (可选)")}

${t("Examples:", "示例:")}
  agent-deploy clean                      # ${t("List global installations", "列出全局安装")}
  agent-deploy clean code-reviewer        # ${t("Remove code-reviewer from all tools", "从所有工具中移除 code-reviewer")}
`);
    return;
  }

  const targetName = positionals[0];

  const SAFE_LIST = ["tapd", "flow-mcp", "aliyun-sls-logs", "bark", "commit"];

  if (targetName && SAFE_LIST.includes(targetName)) {
    console.log(warning(t(`'${targetName}' is protected. Use system tools to manage this skill.\n`, `'${targetName}' 受保护。请使用系统工具管理此技能。\n`)));
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

      if (!targetName && SAFE_LIST.some(s => entry === s || entry.startsWith(s + ".") || entry.startsWith(s))) {
        continue;
      }

      const fullPath = path.join(dir, entry);
      if (fs.statSync(fullPath).isFile() || fs.statSync(fullPath).isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`${success(t("Removed:", "已移除:"))} ${fullPath}`);
        cleaned++;
      }
    }
  }

  if (cleaned === 0) {
    console.log(t("No global installations found", "未找到全局安装") + (targetName ? t(` for '${targetName}'`, ` 对应 '${targetName}'`) : "") + ".");
  } else {
    console.log(`\n${success(t(`Cleaned ${cleaned} file(s). Agents now only exist locally in ./agents/`, `已清理 ${cleaned} 个文件。Agent 现在仅存在于 ./agents/ 中`))}`);
  }
}

/**
 * Handle team subcommand
 */
async function handleTeamCommand(args: string[]) {
  const action = args[0] || "help";

  if (action === "help" || action === "--help" || action === "-h") {
    console.log(`
${t("Usage: agent-deploy team <action> [options]", "用法: agent-deploy team <action> [options]")}

${t("Actions:", "操作:")}
  package <team-dir> [-o <dir>]           ${t("Package team directory into tar.gz", "将团队目录打包为 tar.gz")}
  upload <team-dir> [options]             ${t("Upload team to Market", "上传团队到市场")}
  download <team-name> [-o <dir>] [opts]  ${t("Download team from Market", "从市场下载团队")}
  list [options]                          ${t("List teams (search Market)", "列出团队 (搜索市场)")}
  validate <team-dir>                     ${t("Validate team.json structure", "验证 team.json 结构")}

${t("Upload Options:", "上传选项:")}
  --market <url>     ${t("Market API URL (default: $MARKET_API_URL or http://localhost:8321)", "市场 API URL (默认: $MARKET_API_URL 或 http://localhost:8321)")}
  --api-key <key>    ${t("API key for authentication (default: $MARKET_API_KEY)", "API 认证密钥 (默认: $MARKET_API_KEY)")}
  --force            ${t("Force overwrite existing version", "强制覆盖已有版本")}

${t("Download Options:", "下载选项:")}
  -o, --output <dir>  ${t("Output directory (default: ./downloaded-teams)", "输出目录 (默认: ./downloaded-teams)")}
  --version <ver>     ${t("Specific version to download", "要下载的特定版本")}
  --market <url>      ${t("Market API URL", "市场 API URL")}

${t("List Options:", "列表选项:")}
  --tag <tag>         ${t("Filter by tag", "按标签过滤")}
  --category <cat>    ${t("Filter by category", "按分类过滤")}
  --market <url>      ${t("Market API URL", "市场 API URL")}

${t("Examples:", "示例:")}
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
        console.log(t("Package a team directory into a tar.gz archive.\n", "将团队目录打包为 tar.gz 归档。\n"));
        console.log(t("Usage: agent-deploy team package <team-dir> [-o <dir>]", "用法: agent-deploy team package <team-dir> [-o <dir>]"));
        return;
      }

      const teamDir = positionals[0];
      if (!teamDir) {
        console.error(error(t("Error: team directory is required\n", "错误: 需要提供团队目录\n")));
        console.error(t("Usage: agent-deploy team package <team-dir> [-o <dir>]", "用法: agent-deploy team package <team-dir> [-o <dir>]"));
        process.exit(1);
      }

      const resolvedPath = resolve(teamDir);
      if (!existsSync(resolvedPath)) {
        throw ErrorHandlers.fileNotFound(resolvedPath, 'directory');
      }

      const teamJsonPath = path.join(resolvedPath, "team.json");
      if (!existsSync(teamJsonPath)) {
        console.error(error(t(`Error: team.json not found in ${resolvedPath}`, `错误: 在 ${resolvedPath} 中未找到 team.json`)));
        process.exit(1);
      }

      const teamJson = JSON.parse(fs.readFileSync(teamJsonPath, "utf-8"));
      const teamName = teamJson.identity?.name || teamJson.name || path.basename(resolvedPath);
      const version = teamJson.identity?.version || teamJson.version || "0.0.0";

      const outputDir = values.output ? resolve(values.output as string) : resolve("./dist");

      const spinner = new Spinner(t("Packaging team...", "正在打包团队..."));
      spinner.start();
      const packagePath = await packDirectoryToTarGz(resolvedPath, outputDir, teamName, version);
      spinner.stop(t("Package complete", "打包完成"));

      console.log(success(t("Team packaged successfully!\n", "团队打包成功!\n")));
      console.log(`${info(t("Team:", "团队:"))}    ${teamName} v${version}`);
      console.log(`${info(t("Output:", "输出:"))}  ${packagePath}`);
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
        console.log(t("Upload a team to the Market.\n", "上传团队到市场。\n"));
        console.log(t("Usage: agent-deploy team upload <team-dir> [options]", "用法: agent-deploy team upload <team-dir> [options]"));
        return;
      }

      const teamDir = positionals[0];
      if (!teamDir) {
        console.error(error(t("Error: team directory is required\n", "错误: 需要提供团队目录\n")));
        console.error(t("Usage: agent-deploy team upload <team-dir> [options]", "用法: agent-deploy team upload <team-dir> [options]"));
        process.exit(1);
      }

      const resolvedPath = resolve(teamDir);
      if (!existsSync(resolvedPath)) {
        throw ErrorHandlers.fileNotFound(resolvedPath, 'directory');
      }

      const spinner = new Spinner(t("Uploading team to Market...", "正在上传团队到市场..."));
      spinner.start();
      const result = await uploadTeam({
        teamDir: resolvedPath,
        marketUrl: values.market as string | undefined,
        apiKey: values["api-key"] as string | undefined,
        force: values.force as boolean,
      });
      spinner.stop(t("Upload complete", "上传完成"));

      console.log(success(t("Successfully uploaded team!\n", "成功上传团队!\n")));
      console.log(`${info(t("Team ID:", "团队 ID:"))}    ${result.team_id}`);
      console.log(`${info(t("Name:", "名称:"))}       ${result.team_name}`);
      console.log(`${info(t("Version:", "版本:"))}    ${result.version}`);
      console.log(`${info(t("Market URL:", "市场 URL:"))} ${result.market_url}\n`);
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
        console.log(t("Download a team from the Market.\n", "从市场下载团队。\n"));
        console.log(t("Usage: agent-deploy team download <team-name> [-o <dir>] [options]", "用法: agent-deploy team download <team-name> [-o <dir>] [options]"));
        return;
      }

      const teamName = positionals[0];
      if (!teamName) {
        console.error(error(t("Error: team name is required\n", "错误: 需要提供团队名称\n")));
        console.error(t("Usage: agent-deploy team download <team-name> [options]", "用法: agent-deploy team download <team-name> [options]"));
        process.exit(1);
      }

      const outputDir = values.output ? resolve(values.output as string) : resolve("./downloaded-teams");

      const spinner = new Spinner(t(`Downloading team: ${teamName}...`, `正在下载团队: ${teamName}...`));
      spinner.start();
      const result = await downloadTeam({
        teamId: teamName,
        outputDir,
        version: values.version as string | undefined,
        marketUrl: values.market as string | undefined,
      });
      spinner.stop(t("Download complete", "下载完成"));

      console.log(success(t("Successfully downloaded team!\n", "成功下载团队!\n")));
      console.log(`${info(t("Output:", "输出:"))} ${result.output_path}`);
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
        console.log(t("List teams from the Market.\n", "从市场列出团队。\n"));
        console.log(t("Usage: agent-deploy team list [options]", "用法: agent-deploy team list [options]"));
        return;
      }

      const spinner = new Spinner(t("Listing teams...", "正在列出团队..."));
      spinner.start();
      const result = await searchTeams({
        tag: values.tag as string | undefined,
        category: values.category as string | undefined,
      }, values.market as string | undefined);
      spinner.stop(t("Done", "完成"));

      if (!result.teams || result.teams.length === 0) {
        console.log(t("No teams found.", "未找到团队。"));
        return;
      }

      const header = [t("NAME", "名称"), t("VERSION", "版本"), t("AUTHOR", "作者"), t("CATEGORY", "分类"), t("TAGS", "标签"), t("DOWNLOADS", "下载")];
      const rows = result.teams.map(t => [
        t.name,
        t.version,
        t.author || "-",
        t.category || "-",
        (t.tags || []).join(", ") || "-",
        String(t.downloads || 0),
      ]);

      printTable(header, rows);
      console.log(`\n${t("Total:", "总计:")} ${result.total} ${t("team(s)", "个团队")}`);
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
        console.log(t("Validate team.json structure.\n", "验证 team.json 结构。\n"));
        console.log(t("Usage: agent-deploy team validate <team-dir>", "用法: agent-deploy team validate <team-dir>"));
        return;
      }

      const teamDir = positionals[0];
      if (!teamDir) {
        console.error(error(t("Error: team directory is required\n", "错误: 需要提供团队目录\n")));
        console.error(t("Usage: agent-deploy team validate <team-dir>", "用法: agent-deploy team validate <team-dir>"));
        process.exit(1);
      }

      const resolvedPath = resolve(teamDir);
      if (!existsSync(resolvedPath)) {
        throw ErrorHandlers.fileNotFound(resolvedPath, 'directory');
      }

      const teamJsonPath = path.join(resolvedPath, "team.json");
      if (!existsSync(teamJsonPath)) {
        console.error(error(t(`Error: team.json not found in ${resolvedPath}`, `错误: 在 ${resolvedPath} 中未找到 team.json`)));
        process.exit(1);
      }

      const spinner = new Spinner(t("Validating team.json...", "正在验证 team.json..."));
      spinner.start();
      const teamJson = JSON.parse(fs.readFileSync(teamJsonPath, "utf-8"));
      const errors: string[] = [];

      const identity = teamJson.identity || teamJson;
      if (!identity.name || typeof identity.name !== "string") {
        errors.push(t("Missing required field: identity.name", "缺少必填字段: identity.name"));
      }
      if (!identity.version || typeof identity.version !== "string") {
        errors.push(t("Missing required field: identity.version", "缺少必填字段: identity.version"));
      }
      spinner.stop(t("Validation complete", "验证完成"));

      if (errors.length > 0) {
        console.error(error(t("Validation failed:\n", "验证失败:\n")));
        errors.forEach(e => console.error(`  - ${e}`));
        process.exit(1);
      }

      console.log(success(t("team.json is valid!\n", "team.json 有效!\n")));
      console.log(`${info(t("Name:", "名称:"))}    ${identity.name}`);
      console.log(`${info(t("Version:", "版本:"))} ${identity.version}`);
      if (identity.display_name) console.log(`${info(t("Display:", "显示:"))} ${identity.display_name}`);
      if (identity.description) console.log(`${info(t("Desc:", "描述:"))}    ${identity.description.substring(0, 80)}`);
      if (identity.author) console.log(`${info(t("Author:", "作者:"))}  ${identity.author}`);
      if (identity.tags && identity.tags.length > 0) {
        console.log(`${info(t("Tags:", "标签:"))}    ${identity.tags.join(", ")}`);
      }
    } catch (error) {
      handleCommandError(error as Error, "team validate");
    }
    return;
  }

  console.error(error(t(`Unknown team action: ${action}\n`, `未知的团队操作: ${action}\n`)));
  console.error(t("Available actions: package, upload, download, list, validate", "可用操作: package, upload, download, list, validate"));
  console.error(t("Run 'agent-deploy team help' for more information", "运行 'agent-deploy team help' 获取更多信息"));
  process.exit(1);
}

/**
 * Handle workflow subcommand
 */
async function handleWorkflowCommand(args: string[]) {
  const action = args[0] || "help";

  if (action === "help" || action === "--help" || action === "-h") {
    console.log(`
${t("Usage: agent-deploy workflow <action> [options]", "用法: agent-deploy workflow <action> [options]")}

${t("Actions:", "操作:")}
  package <workflow-dir> [-o <dir>]           ${t("Package workflow directory into tar.gz", "将工作流目录打包为 tar.gz")}
  upload <workflow-dir> [options]             ${t("Upload workflow to Market", "上传工作流到市场")}
  download <workflow-name> [-o <dir>] [opts]  ${t("Download workflow from Market", "从市场下载工作流")}
  list [options]                              ${t("List workflows (search Market)", "列出工作流 (搜索市场)")}
  validate <workflow-dir>                     ${t("Validate workflow.json structure", "验证 workflow.json 结构")}

${t("Upload Options:", "上传选项:")}
  --market <url>     ${t("Market API URL (default: $MARKET_API_URL or http://localhost:8321)", "市场 API URL (默认: $MARKET_API_URL 或 http://localhost:8321)")}
  --api-key <key>    ${t("API key for authentication (default: $MARKET_API_KEY)", "API 认证密钥 (默认: $MARKET_API_KEY)")}
  --force            ${t("Force overwrite existing version", "强制覆盖已有版本")}

${t("Download Options:", "下载选项:")}
  -o, --output <dir>  ${t("Output directory (default: ./downloaded-workflows)", "输出目录 (默认: ./downloaded-workflows)")}
  --version <ver>     ${t("Specific version to download", "要下载的特定版本")}
  --market <url>      ${t("Market API URL", "市场 API URL")}

${t("List Options:", "列表选项:")}
  --tag <tag>         ${t("Filter by tag", "按标签过滤")}
  --category <cat>    ${t("Filter by category", "按分类过滤")}
  --market <url>      ${t("Market API URL", "市场 API URL")}

${t("Examples:", "示例:")}
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
        console.log(t("Package a workflow directory into a tar.gz archive.\n", "将工作流目录打包为 tar.gz 归档。\n"));
        console.log(t("Usage: agent-deploy workflow package <workflow-dir> [-o <dir>]", "用法: agent-deploy workflow package <workflow-dir> [-o <dir>]"));
        return;
      }

      const workflowDir = positionals[0];
      if (!workflowDir) {
        console.error(error(t("Error: workflow directory is required\n", "错误: 需要提供工作流目录\n")));
        console.error(t("Usage: agent-deploy workflow package <workflow-dir> [-o <dir>]", "用法: agent-deploy workflow package <workflow-dir> [-o <dir>]"));
        process.exit(1);
      }

      const resolvedPath = resolve(workflowDir);
      if (!existsSync(resolvedPath)) {
        throw ErrorHandlers.fileNotFound(resolvedPath, 'directory');
      }

      const workflowJsonPath = path.join(resolvedPath, "workflow.json");
      if (!existsSync(workflowJsonPath)) {
        console.error(error(t(`Error: workflow.json not found in ${resolvedPath}`, `错误: 在 ${resolvedPath} 中未找到 workflow.json`)));
        process.exit(1);
      }

      const workflowJson = JSON.parse(fs.readFileSync(workflowJsonPath, "utf-8"));
      const workflowName = workflowJson.identity?.name || workflowJson.name || path.basename(resolvedPath);
      const version = workflowJson.identity?.version || workflowJson.version || "0.0.0";

      const outputDir = values.output ? resolve(values.output as string) : resolve("./dist");

      const spinner = new Spinner(t("Packaging workflow...", "正在打包工作流..."));
      spinner.start();
      const packagePath = await packDirectoryToTarGz(resolvedPath, outputDir, workflowName, version);
      spinner.stop(t("Package complete", "打包完成"));

      console.log(success(t("Workflow packaged successfully!\n", "工作流打包成功!\n")));
      console.log(`${info(t("Workflow:", "工作流:"))}  ${workflowName} v${version}`);
      console.log(`${info(t("Output:", "输出:"))}    ${packagePath}`);
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
        console.log(t("Upload a workflow to the Market.\n", "上传工作流到市场。\n"));
        console.log(t("Usage: agent-deploy workflow upload <workflow-dir> [options]", "用法: agent-deploy workflow upload <workflow-dir> [options]"));
        return;
      }

      const workflowDir = positionals[0];
      if (!workflowDir) {
        console.error(error(t("Error: workflow directory is required\n", "错误: 需要提供工作流目录\n")));
        console.error(t("Usage: agent-deploy workflow upload <workflow-dir> [options]", "用法: agent-deploy workflow upload <workflow-dir> [options]"));
        process.exit(1);
      }

      const resolvedPath = resolve(workflowDir);
      if (!existsSync(resolvedPath)) {
        throw ErrorHandlers.fileNotFound(resolvedPath, 'directory');
      }

      const spinner = new Spinner(t("Uploading workflow to Market...", "正在上传工作流到市场..."));
      spinner.start();
      const result = await uploadWorkflow({
        workflowDir: resolvedPath,
        marketUrl: values.market as string | undefined,
        apiKey: values["api-key"] as string | undefined,
        force: values.force as boolean,
      });
      spinner.stop(t("Upload complete", "上传完成"));

      console.log(success(t("Successfully uploaded workflow!\n", "成功上传工作流!\n")));
      console.log(`${info(t("Workflow ID:", "工作流 ID:"))} ${result.workflow_id}`);
      console.log(`${info(t("Name:", "名称:"))}        ${result.workflow_name}`);
      console.log(`${info(t("Version:", "版本:"))}     ${result.version}`);
      console.log(`${info(t("Market URL:", "市场 URL:"))}  ${result.market_url}\n`);
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
        console.log(t("Download a workflow from the Market.\n", "从市场下载工作流。\n"));
        console.log(t("Usage: agent-deploy workflow download <workflow-name> [-o <dir>] [options]", "用法: agent-deploy workflow download <workflow-name> [-o <dir>] [options]"));
        return;
      }

      const workflowName = positionals[0];
      if (!workflowName) {
        console.error(error(t("Error: workflow name is required\n", "错误: 需要提供工作流名称\n")));
        console.error(t("Usage: agent-deploy workflow download <workflow-name> [options]", "用法: agent-deploy workflow download <workflow-name> [options]"));
        process.exit(1);
      }

      const outputDir = values.output ? resolve(values.output as string) : resolve("./downloaded-workflows");

      const spinner = new Spinner(t(`Downloading workflow: ${workflowName}...`, `正在下载工作流: ${workflowName}...`));
      spinner.start();
      const result = await downloadWorkflow({
        workflowId: workflowName,
        outputDir,
        version: values.version as string | undefined,
        marketUrl: values.market as string | undefined,
      });
      spinner.stop(t("Download complete", "下载完成"));

      console.log(success(t("Successfully downloaded workflow!\n", "成功下载工作流!\n")));
      console.log(`${info(t("Output:", "输出:"))} ${result.output_path}`);
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
        console.log(t("List workflows from the Market.\n", "从市场列出工作流。\n"));
        console.log(t("Usage: agent-deploy workflow list [options]", "用法: agent-deploy workflow list [options]"));
        return;
      }

      const spinner = new Spinner(t("Listing workflows...", "正在列出工作流..."));
      spinner.start();
      const result = await searchWorkflows({
        tag: values.tag as string | undefined,
        category: values.category as string | undefined,
      }, values.market as string | undefined);
      spinner.stop(t("Done", "完成"));

      if (!result.workflows || result.workflows.length === 0) {
        console.log(t("No workflows found.", "未找到工作流。"));
        return;
      }

      const header = [t("NAME", "名称"), t("VERSION", "版本"), t("AUTHOR", "作者"), t("CATEGORY", "分类"), t("TAGS", "标签"), t("DOWNLOADS", "下载")];
      const rows = result.workflows.map(w => [
        w.name,
        w.version,
        w.author || "-",
        w.category || "-",
        (w.tags || []).join(", ") || "-",
        String(w.downloads || 0),
      ]);

      printTable(header, rows);
      console.log(`\n${t("Total:", "总计:")} ${result.total} ${t("workflow(s)", "个工作流")}`);
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
        console.log(t("Validate workflow.json structure.\n", "验证 workflow.json 结构。\n"));
        console.log(t("Usage: agent-deploy workflow validate <workflow-dir>", "用法: agent-deploy workflow validate <workflow-dir>"));
        return;
      }

      const workflowDir = positionals[0];
      if (!workflowDir) {
        console.error(error(t("Error: workflow directory is required\n", "错误: 需要提供工作流目录\n")));
        console.error(t("Usage: agent-deploy workflow validate <workflow-dir>", "用法: agent-deploy workflow validate <workflow-dir>"));
        process.exit(1);
      }

      const resolvedPath = resolve(workflowDir);
      if (!existsSync(resolvedPath)) {
        throw ErrorHandlers.fileNotFound(resolvedPath, 'directory');
      }

      const workflowJsonPath = path.join(resolvedPath, "workflow.json");
      if (!existsSync(workflowJsonPath)) {
        console.error(error(t(`Error: workflow.json not found in ${resolvedPath}`, `错误: 在 ${resolvedPath} 中未找到 workflow.json`)));
        process.exit(1);
      }

      const spinner = new Spinner(t("Validating workflow.json...", "正在验证 workflow.json..."));
      spinner.start();
      const workflowJson = JSON.parse(fs.readFileSync(workflowJsonPath, "utf-8"));
      const errors: string[] = [];

      const identity = workflowJson.identity || workflowJson;
      if (!identity.name || typeof identity.name !== "string") {
        errors.push(t("Missing required field: identity.name", "缺少必填字段: identity.name"));
      }
      if (!identity.version || typeof identity.version !== "string") {
        errors.push(t("Missing required field: identity.version", "缺少必填字段: identity.version"));
      }
      spinner.stop(t("Validation complete", "验证完成"));

      if (errors.length > 0) {
        console.error(error(t("Validation failed:\n", "验证失败:\n")));
        errors.forEach(e => console.error(`  - ${e}`));
        process.exit(1);
      }

      console.log(success(t("workflow.json is valid!\n", "workflow.json 有效!\n")));
      console.log(`${info(t("Name:", "名称:"))}    ${identity.name}`);
      console.log(`${info(t("Version:", "版本:"))} ${identity.version}`);
      if (identity.display_name) console.log(`${info(t("Display:", "显示:"))} ${identity.display_name}`);
      if (identity.description) console.log(`${info(t("Desc:", "描述:"))}    ${identity.description.substring(0, 80)}`);
      if (identity.author) console.log(`${info(t("Author:", "作者:"))}  ${identity.author}`);
      if (identity.tags && identity.tags.length > 0) {
        console.log(`${info(t("Tags:", "标签:"))}    ${identity.tags.join(", ")}`);
      }
    } catch (error) {
      handleCommandError(error as Error, "workflow validate");
    }
    return;
  }

  console.error(error(t(`Unknown workflow action: ${action}\n`, `未知的工作流操作: ${action}\n`)));
  console.error(t("Available actions: package, upload, download, list, validate", "可用操作: package, upload, download, list, validate"));
  console.error(t("Run 'agent-deploy workflow help' for more information", "运行 'agent-deploy workflow help' 获取更多信息"));
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
