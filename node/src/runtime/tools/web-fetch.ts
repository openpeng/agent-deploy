import https from "https";
import http from "http";
import { URL } from "url";
import { Tool } from "../pipeline.js";
import { ExecutionContext } from "../types.js";

/**
 * Web Fetch tool
 * Fetches content from URLs via HTTP/HTTPS
 */
export class WebFetchTool implements Tool {
  name = "web_fetch";

  async execute(
    args: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      timeout?: number;
      follow_redirects?: boolean;
      max_redirects?: number;
    },
    context: ExecutionContext
  ): Promise<{
    status_code: number;
    headers: Record<string, string | string[]>;
    body: string;
    duration_ms: number;
    final_url: string;
  }> {
    // Validate args
    if (!args.url) {
      throw new Error("web_fetch: 'url' parameter is required");
    }

    // Parse URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(args.url);
    } catch (error) {
      throw new Error(`web_fetch: Invalid URL: ${args.url}`);
    }

    const method = args.method || "GET";
    const timeout = args.timeout || 30000;
    const followRedirects = args.follow_redirects !== false;
    const maxRedirects = args.max_redirects || 10;

    const startTime = Date.now();

    try {
      return await this.fetch(
        parsedUrl,
        method,
        args.headers || {},
        timeout,
        followRedirects,
        maxRedirects,
        0,
        startTime
      );
    } catch (error: any) {
      const duration = Date.now() - startTime;
      throw new Error(
        `web_fetch: Request failed (${duration}ms): ${error.message}`
      );
    }
  }

  private fetch(
    url: URL,
    method: string,
    headers: Record<string, string>,
    timeout: number,
    followRedirects: boolean,
    maxRedirects: number,
    redirectCount: number,
    startTime: number
  ): Promise<{
    status_code: number;
    headers: Record<string, string | string[]>;
    body: string;
    duration_ms: number;
    final_url: string;
  }> {
    return new Promise((resolve, reject) => {
      const protocol = url.protocol === "https:" ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          "User-Agent": "agent-deploy/1.0",
          ...headers,
        },
        timeout,
      };

      const req = protocol.request(options, (res) => {
        const statusCode = res.statusCode || 0;

        // Handle redirects
        if (
          followRedirects &&
          statusCode >= 300 &&
          statusCode < 400 &&
          res.headers.location
        ) {
          if (redirectCount >= maxRedirects) {
            reject(new Error(`Too many redirects (max: ${maxRedirects})`));
            return;
          }

          // Resolve redirect URL
          const redirectUrl = new URL(res.headers.location, url);

          // Follow redirect
          this.fetch(
            redirectUrl,
            method,
            headers,
            timeout,
            followRedirects,
            maxRedirects,
            redirectCount + 1,
            startTime
          )
            .then(resolve)
            .catch(reject);

          return;
        }

        // Collect response body
        const chunks: Buffer[] = [];

        res.on("data", (chunk) => {
          chunks.push(Buffer.from(chunk));
        });

        res.on("end", () => {
          const duration = Date.now() - startTime;
          const body = Buffer.concat(chunks).toString("utf-8");

          resolve({
            status_code: statusCode,
            headers: res.headers as Record<string, string | string[]>,
            body,
            duration_ms: duration,
            final_url: url.toString(),
          });
        });

        res.on("error", (error) => {
          reject(error);
        });
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Request timed out after ${timeout}ms`));
      });

      req.on("error", (error) => {
        reject(error);
      });

      req.end();
    });
  }
}
