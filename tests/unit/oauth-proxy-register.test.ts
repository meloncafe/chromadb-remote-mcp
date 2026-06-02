/**
 * oauth-proxy-register.test.ts
 *
 * Unit tests for R6.d + E3 (CVE-2026-45829): OAUTH_PROXY_REDIRECT_URI_ALLOWLIST
 * enforcement in the OAuth DCR (Dynamic Client Registration) handler.
 *
 * AC coverage:
 *   E3 / R6.d AC: allowlist unset + OAUTH_PROXY_ENABLED=true → all DCR status 400
 *   R6.d AC#d1 — allowlist set, redirect_uris not in list → status 400, body.error === "invalid_redirect_uri"
 *   R6.d AC#d2 — allowlist set, redirect_uris all in list → status 201
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import type { Request, Response } from "express";
import { registerHandler } from "../../src/auth/oauth-proxy/register.js";
import { _resetForTests } from "../../src/auth/oauth-proxy/state-store.js";

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

function makeReq(redirect_uris: string[]): Request {
  return { body: { redirect_uris } } as unknown as Request;
}

describe("oauth-proxy registerHandler — R6.d + E3: OAUTH_PROXY_REDIRECT_URI_ALLOWLIST", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    _resetForTests();
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  // ---------------------------------------------------------------------------
  // Case (a): allowlist unset — all DCR requests rejected with 400
  // ---------------------------------------------------------------------------

  it("E3 case (a): OAUTH_PROXY_REDIRECT_URI_ALLOWLIST unset → status 400 for any redirect_uris", () => {
    delete process.env.OAUTH_PROXY_REDIRECT_URI_ALLOWLIST;
    const res = mockRes();
    registerHandler(makeReq(["https://valid-looking.example/cb"]), res);

    expect(res.statusCode).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe("invalid_redirect_uri");
  });

  it("E3 case (a): OAUTH_PROXY_REDIRECT_URI_ALLOWLIST empty string → status 400", () => {
    process.env.OAUTH_PROXY_REDIRECT_URI_ALLOWLIST = "";
    const res = mockRes();
    registerHandler(makeReq(["https://example.com/cb"]), res);

    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_redirect_uri");
  });

  it("E3 case (a): OAUTH_PROXY_REDIRECT_URI_ALLOWLIST whitespace-only → status 400", () => {
    process.env.OAUTH_PROXY_REDIRECT_URI_ALLOWLIST = "   ";
    const res = mockRes();
    registerHandler(makeReq(["https://example.com/cb"]), res);

    expect(res.statusCode).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Case (b): allowlist set, redirect_uri NOT in list → 400 invalid_redirect_uri
  // ---------------------------------------------------------------------------

  it("R6.d case (b): allowlist set, evil URI not in list → status 400 + error invalid_redirect_uri", () => {
    process.env.OAUTH_PROXY_REDIRECT_URI_ALLOWLIST = "https://good.example/cb";
    const res = mockRes();
    registerHandler(makeReq(["http://evil.test/cb"]), res);

    expect(res.statusCode).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe("invalid_redirect_uri");
  });

  it("R6.d case (b): allowlist with multiple entries, URI not matching any → 400", () => {
    process.env.OAUTH_PROXY_REDIRECT_URI_ALLOWLIST =
      "https://good.example/cb,https://other.example/callback";
    const res = mockRes();
    registerHandler(makeReq(["https://evil.example/cb"]), res);

    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_redirect_uri");
  });

  it("R6.d case (b): partial match is NOT allowed (exact-match required)", () => {
    process.env.OAUTH_PROXY_REDIRECT_URI_ALLOWLIST = "https://good.example/cb";
    const res = mockRes();
    // Prefix of the allowlisted URI
    registerHandler(makeReq(["https://good.example/cb/extra"]), res);

    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_redirect_uri");
  });

  it("R6.d case (b): redirect_uris array with mixed good+evil → 400 (any non-match fails)", () => {
    process.env.OAUTH_PROXY_REDIRECT_URI_ALLOWLIST = "https://good.example/cb";
    const res = mockRes();
    registerHandler(makeReq(["https://good.example/cb", "https://evil.test/cb"]), res);

    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_redirect_uri");
  });

  // ---------------------------------------------------------------------------
  // Case (c): allowlist set, redirect_uri matches → 201
  // ---------------------------------------------------------------------------

  it("R6.d case (c): allowlist set, URI matches exactly → status 201", () => {
    process.env.OAUTH_PROXY_REDIRECT_URI_ALLOWLIST = "https://good.example/cb";
    const res = mockRes();
    registerHandler(makeReq(["https://good.example/cb"]), res);

    expect(res.statusCode).toBe(201);
    const body = res.body as Record<string, unknown>;
    expect(typeof body.client_id).toBe("string");
    expect((body.client_id as string).length).toBeGreaterThan(0);
  });

  it("R6.d case (c): allowlist with multiple entries, URI in list → 201", () => {
    process.env.OAUTH_PROXY_REDIRECT_URI_ALLOWLIST =
      "https://good.example/cb,https://other.example/callback";
    const res = mockRes();
    registerHandler(makeReq(["https://other.example/callback"]), res);

    expect(res.statusCode).toBe(201);
  });

  it("R6.d case (c): all redirect_uris in allowlist → 201 with correct response shape", () => {
    process.env.OAUTH_PROXY_REDIRECT_URI_ALLOWLIST =
      "https://good.example/cb,https://other.example/callback";
    const res = mockRes();
    registerHandler(
      makeReq(["https://good.example/cb", "https://other.example/callback"]),
      res,
    );

    expect(res.statusCode).toBe(201);
    const body = res.body as Record<string, unknown>;
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body).not.toHaveProperty("client_secret");
  });

  it("R6.d case (c): allowlist with spaces around URIs (trimmed) → 201", () => {
    process.env.OAUTH_PROXY_REDIRECT_URI_ALLOWLIST =
      "  https://good.example/cb  ,  https://other.example/callback  ";
    const res = mockRes();
    registerHandler(makeReq(["https://good.example/cb"]), res);

    expect(res.statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Regression: existing register behavior with allowlist configured
// ---------------------------------------------------------------------------

describe("oauth-proxy registerHandler — regression: existing validation with allowlist", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    // Configure allowlist so allowlist check passes
    process.env.OAUTH_PROXY_REDIRECT_URI_ALLOWLIST = "https://good.example/cb";
    _resetForTests();
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("400 if redirect_uris missing (even with allowlist configured)", () => {
    const req = { body: {} } as unknown as Request;
    const res = mockRes();
    registerHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe("invalid_redirect_uri");
  });

  it("400 if redirect_uris is empty array (even with allowlist configured)", () => {
    const req = { body: { redirect_uris: [] } } as unknown as Request;
    const res = mockRes();
    registerHandler(req, res);

    expect(res.statusCode).toBe(400);
  });

  it("400 if redirect_uris contains non-string (even with allowlist configured)", () => {
    const req = { body: { redirect_uris: [42] } } as unknown as Request;
    const res = mockRes();
    registerHandler(req, res);

    expect(res.statusCode).toBe(400);
  });
});
