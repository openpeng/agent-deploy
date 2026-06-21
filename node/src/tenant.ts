/**
 * Multi-Tenant Management for Agent Deploy
 *
 * Provides tenant isolation with independent:
 * - Deployment directories
 * - Caches
 * - Logs
 * - Policies
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { PolicyConfig, DEFAULT_RESTRICTED_POLICY } from "./runtime/policy.js";
import { QuotaOptions } from "./runtime/quota.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantQuota extends QuotaOptions {
  /** Maximum number of agents per tenant */
  maxAgents?: number;
  /** Maximum storage in MB */
  maxStorageMB?: number;
  /** Maximum concurrent executions */
  maxConcurrentExecutions?: number;
}

export interface TenantConfig {
  /** Unique tenant identifier */
  id: string;

  /** Human-readable tenant name */
  name: string;

  /** Creation timestamp (ISO 8601) */
  created_at: string;

  /** Resource quota for this tenant */
  quota: TenantQuota;

  /** List of allowed tool names (empty = all allowed) */
  allowedTools: string[];

  /** Default execution policy for this tenant */
  policy: PolicyConfig;

  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface TenantStorageInfo {
  tenantId: string;
  deployDir: string;
  cacheDir: string;
  logDir: string;
  policyDir: string;
  totalSizeMB: number;
}

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

const DEFAULT_TENANT_QUOTA: Required<TenantQuota> = {
  maxExecutionTimeMs: 30000,
  maxMemoryMB: 512,
  maxNetworkRequests: 100,
  maxFileOperations: 1000,
  maxTokenUsage: 100000,
  maxCpuTimeMs: 30000,
  maxAgents: 10,
  maxStorageMB: 1024,
  maxConcurrentExecutions: 5,
};

function getTenantBaseDir(): string {
  return path.join(os.homedir(), ".agent-deploy", "tenants");
}

function getTenantDir(tenantId: string): string {
  return path.join(getTenantBaseDir(), tenantId);
}

function getTenantConfigPath(tenantId: string): string {
  return path.join(getTenantDir(tenantId), "tenant.json");
}

// ---------------------------------------------------------------------------
// Tenant Manager
// ---------------------------------------------------------------------------

export class TenantManager {
  private tenants = new Map<string, TenantConfig>();
  private initialized = false;

  /**
   * Initialize the tenant manager and load existing tenants from disk.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    const baseDir = getTenantBaseDir();
    try {
      const entries = await fs.readdir(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const config = await this.loadTenantFromDisk(entry.name);
            if (config) {
              this.tenants.set(config.id, config);
            }
          } catch {
            // Skip invalid tenant directories
          }
        }
      }
    } catch {
      // Base directory doesn't exist yet — that's fine
    }

    this.initialized = true;
  }

  /**
   * Create a new tenant with the given configuration.
   */
  async createTenant(tenantId: string, config: Omit<TenantConfig, "id" | "created_at">): Promise<void> {
    await this.init();

    if (this.tenants.has(tenantId)) {
      throw new Error(`Tenant '${tenantId}' already exists`);
    }

    const tenantDir = getTenantDir(tenantId);
    await fs.mkdir(tenantDir, { recursive: true });

    // Create subdirectories for isolation
    await fs.mkdir(path.join(tenantDir, "deploy"), { recursive: true });
    await fs.mkdir(path.join(tenantDir, "cache"), { recursive: true });
    await fs.mkdir(path.join(tenantDir, "logs"), { recursive: true });
    await fs.mkdir(path.join(tenantDir, "policy"), { recursive: true });

    const fullConfig: TenantConfig = {
      id: tenantId,
      name: config.name || tenantId,
      created_at: new Date().toISOString(),
      quota: { ...DEFAULT_TENANT_QUOTA, ...config.quota },
      allowedTools: config.allowedTools ?? [],
      policy: config.policy ?? { ...DEFAULT_RESTRICTED_POLICY },
      metadata: config.metadata ?? {},
    };

    await fs.writeFile(
      getTenantConfigPath(tenantId),
      JSON.stringify(fullConfig, null, 2),
      "utf-8"
    );

    this.tenants.set(tenantId, fullConfig);
  }

  /**
   * Get a tenant's configuration by ID.
   */
  async getTenant(tenantId: string): Promise<TenantConfig | null> {
    await this.init();

    const cached = this.tenants.get(tenantId);
    if (cached) return cached;

    // Try loading from disk in case it was created externally
    const fromDisk = await this.loadTenantFromDisk(tenantId);
    if (fromDisk) {
      this.tenants.set(tenantId, fromDisk);
      return fromDisk;
    }

    return null;
  }

  /**
   * List all registered tenants.
   */
  async listTenants(): Promise<TenantConfig[]> {
    await this.init();
    return Array.from(this.tenants.values());
  }

  /**
   * Delete a tenant and all its associated data.
   */
  async deleteTenant(tenantId: string): Promise<void> {
    await this.init();

    if (!this.tenants.has(tenantId)) {
      const exists = await this.loadTenantFromDisk(tenantId);
      if (!exists) {
        throw new Error(`Tenant '${tenantId}' not found`);
      }
    }

    const tenantDir = getTenantDir(tenantId);
    await fs.rm(tenantDir, { recursive: true, force: true });
    this.tenants.delete(tenantId);
  }

  /**
   * Update an existing tenant's configuration.
   */
  async updateTenant(
    tenantId: string,
    updates: Partial<Omit<TenantConfig, "id" | "created_at">>
  ): Promise<TenantConfig> {
    await this.init();

    const existing = await this.getTenant(tenantId);
    if (!existing) {
      throw new Error(`Tenant '${tenantId}' not found`);
    }

    const updated: TenantConfig = {
      ...existing,
      name: updates.name ?? existing.name,
      quota: { ...existing.quota, ...updates.quota },
      allowedTools: updates.allowedTools ?? existing.allowedTools,
      policy: updates.policy ?? existing.policy,
      metadata: { ...existing.metadata, ...updates.metadata },
    };

    await fs.writeFile(
      getTenantConfigPath(tenantId),
      JSON.stringify(updated, null, 2),
      "utf-8"
    );

    this.tenants.set(tenantId, updated);
    return updated;
  }

  /**
   * Get the deployment directory for a tenant.
   */
  getDeployDir(tenantId: string): string {
    return path.join(getTenantDir(tenantId), "deploy");
  }

  /**
   * Get the cache directory for a tenant.
   */
  getCacheDir(tenantId: string): string {
    return path.join(getTenantDir(tenantId), "cache");
  }

  /**
   * Get the log directory for a tenant.
   */
  getLogDir(tenantId: string): string {
    return path.join(getTenantDir(tenantId), "logs");
  }

  /**
   * Get the policy directory for a tenant.
   */
  getPolicyDir(tenantId: string): string {
    return path.join(getTenantDir(tenantId), "policy");
  }

  /**
   * Check if a tool is allowed for a tenant.
   */
  async isToolAllowed(tenantId: string, toolName: string): Promise<boolean> {
    const tenant = await this.getTenant(tenantId);
    if (!tenant) return false;
    if (tenant.allowedTools.length === 0) return true;
    return tenant.allowedTools.includes(toolName);
  }

  /**
   * Get storage information for a tenant.
   */
  async getStorageInfo(tenantId: string): Promise<TenantStorageInfo | null> {
    const tenant = await this.getTenant(tenantId);
    if (!tenant) return null;

    const deployDir = this.getDeployDir(tenantId);
    const cacheDir = this.getCacheDir(tenantId);
    const logDir = this.getLogDir(tenantId);
    const policyDir = this.getPolicyDir(tenantId);

    let totalSize = 0;
    for (const dir of [deployDir, cacheDir, logDir, policyDir]) {
      try {
        totalSize += await calculateDirSize(dir);
      } catch {
        // Directory may not exist
      }
    }

    return {
      tenantId,
      deployDir,
      cacheDir,
      logDir,
      policyDir,
      totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async loadTenantFromDisk(tenantId: string): Promise<TenantConfig | null> {
    try {
      const configPath = getTenantConfigPath(tenantId);
      const raw = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(raw) as TenantConfig;
      // Validate required fields
      if (!config.id || !config.name || !config.created_at) {
        return null;
      }
      return config;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let globalTenantManager: TenantManager | undefined;

export function getTenantManager(): TenantManager {
  if (!globalTenantManager) {
    globalTenantManager = new TenantManager();
  }
  return globalTenantManager;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function calculateDirSize(dirPath: string): Promise<number> {
  let total = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        try {
          const stat = await fs.stat(path.join(entry.parentPath || dirPath, entry.name));
          total += stat.size;
        } catch {
          // Ignore files we can't stat
        }
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable
  }
  return total;
}
