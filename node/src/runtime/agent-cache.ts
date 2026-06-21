/**
 * AgentCache — 本地 Agent 缓存管理（增强版）
 *
 * 缓存结构:
 *   ~/.agent-deploy/cache/ 或 AGENT_CACHE_DIR
 *   ├── notification-agent/
 *   │   ├── 1.0.0/
 *   │   │   ├── agent.json
 *   │   │   └── ...
 *   │   └── 1.0.1/
 *   ├── logger-agent/
 *   │   └── 0.5.2/
 *   └── manifest.json
 *
 * manifest 格式:
 *   {
 *     "agents": {
 *       "notification-agent": {
 *         "versions": {
 *           "1.0.0": {
 *             "cached_at": "2026-06-20T10:00:00Z",
 *             "etag": "abc123",
 *             "size": 1024,
 *             "sha256": "..."
 *           }
 *         }
 *       }
 *     }
 *   }
 */

import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import * as crypto from "crypto";
import * as semver from "semver";
import { recordCacheHit, recordCacheMiss } from "../metrics.js";

/** 单个版本的缓存元数据 */
export interface CacheVersionMeta {
  cached_at: string;
  etag?: string;
  size: number;
  sha256: string;
}

/** Agent 级别的缓存元数据 */
export interface CacheAgentMeta {
  versions: Record<string, CacheVersionMeta>;
}

/** 缓存清单 */
export interface CacheManifest {
  agents: Record<string, CacheAgentMeta>;
}

export interface CacheOptions {
  /** 缓存目录，默认 ~/.agent-deploy/cache */
  cacheDir?: string;
  /** TTL（毫秒），默认 24 小时 */
  ttlMs?: number;
}

export class AgentCache {
  private cacheDir: string;
  private manifestPath: string;
  private manifest: CacheManifest;
  private ttlMs: number;

  constructor(options?: CacheOptions) {
    this.cacheDir =
      options?.cacheDir ||
      process.env.AGENT_CACHE_DIR ||
      path.join(homedir(), ".agent-deploy", "cache");
    this.ttlMs = options?.ttlMs || 24 * 60 * 60 * 1000; // 24h
    this.manifestPath = path.join(this.cacheDir, "manifest.json");
    this.manifest = this.loadManifest();
  }

  // ============================================================
  // 私有辅助方法
  // ============================================================

  private loadManifest(): CacheManifest {
    try {
      if (fs.existsSync(this.manifestPath)) {
        const raw = fs.readFileSync(this.manifestPath, "utf-8");
        return JSON.parse(raw) as CacheManifest;
      }
    } catch {
      // ignore parse errors, start fresh
    }
    return { agents: {} };
  }

  private saveManifest(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2));
  }

  private agentDir(agentId: string): string {
    return path.join(this.cacheDir, agentId);
  }

  private versionDir(agentId: string, version: string): string {
    return path.join(this.agentDir(agentId), version);
  }

  private computeSha256(buffer: Buffer): string {
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  private isExpired(meta: CacheVersionMeta): boolean {
    const cachedAt = new Date(meta.cached_at).getTime();
    return Date.now() - cachedAt > this.ttlMs;
  }

  // ============================================================
  // 公共 API
  // ============================================================

  /**
   * 获取缓存的 Agent 路径
   * @param agentId Agent ID
   * @param version 版本号，不传则返回最新版本
   * @returns 缓存目录路径，未命中或过期则返回 null
   */
  get(agentId: string, version?: string): string | null {
    const agentMeta = this.manifest.agents[agentId];
    if (!agentMeta || Object.keys(agentMeta.versions).length === 0) {
      recordCacheMiss();
      return null;
    }

    let targetVersion: string | null;

    if (version) {
      // 精确匹配或 semver 范围匹配
      if (agentMeta.versions[version]) {
        targetVersion = version;
      } else {
        targetVersion = semver.maxSatisfying(
          Object.keys(agentMeta.versions),
          version
        );
      }
    } else {
      // 取最新版本
      targetVersion = semver.maxSatisfying(
        Object.keys(agentMeta.versions),
        "*"
      );
    }

    if (!targetVersion) {
      recordCacheMiss();
      return null;
    }

    const meta = agentMeta.versions[targetVersion];
    const dir = this.versionDir(agentId, targetVersion);

    // 验证目录存在且未过期
    if (!fs.existsSync(dir)) {
      this.invalidate(agentId, targetVersion);
      recordCacheMiss();
      return null;
    }

    if (this.isExpired(meta)) {
      recordCacheMiss();
      return null; // 过期但保留文件，下次 set 会覆盖
    }

    recordCacheHit();
    return dir;
  }

  /**
   * 写入缓存
   * @param agentId Agent ID
   * @param content Agent 内容（tar.gz 包或目录内容的 Buffer）
   * @param version 版本号
   * @param meta 可选的额外元数据（etag 等）
   * @returns 缓存目录路径
   */
  set(
    agentId: string,
    content: Buffer,
    version?: string,
    meta?: { etag?: string }
  ): string {
    const resolvedVersion = version || "unknown";
    const targetDir = this.versionDir(agentId, resolvedVersion);

    // 确保目录存在
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 写入内容（假设 content 是 tar.gz，需要解压）
    // 如果 content 是目录结构的 zip/tar，由调用方先解压为目录后再传入
    // 这里我们支持两种模式：
    // 1. content 是文件 Buffer -> 写入临时文件
    // 2. 实际使用场景：由 MarketClient 下载后解压到目录，然后调用 setFromDir

    // 为了通用性，这里先提供基于目录的缓存接口
    // 实际内容写入由调用方（如 MarketClient）通过 setFromDir 完成

    const sha256 = this.computeSha256(content);
    const size = content.length;

    // 更新 manifest
    if (!this.manifest.agents[agentId]) {
      this.manifest.agents[agentId] = { versions: {} };
    }

    this.manifest.agents[agentId].versions[resolvedVersion] = {
      cached_at: new Date().toISOString(),
      etag: meta?.etag,
      size,
      sha256,
    };

    this.saveManifest();
    return targetDir;
  }

  /**
   * 从已解压的目录设置缓存
   * @param agentId Agent ID
   * @param sourceDir 源目录（已解压的 Agent 目录）
   * @param version 版本号
   * @param meta 可选元数据
   * @returns 缓存目录路径
   */
  setFromDir(
    agentId: string,
    sourceDir: string,
    version?: string,
    meta?: { etag?: string }
  ): string {
    const resolvedVersion = version || "unknown";
    const targetDir = this.versionDir(agentId, resolvedVersion);

    // 清理旧版本目录
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }

    // 复制目录
    this.copyDir(sourceDir, targetDir);

    // 计算大小和 sha256（基于 agent.json）
    const agentJsonPath = path.join(targetDir, "agent.json");
    let size = 0;
    let sha256 = "";
    if (fs.existsSync(agentJsonPath)) {
      const buf = fs.readFileSync(agentJsonPath);
      size = buf.length;
      sha256 = this.computeSha256(buf);
    }

    // 更新 manifest
    if (!this.manifest.agents[agentId]) {
      this.manifest.agents[agentId] = { versions: {} };
    }

    this.manifest.agents[agentId].versions[resolvedVersion] = {
      cached_at: new Date().toISOString(),
      etag: meta?.etag,
      size,
      sha256,
    };

    this.saveManifest();
    return targetDir;
  }

  /**
   * 使缓存失效
   * @param agentId Agent ID
   * @param version 版本号，不传则清除该 Agent 所有版本
   */
  invalidate(agentId: string, version?: string): void {
    const agentMeta = this.manifest.agents[agentId];
    if (!agentMeta) return;

    if (version) {
      // 删除特定版本
      const dir = this.versionDir(agentId, version);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      delete agentMeta.versions[version];
      if (Object.keys(agentMeta.versions).length === 0) {
        delete this.manifest.agents[agentId];
      }
    } else {
      // 删除所有版本
      const dir = this.agentDir(agentId);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      delete this.manifest.agents[agentId];
    }

    this.saveManifest();
  }

  /** 清空所有缓存 */
  clear(): void {
    // 删除所有 Agent 目录
    for (const agentId of Object.keys(this.manifest.agents)) {
      const dir = this.agentDir(agentId);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    this.manifest = { agents: {} };
    this.saveManifest();
  }

  /** 获取缓存目录路径 */
  getCacheDir(): string {
    return this.cacheDir;
  }

  /** 获取缓存元数据 */
  getMeta(agentId: string, version: string): CacheVersionMeta | null {
    return this.manifest.agents[agentId]?.versions[version] || null;
  }

  /** 检查缓存是否存在且未过期 */
  has(agentId: string, version?: string): boolean {
    return this.get(agentId, version) !== null;
  }

  /** 列出所有缓存的 Agent */
  list(): string[] {
    return Object.keys(this.manifest.agents);
  }

  /** 获取 Agent 的所有缓存版本 */
  getVersions(agentId: string): string[] {
    return Object.keys(this.manifest.agents[agentId]?.versions || {});
  }

  /** 获取缓存统计 */
  getStats(): { totalAgents: number; totalVersions: number; cacheDir: string } {
    let totalVersions = 0;
    for (const agent of Object.values(this.manifest.agents)) {
      totalVersions += Object.keys(agent.versions).length;
    }
    return {
      totalAgents: Object.keys(this.manifest.agents).length,
      totalVersions,
      cacheDir: this.cacheDir,
    };
  }

  // ============================================================
  // 私有辅助方法
  // ============================================================

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
