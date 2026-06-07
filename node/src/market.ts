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
import FormData from "form-data";
import { AgentJsonV2 } from "./types.js";

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
      throw new Error(`agent.json not found in ${agentDir}`);
    }

    // 读取 agent.json
    const agentJson: AgentJsonV2 = JSON.parse(
      fs.readFileSync(agentJsonPath, "utf-8")
    );

    const agentName = agentJson.identity.name;
    const version = agentJson.identity.version;

    // 打包 Agent 目录为 tar.gz
    const packagePath = await this.packAgent(agentDir, agentName, version);

    try {
      // 准备表单数据
      const form = new FormData();
      form.append("file", fs.createReadStream(packagePath));
      form.append("force", options.force ? "true" : "false");

      // 发送请求
      const marketUrl = options.marketUrl || this.baseUrl;
      const apiKey = options.apiKey || this.apiKey;

      const headers: Record<string, string> = {
        ...form.getHeaders(),
      };

      if (apiKey) {
        headers["X-API-Key"] = apiKey;
      }

      const response = await fetch(`${marketUrl}/api/v1/agents`, {
        method: "POST",
        headers,
        body: form as any,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || `Upload failed: ${response.statusText}`);
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
      throw new Error(`Agent not found: ${agentId}`);
    }

    return await response.json();
  }

  /**
   * 搜索 Agent
   */
  async searchAgents(query: string): Promise<AgentInfo[]> {
    const url = `${this.baseUrl}/api/v1/agents?q=${encodeURIComponent(query)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Search failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result.agents || [];
  }

  /**
   * 列出所有 Agent
   */
  async listAgents(options?: { category?: string; limit?: number; offset?: number }): Promise<AgentInfo[]> {
    const params = new URLSearchParams();
    if (options?.category) params.append("category", options.category);
    if (options?.limit) params.append("limit", options.limit.toString());
    if (options?.offset) params.append("offset", options.offset.toString());

    const url = `${this.baseUrl}/api/v1/agents?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`List agents failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result.agents || [];
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 打包 Agent 目录为 tar.gz
   */
  private async packAgent(agentDir: string, agentName: string, version: string): Promise<string> {
    const tar = await import("tar");
    const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "agent-deploy-"));
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
