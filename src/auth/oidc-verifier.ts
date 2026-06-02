import { jwtVerify, decodeJwt, errors as joseErrors, type JWTPayload } from "jose";
import { getJwksForIssuer } from "./jwks-cache.js";

export type OidcVerifyFailureReason =
  | "invalid_request"
  | "invalid_token"
  | "insufficient_scope";

export interface OidcVerifyError {
  ok: false;
  reason: OidcVerifyFailureReason;
  description: string;
}

export interface OidcVerifySuccess {
  ok: true;
  payload: JWTPayload;
}

export type OidcVerifyResult = OidcVerifySuccess | OidcVerifyError;

const ALLOWED_ALGS = ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "EdDSA"];

// Google canonical issuer URL used for azp claim cross-check (R2 / CVE-2026-45829).
const GOOGLE_ISSUER = "https://accounts.google.com";

/**
 * Verifies an OIDC ID token / access JWT against the configured issuers + audience.
 * Returns structured success/failure so middleware can populate WWW-Authenticate
 * with the correct RFC 6750 `error=` parameter.
 *
 * `audience` is required (non-nullable). Callers must resolve the audience before
 * calling this function — passing undefined is a type error (R2 / CVE-2026-45829).
 */
export async function verifyOidcToken(
  token: string,
  allowedIssuers: string[],
  audience: string,
): Promise<OidcVerifyResult> {
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "invalid_request", description: "Empty bearer token" };
  }
  if (allowedIssuers.length === 0) {
    return {
      ok: false,
      reason: "invalid_request",
      description: "No OIDC issuers configured on this server",
    };
  }

  let unverified: JWTPayload;
  try {
    unverified = decodeJwt(token);
  } catch {
    return { ok: false, reason: "invalid_token", description: "Malformed JWT" };
  }

  const iss = typeof unverified.iss === "string" ? unverified.iss : undefined;
  if (!iss || !allowedIssuers.includes(iss)) {
    return {
      ok: false,
      reason: "invalid_token",
      description: `Issuer "${iss ?? "<missing>"}" is not in OIDC_ISSUERS allowlist`,
    };
  }

  let jwks;
  try {
    jwks = await getJwksForIssuer(iss);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: "invalid_token",
      description: `JWKS unavailable: ${detail}`,
    };
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: iss,
      audience,
      algorithms: ALLOWED_ALGS,
      clockTolerance: 60,
    });

    // R2: Google-issued tokens must additionally validate azp (authorized party)
    // claim against the expected client_id (== audience) to prevent token reuse
    // across applications (CVE-2026-45829 amplifier path).
    if (iss === GOOGLE_ISSUER) {
      const azp = (payload as Record<string, unknown>)["azp"];
      if (azp !== undefined && azp !== audience) {
        return {
          ok: false,
          reason: "invalid_token",
          description: `Google token azp claim "${String(azp)}" does not match expected client_id`,
        };
      }
    }

    return { ok: true, payload };
  } catch (err) {
    if (
      err instanceof joseErrors.JWTExpired ||
      err instanceof joseErrors.JWTClaimValidationFailed ||
      err instanceof joseErrors.JWSSignatureVerificationFailed ||
      err instanceof joseErrors.JWTInvalid
    ) {
      const detail = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: "invalid_token", description: detail };
    }
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "invalid_token", description: detail };
  }
}