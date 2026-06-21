/**
 * HTTP Server for MCP Agent Deploy
 *
 * Uses Node.js built-in http module to serve:
 * - POST /message   (Streamable HTTP + backward-compatible SSE POST)
 * - GET  /sse       (backward-compatible SSE stream)
 * - GET  /health    (health check)
 * - GET  /metrics   (Prometheus metrics)
 */

import * as http from "node:http";
import * as url from "node:url";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  SessionManager,
  handlePostMessage,
  handleGetSse,
  handleSsePostMessage,
  getTransportMetrics,
  recordToolCall,
  type RouteContext,
} from "./http-transport.js";
import { getRegister, setActiveConnections } from "./metrics.js";
import {
  MarketRegistryClient,
  McpCapability,
  createRegistryClient,
} from "./market-registry.js";
import { AuthMiddleware, type UserInfo } from "./auth.js";
import { getOIDCProvider } from "./auth-oidc.js";
import { getTenantManager } from "./tenant.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface HttpServerOptions {
  port?: number;
  serverFactory: () => { connect: (t: Transport) => Promise<void> };
  version?: string;
  serverName?: string;
  tools?: Array<{ name: string; description?: string }>;
  registryClient?: MarketRegistryClient;
  /** Authentication middleware instance */
  authMiddleware?: AuthMiddleware;
  /** Require authentication on protected routes (default: true) */
  authRequired?: boolean;
}

const DEFAULT_PORT = 3000;

// ---------------------------------------------------------------------------
// Server State
// ---------------------------------------------------------------------------

const startTime = Date.now();
let requestCount = 0;

// Registry state (module-level to share across health checks)
let registryState: {
  registered: boolean;
  serverId: string | null;
  marketConnected: boolean;
  registryClient: MarketRegistryClient | null;
} = {
  registered: false,
  serverId: null,
  marketConnected: false,
  registryClient: null,
};

// ---------------------------------------------------------------------------
// Body Parser Helper
// ---------------------------------------------------------------------------

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (!raw) {
          resolve(undefined);
          return;
        }
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", (err) => reject(err));
  });
}

// ---------------------------------------------------------------------------
// CORS Headers
// ---------------------------------------------------------------------------

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, Last-Event-ID, Authorization");
}

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

function handleHealth(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  version: string
): void {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const m = getTransportMetrics();
  const body = JSON.stringify({
    status: "ok",
    version,
    uptime,
    registered: registryState.registered,
    market_connected: registryState.marketConnected,
    active_sessions: m.activeConnections,
    tools_available: m.toolCallsTotal,
    timestamp: new Date().toISOString(),
  });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(body);
}

async function handleMetrics(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const m = getTransportMetrics();
  // Sync prom-client gauge with transport-level active connections
  setActiveConnections(m.activeConnections);

  const metricsText = await getRegister().metrics();
  res.writeHead(200, { "Content-Type": getRegister().contentType });
  res.end(metricsText);
}

// ---------------------------------------------------------------------------
// Auth Helpers
// ---------------------------------------------------------------------------

async function authenticateRequest(
  req: http.IncomingMessage,
  auth: AuthMiddleware,
  authRequired: boolean
): Promise<{ user?: UserInfo; tenantId?: string; error?: string; status?: number }> {
  // Try API Key / JWT first
  let result = await auth.handle(req);

  // Fall back to OIDC if configured and previous auth failed
  if (!result.success) {
    const oidc = getOIDCProvider();
    if (oidc) {
      const token = auth.extractToken(req);
      if (token) {
        try {
          const user = await oidc.validateToken(token);
          req.user = user;
          req.tenantId = user.tenantId;
          return { user, tenantId: user.tenantId };
        } catch {
          // OIDC validation failed — keep original error
        }
      }
    }
  }

  if (!result.success && authRequired) {
    return { error: result.error || "Unauthorized", status: 401 };
  }

  if (result.success && result.user) {
    return { user: result.user, tenantId: result.user.tenantId || req.tenantId };
  }

  return {};
}

function sendJsonError(res: http.ServerResponse, status: number, message: string): void {
  const body = JSON.stringify({ error: message });
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

// ---------------------------------------------------------------------------
// Main Server Factory
// ---------------------------------------------------------------------------

export function createHttpServer(options: HttpServerOptions): http.Server {
  const port = options.port ?? DEFAULT_PORT;
  const version = options.version ?? "1.0.0";
  const serverName = options.serverName ?? "agent-deploy";
  const authRequired = options.authRequired ?? true;
  const sessionManager = new SessionManager();

  const routeContext: RouteContext = {
    sessionManager,
    serverFactory: options.serverFactory,
  };

  // Auth middleware
  const auth = options.authMiddleware || new AuthMiddleware();

  // ---------------------------------------------------------------------------
  // Market Registry Self-Registration
  // ---------------------------------------------------------------------------

  const registryClient = options.registryClient || createRegistryClient();
  registryState.registryClient = registryClient;

  async function registerSelf(): Promise<void> {
    try {
      // Check connectivity first
      registryState.marketConnected = await registryClient.checkConnectivity();
      if (!registryState.marketConnected) {
        console.warn("[HTTP Server] Market registry not reachable, skipping self-registration");
        return;
      }

      // Build capabilities from tools
      const capabilities: McpCapability[] = (options.tools || []).map((t) => ({
        type: "tool" as const,
        name: t.name,
        description: t.description,
      }));

      const endpoint = `http://localhost:${port}`;

      const serverInfo = await registryClient.registerMcpServer({
        name: serverName,
        version,
        endpoint,
        transport: "http",
        capabilities,
        status: "online",
        metadata: {
          source: "agent-deploy",
          auto_registered: true,
        },
      });

      registryState.registered = true;
      registryState.serverId = serverInfo.id;

      // Start heartbeat (every 30 seconds)
      registryClient.startHeartbeat(serverInfo.id, 30000);

      console.error(`[HTTP Server] Self-registered with Market Registry (id=${serverInfo.id})`);
    } catch (err) {
      registryState.registered = false;
      registryState.marketConnected = false;
      console.warn("[HTTP Server] Self-registration failed:", (err as Error).message);
    }
  }

  async function unregisterSelf(): Promise<void> {
    if (registryState.serverId && registryState.registryClient) {
      try {
        registryState.registryClient.stopHeartbeat(registryState.serverId);
        await registryState.registryClient.unregisterMcpServer(registryState.serverId);
        registryState.registered = false;
        registryState.serverId = null;
        console.error("[HTTP Server] Self-unregistered from Market Registry");
      } catch (err) {
        console.warn("[HTTP Server] Self-unregistration failed:", (err as Error).message);
      }
    }
  }

  const server = http.createServer(async (req, res) => {
    requestCount++;
    setCorsHeaders(res);

    // Handle preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = url.parse(req.url || "/", true);
    const pathname = parsedUrl.pathname || "/";

    try {
      // Public health check (no auth required)
      if (pathname === "/health" && req.method === "GET") {
        handleHealth(req, res, version);
        return;
      }

      // OIDC callback endpoint (public, part of SSO flow)
      if (pathname === "/auth/callback" && req.method === "GET") {
        const code = parsedUrl.query.code as string | undefined;
        const state = parsedUrl.query.state as string | undefined;
        const oidc = getOIDCProvider();
        if (!oidc || !code || !state) {
          sendJsonError(res, 400, "Missing OIDC parameters or OIDC not configured");
          return;
        }
        try {
          const tokens = await oidc.handleCallback(code, state);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, token_type: tokens.token_type }));
        } catch (err) {
          sendJsonError(res, 400, `OIDC callback failed: ${(err as Error).message}`);
        }
        return;
      }

      // OIDC authorization initiation (redirect to IdP)
      if (pathname === "/auth/login" && req.method === "GET") {
        const oidc = getOIDCProvider();
        if (!oidc) {
          sendJsonError(res, 501, "OIDC not configured");
          return;
        }
        const { url: authUrl } = await oidc.authorizeUrl();
        res.writeHead(302, { Location: authUrl });
        res.end();
        return;
      }

      // Admin routes: require authentication + admin role
      if (pathname.startsWith("/admin/")) {
        const authResult = await authenticateRequest(req, auth, authRequired);
        if (authResult.error) {
          sendJsonError(res, authResult.status || 401, authResult.error);
          return;
        }
        const user = authResult.user!;
        if (!auth.authorize(user, pathname, req.method || "GET")) {
          sendJsonError(res, 403, "Forbidden: admin role required");
          return;
        }
        // Admin endpoints placeholder — can be extended
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", user: user.userId, route: pathname }));
        return;
      }

      // Metrics: require auth + reader/admin role
      if (pathname === "/metrics" && req.method === "GET") {
        const authResult = await authenticateRequest(req, auth, authRequired);
        if (authResult.error) {
          sendJsonError(res, authResult.status || 401, authResult.error);
          return;
        }
        const user = authResult.user!;
        if (!auth.authorize(user, pathname, req.method || "GET")) {
          sendJsonError(res, 403, "Forbidden");
          return;
        }
        await handleMetrics(req, res);
        return;
      }

      // Streamable HTTP POST /message (new standard) — protected
      if (pathname === "/message" && req.method === "POST") {
        const authResult = await authenticateRequest(req, auth, authRequired);
        if (authResult.error) {
          sendJsonError(res, authResult.status || 401, authResult.error);
          return;
        }
        const user = authResult.user!;
        if (!auth.authorize(user, pathname, req.method || "POST")) {
          sendJsonError(res, 403, "Forbidden");
          return;
        }
        const body = await parseBody(req);
        await handlePostMessage(req, res, body, routeContext);
        return;
      }

      // Backward-compatible SSE GET /sse — protected
      if (pathname === "/sse" && req.method === "GET") {
        const authResult = await authenticateRequest(req, auth, authRequired);
        if (authResult.error) {
          sendJsonError(res, authResult.status || 401, authResult.error);
          return;
        }
        const user = authResult.user!;
        if (!auth.authorize(user, pathname, req.method || "GET")) {
          sendJsonError(res, 403, "Forbidden");
          return;
        }
        await handleGetSse(req, res, routeContext);
        return;
      }

      // Backward-compatible SSE POST /message?sessionId=xxx — protected
      if (pathname === "/message" && req.method === "POST" && parsedUrl.query.sessionId) {
        const authResult = await authenticateRequest(req, auth, authRequired);
        if (authResult.error) {
          sendJsonError(res, authResult.status || 401, authResult.error);
          return;
        }
        const user = authResult.user!;
        if (!auth.authorize(user, pathname, req.method || "POST")) {
          sendJsonError(res, 403, "Forbidden");
          return;
        }
        const body = await parseBody(req);
        const sessionId = Array.isArray(parsedUrl.query.sessionId)
          ? parsedUrl.query.sessionId[0]
          : parsedUrl.query.sessionId;
        await handleSsePostMessage(req, res, body, sessionId, routeContext);
        return;
      }

      // 404
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    } catch (err) {
      console.error("[HTTP Server] Unhandled error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Server Error" }));
      }
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.error("[HTTP Server] Shutting down...");
    await unregisterSelf();
    await sessionManager.closeAll();
    server.close(() => {
      console.error("[HTTP Server] Closed");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(port, () => {
    console.error(`[HTTP Server] Listening on port ${port}`);
    console.error(`[HTTP Server] Endpoints:`);
    console.error(`  POST /message  - Streamable HTTP (MCP 2025-11-25)  [auth]`);
    console.error(`  GET  /sse      - SSE backward compatible (MCP 2024-11-05)  [auth]`);
    console.error(`  GET  /health   - Health check`);
    console.error(`  GET  /metrics  - Prometheus metrics  [auth]`);
    console.error(`  GET  /auth/login   - OIDC login redirect`);
    console.error(`  GET  /auth/callback- OIDC callback handler`);
    console.error(`  /admin/*       - Admin routes  [auth + admin role]`);

    // Auto-register with Market Registry after server starts
    registerSelf().catch((err) => {
      console.warn("[HTTP Server] Auto-registration error:", (err as Error).message);
    });
  });

  return server;
}

// Re-export for convenience
export { recordToolCall, getTransportMetrics, SessionManager };
