import type { Request, Response } from "express";
import { consumeAuthzState, putAuthzCode } from "./state-store.js";
import { resolveOAuthBaseUrl } from "./metadata.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

/**
 * GET /oauth/callback
 *
 * Google redirects here after the user authenticates. We:
 *   1. consume the state we put in authorize.ts (one-shot)
 *   2. exchange the Google code for an id_token via Google's token endpoint
 *   3. mint our own proxy code, store the id_token + PKCE challenge
 *   4. 302 the user agent back to the MCP client's redirect_uri with our code
 */
export async function callbackHandler(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string | undefined>;
  const google_code = q.code;
  const proxy_state = q.state;

  if (q.error) {
    res.status(400).json({
      error: q.error,
      error_description: q.error_description ?? "Google authorize returned an error",
    });
    return;
  }

  if (!google_code) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "code is required",
    });
    return;
  }
  if (!proxy_state) {
    res.status(400).json({
      error: "invalid_state",
      error_description: "state is required",
    });
    return;
  }

  const stateEntry = consumeAuthzState(proxy_state);
  if (!stateEntry) {
    res.status(400).json({
      error: "invalid_state",
      error_description: "state not found or expired",
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

  const selfBase = resolveOAuthBaseUrl(req);
  const callbackUrl = `${selfBase}/oauth/callback`;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: google_code,
    client_id: googleClientId,
    client_secret: googleClientSecret,
    redirect_uri: callbackUrl,
  });

  let googleResp: globalThis.Response;
  try {
    googleResp = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
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
    res.status(502).json({
      error: "token_exchange_failed",
      error_description: `Google token endpoint returned ${googleResp.status}: ${errText.slice(0, 200)}`,
    });
    return;
  }

  const tokenJson = (await googleResp.json()) as GoogleTokenResponse;
  if (!tokenJson.id_token) {
    res.status(502).json({
      error: "invalid_token_response",
      error_description: "Google response missing id_token",
    });
    return;
  }

  const proxy_code = putAuthzCode({
    client_id: stateEntry.client_id,
    client_redirect_uri: stateEntry.client_redirect_uri,
    code_challenge: stateEntry.code_challenge,
    code_challenge_method: "S256",
    id_token: tokenJson.id_token,
    scope: tokenJson.scope ?? stateEntry.scope,
    expires_in: tokenJson.expires_in ?? 3600,
  });

  const redirectParams = new URLSearchParams({ code: proxy_code });
  if (stateEntry.client_state) {
    redirectParams.set("state", stateEntry.client_state);
  }

  res.redirect(
    302,
    `${stateEntry.client_redirect_uri}?${redirectParams.toString()}`,
  );
}