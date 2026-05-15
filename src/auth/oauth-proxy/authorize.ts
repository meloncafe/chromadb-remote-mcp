import type { Request, Response } from "express";
import { getClient, putAuthzState } from "./state-store.js";
import { resolveOAuthBaseUrl } from "./metadata.js";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * Returns the scope string sent to Google's authorize endpoint.
 *
 * Always includes Google's `openid email profile` baseline plus any
 * extra scopes from OAUTH_PROXY_GOOGLE_SCOPES. v2.2.1 also requests
 * the OIDC `offline_access` scope so that Google issues a refresh_token
 * on first consent — without it, the access_type=offline parameter
 * alone is not sufficient on returning sessions and the user has to
 * re-authenticate every hour when the id_token expires.
 */
function getGoogleScopes(): string {
  const raw = process.env.OAUTH_PROXY_GOOGLE_SCOPES;
  const base = (typeof raw === "string" && raw.trim().length > 0)
    ? raw.trim()
    : "openid email profile";
  // Idempotent join: append "offline_access" only if absent.
  const tokens = new Set(base.split(/\s+/).filter(Boolean));
  tokens.add("offline_access");
  return Array.from(tokens).join(" ");
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

  // R3 + E2: pre-shared client_id fallback (LibreChat 패턴)
  // OAUTH_PROXY_ALLOW_PRESHARED_CLIENT=true + client_id === GOOGLE_OAUTH_CLIENT_ID 일 때
  // ephemeral pre-registered client 로 간주. PKCE (code_challenge=S256) 는 위에서 이미 강제됐으므로
  // 인가 코드 탈취 위험 없음. redirect_uri 는 client 가 보낸 값을 신뢰 (allowlist 없음).
  const presharedFlag = process.env.OAUTH_PROXY_ALLOW_PRESHARED_CLIENT === "true";
  const googleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const allowPreshared =
    !client &&
    presharedFlag &&
    typeof googleClientId === "string" &&
    googleClientId.length > 0 &&
    client_id === googleClientId;

  if (!client && !allowPreshared) {
    res.status(400).json({
      error: "invalid_client",
      error_description: "client_id not found or expired",
    });
    return;
  }
  if (client && !client.redirect_uris.includes(redirect_uri)) {
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
    // v2.2.1: request long-lived refresh_token. Combined with
    // offline_access scope above, Google returns refresh_token
    // on the FIRST consent. Subsequent visits reuse it silently.
    access_type: "offline",
    // `consent` forces the consent screen on every authorize call,
    // which is required by Google to (re-)issue a refresh_token if
    // the user has previously authorized this app on a different
    // device or with different scopes. Without it, returning users
    // get a code that exchanges for an id_token but no refresh_token.
    prompt: "consent",
  });

  res.redirect(302, `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`);
}