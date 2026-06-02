import { ChromaClient, ReadLevel as SdkReadLevel } from "chromadb";
import { getAdminClient } from "./admin-client.js";
import type {
  AdminToolsEnabled,
  CollectionMetadataV2,
  DestructiveOpsEnabled,
  DistributedToolsEnabled,
  EmbeddingProviderConfig,
} from "./types.js";
import { ReadLevel } from "./types.js";

/**
 * Maps the MCP-facing ReadLevel (uppercase, e.g. "INDEX_AND_WAL") to the
 * chromadb SDK ReadLevel (lowercase, e.g. "index_and_wal"). MCP clients
 * see the uppercase form per the tool schema; the SDK requires its own form.
 */
function toSdkReadLevel(value: unknown): SdkReadLevel | undefined {
  if (value === ReadLevel.INDEX_ONLY) return SdkReadLevel.INDEX_ONLY;
  if (value === ReadLevel.INDEX_AND_WAL) return SdkReadLevel.INDEX_AND_WAL;
  return undefined;
}
import type { EmbeddingProvider } from "./embedding/provider.js";
import {
  clearProviderCache,
  getProviderForConfig,
  resolveProviderConfigForCollection,
} from "./embedding/cache.js";
import {
  applyConfidenceFilter,
  isResultEmpty,
  resolveMinScore,
} from "./confidence/filter.js";
import { rerank, type RerankCandidate } from "./reranker/client.js";

interface PaginationCursor {
  offset: number;
  limit: number;
}

/**
 * Builds collection metadata v2 from server provider config.
 * Merges user-provided metadata with required v2 keys.
 */
type MismatchResult = ReturnType<typeof assertCollectionMetadataMatch>;
type ToolResponse = { content: Array<{ type: string; text: string }> };

const LEGACY_READ_TOOLS = new Set([
  "chroma_peek_collection",
  "chroma_get_collection_info",
  "chroma_get_collection_count",
  "chroma_query_documents",
  "chroma_get_documents",
]);

const LEGACY_WRITE_TOOLS = new Set([
  "chroma_add_documents",
  "chroma_update_documents",
  "chroma_delete_documents",
]);

/**
 * Cached env flags evaluated once at module load.
 * Used by createChromaTools() to conditionally register admin / destructive
 * tools at the schema level. Runtime tool handlers MUST NOT re-read these env
 * vars — toggle behavior is fixed at boot for predictable tools/list output.
 */
export const ADMIN_TOOLS_ENABLED: AdminToolsEnabled =
  process.env.CHROMA_ADMIN_TOOLS_ENABLED?.trim().toLowerCase() === "true";

export const DESTRUCTIVE_OPS_ENABLED: DestructiveOpsEnabled =
  process.env.CHROMA_ALLOW_DESTRUCTIVE_OPS?.trim().toLowerCase() === "true";

export const DISTRIBUTED_TOOLS_ENABLED: DistributedToolsEnabled =
  process.env.CHROMA_DISTRIBUTED_TOOLS_ENABLED?.trim().toLowerCase() === "true";

/**
 * Implements R32: when LEGACY_COLLECTION_COMPAT=true and the collection is a
 * legacy v1 (no v2 metadata), allow read tools through (with a warn) and reject
 * write tools with a structured error. Non-legacy mismatches (provider/model
 * disagreement on a v2 collection) still produce the original error.
 */
function handleLegacyCompat(
  match: MismatchResult,
  toolName: string,
): ToolResponse | null {
  if (match.ok) return null;

  const compat = process.env.LEGACY_COLLECTION_COMPAT === "true";
  if (compat && match.reason === "legacy") {
    if (LEGACY_READ_TOOLS.has(toolName)) {
      console.warn(
        `[legacy-compat] Reading legacy v1 collection via ${toolName} — re-index recommended.`,
      );
      return null;
    }
    if (LEGACY_WRITE_TOOLS.has(toolName)) {
      return {
        content: [
          { type: "text", text: "Error: Cannot write to legacy v1 collection" },
        ],
      };
    }
  }

  return { content: [{ type: "text", text: match.message }] };
}

/**
 * Validates that pre-computed embedding dimensions match the collection metadata.
 * Returns null on match or when collection has no v2 metadata (legacy handled elsewhere).
 * Returns error message string on mismatch.
 */
/**
 * Returns true when the provider id requires server-side embed() invocation.
 * chromadb-default → ChromaDB embeds internally; external → caller pre-computes.
 */
function shouldServerEmbed(providerId: string): boolean {
  return (
    providerId === "openai_compatible" ||
    providerId === "gemini" ||
    providerId === "voyage"
  );
}

export function validateEmbeddingDimensions(
  embeddings: number[][] | undefined,
  collectionMetadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!embeddings || embeddings.length === 0) return null;
  const meta = collectionMetadata || {};
  const expected = meta.embedding_dimensions;
  if (typeof expected !== "number") return null;
  for (let i = 0; i < embeddings.length; i++) {
    const got = embeddings[i].length;
    if (got !== expected) {
      return `Error: Embedding dimension mismatch (got ${got}, expected ${expected})`;
    }
  }
  return null;
}

export function buildCollectionMetadata(
  serverCfg: EmbeddingProviderConfig,
  userMetadata?: Record<string, unknown>,
): CollectionMetadataV2 {
  return {
    ...(userMetadata || {}),
    embedding_provider: serverCfg.provider,
    embedding_model: serverCfg.model,
    embedding_dimensions: serverCfg.dimensions,
  };
}

/**
 * Asserts that collection metadata matches server provider config.
 * Returns null on match, error message string on mismatch.
 * Legacy v1 collections (no metadata) return a "legacy" sentinel for Phase 8 hook.
 */
export function assertCollectionMetadataMatch(
  collectionMetadata: Record<string, unknown> | null | undefined,
  serverCfg: EmbeddingProviderConfig,
): { ok: true } | { ok: false; reason: "legacy" | "mismatch"; message: string } {
  const meta = collectionMetadata || {};
  const provider = meta.embedding_provider;
  const model = meta.embedding_model;
  const dimensions = meta.embedding_dimensions;

  if (provider === undefined && model === undefined && dimensions === undefined) {
    return {
      ok: false,
      reason: "legacy",
      message:
        "Error: Embedding provider mismatch — collection has no v2 metadata (legacy v1 collection). " +
        "Set LEGACY_COLLECTION_COMPAT=true to read v1 collections, or re-index with v2 schema.",
    };
  }

  if (provider !== serverCfg.provider || model !== serverCfg.model || dimensions !== serverCfg.dimensions) {
    return {
      ok: false,
      reason: "mismatch",
      message:
        `Error: Embedding provider mismatch — collection uses ` +
        `provider=${String(provider)} model=${String(model)} dimensions=${String(dimensions)}, ` +
        `but server is configured with ` +
        `provider=${serverCfg.provider} model=${serverCfg.model} dimensions=${serverCfg.dimensions}. ` +
        `Re-index the collection or align server EMBEDDING_PROVIDER configuration.`,
    };
  }

  return { ok: true };
}

/**
 * Encodes pagination cursor to base64 string for stateless pagination.
 * @param offset - Starting position in result set.
 * @param limit - Maximum number of results per page.
 * @returns Base64-encoded cursor string.
 */
export function encodeCursor(offset: number, limit: number): string {
  const cursor: PaginationCursor = { offset, limit };
  return Buffer.from(JSON.stringify(cursor)).toString("base64");
}

/**
 * Decodes base64 cursor string back to pagination parameters.
 * @param cursor - Base64-encoded cursor string.
 * @returns Pagination cursor with offset and limit, or defaults if invalid.
 */
export function decodeCursor(cursor: string): PaginationCursor {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);
    return {
      offset: parseInt(parsed.offset || "0", 10),
      limit: parseInt(parsed.limit || "10", 10),
    };
  } catch {
    return { offset: 0, limit: 10 };
  }
}

/**
 * Creates pagination metadata with navigation cursors.
 * @param offset - Current offset in result set.
 * @param limit - Page size.
 * @param total - Total number of results available.
 * @returns Metadata with next/previous cursors and hasMore flag.
 */
export function createPaginationMetadata(
  offset: number,
  limit: number,
  total: number,
): {
  nextCursor?: string;
  prevCursor?: string;
  hasMore: boolean;
  total: number;
} {
  const hasMore = offset + limit < total;
  const nextCursor = hasMore ? encodeCursor(offset + limit, limit) : undefined;
  const prevCursor = offset > 0 ? encodeCursor(Math.max(0, offset - limit), limit) : undefined;

  return {
    nextCursor,
    prevCursor,
    hasMore,
    total,
  };
}

/**
 * Sanitizes error messages to prevent information disclosure in production.
 * @param error - Error to sanitize.
 * @returns Sanitized error message safe for client exposure.
 */
function sanitizeErrorMessage(error: unknown): string {
  const isProduction = process.env.NODE_ENV === "production";

  if (!isProduction) {
    return error instanceof Error ? error.message : String(error);
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (
      message.includes("validation") ||
      message.includes("invalid") ||
      message.includes("required")
    ) {
      return "Invalid request parameters";
    }

    if (message.includes("not found") || message.includes("does not exist")) {
      return "Resource not found";
    }

    if (message.includes("already exists") || message.includes("duplicate")) {
      return "Resource already exists";
    }

    if (
      message.includes("chromadb") ||
      message.includes("database") ||
      message.includes("collection")
    ) {
      return "Database operation failed";
    }

    return "Operation failed";
  }

  return "Operation failed";
}

/**
 * Validates collection name against ChromaDB naming rules.
 * @param name - Collection name to validate (accepts any type for runtime validation).
 * @returns Validation result with error message if invalid.
 */
export function validateCollectionName(name: unknown): { valid: boolean; error?: string } {
  if (!name || typeof name !== "string") {
    return { valid: false, error: "Collection name must be a non-empty string" };
  }
  if (name.length > 63) {
    return { valid: false, error: "Collection name must be 63 characters or less" };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return {
      valid: false,
      error: "Collection name must contain only alphanumeric characters, underscores, and hyphens",
    };
  }
  return { valid: true };
}

/**
 * Validates document ID array structure and contents.
 * @param ids - Array of document IDs to validate (accepts any type for runtime validation).
 * @returns Validation result with error message if invalid.
 */
export function validateDocumentIds(ids: unknown): { valid: boolean; error?: string } {
  if (!Array.isArray(ids)) {
    return { valid: false, error: "Document IDs must be an array" };
  }
  if (ids.length === 0) {
    return { valid: false, error: "Document IDs array cannot be empty" };
  }
  for (const id of ids) {
    if (!id || typeof id !== "string") {
      return { valid: false, error: "All document IDs must be non-empty strings" };
    }
  }
  return { valid: true };
}

/**
 * Creates MCP tool definitions for ChromaDB operations.
 * @param _chromaClient - ChromaDB client instance (unused, for API consistency).
 * @returns Array of MCP tool definitions with schemas.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function createChromaTools(_chromaClient: ChromaClient): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      name: "chroma_list_collections",
      description: "List all collection names in the Chroma database with pagination support",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Optional maximum number of collections to return",
            default: 100,
          },
          offset: {
            type: "number",
            description: "Optional number of collections to skip before returning results",
            default: 0,
          },
        },
      },
    },
    {
      name: "chroma_create_collection",
      description: "Create a new Chroma collection with configurable parameters",
      inputSchema: {
        type: "object",
        properties: {
          collection_name: {
            type: "string",
            description: "Name of the collection to create",
          },
          metadata: {
            type: "object",
            description: "Optional metadata dict to add to the collection",
          },
          configuration: {
            type: "object",
            description: "Optional collection configuration (HNSW/SPANN params, e.g. { hnsw: { space: 'cosine' } }). Forwarded to ChromaDB SDK as-is.",
          },
          schema: {
            type: "object",
            description: "Optional Schema object describing index configuration (advanced — see chromadb 3.x Schema docs).",
          },
        },
        required: ["collection_name"],
      },
    },
    {
      name: "chroma_peek_collection",
      description: "Peek at documents in a Chroma collection",
      inputSchema: {
        type: "object",
        properties: {
          collection_name: {
            type: "string",
            description: "Name of the collection to peek into",
          },
          limit: {
            type: "number",
            description: "Number of documents to peek at",
            default: 5,
          },
        },
        required: ["collection_name"],
      },
    },
    {
      name: "chroma_get_collection_info",
      description: "Get information about a Chroma collection",
      inputSchema: {
        type: "object",
        properties: {
          collection_name: {
            type: "string",
            description: "Name of the collection to get info about",
          },
        },
        required: ["collection_name"],
      },
    },
    {
      name: "chroma_get_collection_count",
      description: "Get the number of documents in a Chroma collection",
      inputSchema: {
        type: "object",
        properties: {
          collection_name: {
            type: "string",
            description: "Name of the collection to count",
          },
          read_level: {
            type: "string",
            enum: ["INDEX_AND_WAL", "INDEX_ONLY"],
            default: "INDEX_AND_WAL",
            description: "Read consistency level. INDEX_ONLY is faster but may miss recent writes.",
          },
        },
        required: ["collection_name"],
      },
    },
    {
      name: "chroma_delete_collection",
      description: "Delete a Chroma collection",
      inputSchema: {
        type: "object",
        properties: {
          collection_name: {
            type: "string",
            description: "Name of the collection to delete",
          },
        },
        required: ["collection_name"],
      },
    },
    {
      name: "chroma_add_documents",
      description: "Add documents to a Chroma collection",
      inputSchema: {
        type: "object",
        properties: {
          collection_name: {
            type: "string",
            description: "Name of the collection to add documents to",
          },
          documents: {
            type: "array",
            items: { type: "string" },
            description: "List of text documents to add (external mode: optional if embeddings given)",
          },
          embeddings: {
            type: "array",
            items: {
              type: "array",
              items: { type: "number" },
            },
            description:
              "List of pre-computed embeddings (float 2D array). Required in external mode if documents are not provided.",
          },
          ids: {
            type: "array",
            items: { type: "string" },
            description: "List of IDs for the documents (required)",
          },
          metadatas: {
            type: "array",
            items: { type: "object" },
            description: "Optional list of metadata dictionaries for each document",
          },
          uris: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of URIs (one per record) for multi-modal references.",
          },
        },
        required: ["collection_name", "ids"],
      },
    },
    {
      name: "chroma_query_documents",
      description: "Query documents from a Chroma collection with filtering",
      inputSchema: {
        type: "object",
        properties: {
          collection_name: {
            type: "string",
            description: "Name of the collection to query",
          },
          query_texts: {
            type: "array",
            items: { type: "string" },
            description: "List of query texts to search for (external mode: optional if query_embeddings given)",
          },
          query_embeddings: {
            type: "array",
            items: {
              type: "array",
              items: { type: "number" },
            },
            description:
              "List of pre-computed query embeddings (float 2D array). Required in external mode if query_texts are not provided.",
          },
          query_uris: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of query URIs (multi-modal queries). Forwarded to SDK as queryURIs.",
          },
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Optional pre-filter — restrict query to these record IDs only.",
          },
          n_results: {
            type: "number",
            description: "Number of results to return per query",
            default: 5,
          },
          where: {
            type: "object",
            description: "Optional metadata filters using Chroma's query operators",
          },
          where_document: {
            type: "object",
            description: "Optional document content filters",
          },
          include: {
            type: "array",
            items: { type: "string" },
            description: "List of what to include in response",
            default: ["documents", "metadatas", "distances"],
          },
          min_score: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description:
              "Confidence threshold (0-1). Items below this similarity score are filtered. Defaults to CONFIDENCE_THRESHOLD env or 0 (disabled).",
          },
          rerank: {
            type: "boolean",
            description:
              "When true, fetches rerank_top_n results then re-ranks via RERANKER_API_BASE to top-K (R19). No-op if reranker not configured.",
          },
          rerank_top_n: {
            type: "number",
            description: "Initial candidate count to fetch from ChromaDB before reranking (default 20).",
          },
          rerank_top_k: {
            type: "number",
            description: "Final result count after reranking (default 5).",
          },
        },
        required: ["collection_name"],
      },
    },
    {
      name: "chroma_get_documents",
      description:
        "Get documents from a Chroma collection with optional filtering and cursor-based pagination",
      inputSchema: {
        type: "object",
        properties: {
          collection_name: {
            type: "string",
            description: "Name of the collection to get documents from",
          },
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of document IDs to retrieve",
          },
          where: {
            type: "object",
            description: "Optional metadata filters",
          },
          where_document: {
            type: "object",
            description: "Optional document content filters",
          },
          include: {
            type: "array",
            items: { type: "string" },
            description: "List of what to include in response",
            default: ["documents", "metadatas"],
          },
          limit: {
            type: "number",
            description: "Optional maximum number of documents to return (default: 10)",
          },
          offset: {
            type: "number",
            description:
              "DEPRECATED: Use cursor instead. Optional number of documents to skip before returning results",
          },
          cursor: {
            type: "string",
            description:
              "Optional cursor for pagination. Use nextCursor from previous response to get next page.",
          },
          read_level: {
            type: "string",
            enum: ["INDEX_AND_WAL", "INDEX_ONLY"],
            default: "INDEX_AND_WAL",
            description: "Read consistency level. INDEX_ONLY is faster but may miss recent writes.",
          },
        },
        required: ["collection_name"],
      },
    },
    {
      name: "chroma_update_documents",
      description: "Update documents in a Chroma collection",
      inputSchema: {
        type: "object",
        properties: {
          collection_name: {
            type: "string",
            description: "Name of the collection to update documents in",
          },
          ids: {
            type: "array",
            items: { type: "string" },
            description: "List of document IDs to update (required)",
          },
          documents: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of new text documents",
          },
          metadatas: {
            type: "array",
            items: { type: "object" },
            description: "Optional list of new metadata dictionaries",
          },
          embeddings: {
            type: "array",
            items: {
              type: "array",
              items: { type: "number" },
            },
            description: "Optional list of pre-computed embeddings (float 2D array). External-provider mode requires this when documents are provided.",
          },
          uris: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of URIs (one per record) for multi-modal references.",
          },
        },
        required: ["collection_name", "ids"],
      },
    },
    {
      name: "chroma_delete_documents",
      description: "Delete documents from a Chroma collection by ids and/or metadata filter",
      inputSchema: {
        type: "object",
        properties: {
          collection_name: {
            type: "string",
            description: "Name of the collection to delete documents from",
          },
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of document IDs to delete. At least one of ids, where, where_document must be provided.",
          },
          where: {
            type: "object",
            description: "Optional metadata filter — delete documents matching these conditions.",
          },
          where_document: {
            type: "object",
            description: "Optional document content filter — delete documents matching these conditions.",
          },
          limit: {
            type: "number",
            description: "Optional cap on number of records to delete. Only valid when used with where or where_document filters.",
          },
        },
        required: ["collection_name"],
      },
    },
    {
      name: "chroma_upsert_documents",
      description: "Insert or update documents in a Chroma collection (idempotent on ids)",
      inputSchema: {
        type: "object",
        properties: {
          collection_name: {
            type: "string",
            description: "Name of the collection to upsert documents into",
          },
          documents: {
            type: "array",
            items: { type: "string" },
            description: "List of text documents to upsert (external mode: optional if embeddings given)",
          },
          embeddings: {
            type: "array",
            items: {
              type: "array",
              items: { type: "number" },
            },
            description: "List of pre-computed embeddings (float 2D array). Required in external mode if documents are not provided.",
          },
          ids: {
            type: "array",
            items: { type: "string" },
            description: "List of IDs for the documents (required)",
          },
          metadatas: {
            type: "array",
            items: { type: "object" },
            description: "Optional list of metadata dictionaries for each document",
          },
          uris: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of URIs (one per record) for multi-modal references.",
          },
        },
        required: ["collection_name", "ids"],
      },
    },
    {
      name: "chroma_modify_collection",
      description: "Modify a Chroma collection's name, metadata, or configuration",
      inputSchema: {
        type: "object",
        properties: {
          collection_name: {
            type: "string",
            description: "Current name of the collection to modify",
          },
          new_name: {
            type: "string",
            description: "Optional new name for the collection",
          },
          metadata: {
            type: "object",
            description: "Optional new metadata for the collection",
          },
          configuration: {
            type: "object",
            description: "Optional new configuration settings (UpdateCollectionConfiguration)",
          },
        },
        required: ["collection_name"],
      },
    },
    {
      name: "chroma_get_or_create_collection",
      description: "Get an existing Chroma collection or create it if it does not exist (idempotent)",
      inputSchema: {
        type: "object",
        properties: {
          collection_name: {
            type: "string",
            description: "Name of the collection to get or create",
          },
          metadata: {
            type: "object",
            description: "Optional metadata dict (used only if creating)",
          },
          configuration: {
            type: "object",
            description: "Optional collection configuration (HNSW/SPANN params, used only if creating)",
          },
          schema: {
            type: "object",
            description: "Optional Schema object (used only if creating)",
          },
        },
        required: ["collection_name"],
      },
    },
    {
      name: "chroma_heartbeat",
      description: "Send a heartbeat request to the Chroma server (returns nanosecond timestamp)",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "chroma_get_server_version",
      description: "Get the version of the connected Chroma server",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "chroma_count_collections",
      description: "Get the total number of collections in the current Chroma database",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "chroma_get_max_batch_size",
      description: "Get the maximum batch size supported by the Chroma server (for client-side splitting)",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "chroma_get_user_identity",
      description: "Get the current user identity (tenant + accessible databases)",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ];

  if (DISTRIBUTED_TOOLS_ENABLED) {
    tools.push(
      {
        name: "chroma_search",
        description: "Hybrid search on a Chroma collection (dense + sparse via SearchLike payload)",
        inputSchema: {
          type: "object",
          properties: {
            collection_name: {
              type: "string",
              description: "Name of the collection to search",
            },
            payload: {
              description: "SearchLike payload — single object or array of payloads. Forwarded to collection.search() as-is.",
              oneOf: [
                { type: "object" },
                { type: "array", items: { type: "object" } },
              ],
            },
            read_level: {
              type: "string",
              enum: ["INDEX_AND_WAL", "INDEX_ONLY"],
              default: "INDEX_AND_WAL",
              description: "Read consistency level. INDEX_ONLY is faster but may miss recent writes.",
            },
          },
          required: ["collection_name", "payload"],
        },
      },
      {
        name: "chroma_fork_collection",
        description: "Create a zero-copy fork of a Chroma collection with a new name",
        inputSchema: {
          type: "object",
          properties: {
            collection_name: {
              type: "string",
              description: "Name of the source collection to fork",
            },
            new_name: {
              type: "string",
              description: "Name for the new forked collection",
            },
          },
          required: ["collection_name", "new_name"],
        },
      },
      {
        name: "chroma_get_fork_count",
        description: "Get the number of forks for a Chroma collection",
        inputSchema: {
          type: "object",
          properties: {
            collection_name: {
              type: "string",
              description: "Name of the collection to query fork count for",
            },
          },
          required: ["collection_name"],
        },
      },
      {
        name: "chroma_get_indexing_status",
        description: "Get the indexing status of a Chroma collection (WAL/index progress)",
        inputSchema: {
          type: "object",
          properties: {
            collection_name: {
              type: "string",
              description: "Name of the collection to inspect indexing status",
            },
          },
          required: ["collection_name"],
        },
      },
    );
  }

  // Phase 1 — conditional schema-level filtering for admin / destructive tools.
  // Tool definitions for these groups are pushed in later phases (R20–R26),
  // gated by the cached env flags below. Keeping the structure now avoids
  // re-touching createChromaTools() in every subsequent phase.
  if (ADMIN_TOOLS_ENABLED) {
    tools.push(
      {
        name: "chroma_admin_create_database",
        description: "Create a new database within a tenant (admin operation)",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the database to create",
            },
            tenant: {
              type: "string",
              description: "Tenant that will own the database",
            },
          },
          required: ["name", "tenant"],
        },
      },
      {
        name: "chroma_admin_get_database",
        description: "Retrieve information about a specific database (admin operation)",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the database to retrieve",
            },
            tenant: {
              type: "string",
              description: "Tenant that owns the database",
            },
          },
          required: ["name", "tenant"],
        },
      },
      {
        name: "chroma_admin_list_databases",
        description: "List all databases within a tenant (admin operation)",
        inputSchema: {
          type: "object",
          properties: {
            tenant: {
              type: "string",
              description: "Tenant whose databases to list",
            },
            limit: {
              type: "number",
              description: "Maximum number of databases to return (default 100)",
              default: 100,
            },
            offset: {
              type: "number",
              description: "Number of databases to skip (default 0)",
              default: 0,
            },
          },
          required: ["tenant"],
        },
      },
      {
        name: "chroma_admin_create_tenant",
        description: "Create a new tenant (admin operation)",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the tenant to create",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "chroma_admin_get_tenant",
        description: "Retrieve information about a specific tenant (admin operation)",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the tenant to retrieve",
            },
          },
          required: ["name"],
        },
      },
    );
  }

  if (DESTRUCTIVE_OPS_ENABLED) {
    tools.push({
      name: "chroma_reset_database",
      description: "[DESTRUCTIVE] Reset the entire Chroma database — irreversible, deletes all collections and data",
      inputSchema: {
        type: "object",
        properties: {},
      },
    });
  }

  if (ADMIN_TOOLS_ENABLED && DESTRUCTIVE_OPS_ENABLED) {
    tools.push({
      name: "chroma_admin_delete_database",
      description: "[DESTRUCTIVE] Delete a database and all its data (admin operation, irreversible)",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Name of the database to delete",
          },
          tenant: {
            type: "string",
            description: "Tenant that owns the database",
          },
        },
        required: ["name", "tenant"],
      },
    });
  }

  return tools;
}

/**
 * Handles execution of ChromaDB MCP tools.
 * @param chromaClient - ChromaDB client instance.
 * @param toolName - Name of the tool to execute.
 * @param args - Tool arguments as key-value pairs.
 * @returns MCP response with content array.
 */
export async function handleChromaTool(
  chromaClient: ChromaClient,
  toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>,
  serverProviderCfg: EmbeddingProviderConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    switch (toolName) {
      case "chroma_list_collections": {
        const collections = await chromaClient.listCollections(args);
        const collectionNames = collections.map((c) => c.name);
        return {
          content: [
            {
              type: "text",
              text:
                collectionNames.length > 0
                  ? JSON.stringify(collectionNames, null, 2)
                  : JSON.stringify(["__NO_COLLECTIONS_FOUND__"]),
            },
          ],
        };
      }

      case "chroma_create_collection": {
        const nameValidation = validateCollectionName(args.collection_name);
        if (!nameValidation.valid) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${nameValidation.error}`,
              },
            ],
          };
        }

        await chromaClient.createCollection({
          name: args.collection_name,
          metadata: buildCollectionMetadata(serverProviderCfg, args.metadata),
          ...(args.configuration !== undefined && { configuration: args.configuration }),
          ...(args.schema !== undefined && { schema: args.schema }),
        });
        return {
          content: [
            {
              type: "text",
              text: `Collection '${args.collection_name}' created successfully`,
            },
          ],
        };
      }

      case "chroma_peek_collection": {
        const collection = await chromaClient.getCollection({ name: args.collection_name });
        const matchResult = assertCollectionMetadataMatch(collection.metadata, serverProviderCfg);
        const compatGuard = handleLegacyCompat(matchResult, toolName);
        if (compatGuard !== null) {
          return compatGuard;
        }
        const results = await collection.peek({ limit: args.limit || 5 });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case "chroma_get_collection_info": {
        const collection = await chromaClient.getCollection({ name: args.collection_name });
        const matchResult = assertCollectionMetadataMatch(collection.metadata, serverProviderCfg);
        const compatGuard = handleLegacyCompat(matchResult, toolName);
        if (compatGuard !== null) {
          return compatGuard;
        }
        const count = await collection.count();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  name: args.collection_name,
                  count,
                  metadata: collection.metadata,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "chroma_get_collection_count": {
        const collection = await chromaClient.getCollection({ name: args.collection_name });
        const matchResult = assertCollectionMetadataMatch(collection.metadata, serverProviderCfg);
        const compatGuard = handleLegacyCompat(matchResult, toolName);
        if (compatGuard !== null) {
          return compatGuard;
        }
        const sdkReadLevel = toSdkReadLevel(args.read_level);
        const count = await collection.count(
          sdkReadLevel !== undefined ? { readLevel: sdkReadLevel } : undefined,
        );
        return {
          content: [
            {
              type: "text",
              text: `Collection '${args.collection_name}' has ${count} documents`,
            },
          ],
        };
      }

      case "chroma_delete_collection": {
        // R13 (v2.1.2): ChromaDB v2 SDK 의 deleteCollection 이 정상 삭제 후에도
        // 응답 파싱에서 throw 하는 회귀 (실제 삭제는 성공). listCollections 로 실제
        // 상태를 확인하여 silent recovery — 진짜 실패만 throw 전파.
        try {
          await chromaClient.deleteCollection({ name: args.collection_name });
        } catch (deleteErr) {
          const collections = await chromaClient.listCollections();
          const stillExists = collections.some(
            (c) => (typeof c === "string" ? c : (c as { name: string }).name) === args.collection_name,
          );
          if (stillExists) {
            throw deleteErr;
          }
        }
        return {
          content: [
            {
              type: "text",
              text: `Collection '${args.collection_name}' deleted successfully`,
            },
          ],
        };
      }

      case "chroma_add_documents": {
        const collection = await chromaClient.getCollection({ name: args.collection_name });
        const matchResult = assertCollectionMetadataMatch(collection.metadata, serverProviderCfg);
        const compatGuard = handleLegacyCompat(matchResult, toolName);
        if (compatGuard !== null) {
          return compatGuard;
        }

        const hasDocuments = Array.isArray(args.documents) && args.documents.length > 0;
        const hasEmbeddings = Array.isArray(args.embeddings) && args.embeddings.length > 0;

        if (!hasDocuments && !hasEmbeddings) {
          return {
            content: [{ type: "text", text: "Error: documents or embeddings required" }],
          };
        }

        if (hasEmbeddings) {
          const dimError = validateEmbeddingDimensions(args.embeddings, collection.metadata);
          if (dimError) {
            return { content: [{ type: "text", text: dimError }] };
          }
        }

        const effectiveProviderId =
          (collection.metadata?.embedding_provider as string | undefined) ||
          serverProviderCfg.provider;
        if (effectiveProviderId === "external" && hasDocuments && !hasEmbeddings) {
          return {
            content: [
              {
                type: "text",
                text:
                  "Error: External embedding mode requires pre-computed embeddings. " +
                  "Pass the 'embeddings' argument (a 2D float array sized to the collection's embedding_dimensions) " +
                  "instead of 'documents' only.",
              },
            ],
          };
        }

        const collectionCfg = resolveProviderConfigForCollection(
          serverProviderCfg,
          collection.metadata,
        );
        const provider: EmbeddingProvider = getProviderForConfig(collectionCfg);

        let finalEmbeddings: number[][] | undefined;
        const taskType: "document" = "document";
        if (hasEmbeddings) {
          finalEmbeddings = args.embeddings;
        } else if (shouldServerEmbed(provider.getProviderId())) {
          finalEmbeddings = await provider.embed(args.documents, taskType);
        }

        await collection.add({
          ids: args.ids,
          documents: hasDocuments ? args.documents : undefined,
          embeddings: finalEmbeddings,
          metadatas: args.metadatas,
          ...(Array.isArray(args.uris) && args.uris.length > 0 && { uris: args.uris }),
        });

        const count = hasDocuments ? args.documents.length : args.embeddings.length;
        return {
          content: [
            {
              type: "text",
              text: `Added ${count} documents to collection '${args.collection_name}'`,
            },
          ],
        };
      }

      case "chroma_query_documents": {
        const collection = await chromaClient.getCollection({ name: args.collection_name });
        const matchResult = assertCollectionMetadataMatch(collection.metadata, serverProviderCfg);
        const compatGuard = handleLegacyCompat(matchResult, toolName);
        if (compatGuard !== null) {
          return compatGuard;
        }

        const hasQueryTexts = Array.isArray(args.query_texts) && args.query_texts.length > 0;
        const hasQueryEmbeddings =
          Array.isArray(args.query_embeddings) && args.query_embeddings.length > 0;

        if (!hasQueryTexts && !hasQueryEmbeddings) {
          return {
            content: [
              { type: "text", text: "Error: query_texts or query_embeddings required" },
            ],
          };
        }

        if (hasQueryEmbeddings) {
          const dimError = validateEmbeddingDimensions(args.query_embeddings, collection.metadata);
          if (dimError) {
            return { content: [{ type: "text", text: dimError }] };
          }
        }

        const effectiveProviderIdQ =
          (collection.metadata?.embedding_provider as string | undefined) ||
          serverProviderCfg.provider;
        if (effectiveProviderIdQ === "external" && hasQueryTexts && !hasQueryEmbeddings) {
          return {
            content: [
              {
                type: "text",
                text:
                  "Error: External embedding mode requires pre-computed query embeddings. " +
                  "Pass the 'query_embeddings' argument (a 2D float array sized to the collection's embedding_dimensions) " +
                  "instead of 'query_texts'.",
              },
            ],
          };
        }

        const collectionCfgQ = resolveProviderConfigForCollection(
          serverProviderCfg,
          collection.metadata,
        );
        const providerQ: EmbeddingProvider = getProviderForConfig(collectionCfgQ);

        let finalQueryEmbeddings: number[][] | undefined;
        const taskType: "query" = "query";
        if (hasQueryEmbeddings) {
          finalQueryEmbeddings = args.query_embeddings;
        } else if (shouldServerEmbed(providerQ.getProviderId())) {
          finalQueryEmbeddings = await providerQ.embed(args.query_texts, taskType);
        }

        const results = await collection.query({
          queryTexts: hasQueryTexts && !finalQueryEmbeddings ? args.query_texts : undefined,
          queryEmbeddings: finalQueryEmbeddings,
          ...(Array.isArray(args.query_uris) && args.query_uris.length > 0 && { queryURIs: args.query_uris }),
          ...(Array.isArray(args.ids) && args.ids.length > 0 && { ids: args.ids }),
          nResults: args.n_results || 5,
          where: args.where,
          whereDocument: args.where_document,
          include: args.include || ["documents", "metadatas", "distances"],
        });

        let workingResults = results as unknown as Parameters<typeof applyConfidenceFilter>[0];

        if (args.rerank === true) {
          const topN = typeof args.rerank_top_n === "number" ? args.rerank_top_n : 20;
          const topK = typeof args.rerank_top_k === "number" ? args.rerank_top_k : 5;

          const queryString = hasQueryTexts
            ? args.query_texts[0]
            : "";

          const idsGroup = workingResults.ids?.[0] ?? [];
          const docsGroup = workingResults.documents?.[0] ?? [];
          const metasGroup = workingResults.metadatas?.[0] ?? [];
          const distsGroup = workingResults.distances?.[0] ?? [];

          const sliceN = Math.min(idsGroup.length, topN);
          const candidates: RerankCandidate[] = [];
          for (let i = 0; i < sliceN; i++) {
            candidates.push({
              id: idsGroup[i],
              document: docsGroup[i] ?? null,
              metadata: metasGroup[i] ?? null,
              distance: distsGroup[i] ?? null,
            });
          }

          const ranking = await rerank(queryString, candidates, topK);

          workingResults = {
            ids: [ranking.indices.map((i) => candidates[i].id)],
            documents: workingResults.documents
              ? [ranking.indices.map((i) => candidates[i].document)]
              : undefined,
            metadatas: workingResults.metadatas
              ? [ranking.indices.map((i) => candidates[i].metadata)]
              : undefined,
            distances: workingResults.distances
              ? [ranking.indices.map((i) => candidates[i].distance)]
              : undefined,
            include: workingResults.include,
          };
        }

        const minScore = resolveMinScore(args.min_score, process.env.CONFIDENCE_THRESHOLD);
        const filtered = applyConfidenceFilter(workingResults, minScore);
        const responseBody: Record<string, unknown> = {
          ...filtered.results,
        };
        if (filtered.filtered && isResultEmpty(filtered.results)) {
          responseBody.confidence_gate = "no_confident_match";
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(responseBody, null, 2),
            },
          ],
        };
      }

      case "chroma_get_documents": {
        const collection = await chromaClient.getCollection({ name: args.collection_name });
        const matchResult = assertCollectionMetadataMatch(collection.metadata, serverProviderCfg);
        const compatGuard = handleLegacyCompat(matchResult, toolName);
        if (compatGuard !== null) {
          return compatGuard;
        }

        // Cursor-based pagination
        let offset = 0;
        let limit = 10;

        if (args.cursor) {
          // Use cursor for pagination
          const decoded = decodeCursor(args.cursor);
          offset = decoded.offset;
          limit = decoded.limit;
        } else if (args.offset !== undefined || args.limit !== undefined) {
          // Fall back to offset/limit for backward compatibility
          offset = args.offset || 0;
          limit = args.limit || 10;
        }

        // Get total count for pagination metadata
        const totalCount = await collection.count();

        const sdkReadLevel = toSdkReadLevel(args.read_level);
        const results = await collection.get({
          ids: args.ids,
          where: args.where,
          whereDocument: args.where_document,
          include: args.include || ["documents", "metadatas"],
          limit,
          offset,
          ...(sdkReadLevel !== undefined && { readLevel: sdkReadLevel }),
        });

        // Add pagination metadata
        const pagination = createPaginationMetadata(offset, limit, totalCount);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ...results,
                  pagination,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "chroma_update_documents": {
        const collection = await chromaClient.getCollection({ name: args.collection_name });
        const matchResult = assertCollectionMetadataMatch(collection.metadata, serverProviderCfg);
        const compatGuard = handleLegacyCompat(matchResult, toolName);
        if (compatGuard !== null) {
          return compatGuard;
        }

        // R12 (v2.1.2): 존재하지 않는 id 에 대한 update 가 ChromaDB SDK 측에서
        // silent pass 되는 회귀 — 사전 collection.get 으로 누락 id 검증.
        if (Array.isArray(args.ids) && args.ids.length > 0) {
          const existing = await collection.get({ ids: args.ids as string[] });
          const existingIds = new Set(existing.ids);
          const missingIds = (args.ids as string[]).filter((id) => !existingIds.has(id));
          if (missingIds.length > 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ids not found in collection '${args.collection_name}': ${missingIds.join(", ")}`,
                },
              ],
            };
          }
        }

        const hasDocuments = Array.isArray(args.documents) && args.documents.length > 0;
        const hasEmbeddings = Array.isArray(args.embeddings) && args.embeddings.length > 0;

        if (hasEmbeddings) {
          const dimError = validateEmbeddingDimensions(args.embeddings, collection.metadata);
          if (dimError) {
            return { content: [{ type: "text", text: dimError }] };
          }
        }

        const effectiveProviderId =
          (collection.metadata?.embedding_provider as string | undefined) ||
          serverProviderCfg.provider;
        if (effectiveProviderId === "external" && hasDocuments && !hasEmbeddings) {
          return {
            content: [
              {
                type: "text",
                text:
                  "Error: External embedding mode requires pre-computed embeddings. " +
                  "Pass the 'embeddings' argument (a 2D float array sized to the collection's embedding_dimensions) " +
                  "instead of 'documents' only.",
              },
            ],
          };
        }

        let finalEmbeddings: number[][] | undefined;
        if (hasEmbeddings) {
          finalEmbeddings = args.embeddings;
        } else if (hasDocuments) {
          const collectionCfg = resolveProviderConfigForCollection(
            serverProviderCfg,
            collection.metadata,
          );
          const provider: EmbeddingProvider = getProviderForConfig(collectionCfg);
          const taskType: "document" = "document";
          if (shouldServerEmbed(provider.getProviderId())) {
            finalEmbeddings = await provider.embed(args.documents, taskType);
          }
        }

        await collection.update({
          ids: args.ids,
          documents: hasDocuments ? args.documents : undefined,
          embeddings: finalEmbeddings,
          metadatas: args.metadatas,
          ...(Array.isArray(args.uris) && args.uris.length > 0 && { uris: args.uris }),
        });
        return {
          content: [
            {
              type: "text",
              text: `Updated ${args.ids.length} documents in collection '${args.collection_name}'`,
            },
          ],
        };
      }

      case "chroma_delete_documents": {
        const hasIds = Array.isArray(args.ids) && args.ids.length > 0;
        const hasWhere = args.where !== undefined && args.where !== null;
        const hasWhereDocument = args.where_document !== undefined && args.where_document !== null;

        if (!hasIds && !hasWhere && !hasWhereDocument) {
          return {
            content: [
              {
                type: "text",
                text: "Error: at least one of ids, where, where_document must be provided",
              },
            ],
          };
        }

        if (hasIds) {
          const idsValidation = validateDocumentIds(args.ids);
          if (!idsValidation.valid) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${idsValidation.error}`,
                },
              ],
            };
          }
        }

        const collection = await chromaClient.getCollection({ name: args.collection_name });
        const matchResult = assertCollectionMetadataMatch(collection.metadata, serverProviderCfg);
        const compatGuard = handleLegacyCompat(matchResult, toolName);
        if (compatGuard !== null) {
          return compatGuard;
        }

        await collection.delete({
          ...(hasIds && { ids: args.ids }),
          ...(hasWhere && { where: args.where }),
          ...(hasWhereDocument && { whereDocument: args.where_document }),
          ...(typeof args.limit === "number" && { limit: args.limit }),
        });

        return {
          content: [
            {
              type: "text",
              text: `Deleted documents from collection '${args.collection_name}' (ids=${hasIds}, where=${hasWhere}, where_document=${hasWhereDocument})`,
            },
          ],
        };
      }

      case "chroma_upsert_documents": {
        const nameValidation = validateCollectionName(args.collection_name);
        if (!nameValidation.valid) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${nameValidation.error}`,
              },
            ],
          };
        }

        const idsValidation = validateDocumentIds(args.ids);
        if (!idsValidation.valid) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${idsValidation.error}`,
              },
            ],
          };
        }

        const collection = await chromaClient.getCollection({ name: args.collection_name });
        const matchResult = assertCollectionMetadataMatch(collection.metadata, serverProviderCfg);
        const compatGuard = handleLegacyCompat(matchResult, toolName);
        if (compatGuard !== null) {
          return compatGuard;
        }

        const hasDocuments = Array.isArray(args.documents) && args.documents.length > 0;
        const hasEmbeddings = Array.isArray(args.embeddings) && args.embeddings.length > 0;

        if (!hasDocuments && !hasEmbeddings) {
          return {
            content: [{ type: "text", text: "Error: documents or embeddings required" }],
          };
        }

        if (hasEmbeddings) {
          const dimError = validateEmbeddingDimensions(args.embeddings, collection.metadata);
          if (dimError) {
            return { content: [{ type: "text", text: dimError }] };
          }
        }

        const effectiveProviderId =
          (collection.metadata?.embedding_provider as string | undefined) ||
          serverProviderCfg.provider;
        if (effectiveProviderId === "external" && hasDocuments && !hasEmbeddings) {
          return {
            content: [
              {
                type: "text",
                text:
                  "Error: External embedding mode requires pre-computed embeddings. " +
                  "Pass the 'embeddings' argument (a 2D float array sized to the collection's embedding_dimensions) " +
                  "instead of 'documents' only.",
              },
            ],
          };
        }

        const collectionCfg = resolveProviderConfigForCollection(
          serverProviderCfg,
          collection.metadata,
        );
        const provider: EmbeddingProvider = getProviderForConfig(collectionCfg);

        let finalEmbeddings: number[][] | undefined;
        const taskType: "document" = "document";
        if (hasEmbeddings) {
          finalEmbeddings = args.embeddings;
        } else if (shouldServerEmbed(provider.getProviderId())) {
          finalEmbeddings = await provider.embed(args.documents, taskType);
        }

        await collection.upsert({
          ids: args.ids,
          documents: hasDocuments ? args.documents : undefined,
          embeddings: finalEmbeddings,
          metadatas: args.metadatas,
          ...(Array.isArray(args.uris) && args.uris.length > 0 && { uris: args.uris }),
        });

        const count = hasDocuments ? args.documents.length : args.embeddings.length;
        return {
          content: [
            {
              type: "text",
              text: `Upserted ${count} documents in collection '${args.collection_name}'`,
            },
          ],
        };
      }

      case "chroma_modify_collection": {
        const nameValidation = validateCollectionName(args.collection_name);
        if (!nameValidation.valid) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${nameValidation.error}`,
              },
            ],
          };
        }

        if (args.new_name !== undefined) {
          const newNameValidation = validateCollectionName(args.new_name);
          if (!newNameValidation.valid) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${newNameValidation.error}`,
                },
              ],
            };
          }
        }

        const collection = await chromaClient.getCollection({ name: args.collection_name });

        // R5 (CVE-2026-45829): wrap client metadata through buildCollectionMetadata so
        // server-owned embedding_provider/embedding_model/embedding_dimensions keys are
        // preserved — identical to the create/get-or-create paths.  If the caller did
        // not supply metadata, the key is omitted entirely (no-op for existing metadata).
        await collection.modify({
          ...(args.new_name !== undefined && { name: args.new_name }),
          ...(args.metadata !== undefined && {
            metadata: buildCollectionMetadata(serverProviderCfg, args.metadata),
          }),
          ...(args.configuration !== undefined && { configuration: args.configuration }),
        });

        // R3: name change requires invalidating any cached provider state keyed off
        // collection identity. The provider cache is keyed by provider::model::dim
        // rather than collection name, so a full clear is the safe conservative
        // option — subsequent calls re-resolve providers cleanly.
        if (args.new_name !== undefined) {
          clearProviderCache();
        }

        return {
          content: [
            {
              type: "text",
              text: `Modified collection '${args.collection_name}'${args.new_name !== undefined ? ` (renamed to '${args.new_name}')` : ""}`,
            },
          ],
        };
      }

      case "chroma_get_or_create_collection": {
        const nameValidation = validateCollectionName(args.collection_name);
        if (!nameValidation.valid) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${nameValidation.error}`,
              },
            ],
          };
        }

        await chromaClient.getOrCreateCollection({
          name: args.collection_name,
          metadata: buildCollectionMetadata(serverProviderCfg, args.metadata),
          ...(args.configuration !== undefined && { configuration: args.configuration }),
          ...(args.schema !== undefined && { schema: args.schema }),
        });

        return {
          content: [
            {
              type: "text",
              text: `Collection '${args.collection_name}' is ready (created or already existed)`,
            },
          ],
        };
      }

      case "chroma_search": {
        const nameValidation = validateCollectionName(args.collection_name);
        if (!nameValidation.valid) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${nameValidation.error}`,
              },
            ],
          };
        }

        if (args.payload === undefined || args.payload === null) {
          return {
            content: [{ type: "text", text: "Error: payload is required" }],
          };
        }

        const collection = await chromaClient.getCollection({ name: args.collection_name });
        const sdkReadLevel = toSdkReadLevel(args.read_level);
        const results = await collection.search(
          args.payload,
          sdkReadLevel !== undefined ? { readLevel: sdkReadLevel } : undefined,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case "chroma_fork_collection": {
        const nameValidation = validateCollectionName(args.collection_name);
        if (!nameValidation.valid) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${nameValidation.error}`,
              },
            ],
          };
        }

        const newNameValidation = validateCollectionName(args.new_name);
        if (!newNameValidation.valid) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${newNameValidation.error}`,
              },
            ],
          };
        }

        const collection = await chromaClient.getCollection({ name: args.collection_name });
        const forked = await collection.fork({ name: args.new_name });

        return {
          content: [
            {
              type: "text",
              text: `Forked collection '${args.collection_name}' to '${forked.name}'`,
            },
          ],
        };
      }

      case "chroma_get_fork_count": {
        const nameValidation = validateCollectionName(args.collection_name);
        if (!nameValidation.valid) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${nameValidation.error}`,
              },
            ],
          };
        }

        const collection = await chromaClient.getCollection({ name: args.collection_name });
        const count = await collection.forkCount();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ collection_name: args.collection_name, fork_count: count }, null, 2),
            },
          ],
        };
      }

      case "chroma_get_indexing_status": {
        const nameValidation = validateCollectionName(args.collection_name);
        if (!nameValidation.valid) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${nameValidation.error}`,
              },
            ],
          };
        }

        const collection = await chromaClient.getCollection({ name: args.collection_name });
        const status = await collection.getIndexingStatus();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(status, null, 2),
            },
          ],
        };
      }

      case "chroma_heartbeat": {
        const nanos = await chromaClient.heartbeat();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ heartbeat_ns: nanos }, null, 2),
            },
          ],
        };
      }

      case "chroma_get_server_version": {
        const version = await chromaClient.version();
        return {
          content: [
            {
              type: "text",
              text: `Chroma server version: ${version}`,
            },
          ],
        };
      }

      case "chroma_count_collections": {
        const count = await chromaClient.countCollections();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ collection_count: count }, null, 2),
            },
          ],
        };
      }

      case "chroma_get_max_batch_size": {
        const maxBatchSize = await chromaClient.getMaxBatchSize();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ max_batch_size: maxBatchSize }, null, 2),
            },
          ],
        };
      }

      case "chroma_get_user_identity": {
        const identity = await chromaClient.getUserIdentity();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(identity, null, 2),
            },
          ],
        };
      }

      case "chroma_admin_create_database": {
        await getAdminClient().createDatabase({
          name: args.name,
          tenant: args.tenant,
        });
        return {
          content: [
            {
              type: "text",
              text: `Database '${args.name}' created in tenant '${args.tenant}'`,
            },
          ],
        };
      }

      case "chroma_admin_get_database": {
        const db = await getAdminClient().getDatabase({
          name: args.name,
          tenant: args.tenant,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(db, null, 2),
            },
          ],
        };
      }

      case "chroma_admin_list_databases": {
        const dbs = await getAdminClient().listDatabases({
          tenant: args.tenant,
          ...(typeof args.limit === "number" && { limit: args.limit }),
          ...(typeof args.offset === "number" && { offset: args.offset }),
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(dbs, null, 2),
            },
          ],
        };
      }

      case "chroma_admin_create_tenant": {
        await getAdminClient().createTenant({ name: args.name });
        return {
          content: [
            {
              type: "text",
              text: `Tenant '${args.name}' created`,
            },
          ],
        };
      }

      case "chroma_admin_get_tenant": {
        const tenant = await getAdminClient().getTenant({ name: args.name });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ tenant }, null, 2),
            },
          ],
        };
      }

      case "chroma_reset_database": {
        // E4: stdout audit line for destructive operations.
        // eslint-disable-next-line no-console
        console.warn(
          `[DESTRUCTIVE] chroma_reset_database ${new Date().toISOString()} (full database reset — irreversible)`,
        );
        await chromaClient.reset();
        return {
          content: [
            {
              type: "text",
              text: "Chroma database reset complete. This operation was irreversible — all collections and data have been deleted.",
            },
          ],
        };
      }

      case "chroma_admin_delete_database": {
        // E4: stdout audit line for destructive operations.
        // eslint-disable-next-line no-console
        console.warn(
          `[DESTRUCTIVE] chroma_admin_delete_database ${new Date().toISOString()} tenant='${args.tenant}' name='${args.name}' (irreversible)`,
        );
        await getAdminClient().deleteDatabase({
          name: args.name,
          tenant: args.tenant,
        });
        return {
          content: [
            {
              type: "text",
              text: `Database '${args.name}' deleted from tenant '${args.tenant}' (irreversible)`,
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: "text",
              text: `Error: Unknown tool: ${toolName}`,
            },
          ],
        };
    }
  } catch (error: unknown) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${sanitizeErrorMessage(error)}`,
        },
      ],
    };
  }
}
