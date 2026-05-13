import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import type { Request, Response } from "express";
import { callbackHandler } from "../../../../src/auth/oauth-proxy/callback.js";
import {
  registerClient,
  putAuthzState,
  consumeAuthzState,
  _resetForTests,
} from "../../../../src/auth/oauth-proxy/state-store.js";

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

describe("oauth-proxy: GET /oauth/callback (R3, R4)", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-google-client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-google-secret";
    _resetForTests();
    fetchMock = jest.spyOn(global, "fetch") as unknown as jest.SpiedFunction<typeof fetch>;
  });

  afterEach(() => {
    process.env = originalEnv;
    fetchMock.mockRestore();
  });

  function seedClientAndState(): { client_id: string; proxy_state: string; client_redirect_uri: string } {
    const client_redirect_uri = "http://localhost:9999/cb";
    const { client_id } = registerClient({ redirect_uris: [client_redirect_uri] });
    const proxy_state = putAuthzState({
      client_id,
      client_redirect_uri,
      client_state: "orig-state-123",
      code_challenge: "dummy-challenge",
      code_challenge_method: "S256",
      scope: "openid email",
    });
    return { client_id, proxy_state, client_redirect_uri };
  }

  it("R3: posts form-urlencoded body with 5 fields to Google /token", async () => {
    const { proxy_state } = seedClientAndState();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "google-access",
        id_token: "google-id-token",
        expires_in: 3600,
        scope: "openid email profile",
        token_type: "Bearer",
      }),
      text: async () => "",
    } as unknown as globalThis.Response);

    const req = mockReq({ code: "google-auth-code", state: proxy_state });
    const res = mockRes();
    await callbackHandler(req, res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const params = new URLSearchParams(init.body as string);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("google-auth-code");
    expect(params.get("client_id")).toBe("test-google-client");
    expect(params.get("client_secret")).toBe("test-google-secret");
    expect(params.get("redirect_uri")).toBe("https://mcp.example.com/oauth/callback");
  });

  it("R4: 302 to client redirect_uri with proxy_code + original state", async () => {
    const { proxy_state, client_redirect_uri } = seedClientAndState();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "x",
        id_token: "google-id-token",
        expires_in: 3600,
        scope: "openid email",
        token_type: "Bearer",
      }),
      text: async () => "",
    } as unknown as globalThis.Response);

    const req = mockReq({ code: "google-code", state: proxy_state });
    const res = mockRes();
    await callbackHandler(req, res);

    expect(res.statusCode).toBe(302);
    expect(res.redirectLocation).toBeDefined();
    const loc = new URL(res.redirectLocation as string);
    expect(`${loc.protocol}//${loc.host}${loc.pathname}`).toBe(client_redirect_uri);
    expect(loc.searchParams.get("code")?.length ?? 0).toBeGreaterThan(0);
    expect(loc.searchParams.get("state")).toBe("orig-state-123");
  });

  it("R5: missing state returns 400 invalid_state", async () => {
    const req = mockReq({ code: "google-code" });
    const res = mockRes();
    await callbackHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_state");
  });

  it("R5: unknown state returns 400 invalid_state", async () => {
    const req = mockReq({ code: "google-code", state: "unknown-state" });
    const res = mockRes();
    await callbackHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_state");
  });

  it("R5: state is one-shot — consumeAuthzState removes it", async () => {
    const { proxy_state } = seedClientAndState();
    // first consume
    expect(consumeAuthzState(proxy_state)).toBeDefined();
    // second consume
    expect(consumeAuthzState(proxy_state)).toBeUndefined();
  });

  it("upstream Google error -> 400 surface", async () => {
    const { proxy_state } = seedClientAndState();
    const req = mockReq({
      code: "x",
      state: proxy_state,
      error: "access_denied",
      error_description: "user cancelled",
    });
    const res = mockRes();
    await callbackHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("access_denied");
  });
});