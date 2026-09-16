import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import type { Request, Response } from "express";
import { authorizeHandler } from "../../../../src/auth/oauth-proxy/authorize.js";
import { registerClient, _resetForTests } from "../../../../src/auth/oauth-proxy/state-store.js";

function mockReq(query: Record<string, string>, headers: Record<string, string> = {}): Request {
  return {
    query,
    headers: { host: "mcp.example.com", "x-forwarded-proto": "https", ...headers },
    secure: false,
  } as unknown as Request;
}

function mockRes() {
  const res = {} as Partial<Response> & {
    statusCode?: number;
    body?: unknown;
    redirectLocation?: string;
  };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  }) as unknown as Response["status"];
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res as Response;
  }) as unknown as Response["json"];
  res.redirect = jest.fn((statusOrUrl: number | string, urlMaybe?: string) => {
    if (typeof statusOrUrl === "number") {
      res.statusCode = statusOrUrl;
      res.redirectLocation = urlMaybe;
    } else {
      res.statusCode = 302;
      res.redirectLocation = statusOrUrl;
    }
    return res as Response;
  }) as unknown as Response["redirect"];
  return res as Response & {
    statusCode?: number;
    body?: unknown;
    redirectLocation?: string;
  };
}

describe("oauth-proxy: GET /oauth/authorize (R4, E4, R5)", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-google-client";
    _resetForTests();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function seedClient(): string {
    const { client_id } = registerClient({ redirect_uris: ["http://localhost/cb"] });
    return client_id;
  }

  function validQuery(client_id: string): Record<string, string> {
    return {
      response_type: "code",
      client_id,
      redirect_uri: "http://localhost/cb",
      scope: "openid",
      state: "c-state",
      code_challenge: "ch-123",
      code_challenge_method: "S256",
    };
  }

  it("E4: default scope is 'openid email profile' when OAUTH_PROXY_GOOGLE_SCOPES unset", () => {
    delete process.env.OAUTH_PROXY_GOOGLE_SCOPES;
    const client_id = seedClient();
    const req = mockReq(validQuery(client_id));
    const res = mockRes();
    authorizeHandler(req, res);

    expect(res.statusCode).toBe(302);
    const loc = new URL(res.redirectLocation as string);
    // v2.2.3: offline_access NOT appended — Google rejects it with invalid_scope.
    // refresh_token is obtained via access_type=offline + prompt=consent instead.
    expect(loc.searchParams.get("scope")).toBe("openid email profile");
  });

  it("E4: OAUTH_PROXY_GOOGLE_SCOPES override applied", () => {
    process.env.OAUTH_PROXY_GOOGLE_SCOPES = "openid email";
    const client_id = seedClient();
    const req = mockReq(validQuery(client_id));
    const res = mockRes();
    authorizeHandler(req, res);

    expect(res.statusCode).toBe(302);
    const loc = new URL(res.redirectLocation as string);
    expect(loc.searchParams.get("scope")).toBe("openid email");
  });

  it("v2.2.3: scope must NOT contain offline_access (Google rejects with invalid_scope)", () => {
    delete process.env.OAUTH_PROXY_GOOGLE_SCOPES;
    const client_id = seedClient();
    const req = mockReq(validQuery(client_id));
    const res = mockRes();
    authorizeHandler(req, res);

    expect(res.statusCode).toBe(302);
    const loc = new URL(res.redirectLocation as string);
    const scope = loc.searchParams.get("scope") ?? "";
    expect(scope.split(/\s+/)).not.toContain("offline_access");
  });

  it("v2.2.1: access_type=offline + prompt=consent for refresh_token issuance", () => {
    delete process.env.OAUTH_PROXY_GOOGLE_SCOPES;
    const client_id = seedClient();
    const req = mockReq(validQuery(client_id));
    const res = mockRes();
    authorizeHandler(req, res);

    expect(res.statusCode).toBe(302);
    const loc = new URL(res.redirectLocation as string);
    expect(loc.searchParams.get("access_type")).toBe("offline");
    expect(loc.searchParams.get("prompt")).toBe("consent");
  });

  it("R4: 302 to accounts.google.com with our GOOGLE_OAUTH_CLIENT_ID", () => {
    delete process.env.OAUTH_PROXY_GOOGLE_SCOPES;
    const client_id = seedClient();
    const req = mockReq(validQuery(client_id));
    const res = mockRes();
    authorizeHandler(req, res);

    const loc = new URL(res.redirectLocation as string);
    expect(`${loc.protocol}//${loc.host}${loc.pathname}`).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(loc.searchParams.get("client_id")).toBe("test-google-client");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://mcp.example.com/oauth/callback");
    expect(loc.searchParams.get("response_type")).toBe("code");
    expect(loc.searchParams.get("state")?.length ?? 0).toBeGreaterThan(0);
  });

  it("R5: missing code_challenge → 400 invalid_request", () => {
    const client_id = seedClient();
    const q = validQuery(client_id);
    delete q.code_challenge;
    const req = mockReq(q);
    const res = mockRes();
    authorizeHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_request");
  });

  it("R5: code_challenge_method !== 'S256' → 400 invalid_request", () => {
    const client_id = seedClient();
    const q = { ...validQuery(client_id), code_challenge_method: "plain" };
    const req = mockReq(q);
    const res = mockRes();
    authorizeHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_request");
  });

  it("invalid_client: client_id not registered", () => {
    const req = mockReq(validQuery("not-registered"));
    const res = mockRes();
    authorizeHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_client");
  });

  it("invalid_redirect_uri: not in client's registered list", () => {
    const client_id = seedClient();
    const q = { ...validQuery(client_id), redirect_uri: "http://evil/cb" };
    const req = mockReq(q);
    const res = mockRes();
    authorizeHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_redirect_uri");
  });

  it("unsupported_response_type when response_type != code", () => {
    const client_id = seedClient();
    const q = { ...validQuery(client_id), response_type: "token" };
    const req = mockReq(q);
    const res = mockRes();
    authorizeHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("unsupported_response_type");
  });

  // R3 + E2: pre-shared client_id fallback (LibreChat 패턴) 케이스
  describe("R3 + E2: pre-shared client_id fallback", () => {
    it("flag on + client_id === GOOGLE_OAUTH_CLIENT_ID + PKCE valid → 302 to Google", () => {
      process.env.OAUTH_PROXY_ALLOW_PRESHARED_CLIENT = "true";
      const presharedClientId = "test-google-client"; // = GOOGLE_OAUTH_CLIENT_ID
      const q = {
        response_type: "code",
        client_id: presharedClientId,
        redirect_uri: "http://localhost/cb",
        scope: "openid",
        state: "c-state",
        code_challenge: "preshared-ch-123",
        code_challenge_method: "S256",
      };
      const req = mockReq(q);
      const res = mockRes();
      authorizeHandler(req, res);
      expect(res.statusCode).toBe(302);
      expect(res.redirectLocation).toBeDefined();
      expect(res.redirectLocation as string).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    });

    it("flag off + pre-shared client_id → 400 invalid_client (no fallback)", () => {
      delete process.env.OAUTH_PROXY_ALLOW_PRESHARED_CLIENT;
      const presharedClientId = "test-google-client";
      const q = {
        response_type: "code",
        client_id: presharedClientId,
        redirect_uri: "http://localhost/cb",
        scope: "openid",
        state: "c-state",
        code_challenge: "preshared-ch-123",
        code_challenge_method: "S256",
      };
      const req = mockReq(q);
      const res = mockRes();
      authorizeHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect((res.body as Record<string, unknown>).error).toBe("invalid_client");
    });

    it("flag on + pre-shared client_id but PKCE missing → 400 invalid_request (PKCE never bypassed)", () => {
      process.env.OAUTH_PROXY_ALLOW_PRESHARED_CLIENT = "true";
      const presharedClientId = "test-google-client";
      const q = {
        response_type: "code",
        client_id: presharedClientId,
        redirect_uri: "http://localhost/cb",
        scope: "openid",
        state: "c-state",
        // code_challenge 누락
        code_challenge_method: "S256",
      };
      const req = mockReq(q);
      const res = mockRes();
      authorizeHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect((res.body as Record<string, unknown>).error).toBe("invalid_request");
    });
  });
});