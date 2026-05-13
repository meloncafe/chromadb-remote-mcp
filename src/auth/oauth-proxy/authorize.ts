import type { Request, Response } from "express";
import { getClient, putAuthzState } from "./state-store.js";
import { resolveOAuthBaseUrl } from "./metadata.js";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";

function getGoogleScopes(): string {
  const raw = process.env.OAUTH_PROXY_GOOGLE_SCOPES;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  return "openid email profile";
}

/**
 * GET /oauth/authorize
 *
 * Validates the client's authorization request (PKCE required, S256 only),
 * persists state in the in-memory store, then 302s to Google's authorize
 * endpoint with our own client_id + redirect_uri. The Google login screen
 * is what the end user sees.
 */
export function authorizeHandler(req: Request, res: Response): void {
  const q = req.query as Record<string, string | undefined>;

  const response_type = q.response_type;
  const client_id = q.client_id;
  const redirect_uri = q.redirect_uri;
  const scope = q.scope ?? "";
  const state = q.state;
  const code_challenge = q.code_challenge;
  const code_challenge_method = q.code_challenge_method;

  if (response_type !== "code") {
    res.status(400).json({
      error: "unsupported_response_type",
      error_description: "Only response_type=code is supported",
    });
    return;
  }
  if (!client_id) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "client_id is required",
    });
    return;
  }
  if (!redirect_uri) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "redirect_uri is required",
    });
    return;
  }
  if (!code_challenge) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "code_challenge is required (PKCE)",
    });
    return;
  }
  if (code_challenge_method !== "S256") {
    res.status(400).json({
      error: "invalid_request",
      error_description: "code_challenge_method must be S256",
    });
    return;
  }

  const client = getClient(client_id);
  if (!client) {
    res.status(400).json({
      error: "invalid_client",
      error_description: "client_id not found or expired",
    });
    return;
  }
  if (!client.redirect_uris.includes(redirect_uri)) {
    res.status(400).json({
      error: "invalid_redirect_uri",
      error_description: "redirect_uri does not match registered redirect_uris",
    });
    return;
  }

  const proxy_state = putAuthzState({
    client_id,
    client_redirect_uri: redirect_uri,
    client_state: state,
    code_challenge,
    code_challenge_method: "S256",
    scope,
  });

  const googleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!googleClientId) {
    res.status(500).json({
      error: "server_error",
      error_description: "GOOGLE_OAUTH_CLIENT_ID not configured",
    });
    return;
  }

  const selfBase = resolveOAuthBaseUrl(req);
  const callbackUrl = `${selfBase}/oauth/callback`;

  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: getGoogleScopes(),
    state: proxy_state,
    access_type: "online",
    prompt: "select_account",
  });

  res.redirect(302, `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`);
}