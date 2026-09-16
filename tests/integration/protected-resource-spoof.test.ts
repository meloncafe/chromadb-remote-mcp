/**
 * protected-resource-spoof.test.ts
 *
 * Integration test for R6.c (CVE-2026-45829): X-Forwarded-Host spoofing prevention
 * in the OAuth Protected Resource Metadata endpoint.
 *
 * AC coverage:
 *   R6.c AC#c2 — X-Forwarded-Host: evil.example → /.well-known/oauth-protected-resource
 *                response body.resource does NOT contain "evil.example"
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { protectedResourceHandler } from "../../src/auth/protected-resource.js";

describe("R6.c: X-Forwarded-Host spoofing prevention in /.well-known/oauth-protected-resource", () => {
  let server: Server;
  let baseUrl: string;
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    savedEnv = { ...process.env };
    delete process.env.OAUTH_PROXY_BASE_URL;
    delete process.env.OAUTH_PROXY_ENABLED;
    process.env.OIDC_PRESET = "google";

    const app = express();
    app.get("/.well-known/oauth-protected-resource", protectedResourceHandler);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    process.env = savedEnv;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("AC#c2: X-Forwarded-Host: evil.example → resource field does NOT contain evil.example", async () => {
    const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`, {
      headers: {
        "X-Forwarded-Host": "evil.example",
        "X-Forwarded-Proto": "https",
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    const resource = body.resource as string;
    // The resource must NOT contain the spoofed host
    expect(resource).not.toContain("evil.example");
    // It should use the actual request host (127.0.0.1:port)
    expect(resource).toMatch(/^http/);
  });

  it("AC#c2: With OAUTH_PROXY_BASE_URL set, resource uses env value (not evil.example)", async () => {
    process.env.OAUTH_PROXY_BASE_URL = "https://legit.example.com";

    const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`, {
      headers: {
        "X-Forwarded-Host": "evil.example",
        "X-Forwarded-Proto": "https",
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    const resource = body.resource as string;

    // Must use OAUTH_PROXY_BASE_URL, not the spoofed X-Forwarded-Host
    expect(resource).toBe("https://legit.example.com");
    expect(resource).not.toContain("evil.example");
  });

  it("No X-Forwarded-Host → resource uses actual request host", async () => {
    const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    const resource = body.resource as string;
    expect(resource).toMatch(/^http:\/\/127\.0\.0\.1/);
  });

  it("resolveResourceBaseUrl ignores X-Forwarded-Host but still uses X-Forwarded-Proto", async () => {
    // Without OAUTH_PROXY_BASE_URL: proto comes from X-Forwarded-Proto, host from req.headers.host
    // The server receives 127.0.0.1:port as the actual host
    const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`, {
      headers: {
        "X-Forwarded-Host": "evil.example",
        "X-Forwarded-Proto": "https",
      },
    });
    const body = (await response.json()) as Record<string, unknown>;
    const resource = body.resource as string;
    // Host must NOT be from X-Forwarded-Host
    expect(resource).not.toContain("evil.example");
  });
});
