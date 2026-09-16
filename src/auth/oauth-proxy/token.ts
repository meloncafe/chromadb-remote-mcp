import type { Request, Response } from "express";
import { createHash } from "crypto";
import { consumeAuthzCode } from "./state-store.js";

/**
 * PKCE S256 verifier check:
 *   base64url(SHA256(code_verifier)) === code_challenge
 *
 * RFC 7636. Constant-time comparison via string equality is acceptable
 * here because both sides are server-controlled bytes (the challenge is
 * something the client published in the authorize step; reproducing it
 * does not bypass anything that wasn't already public).
 */
export function verifyPkceS256(code_verifier: string, code_challenge: string): boolean {
  const hash = createHash("sha256").update(code_verifier, "utf8").digest("base64url");
  return hash === code_challenge;
}

/**
 * POST /oauth/token
 *
 * grant_type=authorization_code with PKCE. We exchange the proxy code for
 * the stored Google id_token (no re-signing — passthrough).
 *
 * Body (application/x-www-form-urlencoded):
 *   grant_type=authorization_code
 *   code=<proxy_code>
 *   redirect_uri=<must match authorize>
 *   client_id=<must match authorize>
 *   code_verifier=<PKCE>
 */
export async function tokenHandler(req: Request, res: Response): Promise<void> {
  // Express's body-parser populates req.body for both JSON and urlencoded
  // depending on which middleware is mounted. Accept whichever shape is present.
  const body = (req.body ?? {}) as Record<string, unknown>;

  const grant_type = body.grant_type;

  if (grant_type === "refresh_token") {
    await handleRefreshToken(body, res);
    return;
  }

  if (grant_type !== "authorization_code") {
    res.status(400).json({
      error: "unsupported_grant_type",
      error_description: "Only grant_type=authorization_code or refresh_token is supported",
    });
    return;
  }

  const code = body.code;
  const redirect_uri = body.redirect_uri;
  const client_id = body.client_id;
  const code_verifier = body.code_verifier;

  if (typeof code !== "string" || code.length === 0) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "code is required",
    });
    return;
  }
  if (typeof redirect_uri !== "string" || redirect_uri.length === 0) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "redirect_uri is required",
    });
    return;
  }
  if (typeof client_id !== "string" || client_id.length === 0) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "client_id is required",
    });
    return;
  }
  if (typeof code_verifier !== "string" || code_verifier.length === 0) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "code_verifier is required (PKCE)",
    });
    return;
  }

  const entry = consumeAuthzCode(code); // one-shot — second call returns undefined
  if (!entry) {
    res.status(400).json({
      error: "invalid_grant",
      error_description: "code is invalid, expired, or already used",
    });
    return;
  }

  if (entry.client_id !== client_id) {
    // R3 + E2: pre-shared client_id fallback (LibreChat 패턴)
    // authorize 에서 ephemeral pre-registered (entry.client_id === GOOGLE_OAUTH_CLIENT_ID) 로 통과한 경우,
    // token request 의 client_id 도 GOOGLE_OAUTH_CLIENT_ID 면 동등성 우회. PKCE code_verifier 검증은
    // 아래에서 강제됨 — 인가 코드 탈취 위험 없음.
    const presharedFlag = process.env.OAUTH_PROXY_ALLOW_PRESHARED_CLIENT === "true";
    const googleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const allowPreshared =
      presharedFlag &&
      typeof googleClientId === "string" &&
      googleClientId.length > 0 &&
      entry.client_id === googleClientId &&
      client_id === googleClientId;
    if (!allowPreshared) {
      res.status(400).json({
        error: "invalid_grant",
        error_description: "client_id mismatch",
      });
      return;
    }
  }
  if (entry.client_redirect_uri !== redirect_uri) {
    res.status(400).json({
      error: "invalid_grant",
      error_description: "redirect_uri mismatch",
    });
    return;
  }
  if (!verifyPkceS256(code_verifier, entry.code_challenge)) {
    res.status(400).json({
      error: "invalid_grant",
      error_description: "code_verifier does not match code_challenge",
    });
    return;
  }

  // Passthrough — Google id_token is the access_token. Include refresh_token
  // when present so the client (Claude Desktop / mcp-remote / etc.) can roll
  // the bearer over without re-authentication when the 1h id_token expires.
  res.status(200).json({
    access_token: entry.id_token,
    id_token: entry.id_token,
    ...(entry.refresh_token && { refresh_token: entry.refresh_token }),
    token_type: "Bearer",
    expires_in: entry.expires_in,
    scope: entry.scope,
  });
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface GoogleRefreshResponse {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

/**
 * Handles `grant_type=refresh_token` per RFC 6749 §6.
 *
 * The proxy is a passthrough: client sends Google's refresh_token
 * back to us, we forward to Google's /token endpoint with our own
 * client_id + client_secret (Google requires confidential client for
 * refresh), and return the new id_token (+ rotated refresh_token if
 * Google issues one). PKCE verification is NOT required for refresh
 * grants per RFC — the refresh_token itself is the secret.
 *
 * Body parameters (application/x-www-form-urlencoded or JSON):
 *   grant_type=refresh_token
 *   refresh_token=<opaque>
 *   client_id=<must match the original authorize, soft check>
 *   scope=<optional, narrowing only>
 */
async function handleRefreshToken(
  body: Record<string, unknown>,
  res: Response,
): Promise<void> {
  const refresh_token = body.refresh_token;
  if (typeof refresh_token !== "string" || refresh_token.length === 0) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "refresh_token is required",
    });
    return;
  }

  const googleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!googleClientId || !googleClientSecret) {
    res.status(500).json({
      error: "server_error",
      error_description: "GOOGLE_OAUTH_CLIENT_ID/SECRET not configured",
    });
    return;
  }

  const refreshBody = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token,
    client_id: googleClientId,
    client_secret: googleClientSecret,
  });

  let googleResp: globalThis.Response;
  try {
    googleResp = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: refreshBody.toString(),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown error";
    res.status(502).json({
      error: "token_exchange_failed",
      error_description: `Google token endpoint unreachable: ${detail}`,
    });
    return;
  }

  if (!googleResp.ok) {
    const errText = await googleResp.text().catch(() => "");
    // Google returns 400 invalid_grant when refresh_token is revoked or
    // expired — propagate as invalid_grant so the client knows to restart
    // the full authorize flow rather than retry indefinitely.
    const status = googleResp.status === 400 ? 400 : 502;
    res.status(status).json({
      error: googleResp.status === 400 ? "invalid_grant" : "token_exchange_failed",
      error_description: `Google token endpoint returned ${googleResp.status}: ${errText.slice(0, 200)}`,
    });
    return;
  }

  const tokenJson = (await googleResp.json()) as GoogleRefreshResponse;
  if (!tokenJson.id_token) {
    res.status(502).json({
      error: "invalid_token_response",
      error_description: "Google refresh response missing id_token",
    });
    return;
  }

  res.status(200).json({
    access_token: tokenJson.id_token,
    id_token: tokenJson.id_token,
    // Google may rotate the refresh_token — if so use the new one,
    // otherwise echo back the existing one so the client doesn't
    // think it lost its grant.
    refresh_token: tokenJson.refresh_token ?? refresh_token,
    token_type: "Bearer",
    expires_in: tokenJson.expires_in ?? 3600,
    scope: tokenJson.scope ?? "",
  });
}