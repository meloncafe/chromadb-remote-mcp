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

/**
 * Verifies an OIDC ID token / access JWT against the configured issuers + audience.
 * Returns structured success/failure so middleware can populate WWW-Authenticate
 * with the correct RFC 6750 `error=` parameter.
 */
export async function verifyOidcToken(
  token: string,
  allowedIssuers: string[],
  audience: string | undefined,
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
      audience: audience || undefined,
      algorithms: ALLOWED_ALGS,
      clockTolerance: 60,
    });
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