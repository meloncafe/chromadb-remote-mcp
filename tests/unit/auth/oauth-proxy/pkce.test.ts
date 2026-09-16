import { describe, it, expect } from "@jest/globals";
import { createHash } from "crypto";
import { deriveCodeChallengeS256, verifyPkceS256 } from "../../../../src/auth/oauth-proxy/pkce.js";

describe("oauth-proxy: PKCE S256 (R5)", () => {
  describe("deriveCodeChallengeS256", () => {
    it("equals reference SHA256+base64url output", () => {
      const verifier = "test-verifier-abc-123";
      const expected = createHash("sha256").update(verifier, "utf8").digest("base64url");
      expect(deriveCodeChallengeS256(verifier)).toBe(expected);
    });

    it("differs for different inputs", () => {
      expect(deriveCodeChallengeS256("a")).not.toBe(deriveCodeChallengeS256("b"));
    });

    it("matches RFC 7636 Appendix B example", () => {
      // verifier from RFC 7636 §4.1
      const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      // challenge from RFC 7636 §4.2
      const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
      expect(deriveCodeChallengeS256(verifier)).toBe(expected);
    });
  });

  describe("verifyPkceS256", () => {
    it("true when verifier→challenge matches", () => {
      const v = "any-string-verifier";
      const c = deriveCodeChallengeS256(v);
      expect(verifyPkceS256(v, c)).toBe(true);
    });

    it("false when verifier does not match challenge", () => {
      const v = "v1";
      const c = deriveCodeChallengeS256("v2");
      expect(verifyPkceS256(v, c)).toBe(false);
    });

    it("false for empty verifier", () => {
      expect(verifyPkceS256("", "any")).toBe(false);
    });

    it("false for empty challenge", () => {
      expect(verifyPkceS256("verifier", "")).toBe(false);
    });

    it("false when verifier challenges are swapped (round-trip negative)", () => {
      const v = "x";
      const c = "x"; // not the actual SHA256(v).base64url
      expect(verifyPkceS256(v, c)).toBe(false);
    });

    it("RFC 7636 reference example matches", () => {
      const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
      expect(verifyPkceS256(verifier, challenge)).toBe(true);
    });
  });
});