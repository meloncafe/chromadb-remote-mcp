import { ChromaClient } from "chromadb";

interface PaginationCursor {
  offset: number;
  limit: number;
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
            description: "List of text documents to add",
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
        required: ["collection_name", "documents", "ids"],
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
            description: "List of query texts to search for",
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
        },
        required: ["collection_name", "query_texts"],
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
          metadata: args.metadata,
          embeddingFunction: undefined,
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
        const collection = await chromaClient.getOrCreateCollection({
          name: args.collection_name,
          embeddingFunction: undefined,
        });
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
        const collection = await chromaClient.getOrCreateCollection({
          name: args.collection_name,
          embeddingFunction: undefined,
        });
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
        const collection = await chromaClient.getOrCreateCollection({
          name: args.collection_name,
          embeddingFunction: undefined,
        });
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
        const collection = await chromaClient.getOrCreateCollection({
          name: args.collection_name,
          embeddingFunction: undefined,
        });
        await collection.add({
          ids: args.ids,
          documents: args.documents,
          metadatas: args.metadatas,
        });
        return {
          content: [
            {
              type: "text",
              text: `Added ${args.documents.length} documents to collection '${args.collection_name}'`,
            },
          ],
        };
      }

      case "chroma_query_documents": {
        const collection = await chromaClient.getOrCreateCollection({
          name: args.collection_name,
          embeddingFunction: undefined,
        });
        const results = await collection.query({
          queryTexts: args.query_texts,
          nResults: args.n_results || 5,
          where: args.where,
          whereDocument: args.where_document,
          include: args.include || ["documents", "metadatas", "distances"],
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case "chroma_get_documents": {
        const collection = await chromaClient.getOrCreateCollection({
          name: args.collection_name,
          embeddingFunction: undefined,
        });

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
        const collection = await chromaClient.getOrCreateCollection({
          name: args.collection_name,
          embeddingFunction: undefined,
        });
        await collection.update({
          ids: args.ids,
          documents: args.documents,
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

        const collection = await chromaClient.getOrCreateCollection({
          name: args.collection_name,
          embeddingFunction: undefined,
        });
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
