/**
 * Market Registry Client
 *
 * MCP Server 注册中心客户端，提供服务注册、发现、心跳和健康检查功能。
 */

// ============================================================
// 类型定义
// ============================================================

export type ServerStatus = "online" | "offline" | "degraded" | "maintenance";
export type TransportType = "http" | "stdio" | "sse" | "websocket";

export interface McpCapability {
  type: "tool" | "resource" | "prompt";
  name: string;
  description?: string;
}

export interface McpServerInfo {
  id: string;
  name: string;
  version: string;
  endpoint: string;
  transport: TransportType;
  capabilities: McpCapability[];
  status: ServerStatus;
  registered_at: string;
  last_heartbeat: string;
  metadata?: Record<string, unknown>;
}

export interface ServerFilters {
  capability?: string;
  name?: string;
  status?: ServerStatus;
  transport?: TransportType;
}

export interface HealthStatus {
  server_id: string;
  status: ServerStatus;
  last_heartbeat: string;
  uptime_seconds?: number;
  checks: {
    name: string;
    status: "pass" | "fail" | "warn";
    message?: string;
  }[];
}

export interface RegistryConfig {
  baseUrl: string;
  apiKey?: string;
  heartbeatIntervalMs?: number;
}

// ============================================================
// MarketRegistryClient
// ============================================================

export class MarketRegistryClient {
  private baseUrl: string;
  private apiKey?: string;
  private heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly defaultHeartbeatInterval = 30000; // 30 seconds

  constructor(config: RegistryConfig) {
    this.baseUrl = config.baseUrl || process.env.MARKET_REGISTRY_URL || "http://localhost:8321";
    this.apiKey = config.apiKey || process.env.MARKET_REGISTRY_API_KEY;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: this.getHeaders(),
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Registry request failed (${response.status}): ${errorText}`);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  // ----------------------------------------------------------
  // Server Registration
  // ----------------------------------------------------------

  /**
   * 向 Market 注册中心注册 MCP Server
   */
  async registerMcpServer(serverInfo: Omit<McpServerInfo, "id" | "registered_at" | "last_heartbeat">): Promise<McpServerInfo> {
    const result = await this.request<McpServerInfo>("POST", "/api/v1/registry/servers", serverInfo);
    console.log(`[Registry] Registered MCP server '${result.name}' (id=${result.id})`);
    return result;
  }

  /**
   * 从 Market 注册中心注销 MCP Server
   */
  async unregisterMcpServer(serverId: string): Promise<void> {
    // Stop heartbeat if running
    this.stopHeartbeat(serverId);

    await this.request<void>("DELETE", `/api/v1/registry/servers/${serverId}`);
    console.log(`[Registry] Unregistered MCP server (id=${serverId})`);
  }

  // ----------------------------------------------------------
  // Service Discovery
  // ----------------------------------------------------------

  /**
   * 发现可用的 MCP Server，支持按 capability、name、status 过滤
   */
  async discoverMcpServers(filters?: ServerFilters): Promise<McpServerInfo[]> {
    const params = new URLSearchParams();
    if (filters?.capability) params.append("capability", filters.capability);
    if (filters?.name) params.append("name", filters.name);
    if (filters?.status) params.append("status", filters.status);
    if (filters?.transport) params.append("transport", filters.transport);

    const query = params.toString() ? `?${params.toString()}` : "";
    const result = await this.request<{ servers: McpServerInfo[] }>(
      "GET",
      `/api/v1/registry/servers${query}`
    );
    return result.servers || [];
  }

  /**
   * 获取单个 MCP Server 的详细信息
   */
  async getServerInfo(serverId: string): Promise<McpServerInfo> {
    return await this.request<McpServerInfo>("GET", `/api/v1/registry/servers/${serverId}`);
  }

  // ----------------------------------------------------------
  // Heartbeat
  // ----------------------------------------------------------

  /**
   * 发送单次心跳
   */
  async heartbeat(serverId: string): Promise<void> {
    await this.request<void>("POST", `/api/v1/registry/servers/${serverId}/heartbeat`);
  }

  /**
   * 启动定时心跳，保持注册状态
   */
  startHeartbeat(serverId: string, intervalMs?: number): void {
    // Clear existing timer for this server
    this.stopHeartbeat(serverId);

    const interval = intervalMs ?? this.defaultHeartbeatInterval;
    const timer = setInterval(async () => {
      try {
        await this.heartbeat(serverId);
      } catch (err) {
        console.warn(`[Registry] Heartbeat failed for server ${serverId}:`, (err as Error).message);
      }
    }, interval);

    this.heartbeatTimers.set(serverId, timer);
    console.log(`[Registry] Started heartbeat for server ${serverId} (interval=${interval}ms)`);
  }

  /**
   * 停止定时心跳
   */
  stopHeartbeat(serverId: string): void {
    const timer = this.heartbeatTimers.get(serverId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(serverId);
      console.log(`[Registry] Stopped heartbeat for server ${serverId}`);
    }
  }

  /**
   * 停止所有定时心跳
   */
  stopAllHeartbeats(): void {
    for (const [serverId, timer] of this.heartbeatTimers) {
      clearInterval(timer);
      console.log(`[Registry] Stopped heartbeat for server ${serverId}`);
    }
    this.heartbeatTimers.clear();
  }

  // ----------------------------------------------------------
  // Health Check
  // ----------------------------------------------------------

  /**
   * 获取指定 MCP Server 的健康状态
   */
  async getServerHealth(serverId: string): Promise<HealthStatus> {
    return await this.request<HealthStatus>("GET", `/api/v1/registry/servers/${serverId}/health`);
  }

  /**
   * 检查注册中心自身的连通性
   */
  async checkConnectivity(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/registry/health`, {
        method: "GET",
        headers: this.getHeaders(),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// ============================================================
// 便捷函数
// ============================================================

export function createRegistryClient(config?: Partial<RegistryConfig>): MarketRegistryClient {
  return new MarketRegistryClient({
    baseUrl: config?.baseUrl || process.env.MARKET_REGISTRY_URL || "http://localhost:8321",
    apiKey: config?.apiKey || process.env.MARKET_REGISTRY_API_KEY,
    heartbeatIntervalMs: config?.heartbeatIntervalMs || 30000,
  });
}
