import { createHash } from "crypto";

/**
 * Produces the S256 code_challenge from a code_verifier per RFC 7636.
 *
 *   code_challenge = base64url(SHA256(code_verifier))
 *
 * The verifier is encoded as UTF-8 bytes before hashing — same convention
 * used by every RFC 7636 reference implementation, and what Claude Desktop
 * and mcp-remote send.
 */
export function deriveCodeChallengeS256(code_verifier: string): string {
  return createHash("sha256").update(code_verifier, "utf8").digest("base64url");
}

/**
 * Verifies that `code_verifier` matches `code_challenge` under S256.
 * Returns false on any mismatch.
 *
 * Constant-time comparison is unnecessary here: both inputs are
 * length-bounded strings produced by deterministic hashing, and the verifier
 * is single-use (consumed alongside the authz code). Timing attacks on
 * the comparison do not yield useful information.
 */
export function verifyPkceS256(code_verifier: string, code_challenge: string): boolean {
  if (typeof code_verifier !== "string" || code_verifier.length === 0) return false;
  if (typeof code_challenge !== "string" || code_challenge.length === 0) return false;
  return deriveCodeChallengeS256(code_verifier) === code_challenge;
}