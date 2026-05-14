import type { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { resolveOidcIssuers } from "./presets.js";
import { verifyOidcToken, type OidcVerifyFailureReason } from "./oidc-verifier.js";
import { resolveResourceBaseUrl, isOAuthProxyEnabled } from "./protected-resource.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: { sub: string; provider: "oidc" | "mcp_auth_token" };
  }
}

function hashSub(sub: string): string {
  return createHash("sha256").update(sub).digest("hex").slice(0, 12);
}

function logAuthOutcome(sub: string, provider: "oidc" | "mcp_auth_token"): void {
  const mode = process.env.OIDC_LOG_SUB_MODE === "full" ? sub : hashSub(sub);
  console.log(`[auth] ok provider=${provider} sub=${mode}`);
}

function sendUnauthorized(
  req: Request,
  res: Response,
  error: OidcVerifyFailureReason,
  description: string,
): void {
  const base = resolveResourceBaseUrl(req);
  const metadataUrl = `${base}/.well-known/oauth-protected-resource`;
  // RFC 7235 quoted-string: backslash-escape backslashes first, then inner
  // double quotes. This keeps the description text identical between the
  // WWW-Authenticate header and the JSON body's error_description.
  const params: string[] = [
    'realm="MCP Server"',
    `error="${error}"`,
    `error_description="${description.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
    `resource_metadata="${metadataUrl}"`,
    'charset="UTF-8"',
  ];
  res.setHeader("WWW-Authenticate", `Bearer ${params.join(", ")}`);
  res.status(401).json({
    error,
    error_description: description,
  });
}

function tryMcpAuthToken(provided: string, expected: string): boolean {
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Combined auth middleware (R27): pass when OIDC verify succeeds OR
 * MCP_AUTH_TOKEN matches. When neither is configured, allow (dev mode warning).
 */
export async function oidcAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const oidcIssuers = resolveOidcIssuers(process.env.OIDC_ISSUERS, process.env.OIDC_PRESET);
  const mcpToken = process.env.MCP_AUTH_TOKEN;
  // R4: OIDC_AUDIENCE 미설정 시 OAuth Proxy 모드에 한정해 GOOGLE_OAUTH_CLIENT_ID 자동 채택.
  // Google ID token 의 aud claim 은 항상 OAuth client_id 와 동일하므로 두 env 중복 입력 불필요.
  const audience =
    process.env.OIDC_AUDIENCE ||
    (isOAuthProxyEnabled() ? process.env.GOOGLE_OAUTH_CLIENT_ID : undefined);

  if (oidcIssuers.length === 0 && !mcpToken) {
    if (!req.user) {
      console.warn("[auth] no OIDC issuers and no MCP_AUTH_TOKEN — request allowed (dev mode)");
    }
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    sendUnauthorized(req, res, "invalid_request", "Missing Authorization header");
    return;
  }

  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    sendUnauthorized(req, res, "invalid_request", "Authorization header must use Bearer scheme");
    return;
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    sendUnauthorized(req, res, "invalid_request", "Empty bearer token");
    return;
  }

  if (mcpToken && tryMcpAuthToken(token, mcpToken)) {
    req.user = { sub: "service-account", provider: "mcp_auth_token" };
    logAuthOutcome(req.user.sub, "mcp_auth_token");
    return next();
  }

  if (oidcIssuers.length > 0) {
    const result = await verifyOidcToken(token, oidcIssuers, audience);
    if (result.ok) {
      const sub = typeof result.payload.sub === "string" ? result.payload.sub : "unknown";
      req.user = { sub, provider: "oidc" };
      logAuthOutcome(sub, "oidc");
      return next();
    }
    sendUnauthorized(req, res, result.reason, result.description);
    return;
  }

  sendUnauthorized(req, res, "invalid_token", "Token did not match MCP_AUTH_TOKEN");
}