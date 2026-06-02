/**
 * env-validation.spec.ts
 *
 * Unit tests for `validateEnvironmentVariables()` (R1 + R2 / CVE-2026-45829).
 *
 * AC coverage:
 *   R1 AC#1 — fail-closed without any auth
 *   R1 AC#2 — ALLOW_INSECURE_NO_AUTH=true → warnings only
 *   R2 AC#1 — OIDC_ISSUERS set + OIDC_AUDIENCE missing → "OIDC_AUDIENCE is required"
 *   R2 AC#3 — OIDC_PRESET=google + OIDC_AUDIENCE missing → errors.length > 0
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { validateEnvironmentVariables } from "../../src/index.js";

/**
 * Calls validateEnvironmentVariables() in a test context and returns the
 * accumulated errors[] / warnings[] without throwing (we catch the throw
 * and inspect the arrays via the console.error mock pattern).
 *
 * Strategy: patch process.env, call the function, capture the throw message
 * and any console.error calls to reconstruct errors[].
 *
 * Cleaner approach: since validateEnvironmentVariables() throws on errors,
 * we wrap in try/catch to observe behavior.
 */
function runValidation(envOverrides: Record<string, string | undefined>): {
  threw: boolean;
  thrownMessage: string;
  consoleErrors: string[];
  consoleWarnings: string[];
} {
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  const origError = console.error;
  const origWarn = console.warn;
  const origLog = console.log;
  console.error = (...args: unknown[]) => {
    consoleErrors.push(String(args[0]));
  };
  console.warn = (...args: unknown[]) => {
    consoleWarnings.push(String(args[0]));
  };
  console.log = () => {};

  const savedEnv = { ...process.env };

  // Clear all auth-related env first
  const authKeys = [
    "MCP_AUTH_TOKEN",
    "OIDC_ISSUERS",
    "OIDC_PRESET",
    "OIDC_AUDIENCE",
    "ALLOW_INSECURE_NO_AUTH",
    "OAUTH_PROXY_ENABLED",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "NODE_ENV",
  ];
  for (const k of authKeys) {
    delete process.env[k];
  }

  // Apply overrides
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  let threw = false;
  let thrownMessage = "";
  try {
    validateEnvironmentVariables();
  } catch (e) {
    threw = true;
    thrownMessage = e instanceof Error ? e.message : String(e);
  } finally {
    // Restore env
    for (const k of authKeys) {
      delete process.env[k];
    }
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v !== undefined) process.env[k] = v;
    }
    console.error = origError;
    console.warn = origWarn;
    console.log = origLog;
  }

  return { threw, thrownMessage, consoleErrors, consoleWarnings };
}

describe("validateEnvironmentVariables — Phase 0 (R1 + R2)", () => {
  // Set NODE_ENV=test to prevent auto-call at module load, but we
  // call validateEnvironmentVariables() directly in each test.

  describe("R1: fail-closed authentication gate", () => {
    it('fail-closed without any auth: no auth env + NODE_ENV unset → errors[] with fail-closed message', () => {
      // R1 AC#1
      const result = runValidation({});
      expect(result.threw).toBe(true);
      const allErrors = result.consoleErrors.join("\n");
      expect(allErrors).toMatch(/No authentication configured/i);
    });

    it('fail-closed: explicit NODE_ENV=production still fails without auth', () => {
      // R1 AC#4 spirit — NODE_ENV=production is not a gate anymore
      const result = runValidation({ NODE_ENV: "production" });
      expect(result.threw).toBe(true);
      const allErrors = result.consoleErrors.join("\n");
      expect(allErrors).toMatch(/No authentication configured/i);
    });

    it('fail-closed: explicit NODE_ENV=development still fails without auth', () => {
      const result = runValidation({ NODE_ENV: "development" });
      expect(result.threw).toBe(true);
      const allErrors = result.consoleErrors.join("\n");
      expect(allErrors).toMatch(/No authentication configured/i);
    });

    it('ALLOW_INSECURE_NO_AUTH=true only → warnings only, errors.length === 0', () => {
      // R1 AC#2
      const result = runValidation({ ALLOW_INSECURE_NO_AUTH: "true" });
      // Should NOT throw (no errors)
      expect(result.threw).toBe(false);
      // Should have a warning
      const allWarnings = result.consoleWarnings.join("\n");
      expect(allWarnings).toMatch(/ALLOW_INSECURE_NO_AUTH/);
      // Must not have critical errors
      const allErrors = result.consoleErrors.join("\n");
      expect(allErrors).not.toMatch(/No authentication configured/);
    });

    it('MCP_AUTH_TOKEN set → no fail-closed error', () => {
      const result = runValidation({ MCP_AUTH_TOKEN: "secret-token" });
      expect(result.threw).toBe(false);
      const allErrors = result.consoleErrors.join("\n");
      expect(allErrors).not.toMatch(/No authentication configured/);
    });

    it('OIDC_ISSUERS set + OIDC_AUDIENCE set → no fail-closed error', () => {
      const result = runValidation({
        OIDC_ISSUERS: "https://issuer.example",
        OIDC_AUDIENCE: "my-app",
      });
      expect(result.threw).toBe(false);
      const allErrors = result.consoleErrors.join("\n");
      expect(allErrors).not.toMatch(/No authentication configured/);
    });
  });

  describe("R2: OIDC_AUDIENCE required when OIDC issuers configured", () => {
    it('OIDC_ISSUERS set + OIDC_AUDIENCE missing → errors[] contains "OIDC_AUDIENCE is required"', () => {
      // R2 AC#1
      const result = runValidation({
        OIDC_ISSUERS: "https://example.test",
      });
      expect(result.threw).toBe(true);
      const allErrors = result.consoleErrors.join("\n");
      expect(allErrors).toContain("OIDC_AUDIENCE is required");
    });

    it('OIDC_PRESET=google + OIDC_AUDIENCE missing + OAUTH_PROXY_ENABLED!=true → errors.length > 0', () => {
      // R2 AC#3
      const result = runValidation({
        OIDC_PRESET: "google",
        OIDC_AUDIENCE: undefined,
        OAUTH_PROXY_ENABLED: undefined,
      });
      expect(result.threw).toBe(true);
      const allErrors = result.consoleErrors.join("\n");
      expect(allErrors).toContain("OIDC_AUDIENCE is required");
    });

    it('OIDC_PRESET=microsoft + OIDC_AUDIENCE missing → errors.length > 0', () => {
      const result = runValidation({
        OIDC_PRESET: "microsoft",
      });
      expect(result.threw).toBe(true);
      const allErrors = result.consoleErrors.join("\n");
      expect(allErrors).toContain("OIDC_AUDIENCE is required");
    });

    it('OIDC_ISSUERS set + OIDC_AUDIENCE set → no OIDC_AUDIENCE error', () => {
      const result = runValidation({
        OIDC_ISSUERS: "https://example.test",
        OIDC_AUDIENCE: "my-audience",
      });
      expect(result.threw).toBe(false);
      const allErrors = result.consoleErrors.join("\n");
      expect(allErrors).not.toContain("OIDC_AUDIENCE is required");
    });

    it('OIDC_ISSUERS set + OAUTH_PROXY_ENABLED=true + GOOGLE_OAUTH_CLIENT_ID set → no OIDC_AUDIENCE error', () => {
      // OAuth proxy mode: GOOGLE_OAUTH_CLIENT_ID fills audience
      const result = runValidation({
        OIDC_ISSUERS: "https://accounts.google.com",
        OAUTH_PROXY_ENABLED: "true",
        GOOGLE_OAUTH_CLIENT_ID: "client-id",
        GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
      });
      expect(result.threw).toBe(false);
      const allErrors = result.consoleErrors.join("\n");
      expect(allErrors).not.toContain("OIDC_AUDIENCE is required");
    });

    it('MCP_AUTH_TOKEN only (no OIDC) → no OIDC_AUDIENCE error', () => {
      // R2 AC#5 spirit — MCP_AUTH_TOKEN path must not be affected by OIDC audience check
      const result = runValidation({
        MCP_AUTH_TOKEN: "valid-token",
      });
      expect(result.threw).toBe(false);
      const allErrors = result.consoleErrors.join("\n");
      expect(allErrors).not.toContain("OIDC_AUDIENCE is required");
    });
  });
});
