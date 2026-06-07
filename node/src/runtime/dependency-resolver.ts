/**
 * DependencyResolver — 递归解析 agent.json 中声明的依赖
 *
 * 流程:
 *   1. 读取 agent.json → dependencies.agents
 *   2. 对每个依赖: 查缓存 → 缓存未命中则从 Market 下载
 *   3. 递归解析子依赖
 *   4. 构建依赖图 → 检测循环 → 拓扑排序
 */

import * as fs from "fs";
import * as path from "path";
import { AgentCache } from "./agent-cache.js";
import { MarketAgentLoader } from "./agent-loader.js";

export interface ResolvedDependency {
  name: string;
  version: string;
  path: string;
  source: "cache" | "market";
  children?: ResolvedDependency[];
}

export class DependencyResolver {
  private cache: AgentCache;
  private marketLoader: MarketAgentLoader;
  private visited = new Set<string>();
  private resolved = new Map<string, ResolvedDependency>();

  constructor(marketUrl?: string) {
    this.cache = new AgentCache();
    this.marketLoader = new MarketAgentLoader(this.cache, marketUrl);
  }

  /**
   * 解析单个 agent 目录的所有依赖（递归）
   *
   * @param agentDir Agent 目录路径
   * @returns Map<agentName, ResolvedDependency>
   */
  async resolve(agentDir: string): Promise<Map<string, ResolvedDependency>> {
    this.visited.clear();
    this.resolved.clear();

    await this.resolveRecursive(agentDir);

    // 循环依赖检测
    this.detectCycles();

    return this.resolved;
  }

  /** 递归解析依赖 */
  private async resolveRecursive(agentDir: string): Promise<void> {
    const agentJsonPath = path.join(agentDir, "agent.json");
    if (!fs.existsSync(agentJsonPath)) return;

    const name = this.getAgentName(agentDir);

    // 防止重复解析
    if (this.visited.has(name)) return;
    this.visited.add(name);

    // 读取依赖声明
    const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
    const deps = agentJson.dependencies?.agents || {};
    const agentVersion = agentJson.identity?.version || agentJson.version || "0.0.0";

    for (const [depName, versionSpec] of Object.entries(deps)) {
      const spec = versionSpec as string;

      // 跳过自身引用
      if (depName === name) continue;

      // 已解析过的跳过
      if (this.resolved.has(depName)) continue;

      // 1. 查缓存
      let depPath = this.cache.get(depName, spec);
      let source: "cache" | "market" = "cache";

      // 2. 缓存未命中 → 从市场下载
      if (!depPath) {
        const uri = `market://${depName}@${spec}`;
        depPath = await this.marketLoader.load(uri);
        source = "market";
      }

      // 读取实际版本号
      const depJsonPath = path.join(depPath, "agent.json");
      let resolvedVersion = spec;
      if (fs.existsSync(depJsonPath)) {
        try {
          const depJson = JSON.parse(fs.readFileSync(depJsonPath, "utf-8"));
          resolvedVersion = depJson.identity?.version || depJson.version || spec;
        } catch { /* use spec */ }
      }

      // 记录解析结果
      this.resolved.set(depName, {
        name: depName,
        version: resolvedVersion,
        path: depPath,
        source,
      });

      // 3. 递归解析子依赖
      await this.resolveRecursive(depPath);
    }
  }

  /** 检测循环依赖（DFS） */
  private detectCycles(): void {
    const WHITE = 0; // 未访问
    const GRAY = 1;  // 访问中（在递归栈中）
    const BLACK = 2; // 已完成

    const state = new Map<string, number>();
    const graph = new Map<string, string[]>();

    // 构建依赖图
    for (const [name, dep] of this.resolved) {
      const children = this.getDependencies(dep.path);
      graph.set(name, children);
    }

    // DFS 检测环
    const dfs = (node: string): boolean => {
      state.set(node, GRAY);

      const children = graph.get(node) || [];
      for (const child of children) {
        const childState = state.get(child) || WHITE;
        if (childState === GRAY) {
          // 找到环
          throw new Error(
            `Circular dependency detected: ${node} → ... → ${child} → ${node}`
          );
        }
        if (childState === WHITE) {
          if (dfs(child)) return true;
        }
      }

      state.set(node, BLACK);
      return false;
    };

    for (const name of graph.keys()) {
      if ((state.get(name) || WHITE) === WHITE) {
        dfs(name);
      }
    }
  }

  /** 读取 agent.json 的依赖列表 */
  private getDependencies(agentDir: string): string[] {
    const agentJsonPath = path.join(agentDir, "agent.json");
    if (!fs.existsSync(agentJsonPath)) return [];

    try {
      const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
      const deps = agentJson.dependencies?.agents || {};
      return Object.keys(deps);
    } catch {
      return [];
    }
  }

  /** 从 agent.json 读取 agent name */
  private getAgentName(agentDir: string): string {
    const agentJsonPath = path.join(agentDir, "agent.json");
    if (!fs.existsSync(agentJsonPath)) return path.basename(agentDir);

    try {
      const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
      return agentJson.identity?.name || agentJson.name || path.basename(agentDir);
    } catch {
      return path.basename(agentDir);
    }
  }
}
