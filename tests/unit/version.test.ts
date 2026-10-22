import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import {
  CHROMA_SERVER_VERSION_ENV,
  MCP_SERVER_VERSION_ENV,
  getChromaVersion,
  getMcpVersion,
} from "../../src/version.js";

/**
 * src/version.ts — MCP wrapper / Chroma server version resolution with provenance.
 *
 * Every test starts from a clean slate for both env vars and restores the
 * original values afterwards so no state leaks into other suites.
 */

const ENV_KEYS = [MCP_SERVER_VERSION_ENV, CHROMA_SERVER_VERSION_ENV] as const;

describe("version.ts", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  describe("exported env var names", () => {
    it("should export the env var names used by Dockerfile and docker-compose", () => {
      expect(MCP_SERVER_VERSION_ENV).toBe("MCP_SERVER_VERSION");
      expect(CHROMA_SERVER_VERSION_ENV).toBe("CHROMA_SERVER_VERSION");
    });
  });

  describe("getMcpVersion", () => {
    it('should report "dev" with an unset-provenance source when MCP_SERVER_VERSION is unset', () => {
      expect(getMcpVersion()).toEqual({
        value: "dev",
        source: 'default:"dev" (MCP_SERVER_VERSION unset — non-release build)',
      });
    });

    it("should report the env value with env provenance when MCP_SERVER_VERSION is set", () => {
      process.env[MCP_SERVER_VERSION_ENV] = "3.0.16";

      expect(getMcpVersion()).toEqual({
        value: "3.0.16",
        source: "env:MCP_SERVER_VERSION (baked from release tag at image build time)",
      });
    });

    it("should trim surrounding whitespace from MCP_SERVER_VERSION", () => {
      process.env[MCP_SERVER_VERSION_ENV] = "  3.0.16  ";

      const result = getMcpVersion();

      expect(result.value).toBe("3.0.16");
      expect(result.source).toBe(
        "env:MCP_SERVER_VERSION (baked from release tag at image build time)",
      );
    });

    it('should attribute a literal "dev" to the Dockerfile ARG default', () => {
      process.env[MCP_SERVER_VERSION_ENV] = "dev";

      expect(getMcpVersion()).toEqual({
        value: "dev",
        source: 'default:"dev" (Dockerfile ARG VERSION default — non-release build)',
      });
    });

    it('should attribute a whitespace-padded "dev" to the Dockerfile ARG default', () => {
      process.env[MCP_SERVER_VERSION_ENV] = "  dev ";

      expect(getMcpVersion().source).toBe(
        'default:"dev" (Dockerfile ARG VERSION default — non-release build)',
      );
    });

    it('should treat a whitespace-only MCP_SERVER_VERSION as unset ("dev")', () => {
      process.env[MCP_SERVER_VERSION_ENV] = "   ";

      expect(getMcpVersion()).toEqual({
        value: "dev",
        source: 'default:"dev" (MCP_SERVER_VERSION unset — non-release build)',
      });
    });

    it('should treat an empty MCP_SERVER_VERSION as unset ("dev")', () => {
      process.env[MCP_SERVER_VERSION_ENV] = "";

      expect(getMcpVersion()).toEqual({
        value: "dev",
        source: 'default:"dev" (MCP_SERVER_VERSION unset — non-release build)',
      });
    });
  });

  describe("getChromaVersion", () => {
    const DECLARED_SOURCE = "env:CHROMA_SERVER_VERSION (declared at deploy time)";

    describe("with CHROMA_SERVER_VERSION declared", () => {
      it('should prefer the declared value and mark the "1.0.0" sentinel as untrusted', () => {
        process.env[CHROMA_SERVER_VERSION_ENV] = "1.5.9";

        expect(getChromaVersion("1.0.0")).toEqual({
          version: { value: "1.5.9", source: DECLARED_SOURCE },
          serverReported: "1.0.0",
          serverReportedTrusted: false,
        });
      });

      it("should prefer the declared value even when the server reports a non-sentinel value", () => {
        process.env[CHROMA_SERVER_VERSION_ENV] = "1.5.9";

        expect(getChromaVersion("1.6.0")).toEqual({
          version: { value: "1.5.9", source: DECLARED_SOURCE },
          serverReported: "1.6.0",
          serverReportedTrusted: true,
        });
      });

      it("should keep the declared value and mark trust false when the server is unreachable", () => {
        process.env[CHROMA_SERVER_VERSION_ENV] = "1.5.9";

        expect(getChromaVersion(null)).toEqual({
          version: { value: "1.5.9", source: DECLARED_SOURCE },
          serverReported: null,
          serverReportedTrusted: false,
        });
      });

      it("should trim surrounding whitespace from the declared value", () => {
        process.env[CHROMA_SERVER_VERSION_ENV] = "  1.5.9\t";

        const result = getChromaVersion("1.0.0");

        expect(result.version).toEqual({ value: "1.5.9", source: DECLARED_SOURCE });
      });
    });

    describe("without CHROMA_SERVER_VERSION declared", () => {
      it('should report "unknown" with an untrusted source explaining the hardcoded "1.0.0"', () => {
        const result = getChromaVersion("1.0.0");

        expect(result.version.value).toBe("unknown");
        expect(result.version.source).toMatch(/^untrusted:/);
        expect(result.version.source).toContain("hardcodes");
        expect(result.version.source).toContain("rust/frontend/src/server.rs");
        expect(result.version.source).toContain("CHROMA_SERVER_VERSION");
        expect(result.serverReported).toBe("1.0.0");
        expect(result.serverReportedTrusted).toBe(false);
      });

      it("should never surface the 1.0.0 sentinel as the actual version", () => {
        expect(getChromaVersion("1.0.0").version.value).not.toBe("1.0.0");
      });

      it("should trust a non-sentinel server-reported value", () => {
        expect(getChromaVersion("1.6.0")).toEqual({
          version: { value: "1.6.0", source: "server_reported:/api/v2/version" },
          serverReported: "1.6.0",
          serverReportedTrusted: true,
        });
      });

      it('should report "unknown" with an unavailable source when the server is unreachable', () => {
        expect(getChromaVersion(null)).toEqual({
          version: {
            value: "unknown",
            source: "unavailable: Chroma server version endpoint unreachable",
          },
          serverReported: null,
          serverReportedTrusted: false,
        });
      });

      it("should treat a whitespace-only CHROMA_SERVER_VERSION as undeclared", () => {
        process.env[CHROMA_SERVER_VERSION_ENV] = "   ";

        expect(getChromaVersion("1.6.0").version).toEqual({
          value: "1.6.0",
          source: "server_reported:/api/v2/version",
        });
        expect(getChromaVersion("1.0.0").version.value).toBe("unknown");
      });
    });
  });
});
