/**
 * Version reporting for the Chroma MCP wrapper and the backing Chroma server.
 *
 * Two versions are reported:
 *
 * - MCP wrapper version: baked into the image at build time from the release
 *   tag. publish-release.yml passes `VERSION` as a build-arg, and the
 *   Dockerfile maps it to `ENV MCP_SERVER_VERSION`. Builds without the
 *   build-arg report "dev". package.json is intentionally NOT a source — its
 *   version is conventionally frozen at "3.0.0" while releases are tagged
 *   independently.
 *
 * - Chroma server version: the Chroma Rust server hardcodes "1.0.0" on
 *   /api/v2/version and /openapi.json info.version (live-probed on
 *   chromadb/chroma:1.5.9 and :latest; source-verified at chroma-core/chroma
 *   tag 1.5.9, rust/frontend/src/server.rs:647-654 —
 *   `Json("1.0.0".to_string())` under a "for now return a hardcoded version"
 *   comment). The server-reported value cannot be trusted as the actual
 *   version. Operators declare the real version via CHROMA_SERVER_VERSION;
 *   when unset, report "unknown" — never a guess.
 */

/** A version value paired with an explicit description of where it came from. */
export interface SourcedVersion {
  /** The version string. */
  value: string;
  /** Explicit provenance description. */
  source: string;
}

/** Chroma server version report with provenance and trust information. */
export interface ChromaVersionReport {
  /** Best-effort actual Chroma version with provenance. */
  version: SourcedVersion;
  /** Raw value from the Chroma server /api/v2/version, null if unreachable. */
  serverReported: string | null;
  /** Whether serverReported can be treated as the real version. */
  serverReportedTrusted: boolean;
}

/** Env var carrying the MCP wrapper version (set by Dockerfile from release tag). */
export const MCP_SERVER_VERSION_ENV = "MCP_SERVER_VERSION";

/** Env var carrying the operator-declared Chroma server version. */
export const CHROMA_SERVER_VERSION_ENV = "CHROMA_SERVER_VERSION";

const DEV_FALLBACK = "dev";
const CHROMA_HARDCODED_VERSION = "1.0.0";
const UNKNOWN = "unknown";

/**
 * Returns the MCP wrapper version, read from MCP_SERVER_VERSION.
 * Falls back to "dev" for non-release builds.
 */
export function getMcpVersion(): SourcedVersion {
  const raw = process.env[MCP_SERVER_VERSION_ENV];
  const trimmed = raw === undefined ? "" : raw.trim();
  if (trimmed !== "" && trimmed !== DEV_FALLBACK) {
    return {
      value: trimmed,
      source: "env:MCP_SERVER_VERSION (baked from release tag at image build time)",
    };
  }
  return {
    value: "dev",
    source:
      trimmed === DEV_FALLBACK
        ? 'default:"dev" (Dockerfile ARG VERSION default — non-release build)'
        : 'default:"dev" (MCP_SERVER_VERSION unset — non-release build)',
  };
}

/**
 * Resolves the Chroma server version.
 *
 * Precedence: declared env (CHROMA_SERVER_VERSION) > non-sentinel
 * server-reported value > "unknown". Never guesses; the hardcoded "1.0.0"
 * sentinel is never surfaced as the actual version.
 */
export function getChromaVersion(serverReported: string | null): ChromaVersionReport {
  const raw = process.env[CHROMA_SERVER_VERSION_ENV];
  const declared = raw === undefined ? "" : raw.trim();

  if (declared !== "") {
    return {
      version: {
        value: declared,
        source: "env:CHROMA_SERVER_VERSION (declared at deploy time)",
      },
      serverReported,
      serverReportedTrusted:
        serverReported !== null && serverReported !== CHROMA_HARDCODED_VERSION,
    };
  }

  if (serverReported === null) {
    return {
      version: {
        value: UNKNOWN,
        source: "unavailable: Chroma server version endpoint unreachable",
      },
      serverReported: null,
      serverReportedTrusted: false,
    };
  }

  if (serverReported === CHROMA_HARDCODED_VERSION) {
    return {
      version: {
        value: UNKNOWN,
        source:
          'untrusted: server reports "1.0.0" but the Chroma Rust server hardcodes this value (chroma-core/chroma rust/frontend/src/server.rs:647-654, verified at tag 1.5.9) — set CHROMA_SERVER_VERSION to declare the real version',
      },
      serverReported: CHROMA_HARDCODED_VERSION,
      serverReportedTrusted: false,
    };
  }

  return {
    version: {
      value: serverReported,
      source: "server_reported:/api/v2/version",
    },
    serverReported,
    serverReportedTrusted: true,
  };
}
