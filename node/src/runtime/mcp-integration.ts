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

// ---------------------------------------------------------------------------
// Stdio MCP Transport
// ---------------------------------------------------------------------------

class StdioTransport {
  private process: ChildProcess | null = null;
  private requestId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
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
        const msg = JSON.parse(line);
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

  async request(method: string, params: any): Promise<any> {
    if (!this.process) throw new Error("Stdio transport not started");

    const id = this.requestId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    return new Promise<any>((resolve, reject) => {
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

export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// HTTP MCP client (Streamable HTTP transport)
// ---------------------------------------------------------------------------

async function httpMCPRequest(
  baseUrl: string,
  method: string,
  params: any,
  headers: Record<string, string> = {}
): Promise<any> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  if (!res.ok) {
    throw new Error(`MCP HTTP error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as any;
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

  async execute(args: Record<string, any>, _context: ExecutionContext): Promise<any> {
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
      `MCP server type '${(this.serverEntry as any).type}' not yet supported for tool execution`
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
      return (result?.tools || []) as MCPToolDefinition[];
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
          return { mcpServers: raw };
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
      return (result?.tools || []) as MCPToolDefinition[];
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
          `[WARN] MCP server '${serverName}' uses type '${(entry as any).type}' which is not yet supported — skipping`
        );
      }
    }

    return wrappers;
  }

  /**
   * Register all discovered MCP tools into a ToolRegistry.
   * Returns the number of tools registered.
   */
  async registerMCPTools(agentDir: string, registry: any): Promise<number> {
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
    registry: any
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
