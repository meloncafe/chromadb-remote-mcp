import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import type { ChromaClient, Collection, GetResult, QueryResult, Metadata } from "chromadb";
import {
  createChromaTools,
  handleChromaTool,
  validateCollectionName,
  validateDocumentIds,
} from "../../src/chroma-tools.js";

/**
 * ChromaDB Tools Tests
 *
 * Comprehensive tests for chroma-tools.ts covering:
 * - Input validation utilities
 * - Tool definition structure
 * - Tool execution and error handling
 */

describe("ChromaDB Tools", () => {
  describe("Validation Utilities", () => {
    describe("validateCollectionName", () => {
      it("should accept valid collection names", () => {
        const validNames = [
          "my_collection",
          "collection123",
          "test-collection",
          "col",
          "a".repeat(63), // Max length
        ];

        validNames.forEach((name) => {
          const result = validateCollectionName(name);
          expect(result.valid).toBe(true);
          expect(result.error).toBeUndefined();
        });
      });

      it("should reject empty or invalid names", () => {
        const invalidCases = [
          { name: "", expectedError: "non-empty string" },
          { name: "a".repeat(64), expectedError: "63 characters" },
          { name: "invalid name!", expectedError: "alphanumeric" },
          { name: "name with spaces", expectedError: "alphanumeric" },
          { name: "name@domain", expectedError: "alphanumeric" },
        ];

        invalidCases.forEach(({ name, expectedError }) => {
          const result = validateCollectionName(name);
          expect(result.valid).toBe(false);
          expect(result.error).toContain(expectedError);
        });
      });

      it("should reject non-string values", () => {
        const result = validateCollectionName(null as unknown as string);
        expect(result.valid).toBe(false);
        expect(result.error).toContain("non-empty string");
      });
    });

    describe("validateDocumentIds", () => {
      it("should accept valid ID arrays", () => {
        const result = validateDocumentIds(["id1", "id2", "id3"]);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it("should reject non-array values", () => {
        const result = validateDocumentIds("not-an-array" as unknown as string[]);
        expect(result.valid).toBe(false);
        expect(result.error).toContain("must be an array");
      });

      it("should reject empty arrays", () => {
        const result = validateDocumentIds([]);
        expect(result.valid).toBe(false);
        expect(result.error).toContain("cannot be empty");
      });

      it("should reject arrays with invalid IDs", () => {
        const result = validateDocumentIds(["valid-id", "", "another-id"]);
        expect(result.valid).toBe(false);
        expect(result.error).toContain("non-empty strings");
      });
    });
  });

  describe("Tool Definitions", () => {
    it("should return array of 11 tool definitions", () => {
      const mockClient = {} as ChromaClient;
      const tools = createChromaTools(mockClient);

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBe(11);
    });

    it("should include all expected tools", () => {
      const mockClient = {} as ChromaClient;
      const tools = createChromaTools(mockClient);
      const toolNames = tools.map((t) => t.name);

      const expectedTools = [
        "chroma_list_collections",
        "chroma_create_collection",
        "chroma_peek_collection",
        "chroma_get_collection_info",
        "chroma_get_collection_count",
        "chroma_delete_collection",
        "chroma_add_documents",
        "chroma_query_documents",
        "chroma_get_documents",
        "chroma_update_documents",
        "chroma_delete_documents",
      ];

      expectedTools.forEach((name) => {
        expect(toolNames).toContain(name);
      });
    });

    it("should have proper structure for each tool", () => {
      const mockClient = {} as ChromaClient;
      const tools = createChromaTools(mockClient);

      tools.forEach((tool) => {
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("inputSchema");
        expect(typeof tool.name).toBe("string");
        expect(typeof tool.description).toBe("string");
        expect(typeof tool.inputSchema).toBe("object");
      });
    });
  });

  describe("Tool Execution", () => {
    let mockClient: jest.Mocked<ChromaClient>;
    let mockCollection: jest.Mocked<Collection>;

    beforeEach(() => {
      // Create properly typed mock GetResult
      const createMockGetResult = <TMeta extends Metadata = Metadata>(
        ids: string[],
        documents: (string | null)[],
        metadatas: (TMeta | null)[],
      ): GetResult<TMeta> => ({
        ids,
        documents,
        metadatas,
        embeddings: [],
        include: ["documents", "metadatas"],
        uris: ids.map(() => null),
        rows() {
          return ids.map((id, i) => ({
            id,
            document: documents[i],
            metadata: metadatas[i],
            embedding: undefined,
            uri: null,
          }));
        },
      });

      // Create properly typed mock QueryResult
      const createMockQueryResult = <TMeta extends Metadata = Metadata>(
        ids: string[][],
        documents: (string | null)[][],
        metadatas: (TMeta | null)[][],
        distances: (number | null)[][],
      ): QueryResult<TMeta> => ({
        ids,
        documents,
        metadatas,
        embeddings: ids.map((idGroup) => idGroup.map(() => null)),
        distances,
        include: ["documents", "metadatas", "distances"],
        uris: ids.map((idGroup) => idGroup.map(() => null)),
        rows() {
          return ids.map((idGroup, i) =>
            idGroup.map((id, j) => ({
              id,
              document: documents[i][j],
              metadata: metadatas[i][j],
              embedding: undefined,
              distance: distances[i][j],
              uri: null,
            })),
          );
        },
      });

      mockCollection = {
        name: "test_collection",
        id: "test-collection-id",
        metadata: { description: "Test collection" },
        count: jest.fn<() => Promise<number>>(() => Promise.resolve(42)),
        peek: jest.fn<() => Promise<GetResult<Metadata>>>(() =>
          Promise.resolve(
            createMockGetResult(
              ["id1", "id2"],
              ["doc1", "doc2"],
              [{ key: "value1" }, { key: "value2" }],
            ),
          ),
        ),
        get: jest.fn<() => Promise<GetResult<Metadata>>>(() =>
          Promise.resolve(createMockGetResult(["id1"], ["doc1"], [{ key: "value" }])),
        ),
        query: jest.fn<() => Promise<QueryResult<Metadata>>>(() =>
          Promise.resolve(
            createMockQueryResult(
              [["id1", "id2"]],
              [["doc1", "doc2"]],
              [[{ key: "value1" }, { key: "value2" }]],
              [[0.1, 0.2]],
            ),
          ),
        ),
        add: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
        update: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
        delete: jest.fn<() => Promise<string[]>>(() => Promise.resolve([])),
        modify: jest.fn(),
        upsert: jest.fn(),
      } as unknown as jest.Mocked<Collection>;

      mockClient = {
        listCollections: jest.fn<() => Promise<Collection[]>>(() =>
          Promise.resolve([mockCollection]),
        ),
        createCollection: jest.fn<() => Promise<Collection>>(() => Promise.resolve(mockCollection)),
        getOrCreateCollection: jest.fn<() => Promise<Collection>>(() =>
          Promise.resolve(mockCollection),
        ),
        deleteCollection: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
        getCollection: jest.fn(),
        heartbeat: jest.fn(),
        version: jest.fn(),
        reset: jest.fn(),
      } as unknown as jest.Mocked<ChromaClient>;
    });

    describe("chroma_create_collection", () => {
      it("should validate collection name", async () => {
        const result = await handleChromaTool(mockClient, "chroma_create_collection", {
          collection_name: "invalid name!",
        });

        expect(result.content[0].text).toContain("Error:");
        expect(result.content[0].text).toContain("alphanumeric");
        expect(mockClient.createCollection).not.toHaveBeenCalled();
      });

      it("should create collection with valid name", async () => {
        const result = await handleChromaTool(mockClient, "chroma_create_collection", {
          collection_name: "valid_collection",
        });

        expect(result.content[0].text).toContain("created successfully");
        expect(mockClient.createCollection).toHaveBeenCalled();
      });
    });

    describe("chroma_delete_documents", () => {
      it("should validate document IDs", async () => {
        const result = await handleChromaTool(mockClient, "chroma_delete_documents", {
          collection_name: "test_collection",
          ids: [],
        });

        expect(result.content[0].text).toContain("Error:");
        expect(result.content[0].text).toContain("cannot be empty");
      });

      it("should delete documents with valid IDs", async () => {
        const result = await handleChromaTool(mockClient, "chroma_delete_documents", {
          collection_name: "test_collection",
          ids: ["id1", "id2"],
        });

        expect(result.content[0].text).toContain("Deleted 2 documents");
        expect(mockCollection.delete).toHaveBeenCalledWith({ ids: ["id1", "id2"] });
      });
    });

    describe("chroma_list_collections", () => {
      it("should list collections", async () => {
        const result = await handleChromaTool(mockClient, "chroma_list_collections", {});
        expect(result.content[0].text).toContain("test_collection");
      });

      it("should return placeholder for empty list", async () => {
        mockClient.listCollections.mockResolvedValue([]);
        const result = await handleChromaTool(mockClient, "chroma_list_collections", {});
        expect(result.content[0].text).toContain("__NO_COLLECTIONS_FOUND__");
      });
    });

    describe("chroma_peek_collection", () => {
      it("should peek collection with default limit", async () => {
        const result = await handleChromaTool(mockClient, "chroma_peek_collection", {
          collection_name: "test_collection",
        });
        expect(mockCollection.peek).toHaveBeenCalledWith({ limit: 5 });
        expect(result.content[0].text).toContain("id1");
      });

      it("should peek collection with custom limit", async () => {
        const _result = await handleChromaTool(mockClient, "chroma_peek_collection", {
          collection_name: "test_collection",
          limit: 10,
        });
        expect(mockCollection.peek).toHaveBeenCalledWith({ limit: 10 });
      });
    });

    describe("chroma_get_collection_info", () => {
      it("should get collection info", async () => {
        const result = await handleChromaTool(mockClient, "chroma_get_collection_info", {
          collection_name: "test_collection",
        });
        expect(result.content[0].text).toContain("test_collection");
        expect(result.content[0].text).toContain("42");
      });
    });

    describe("chroma_get_collection_count", () => {
      it("should get document count", async () => {
        const result = await handleChromaTool(mockClient, "chroma_get_collection_count", {
          collection_name: "test_collection",
        });
        expect(result.content[0].text).toContain("42");
      });
    });

    describe("chroma_delete_collection", () => {
      it("should delete collection", async () => {
        const result = await handleChromaTool(mockClient, "chroma_delete_collection", {
          collection_name: "test_collection",
        });
        expect(result.content[0].text).toContain("deleted successfully");
        expect(mockClient.deleteCollection).toHaveBeenCalledWith({ name: "test_collection" });
      });
    });

    describe("chroma_add_documents", () => {
      it("should add documents", async () => {
        const result = await handleChromaTool(mockClient, "chroma_add_documents", {
          collection_name: "test_collection",
          ids: ["id1", "id2"],
          documents: ["doc1", "doc2"],
        });
        expect(result.content[0].text).toContain("Added 2 documents");
        expect(mockCollection.add).toHaveBeenCalled();
      });
    });

    describe("chroma_query_documents", () => {
      it("should query documents", async () => {
        const result = await handleChromaTool(mockClient, "chroma_query_documents", {
          collection_name: "test_collection",
          query_texts: ["query1"],
        });
        expect(result.content[0].text).toContain("id1");
        expect(mockCollection.query).toHaveBeenCalled();
      });
    });

    describe("chroma_get_documents", () => {
      it("should get documents", async () => {
        const result = await handleChromaTool(mockClient, "chroma_get_documents", {
          collection_name: "test_collection",
        });
        expect(result.content[0].text).toContain("id1");
        expect(mockCollection.get).toHaveBeenCalled();
      });
    });

    describe("chroma_update_documents", () => {
      it("should update documents", async () => {
        const result = await handleChromaTool(mockClient, "chroma_update_documents", {
          collection_name: "test_collection",
          ids: ["id1"],
          documents: ["updated doc"],
        });
        expect(result.content[0].text).toContain("Updated 1 documents");
        expect(mockCollection.update).toHaveBeenCalled();
      });
    });

    describe("error handling", () => {
      it("should handle unknown tool", async () => {
        const result = await handleChromaTool(mockClient, "unknown_tool", {});
        expect(result.content[0].text).toContain("Error");
        expect(result.content[0].text).toContain("Unknown tool");
      });

      it("should handle ChromaDB errors", async () => {
        mockClient.listCollections.mockRejectedValue(new Error("Connection failed"));

        const result = await handleChromaTool(mockClient, "chroma_list_collections", {});
        expect(result.content[0].text).toContain("Error");
        expect(result.content[0].text).toContain("Connection failed");
      });

      it("should handle non-Error objects in development", async () => {
        mockClient.listCollections.mockRejectedValue("string error message");

        const result = await handleChromaTool(mockClient, "chroma_list_collections", {});
        expect(result.content[0].text).toBe("Error: string error message");
      });

      describe("production error sanitization", () => {
        const originalEnv = process.env.NODE_ENV;

        beforeEach(() => {
          process.env.NODE_ENV = "production";
        });

        afterEach(() => {
          process.env.NODE_ENV = originalEnv;
        });

        it("should sanitize validation errors in production", async () => {
          mockClient.listCollections.mockRejectedValue(
            new Error("Validation error: invalid parameter"),
          );

          const result = await handleChromaTool(mockClient, "chroma_list_collections", {});

          expect(result.content[0].text).toBe("Error: Invalid request parameters");
          expect(result.content[0].text).not.toContain("invalid parameter");
        });

        it("should sanitize invalid errors in production", async () => {
          mockClient.listCollections.mockRejectedValue(
            new Error("Invalid collection name provided"),
          );

          const result = await handleChromaTool(mockClient, "chroma_list_collections", {});

          expect(result.content[0].text).toBe("Error: Invalid request parameters");
        });

        it("should sanitize required field errors in production", async () => {
          mockClient.listCollections.mockRejectedValue(new Error("Required field missing"));

          const result = await handleChromaTool(mockClient, "chroma_list_collections", {});

          expect(result.content[0].text).toBe("Error: Invalid request parameters");
        });

        it("should sanitize not found errors in production", async () => {
          mockClient.getOrCreateCollection.mockRejectedValue(new Error("Collection not found"));

          const result = await handleChromaTool(mockClient, "chroma_peek_collection", {
            collection_name: "test",
          });

          expect(result.content[0].text).toBe("Error: Resource not found");
        });

        it("should sanitize does not exist errors in production", async () => {
          mockClient.getOrCreateCollection.mockRejectedValue(new Error("Document does not exist"));

          const result = await handleChromaTool(mockClient, "chroma_peek_collection", {
            collection_name: "test",
          });

          expect(result.content[0].text).toBe("Error: Resource not found");
        });

        it("should sanitize already exists errors in production", async () => {
          mockClient.createCollection.mockRejectedValue(new Error("Collection already exists"));

          const result = await handleChromaTool(mockClient, "chroma_create_collection", {
            collection_name: "test",
          });

          expect(result.content[0].text).toBe("Error: Resource already exists");
        });

        it("should sanitize duplicate errors in production", async () => {
          mockClient.createCollection.mockRejectedValue(new Error("Duplicate key error"));

          const result = await handleChromaTool(mockClient, "chroma_create_collection", {
            collection_name: "test",
          });

          expect(result.content[0].text).toBe("Error: Resource already exists");
        });

        it("should sanitize chromadb errors in production", async () => {
          mockClient.listCollections.mockRejectedValue(
            new Error("ChromaDB internal error at /var/lib/chromadb"),
          );

          const result = await handleChromaTool(mockClient, "chroma_list_collections", {});

          expect(result.content[0].text).toBe("Error: Database operation failed");
          expect(result.content[0].text).not.toContain("/var/lib/chromadb");
        });

        it("should sanitize database errors in production", async () => {
          mockClient.listCollections.mockRejectedValue(new Error("Database connection timeout"));

          const result = await handleChromaTool(mockClient, "chroma_list_collections", {});

          expect(result.content[0].text).toBe("Error: Database operation failed");
        });

        it("should sanitize collection errors in production", async () => {
          mockClient.getOrCreateCollection.mockRejectedValue(new Error("Collection query failed"));

          const result = await handleChromaTool(mockClient, "chroma_peek_collection", {
            collection_name: "test",
          });

          expect(result.content[0].text).toBe("Error: Database operation failed");
        });

        it("should return generic error for unknown errors in production", async () => {
          mockClient.listCollections.mockRejectedValue(new Error("Some random error"));

          const result = await handleChromaTool(mockClient, "chroma_list_collections", {});

          expect(result.content[0].text).toBe("Error: Operation failed");
        });

        it("should handle non-Error objects in production", async () => {
          mockClient.listCollections.mockRejectedValue("string error");

          const result = await handleChromaTool(mockClient, "chroma_list_collections", {});

          expect(result.content[0].text).toBe("Error: Operation failed");
        });
      });
    });
  });
});
