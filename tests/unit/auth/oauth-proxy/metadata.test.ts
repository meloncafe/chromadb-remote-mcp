import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import type { Request, Response } from "express";
import { authServerMetadataHandler, resolveOAuthBaseUrl } from "../../../../src/auth/oauth-proxy/metadata.js";

function mockReq(headers: Record<string, string> = {}): Request {
  return {
    headers,
    secure: false,
  } as unknown as Request;
}

function mockRes() {
  const res = {} as Partial<Response> & {
    statusCode?: number;
    body?: unknown;
    headers: Record<string, string>;
  };
  res.headers = {};
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  }) as unknown as Response["status"];
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res as Response;
  }) as unknown as Response["json"];
  res.setHeader = jest.fn((name: string, value: string) => {
    res.headers[name] = value;
    return res as Response;
  }) as unknown as Response["setHeader"];
  return res as Response & { statusCode?: number; body?: unknown; headers: Record<string, string> };
}

describe("oauth-proxy: GET /.well-known/oauth-authorization-server (R9, E1)", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("R9: returns 200 with all 7 required keys + correct values", () => {
    delete process.env.OAUTH_PROXY_BASE_URL;
    const req = mockReq({ host: "example.test", "x-forwarded-proto": "https" });
    const res = mockRes();
    authServerMetadataHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;

    expect(body).toHaveProperty("issuer");
    expect(body).toHaveProperty("authorization_endpoint");
    expect(body).toHaveProperty("token_endpoint");
    expect(body).toHaveProperty("registration_endpoint");
    expect(body.response_types_supported).toEqual(["code"]);
    expect(body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(body.token_endpoint_auth_methods_supported).toEqual(["none"]);
  });

  it("R9: issuer + *_endpoint start with resolveResourceBaseUrl(req) when OAUTH_PROXY_BASE_URL unset", () => {
    delete process.env.OAUTH_PROXY_BASE_URL;
    const req = mockReq({ host: "example.test", "x-forwarded-proto": "https" });
    const res = mockRes();
    authServerMetadataHandler(req, res);

    const body = res.body as Record<string, string>;
    const expectedBase = "https://example.test";
    expect(body.issuer).toBe(expectedBase);
    expect(body.authorization_endpoint).toBe(`${expectedBase}/oauth/authorize`);
    expect(body.token_endpoint).toBe(`${expectedBase}/oauth/token`);
    expect(body.registration_endpoint).toBe(`${expectedBase}/oauth/register`);
  });

  it("E1: OAUTH_PROXY_BASE_URL overrides issuer + *_endpoint base", () => {
    process.env.OAUTH_PROXY_BASE_URL = "https://override.example.com";
    const req = mockReq({ host: "ignored.test" });
    const res = mockRes();
    authServerMetadataHandler(req, res);

    const body = res.body as Record<string, string>;
    expect(body.issuer).toBe("https://override.example.com");
    expect(body.authorization_endpoint).toBe("https://override.example.com/oauth/authorize");
    expect(body.token_endpoint).toBe("https://override.example.com/oauth/token");
    expect(body.registration_endpoint).toBe("https://override.example.com/oauth/register");
  });

  it("E1: resolveOAuthBaseUrl trims trailing slashes from OAUTH_PROXY_BASE_URL", () => {
    process.env.OAUTH_PROXY_BASE_URL = "https://override.example.com///";
    const req = mockReq({ host: "ignored.test" });
    expect(resolveOAuthBaseUrl(req)).toBe("https://override.example.com");
  });

  it("Content-Type set to application/json", () => {
    delete process.env.OAUTH_PROXY_BASE_URL;
    const req = mockReq({ host: "example.test", "x-forwarded-proto": "https" });
    const res = mockRes();
    authServerMetadataHandler(req, res);
    expect(res.headers["Content-Type"]).toBe("application/json");
  });
});