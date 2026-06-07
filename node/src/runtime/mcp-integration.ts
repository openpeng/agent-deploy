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
import { ExecutionContext } from "./types.js";

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
    throw new Error(
      `MCP server type '${(this.serverEntry as any).type}' not yet supported for tool execution`
    );
  }
}

// ---------------------------------------------------------------------------
// MCPToolLoader
// ---------------------------------------------------------------------------

export class MCPToolLoader {
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
}
