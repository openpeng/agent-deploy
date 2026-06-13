/**
 * AgentCache — 本地 Agent 缓存管理
 *
 * 缓存结构:
 *   ~/.agent-deploy/cache/
 *   ├── notification-agent@1.0.0/
 *   ├── logger-agent@0.5.2/
 *   └── manifest.json
 */

import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import * as semver from "semver";

interface ManifestEntry {
  installed: string[];
  resolved: string;
  downloaded_at: string;
  last_used: string;
}

interface Manifest {
  agents: Record<string, ManifestEntry>;
}

export class AgentCache {
  private cacheDir: string;
  private manifestPath: string;
  private manifest: Manifest;

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir || path.join(homedir(), ".agent-deploy", "cache");
    this.manifestPath = path.join(this.cacheDir, "manifest.json");
    this.manifest = this.loadManifest();
  }

  /** Load or initialize manifest.json */
  private loadManifest(): Manifest {
    try {
      if (fs.existsSync(this.manifestPath)) {
        const raw = fs.readFileSync(this.manifestPath, "utf-8");
        return JSON.parse(raw);
      }
    } catch {
      // ignore parse errors, start fresh
    }
    return { agents: {} };
  }

  /** Save manifest to disk */
  private saveManifest(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2));
  }

  /**
   * Look up a cached agent by name and version spec
   * Returns the local path if found, null otherwise
   */
  get(name: string, versionSpec: string): string | null {
    const entry = this.manifest.agents[name];
    if (!entry || entry.installed.length === 0) return null;

    // Find max satisfying version
    const matched = semver.maxSatisfying(entry.installed, versionSpec);
    if (!matched) return null;

    const agentDir = path.join(this.cacheDir, `${name}@${matched}`);

    // Verify directory still exists
    if (!fs.existsSync(agentDir)) {
      // Clean up stale entry
      this.removeEntry(name);
      return null;
    }

    // Update last_used
    entry.last_used = new Date().toISOString();
    this.saveManifest();

    return agentDir;
  }

  /**
   * Install an agent from a downloaded package path
   * Extracts and records in manifest
   */
  install(agentName: string, version: string, agentDir: string): string {
    const targetDir = path.join(this.cacheDir, `${agentName}@${version}`);

    // Copy agent directory to cache
    this.copyDir(agentDir, targetDir);

    // Update manifest
    if (!this.manifest.agents[agentName]) {
      this.manifest.agents[agentName] = {
        installed: [],
        resolved: version,
        downloaded_at: new Date().toISOString(),
        last_used: new Date().toISOString(),
      };
    }

    const entry = this.manifest.agents[agentName];
    if (!entry.installed.includes(version)) {
      entry.installed.push(version);
    }
    entry.resolved = version;
    entry.last_used = new Date().toISOString();

    this.saveManifest();
    return targetDir;
  }

  /** Check if an agent exists in cache (any version) */
  has(name: string): boolean {
    return !!this.manifest.agents[name]?.installed.length;
  }

  /** Get all installed versions of an agent */
  getVersions(name: string): string[] {
    return this.manifest.agents[name]?.installed || [];
  }

  /** List all cached agent names */
  list(): string[] {
    return Object.keys(this.manifest.agents);
  }

  /** Remove an agent from cache and manifest */
  remove(name: string, version?: string): void {
    const entry = this.manifest.agents[name];
    if (!entry) return;

    if (version) {
      // Remove specific version
      const targetDir = path.join(this.cacheDir, `${name}@${version}`);
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      entry.installed = entry.installed.filter((v) => v !== version);
    } else {
      // Remove all versions
      for (const v of entry.installed) {
        const targetDir = path.join(this.cacheDir, `${name}@${v}`);
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
      }
      delete this.manifest.agents[name];
    }

    this.saveManifest();
  }

  /** Remove stale manifest entry (directory missing) */
  private removeEntry(name: string): void {
    delete this.manifest.agents[name];
    this.saveManifest();
  }

  /** Copy a directory recursively */
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

  /** Get cache directory path */
  getCacheDir(): string {
    return this.cacheDir;
  }
}
