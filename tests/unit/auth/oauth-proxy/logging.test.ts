import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import type { Request, Response } from "express";
import { createHash } from "crypto";

import { registerHandler } from "../../../../src/auth/oauth-proxy/register.js";
import { authorizeHandler } from "../../../../src/auth/oauth-proxy/authorize.js";
import { callbackHandler } from "../../../../src/auth/oauth-proxy/callback.js";
import { tokenHandler } from "../../../../src/auth/oauth-proxy/token.js";
import {
  registerClient,
  putAuthzCode,
  putAuthzState,
  _resetForTests,
} from "../../../../src/auth/oauth-proxy/state-store.js";

function mockReq(opts: { query?: Record<string, string>; body?: Record<string, unknown>; headers?: Record<string, string> } = {}): Request {
  return {
    query: opts.query ?? {},
    body: opts.body ?? {},
    headers: { host: "mcp.example.com", "x-forwarded-proto": "https", ...(opts.headers ?? {}) },
    secure: false,
  } as unknown as Request;
}

function mockRes() {
  const res = {} as Partial<Response> & {
    statusCode?: number;
    body?: unknown;
    redirectLocation?: string;
  };
  res.status = jest.fn(() => res as Response) as unknown as Response["status"];
  res.json = jest.fn((b: unknown) => {
    res.body = b;
    return res as Response;
  }) as unknown as Response["json"];
  res.redirect = jest.fn((codeOrUrl: number | string, urlMaybe?: string) => {
    if (typeof codeOrUrl === "number") {
      res.statusCode = codeOrUrl;
      res.redirectLocation = urlMaybe;
    } else {
      res.redirectLocation = codeOrUrl;
    }
    return res as Response;
  }) as unknown as Response["redirect"];
  res.setHeader = jest.fn(() => res as Response) as unknown as Response["setHeader"];
  return res as Response & { statusCode?: number; body?: unknown; redirectLocation?: string };
}

function s256(v: string): string {
  return createHash("sha256").update(v, "utf8").digest("base64url");
}

const SECRETS = {
  client_secret: "VERY_SECRET_CLIENT_SECRET_VALUE",
  code_verifier: "VERY_SECRET_CODE_VERIFIER_VALUE",
  id_token: "VERY_SECRET_ID_TOKEN_VALUE",
  google_client_secret: "VERY_SECRET_GOOGLE_CLIENT_SECRET_VALUE",
};

describe("OAuth Proxy: secrets are never logged (R14)", () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let consoleInfoSpy: jest.SpiedFunction<typeof console.info>;
  let consoleDebugSpy: jest.SpiedFunction<typeof console.debug>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.GOOGLE_OAUTH_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = SECRETS.google_client_secret;
    _resetForTests();
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    consoleInfoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    consoleDebugSpy = jest.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleDebugSpy.mockRestore();
    process.env = originalEnv;
  });

  function collectAllLoggedStrings(): string {
    const spies = [
      consoleLogSpy,
      consoleWarnSpy,
      consoleErrorSpy,
      consoleInfoSpy,
      consoleDebugSpy,
    ];
    const parts: string[] = [];
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          parts.push(typeof arg === "string" ? arg : JSON.stringify(arg));
        }
      }
    }
    return parts.join("\n");
  }

  function expectNoSecretsLogged(): void {
    const logged = collectAllLoggedStrings();
    expect(logged).not.toContain(SECRETS.client_secret);
    expect(logged).not.toContain(SECRETS.code_verifier);
    expect(logged).not.toContain(SECRETS.id_token);
    expect(logged).not.toContain(SECRETS.google_client_secret);
  }

  it("registerHandler: client_secret in body never logged", () => {
    const req = mockReq({
      body: { redirect_uris: ["http://localhost/cb"], client_secret: SECRETS.client_secret },
    });
    registerHandler(req, mockRes());
    expectNoSecretsLogged();
  });

  it("authorizeHandler: no secret logging on success or error", () => {
    const { client_id } = registerClient({ redirect_uris: ["http://localhost/cb"] });
    const verifier = "verifier-aaa";
    authorizeHandler(
      mockReq({
        query: {
          response_type: "code",
          client_id,
          redirect_uri: "http://localhost/cb",
          state: "x",
          code_challenge: s256(verifier),
          code_challenge_method: "S256",
        },
      }),
      mockRes(),
    );
    expectNoSecretsLogged();
  });

  it("callbackHandler error path: no secret logging", async () => {
    // No state present → 400 path. Importantly, GOOGLE_OAUTH_CLIENT_SECRET
    // is in process.env so the test ensures it never leaks even when
    // handlers throw / error early.
    await callbackHandler(mockReq({ query: { code: "x", state: "missing" } }), mockRes());
    expectNoSecretsLogged();
  });

  it("tokenHandler: code_verifier and id_token never logged", () => {
    const verifier = SECRETS.code_verifier;
    const code = putAuthzCode({
      client_id: "c1",
      client_redirect_uri: "http://localhost/cb",
      code_challenge: s256(verifier),
      code_challenge_method: "S256",
      id_token: SECRETS.id_token,
      scope: "openid",
      expires_in: 3600,
    });

    tokenHandler(
      mockReq({
        body: {
          grant_type: "authorization_code",
          code,
          redirect_uri: "http://localhost/cb",
          client_id: "c1",
          code_verifier: verifier,
        },
      }),
      mockRes(),
    );
    expectNoSecretsLogged();
  });

  it("tokenHandler invalid_grant path: secrets not logged in error", () => {
    const verifier = SECRETS.code_verifier;
    const code = putAuthzCode({
      client_id: "c1",
      client_redirect_uri: "http://localhost/cb",
      code_challenge: s256("DIFFERENT"), // PKCE will mismatch
      code_challenge_method: "S256",
      id_token: SECRETS.id_token,
      scope: "openid",
      expires_in: 3600,
    });
    tokenHandler(
      mockReq({
        body: {
          grant_type: "authorization_code",
          code,
          redirect_uri: "http://localhost/cb",
          client_id: "c1",
          code_verifier: verifier,
        },
      }),
      mockRes(),
    );
    expectNoSecretsLogged();
  });
});