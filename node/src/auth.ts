/**
 * Authentication & Authorization Middleware for Agent Deploy
 *
 * Supports multiple authentication methods:
 * - API Key (existing)
 * - JWT Token
 * - OAuth2 / OIDC
 */

import * as crypto from "node:crypto";
import type { IncomingMessage } from "node:http";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserInfo {
  /** Unique user identifier */
  userId: string;

  /** Human-readable name */
  name?: string;

  /** Email address */
  email?: string;

  /** Assigned tenant ID */
  tenantId?: string;

  /** User roles */
  roles: string[];

  /** Authentication method used */
  authMethod: "apikey" | "jwt" | "oidc" | "unknown";

  /** Original token payload (for debugging/extension) */
  raw?: Record<string, unknown>;
}

export interface AuthResult {
  success: boolean;
  user?: UserInfo;
  error?: string;
}

export interface ApiKeyConfig {
  /** API key string -> user info mapping */
  keys: Map<string, UserInfo>;
}

export interface JwtConfig {
  /** JWT secret or PEM public key for verification */
  secret: string;
  /** Expected issuer */
  issuer?: string;
  /** Expected audience */
  audience?: string;
  /** Token max age in seconds */
  maxAge?: number;
}

export interface AuthConfig {
  apiKey?: ApiKeyConfig;
  jwt?: JwtConfig;
  /** Enable OIDC — OIDCProvider is in auth-oidc.ts */
  oidc?: boolean;
  /** Default tenant for unscoped users */
  defaultTenantId?: string;
}

// ---------------------------------------------------------------------------
// Request Context Extension
// ---------------------------------------------------------------------------

declare module "node:http" {
  interface IncomingMessage {
    /** Authenticated user info (set by auth middleware) */
    user?: UserInfo;
    /** Resolved tenant ID (set by auth middleware) */
    tenantId?: string;
  }
}

// ---------------------------------------------------------------------------
// Auth Middleware
// ---------------------------------------------------------------------------

export class AuthMiddleware {
  private apiKeys = new Map<string, UserInfo>();
  private jwtConfig?: JwtConfig;
  private defaultTenantId?: string;

  constructor(config: AuthConfig = {}) {
    if (config.apiKey) {
      this.apiKeys = config.apiKey.keys;
    }
    this.jwtConfig = config.jwt;
    this.defaultTenantId = config.defaultTenantId;
  }

  /**
   * Register an API key for a user.
   */
  registerApiKey(apiKey: string, user: UserInfo): void {
    this.apiKeys.set(apiKey, { ...user, authMethod: "apikey" });
  }

  /**
   * Revoke an API key.
   */
  revokeApiKey(apiKey: string): boolean {
    return this.apiKeys.delete(apiKey);
  }

  /**
   * Authenticate a token string and return user info.
   * Supports:
   *   - API Key (raw string match)
   *   - JWT Bearer token
   *   - OIDC Bearer token (delegated to OIDCProvider)
   */
  async authenticate(token: string): Promise<AuthResult> {
    if (!token || token.trim().length === 0) {
      return { success: false, error: "Missing token" };
    }

    const trimmed = token.trim();

    // 1. Try API Key (exact match)
    const apiUser = this.apiKeys.get(trimmed);
    if (apiUser) {
      return {
        success: true,
        user: { ...apiUser, authMethod: "apikey" },
      };
    }

    // 2. Try JWT (Bearer token format)
    const jwtResult = await this.verifyJwt(trimmed);
    if (jwtResult.success) {
      return jwtResult;
    }

    // 3. If OIDC is enabled, the caller should try OIDCProvider separately
    //    (we return failure here so the HTTP layer can fall back)
    return { success: false, error: "Invalid or unsupported token" };
  }

  /**
   * Authorize a user action on a resource.
   * Returns true if allowed, false otherwise.
   */
  authorize(user: UserInfo, resource: string, action: string): boolean {
    // Admin role has full access
    if (user.roles.includes("admin")) {
      return true;
    }

    // Resource-specific rules
    if (resource.startsWith("/admin/")) {
      return user.roles.includes("admin");
    }

    if (resource === "/message") {
      // Any authenticated user can access /message
      return true;
    }

    if (resource === "/metrics") {
      return user.roles.includes("admin") || user.roles.includes("reader");
    }

    if (resource === "/health") {
      return true; // Public
    }

    // Default deny
    return false;
  }

  /**
   * Extract token from HTTP Authorization header.
   * Supports:
   *   Authorization: Bearer <token>
   *   Authorization: ApiKey <token>
   */
  extractToken(req: IncomingMessage): string | undefined {
    const authHeader = req.headers["authorization"];
    if (!authHeader || typeof authHeader !== "string") {
      return undefined;
    }

    const parts = authHeader.split(" ");
    if (parts.length === 2) {
      const [scheme, token] = parts;
      if (scheme.toLowerCase() === "bearer" || scheme.toLowerCase() === "apikey") {
        return token;
      }
    }

    // Fallback: treat entire header as raw token
    return authHeader;
  }

  /**
   * Middleware-compatible handler that attaches user info to the request.
   */
  async handle(req: IncomingMessage): Promise<AuthResult> {
    const token = this.extractToken(req);
    if (!token) {
      return { success: false, error: "Missing Authorization header" };
    }

    const result = await this.authenticate(token);
    if (result.success && result.user) {
      req.user = result.user;
      req.tenantId = result.user.tenantId || this.defaultTenantId;
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // JWT Verification (HMAC + RS256/ES256 support via Web Crypto)
  // ---------------------------------------------------------------------------

  private async verifyJwt(token: string): Promise<AuthResult> {
    if (!this.jwtConfig) {
      return { success: false, error: "JWT not configured" };
    }

    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        return { success: false, error: "Invalid JWT format" };
      }

      const [headerB64, payloadB64, signatureB64] = parts;

      // Decode header to determine algorithm
      const header = JSON.parse(base64UrlDecode(headerB64)) as {
        alg: string;
        typ?: string;
      };

      // Decode payload
      const payload = JSON.parse(base64UrlDecode(payloadB64)) as Record<
        string,
        unknown
      >;

      // Verify signature
      const validSig = await this.verifyJwtSignature(
        `${headerB64}.${payloadB64}`,
        signatureB64,
        header.alg
      );
      if (!validSig) {
        return { success: false, error: "Invalid JWT signature" };
      }

      // Validate claims
      const now = Math.floor(Date.now() / 1000);

      if (payload.exp && typeof payload.exp === "number" && payload.exp < now) {
        return { success: false, error: "JWT expired" };
      }

      if (payload.nbf && typeof payload.nbf === "number" && payload.nbf > now) {
        return { success: false, error: "JWT not yet valid" };
      }

      if (this.jwtConfig.issuer) {
        if (payload.iss !== this.jwtConfig.issuer) {
          return { success: false, error: "Invalid JWT issuer" };
        }
      }

      if (this.jwtConfig.audience) {
        const aud = payload.aud;
        const expected = this.jwtConfig.audience;
        const audMatch = Array.isArray(aud)
          ? aud.includes(expected)
          : aud === expected;
        if (!audMatch) {
          return { success: false, error: "Invalid JWT audience" };
        }
      }

      if (this.jwtConfig.maxAge && payload.iat) {
        const age = now - (payload.iat as number);
        if (age > this.jwtConfig.maxAge) {
          return { success: false, error: "JWT max age exceeded" };
        }
      }

      const user: UserInfo = {
        userId: String(payload.sub || payload.userId || payload.id || "unknown"),
        name: payload.name ? String(payload.name) : undefined,
        email: payload.email ? String(payload.email) : undefined,
        tenantId: payload.tenantId
          ? String(payload.tenantId)
          : this.defaultTenantId,
        roles: extractRoles(payload),
        authMethod: "jwt",
        raw: payload,
      };

      return { success: true, user };
    } catch (err) {
      return {
        success: false,
        error: `JWT verification failed: ${(err as Error).message}`,
      };
    }
  }

  private async verifyJwtSignature(
    data: string,
    signatureB64: string,
    alg: string
  ): Promise<boolean> {
    const secret = this.jwtConfig!.secret;

    if (alg === "HS256") {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(data)
      );
      const expected = Buffer.from(sig).toString("base64url");
      return signatureB64 === expected;
    }

    if (alg === "HS384") {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-384" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(data)
      );
      const expected = Buffer.from(sig).toString("base64url");
      return signatureB64 === expected;
    }

    if (alg === "HS512") {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-512" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(data)
      );
      const expected = Buffer.from(sig).toString("base64url");
      return signatureB64 === expected;
    }

    // For RS256/ES256, secret should be a PEM public key
    if (alg === "RS256" || alg === "ES256") {
      // Node.js Web Crypto doesn't support RSA/ECDSA verify via subtle easily
      // without more elaborate key import. For production, use 'jose' library.
      // Here we do a basic Node crypto verify.
      const verify = crypto.createVerify("SHA256");
      verify.update(data);
      const sig = Buffer.from(signatureB64, "base64url");
      return verify.verify(secret, sig);
    }

    // Unsupported algorithm
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, "base64").toString("utf-8");
}

function extractRoles(payload: Record<string, unknown>): string[] {
  if (payload.roles && Array.isArray(payload.roles)) {
    return payload.roles.map(String);
  }
  if (payload.role && typeof payload.role === "string") {
    return [payload.role];
  }
  if (payload.scope && typeof payload.scope === "string") {
    return payload.scope.split(" ");
  }
  return ["user"];
}

// ---------------------------------------------------------------------------
// Factory / Singleton helpers
// ---------------------------------------------------------------------------

let globalAuthMiddleware: AuthMiddleware | undefined;

export function createAuthMiddleware(config?: AuthConfig): AuthMiddleware {
  globalAuthMiddleware = new AuthMiddleware(config);
  return globalAuthMiddleware;
}

export function getAuthMiddleware(): AuthMiddleware {
  if (!globalAuthMiddleware) {
    globalAuthMiddleware = new AuthMiddleware();
  }
  return globalAuthMiddleware;
}
