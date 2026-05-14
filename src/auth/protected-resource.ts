import type { Request, Response } from "express";
import { resolveOidcIssuers } from "./presets.js";

/**
 * Returns the canonical base URL of this MCP server (resource identifier).
 * Used for both the `resource` claim and the `resource_metadata` URL in
 * WWW-Authenticate. Honors X-Forwarded-Proto/Host when behind a proxy.
 */
export function resolveResourceBaseUrl(req: Request): string {
  // R5: OAUTH_PROXY_BASE_URL 이 명시되어 있으면 헤더 fallback 보다 우선.
  // Caddy 등 X-Forwarded-Proto 를 안 보내는 reverse proxy 환경에서 http resource 가
  // OAuth 2.1 클라이언트에 거부되는 회귀를 막는다. 미설정 시 v2.0.0 헤더 fallback 그대로.
  const envBase = process.env.OAUTH_PROXY_BASE_URL;
  if (typeof envBase === "string" && envBase.trim().length > 0) {
    return envBase.trim().replace(/\/+$/, "");
  }
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ||
    (req.secure ? "https" : "http");
  const host =
    (req.headers["x-forwarded-host"] as string | undefined) ||
    req.headers.host ||
    "localhost";
  return `${proto}://${host}`;
}

export function isOAuthProxyEnabled(): boolean {
  const raw = process.env.OAUTH_PROXY_ENABLED;
  if (typeof raw !== "string") return false;
  return raw.trim().toLowerCase() === "true";
}

/**
 * RFC 9728 Protected Resource Metadata.
 * GET /.well-known/oauth-protected-resource → JSON metadata describing
 * which authorization servers may issue tokens for this MCP resource.
 */
export function protectedResourceHandler(req: Request, res: Response): void {
  const resource = resolveResourceBaseUrl(req);

  // R10: When the proxy is enabled, advertise *this* server as the authorization
  // server. Clients (Claude Desktop, mcp-remote, ...) then send DCR + authorize
  // requests to our /oauth/* endpoints instead of trying Google directly
  // (Google does not support DCR — RFC 7591 — so direct integration is broken).
  const issuers = isOAuthProxyEnabled()
    ? [resource]
    : resolveOidcIssuers(process.env.OIDC_ISSUERS, process.env.OIDC_PRESET);

  const scopes = (process.env.OIDC_SCOPES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  res.setHeader("Content-Type", "application/json");
  res.status(200).json({
    resource,
    authorization_servers: issuers,
    bearer_methods_supported: ["header"],
    scopes_supported: scopes,
  });
}