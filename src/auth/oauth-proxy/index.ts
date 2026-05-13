import express, { Router } from "express";
import { registerHandler } from "./register.js";
import { authorizeHandler } from "./authorize.js";
import { callbackHandler } from "./callback.js";
import { tokenHandler } from "./token.js";
import { authServerMetadataHandler } from "./metadata.js";

/**
 * Builds the Express Router that exposes the OAuth 2.1 Authorization Server
 * surface of the MCP server (DCR proxy for Google).
 *
 * Mount points (relative to the app root):
 *   GET  /.well-known/oauth-authorization-server  → metadata (RFC 8414)
 *   POST /oauth/register                          → DCR (RFC 7591)
 *   GET  /oauth/authorize                         → 302 to Google
 *   GET  /oauth/callback                          → Google → code exchange → 302 to client
 *   POST /oauth/token                             → PKCE verify + Google id_token passthrough
 *
 * The Router itself does NOT mount global middleware (limiter, origin check,
 * etc.) — those are applied by the parent app in src/index.ts so the same
 * middleware ordering applies as for /mcp.
 */
export function createOAuthProxyRouter(): Router {
  const router = Router();

  // JSON body parser for /oauth/register (RFC 7591 content type).
  // urlencoded body parser for /oauth/token (RFC 6749 §4.1.3).
  router.use("/oauth/register", express.json({ limit: "16kb" }));
  router.use("/oauth/token", express.urlencoded({ extended: false, limit: "16kb" }));

  // Metadata endpoint — RFC 8414. Public, no body parsing needed.
  router.get("/.well-known/oauth-authorization-server", authServerMetadataHandler);

  // DCR — RFC 7591. JSON body in, JSON body out.
  router.post("/oauth/register", registerHandler);

  // Authorize — 302 to Google.
  router.get("/oauth/authorize", authorizeHandler);

  // Callback from Google — 302 to client.
  router.get("/oauth/callback", callbackHandler);

  // Token exchange — form-urlencoded body in, JSON body out.
  router.post("/oauth/token", tokenHandler);

  return router;
}