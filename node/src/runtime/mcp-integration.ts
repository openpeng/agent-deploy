/**
 * MCP (Model Context Protocol) Tool Integration
 *
 * Loads MCP tool definitions from the agent's mcp/ directory and registers
 * them in the ToolRegistry so pipelines can call them by name.
 *
 * Supported server types:
 *   http  — Streamable HTTP MCP server (no subprocess needed)
 *   stdio — Child-process MCP server (future; interface reserved)
 */

import * as fs from "fs";
import * as path from "path";
import { spawn, ChildProcess } from "child_process";
import { ExecutionContext } from "./types.js";
import {
  MarketRegistryClient,
  McpServerInfo,
  ServerFilters,
  createRegistryClient,
} from "../market-registry.js";

// ---------------------------------------------------------------------------
// Stdio MCP Transport
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

interface JSONRPCResponse {
  id?: number;
  error?: { message?: string };
  result?: { tools?: MCPRawToolDefinition[] };
}

class StdioTransport {
  private process: ChildProcess | null = null;
  private requestId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";

  constructor(private command: string, private args: string[] = [], private env?: Record<string, string>) {}

  async start(): Promise<void> {
    this.process = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.process.stderr!.on("data", (chunk: Buffer) => {
      console.warn(`[MCP STDIO stderr] ${chunk.toString().trim()}`);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JSONRPCResponse;
        if (msg.id && this.pending.has(msg.id)) {
          const handler = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) {
            handler.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            handler.resolve(msg.result);
          }
        }
      } catch {
        // Ignore non-JSON lines
      }
    }
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.process) throw new Error("Stdio transport not started");

    const id = this.requestId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process!.stdin!.write(body + "\n");
    });
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface MCPHttpServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export interface MCPStdioServerConfig {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type MCPServerEntry = MCPHttpServerConfig | MCPStdioServerConfig;

export interface MCPConfig {
  mcpServers: Record<string, MCPServerEntry>;
}

interface MCPRawToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// HTTP MCP client (Streamable HTTP transport)
// ---------------------------------------------------------------------------

interface HTTPMCPResponse {
  error?: { message?: string };
  result?: { tools?: MCPRawToolDefinition[] };
}

async function httpMCPRequest(
  baseUrl: string,
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<unknown> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  if (!res.ok) {
    throw new Error(`MCP HTTP error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as HTTPMCPResponse;
  if (json.error) {
    throw new Error(`MCP error: ${json.error.message || JSON.stringify(json.error)}`);
  }
  return json.result;
}

// ---------------------------------------------------------------------------
// MCPToolWrapper — adapts one MCP tool into a ToolRegistry-compatible object
// ---------------------------------------------------------------------------

export class MCPToolWrapper {
  readonly name: string;
  private transport: StdioTransport | null = null;

  constructor(
    private toolDef: MCPToolDefinition,
    private serverName: string,
    private serverEntry: MCPServerEntry
  ) {
    // Prefix with server name to avoid collisions: bark__send_notification
    this.name = `${serverName}__${toolDef.name}`;
  }

  async execute(args: Record<string, unknown>, _context: ExecutionContext): Promise<unknown> {
    if (this.serverEntry.type === "http") {
      return await httpMCPRequest(
        this.serverEntry.url,
        "tools/call",
        { name: this.toolDef.name, arguments: args },
        this.serverEntry.headers || {}
      );
    }

    if (this.serverEntry.type === "stdio") {
      if (!this.transport) {
        this.transport = new StdioTransport(
          this.serverEntry.command,
          this.serverEntry.args || [],
          this.serverEntry.env
        );
        await this.transport.start();
      }
      return await this.transport.request("tools/call", {
        name: this.toolDef.name,
        arguments: args,
      });
    }

    throw new Error(
      `MCP server type '${(this.serverEntry as { type?: string }).type}' not yet supported for tool execution`
    );
  }

  async dispose(): Promise<void> {
    if (this.transport) {
      await this.transport.stop();
      this.transport = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Service Discovery from Market Registry
// ---------------------------------------------------------------------------

export interface DiscoveredServer {
  serverInfo: McpServerInfo;
  tools: MCPToolDefinition[];
}

export class MCPServiceDiscovery {
  private registryClient: MarketRegistryClient;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private discoveredServers = new Map<string, DiscoveredServer>();
  private connectedWrappers = new Map<string, MCPToolWrapper[]>();

  constructor(registryClient?: MarketRegistryClient) {
    this.registryClient = registryClient || createRegistryClient();
  }

  /**
   * 从 Market 注册中心发现 MCP Server 并自动连接注册为工具
   */
  async discoverAndConnect(
    filters?: ServerFilters,
    registry?: { register(tool: { name: string; execute(args: Record<string, unknown>, ctx: ExecutionContext): Promise<unknown> }): void }
  ): Promise<number> {
    const servers = await this.registryClient.discoverMcpServers(filters);
    let totalRegistered = 0;

    for (const serverInfo of servers) {
      // Skip if already connected and server info hasn't changed
      const existing = this.discoveredServers.get(serverInfo.id);
      if (existing && existing.serverInfo.last_heartbeat === serverInfo.last_heartbeat) {
        continue;
      }

      try {
        const entry: MCPHttpServerConfig = {
          type: "http",
          url: serverInfo.endpoint,
        };

        const toolDefs = await this.listToolsFromHTTP(serverInfo.name, entry);
        const wrappers: MCPToolWrapper[] = [];

        for (const def of toolDefs) {
          const wrapper = new MCPToolWrapper(def, serverInfo.name, entry);
          wrappers.push(wrapper);
          registry?.register(wrapper);
        }

        // Store discovery result
        this.discoveredServers.set(serverInfo.id, {
          serverInfo,
          tools: toolDefs,
        });

        // Track connected wrappers for cleanup
        if (wrappers.length > 0) {
          this.connectedWrappers.set(serverInfo.id, wrappers);
          totalRegistered += wrappers.length;
          console.log(
            `[MCP Discovery] Connected to '${serverInfo.name}' at ${serverInfo.endpoint} — ${wrappers.length} tool(s) registered`
          );
        }
      } catch (err) {
        console.warn(
          `[MCP Discovery] Failed to connect to '${serverInfo.name}' (${serverInfo.endpoint}): ${(err as Error).message}`
        );
      }
    }

    return totalRegistered;
  }

  /**
   * 启动动态刷新，定时从注册中心拉取并更新连接
   */
  startDynamicRefresh(
    filters: ServerFilters | undefined,
    registry: { register(tool: { name: string; execute(args: Record<string, unknown>, ctx: ExecutionContext): Promise<unknown> }): void },
    intervalMs: number = 60000
  ): void {
    this.stopDynamicRefresh();
    console.log(`[MCP Discovery] Started dynamic refresh (interval=${intervalMs}ms)`);

    // Initial discovery
    this.discoverAndConnect(filters, registry).catch((err) => {
      console.warn(`[MCP Discovery] Initial discovery failed: ${(err as Error).message}`);
    });

    this.refreshTimer = setInterval(() => {
      this.discoverAndConnect(filters, registry).catch((err) => {
        console.warn(`[MCP Discovery] Refresh failed: ${(err as Error).message}`);
      });
    }, intervalMs);
  }

  /**
   * 停止动态刷新
   */
  stopDynamicRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
      console.log("[MCP Discovery] Stopped dynamic refresh");
    }
  }

  /**
   * 断开所有已发现的服务器连接
   */
  async disconnectAll(): Promise<void> {
    for (const [serverId, wrappers] of this.connectedWrappers) {
      for (const wrapper of wrappers) {
        await wrapper.dispose();
      }
      console.log(`[MCP Discovery] Disconnected from server ${serverId}`);
    }
    this.connectedWrappers.clear();
    this.discoveredServers.clear();
  }

  /**
   * 获取已发现的服务器列表
   */
  getDiscoveredServers(): DiscoveredServer[] {
    return Array.from(this.discoveredServers.values());
  }

  /**
   * 获取已注册的工具总数
   */
  getRegisteredToolCount(): number {
    let count = 0;
    for (const wrappers of this.connectedWrappers.values()) {
      count += wrappers.length;
    }
    return count;
  }

  private async listToolsFromHTTP(
    serverName: string,
    entry: MCPHttpServerConfig
  ): Promise<MCPToolDefinition[]> {
    try {
      const result = await httpMCPRequest(
        entry.url,
        "tools/list",
        {},
        entry.headers || {}
      );
      return ((result as { tools?: MCPRawToolDefinition[] })?.tools || []) as MCPToolDefinition[];
    } catch (e) {
      console.warn(
        `[WARN] Could not list tools from MCP server '${serverName}' (${entry.url}): ${(e as Error).message}`
      );
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// MCPToolLoader
// ---------------------------------------------------------------------------

export class MCPToolLoader {
  /**
   * Discover tools from a stdio MCP server by spawning a short-lived process.
   */
  async listToolsFromStdio(
    serverName: string,
    entry: MCPStdioServerConfig
  ): Promise<MCPToolDefinition[]> {
    const transport = new StdioTransport(entry.command, entry.args || [], entry.env);
    try {
      await transport.start();
      const result = await transport.request("tools/list", {});
      await transport.stop();
      return ((result as { tools?: MCPRawToolDefinition[] })?.tools || []) as MCPToolDefinition[];
    } catch (e) {
      console.warn(
        `[WARN] Could not list tools from MCP server '${serverName}' (${entry.command}): ${(e as Error).message}`
      );
      try { await transport.stop(); } catch { /* ignore */ }
      return [];
    }
  }

  /**
   * Auto-install MCP server package via npx if package is specified.
   */
  async autoInstall(serverName: string, _entry: MCPStdioServerConfig, packageName: string): Promise<void> {
    console.log(`[MCP] Installing ${packageName} for server '${serverName}'...`);
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("npx", ["-y", packageName], {
          stdio: "inherit",
        });
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`npx install exited with code ${code}`));
        });
        proc.on("error", reject);
      });
      console.log(`[MCP] Successfully installed ${packageName}`);
    } catch (e) {
      console.warn(`[WARN] Failed to install ${packageName}: ${(e as Error).message}`);
    }
  }
  /**
   * Load MCP config from agent's mcp/ directory.
   * Looks for mcp/config.json (Claude Desktop format: { mcpServers: {...} })
   * or mcp/servers.json as alias.
   */
  loadConfig(agentDir: string): MCPConfig | null {
    for (const name of ["config.json", "servers.json"]) {
      const p = path.join(agentDir, "mcp", name);
      if (fs.existsSync(p)) {
        try {
          const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
          // Normalise: both top-level formats accepted
          if (raw.mcpServers) return raw as MCPConfig;
          // Legacy: treat root keys as server entries
          return { mcpServers: raw as Record<string, MCPServerEntry> };
        } catch (e) {
          console.warn(`[WARN] Failed to parse MCP config ${p}: ${(e as Error).message}`);
        }
      }
    }
    return null;
  }

  /**
   * Discover available tools from a single HTTP MCP server.
   * Returns empty array if the server is unreachable (non-fatal).
   */
  async listToolsFromHTTP(
    serverName: string,
    entry: MCPHttpServerConfig
  ): Promise<MCPToolDefinition[]> {
    try {
      const result = await httpMCPRequest(
        entry.url,
        "tools/list",
        {},
        entry.headers || {}
      );
      return ((result as { tools?: MCPRawToolDefinition[] })?.tools || []) as MCPToolDefinition[];
    } catch (e) {
      console.warn(
        `[WARN] Could not list tools from MCP server '${serverName}' (${entry.url}): ${(e as Error).message}`
      );
      return [];
    }
  }

  /**
   * Load all MCP tools from the agent directory and return wrappers
   * ready to be registered in the ToolRegistry.
   */
  async loadTools(agentDir: string): Promise<MCPToolWrapper[]> {
    const config = this.loadConfig(agentDir);
    if (!config) return [];

    const wrappers: MCPToolWrapper[] = [];

    for (const [serverName, entry] of Object.entries(config.mcpServers)) {
      if (entry.type === "http") {
        const toolDefs = await this.listToolsFromHTTP(serverName, entry);
        for (const def of toolDefs) {
          wrappers.push(new MCPToolWrapper(def, serverName, entry));
        }
      } else if (entry.type === "stdio") {
        const toolDefs = await this.listToolsFromStdio(serverName, entry);
        for (const def of toolDefs) {
          wrappers.push(new MCPToolWrapper(def, serverName, entry));
        }
      } else {
        console.warn(
          `[WARN] MCP server '${serverName}' uses type '${(entry as { type?: string }).type}' which is not yet supported — skipping`
        );
      }
    }

    return wrappers;
  }

  /**
   * Register all discovered MCP tools into a ToolRegistry.
   * Returns the number of tools registered.
   */
  async registerMCPTools(agentDir: string, registry: { register(tool: { name: string; execute(args: Record<string, unknown>, ctx: ExecutionContext): Promise<unknown> }): void }): Promise<number> {
    const wrappers = await this.loadTools(agentDir);
    for (const w of wrappers) {
      registry.register(w);
    }
    if (wrappers.length > 0) {
      console.log(`[MCP] Registered ${wrappers.length} tool(s) from MCP servers`);
    }
    return wrappers.length;
  }

  /**
   * Register MCP tools from a runtime config object (not from agent directory).
   * Used by agent-executor to merge overrides.mcp_servers at execution time.
   */
  async registerFromConfig(
    mcpServers: Record<string, MCPServerEntry>,
    registry: { register(tool: { name: string; execute(args: Record<string, unknown>, ctx: ExecutionContext): Promise<unknown> }): void }
  ): Promise<number> {
    let total = 0;

    for (const [serverName, entry] of Object.entries(mcpServers)) {
      if (entry.type === "http") {
        const toolDefs = await this.listToolsFromHTTP(serverName, entry);
        for (const def of toolDefs) {
          registry.register(new MCPToolWrapper(def, serverName, entry));
          total++;
        }
      } else if (entry.type === "stdio") {
        const toolDefs = await this.listToolsFromStdio(serverName, entry);
        for (const def of toolDefs) {
          registry.register(new MCPToolWrapper(def, serverName, entry));
          total++;
        }
      }
    }

    if (total > 0) {
      console.log(`[MCP] Registered ${total} tool(s) from runtime MCP config`);
    }
    return total;
  }

}
