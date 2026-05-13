import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { Server } from "http";
import type { AddressInfo } from "net";

describe("OAuth Proxy disabled (R8) — endpoints return 404 and protected-resource is byte-identical to v2.0.0", () => {
  let server: Server;
  let baseUrl: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    // Ensure proxy stays off
    delete process.env.OAUTH_PROXY_ENABLED;
    // Minimal OIDC config so protected-resource emits the v2.0.0 issuer
    process.env.OIDC_PRESET = "google";
    // Ensure ChromaDB connection does not fail on import
    process.env.CHROMA_HOST = "localhost";
    process.env.CHROMA_PORT = "8000";

    // Import after env mutation so config helpers read the right values.
    const mod = await import("../../src/index.js");
    await new Promise<void>((resolve) => {
      server = mod.app.listen(0, () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    process.env = originalEnv;
  });

  it("(1) GET /.well-known/oauth-protected-resource keeps v2.0.0 shape", async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resource: string;
      authorization_servers: string[];
      bearer_methods_supported: string[];
      scopes_supported: string[];
    };
    expect(body.authorization_servers).toEqual(["https://accounts.google.com"]);
    expect(body.bearer_methods_supported).toEqual(["header"]);
    expect(Array.isArray(body.scopes_supported)).toBe(true);
  });

  it("(2) GET /.well-known/oauth-authorization-server returns 404", async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(404);
  });

  it("(3) POST /oauth/register returns 404", async () => {
    const res = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://localhost/cb"] }),
    });
    expect(res.status).toBe(404);
  });

  it("(4) GET /oauth/authorize returns 404", async () => {
    const res = await fetch(`${baseUrl}/oauth/authorize?response_type=code`);
    expect(res.status).toBe(404);
  });

  it("(5) GET /oauth/callback returns 404", async () => {
    const res = await fetch(`${baseUrl}/oauth/callback?code=x&state=y`);
    expect(res.status).toBe(404);
  });

  it("(6) POST /oauth/token returns 404", async () => {
    const res = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=authorization_code&code=x",
    });
    expect(res.status).toBe(404);
  });
});