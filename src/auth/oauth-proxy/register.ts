import type { Request, Response } from "express";
import { registerClient } from "./state-store.js";

/**
 * RFC 7591 Dynamic Client Registration handler.
 *
 * Request: { redirect_uris: string[], token_endpoint_auth_method?: "none", ... }
 * Response (201): { client_id, client_id_issued_at, redirect_uris, token_endpoint_auth_method: "none" }
 *
 * No client_secret is issued — proxy enforces PKCE (S256), so all clients
 * are public clients per RFC 7636 + RFC 8252.
 */
export function registerHandler(req: Request, res: Response): void {
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

  const { client_id, entry } = registerClient({ redirect_uris });

  res.status(201).json({
    client_id,
    client_id_issued_at: entry.client_id_issued_at,
    redirect_uris: entry.redirect_uris,
    token_endpoint_auth_method: entry.token_endpoint_auth_method,
    grant_types: ["authorization_code"],
    response_types: ["code"],
  });
}