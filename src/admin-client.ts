import { AdminClient } from "chromadb";

/**
 * Lazy singleton for the AdminClient.
 *
 * ChromaDB AdminClient handles tenant / database management (R20-R24, R26).
 * It shares connection environment variables with the ChromaClient
 * (CHROMA_HOST, CHROMA_PORT, CHROMA_AUTH_TOKEN) so a single .env covers both.
 *
 * The helper is intentionally lazy — admin tools may be disabled
 * (CHROMA_ADMIN_TOOLS_ENABLED=false), in which case the SDK module is loaded
 * but the AdminClient instance is never constructed. Callers MUST gate
 * invocation on the cached ADMIN_TOOLS_ENABLED flag from chroma-tools.ts;
 * this module performs no env check itself.
 */

let adminClientInstance: AdminClient | null = null;

/**
 * Returns the singleton AdminClient, creating it on first call.
 *
 * @returns The cached AdminClient instance (same reference across calls).
 */
export function getAdminClient(): AdminClient {
  if (adminClientInstance !== null) {
    return adminClientInstance;
  }

  const host = process.env.CHROMA_HOST || "localhost";
  const port = parseInt(process.env.CHROMA_PORT || "8000", 10);
  const authToken = process.env.CHROMA_AUTH_TOKEN;

  adminClientInstance = new AdminClient({
    host,
    port,
    ssl: false,
    ...(authToken && {
      headers: {
        provider: "token",
        credentials: authToken,
      },
    }),
  });

  return adminClientInstance;
}

/**
 * Resets the cached AdminClient instance.
 * For test isolation only — do not call from production code paths.
 *
 * @internal
 */
export function resetAdminClient(): void {
  adminClientInstance = null;
}