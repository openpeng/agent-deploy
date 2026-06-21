/**
 * AgentLoader — 从不同源加载 Agent 的统一接口
 *
 * 支持的 URL schema:
 *   market://notification-agent@1.0.0  → 市场 ID + 版本
 *   market://notification-agent         → 最新版本
 *   file:///path/to/agent              → 本地绝对路径
 *   ./relative/path                    → 相对路径
 *   notification-agent                 → 简单名称（兄弟目录或 Market）
 */

import * as path from "path";
import * as fs from "fs";
import { AgentCache } from "./agent-cache.js";
import { MarketClient } from "../market.js";

export interface AgentLoaderInterface {
  supports(uri: string): boolean;
  load(uri: string): Promise<string>;
}

/**
 * MarketAgentLoader — 从市场加载 Agent
 */
export class MarketAgentLoader implements AgentLoaderInterface {
  private cache: AgentCache;
  private marketClient: MarketClient;

  constructor(
    cache: AgentCache,
    marketUrl?: string
  ) {
    this.cache = cache;
    this.marketClient = new MarketClient({
      baseUrl: marketUrl || process.env.MARKET_API_URL || "http://localhost:8321",
    });
  }

  supports(uri: string): boolean {
    return uri.startsWith("market://");
  }

  async load(uri: string): Promise<string> {
    const { agentId, version } = this.parseUri(uri);
    const versionSpec = version || "latest";

    // 1. 检查缓存
    const cached = this.cache.get(agentId, versionSpec);
    if (cached) {
      return cached;
    }

    // 2. 从市场下载
    const result = await this.marketClient.downloadAgent({
      agentId,
      outputDir: path.join(this.cache.getCacheDir(), "_downloads"),
    });

    // 3. 读取版本号
    const agentJsonPath = path.join(result.output_path, "agent.json");
    let resolvedVersion = version || "0.0.0";
    if (fs.existsSync(agentJsonPath)) {
      try {
        const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
        resolvedVersion = agentJson.identity?.version || agentJson.version || resolvedVersion;
      } catch { /* use default version */ }
    }

    // 4. 安装到缓存
    const cachedPath = this.cache.setFromDir(agentId, result.output_path, resolvedVersion);

    // 5. 清理下载目录
    try { fs.rmSync(result.output_path, { recursive: true, force: true }); } catch { /* ignore */ }

    return cachedPath;
  }

  /** Parse market://agent-name@version URI */
  private parseUri(uri: string): { agentId: string; version: string | null } {
    // market://notification-agent@1.0.0
    const withoutProtocol = uri.replace(/^market:\/\//, "");
    const atIndex = withoutProtocol.lastIndexOf("@");

    if (atIndex > 0) {
      return {
        agentId: withoutProtocol.substring(0, atIndex),
        version: withoutProtocol.substring(atIndex + 1),
      };
    }

    return {
      agentId: withoutProtocol,
      version: null,
    };
  }
}

/**
 * FileSystemAgentLoader — 从本地文件系统加载
 */
export class FileSystemAgentLoader implements AgentLoaderInterface {
  supports(uri: string): boolean {
    // file:// or relative/absolute path
    return uri.startsWith("file://") || !uri.startsWith("market://");
  }

  async load(uri: string): Promise<string> {
    // Strip file:// prefix if present
    const filePath = uri.replace(/^file:\/\//, "");

    let agentDir: string;

    if (fs.existsSync(filePath) && fs.existsSync(path.join(filePath, "agent.json"))) {
      // Direct path
      agentDir = path.resolve(filePath);
    } else {
      // Simple name — check sibling directories
      const cwd = process.cwd();
      const parentDir = path.dirname(cwd);
      agentDir = path.join(parentDir, filePath);

      if (!fs.existsSync(agentDir)) {
        agentDir = path.resolve(cwd, filePath);
      }
    }

    if (!fs.existsSync(agentDir) || !fs.existsSync(path.join(agentDir, "agent.json"))) {
      throw new Error(`Agent not found: ${uri} (resolved to ${agentDir})`);
    }

    return agentDir;
  }
}

/**
 * AgentResolver — 统一解析器，按优先级尝试不同 loader
 */
export class AgentResolver {
  private loaders: AgentLoaderInterface[];

  constructor(...loaders: AgentLoaderInterface[]) {
    this.loaders = loaders;
  }

  /**
   * Resolve an agent reference to a local directory path
   *
   * Resolution order:
   *   1. 绝对路径 / file:// URL → FileSystemLoader
   *   2. 相对路径 ./ ../  → FileSystemLoader
   *   3. market:// URL   → MarketLoader
   *   4. 简单名称        → FileSystemLoader (兄弟目录) → 失败后抛错
   */
  async resolve(agentRef: string): Promise<string> {
    for (const loader of this.loaders) {
      if (loader.supports(agentRef)) {
        return await loader.load(agentRef);
      }
    }

    throw new Error(`No loader supports agent reference: ${agentRef}`);
  }
}
