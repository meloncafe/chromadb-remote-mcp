import { ChromaClient } from "chromadb";
import type { CollectionMetadataV2, EmbeddingProviderConfig } from "./types.js";
import type { EmbeddingProvider } from "./embedding/provider.js";
import {
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
export function createChromaTools(_chromaClient: ChromaClient) {
  return [
    {
      name: "chroma_list_collections",
      description: "List all collection names in the Chroma database with pagination support",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Optional maximum number of collections to return",
          },
          offset: {
            type: "number",
            description: "Optional number of collections to skip before returning results",
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
        },
        required: ["collection_name", "ids"],
      },
    },
    {
      name: "chroma_delete_documents",
      description: "Delete documents from a Chroma collection",
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
            description: "List of document IDs to delete",
          },
        },
        required: ["collection_name", "ids"],
      },
    },
  ];
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
        const count = await collection.count();
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
        await chromaClient.deleteCollection({ name: args.collection_name });
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

        const results = await collection.get({
          ids: args.ids,
          where: args.where,
          whereDocument: args.where_document,
          include: args.include || ["documents", "metadatas"],
          limit,
          offset,
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
        await collection.delete({ ids: args.ids });
        return {
          content: [
            {
              type: "text",
              text: `Deleted ${args.ids.length} documents from collection '${args.collection_name}'`,
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
