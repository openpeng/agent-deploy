/**
 * Market API Client
 *
 * 提供与 Agent Market 服务交互的功能：
 * - 上传 Agent 到 Market
 * - 从 Market 下载 Agent
 * - 搜索和查询 Agent
 */

import fs from "fs";
import path from "path";
import os from "os";
import { Readable } from "stream";
import { AgentJsonV2 } from "./types.js";
import { ErrorHandlers } from "./errors.js";

// ============================================================
// 类型定义
// ============================================================

export interface MarketConfig {
  baseUrl: string;
  apiKey?: string;
}

export interface UploadOptions {
  agentDir: string;
  force?: boolean;
  marketUrl?: string;
  apiKey?: string;
}

export interface UploadResult {
  success: boolean;
  agent_id: string;
  agent_name: string;
  version: string;
  market_url: string;
  message?: string;
}

export interface DownloadOptions {
  agentId: string;
  outputDir: string;
  marketUrl?: string;
}

export interface DownloadResult {
  success: boolean;
  agent_id: string;
  output_path: string;
  message?: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  tags: string[];
  downloads: number;
  rating: number;
  created_at: string;
  updated_at: string;
}

export interface SearchOptions {
  query?: string;
  tag?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  agents: AgentInfo[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListLocalOptions {
  type?: 'imported' | 'downloaded' | 'all';
  outputDir?: string;
}

export interface TeamInfo {
  id: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  type: string;
  tags: string[];
  package_size: number;
  package_format: string;
  package_sha256: string;
  json_content: string;
  dependencies: string[];
  homepage_url?: string;
  source_url?: string;
  license?: string;
  readme?: string;
  download_count: number;
  rating: number;
  rating_count: number;
  created_at: string;
  updated_at: string;
  published_at?: string;
}

export interface WorkflowInfo {
  id: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  type: string;
  tags: string[];
  package_size: number;
  package_format: string;
  package_sha256: string;
  json_content: string;
  dependencies: string[];
  homepage_url?: string;
  source_url?: string;
  license?: string;
  readme?: string;
  download_count: number;
  rating: number;
  rating_count: number;
  created_at: string;
  updated_at: string;
  published_at?: string;
}

export interface TeamUploadOptions {
  teamDir: string;
  force?: boolean;
  marketUrl?: string;
  apiKey?: string;
}

export interface TeamDownloadOptions {
  teamId: string;
  outputDir: string;
  marketUrl?: string;
}

export interface TeamSearchOptions {
  query?: string;
  tag?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface TeamUploadResult {
  success: boolean;
  team_id: string;
  team_name: string;
  version: string;
  market_url: string;
  message?: string;
}

export interface TeamDownloadResult {
  success: boolean;
  team_id: string;
  output_path: string;
  message?: string;
}

export interface TeamSearchResult {
  teams: TeamInfo[];
  total: number;
}

export interface WorkflowUploadOptions {
  workflowDir: string;
  force?: boolean;
  marketUrl?: string;
  apiKey?: string;
}

export interface WorkflowDownloadOptions {
  workflowId: string;
  outputDir: string;
  marketUrl?: string;
}

export interface WorkflowSearchOptions {
  query?: string;
  tag?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface WorkflowUploadResult {
  success: boolean;
  workflow_id: string;
  workflow_name: string;
  version: string;
  market_url: string;
  message?: string;
}

export interface WorkflowDownloadResult {
  success: boolean;
  workflow_id: string;
  output_path: string;
  message?: string;
}

export interface WorkflowSearchResult {
  workflows: WorkflowInfo[];
  total: number;
}

// ============================================================
// Market Client
// ============================================================

export class MarketClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(config: MarketConfig) {
    this.baseUrl = config.baseUrl || process.env.MARKET_API_URL || "http://localhost:8321";
    this.apiKey = config.apiKey || process.env.MARKET_API_KEY;
  }

  /**
   * 上传 Agent 到 Market
   */
  async uploadAgent(options: UploadOptions): Promise<UploadResult> {
    const agentDir = path.resolve(options.agentDir);
    const agentJsonPath = path.join(agentDir, "agent.json");

    // 验证 agent.json 存在
    if (!fs.existsSync(agentJsonPath)) {
      throw ErrorHandlers.missingAgentJson(agentDir);
    }

    // 读取 agent.json
    let agentJson: AgentJsonV2;
    try {
      agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw ErrorHandlers.invalidAgentJson(agentJsonPath, msg);
    }

    const agentName = agentJson.identity.name;
    const version = agentJson.identity.version;

    // 打包 Agent 目录为 tar.gz
    const packagePath = await this.packAgent(agentDir, agentName, version);

    try {
      const marketUrl = options.marketUrl || this.baseUrl;
      const apiKey = options.apiKey || this.apiKey;

      // Use native FormData + Blob for reliable multipart encoding via fetch
      const formData = new FormData();
      const fileBuffer = await fs.promises.readFile(packagePath);
      const blob = new Blob([fileBuffer], { type: "application/gzip" });
      formData.append("file", blob, `${agentName}-v${version}.tar.gz`);
      formData.append("force", options.force ? "true" : "false");

      const fetchHeaders: Record<string, string> = {};
      if (apiKey) {
        fetchHeaders["Authorization"] = `Bearer ${apiKey}`;
      }

      const response = await fetch(`${marketUrl}/api/v1/agents`, {
        method: "POST",
        headers: fetchHeaders,
        body: formData,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw ErrorHandlers.authenticationError();
        } else if (response.status === 409) {
          throw ErrorHandlers.conflictError(agentName, version);
        } else {
          const error = await response.json().catch(() => ({ detail: response.statusText }));
          throw new Error(error.detail || `Upload failed: ${response.statusText}`);
        }
      }

      const result = await response.json();

      return {
        success: true,
        agent_id: result.id || agentName,
        agent_name: agentName,
        version: version,
        market_url: `${marketUrl}/agents/${agentName}`,
        message: result.message || "Agent uploaded successfully",
      };
    } finally {
      // 清理临时包文件
      if (fs.existsSync(packagePath)) {
        fs.unlinkSync(packagePath);
      }
    }
  }

  /**
   * 从 Market 下载 Agent
   */
  async downloadAgent(options: DownloadOptions): Promise<DownloadResult> {
    const marketUrl = options.marketUrl || this.baseUrl;
    const url = `${marketUrl}/api/v1/agents/${options.agentId}/download`;

    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Agent', options.agentId);
      }
      throw new Error(`Download failed: ${response.statusText}`);
    }

    // 确保输出目录存在
    const outputDir = path.resolve(options.outputDir);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 获取文件名
    const contentDisposition = response.headers.get("content-disposition");
    let filename = `${options.agentId}.tar.gz`;
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match) {
        filename = match[1];
      }
    }

    // 保存文件
    const outputPath = path.join(outputDir, filename);
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(buffer));

    // 解压
    const extractDir = path.join(outputDir, options.agentId);
    await this.extractAgent(outputPath, extractDir);

    // 清理压缩包
    fs.unlinkSync(outputPath);

    return {
      success: true,
      agent_id: options.agentId,
      output_path: extractDir,
      message: "Agent downloaded successfully",
    };
  }

  /**
   * 获取 Agent 信息
   */
  async getAgent(agentId: string): Promise<AgentInfo> {
    const url = `${this.baseUrl}/api/v1/agents/${agentId}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Agent', agentId);
      }
      throw new Error(`Failed to get agent: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * 搜索 Agent
   */
  async searchAgents(options: SearchOptions = {}): Promise<SearchResult> {
    const params = new URLSearchParams();
    if (options.query) params.append('q', options.query);
    if (options.tag) params.append('tag', options.tag);
    if (options.category) params.append('category', options.category);
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.offset) params.append('offset', options.offset.toString());

    const url = `${this.baseUrl}/api/v1/agents?${params.toString()}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('fetch') || msg.includes('ECONNREFUSED')) {
        throw ErrorHandlers.marketConnectionError(this.baseUrl);
      }
      throw error;
    }
  }

  /**
   * 列出所有 Agent
   */
  async listAgents(limit: number = 50, offset: number = 0): Promise<SearchResult> {
    return this.searchAgents({ limit, offset });
  }

  /**
   * 上传 Team 到 Market
   */
  async uploadTeam(options: TeamUploadOptions): Promise<TeamUploadResult> {
    const teamDir = path.resolve(options.teamDir);
    const teamJsonPath = path.join(teamDir, "team.json");

    if (!fs.existsSync(teamJsonPath)) {
      throw new Error(`team.json not found in directory: ${teamDir}`);
    }

    let teamJson: any;
    try {
      teamJson = JSON.parse(fs.readFileSync(teamJsonPath, "utf-8"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid team.json at ${teamJsonPath}: ${msg}`);
    }

    const teamName = teamJson.name || teamJson.identity?.name;
    const version = teamJson.version || teamJson.identity?.version;

    if (!teamName || !version) {
      throw new Error(`team.json must contain 'name' and 'version' fields`);
    }

    const packagePath = await this.packAgent(teamDir, teamName, version);

    try {
      const marketUrl = options.marketUrl || this.baseUrl;
      const apiKey = options.apiKey || this.apiKey;

      const formData = new FormData();
      const fileBuffer = await fs.promises.readFile(packagePath);
      const blob = new Blob([fileBuffer], { type: "application/gzip" });
      formData.append("file", blob, `${teamName}-v${version}.tar.gz`);
      formData.append("force", options.force ? "true" : "false");

      const fetchHeaders: Record<string, string> = {};
      if (apiKey) {
        fetchHeaders["Authorization"] = `Bearer ${apiKey}`;
      }

      const response = await fetch(`${marketUrl}/api/v1/teams`, {
        method: "POST",
        headers: fetchHeaders,
        body: formData,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw ErrorHandlers.authenticationError();
        } else if (response.status === 409) {
          throw ErrorHandlers.conflictError(teamName, version);
        } else {
          const error = await response.json().catch(() => ({ detail: response.statusText }));
          throw new Error(error.detail || `Upload failed: ${response.statusText}`);
        }
      }

      const result = await response.json();

      return {
        success: true,
        team_id: result.id || teamName,
        team_name: teamName,
        version: version,
        market_url: `${marketUrl}/teams/${teamName}`,
        message: result.message || "Team uploaded successfully",
      };
    } finally {
      if (fs.existsSync(packagePath)) {
        fs.unlinkSync(packagePath);
      }
    }
  }

  /**
   * 从 Market 下载 Team
   */
  async downloadTeam(options: TeamDownloadOptions): Promise<TeamDownloadResult> {
    const marketUrl = options.marketUrl || this.baseUrl;
    const url = `${marketUrl}/api/v1/teams/${options.teamId}/download`;

    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Team', options.teamId);
      }
      throw new Error(`Download failed: ${response.statusText}`);
    }

    const outputDir = path.resolve(options.outputDir);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const contentDisposition = response.headers.get("content-disposition");
    let filename = `${options.teamId}.tar.gz`;
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match) {
        filename = match[1];
      }
    }

    const outputPath = path.join(outputDir, filename);
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(buffer));

    const extractDir = path.join(outputDir, options.teamId);
    await this.extractAgent(outputPath, extractDir);

    fs.unlinkSync(outputPath);

    return {
      success: true,
      team_id: options.teamId,
      output_path: extractDir,
      message: "Team downloaded successfully",
    };
  }

  /**
   * 获取 Team 信息
   */
  async getTeam(id: string): Promise<TeamInfo> {
    const url = `${this.baseUrl}/api/v1/teams/${id}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Team', id);
      }
      throw new Error(`Failed to get team: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * 搜索 Team
   */
  async searchTeams(options: TeamSearchOptions = {}): Promise<TeamSearchResult> {
    const params = new URLSearchParams();
    if (options.query) params.append('q', options.query);
    if (options.tag) params.append('tag', options.tag);
    if (options.category) params.append('category', options.category);
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.offset) params.append('offset', options.offset.toString());

    const url = `${this.baseUrl}/api/v1/teams?${params.toString()}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('fetch') || msg.includes('ECONNREFUSED')) {
        throw ErrorHandlers.marketConnectionError(this.baseUrl);
      }
      throw error;
    }
  }

  /**
   * 上传 Workflow 到 Market
   */
  async uploadWorkflow(options: WorkflowUploadOptions): Promise<WorkflowUploadResult> {
    const workflowDir = path.resolve(options.workflowDir);
    const workflowJsonPath = path.join(workflowDir, "workflow.json");

    if (!fs.existsSync(workflowJsonPath)) {
      throw new Error(`workflow.json not found in directory: ${workflowDir}`);
    }

    let workflowJson: any;
    try {
      workflowJson = JSON.parse(fs.readFileSync(workflowJsonPath, "utf-8"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid workflow.json at ${workflowJsonPath}: ${msg}`);
    }

    const workflowName = workflowJson.name || workflowJson.identity?.name;
    const version = workflowJson.version || workflowJson.identity?.version;

    if (!workflowName || !version) {
      throw new Error(`workflow.json must contain 'name' and 'version' fields`);
    }

    const packagePath = await this.packAgent(workflowDir, workflowName, version);

    try {
      const marketUrl = options.marketUrl || this.baseUrl;
      const apiKey = options.apiKey || this.apiKey;

      const formData = new FormData();
      const fileBuffer = await fs.promises.readFile(packagePath);
      const blob = new Blob([fileBuffer], { type: "application/gzip" });
      formData.append("file", blob, `${workflowName}-v${version}.tar.gz`);
      formData.append("force", options.force ? "true" : "false");

      const fetchHeaders: Record<string, string> = {};
      if (apiKey) {
        fetchHeaders["Authorization"] = `Bearer ${apiKey}`;
      }

      const response = await fetch(`${marketUrl}/api/v1/workflows`, {
        method: "POST",
        headers: fetchHeaders,
        body: formData,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw ErrorHandlers.authenticationError();
        } else if (response.status === 409) {
          throw ErrorHandlers.conflictError(workflowName, version);
        } else {
          const error = await response.json().catch(() => ({ detail: response.statusText }));
          throw new Error(error.detail || `Upload failed: ${response.statusText}`);
        }
      }

      const result = await response.json();

      return {
        success: true,
        workflow_id: result.id || workflowName,
        workflow_name: workflowName,
        version: version,
        market_url: `${marketUrl}/workflows/${workflowName}`,
        message: result.message || "Workflow uploaded successfully",
      };
    } finally {
      if (fs.existsSync(packagePath)) {
        fs.unlinkSync(packagePath);
      }
    }
  }

  /**
   * 从 Market 下载 Workflow
   */
  async downloadWorkflow(options: WorkflowDownloadOptions): Promise<WorkflowDownloadResult> {
    const marketUrl = options.marketUrl || this.baseUrl;
    const url = `${marketUrl}/api/v1/workflows/${options.workflowId}/download`;

    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Workflow', options.workflowId);
      }
      throw new Error(`Download failed: ${response.statusText}`);
    }

    const outputDir = path.resolve(options.outputDir);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const contentDisposition = response.headers.get("content-disposition");
    let filename = `${options.workflowId}.tar.gz`;
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match) {
        filename = match[1];
      }
    }

    const outputPath = path.join(outputDir, filename);
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(buffer));

    const extractDir = path.join(outputDir, options.workflowId);
    await this.extractAgent(outputPath, extractDir);

    fs.unlinkSync(outputPath);

    return {
      success: true,
      workflow_id: options.workflowId,
      output_path: extractDir,
      message: "Workflow downloaded successfully",
    };
  }

  /**
   * 获取 Workflow 信息
   */
  async getWorkflow(id: string): Promise<WorkflowInfo> {
    const url = `${this.baseUrl}/api/v1/workflows/${id}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Workflow', id);
      }
      throw new Error(`Failed to get workflow: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * 搜索 Workflow
   */
  async searchWorkflows(options: WorkflowSearchOptions = {}): Promise<WorkflowSearchResult> {
    const params = new URLSearchParams();
    if (options.query) params.append('q', options.query);
    if (options.tag) params.append('tag', options.tag);
    if (options.category) params.append('category', options.category);
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.offset) params.append('offset', options.offset.toString());

    const url = `${this.baseUrl}/api/v1/workflows?${params.toString()}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('fetch') || msg.includes('ECONNREFUSED')) {
        throw ErrorHandlers.marketConnectionError(this.baseUrl);
      }
      throw error;
    }
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 打包 Agent 目录为 tar.gz
   */
  private async packAgent(agentDir: string, agentName: string, version: string): Promise<string> {
    const tar = await import("tar");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-deploy-"));
    const packagePath = path.join(tmpDir, `${agentName}-v${version}.tar.gz`);

    await tar.create(
      {
        gzip: true,
        file: packagePath,
        cwd: path.dirname(agentDir),
      },
      [path.basename(agentDir)]
    );

    return packagePath;
  }

  /**
   * 解压 Agent 包
   */
  private async extractAgent(packagePath: string, extractDir: string): Promise<void> {
    const tar = await import("tar");

    if (!fs.existsSync(extractDir)) {
      fs.mkdirSync(extractDir, { recursive: true });
    }

    await tar.extract({
      file: packagePath,
      cwd: extractDir,
      strip: 1, // 移除顶层目录
    });
  }
}

// ============================================================
// 本地 Agent 管理
// ============================================================

/**
 * 列出本地的 Agent
 */
export async function listLocalAgents(options: ListLocalOptions = {}): Promise<AgentInfo[]> {
  const agents: AgentInfo[] = [];
  const dirs: string[] = [];

  // 确定要扫描的目录
  if (options.type === 'imported' || options.type === 'all' || !options.type) {
    dirs.push(path.resolve(options.outputDir || './', 'imported-agents'));
  }
  if (options.type === 'downloaded' || options.type === 'all' || !options.type) {
    dirs.push(path.resolve(options.outputDir || './', 'downloaded-agents'));
  }
  if (options.type === 'all' || !options.type) {
    dirs.push(path.resolve(options.outputDir || './', 'agents'));
  }

  // 扫描每个目录
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const agentDir = path.join(dir, entry.name);
      const agentJsonPath = path.join(agentDir, 'agent.json');

      if (!fs.existsSync(agentJsonPath)) continue;

      try {
        const agentJson: AgentJsonV2 = JSON.parse(
          fs.readFileSync(agentJsonPath, 'utf-8')
        );

        const stats = fs.statSync(agentJsonPath);

        agents.push({
          id: agentJson.identity.name,
          name: agentJson.identity.name,
          display_name: agentJson.identity.display_name || agentJson.identity.name,
          version: agentJson.identity.version,
          description: agentJson.identity.description || '',
          author: agentJson.identity.author || 'Unknown',
          category: (agentJson.identity as any).category || 'general',
          tags: agentJson.identity.tags || [],
          downloads: 0,
          rating: 0,
          created_at: stats.birthtime.toISOString(),
          updated_at: stats.mtime.toISOString(),
        });
      } catch (err) {
        // Skip invalid agent.json files
        continue;
      }
    }
  }

  return agents;
}

// ============================================================
// 便捷函数
// ============================================================

/**
 * 上传 Agent 到 Market
 */
export async function uploadAgent(options: UploadOptions): Promise<UploadResult> {
  const client = new MarketClient({
    baseUrl: options.marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
    apiKey: options.apiKey || process.env.MARKET_API_KEY,
  });

  return await client.uploadAgent(options);
}

/**
 * 从 Market 下载 Agent
 */
export async function downloadAgent(options: DownloadOptions): Promise<DownloadResult> {
  const client = new MarketClient({
    baseUrl: options.marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });

  return await client.downloadAgent(options);
}

// ============================================================
// Team 支持
// ============================================================

export interface TeamInfo {
  id: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  tags: string[];
  downloads: number;
  rating: number;
  created_at: string;
  updated_at: string;
}

export interface TeamSearchResult {
  teams: TeamInfo[];
  total: number;
  limit: number;
  offset: number;
}

export interface UploadTeamOptions {
  teamDir: string;
  force?: boolean;
  marketUrl?: string;
  apiKey?: string;
}

export interface UploadTeamResult {
  success: boolean;
  team_id: string;
  team_name: string;
  version: string;
  market_url: string;
  message?: string;
}

export interface DownloadTeamOptions {
  teamName: string;
  outputDir: string;
  version?: string;
  marketUrl?: string;
}

export interface DownloadTeamResult {
  success: boolean;
  team_id: string;
  output_path: string;
  message?: string;
}

// 在 MarketClient 上扩展 team/workflow 方法
declare module "./market.js" {
  // 保持编译期声明一致
}

export class TeamMarketClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(config: MarketConfig) {
    this.baseUrl = config.baseUrl || process.env.MARKET_API_URL || "http://localhost:8321";
    this.apiKey = config.apiKey || process.env.MARKET_API_KEY;
  }

  async uploadTeam(options: UploadTeamOptions): Promise<UploadTeamResult> {
    const teamDir = path.resolve(options.teamDir);
    const teamJsonPath = path.join(teamDir, "team.json");

    if (!fs.existsSync(teamJsonPath)) {
      throw ErrorHandlers.missingAgentJson(teamDir);
    }

    let teamJson: any;
    try {
      teamJson = JSON.parse(fs.readFileSync(teamJsonPath, "utf-8"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw ErrorHandlers.invalidAgentJson(teamJsonPath, msg);
    }

    const teamName = teamJson.identity?.name || teamJson.name;
    const version = teamJson.identity?.version || teamJson.version;

    const tar = await import("tar");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-deploy-team-"));
    const packagePath = path.join(tmpDir, `${teamName}-v${version}.tar.gz`);

    await tar.create(
      { gzip: true, file: packagePath, cwd: path.dirname(teamDir) },
      [path.basename(teamDir)]
    );

    try {
      const marketUrl = options.marketUrl || this.baseUrl;
      const apiKey = options.apiKey || this.apiKey;

      const formData = new FormData();
      const fileBuffer = await fs.promises.readFile(packagePath);
      const blob = new Blob([fileBuffer], { type: "application/gzip" });
      formData.append("file", blob, `${teamName}-v${version}.tar.gz`);
      formData.append("force", options.force ? "true" : "false");

      const fetchHeaders: Record<string, string> = {};
      if (apiKey) {
        fetchHeaders["Authorization"] = `Bearer ${apiKey}`;
      }

      const response = await fetch(`${marketUrl}/api/v1/teams`, {
        method: "POST",
        headers: fetchHeaders,
        body: formData,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw ErrorHandlers.authenticationError();
        } else if (response.status === 409) {
          throw ErrorHandlers.conflictError(teamName, version);
        } else {
          const error = await response.json().catch(() => ({ detail: response.statusText }));
          throw new Error(error.detail || `Upload failed: ${response.statusText}`);
        }
      }

      const result = await response.json();

      return {
        success: true,
        team_id: result.id || teamName,
        team_name: teamName,
        version: version,
        market_url: `${marketUrl}/teams/${teamName}`,
        message: result.message || "Team uploaded successfully",
      };
    } finally {
      if (fs.existsSync(packagePath)) {
        fs.unlinkSync(packagePath);
      }
      if (fs.existsSync(tmpDir)) {
        try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
      }
    }
  }

  async downloadTeam(options: DownloadTeamOptions): Promise<DownloadTeamResult> {
    const marketUrl = options.marketUrl || this.baseUrl;
    const versionQuery = options.version ? `?version=${encodeURIComponent(options.version)}` : "";
    const url = `${marketUrl}/api/v1/teams/${options.teamName}/download${versionQuery}`;

    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Team', options.teamName);
      }
      throw new Error(`Download failed: ${response.statusText}`);
    }

    const outputDir = path.resolve(options.outputDir);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const contentDisposition = response.headers.get("content-disposition");
    let filename = `${options.teamName}.tar.gz`;
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match) filename = match[1];
    }

    const outputPath = path.join(outputDir, filename);
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(buffer));

    const tar = await import("tar");
    const extractDir = path.join(outputDir, options.teamName);
    if (!fs.existsSync(extractDir)) {
      fs.mkdirSync(extractDir, { recursive: true });
    }
    await tar.extract({ file: outputPath, cwd: extractDir, strip: 1 });

    fs.unlinkSync(outputPath);

    return {
      success: true,
      team_id: options.teamName,
      output_path: extractDir,
      message: "Team downloaded successfully",
    };
  }

  async getTeam(teamId: string): Promise<TeamInfo> {
    const url = `${this.baseUrl}/api/v1/teams/${teamId}`;
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) throw ErrorHandlers.notFoundError('Team', teamId);
      throw new Error(`Failed to get team: ${response.statusText}`);
    }
    return await response.json();
  }

  async searchTeams(options: SearchOptions = {}): Promise<TeamSearchResult> {
    const params = new URLSearchParams();
    if (options.query) params.append('q', options.query);
    if (options.tag) params.append('tag', options.tag);
    if (options.category) params.append('category', options.category);
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.offset) params.append('offset', options.offset.toString());

    const url = `${this.baseUrl}/api/v1/teams?${params.toString()}`;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Search failed: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('fetch') || msg.includes('ECONNREFUSED')) {
        throw ErrorHandlers.marketConnectionError(this.baseUrl);
      }
      throw error;
    }
  }
}

// ============================================================
// Workflow 支持
// ============================================================

export interface WorkflowInfo {
  id: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  tags: string[];
  downloads: number;
  rating: number;
  created_at: string;
  updated_at: string;
}

export interface WorkflowSearchResult {
  workflows: WorkflowInfo[];
  total: number;
  limit: number;
  offset: number;
}

export interface UploadWorkflowOptions {
  workflowDir: string;
  force?: boolean;
  marketUrl?: string;
  apiKey?: string;
}

export interface UploadWorkflowResult {
  success: boolean;
  workflow_id: string;
  workflow_name: string;
  version: string;
  market_url: string;
  message?: string;
}

export interface DownloadWorkflowOptions {
  workflowName: string;
  outputDir: string;
  version?: string;
  marketUrl?: string;
}

export interface DownloadWorkflowResult {
  success: boolean;
  workflow_id: string;
  output_path: string;
  message?: string;
}

export class WorkflowMarketClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(config: MarketConfig) {
    this.baseUrl = config.baseUrl || process.env.MARKET_API_URL || "http://localhost:8321";
    this.apiKey = config.apiKey || process.env.MARKET_API_KEY;
  }

  async uploadWorkflow(options: UploadWorkflowOptions): Promise<UploadWorkflowResult> {
    const workflowDir = path.resolve(options.workflowDir);
    const workflowJsonPath = path.join(workflowDir, "workflow.json");

    if (!fs.existsSync(workflowJsonPath)) {
      throw ErrorHandlers.missingAgentJson(workflowDir);
    }

    let workflowJson: any;
    try {
      workflowJson = JSON.parse(fs.readFileSync(workflowJsonPath, "utf-8"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw ErrorHandlers.invalidAgentJson(workflowJsonPath, msg);
    }

    const workflowName = workflowJson.identity?.name || workflowJson.name;
    const version = workflowJson.identity?.version || workflowJson.version;

    const tar = await import("tar");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-deploy-workflow-"));
    const packagePath = path.join(tmpDir, `${workflowName}-v${version}.tar.gz`);

    await tar.create(
      { gzip: true, file: packagePath, cwd: path.dirname(workflowDir) },
      [path.basename(workflowDir)]
    );

    try {
      const marketUrl = options.marketUrl || this.baseUrl;
      const apiKey = options.apiKey || this.apiKey;

      const formData = new FormData();
      const fileBuffer = await fs.promises.readFile(packagePath);
      const blob = new Blob([fileBuffer], { type: "application/gzip" });
      formData.append("file", blob, `${workflowName}-v${version}.tar.gz`);
      formData.append("force", options.force ? "true" : "false");

      const fetchHeaders: Record<string, string> = {};
      if (apiKey) {
        fetchHeaders["Authorization"] = `Bearer ${apiKey}`;
      }

      const response = await fetch(`${marketUrl}/api/v1/workflows`, {
        method: "POST",
        headers: fetchHeaders,
        body: formData,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw ErrorHandlers.authenticationError();
        } else if (response.status === 409) {
          throw ErrorHandlers.conflictError(workflowName, version);
        } else {
          const error = await response.json().catch(() => ({ detail: response.statusText }));
          throw new Error(error.detail || `Upload failed: ${response.statusText}`);
        }
      }

      const result = await response.json();

      return {
        success: true,
        workflow_id: result.id || workflowName,
        workflow_name: workflowName,
        version: version,
        market_url: `${marketUrl}/workflows/${workflowName}`,
        message: result.message || "Workflow uploaded successfully",
      };
    } finally {
      if (fs.existsSync(packagePath)) {
        fs.unlinkSync(packagePath);
      }
      if (fs.existsSync(tmpDir)) {
        try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
      }
    }
  }

  async downloadWorkflow(options: DownloadWorkflowOptions): Promise<DownloadWorkflowResult> {
    const marketUrl = options.marketUrl || this.baseUrl;
    const versionQuery = options.version ? `?version=${encodeURIComponent(options.version)}` : "";
    const url = `${marketUrl}/api/v1/workflows/${options.workflowName}/download${versionQuery}`;

    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Workflow', options.workflowName);
      }
      throw new Error(`Download failed: ${response.statusText}`);
    }

    const outputDir = path.resolve(options.outputDir);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const contentDisposition = response.headers.get("content-disposition");
    let filename = `${options.workflowName}.tar.gz`;
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match) filename = match[1];
    }

    const outputPath = path.join(outputDir, filename);
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(buffer));

    const tar = await import("tar");
    const extractDir = path.join(outputDir, options.workflowName);
    if (!fs.existsSync(extractDir)) {
      fs.mkdirSync(extractDir, { recursive: true });
    }
    await tar.extract({ file: outputPath, cwd: extractDir, strip: 1 });

    fs.unlinkSync(outputPath);

    return {
      success: true,
      workflow_id: options.workflowName,
      output_path: extractDir,
      message: "Workflow downloaded successfully",
    };
  }

  async getWorkflow(workflowId: string): Promise<WorkflowInfo> {
    const url = `${this.baseUrl}/api/v1/workflows/${workflowId}`;
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) throw ErrorHandlers.notFoundError('Workflow', workflowId);
      throw new Error(`Failed to get workflow: ${response.statusText}`);
    }
    return await response.json();
  }

  async searchWorkflows(options: SearchOptions = {}): Promise<WorkflowSearchResult> {
    const params = new URLSearchParams();
    if (options.query) params.append('q', options.query);
    if (options.tag) params.append('tag', options.tag);
    if (options.category) params.append('category', options.category);
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.offset) params.append('offset', options.offset.toString());

    const url = `${this.baseUrl}/api/v1/workflows?${params.toString()}`;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Search failed: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('fetch') || msg.includes('ECONNREFUSED')) {
        throw ErrorHandlers.marketConnectionError(this.baseUrl);
      }
      throw error;
    }
  }
}

// ============================================================
// Team / Workflow 便捷函数
// ============================================================

export async function uploadTeam(options: UploadTeamOptions): Promise<UploadTeamResult> {
  const client = new TeamMarketClient({
    baseUrl: options.marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
    apiKey: options.apiKey || process.env.MARKET_API_KEY,
  });
  return await client.uploadTeam(options);
}

export async function downloadTeam(options: DownloadTeamOptions): Promise<DownloadTeamResult> {
  const client = new TeamMarketClient({
    baseUrl: options.marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.downloadTeam(options);
}

export async function searchTeams(options: SearchOptions = {}, marketUrl?: string): Promise<TeamSearchResult> {
  const client = new TeamMarketClient({
    baseUrl: marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.searchTeams(options);
}

export async function getTeam(teamId: string, marketUrl?: string): Promise<TeamInfo> {
  const client = new TeamMarketClient({
    baseUrl: marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.getTeam(teamId);
}

export async function uploadWorkflow(options: UploadWorkflowOptions): Promise<UploadWorkflowResult> {
  const client = new WorkflowMarketClient({
    baseUrl: options.marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
    apiKey: options.apiKey || process.env.MARKET_API_KEY,
  });
  return await client.uploadWorkflow(options);
}

export async function downloadWorkflow(options: DownloadWorkflowOptions): Promise<DownloadWorkflowResult> {
  const client = new WorkflowMarketClient({
    baseUrl: options.marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.downloadWorkflow(options);
}

export async function searchWorkflows(options: SearchOptions = {}, marketUrl?: string): Promise<WorkflowSearchResult> {
  const client = new WorkflowMarketClient({
    baseUrl: marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.searchWorkflows(options);
}

export async function getWorkflow(workflowId: string, marketUrl?: string): Promise<WorkflowInfo> {
  const client = new WorkflowMarketClient({
    baseUrl: marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.getWorkflow(workflowId);
}

// ============================================================
// 本地打包工具
// ============================================================

export async function packDirectoryToTarGz(
  dir: string,
  outputDir: string,
  fileNameBase: string,
  version: string
): Promise<string> {
  const resolvedDir = path.resolve(dir);
  const resolvedOutput = path.resolve(outputDir);

  if (!fs.existsSync(resolvedDir)) {
    throw ErrorHandlers.fileNotFound(resolvedDir, 'directory');
  }

  if (!fs.existsSync(resolvedOutput)) {
    fs.mkdirSync(resolvedOutput, { recursive: true });
  }

  const tar = await import("tar");
  const packagePath = path.join(resolvedOutput, `${fileNameBase}-v${version}.tar.gz`);

  await tar.create(
    { gzip: true, file: packagePath, cwd: path.dirname(resolvedDir) },
    [path.basename(resolvedDir)]
  );

  return packagePath;
}

/**
 * 搜索 Agent
 */
export async function searchAgents(options: SearchOptions = {}): Promise<SearchResult> {
  const client = new MarketClient({
    baseUrl: options.marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });

  return await client.searchAgents(options);
}

/**
 * 获取 Agent 信息
 */
export async function getAgent(agentId: string, marketUrl?: string): Promise<AgentInfo> {
  const client = new MarketClient({
    baseUrl: marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });

  return await client.getAgent(agentId);
}
