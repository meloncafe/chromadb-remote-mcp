import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import express from "express";
import type { AddressInfo } from "net";
import { protectedResourceHandler } from "../../../src/auth/protected-resource.js";

describe("Phase 10: GET /.well-known/oauth-protected-resource (R29, R38)", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let server: import("http").Server;
  let baseUrl: string;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    const app = express();
    app.get("/.well-known/oauth-protected-resource", protectedResourceHandler);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns 200 with required RFC 9728 fields", async () => {
    process.env.OIDC_ISSUERS = "https://issuer.example";
    process.env.OIDC_SCOPES = "read,write";
    const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json).toMatchObject({
      authorization_servers: ["https://issuer.example"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["read", "write"],
    });
    expect(typeof json.resource).toBe("string");
    expect(json.resource).toMatch(/^http/);
  });

  it("expands OIDC_PRESET when OIDC_ISSUERS not set", async () => {
    delete process.env.OIDC_ISSUERS;
    process.env.OIDC_PRESET = "google";
    const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.authorization_servers).toEqual(["https://accounts.google.com"]);
  });
});