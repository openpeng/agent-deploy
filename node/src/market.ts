/**
 * Market API Client
 *
 * 提供与 Agent Market 服务交互的功能：
 * - 上传 Agent 到 Market
 * - 从 Market 下载 Agent
 * - 搜索和查询 Agent
 * - 版本管理（Agent/Team/Workflow）
 */

import fs from "fs";
import path from "path";
import os from "os";
import { Readable } from "stream";
import { AgentJsonV2 } from "./types.js";
import { ErrorHandlers } from "./errors.js";
import { getTracer } from "./telemetry.js";
import { SpanStatusCode } from "@opentelemetry/api";
import { recordMarketRequest } from "./metrics.js";
import { AgentCache } from "./runtime/agent-cache.js";

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
  version?: string;
  /** 强制跳过缓存，重新下载 */
  skipCache?: boolean;
}

export interface DownloadResult {
  success: boolean;
  agent_id: string;
  output_path: string;
  message?: string;
  /** 是否来自缓存 */
  fromCache?: boolean;
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

export interface VersionInfo {
  version: string;
  created_at: string;
  changelog?: string;
  author?: string;
  downloads?: number;
}

export interface SearchOptions {
  query?: string;
  tag?: string;
  category?: string;
  limit?: number;
  offset?: number;
  marketUrl?: string;
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
  downloads: number;
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
  downloads: number;
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
  version?: string;
}

export interface TeamSearchOptions {
  query?: string;
  tag?: string;
  category?: string;
  limit?: number;
  offset?: number;
  marketUrl?: string;
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
  version?: string;
}

export interface WorkflowSearchOptions {
  query?: string;
  tag?: string;
  category?: string;
  limit?: number;
  offset?: number;
  marketUrl?: string;
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

const marketTracer = getTracer("agent-deploy-market");

export class MarketClient {
  private baseUrl: string;
  private apiKey?: string;
  private cache: AgentCache;

  constructor(config: MarketConfig) {
    this.baseUrl = config.baseUrl || process.env.MARKET_API_URL || "http://localhost:8321";
    this.apiKey = config.apiKey || process.env.MARKET_API_KEY;
    this.cache = new AgentCache();
  }

  /** 获取关联的缓存实例 */
  getCache(): AgentCache {
    return this.cache;
  }

  /**
   * 上传 Agent 到 Market
   */
  async uploadAgent(options: UploadOptions): Promise<UploadResult> {
    return marketTracer.startActiveSpan("market.upload_agent", async (span) => {
      const agentDir = path.resolve(options.agentDir);
      const agentJsonPath = path.join(agentDir, "agent.json");
      span.setAttribute("market.agent_dir", agentDir);

      // 验证 agent.json 存在
      if (!fs.existsSync(agentJsonPath)) {
        const err = ErrorHandlers.missingAgentJson(agentDir);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        span.recordException(err);
        span.end();
        throw err;
      }

      // 读取 agent.json
      let agentJson: AgentJsonV2;
      try {
        agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const err = ErrorHandlers.invalidAgentJson(agentJsonPath, msg);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        span.recordException(err);
        span.end();
        throw err;
      }

      const agentName = agentJson.identity.name;
      const version = agentJson.identity.version;
      span.setAttribute("market.agent_name", agentName);
      span.setAttribute("market.version", version);

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
          recordMarketRequest("POST", "/api/v1/agents", "error");
          if (response.status === 401 || response.status === 403) {
            const err = ErrorHandlers.authenticationError();
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            span.recordException(err);
            span.end();
            throw err;
          } else if (response.status === 409) {
            const err = ErrorHandlers.conflictError(agentName, version);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            span.recordException(err);
            span.end();
            throw err;
          } else {
            const error = await response.json().catch(() => ({ detail: response.statusText }));
            const err = new Error(error.detail || `Upload failed: ${response.statusText}`);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            span.recordException(err);
            span.end();
            throw err;
          }
        }

        recordMarketRequest("POST", "/api/v1/agents", "success");
        const result = await response.json();
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();

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
    });
  }

  /**
   * 从 Market 下载 Agent（支持缓存）
   */
  async downloadAgent(options: DownloadOptions): Promise<DownloadResult> {
    return marketTracer.startActiveSpan("market.download_agent", async (span) => {
      const versionSpec = options.version || "latest";
      span.setAttribute("market.agent_id", options.agentId);
      span.setAttribute("market.version_spec", versionSpec);

      // 1. 检查缓存（除非 skipCache）
      if (!options.skipCache) {
        const cached = this.cache.get(options.agentId, versionSpec);
        if (cached) {
          // 复制到输出目录
          const outputDir = path.resolve(options.outputDir);
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }
          const extractDir = path.join(outputDir, options.agentId);
          this.copyDir(cached, extractDir);
          span.setAttribute("market.from_cache", true);
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return {
            success: true,
            agent_id: options.agentId,
            output_path: extractDir,
            message: "Agent loaded from cache",
            fromCache: true,
          };
        }
      }

      // 2. 从 Market 下载
      const marketUrl = options.marketUrl || this.baseUrl;
      let url = `${marketUrl}/api/v1/agents/${options.agentId}/download`;
      if (options.version) {
        url += `?version=${encodeURIComponent(options.version)}`;
      }
      span.setAttribute("market.url", url);

      const response = await fetch(url);

      if (!response.ok) {
        recordMarketRequest("GET", "/api/v1/agents/{id}/download", "error");
        if (response.status === 404) {
          const err = ErrorHandlers.notFoundError('Agent', options.agentId);
          span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
          span.recordException(err);
          span.end();
          throw err;
        }
        const err = new Error(`Download failed: ${response.statusText}`);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        span.recordException(err);
        span.end();
        throw err;
      }

      recordMarketRequest("GET", "/api/v1/agents/{id}/download", "success");
      // 获取 etag
      const etag = response.headers.get("etag") || undefined;

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

      // 3. 读取版本号并更新缓存
      const agentJsonPath = path.join(extractDir, "agent.json");
      let resolvedVersion = options.version || "0.0.0";
      if (fs.existsSync(agentJsonPath)) {
        try {
          const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
          resolvedVersion = agentJson.identity?.version || agentJson.version || resolvedVersion;
        } catch { /* use default version */ }
      }

      // 更新缓存
      this.cache.setFromDir(options.agentId, extractDir, resolvedVersion, { etag });

      span.setAttribute("market.from_cache", false);
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();

      return {
        success: true,
        agent_id: options.agentId,
        output_path: extractDir,
        message: "Agent downloaded successfully",
        fromCache: false,
      };
    });
  }

  /**
   * 获取 Agent 信息
   */
  async getAgent(agentId: string): Promise<AgentInfo> {
    return marketTracer.startActiveSpan("market.get_agent", async (span) => {
      const url = `${this.baseUrl}/api/v1/agents/${agentId}`;
      span.setAttribute("market.agent_id", agentId);

      const response = await fetch(url);

      if (!response.ok) {
        recordMarketRequest("GET", "/api/v1/agents/{id}", "error");
        if (response.status === 404) {
          const err = ErrorHandlers.notFoundError('Agent', agentId);
          span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
          span.recordException(err);
          span.end();
          throw err;
        }
        const err = new Error(`Failed to get agent: ${response.statusText}`);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        span.recordException(err);
        span.end();
        throw err;
      }

      recordMarketRequest("GET", "/api/v1/agents/{id}", "success");
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return await response.json();
    });
  }

  /**
   * 搜索 Agent
   */
  async searchAgents(options: SearchOptions = {}): Promise<SearchResult> {
    return marketTracer.startActiveSpan("market.search_agents", async (span) => {
      const params = new URLSearchParams();
      if (options.query) params.append('q', options.query);
      if (options.tag) params.append('tag', options.tag);
      if (options.category) params.append('category', options.category);
      if (options.limit) params.append('limit', options.limit.toString());
      if (options.offset) params.append('offset', options.offset.toString());

      const marketUrl = options.marketUrl || this.baseUrl;
      const url = `${marketUrl}/api/v1/agents?${params.toString()}`;
      span.setAttribute("market.url", url);

      try {
        const response = await fetch(url);

        if (!response.ok) {
          recordMarketRequest("GET", "/api/v1/agents", "error");
          const err = new Error(`Search failed: ${response.statusText}`);
          span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
          span.recordException(err);
          span.end();
          throw err;
        }

        recordMarketRequest("GET", "/api/v1/agents", "success");
        const result = await response.json();
        span.setAttribute("market.result_total", result.total ?? 0);
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('fetch') || msg.includes('ECONNREFUSED')) {
          const err = ErrorHandlers.marketConnectionError(this.baseUrl);
          span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
          span.recordException(err);
          span.end();
          throw err;
        }
        span.setStatus({ code: SpanStatusCode.ERROR, message: msg });
        if (error instanceof Error) span.recordException(error);
        span.end();
        throw error;
      }
    });
  }

  /**
   * 列出所有 Agent
   */
  async listAgents(limit: number = 50, offset: number = 0): Promise<SearchResult> {
    return this.searchAgents({ limit, offset });
  }

  // ============================================================
  // Agent 版本管理
  // ============================================================

  /**
   * 列出 Agent 的所有版本
   */
  async listAgentVersions(agentId: string): Promise<VersionInfo[]> {
    const url = `${this.baseUrl}/api/v1/agents/${agentId}/versions`;
    const response = await fetch(url);

    if (!response.ok) {
      recordMarketRequest("GET", "/api/v1/agents/{id}/versions", "error");
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Agent', agentId);
      }
      throw new Error(`Failed to list agent versions: ${response.statusText}`);
    }

    recordMarketRequest("GET", "/api/v1/agents/{id}/versions", "success");
    const data = await response.json();
    return data.versions || data;
  }

  /**
   * 获取 Agent 的特定版本信息
   */
  async getAgentVersion(agentId: string, version: string): Promise<AgentInfo> {
    const url = `${this.baseUrl}/api/v1/agents/${agentId}/versions/${version}`;
    const response = await fetch(url);

    if (!response.ok) {
      recordMarketRequest("GET", "/api/v1/agents/{id}/versions/{version}", "error");
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Agent version', `${agentId}@${version}`);
      }
      throw new Error(`Failed to get agent version: ${response.statusText}`);
    }

    recordMarketRequest("GET", "/api/v1/agents/{id}/versions/{version}", "success");
    return await response.json();
  }

  // ============================================================
  // Team 管理
  // ============================================================

  /**
   * 上传 Team 到 Market
   */
  async uploadTeam(options: TeamUploadOptions): Promise<TeamUploadResult> {
    const teamDir = path.resolve(options.teamDir);
    const teamJsonPath = path.join(teamDir, "team.json");

    if (!fs.existsSync(teamJsonPath)) {
      throw new Error(`team.json not found in directory: ${teamDir}`);
    }

    let teamJson: { name?: string; identity?: { name?: string; version?: string }; version?: string; identity_version?: string };
    try {
      teamJson = JSON.parse(fs.readFileSync(teamJsonPath, "utf-8")) as { name?: string; identity?: { name?: string; version?: string }; version?: string; identity_version?: string };
    } catch (error: unknown) {
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
        recordMarketRequest("POST", "/api/v1/teams", "error");
        if (response.status === 401 || response.status === 403) {
          throw ErrorHandlers.authenticationError();
        } else if (response.status === 409) {
          throw ErrorHandlers.conflictError(teamName, version);
        } else {
          const error = await response.json().catch(() => ({ detail: response.statusText }));
          throw new Error(error.detail || `Upload failed: ${response.statusText}`);
        }
      }

      recordMarketRequest("POST", "/api/v1/teams", "success");
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
    let url = `${marketUrl}/api/v1/teams/${options.teamId}/download`;
    if (options.version) {
      url += `?version=${encodeURIComponent(options.version)}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      recordMarketRequest("GET", "/api/v1/teams/{id}/download", "error");
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Team', options.teamId);
      }
      throw new Error(`Download failed: ${response.statusText}`);
    }

    recordMarketRequest("GET", "/api/v1/teams/{id}/download", "success");
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
      recordMarketRequest("GET", "/api/v1/teams/{id}", "error");
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Team', id);
      }
      throw new Error(`Failed to get team: ${response.statusText}`);
    }

    recordMarketRequest("GET", "/api/v1/teams/{id}", "success");
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

    const marketUrl = options.marketUrl || this.baseUrl;
    const url = `${marketUrl}/api/v1/teams?${params.toString()}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        recordMarketRequest("GET", "/api/v1/teams", "error");
        throw new Error(`Search failed: ${response.statusText}`);
      }

      recordMarketRequest("GET", "/api/v1/teams", "success");
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
  // Team 版本管理
  // ============================================================

  /**
   * 列出 Team 的所有版本
   */
  async listTeamVersions(teamId: string): Promise<VersionInfo[]> {
    const url = `${this.baseUrl}/api/v1/teams/${teamId}/versions`;
    const response = await fetch(url);

    if (!response.ok) {
      recordMarketRequest("GET", "/api/v1/teams/{id}/versions", "error");
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Team', teamId);
      }
      throw new Error(`Failed to list team versions: ${response.statusText}`);
    }

    recordMarketRequest("GET", "/api/v1/teams/{id}/versions", "success");
    const data = await response.json();
    return data.versions || data;
  }

  /**
   * 获取 Team 的特定版本信息
   */
  async getTeamVersion(teamId: string, version: string): Promise<TeamInfo> {
    const url = `${this.baseUrl}/api/v1/teams/${teamId}/versions/${version}`;
    const response = await fetch(url);

    if (!response.ok) {
      recordMarketRequest("GET", "/api/v1/teams/{id}/versions/{version}", "error");
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Team version', `${teamId}@${version}`);
      }
      throw new Error(`Failed to get team version: ${response.statusText}`);
    }

    recordMarketRequest("GET", "/api/v1/teams/{id}/versions/{version}", "success");
    return await response.json();
  }

  // ============================================================
  // Workflow 管理
  // ============================================================

  /**
   * 上传 Workflow 到 Market
   */
  async uploadWorkflow(options: WorkflowUploadOptions): Promise<WorkflowUploadResult> {
    const workflowDir = path.resolve(options.workflowDir);
    const workflowJsonPath = path.join(workflowDir, "workflow.json");

    if (!fs.existsSync(workflowJsonPath)) {
      throw new Error(`workflow.json not found in directory: ${workflowDir}`);
    }

    let workflowJson: { name?: string; identity?: { name?: string; version?: string }; version?: string; identity_version?: string };
    try {
      workflowJson = JSON.parse(fs.readFileSync(workflowJsonPath, "utf-8")) as { name?: string; identity?: { name?: string; version?: string }; version?: string; identity_version?: string };
    } catch (error: unknown) {
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
        recordMarketRequest("POST", "/api/v1/workflows", "error");
        if (response.status === 401 || response.status === 403) {
          throw ErrorHandlers.authenticationError();
        } else if (response.status === 409) {
          throw ErrorHandlers.conflictError(workflowName, version);
        } else {
          const error = await response.json().catch(() => ({ detail: response.statusText }));
          throw new Error(error.detail || `Upload failed: ${response.statusText}`);
        }
      }

      recordMarketRequest("POST", "/api/v1/workflows", "success");
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
    let url = `${marketUrl}/api/v1/workflows/${options.workflowId}/download`;
    if (options.version) {
      url += `?version=${encodeURIComponent(options.version)}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      recordMarketRequest("GET", "/api/v1/workflows/{id}/download", "error");
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Workflow', options.workflowId);
      }
      throw new Error(`Download failed: ${response.statusText}`);
    }

    recordMarketRequest("GET", "/api/v1/workflows/{id}/download", "success");
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
      recordMarketRequest("GET", "/api/v1/workflows/{id}", "error");
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Workflow', id);
      }
      throw new Error(`Failed to get workflow: ${response.statusText}`);
    }

    recordMarketRequest("GET", "/api/v1/workflows/{id}", "success");
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
        recordMarketRequest("GET", "/api/v1/workflows", "error");
        throw new Error(`Search failed: ${response.statusText}`);
      }

      recordMarketRequest("GET", "/api/v1/workflows", "success");
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
  // Workflow 版本管理
  // ============================================================

  /**
   * 列出 Workflow 的所有版本
   */
  async listWorkflowVersions(workflowId: string): Promise<VersionInfo[]> {
    const url = `${this.baseUrl}/api/v1/workflows/${workflowId}/versions`;
    const response = await fetch(url);

    if (!response.ok) {
      recordMarketRequest("GET", "/api/v1/workflows/{id}/versions", "error");
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Workflow', workflowId);
      }
      throw new Error(`Failed to list workflow versions: ${response.statusText}`);
    }

    recordMarketRequest("GET", "/api/v1/workflows/{id}/versions", "success");
    const data = await response.json();
    return data.versions || data;
  }

  /**
   * 获取 Workflow 的特定版本信息
   */
  async getWorkflowVersion(workflowId: string, version: string): Promise<WorkflowInfo> {
    const url = `${this.baseUrl}/api/v1/workflows/${workflowId}/versions/${version}`;
    const response = await fetch(url);

    if (!response.ok) {
      recordMarketRequest("GET", "/api/v1/workflows/{id}/versions/{version}", "error");
      if (response.status === 404) {
        throw ErrorHandlers.notFoundError('Workflow version', `${workflowId}@${version}`);
      }
      throw new Error(`Failed to get workflow version: ${response.statusText}`);
    }

    recordMarketRequest("GET", "/api/v1/workflows/{id}/versions/{version}", "success");
    return await response.json();
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

  /**
   * 复制目录（用于缓存到输出目录）
   */
  private copyDir(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
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
// Team / Workflow 便捷函数
// ============================================================

export async function uploadTeam(options: TeamUploadOptions): Promise<TeamUploadResult> {
  const client = new MarketClient({
    baseUrl: options.marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
    apiKey: options.apiKey || process.env.MARKET_API_KEY,
  });
  return await client.uploadTeam(options);
}

export async function downloadTeam(options: TeamDownloadOptions): Promise<TeamDownloadResult> {
  const client = new MarketClient({
    baseUrl: options.marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.downloadTeam(options);
}

export async function searchTeams(options: TeamSearchOptions = {}, marketUrl?: string): Promise<TeamSearchResult> {
  const client = new MarketClient({
    baseUrl: marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.searchTeams(options);
}

export async function getTeam(teamId: string, marketUrl?: string): Promise<TeamInfo> {
  const client = new MarketClient({
    baseUrl: marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.getTeam(teamId);
}

export async function uploadWorkflow(options: WorkflowUploadOptions): Promise<WorkflowUploadResult> {
  const client = new MarketClient({
    baseUrl: options.marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
    apiKey: options.apiKey || process.env.MARKET_API_KEY,
  });
  return await client.uploadWorkflow(options);
}

export async function downloadWorkflow(options: WorkflowDownloadOptions): Promise<WorkflowDownloadResult> {
  const client = new MarketClient({
    baseUrl: options.marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.downloadWorkflow(options);
}

export async function searchWorkflows(options: WorkflowSearchOptions = {}, marketUrl?: string): Promise<WorkflowSearchResult> {
  const client = new MarketClient({
    baseUrl: marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.searchWorkflows(options);
}

export async function getWorkflow(workflowId: string, marketUrl?: string): Promise<WorkflowInfo> {
  const client = new MarketClient({
    baseUrl: marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.getWorkflow(workflowId);
}

// ============================================================
// 版本管理便捷函数
// ============================================================

export async function listAgentVersions(agentId: string, marketUrl?: string): Promise<VersionInfo[]> {
  const client = new MarketClient({
    baseUrl: marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.listAgentVersions(agentId);
}

export async function getAgentVersion(agentId: string, version: string, marketUrl?: string): Promise<AgentInfo> {
  const client = new MarketClient({
    baseUrl: marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.getAgentVersion(agentId, version);
}

export async function listTeamVersions(teamId: string, marketUrl?: string): Promise<VersionInfo[]> {
  const client = new MarketClient({
    baseUrl: marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.listTeamVersions(teamId);
}

export async function getTeamVersion(teamId: string, version: string, marketUrl?: string): Promise<TeamInfo> {
  const client = new MarketClient({
    baseUrl: marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.getTeamVersion(teamId, version);
}

export async function listWorkflowVersions(workflowId: string, marketUrl?: string): Promise<VersionInfo[]> {
  const client = new MarketClient({
    baseUrl: marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.listWorkflowVersions(workflowId);
}

export async function getWorkflowVersion(workflowId: string, version: string, marketUrl?: string): Promise<WorkflowInfo> {
  const client = new MarketClient({
    baseUrl: marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
  });
  return await client.getWorkflowVersion(workflowId, version);
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
