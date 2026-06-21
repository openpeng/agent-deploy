/**
 * UpdateChecker — 检查已部署 Agent 的更新
 *
 * 功能：
 * - 扫描已部署 Agent 的 agent.json
 * - 对比 Market 上的最新版本
 * - 支持 SemVer 比较（major/minor/patch 级别）
 * - 支持自动检查（定时任务）
 */

import { getActiveDeployments, type DeploymentRecord } from "./state.js";
import { MarketClient, type AgentInfo } from "./market.js";
import * as semver from "semver";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// 类型定义
// ============================================================

export interface UpdateInfo {
  /** Agent ID */
  agentId: string;
  /** 当前部署版本 */
  currentVersion: string;
  /** Market 最新版本 */
  latestVersion?: string;
  /** 是否有更新可用 */
  isUpdateAvailable: boolean;
  /** 更新级别: major | minor | patch | none */
  updateLevel?: "major" | "minor" | "patch";
  /** 发布日期 */
  releaseDate?: string;
  /** 更新日志 */
  changelog?: string;
  /** Market agent ID */
  marketId?: string;
  /** 错误信息 */
  error?: string;
}

export interface UpdateSummary {
  total: number;
  upToDate: number;
  hasUpdates: number;
  checkFailed: number;
  updatesByLevel: {
    major: number;
    minor: number;
    patch: number;
  };
}

export interface UpdateCheckerOptions {
  /** Market API URL */
  marketUrl?: string;
  /** 是否包含未通过 state 追踪的本地 agent */
  includeLocalAgents?: boolean;
  /** 本地 agent 扫描目录 */
  localAgentDirs?: string[];
}

// ============================================================
// UpdateChecker 类
// ============================================================

export class UpdateChecker {
  private marketClient: MarketClient;
  private options: UpdateCheckerOptions;
  private autoCheckTimer: NodeJS.Timeout | null = null;

  constructor(options?: UpdateCheckerOptions) {
    this.options = options || {};
    this.marketClient = new MarketClient({
      baseUrl:
        this.options.marketUrl ||
        process.env.MARKET_API_URL ||
        "http://localhost:8321",
    });
  }

  /**
   * 检查所有已部署 Agent 的更新
   */
  async checkAll(): Promise<UpdateInfo[]> {
    const deployments = getActiveDeployments();
    const results: UpdateInfo[] = [];
    const seenAgents = new Set<string>();

    // 检查已部署的 agent
    for (const deployment of deployments) {
      if (seenAgents.has(deployment.agent_name)) continue;
      seenAgents.add(deployment.agent_name);

      const info = await this.checkAgent(deployment.agent_name, deployment.version);
      results.push(info);
    }

    // 检查本地 agent（如果启用）
    if (this.options.includeLocalAgents) {
      const localAgents = this.scanLocalAgents();
      for (const local of localAgents) {
        if (seenAgents.has(local.name)) continue;
        seenAgents.add(local.name);

        const info = await this.checkAgent(local.name, local.version);
        results.push(info);
      }
    }

    return results;
  }

  /**
   * 检查单个 Agent 的更新
   * @param agentId Agent ID 或名称
   * @param currentVersion 当前版本（可选，会从部署记录中查找）
   */
  async checkAgent(agentId: string, currentVersion?: string): Promise<UpdateInfo> {
    const resolvedVersion = currentVersion || this.getDeployedVersion(agentId);

    const info: UpdateInfo = {
      agentId,
      currentVersion: resolvedVersion || "unknown",
      isUpdateAvailable: false,
    };

    try {
      // 从 Market 获取 Agent 信息
      const agentInfo = await this.marketClient.getAgent(agentId);

      info.marketId = agentInfo.id;
      info.latestVersion = agentInfo.version;
      info.releaseDate = agentInfo.updated_at;

      // SemVer 比较
      if (resolvedVersion && resolvedVersion !== "unknown") {
        const comparison = this.compareVersions(
          resolvedVersion,
          agentInfo.version
        );
        info.isUpdateAvailable = comparison < 0;

        if (info.isUpdateAvailable) {
          info.updateLevel = this.getUpdateLevel(
            resolvedVersion,
            agentInfo.version
          );
        }
      } else {
        // 未知当前版本，只要有 market 版本就认为有更新
        info.isUpdateAvailable = true;
      }

      // 尝试获取 changelog（通过版本列表）
      try {
        const versions = await this.marketClient.listAgentVersions(agentId);
        const latestVersionInfo = versions.find(
          (v) => v.version === agentInfo.version
        );
        if (latestVersionInfo?.changelog) {
          info.changelog = latestVersionInfo.changelog;
        }
      } catch {
        // 忽略版本列表获取失败
      }
    } catch (err: unknown) {
      info.error =
        (err instanceof Error ? err.message : String(err)) ||
        "Failed to check Market";
    }

    return info;
  }

  /**
   * 获取更新摘要
   */
  async getUpdateSummary(): Promise<UpdateSummary> {
    const updates = await this.checkAll();
    return this.summarizeUpdates(updates);
  }

  /**
   * 启动自动检查（定时任务）
   * @param intervalMs 检查间隔（毫秒），默认 1 小时
   * @param callback 检查结果回调
   */
  startAutoCheck(
    intervalMs: number = 60 * 60 * 1000,
    callback?: (updates: UpdateInfo[]) => void
  ): void {
    this.stopAutoCheck();

    const runCheck = async () => {
      try {
        const updates = await this.checkAll();
        if (callback) {
          callback(updates);
        }
      } catch (err) {
        console.warn("[UpdateChecker] Auto-check failed:", err);
      }
    };

    // 立即执行一次
    runCheck();

    // 定时执行
    this.autoCheckTimer = setInterval(runCheck, intervalMs);
  }

  /**
   * 停止自动检查
   */
  stopAutoCheck(): void {
    if (this.autoCheckTimer) {
      clearInterval(this.autoCheckTimer);
      this.autoCheckTimer = null;
    }
  }

  // ============================================================
  // 私有辅助方法
  // ============================================================

  private getDeployedVersion(agentName: string): string | undefined {
    const deployments = getActiveDeployments();
    const deployment = deployments.find((d) => d.agent_name === agentName);
    return deployment?.version;
  }

  private scanLocalAgents(): Array<{ name: string; version: string; path: string }> {
    const agents: Array<{ name: string; version: string; path: string }> = [];
    const dirs = this.options.localAgentDirs || [
      path.join(process.cwd(), "agents"),
      path.join(process.cwd(), "imported-agents"),
      path.join(process.cwd(), "downloaded-agents"),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const agentJsonPath = path.join(dir, entry.name, "agent.json");
          if (!fs.existsSync(agentJsonPath)) continue;

          try {
            const agentJson = JSON.parse(
              fs.readFileSync(agentJsonPath, "utf-8")
            ) as {
              identity?: { name?: string; version?: string };
              name?: string;
              version?: string;
            };
            const name =
              agentJson.identity?.name || agentJson.name || entry.name;
            const version =
              agentJson.identity?.version || agentJson.version || "unknown";
            agents.push({ name, version, path: path.join(dir, entry.name) });
          } catch {
            // 忽略解析失败的 agent.json
          }
        }
      } catch {
        // 忽略目录读取失败
      }
    }

    return agents;
  }

  private compareVersions(current: string, latest: string): number {
    const cur = semver.clean(current) || current;
    const lat = semver.clean(latest) || latest;
    return semver.compare(cur, lat);
  }

  private getUpdateLevel(
    current: string,
    latest: string
  ): "major" | "minor" | "patch" {
    const cur = semver.clean(current) || current;
    const lat = semver.clean(latest) || latest;

    if (semver.major(lat) > semver.major(cur)) return "major";
    if (semver.minor(lat) > semver.minor(cur)) return "minor";
    return "patch";
  }

  private summarizeUpdates(updates: UpdateInfo[]): UpdateSummary {
    const summary: UpdateSummary = {
      total: updates.length,
      upToDate: 0,
      hasUpdates: 0,
      checkFailed: 0,
      updatesByLevel: {
        major: 0,
        minor: 0,
        patch: 0,
      },
    };

    for (const update of updates) {
      if (update.error) {
        summary.checkFailed++;
      } else if (update.isUpdateAvailable) {
        summary.hasUpdates++;
        if (update.updateLevel) {
          summary.updatesByLevel[update.updateLevel]++;
        }
      } else {
        summary.upToDate++;
      }
    }

    return summary;
  }
}

// ============================================================
// 便捷函数（向后兼容）
// ============================================================

/**
 * 检查所有已部署 agent 的更新（旧版 API，兼容现有代码）
 */
export async function checkUpdates(marketUrl?: string): Promise<UpdateInfo[]> {
  const checker = new UpdateChecker({ marketUrl });
  return checker.checkAll();
}

/**
 * 获取更新摘要（旧版 API，兼容现有代码）
 */
export function getUpdateSummary(
  updates: UpdateInfo[]
): {
  total: number;
  up_to_date: number;
  has_updates: number;
  check_failed: number;
} {
  const summary: UpdateSummary = {
    total: updates.length,
    upToDate: 0,
    hasUpdates: 0,
    checkFailed: 0,
    updatesByLevel: { major: 0, minor: 0, patch: 0 },
  };

  for (const update of updates) {
    if (update.error) {
      summary.checkFailed++;
    } else if (update.isUpdateAvailable) {
      summary.hasUpdates++;
    } else {
      summary.upToDate++;
    }
  }

  return {
    total: summary.total,
    up_to_date: summary.upToDate,
    has_updates: summary.hasUpdates,
    check_failed: summary.checkFailed,
  };
}
