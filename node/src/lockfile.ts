/**
 * AgentLockFile — 管理 agent-lock.json 版本锁定文件
 *
 * 类似 package-lock.json，记录精确版本和哈希
 * 确保依赖安装的可复现性
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

/**
 * 锁定文件中的单个依赖条目
 */
export interface LockEntry {
  /** 依赖名称 */
  name: string;
  /** 精确解析的版本 */
  version: string;
  /** 来源: cache | market */
  source: "cache" | "market";
  /** 下载/缓存路径 */
  resolved: string;
  /** 包内容的 SHA256 哈希 */
  integrity: string;
  /** 此依赖的子依赖 */
  dependencies?: Record<string, string>;
  /** 安装时间 */
  installed_at?: string;
}

/**
 * agent-lock.json 根结构
 */
export interface AgentLock {
  /** 锁定文件版本 */
  lockfileVersion: number;
  /** 主 Agent 名称 */
  name: string;
  /** 主 Agent 版本 */
  version: string;
  /** 锁定时间 */
  locked_at: string;
  /** 所有解析后的依赖 */
  dependencies: Record<string, LockEntry>;
}

/**
 * 管理 agent-lock.json 的读写和更新
 */
export class AgentLockFile {
  private lockPath: string;
  private lock: AgentLock | null = null;

  /**
   * @param agentDir Agent 目录路径，锁文件将放在此目录下
   */
  constructor(agentDir: string) {
    this.lockPath = path.join(agentDir, "agent-lock.json");
  }

  /**
   * 从磁盘加载锁文件（如果存在）
   */
  load(): AgentLock | null {
    if (!fs.existsSync(this.lockPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(this.lockPath, "utf-8");
      this.lock = JSON.parse(content) as AgentLock;
      return this.lock;
    } catch {
      return null;
    }
  }

  /**
   * 保存锁文件到磁盘
   */
  save(lock: AgentLock): void {
    this.lock = lock;
    fs.writeFileSync(this.lockPath, JSON.stringify(lock, null, 2), "utf-8");
  }

  /**
   * 创建或更新锁文件
   *
   * @param agentName 主 Agent 名称
   * @param agentVersion 主 Agent 版本
   * @param dependencies 解析后的依赖列表
   */
  update(
    agentName: string,
    agentVersion: string,
    dependencies: Array<{
      name: string;
      version: string;
      path: string;
      source: "cache" | "market";
    }>
  ): AgentLock {
    const deps: Record<string, LockEntry> = {};

    for (const dep of dependencies) {
      const integrity = this.computeIntegrity(dep.path);
      const subDeps = this.extractSubDependencies(dep.path);

      deps[dep.name] = {
        name: dep.name,
        version: dep.version,
        source: dep.source,
        resolved: dep.path,
        integrity,
        dependencies: subDeps,
        installed_at: new Date().toISOString(),
      };
    }

    const lock: AgentLock = {
      lockfileVersion: 1,
      name: agentName,
      version: agentVersion,
      locked_at: new Date().toISOString(),
      dependencies: deps,
    };

    this.save(lock);
    return lock;
  }

  /**
   * 验证当前依赖是否与锁文件一致
   *
   * @returns 不一致的依赖列表，空数组表示全部一致
   */
  verify(
    dependencies: Array<{
      name: string;
      version: string;
      path: string;
    }>
  ): Array<{ name: string; expected: string; actual: string; reason: string }> {
    const lock = this.load();
    if (!lock) {
      return dependencies.map((d) => ({
        name: d.name,
        expected: "not locked",
        actual: d.version,
        reason: "No lock file found",
      }));
    }

    const mismatches: Array<{ name: string; expected: string; actual: string; reason: string }> = [];

    for (const dep of dependencies) {
      const entry = lock.dependencies[dep.name];
      if (!entry) {
        mismatches.push({
          name: dep.name,
          expected: "not in lock",
          actual: dep.version,
          reason: "Dependency not in lock file",
        });
        continue;
      }

      if (entry.version !== dep.version) {
        mismatches.push({
          name: dep.name,
          expected: entry.version,
          actual: dep.version,
          reason: "Version mismatch",
        });
        continue;
      }

      // 验证哈希
      const currentIntegrity = this.computeIntegrity(dep.path);
      if (entry.integrity !== currentIntegrity) {
        mismatches.push({
          name: dep.name,
          expected: entry.integrity.substring(0, 16) + "...",
          actual: currentIntegrity.substring(0, 16) + "...",
          reason: "Integrity hash mismatch",
        });
      }
    }

    return mismatches;
  }

  /**
   * 获取锁文件中记录的依赖版本
   */
  getLockedVersion(depName: string): string | null {
    const lock = this.load();
    if (!lock) return null;
    return lock.dependencies[depName]?.version || null;
  }

  /**
   * 检查锁文件是否存在
   */
  exists(): boolean {
    return fs.existsSync(this.lockPath);
  }

  /**
   * 删除锁文件
   */
  remove(): void {
    if (fs.existsSync(this.lockPath)) {
      fs.unlinkSync(this.lockPath);
    }
    this.lock = null;
  }

  /**
   * 获取锁文件路径
   */
  getPath(): string {
    return this.lockPath;
  }

  /**
   * 计算目录的 SHA256 哈希（基于所有文件内容）
   */
  private computeIntegrity(dir: string): string {
    const hash = crypto.createHash("sha256");

    if (!fs.existsSync(dir)) {
      return hash.digest("hex");
    }

    const files = this.listFilesSorted(dir);
    for (const file of files) {
      const relativePath = path.relative(dir, file);
      hash.update(relativePath);
      try {
        const content = fs.readFileSync(file);
        hash.update(content);
      } catch {
        // Skip unreadable files
      }
    }

    return hash.digest("hex");
  }

  /**
   * 提取子依赖（从 agent.json 读取）
   */
  private extractSubDependencies(agentDir: string): Record<string, string> | undefined {
    const agentJsonPath = path.join(agentDir, "agent.json");
    if (!fs.existsSync(agentJsonPath)) return undefined;

    try {
      const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
      const deps = agentJson.dependencies?.agents;
      if (deps && Object.keys(deps).length > 0) {
        return deps as Record<string, string>;
      }
    } catch {
      // ignore
    }

    return undefined;
  }

  /**
   * 递归列出目录下所有文件（按路径排序）
   */
  private listFilesSorted(dir: string): string[] {
    const files: string[] = [];

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.listFilesSorted(fullPath));
      } else {
        files.push(fullPath);
      }
    }

    return files.sort();
  }
}
