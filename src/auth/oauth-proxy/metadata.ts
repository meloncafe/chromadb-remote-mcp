import type { Request, Response } from "express";
import { resolveResourceBaseUrl } from "../protected-resource.js";

/**
 * Resolves the canonical issuer/base URL.
 * Priority: OAUTH_PROXY_BASE_URL env > resolveResourceBaseUrl(req).
 * Trailing slash is stripped to keep URL composition idempotent.
 */
export function resolveOAuthBaseUrl(req: Request): string {
  const envBase = process.env.OAUTH_PROXY_BASE_URL;
  if (typeof envBase === "string" && envBase.trim().length > 0) {
    return envBase.trim().replace(/\/+$/, "");
  }
  return resolveResourceBaseUrl(req).replace(/\/+$/, "");
}

/**
 * RFC 8414 Authorization Server Metadata.
 * GET /.well-known/oauth-authorization-server
 */
export function authServerMetadataHandler(req: Request, res: Response): void {
  const base = resolveOAuthBaseUrl(req);
  res.setHeader("Content-Type", "application/json");
  res.status(200).json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: (process.env.OIDC_SCOPES || "openid,email,profile")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  });
}