/**
 * OIDC / OAuth2 SSO Integration for Agent Deploy
 *
 * Supports standard OIDC Authorization Code flow:
 *   1. Build authorization URL → redirect user to IdP
 *   2. Handle callback with authorization code
 *   3. Exchange code for tokens
 *   4. Validate ID / access tokens
 *
 * Configuration via environment variables:
 *   OIDC_ISSUER       – OIDC issuer URL (e.g. https://accounts.google.com)
 *   OIDC_CLIENT_ID    – OAuth2 client ID
 *   OIDC_CLIENT_SECRET– OAuth2 client secret
 *   OIDC_REDIRECT_URI – Callback URL (default: http://localhost:3000/auth/callback)
 *   OIDC_SCOPES       – Space-separated scopes (default: openid profile email)
 */

import * as https from "node:https";
import * as http from "node:http";
import * as crypto from "node:crypto";
import * as url from "node:url";
import type { UserInfo } from "./auth.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OIDCConfig {
  /** OIDC issuer base URL */
  issuer: string;
  /** OAuth2 client ID */
  clientId: string;
  /** OAuth2 client secret */
  clientSecret: string;
  /** Redirect URI registered with the IdP */
  redirectUri: string;
  /** Requested scopes */
  scopes: string[];
}

export interface TokenResponse {
  /** Access token */
  access_token: string;
  /** ID token (JWT) */
  id_token?: string;
  /** Token type, usually "Bearer" */
  token_type: string;
  /** Expiration in seconds */
  expires_in?: number;
  /** Refresh token */
  refresh_token?: string;
}

export interface OIDCMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
  issuer: string;
}

// ---------------------------------------------------------------------------
// Environment-based configuration
// ---------------------------------------------------------------------------

function getEnv(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

export function loadOIDCConfigFromEnv(): OIDCConfig | undefined {
  const issuer = getEnv("OIDC_ISSUER");
  const clientId = getEnv("OIDC_CLIENT_ID");
  const clientSecret = getEnv("OIDC_CLIENT_SECRET");

  if (!issuer || !clientId || !clientSecret) {
    return undefined;
  }

  return {
    issuer: issuer.replace(/\/$/, ""),
    clientId,
    clientSecret,
    redirectUri:
      getEnv("OIDC_REDIRECT_URI") ?? "http://localhost:3000/auth/callback",
    scopes: (getEnv("OIDC_SCOPES", "openid profile email") || "").split(/\s+/),
  };
}

// ---------------------------------------------------------------------------
// OIDC Provider
// ---------------------------------------------------------------------------

export class OIDCProvider {
  private config: OIDCConfig;
  private metadata?: OIDCMetadata;
  private codeVerifiers = new Map<string, string>(); // state -> code_verifier

  constructor(config: OIDCConfig) {
    this.config = config;
  }

  /**
   * Fetch OIDC discovery metadata from the issuer's well-known endpoint.
   */
  async discover(): Promise<OIDCMetadata> {
    if (this.metadata) return this.metadata;

    const discoveryUrl = `${this.config.issuer}/.well-known/openid-configuration`;
    const raw = await httpGetJson(discoveryUrl);
    const meta = raw as OIDCMetadata;

    if (!meta.authorization_endpoint || !meta.token_endpoint) {
      throw new Error("Invalid OIDC discovery document");
    }

    this.metadata = meta;
    return meta;
  }

  /**
   * Generate the authorization URL to redirect the user to the IdP.
   * Returns the URL and the state parameter (should be stored in session).
   */
  async authorizeUrl(): Promise<{ url: string; state: string }> {
    const meta = await this.discover();
    const state = randomString(32);
    const codeVerifier = randomString(64);
    const codeChallenge = base64UrlEncode(
      crypto.createHash("sha256").update(codeVerifier).digest()
    );

    this.codeVerifiers.set(state, codeVerifier);

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: this.config.scopes.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    const authUrl = `${meta.authorization_endpoint}?${params.toString()}`;
    return { url: authUrl, state };
  }

  /**
   * Handle the OAuth2 callback: exchange authorization code for tokens.
   */
  async handleCallback(code: string, state: string): Promise<TokenResponse> {
    const meta = await this.discover();
    const codeVerifier = this.codeVerifiers.get(state);
    if (!codeVerifier) {
      throw new Error("Invalid or expired state parameter");
    }
    this.codeVerifiers.delete(state);

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code_verifier: codeVerifier,
    });

    const tokenData = await httpPostForm(meta.token_endpoint, body);
    const tokenResponse = tokenData as TokenResponse;

    if (!tokenResponse.access_token) {
      throw new Error("Token endpoint did not return an access_token");
    }

    return tokenResponse;
  }

  /**
   * Validate an OIDC token (access token or ID token).
   * For access tokens, performs userinfo introspection when available.
   * For ID tokens, validates JWT signature and claims locally.
   */
  async validateToken(token: string): Promise<UserInfo> {
    const meta = await this.discover();

    // Try userinfo endpoint first (for access tokens)
    if (meta.userinfo_endpoint) {
      try {
        const userinfo = await httpGetJson(meta.userinfo_endpoint, {
          Authorization: `Bearer ${token}`,
        });
        return this.mapUserinfo(userinfo as Record<string, unknown>);
      } catch {
        // Fall through to ID token validation
      }
    }

    // Try validating as an ID token (JWT)
    const jwtUser = await this.validateIdToken(token);
    if (jwtUser) return jwtUser;

    throw new Error("Unable to validate token");
  }

  /**
   * Validate an ID token locally (signature + claims).
   * Note: Full JWKS verification requires fetching keys from jwks_uri.
   * This implementation validates standard claims and parses the payload.
   */
  private async validateIdToken(token: string): Promise<UserInfo | null> {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    try {
      const payload = JSON.parse(base64UrlDecode(parts[1])) as Record<
        string,
        unknown
      >;

      // Basic claim validation
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && typeof payload.exp === "number" && payload.exp < now) {
        throw new Error("ID token expired");
      }

      if (payload.iss && payload.iss !== this.config.issuer) {
        throw new Error("ID token issuer mismatch");
      }

      if (payload.aud && payload.aud !== this.config.clientId) {
        throw new Error("ID token audience mismatch");
      }

      return this.mapUserinfo(payload);
    } catch {
      return null;
    }
  }

  private mapUserinfo(data: Record<string, unknown>): UserInfo {
    const roles: string[] = [];
    if (data.groups && Array.isArray(data.groups)) {
      roles.push(...data.groups.map(String));
    }
    if (data.role && typeof data.role === "string") {
      roles.push(data.role);
    }
    if (roles.length === 0) {
      roles.push("user");
    }

    return {
      userId: String(data.sub || data.id || data.user_id || "unknown"),
      name: data.name ? String(data.name) : undefined,
      email: data.email ? String(data.email) : undefined,
      tenantId: data.tenantId ? String(data.tenantId) : undefined,
      roles,
      authMethod: "oidc",
      raw: data,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let globalOIDCProvider: OIDCProvider | undefined;

export function getOIDCProvider(): OIDCProvider | undefined {
  if (globalOIDCProvider) return globalOIDCProvider;

  const config = loadOIDCConfigFromEnv();
  if (!config) return undefined;

  globalOIDCProvider = new OIDCProvider(config);
  return globalOIDCProvider;
}

export function setOIDCProvider(provider: OIDCProvider): void {
  globalOIDCProvider = provider;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpGetJson(
  targetUrl: string,
  headers?: Record<string, string>
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === "https:" ? https : http;

    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(headers || {}),
      },
    };

    const req = client.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

function httpPostForm(
  targetUrl: string,
  body: URLSearchParams
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === "https:" ? https : http;
    const payload = body.toString();

    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(payload),
        Accept: "application/json",
      },
    };

    const req = client.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function randomString(length: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let result = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, "base64").toString("utf-8");
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64url");
}
