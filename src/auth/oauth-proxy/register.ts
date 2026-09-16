import type { Request, Response } from "express";
import { registerClient } from "./state-store.js";

/**
 * Parses the OAUTH_PROXY_REDIRECT_URI_ALLOWLIST environment variable.
 * Returns null if unset/empty (treated as "no allowlist configured").
 * Returns a Set<string> of exact-match URIs when configured.
 *
 * E3 / R6.d (CVE-2026-45829): operator-controlled allowlist prevents
 * malicious clients from registering arbitrary redirect_uris via DCR.
 */
function parseRedirectUriAllowlist(): Set<string> | null {
  const raw = process.env.OAUTH_PROXY_REDIRECT_URI_ALLOWLIST;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  const entries = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (entries.length === 0) {
    return null;
  }
  return new Set(entries);
}

/**
 * RFC 7591 Dynamic Client Registration handler.
 *
 * Request: { redirect_uris: string[], token_endpoint_auth_method?: "none", ... }
 * Response (201): { client_id, client_id_issued_at, redirect_uris, token_endpoint_auth_method: "none" }
 *
 * No client_secret is issued — proxy enforces PKCE (S256), so all clients
 * are public clients per RFC 7636 + RFC 8252.
 *
 * E3 / R6.d (CVE-2026-45829): redirect_uris are validated against the
 * OAUTH_PROXY_REDIRECT_URI_ALLOWLIST env (comma-separated exact-match URIs).
 * If the allowlist is not configured and OAUTH_PROXY_ENABLED=true, all DCR
 * requests are rejected with status 400. Non-matching URIs → 400 invalid_redirect_uri.
 */
export function registerHandler(req: Request, res: Response): void {
  // R6.d / E3: enforce operator allowlist before any other validation.
  const allowlist = parseRedirectUriAllowlist();
  if (allowlist === null) {
    // Allowlist not configured — reject all DCR requests.
    res.status(400).json({
      error: "invalid_redirect_uri",
      error_description:
        "DCR is disabled: OAUTH_PROXY_REDIRECT_URI_ALLOWLIST is not configured. " +
        "Set it to a comma-separated list of allowed redirect URIs.",
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const redirect_uris_raw = body.redirect_uris;

  if (!Array.isArray(redirect_uris_raw) || redirect_uris_raw.length === 0) {
    res.status(400).json({
      error: "invalid_redirect_uri",
      error_description: "redirect_uris must be a non-empty array of strings",
    });
    return;
  }

  // Validate every entry is a string and looks like a URL (no whitespace,
  // http/https scheme). This is a soft check — full URL validation would
  // need to handle private-use schemes for native apps. We allow any scheme
  // except whitespace-only or empty strings, since MCP clients may use
  // custom callback schemes (e.g. "claude-desktop://").
  const redirect_uris: string[] = [];
  for (const item of redirect_uris_raw) {
    if (typeof item !== "string" || item.trim().length === 0) {
      res.status(400).json({
        error: "invalid_redirect_uri",
        error_description: "redirect_uris entries must be non-empty strings",
      });
      return;
    }
    redirect_uris.push(item.trim());
  }

  // R6.d / E3: exact-match every redirect_uri against the operator allowlist.
  for (const uri of redirect_uris) {
    if (!allowlist.has(uri)) {
      res.status(400).json({
        error: "invalid_redirect_uri",
        error_description: `redirect_uri "${uri}" is not in the allowed list`,
      });
      return;
    }
  }

  const { client_id, entry } = registerClient({ redirect_uris });

  res.status(201).json({
    client_id,
    client_id_issued_at: entry.client_id_issued_at,
    redirect_uris: entry.redirect_uris,
    token_endpoint_auth_method: entry.token_endpoint_auth_method,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  });
}