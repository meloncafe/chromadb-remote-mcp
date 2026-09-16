import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import {
  generateKeyPair,
  SignJWT,
  exportJWK,
  type JWK,
} from "jose";
import { verifyOidcToken } from "../../../src/auth/oidc-verifier.js";
import { clearJwksCache } from "../../../src/auth/jwks-cache.js";

const ISSUER = "https://issuer.example";
const AUDIENCE = "test-audience";

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

interface KeyMaterial {
  privateKey: PrivateKey;
  jwk: JWK;
}

async function makeKey(): Promise<KeyMaterial> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.alg = "RS256";
  jwk.kid = "test-kid";
  jwk.use = "sig";
  return { privateKey, jwk };
}

async function makeToken(
  km: KeyMaterial,
  override: Partial<{
    iss: string;
    aud: string;
    exp: number;
    nbf: number;
  }>,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const builder = new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
    .setIssuer(override.iss ?? ISSUER)
    .setAudience(override.aud ?? AUDIENCE)
    .setSubject("user-123")
    .setIssuedAt(now)
    .setExpirationTime(override.exp ?? now + 600);
  if (override.nbf !== undefined) builder.setNotBefore(override.nbf);
  return builder.sign(km.privateKey);
}

describe("Phase 10: verifyOidcToken (R24, R38)", () => {
  let originalFetch: typeof fetch;
  let km: KeyMaterial;

  beforeEach(async () => {
    originalFetch = global.fetch;
    clearJwksCache();
    km = await makeKey();
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
    global.fetch = originalFetch;
    clearJwksCache();
  });

  it("accepts a valid token with matching iss/aud", async () => {
    const token = await makeToken(km, {});
    const result = await verifyOidcToken(token, [ISSUER], AUDIENCE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.sub).toBe("user-123");
    }
  });

  it("rejects token with non-allowlisted issuer", async () => {
    const token = await makeToken(km, { iss: "https://attacker.example" });
    const result = await verifyOidcToken(token, [ISSUER], AUDIENCE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_token");
      expect(result.description).toMatch(/Issuer/);
    }
  });

  it("rejects expired token", async () => {
    const token = await makeToken(km, { exp: Math.floor(Date.now() / 1000) - 3600 });
    const result = await verifyOidcToken(token, [ISSUER], AUDIENCE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_token");
  });

  it("rejects token with wrong audience", async () => {
    const token = await makeToken(km, { aud: "different-audience" });
    const result = await verifyOidcToken(token, [ISSUER], AUDIENCE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_token");
  });

  it("rejects malformed bearer string", async () => {
    const result = await verifyOidcToken("not-a-jwt", [ISSUER], AUDIENCE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_token");
  });

  it("rejects when no issuers configured", async () => {
    const token = await makeToken(km, {});
    const result = await verifyOidcToken(token, [], AUDIENCE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_request");
  });
});