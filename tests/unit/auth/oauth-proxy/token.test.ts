import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { createHash } from "crypto";
import type { Request, Response } from "express";
import { tokenHandler, verifyPkceS256 } from "../../../../src/auth/oauth-proxy/token.js";
import { putAuthzCode, _resetForTests } from "../../../../src/auth/oauth-proxy/state-store.js";

function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

function mockReq(body: Record<string, unknown>): Request {
  return { body } as unknown as Request;
}

function mockRes() {
  const res = {} as Partial<Response> & { statusCode?: number; body?: unknown };
  res.status = jest.fn((c: number) => {
    res.statusCode = c;
    return res as Response;
  }) as unknown as Response["status"];
  res.json = jest.fn((b: unknown) => {
    res.body = b;
    return res as Response;
  }) as unknown as Response["json"];
  return res as Response & { statusCode?: number; body?: unknown };
}

const FIXED_ID_TOKEN = "eyJhbGciOiJSUzI1NiJ9.payload.sig"; // mocked Google id_token

describe("oauth-proxy: POST /oauth/token (R5, R6)", () => {
  beforeEach(() => {
    _resetForTests();
  });

  function seedCode(verifier: string): { code: string; client_id: string; redirect_uri: string } {
    const challenge = s256Challenge(verifier);
    const client_id = "client-xyz";
    const redirect_uri = "http://localhost/cb";
    const code = putAuthzCode({
      client_id,
      client_redirect_uri: redirect_uri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      id_token: FIXED_ID_TOKEN,
      scope: "openid email",
      expires_in: 3600,
    });
    return { code, client_id, redirect_uri };
  }

  it("R6: success returns id_token byte-identical to stored Google id_token", () => {
    const verifier = "verifier-aaa-bbb-ccc";
    const { code, client_id, redirect_uri } = seedCode(verifier);
    const req = mockReq({
      grant_type: "authorization_code",
      code,
      redirect_uri,
      client_id,
      code_verifier: verifier,
    });
    const res = mockRes();
    tokenHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.id_token).toBe(FIXED_ID_TOKEN);
    expect(body.access_token).toBe(FIXED_ID_TOKEN);
    expect(body.token_type).toBe("Bearer");
    expect(typeof body.expires_in).toBe("number");
    expect(body.scope).toBe("openid email");
  });

  it("R5: second call with same code → 400 invalid_grant", () => {
    const verifier = "v-1";
    const { code, client_id, redirect_uri } = seedCode(verifier);
    const reqBody = {
      grant_type: "authorization_code",
      code,
      redirect_uri,
      client_id,
      code_verifier: verifier,
    };

    const res1 = mockRes();
    tokenHandler(mockReq(reqBody), res1);
    expect(res1.statusCode).toBe(200);

    const res2 = mockRes();
    tokenHandler(mockReq(reqBody), res2);
    expect(res2.statusCode).toBe(400);
    expect((res2.body as Record<string, unknown>).error).toBe("invalid_grant");
  });

  it("R5: wrong code_verifier → 400 invalid_grant", () => {
    const verifier = "the-truth";
    const { code, client_id, redirect_uri } = seedCode(verifier);
    const req = mockReq({
      grant_type: "authorization_code",
      code,
      redirect_uri,
      client_id,
      code_verifier: "wrong",
    });
    const res = mockRes();
    tokenHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_grant");
  });

  it("R5: client_id mismatch → 400 invalid_grant", () => {
    const verifier = "v-2";
    const { code, redirect_uri } = seedCode(verifier);
    const req = mockReq({
      grant_type: "authorization_code",
      code,
      redirect_uri,
      client_id: "different-client",
      code_verifier: verifier,
    });
    const res = mockRes();
    tokenHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_grant");
  });

  it("R5: redirect_uri mismatch → 400 invalid_grant", () => {
    const verifier = "v-3";
    const { code, client_id } = seedCode(verifier);
    const req = mockReq({
      grant_type: "authorization_code",
      code,
      redirect_uri: "http://evil/cb",
      client_id,
      code_verifier: verifier,
    });
    const res = mockRes();
    tokenHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_grant");
  });

  it("missing code_verifier → 400 invalid_request", () => {
    const verifier = "v-4";
    const { code, client_id, redirect_uri } = seedCode(verifier);
    const req = mockReq({
      grant_type: "authorization_code",
      code,
      redirect_uri,
      client_id,
    });
    const res = mockRes();
    tokenHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_request");
  });

  it("grant_type != 'authorization_code' → 400 unsupported_grant_type", () => {
    const req = mockReq({ grant_type: "client_credentials" });
    const res = mockRes();
    tokenHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("unsupported_grant_type");
  });

  it("verifyPkceS256 helper: matches when SHA256(verifier).base64url === challenge", () => {
    const v = "test-verifier-string";
    const c = createHash("sha256").update(v, "utf8").digest("base64url");
    expect(verifyPkceS256(v, c)).toBe(true);
    expect(verifyPkceS256(v, "wrong-challenge")).toBe(false);
  });

  // R3 + E2: pre-shared client_id fallback (LibreChat 패턴) 케이스
  describe("R3 + E2: pre-shared client_id fallback at token endpoint", () => {
    let originalEnv: NodeJS.ProcessEnv;
    const PRESHARED_CLIENT_ID = "test-google-client";

    beforeEach(() => {
      originalEnv = { ...process.env };
      process.env.GOOGLE_OAUTH_CLIENT_ID = PRESHARED_CLIENT_ID;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    function seedPresharedCode(verifier: string): { code: string; redirect_uri: string } {
      // entry.client_id 를 GOOGLE_OAUTH_CLIENT_ID 로 시드 (authorize 가 pre-shared 로 통과한 시나리오)
      const challenge = s256Challenge(verifier);
      const redirect_uri = "http://localhost/cb";
      const code = putAuthzCode({
        client_id: PRESHARED_CLIENT_ID,
        client_redirect_uri: redirect_uri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        id_token: FIXED_ID_TOKEN,
        scope: "openid email",
        expires_in: 3600,
      });
      return { code, redirect_uri };
    }

    it("flag on + entry.client_id === client_id === GOOGLE_OAUTH_CLIENT_ID → 200 (token issued)", () => {
      process.env.OAUTH_PROXY_ALLOW_PRESHARED_CLIENT = "true";
      const verifier = "preshared-verifier-xyz-1";
      const { code, redirect_uri } = seedPresharedCode(verifier);
      const req = mockReq({
        grant_type: "authorization_code",
        code,
        redirect_uri,
        client_id: PRESHARED_CLIENT_ID,
        code_verifier: verifier,
      });
      const res = mockRes();
      tokenHandler(req, res);
      expect(res.statusCode).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.access_token).toBe(FIXED_ID_TOKEN);
      expect(body.token_type).toBe("Bearer");
    });

    it("flag off + entry.client_id !== client_id → 400 invalid_grant (no fallback)", () => {
      delete process.env.OAUTH_PROXY_ALLOW_PRESHARED_CLIENT;
      const verifier = "preshared-verifier-xyz-2";
      const { code, redirect_uri } = seedPresharedCode(verifier);
      // entry.client_id = PRESHARED_CLIENT_ID; request 의 client_id 가 다른 값 → mismatch.
      // flag off 이므로 fallback 없이 400.
      const req = mockReq({
        grant_type: "authorization_code",
        code,
        redirect_uri,
        client_id: "other-client",
        code_verifier: verifier,
      });
      const res = mockRes();
      tokenHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect((res.body as Record<string, unknown>).error).toBe("invalid_grant");
    });

    it("flag on + pre-shared client_id but PKCE verifier wrong → 400 invalid_grant (PKCE never bypassed)", () => {
      process.env.OAUTH_PROXY_ALLOW_PRESHARED_CLIENT = "true";
      const verifier = "preshared-verifier-xyz-3";
      const { code, redirect_uri } = seedPresharedCode(verifier);
      const req = mockReq({
        grant_type: "authorization_code",
        code,
        redirect_uri,
        client_id: PRESHARED_CLIENT_ID,
        code_verifier: "wrong-verifier",
      });
      const res = mockRes();
      tokenHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect((res.body as Record<string, unknown>).error).toBe("invalid_grant");
    });
  });
});