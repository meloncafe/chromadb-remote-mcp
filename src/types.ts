import type { CollectionMetadata } from "chromadb";

export interface ChromaConfig {
  host: string;
  port: number;
  authToken?: string;
  tenantName?: string;
  databaseName?: string;
}

/**
 * Collection metadata schema v2.
 * Stored on every collection so add/query/get can detect provider mismatch.
 * Extends ChromaDB's CollectionMetadata so the three v2 keys are required
 * while keeping the index-signature compatibility ChromaDB expects.
 */
export type CollectionMetadataV2 = CollectionMetadata & {
  embedding_provider: string;
  embedding_model: string;
  embedding_dimensions: number;
};

/**
 * Server-wide embedding provider configuration.
 * Resolved from environment variables at startup.
 */
export interface EmbeddingProviderConfig {
  provider: string;
  model: string;
  dimensions: number;
}

/**
 * Read consistency level for ChromaDB read operations.
 * - INDEX_AND_WAL: Default. Reads from both index and WAL — sees recent writes.
 * - INDEX_ONLY: Faster but recent writes may not be visible.
 */
export const ReadLevel = {
  INDEX_AND_WAL: "INDEX_AND_WAL",
  INDEX_ONLY: "INDEX_ONLY",
} as const;
export type ReadLevel = (typeof ReadLevel)[keyof typeof ReadLevel];

/**
 * MCP-facing search payload — single SearchLike object or array of payloads.
 * Mirrors chromadb's SearchLike with arbitrary structure (passed through to SDK).
 */
export type SearchPayload = Record<string, unknown> | Array<Record<string, unknown>>;

/**
 * Boolean flag derived from CHROMA_ADMIN_TOOLS_ENABLED env var.
 * Cached at createChromaTools() entry — never re-read at runtime.
 */
export type AdminToolsEnabled = boolean;

/**
 * Boolean flag derived from CHROMA_ALLOW_DESTRUCTIVE_OPS env var.
 * Cached at createChromaTools() entry — never re-read at runtime.
 */
export type DestructiveOpsEnabled = boolean;

/**
 * Boolean flag derived from CHROMA_DISTRIBUTED_TOOLS_ENABLED env var.
 *
 * Gates 4 tools whose backing methods only exist in chromadb's distributed
 * frontend executor (Chroma Cloud or self-hosted distributed deployment),
 * NOT in the local executor that ships with `chromadb/chroma:latest`
 * single-node docker:
 *   - chroma_search             (search() — local executor: hard-coded
 *                                "Search operation is not implemented for
 *                                local executor". Algorithm itself is
 *                                single-node feasible; chromadb just hasn't
 *                                wired the endpoint into the local executor.)
 *   - chroma_fork_collection    (fork() — requires distributed
 *                                compactor + object storage stack)
 *   - chroma_get_fork_count     (forkCount() — distributed metadata store)
 *   - chroma_get_indexing_status(getIndexingStatus() — distributed WAL +
 *                                compactor services; local returns
 *                                "Method scout_logs is not implemented")
 *
 * Hidden by default so single-node deployments don't expose tools that
 * always fail server-side, wasting LLM context on retry loops.
 *
 * Cached at createChromaTools() entry — never re-read at runtime.
 */
export type DistributedToolsEnabled = boolean;