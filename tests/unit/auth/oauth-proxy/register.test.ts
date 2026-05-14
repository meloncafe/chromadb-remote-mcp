import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { Request, Response } from "express";
import { registerHandler } from "../../../../src/auth/oauth-proxy/register.js";
import { getClient, _resetForTests, TTL_SEC } from "../../../../src/auth/oauth-proxy/state-store.js";

function mockRes() {
  const res = {} as Partial<Response> & {
    statusCode?: number;
    body?: unknown;
  };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  }) as unknown as Response["status"];
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res as Response;
  }) as unknown as Response["json"];
  res.setHeader = jest.fn() as unknown as Response["setHeader"];
  return res as Response & { statusCode?: number; body?: unknown };
}

describe("oauth-proxy: POST /oauth/register (R1)", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("201 + client_id + client_id_issued_at + token_endpoint_auth_method=none, no client_secret", () => {
    const req = { body: { redirect_uris: ["http://localhost/cb"] } } as unknown as Request;
    const res = mockRes();
    registerHandler(req, res);

    expect(res.statusCode).toBe(201);
    const body = res.body as Record<string, unknown>;
    expect(typeof body.client_id).toBe("string");
    expect((body.client_id as string).length).toBeGreaterThan(0);
    expect(typeof body.client_id_issued_at).toBe("number");
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body).not.toHaveProperty("client_secret");
  });

  it("400 invalid_redirect_uri when redirect_uris missing", () => {
    const req = { body: {} } as unknown as Request;
    const res = mockRes();
    registerHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_redirect_uri");
  });

  it("400 invalid_redirect_uri when redirect_uris is empty array", () => {
    const req = { body: { redirect_uris: [] } } as unknown as Request;
    const res = mockRes();
    registerHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_redirect_uri");
  });

  it("400 invalid_redirect_uri when redirect_uris contains non-string", () => {
    const req = { body: { redirect_uris: [42] } } as unknown as Request;
    const res = mockRes();
    registerHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_redirect_uri");
  });

  it("registered client is retrievable within TTL", () => {
    const req = { body: { redirect_uris: ["http://localhost/cb"] } } as unknown as Request;
    const res = mockRes();
    registerHandler(req, res);
    const body = res.body as Record<string, unknown>;
    const client_id = body.client_id as string;

    const entry = getClient(client_id);
    expect(entry).toBeDefined();
    expect(entry?.redirect_uris).toEqual(["http://localhost/cb"]);
  });

  it("registered client expires after TTL (returns undefined)", () => {
    jest.useFakeTimers();
    try {
      const req = { body: { redirect_uris: ["http://localhost/cb"] } } as unknown as Request;
      const res = mockRes();
      registerHandler(req, res);
      const client_id = (res.body as { client_id: string }).client_id;

      // Just before TTL — still valid
      jest.advanceTimersByTime((TTL_SEC - 1) * 1000);
      expect(getClient(client_id)).toBeDefined();

      // Past TTL — expired
      jest.advanceTimersByTime(2 * 1000);
      expect(getClient(client_id)).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  // R3 + E2: pre-shared client_id fallback 채택이 DCR 등록 경로에 영향 없음을
  // 회귀 안전성 차원에서 검증. registerHandler 는 process.env.OAUTH_PROXY_ALLOW_PRESHARED_CLIENT
  // / GOOGLE_OAUTH_CLIENT_ID 를 읽지 않으므로, 두 env 가 set 된 상태에서도 DCR 동작이 동일해야 한다.
  it("R3 coexistence: pre-shared flag and GOOGLE_OAUTH_CLIENT_ID set does NOT affect DCR registration", () => {
    const originalEnv = { ...process.env };
    try {
      process.env.OAUTH_PROXY_ALLOW_PRESHARED_CLIENT = "true";
      process.env.GOOGLE_OAUTH_CLIENT_ID = "test-google-client";

      const req = { body: { redirect_uris: ["http://localhost/cb"] } } as unknown as Request;
      const res = mockRes();
      registerHandler(req, res);

      expect(res.statusCode).toBe(201);
      const body = res.body as Record<string, unknown>;
      const client_id = body.client_id as string;
      expect(typeof client_id).toBe("string");
      expect(client_id.length).toBeGreaterThan(0);
      expect(client_id).not.toBe("test-google-client");
      expect(body).not.toHaveProperty("client_secret");
      expect(getClient(client_id)).toBeDefined();
    } finally {
      process.env = originalEnv;
    }
  });
});