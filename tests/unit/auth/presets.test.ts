import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { resolveOidcIssuers, OIDC_PRESETS } from "../../../src/auth/presets.js";

describe("Phase 10: OIDC presets (R25)", () => {
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("expands single preset name to its issuer URL", () => {
    expect(resolveOidcIssuers(undefined, "google")).toEqual([OIDC_PRESETS.google]);
  });

  it("expands multiple comma-separated preset names", () => {
    const issuers = resolveOidcIssuers(undefined, "google,github,microsoft");
    expect(issuers).toEqual([
      OIDC_PRESETS.google,
      OIDC_PRESETS.github,
      OIDC_PRESETS.microsoft,
    ]);
  });

  it("OIDC_ISSUERS overrides OIDC_PRESET when both set", () => {
    const explicit = ["https://custom.example.com"];
    const issuers = resolveOidcIssuers(explicit.join(","), "google");
    expect(issuers).toEqual(explicit);
  });

  it("skips unknown preset names with a warn", () => {
    const issuers = resolveOidcIssuers(undefined, "google,bogus");
    expect(issuers).toEqual([OIDC_PRESETS.google]);
    expect(warnSpy.mock.calls.some((c) => String(c[0]).match(/bogus/))).toBe(true);
  });

  it("returns empty list when both env values missing", () => {
    expect(resolveOidcIssuers(undefined, undefined)).toEqual([]);
  });
});