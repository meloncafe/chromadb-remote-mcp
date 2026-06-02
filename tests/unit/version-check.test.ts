/**
 * version-check.test.ts
 *
 * Unit tests for R4 + E2 (CVE-2026-45829) version-check workflow logic.
 *
 * AC coverage:
 *   R4 AC#4 — workflow step logic: vulnerable 1.5.0 → fail, patched 1.5.9 → pass
 *   E2 AC   — SDK step logic: 3.4.2 → fail, 3.4.3 → pass
 */

import { describe, it, expect } from "@jest/globals";

// ---------------------------------------------------------------------------
// Helpers extracted from chromadb-version-check.yml logic
// (kept in pure TS so the CI workflow and this test share the same algorithm).
// ---------------------------------------------------------------------------

/**
 * Parse the ChromaDB server version from a docker-compose file's image line.
 * Returns the semver string (e.g. "1.5.9") or null if no version tag is found.
 *
 * Handles formats:
 *   chromadb/chroma:1.5.9
 *   chromadb/chroma:1.5.9@sha256:<digest>
 */
export function parseChromaImageVersion(fileContents: string): string | null {
  const match = fileContents.match(/chromadb\/chroma:(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

/**
 * Returns true if the given semver string is within the vulnerable range 1.0.0–1.5.8.
 */
export function isVulnerableChromaVersion(version: string): boolean {
  const parts = version.split(".");
  if (parts.length < 3) return false;
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  const patch = parseInt(parts[2], 10);

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) return false;

  if (major !== 1) return false;          // Only 1.x range is affected
  if (minor < 5) return true;            // 1.0.x – 1.4.x always vulnerable
  if (minor === 5 && patch <= 8) return true;  // 1.5.0 – 1.5.8 vulnerable
  return false;
}

/**
 * Parse the lower-bound version from a semver range string.
 * Strips leading ^, ~, >=, =, v characters.
 * E.g. "^3.4.3" → "3.4.3", ">=3.4.3" → "3.4.3"
 */
export function parseSdkLowerBound(rawVersion: string): string {
  return rawVersion.replace(/^[^0-9]*/, "");
}

/**
 * Returns true if the chromadb JS SDK version satisfies >= 3.4.3.
 */
export function isSdkVersionSafe(version: string): boolean {
  const parts = version.split(".");
  if (parts.length < 3) return false;
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  const patch = parseInt(parts[2], 10);

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) return false;

  if (major > 3) return true;
  if (major < 3) return false;
  if (minor > 4) return true;
  if (minor < 4) return false;
  return patch >= 3;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("R4: ChromaDB server version detection", () => {
  describe("parseChromaImageVersion", () => {
    it("parses version from plain tag", () => {
      expect(parseChromaImageVersion("image: chromadb/chroma:1.5.9")).toBe("1.5.9");
    });

    it("parses version from tag + digest", () => {
      expect(
        parseChromaImageVersion(
          "image: chromadb/chroma:1.5.9@sha256:1e0b73a187a28757c572acba508c46f48c9e8b0acaf5c20e6d95cdedce1acdf6",
        ),
      ).toBe("1.5.9");
    });

    it("returns null for :latest tag", () => {
      expect(parseChromaImageVersion("image: chromadb/chroma:latest")).toBeNull();
    });

    it("returns null for variable tag ${CHROMADB_VERSION:-latest}", () => {
      expect(parseChromaImageVersion("image: chromadb/chroma:${CHROMADB_VERSION:-latest}")).toBeNull();
    });

    it("returns null if no chromadb image line", () => {
      expect(parseChromaImageVersion("image: postgres:15")).toBeNull();
    });
  });

  describe("isVulnerableChromaVersion", () => {
    // Vulnerable cases
    it("1.0.0 → vulnerable", () => expect(isVulnerableChromaVersion("1.0.0")).toBe(true));
    it("1.4.9 → vulnerable", () => expect(isVulnerableChromaVersion("1.4.9")).toBe(true));
    it("1.5.0 → vulnerable", () => expect(isVulnerableChromaVersion("1.5.0")).toBe(true));
    it("1.5.7 → vulnerable", () => expect(isVulnerableChromaVersion("1.5.7")).toBe(true));
    it("1.5.8 → vulnerable (boundary)", () => expect(isVulnerableChromaVersion("1.5.8")).toBe(true));

    // Patched cases
    it("1.5.9 → NOT vulnerable (patched)", () => expect(isVulnerableChromaVersion("1.5.9")).toBe(false));
    it("1.6.0 → NOT vulnerable", () => expect(isVulnerableChromaVersion("1.6.0")).toBe(false));
    it("2.0.0 → NOT vulnerable", () => expect(isVulnerableChromaVersion("2.0.0")).toBe(false));
    it("0.9.9 → NOT vulnerable (pre-1.x)", () => expect(isVulnerableChromaVersion("0.9.9")).toBe(false));
  });

  describe("Integration: docker-compose fixture checks", () => {
    it("vulnerable compose fixture (1.5.0) → detected as vulnerable", () => {
      const fixture = `
services:
  chromadb:
    image: chromadb/chroma:1.5.0
`;
      const version = parseChromaImageVersion(fixture);
      expect(version).toBe("1.5.0");
      expect(isVulnerableChromaVersion(version!)).toBe(true);
    });

    it("patched compose fixture (1.5.9@sha256) → detected as NOT vulnerable", () => {
      const fixture = `
services:
  chromadb:
    image: chromadb/chroma:1.5.9@sha256:1e0b73a187a28757c572acba508c46f48c9e8b0acaf5c20e6d95cdedce1acdf6
`;
      const version = parseChromaImageVersion(fixture);
      expect(version).toBe("1.5.9");
      expect(isVulnerableChromaVersion(version!)).toBe(false);
    });

    it(":latest tag → parseChromaImageVersion returns null (not semver-pinned)", () => {
      const fixture = `
services:
  chromadb:
    image: chromadb/chroma:latest
`;
      const version = parseChromaImageVersion(fixture);
      expect(version).toBeNull();
      // null means version cannot be confirmed safe → CI should treat as fail
    });
  });
});

describe("E2: chromadb JS SDK lower-bound check", () => {
  describe("parseSdkLowerBound", () => {
    it("strips ^ prefix", () => expect(parseSdkLowerBound("^3.4.3")).toBe("3.4.3"));
    it("strips ~ prefix", () => expect(parseSdkLowerBound("~3.4.3")).toBe("3.4.3"));
    it("strips >= prefix", () => expect(parseSdkLowerBound(">=3.4.3")).toBe("3.4.3"));
    it("strips = prefix", () => expect(parseSdkLowerBound("=3.4.3")).toBe("3.4.3"));
    it("strips v prefix", () => expect(parseSdkLowerBound("v3.4.3")).toBe("3.4.3"));
    it("leaves bare version unchanged", () => expect(parseSdkLowerBound("3.4.3")).toBe("3.4.3"));
  });

  describe("isSdkVersionSafe", () => {
    // Fail cases
    it("3.4.2 → fail (below 3.4.3)", () => expect(isSdkVersionSafe("3.4.2")).toBe(false));
    it("3.4.1 → fail", () => expect(isSdkVersionSafe("3.4.1")).toBe(false));
    it("3.3.9 → fail", () => expect(isSdkVersionSafe("3.3.9")).toBe(false));
    it("2.9.9 → fail", () => expect(isSdkVersionSafe("2.9.9")).toBe(false));

    // Pass cases
    it("3.4.3 → pass (exact minimum)", () => expect(isSdkVersionSafe("3.4.3")).toBe(true));
    it("3.4.4 → pass", () => expect(isSdkVersionSafe("3.4.4")).toBe(true));
    it("3.5.0 → pass", () => expect(isSdkVersionSafe("3.5.0")).toBe(true));
    it("4.0.0 → pass", () => expect(isSdkVersionSafe("4.0.0")).toBe(true));
  });

  describe("Integration: package.json chromadb dependency", () => {
    it("current package.json chromadb dependency satisfies >= 3.4.3", async () => {
      const { readFileSync } = await import("fs");
      const { join } = await import("path");
      const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as {
        dependencies?: Record<string, string>;
      };
      const raw = pkg.dependencies?.chromadb;
      expect(raw).toBeDefined();
      const version = parseSdkLowerBound(raw!);
      expect(isSdkVersionSafe(version)).toBe(true);
    });
  });
});
