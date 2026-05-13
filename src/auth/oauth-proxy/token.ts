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
export function tokenHandler(req: Request, res: Response): void {
  // Express's body-parser populates req.body for both JSON and urlencoded
  // depending on which middleware is mounted. Accept whichever shape is present.
  const body = (req.body ?? {}) as Record<string, unknown>;

  const grant_type = body.grant_type;
  const code = body.code;
  const redirect_uri = body.redirect_uri;
  const client_id = body.client_id;
  const code_verifier = body.code_verifier;

  if (grant_type !== "authorization_code") {
    res.status(400).json({
      error: "unsupported_grant_type",
      error_description: "Only grant_type=authorization_code is supported",
    });
    return;
  }
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
    res.status(400).json({
      error: "invalid_grant",
      error_description: "client_id mismatch",
    });
    return;
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

  // Passthrough — Google id_token is the access_token.
  res.status(200).json({
    access_token: entry.id_token,
    id_token: entry.id_token,
    token_type: "Bearer",
    expires_in: entry.expires_in,
    scope: entry.scope,
  });
}