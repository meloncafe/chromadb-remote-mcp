import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { generateKeyPair, SignJWT, exportJWK, type JWK } from "jose";
import { oidcAuthMiddleware } from "../../../src/auth/middleware.js";
import { clearJwksCache } from "../../../src/auth/jwks-cache.js";
import * as oidcVerifier from "../../../src/auth/oidc-verifier.js";

const ISSUER = "https://issuer.example";
const AUDIENCE = "test-audience";

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

interface KeyMaterial {
  privateKey: PrivateKey;
  jwk: JWK;
}

async function setupKey(): Promise<KeyMaterial> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.alg = "RS256";
  jwk.kid = "kid-1";
  jwk.use = "sig";
  return { privateKey, jwk };
}

async function signToken(km: KeyMaterial, iss = ISSUER, aud = AUDIENCE): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "kid-1" })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject("alice@example")
    .setIssuedAt(Math.floor(Date.now() / 1000))
    .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
    .sign(km.privateKey);
}

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  setHeader(name: string, value: string): FakeRes;
  status(code: number): FakeRes;
  json(payload: unknown): FakeRes;
  headersSent: boolean;
  secure: boolean;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    headers: {},
    body: undefined,
    headersSent: false,
    secure: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
  return res;
}

function makeReq(headers: Record<string, string> = {}) {
  return {
    headers: {
      host: "test-host:3000",
      ...headers,
    },
    secure: false,
    user: undefined as { sub: string; provider: "oidc" | "mcp_auth_token" } | undefined,
  };
}

describe("Phase 10: oidcAuthMiddleware (R26, R27, R31)", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalFetch: typeof fetch;
  let km: KeyMaterial;
  let logSpy: jest.SpiedFunction<typeof console.log>;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    originalFetch = global.fetch;
    clearJwksCache();
    km = await setupKey();
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    global.fetch = jest.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/.well-known/openid-configuration")) {
        return new Response(
          JSON.stringify({ issuer: ISSUER, jwks_uri: `${ISSUER}/jwks` }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.endsWith("/jwks")) {
        return new Response(JSON.stringify({ keys: [km.jwk] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    logSpy.mockRestore();
    warnSpy.mockRestore();
    clearJwksCache();
  });

  it("R27: passes when neither OIDC nor MCP_AUTH_TOKEN configured (dev mode)", async () => {
    delete process.env.OIDC_ISSUERS;
    delete process.env.OIDC_PRESET;
    delete process.env.MCP_AUTH_TOKEN;
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await oidcAuthMiddleware(req as never, res as never, next as never);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(warnSpy.mock.calls.some((c) => String(c[0]).match(/dev mode/))).toBe(true);
  });

  it("R27: accepts valid OIDC bearer token", async () => {
    process.env.OIDC_ISSUERS = ISSUER;
    process.env.OIDC_AUDIENCE = AUDIENCE;
    const token = await signToken(km);
    const req = makeReq({ authorization: `Bearer ${token}` });
    const res = makeRes();
    const next = jest.fn();
    await oidcAuthMiddleware(req as never, res as never, next as never);
    expect(next).toHaveBeenCalled();
    expect(req.user?.provider).toBe("oidc");
    expect(req.user?.sub).toBe("alice@example");
  });

  it("R27: accepts MCP_AUTH_TOKEN even when OIDC also configured", async () => {
    process.env.OIDC_ISSUERS = ISSUER;
    process.env.OIDC_AUDIENCE = AUDIENCE;
    process.env.MCP_AUTH_TOKEN = "secret-service-token";
    const req = makeReq({ authorization: "Bearer secret-service-token" });
    const res = makeRes();
    const next = jest.fn();
    await oidcAuthMiddleware(req as never, res as never, next as never);
    expect(next).toHaveBeenCalled();
    expect(req.user?.provider).toBe("mcp_auth_token");
  });

  it("R31: 401 with error=invalid_request when Authorization header missing", async () => {
    process.env.MCP_AUTH_TOKEN = "tok";
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await oidcAuthMiddleware(req as never, res as never, next as never);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    const wwwAuth = res.headers["www-authenticate"] || "";
    expect(wwwAuth).toContain('error="invalid_request"');
    expect(wwwAuth).toContain("resource_metadata=");
  });

  it("R31: 401 with error=invalid_request when scheme is not Bearer", async () => {
    process.env.MCP_AUTH_TOKEN = "tok";
    const req = makeReq({ authorization: "Basic dXNlcjpwYXNz" });
    const res = makeRes();
    const next = jest.fn();
    await oidcAuthMiddleware(req as never, res as never, next as never);
    expect(res.statusCode).toBe(401);
    const wwwAuth = res.headers["www-authenticate"] || "";
    expect(wwwAuth).toContain('error="invalid_request"');
  });

  it("R31: 401 with error=invalid_token when OIDC verification fails", async () => {
    process.env.OIDC_ISSUERS = ISSUER;
    process.env.OIDC_AUDIENCE = AUDIENCE;
    const badToken = await signToken(km, "https://attacker.example");
    const req = makeReq({ authorization: `Bearer ${badToken}` });
    const res = makeRes();
    const next = jest.fn();
    await oidcAuthMiddleware(req as never, res as never, next as never);
    expect(res.statusCode).toBe(401);
    const wwwAuth = res.headers["www-authenticate"] || "";
    expect(wwwAuth).toContain('error="invalid_token"');
    expect(wwwAuth).toContain("resource_metadata=");
  });

  it("R26: logs sub claim as SHA-256 prefix by default", async () => {
    process.env.MCP_AUTH_TOKEN = "tok";
    delete process.env.OIDC_LOG_SUB_MODE;
    const req = makeReq({ authorization: "Bearer tok" });
    const res = makeRes();
    const next = jest.fn();
    await oidcAuthMiddleware(req as never, res as never, next as never);
    const messages = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(messages).toMatch(/\[auth\] ok provider=mcp_auth_token sub=[a-f0-9]{12}\b/);
    expect(messages).not.toContain(" service-account");
  });

  it("R26: logs raw sub when OIDC_LOG_SUB_MODE=full", async () => {
    process.env.OIDC_ISSUERS = ISSUER;
    process.env.OIDC_AUDIENCE = AUDIENCE;
    process.env.OIDC_LOG_SUB_MODE = "full";
    const token = await signToken(km);
    const req = makeReq({ authorization: `Bearer ${token}` });
    const res = makeRes();
    const next = jest.fn();
    await oidcAuthMiddleware(req as never, res as never, next as never);
    const messages = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(messages).toContain("alice@example");
  });

  it("R7: MCP_AUTH_TOKEN path remains valid when OAUTH_PROXY_ENABLED=true", async () => {
    process.env.OAUTH_PROXY_ENABLED = "true";
    process.env.MCP_AUTH_TOKEN = "service-token";

    const req = makeReq({ authorization: "Bearer service-token" });
    const res = makeRes();
    const next = jest.fn();

    await oidcAuthMiddleware(req as never, res as never, next as never);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.provider).toBe("mcp_auth_token");
    expect(req.user?.sub).toBe("service-account");
  });

  it("R8: OAUTH_PROXY_ENABLED unset keeps middleware behaviour byte-identical with v2.0.0", async () => {
    delete process.env.OAUTH_PROXY_ENABLED;
    process.env.MCP_AUTH_TOKEN = "service-token";

    const req = makeReq({ authorization: "Bearer service-token" });
    const res = makeRes();
    const next = jest.fn();

    await oidcAuthMiddleware(req as never, res as never, next as never);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.provider).toBe("mcp_auth_token");
  });

  describe("R4: OIDC_AUDIENCE → GOOGLE_OAUTH_CLIENT_ID fallback (OAuth Proxy mode)", () => {
    let verifySpy: jest.SpiedFunction<typeof oidcVerifier.verifyOidcToken>;

    beforeEach(() => {
      verifySpy = jest.spyOn(oidcVerifier, "verifyOidcToken").mockResolvedValue({
        ok: true,
        payload: { sub: "alice@example", iss: ISSUER, aud: "test-google-client" },
      } as unknown as Awaited<ReturnType<typeof oidcVerifier.verifyOidcToken>>);
    });

    afterEach(() => {
      verifySpy.mockRestore();
    });

    it("R4 (a): OIDC_AUDIENCE 미설정 + OAUTH_PROXY_ENABLED=true + GOOGLE_OAUTH_CLIENT_ID=xyz → audience === 'xyz'", async () => {
      delete process.env.OIDC_AUDIENCE;
      process.env.OAUTH_PROXY_ENABLED = "true";
      process.env.GOOGLE_OAUTH_CLIENT_ID = "xyz";
      process.env.OIDC_ISSUERS = ISSUER;

      const req = makeReq({ authorization: "Bearer fake-token-a" });
      const res = makeRes();
      const next = jest.fn();
      await oidcAuthMiddleware(req as never, res as never, next as never);

      expect(verifySpy).toHaveBeenCalledTimes(1);
      const callArgs = verifySpy.mock.calls[0];
      // verifyOidcToken(token, issuers, audience)
      expect(callArgs[2]).toBe("xyz");
    });

    it("R4 (b): OIDC_AUDIENCE=abc + GOOGLE_OAUTH_CLIENT_ID=xyz → audience === 'abc' (env 우선)", async () => {
      process.env.OIDC_AUDIENCE = "abc";
      process.env.OAUTH_PROXY_ENABLED = "true";
      process.env.GOOGLE_OAUTH_CLIENT_ID = "xyz";
      process.env.OIDC_ISSUERS = ISSUER;

      const req = makeReq({ authorization: "Bearer fake-token-b" });
      const res = makeRes();
      const next = jest.fn();
      await oidcAuthMiddleware(req as never, res as never, next as never);

      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(verifySpy.mock.calls[0][2]).toBe("abc");
    });

    it("R4 (c): OAUTH_PROXY_ENABLED 미설정 + OIDC_AUDIENCE 미설정 → audience === undefined", async () => {
      delete process.env.OIDC_AUDIENCE;
      delete process.env.OAUTH_PROXY_ENABLED;
      process.env.GOOGLE_OAUTH_CLIENT_ID = "xyz"; // 설정해도 OAUTH_PROXY_ENABLED off 이므로 무시
      process.env.OIDC_ISSUERS = ISSUER;

      const req = makeReq({ authorization: "Bearer fake-token-c" });
      const res = makeRes();
      const next = jest.fn();
      await oidcAuthMiddleware(req as never, res as never, next as never);

      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(verifySpy.mock.calls[0][2]).toBeUndefined();
    });
  });
});