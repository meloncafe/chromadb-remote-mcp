/**
 * oidc-verifier-azp.spec.ts
 *
 * Unit tests for Google azp (authorized party) claim validation
 * added to verifyOidcToken in R2 / CVE-2026-45829.
 *
 * AC coverage:
 *   R2 AC#4 — azp !== expectedClientId → {ok:false, reason:"invalid_token", description:/azp/}
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { generateKeyPair, SignJWT, exportJWK, type JWK } from "jose";
import { verifyOidcToken } from "../../src/auth/oidc-verifier.js";
import { clearJwksCache } from "../../src/auth/jwks-cache.js";

const GOOGLE_ISSUER = "https://accounts.google.com";
const AUDIENCE = "my-client-id-123";

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

interface KeyMaterial {
  privateKey: PrivateKey;
  jwk: JWK;
}

async function makeKey(): Promise<KeyMaterial> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.alg = "RS256";
  jwk.kid = "google-kid-1";
  jwk.use = "sig";
  return { privateKey, jwk };
}

async function makeGoogleToken(
  km: KeyMaterial,
  opts: {
    iss?: string;
    aud?: string;
    azp?: string;
    omitAzp?: boolean;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const iss = opts.iss ?? GOOGLE_ISSUER;
  const aud = opts.aud ?? AUDIENCE;

  // Build payload with optional azp claim
  const extraClaims: Record<string, string> = {};
  if (!opts.omitAzp) {
    extraClaims["azp"] = opts.azp ?? AUDIENCE;
  }

  return new SignJWT(extraClaims)
    .setProtectedHeader({ alg: "RS256", kid: "google-kid-1" })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject("user@gmail.com")
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .sign(km.privateKey);
}

describe("verifyOidcToken — Google azp claim validation (R2 / CVE-2026-45829)", () => {
  let km: KeyMaterial;
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;
    clearJwksCache();
    km = await makeKey();

    global.fetch = jest.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes(GOOGLE_ISSUER) && u.endsWith("/.well-known/openid-configuration")) {
        return new Response(
          JSON.stringify({
            issuer: GOOGLE_ISSUER,
            jwks_uri: `${GOOGLE_ISSUER}/oauth2/v3/certs`,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.includes(GOOGLE_ISSUER) && u.includes("/certs")) {
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

  it("R2 AC#4: Google token with matching azp → ok=true", async () => {
    const token = await makeGoogleToken(km, { azp: AUDIENCE });
    const result = await verifyOidcToken(token, [GOOGLE_ISSUER], AUDIENCE);
    expect(result.ok).toBe(true);
  });

  it("R2 AC#4: Google token with mismatched azp → ok=false, reason=invalid_token, description contains 'azp'", async () => {
    const token = await makeGoogleToken(km, { azp: "evil-other-client" });
    const result = await verifyOidcToken(token, [GOOGLE_ISSUER], AUDIENCE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_token");
      expect(/azp/.test(result.description)).toBe(true);
    }
  });

  it("R2 AC#4: Google token with omitted azp (no azp claim) → ok=true (azp is optional per spec)", async () => {
    // Google tokens may or may not include azp; if absent, skip the check
    const token = await makeGoogleToken(km, { omitAzp: true });
    const result = await verifyOidcToken(token, [GOOGLE_ISSUER], AUDIENCE);
    expect(result.ok).toBe(true);
  });

  it("R2: Non-Google issuer with azp mismatch → ok=true (azp check only for Google)", async () => {
    // For non-Google issuers, azp mismatch should NOT trigger rejection
    const otherIssuer = "https://auth.example.com";
    const { privateKey: otherKey, publicKey: otherPub } = await generateKeyPair("RS256", {
      extractable: true,
    });
    const otherJwk = await exportJWK(otherPub);
    otherJwk.alg = "RS256";
    otherJwk.kid = "other-kid";
    otherJwk.use = "sig";

    // Override fetch for this test
    const prevFetch = global.fetch;
    global.fetch = jest.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("auth.example.com") && u.endsWith("/.well-known/openid-configuration")) {
        return new Response(
          JSON.stringify({
            issuer: otherIssuer,
            jwks_uri: `${otherIssuer}/jwks`,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.includes("auth.example.com") && u.endsWith("/jwks")) {
        return new Response(JSON.stringify({ keys: [otherJwk] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ azp: "wrong-client" })
      .setProtectedHeader({ alg: "RS256", kid: "other-kid" })
      .setIssuer(otherIssuer)
      .setAudience(AUDIENCE)
      .setSubject("user@example.com")
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(otherKey);

    const result = await verifyOidcToken(token, [otherIssuer], AUDIENCE);
    global.fetch = prevFetch;
    // Non-Google azp mismatch is NOT checked
    expect(result.ok).toBe(true);
  });
});
