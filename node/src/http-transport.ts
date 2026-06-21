/**
 * Streamable HTTP Transport for MCP Server
 *
 * Wraps the official SDK StreamableHTTPServerTransport with:
 * - Multi-client session management
 * - Metrics collection
 * - Backward-compatible SSE endpoint support
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { propagation, context as otelContext, trace } from "@opentelemetry/api";

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface TransportMetrics {
  requestsTotal: number;
  requestDurationSum: number;
  activeConnections: number;
  toolCallsTotal: number;
  sessionsTotal: number;
}

const metrics: TransportMetrics = {
  requestsTotal: 0,
  requestDurationSum: 0,
  activeConnections: 0,
  toolCallsTotal: 0,
  sessionsTotal: 0,
};

export function getTransportMetrics(): TransportMetrics {
  return { ...metrics };
}

export function recordToolCall(): void {
  metrics.toolCallsTotal++;
}

// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------

export type SessionTransport =
  | { type: "streamable"; transport: StreamableHTTPServerTransport }
  | { type: "sse"; transport: SSEServerTransport };

export class SessionManager {
  private sessions = new Map<string, SessionTransport>();

  get(sessionId: string): SessionTransport | undefined {
    return this.sessions.get(sessionId);
  }

  set(sessionId: string, value: SessionTransport): void {
    this.sessions.set(sessionId, value);
    metrics.sessionsTotal = this.sessions.size;
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
    metrics.sessionsTotal = this.sessions.size;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  values(): IterableIterator<SessionTransport> {
    return this.sessions.values();
  }

  size(): number {
    return this.sessions.size;
  }

  async closeAll(): Promise<void> {
    const closers: Promise<void>[] = [];
    for (const [, st] of this.sessions) {
      closers.push(st.transport.close());
    }
    await Promise.all(closers);
    this.sessions.clear();
    metrics.sessionsTotal = 0;
    metrics.activeConnections = 0;
  }
}

// ---------------------------------------------------------------------------
// Streamable HTTP Transport Factory
// ---------------------------------------------------------------------------

export interface CreateStreamableOptions {
  sessionManager: SessionManager;
  onSessionInitialized?: (sessionId: string) => void;
  enableJsonResponse?: boolean;
}

export function createStreamableTransport(
  options: CreateStreamableOptions
): StreamableHTTPServerTransport {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: options.enableJsonResponse ?? false,
    onsessioninitialized: (sessionId: string) => {
      options.sessionManager.set(sessionId, {
        type: "streamable",
        transport,
      });
      options.onSessionInitialized?.(sessionId);
    },
  });

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) {
      options.sessionManager.delete(sid);
      metrics.activeConnections = Math.max(0, metrics.activeConnections - 1);
    }
  };

  transport.onerror = (err: Error) => {
    console.error("[StreamableHTTP] transport error:", err.message);
  };

  return transport;
}

// ---------------------------------------------------------------------------
// Request Router / Handler
// ---------------------------------------------------------------------------

export interface RouteContext {
  sessionManager: SessionManager;
  serverFactory: () => { connect: (t: Transport) => Promise<void> };
  pathPrefix?: string;
}

/**
 * Handles POST /message for the Streamable HTTP transport.
 * Supports both new initialization requests and existing sessions.
 */
export async function handlePostMessage(
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody: unknown,
  ctx: RouteContext
): Promise<void> {
  const start = Date.now();
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // Extract W3C traceparent from incoming HTTP headers and set as active OTel context
  const incomingHeaders: Record<string, string> = {};
  const traceparent = req.headers["traceparent"];
  if (traceparent && typeof traceparent === "string") {
    incomingHeaders["traceparent"] = traceparent;
  }
  const tracestate = req.headers["tracestate"];
  if (tracestate && typeof tracestate === "string") {
    incomingHeaders["tracestate"] = tracestate;
  }
  const extractedCtx = propagation.extract(otelContext.active(), incomingHeaders);

  // Run the handler inside the extracted trace context
  await otelContext.with(extractedCtx, async () => {
    try {
      let transport: StreamableHTTPServerTransport;

      if (sessionId && ctx.sessionManager.has(sessionId)) {
        const existing = ctx.sessionManager.get(sessionId)!;
        if (existing.type !== "streamable") {
          sendJsonError(res, 400, "Session uses a different transport protocol");
          return;
        }
        transport = existing.transport;
      } else if (!sessionId && isInitializeRequest(parsedBody)) {
        transport = createStreamableTransport({
          sessionManager: ctx.sessionManager,
        });
        const server = ctx.serverFactory();
        await server.connect(transport);
        metrics.activeConnections++;
      } else {
        sendJsonError(res, 400, "Bad Request: No valid session ID provided");
        return;
      }

      await transport.handleRequest(req, res, parsedBody);
    } catch (err) {
      console.error("[HTTP] Error handling POST /message:", err);
      if (!res.headersSent) {
        sendJsonError(res, 500, "Internal server error");
      }
    } finally {
      metrics.requestsTotal++;
      metrics.requestDurationSum += (Date.now() - start) / 1000;
    }
  });
}

/**
 * Handles GET /sse for backward-compatible SSE transport.
 */
export async function handleGetSse(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext
): Promise<void> {
  const start = Date.now();
  try {
    const transport = new SSEServerTransport("/message", res);
    ctx.sessionManager.set(transport.sessionId, {
      type: "sse",
      transport,
    });

    res.on("close", () => {
      ctx.sessionManager.delete(transport.sessionId);
      metrics.activeConnections = Math.max(0, metrics.activeConnections - 1);
    });

    const server = ctx.serverFactory();
    await server.connect(transport);
    metrics.activeConnections++;
  } catch (err) {
    console.error("[HTTP] Error handling GET /sse:", err);
    if (!res.headersSent) {
      sendJsonError(res, 500, "Internal server error");
    }
  } finally {
    metrics.requestsTotal++;
    metrics.requestDurationSum += (Date.now() - start) / 1000;
  }
}

/**
 * Handles POST /message for backward-compatible SSE transport.
 */
export async function handleSsePostMessage(
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody: unknown,
  sessionId: string | undefined,
  ctx: RouteContext
): Promise<void> {
  const start = Date.now();
  try {
    if (!sessionId) {
      sendJsonError(res, 400, "Missing sessionId query parameter");
      return;
    }

    const existing = ctx.sessionManager.get(sessionId);
    if (!existing) {
      sendJsonError(res, 404, "Session not found");
      return;
    }

    if (existing.type !== "sse") {
      sendJsonError(res, 400, "Session exists but uses a different transport protocol");
      return;
    }

    await existing.transport.handlePostMessage(req, res, parsedBody);
  } catch (err) {
    console.error("[HTTP] Error handling POST /message (SSE):", err);
    if (!res.headersSent) {
      sendJsonError(res, 500, "Internal server error");
    }
  } finally {
    metrics.requestsTotal++;
    metrics.requestDurationSum += (Date.now() - start) / 1000;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJsonError(res: ServerResponse, status: number, message: string): void {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}
