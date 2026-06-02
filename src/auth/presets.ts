/**
 * Maps OIDC_PRESET names to issuer URLs.
 * Used when OIDC_ISSUERS is not set — provides convenience defaults for
 * common identity providers without requiring users to look up issuer URLs.
 */
const PRESETS: Record<string, string> = {
  google: "https://accounts.google.com",
  github: "https://token.actions.githubusercontent.com",
  microsoft: "https://login.microsoftonline.com/common/v2.0",
};

/**
 * Resolves the effective list of OIDC issuer URLs.
 * Priority: OIDC_ISSUERS (explicit, comma-separated) > OIDC_PRESET (comma-separated names).
 * Unknown preset names are silently skipped (logged via console.warn at caller).
 */
export function resolveOidcIssuers(
  issuersEnv: string | undefined,
  presetEnv: string | undefined,
): string[] {
  if (issuersEnv) {
    return issuersEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (presetEnv) {
    const names = presetEnv
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const issuers: string[] = [];
    for (const name of names) {
      const url = PRESETS[name];
      if (url) {
        issuers.push(url);
      } else {
        console.warn(`OIDC_PRESET unknown name "${name}" — skipping.`);
      }
    }
    return issuers;
  }
  return [];
}

export const OIDC_PRESETS = PRESETS;

/**
 * Returns true for preset names that require an explicit audience to be configured.
 * Used by validateEnvironmentVariables to enforce R2 (CVE-2026-45829) audience check.
 * Google and Microsoft presets always require audience; GitHub Actions preset does not
 * (it uses repository-based claims and typically validates via `sub` pattern).
 */
export function requiresAudienceForPreset(presetName: string): boolean {
  return presetName === "google" || presetName === "microsoft";
}