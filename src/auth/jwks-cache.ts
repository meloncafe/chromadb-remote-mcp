import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";

const JWKS_TTL_MS = 60 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 10000;

interface CacheEntry {
  jwks: JWTVerifyGetKey;
  jwksUri: string;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();

interface OidcDiscoveryDoc {
  jwks_uri?: string;
  issuer?: string;
}

async function fetchDiscovery(issuer: string): Promise<OidcDiscoveryDoc> {
  const url = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `JWKS discovery: HTTP ${response.status} from ${url}`,
      );
    }
    const doc = (await response.json()) as OidcDiscoveryDoc;
    if (!doc.jwks_uri) {
      throw new Error(`JWKS discovery: jwks_uri missing in ${url}`);
    }
    return doc;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolves a JWKS getter for the given OIDC issuer.
 * Caches by issuer for JWKS_TTL_MS to handle key rotation without per-request fetch.
 * Throws when discovery or JWKS fetch fails — caller must surface to client as 401.
 */
export async function getJwksForIssuer(issuer: string): Promise<JWTVerifyGetKey> {
  const cached = cache.get(issuer);
  if (cached && Date.now() - cached.cachedAt < JWKS_TTL_MS) {
    return cached.jwks;
  }

  const doc = await fetchDiscovery(issuer);
  const jwksUri = doc.jwks_uri as string;

  const jwks = createRemoteJWKSet(new URL(jwksUri), {
    cooldownDuration: 30000,
    timeoutDuration: 5000,
  });

  cache.set(issuer, {
    jwks,
    jwksUri,
    cachedAt: Date.now(),
  });
  return jwks;
}

/**
 * Clears the JWKS cache (test helper and operational reset).
 */
export function clearJwksCache(): void {
  cache.clear();
}

/**
 * Returns the cached JWKS URI for an issuer (test helper / diagnostics).
 */
export function getCachedJwksUri(issuer: string): string | undefined {
  return cache.get(issuer)?.jwksUri;
}