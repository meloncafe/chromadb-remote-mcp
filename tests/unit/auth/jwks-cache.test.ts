import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { SignJWT, generateKeyPair } from "jose";
import {
  getJwksForIssuer,
  clearJwksCache,
  getCachedJwksUri,
} from "../../../src/auth/jwks-cache.js";
import { oidcAuthMiddleware } from "../../../src/auth/middleware.js";

interface FetchCall {
  url: string;
}

describe("Phase 10: JWKS cache (R23)", () => {
  let originalFetch: typeof fetch;
  let calls: FetchCall[];

  beforeEach(() => {
    originalFetch = global.fetch;
    calls = [];
    clearJwksCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearJwksCache();
  });

  function installFetch(jwksUri: string) {
    global.fetch = jest.fn(async (url: unknown) => {
      const u = String(url);
      calls.push({ url: u });
      if (u.endsWith("/.well-known/openid-configuration")) {
        return new Response(
          JSON.stringify({ issuer: "https://issuer.example", jwks_uri: jwksUri }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ keys: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
  }

  it("caches discovery — second call within TTL hits cache", async () => {
    installFetch("https://issuer.example/jwks");
    await getJwksForIssuer("https://issuer.example");
    await getJwksForIssuer("https://issuer.example");
    const discoveryCalls = calls.filter((c) =>
      c.url.endsWith("/.well-known/openid-configuration"),
    );
    expect(discoveryCalls).toHaveLength(1);
    expect(getCachedJwksUri("https://issuer.example")).toBe("https://issuer.example/jwks");
  });

  it("throws clearly when discovery returns HTTP error", async () => {
    global.fetch = jest.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(getJwksForIssuer("https://issuer.example")).rejects.toThrow(/HTTP 404/);
  });

  it("throws when jwks_uri missing in discovery", async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ issuer: "https://issuer.example" }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(getJwksForIssuer("https://issuer.example")).rejects.toThrow(/jwks_uri missing/);
  });

  it("re-fetches discovery after TTL expiry (>3600s)", async () => {
    jest.useFakeTimers();
    try {
      installFetch("https://issuer.example/jwks");
      await getJwksForIssuer("https://issuer.example");
      const before = calls.filter((c) => c.url.endsWith("/.well-known/openid-configuration")).length;
      expect(before).toBe(1);

      jest.advanceTimersByTime(3601 * 1000);

      await getJwksForIssuer("https://issuer.example");
      const after = calls.filter((c) => c.url.endsWith("/.well-known/openid-configuration")).length;
      expect(after).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("propagates JWKS 500 as throw (caller surfaces as 401 invalid_token)", async () => {
    global.fetch = jest.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/.well-known/openid-configuration")) {
        return new Response("server error", { status: 500 });
      }
      return new Response("", { status: 500 });
    }) as unknown as typeof fetch;
    await expect(getJwksForIssuer("https://issuer.example")).rejects.toThrow(/HTTP 500/);
  });

  it("middleware: JWKS 500 → 401 with error=\"invalid_token\"", async () => {
    const originalEnv = { ...process.env };
    process.env.OIDC_ISSUERS = "https://issuer.example";
    process.env.OIDC_AUDIENCE = "aud";
    delete process.env.MCP_AUTH_TOKEN;

    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "kid-1" })
      .setIssuer("https://issuer.example")
      .setAudience("aud")
      .setSubject("u")
      .setIssuedAt(Math.floor(Date.now() / 1000))
      .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
      .sign(privateKey);

    global.fetch = jest.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/.well-known/openid-configuration")) {
        return new Response("server error", { status: 500 });
      }
      return new Response("", { status: 500 });
    }) as unknown as typeof fetch;

    const req = {
      headers: { host: "test-host:3000", authorization: `Bearer ${token}` },
      secure: false,
    };
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 200,
      headers,
      headersSent: false,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
        return this;
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json() {
        this.headersSent = true;
        return this;
      },
    };
    const next = jest.fn();

    await oidcAuthMiddleware(req as never, res as never, next as never);

    expect(res.statusCode).toBe(401);
    const wwwAuth = headers["www-authenticate"] || "";
    expect(wwwAuth).toContain('error="invalid_token"');
    expect(next).not.toHaveBeenCalled();

    process.env = originalEnv;
  });
});