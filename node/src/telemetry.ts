/**
 * OpenTelemetry Telemetry Initialization Module
 *
 * Provides distributed tracing for the agent-deploy MCP server.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { trace, Tracer, context, propagation, Context } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const PACKAGE_VERSION = process.env.npm_package_version || "1.0.0";

export interface TelemetryOptions {
  /** OTLP HTTP endpoint for trace export */
  endpoint?: string;
  /** Service name override */
  serviceName?: string;
  /** Service version override */
  serviceVersion?: string;
  /** Enable console debug logging */
  debug?: boolean;
}

let sdk: NodeSDK | undefined;
let isInitialized = false;

/**
 * Initialize OpenTelemetry SDK with OTLP HTTP exporter.
 *
 * Environment variable overrides:
 *   OTEL_EXPORTER_OTLP_ENDPOINT - OTLP endpoint URL
 *   OTEL_SERVICE_NAME             - Service name
 */
export function initTelemetry(options?: TelemetryOptions): void {
  if (isInitialized) {
    if (options?.debug) {
      console.error("[Telemetry] Already initialized, skipping.");
    }
    return;
  }

  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    options?.endpoint ||
    "http://localhost:4318/v1/traces";

  const serviceName =
    process.env.OTEL_SERVICE_NAME || options?.serviceName || "agent-deploy";

  const serviceVersion = options?.serviceVersion || PACKAGE_VERSION;

  if (options?.debug) {
    console.error(`[Telemetry] Initializing tracer: service=${serviceName}, endpoint=${endpoint}`);
  }

  const resource = resourceFromAttributes({
    [SEMRESATTRS_SERVICE_NAME]: serviceName,
    [SEMRESATTRS_SERVICE_VERSION]: serviceVersion,
  });

  const exporter = new OTLPTraceExporter({ url: endpoint });
  const spanProcessor = new BatchSpanProcessor(exporter);

  sdk = new NodeSDK({
    resource,
    spanProcessors: [spanProcessor],
    traceExporter: exporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  isInitialized = true;

  if (options?.debug) {
    console.error("[Telemetry] SDK started successfully.");
  }

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    if (sdk) {
      await sdk.shutdown();
      if (options?.debug) {
        console.error("[Telemetry] SDK shut down.");
      }
    }
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("beforeExit", shutdown);
}

/**
 * Get a named Tracer instance.
 */
export function getTracer(name: string): Tracer {
  return trace.getTracer(name, PACKAGE_VERSION);
}

/**
 * Check if telemetry has been initialized.
 */
export function telemetryInitialized(): boolean {
  return isInitialized;
}

/**
 * Serialize the current trace context to a plain object suitable for
 * passing across async boundaries or storing in ExecutionContext.
 */
export function serializeTraceContext(ctx?: Context): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(ctx || context.active(), carrier);
  return carrier;
}

/**
 * Deserialize a trace context from a plain object and return a new Context.
 */
export function deserializeTraceContext(carrier: Record<string, string>): Context {
  return propagation.extract(context.active(), carrier);
}

/**
 * Wrap a function so it runs inside the provided OpenTelemetry Context.
 */
export function withContext<T>(ctx: Context, fn: () => T): T {
  return context.with(ctx, fn);
}

/**
 * Wrap an async function so it runs inside the provided OpenTelemetry Context.
 */
export function withContextAsync<T>(ctx: Context, fn: () => Promise<T>): Promise<T> {
  return context.with(ctx, fn);
}
