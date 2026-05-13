import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from "@jest/globals";
import { createHash, randomBytes } from "crypto";
import type { Server } from "http";
import type { AddressInfo } from "net";

const FIXED_GOOGLE_ID_TOKEN = "header.payload.signature";

describe("OAuth Proxy E2E flow (R2, R4) — DCR + authorize + callback + token", () => {
  let server: Server;
  let baseUrl: string;
  let originalEnv: NodeJS.ProcessEnv;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.OAUTH_PROXY_ENABLED = "true";
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-google-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-google-secret";
    process.env.OIDC_PRESET = "google";
    process.env.OIDC_AUDIENCE = "test-google-client-id";
    process.env.CHROMA_HOST = "127.0.0.1";
    process.env.CHROMA_PORT = "1";

    const mod = await import("../../src/index.js");
    await new Promise<void>((resolve) => {
      server = mod.app.listen(0, () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    process.env = originalEnv;
  });

  beforeEach(() => {
    fetchMock = jest.spyOn(global, "fetch") as unknown as jest.SpiedFunction<typeof fetch>;
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  function s256(verifier: string): string {
    return createHash("sha256").update(verifier, "utf8").digest("base64url");
  }

  it("full flow: metadata → register → authorize → callback → token", async () => {
    // (a) metadata
    const metaResp = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    expect(metaResp.status).toBe(200);
    const meta = (await metaResp.json()) as Record<string, unknown>;
    expect(meta.issuer).toBeDefined();
    expect(meta.authorization_endpoint).toBeDefined();
    expect(meta.token_endpoint).toBeDefined();
    expect(meta.registration_endpoint).toBeDefined();
    expect(meta.response_types_supported).toEqual(["code"]);
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    expect(meta.token_endpoint_auth_methods_supported).toEqual(["none"]);

    // (b) register — no pre-issued client_id/secret needed
    const clientRedirect = "http://localhost:9999/cb";
    const regResp = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: [clientRedirect] }),
    });
    expect(regResp.status).toBe(201);
    const reg = (await regResp.json()) as Record<string, unknown>;
    const client_id = reg.client_id as string;
    expect(typeof client_id).toBe("string");
    expect(client_id.length).toBeGreaterThan(0);
    expect(reg).not.toHaveProperty("client_secret");

    // (c) authorize — fabricate PKCE pair
    const verifier = randomBytes(32).toString("base64url");
    const challenge = s256(verifier);
    const authzUrl = new URL(`${baseUrl}/oauth/authorize`);
    authzUrl.searchParams.set("response_type", "code");
    authzUrl.searchParams.set("client_id", client_id);
    authzUrl.searchParams.set("redirect_uri", clientRedirect);
    authzUrl.searchParams.set("scope", "openid email profile");
    authzUrl.searchParams.set("state", "client-state-abc");
    authzUrl.searchParams.set("code_challenge", challenge);
    authzUrl.searchParams.set("code_challenge_method", "S256");

    const authzResp = await fetch(authzUrl.toString(), { redirect: "manual" });
    expect(authzResp.status).toBe(302);
    const googleLoc = authzResp.headers.get("location") || "";
    const googleParsed = new URL(googleLoc);
    expect(`${googleParsed.protocol}//${googleParsed.host}${googleParsed.pathname}`).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(googleParsed.searchParams.get("client_id")).toBe("test-google-client-id");
    const proxy_state = googleParsed.searchParams.get("state") as string;
    expect(proxy_state.length).toBeGreaterThan(0);

    // (d) callback — mock Google /token
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      if (urlStr === "https://oauth2.googleapis.com/token") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "google-access",
            id_token: FIXED_GOOGLE_ID_TOKEN,
            expires_in: 3600,
            scope: "openid email profile",
            token_type: "Bearer",
          }),
          text: async () => "",
        } as unknown as globalThis.Response;
      }
      throw new Error(`Unexpected fetch: ${urlStr}`);
    });

    const cbResp = await fetch(
      `${baseUrl}/oauth/callback?code=google-code&state=${encodeURIComponent(proxy_state)}`,
      { redirect: "manual" },
    );
    expect(cbResp.status).toBe(302);
    const clientLoc = cbResp.headers.get("location") || "";
    const clientParsed = new URL(clientLoc);
    expect(`${clientParsed.protocol}//${clientParsed.host}${clientParsed.pathname}`).toBe(
      clientRedirect,
    );
    const proxy_code = clientParsed.searchParams.get("code") as string;
    expect(proxy_code.length).toBeGreaterThan(0);
    expect(clientParsed.searchParams.get("state")).toBe("client-state-abc");

    // (e) token
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: proxy_code,
      redirect_uri: clientRedirect,
      client_id,
      code_verifier: verifier,
    });
    const tokenResp = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
    expect(tokenResp.status).toBe(200);
    const tok = (await tokenResp.json()) as Record<string, unknown>;
    expect(tok.access_token).toBe(FIXED_GOOGLE_ID_TOKEN);
    expect(tok.id_token).toBe(FIXED_GOOGLE_ID_TOKEN);
    expect(tok.token_type).toBe("Bearer");
    expect(typeof tok.expires_in).toBe("number");

    // (f) no pre-issued client_id/secret was supplied by the client at any step
    // — `client_id` here is the DCR-issued one, not Google's. Asserted implicitly
    // by the fact that we never hard-coded any client_secret on the client side.
    expect(reg).not.toHaveProperty("client_secret");
  });
});