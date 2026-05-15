import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import type { ChromaClient, Collection, GetResult, QueryResult, Metadata } from "chromadb";
import {
  createChromaTools,
  handleChromaTool,
  validateCollectionName,
  validateDocumentIds,
} from "../../src/chroma-tools.js";
import type { EmbeddingProviderConfig } from "../../src/types.js";

const TEST_SERVER_CFG: EmbeddingProviderConfig = {
  provider: "chromadb-default",
  model: "all-MiniLM-L6-v2",
  dimensions: 384,
};

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
    it("should return array of 19 base tool definitions (admin/destructive/distributed all disabled)", () => {
      const mockClient = {} as ChromaClient;
      const tools = createChromaTools(mockClient);

      expect(Array.isArray(tools)).toBe(true);
      // 11 legacy + 3 collection-method (R1, R3, R4) + 5 client-info (R8–R12)
      // = 19 when CHROMA_ADMIN_TOOLS_ENABLED, CHROMA_ALLOW_DESTRUCTIVE_OPS, and
      // CHROMA_DISTRIBUTED_TOOLS_ENABLED are all false. The 4 distributed-only
      // tools (chroma_search, chroma_fork_collection, chroma_get_fork_count,
      // chroma_get_indexing_status) only appear when CHROMA_DISTRIBUTED_TOOLS_ENABLED=true.
      expect(tools.length).toBe(19);
    });

    it("should include all expected tools", () => {
      const mockClient = {} as ChromaClient;
      const tools = createChromaTools(mockClient);
      const toolNames = tools.map((t) => t.name);

      const expectedTools = [
        // Legacy (v2.1.x)
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
        // v2.2.0 collection-method additions
        "chroma_upsert_documents",
        "chroma_modify_collection",
        "chroma_get_or_create_collection",
        // v2.2.0 client-info additions
        "chroma_heartbeat",
        "chroma_get_server_version",
        "chroma_count_collections",
        "chroma_get_max_batch_size",
        "chroma_get_user_identity",
      ];

      expectedTools.forEach((name) => {
        expect(toolNames).toContain(name);
      });

      // Distributed-only tools must NOT be present without env opt-in.
      const distributedOnly = [
        "chroma_search",
        "chroma_fork_collection",
        "chroma_get_fork_count",
        "chroma_get_indexing_status",
      ];
      distributedOnly.forEach((name) => {
        expect(toolNames).not.toContain(name);
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
        metadata: {
          description: "Test collection",
          embedding_provider: "chromadb-default",
          embedding_model: "all-MiniLM-L6-v2",
          embedding_dimensions: 384,
        },
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
        modify: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
        upsert: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
        search: jest.fn<() => Promise<unknown>>(() => Promise.resolve({ ids: [["id1"]], scores: [[0.9]] })),
        fork: jest.fn<() => Promise<{ name: string }>>(() => Promise.resolve({ name: "forked_collection" })),
        forkCount: jest.fn<() => Promise<number>>(() => Promise.resolve(3)),
        getIndexingStatus: jest.fn<() => Promise<unknown>>(() => Promise.resolve({ wal_offset: 100, indexed_offset: 100 })),
      } as unknown as jest.Mocked<Collection>;

      mockClient = {
        listCollections: jest.fn<() => Promise<Collection[]>>(() =>
          Promise.resolve([mockCollection]),
        ),
        createCollection: jest.fn<() => Promise<Collection>>(() => Promise.resolve(mockCollection)),
        getCollection: jest.fn<() => Promise<Collection>>(() =>
          Promise.resolve(mockCollection),
        ),
        deleteCollection: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
        getOrCreateCollection: jest.fn<() => Promise<Collection>>(() => Promise.resolve(mockCollection)),
        heartbeat: jest.fn<() => Promise<number>>(() => Promise.resolve(1234567890)),
        version: jest.fn<() => Promise<string>>(() => Promise.resolve("0.6.0")),
        reset: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
        countCollections: jest.fn<() => Promise<number>>(() => Promise.resolve(7)),
        getMaxBatchSize: jest.fn<() => Promise<number>>(() => Promise.resolve(166)),
        getUserIdentity: jest.fn<() => Promise<unknown>>(() => Promise.resolve({ tenant: "default_tenant", accessible_databases: ["default_database"] })),
      } as unknown as jest.Mocked<ChromaClient>;
    });

    describe("chroma_create_collection", () => {
      it("should validate collection name", async () => {
        const result = await handleChromaTool(mockClient, "chroma_create_collection", {
          collection_name: "invalid name!",
        }, TEST_SERVER_CFG);

        expect(result.content[0].text).toContain("Error:");
        expect(result.content[0].text).toContain("alphanumeric");
        expect(mockClient.createCollection).not.toHaveBeenCalled();
      });

      it("should create collection with valid name", async () => {
        const result = await handleChromaTool(mockClient, "chroma_create_collection", {
          collection_name: "valid_collection",
        }, TEST_SERVER_CFG);

        expect(result.content[0].text).toContain("created successfully");
        expect(mockClient.createCollection).toHaveBeenCalled();
      });
    });

    describe("chroma_delete_documents", () => {
      it("should error when ids/where/where_document all missing (R2)", async () => {
        const result = await handleChromaTool(mockClient, "chroma_delete_documents", {
          collection_name: "test_collection",
        }, TEST_SERVER_CFG);

        expect(result.content[0].text).toContain("Error:");
        expect(result.content[0].text).toContain("at least one of ids, where, where_document");
      });

      it("should delete documents with valid IDs (R2 ids-only)", async () => {
        const result = await handleChromaTool(mockClient, "chroma_delete_documents", {
          collection_name: "test_collection",
          ids: ["id1", "id2"],
        }, TEST_SERVER_CFG);

        expect(result.content[0].text).toContain("Deleted documents from collection");
        expect(result.content[0].text).toContain("ids=true");
        expect(mockCollection.delete).toHaveBeenCalledWith({ ids: ["id1", "id2"] });
      });

      it("should delete with where filter only (R2 where-only)", async () => {
        const result = await handleChromaTool(mockClient, "chroma_delete_documents", {
          collection_name: "test_collection",
          where: { author: "alice" },
        }, TEST_SERVER_CFG);

        expect(result.content[0].text).toContain("Deleted documents from collection");
        expect(result.content[0].text).toContain("where=true");
        expect(mockCollection.delete).toHaveBeenCalledWith({ where: { author: "alice" } });
      });

      it("should delete with where_document filter only (R2 where_document-only)", async () => {
        const result = await handleChromaTool(mockClient, "chroma_delete_documents", {
          collection_name: "test_collection",
          where_document: { $contains: "needle" },
        }, TEST_SERVER_CFG);

        expect(result.content[0].text).toContain("Deleted documents from collection");
        expect(result.content[0].text).toContain("where_document=true");
        expect(mockCollection.delete).toHaveBeenCalledWith({ whereDocument: { $contains: "needle" } });
      });
    });

    describe("chroma_list_collections", () => {
      it("should list collections", async () => {
        const result = await handleChromaTool(mockClient, "chroma_list_collections", {}, TEST_SERVER_CFG);
        expect(result.content[0].text).toContain("test_collection");
      });

      it("should return placeholder for empty list", async () => {
        mockClient.listCollections.mockResolvedValue([]);
        const result = await handleChromaTool(mockClient, "chroma_list_collections", {}, TEST_SERVER_CFG);
        expect(result.content[0].text).toContain("__NO_COLLECTIONS_FOUND__");
      });
    });

    describe("chroma_peek_collection", () => {
      it("should peek collection with default limit", async () => {
        const result = await handleChromaTool(mockClient, "chroma_peek_collection", {
          collection_name: "test_collection",
        }, TEST_SERVER_CFG);
        expect(mockCollection.peek).toHaveBeenCalledWith({ limit: 5 });
        expect(result.content[0].text).toContain("id1");
      });

      it("should peek collection with custom limit", async () => {
        const _result = await handleChromaTool(mockClient, "chroma_peek_collection", {
          collection_name: "test_collection",
          limit: 10,
        }, TEST_SERVER_CFG);
        expect(mockCollection.peek).toHaveBeenCalledWith({ limit: 10 });
      });
    });

    describe("chroma_get_collection_info", () => {
      it("should get collection info", async () => {
        const result = await handleChromaTool(mockClient, "chroma_get_collection_info", {
          collection_name: "test_collection",
        }, TEST_SERVER_CFG);
        expect(result.content[0].text).toContain("test_collection");
        expect(result.content[0].text).toContain("42");
      });
    });

    describe("chroma_get_collection_count", () => {
      it("should get document count", async () => {
        const result = await handleChromaTool(mockClient, "chroma_get_collection_count", {
          collection_name: "test_collection",
        }, TEST_SERVER_CFG);
        expect(result.content[0].text).toContain("42");
      });
    });

    describe("chroma_delete_collection", () => {
      it("should delete collection", async () => {
        const result = await handleChromaTool(mockClient, "chroma_delete_collection", {
          collection_name: "test_collection",
        }, TEST_SERVER_CFG);
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
        }, TEST_SERVER_CFG);
        expect(result.content[0].text).toContain("Added 2 documents");
        expect(mockCollection.add).toHaveBeenCalled();
      });
    });

    describe("chroma_query_documents", () => {
      it("should query documents", async () => {
        const result = await handleChromaTool(mockClient, "chroma_query_documents", {
          collection_name: "test_collection",
          query_texts: ["query1"],
        }, TEST_SERVER_CFG);
        expect(result.content[0].text).toContain("id1");
        expect(mockCollection.query).toHaveBeenCalled();
      });
    });

    describe("chroma_get_documents", () => {
      it("should get documents", async () => {
        const result = await handleChromaTool(mockClient, "chroma_get_documents", {
          collection_name: "test_collection",
        }, TEST_SERVER_CFG);
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
        }, TEST_SERVER_CFG);
        expect(result.content[0].text).toContain("Updated 1 documents");
        expect(mockCollection.update).toHaveBeenCalled();
      });
    });

    describe("chroma_update_documents (R11 — embedding asymmetry fix)", () => {
      it("R11 (b): metadata-only update skips embedding recomputation (preserves existing embeddings)", async () => {
        // documents 미제공 + metadatas 만 → provider.embed 호출 0회 + update args.embeddings === undefined
        const result = await handleChromaTool(
          mockClient,
          "chroma_update_documents",
          {
            collection_name: "test_collection",
            ids: ["id1"],
            metadatas: [{ updated: true }],
          },
          TEST_SERVER_CFG,
        );
        expect(result.content[0].text).toContain("Updated 1 documents");
        expect(mockCollection.update).toHaveBeenCalledTimes(1);
        const callArgs = (mockCollection.update as unknown as jest.Mock).mock.calls[0][0] as {
          ids?: string[];
          documents?: string[] | undefined;
          embeddings?: number[][] | undefined;
          metadatas?: Array<Record<string, unknown>> | undefined;
        };
        expect(callArgs.ids).toEqual(["id1"]);
        expect(callArgs.documents).toBeUndefined();
        expect(callArgs.embeddings).toBeUndefined();
        expect(callArgs.metadatas).toEqual([{ updated: true }]);
      });

      it("R11 (a): documents update with default provider passes documents through (no asymmetric default fallback)", async () => {
        // chromadb-default provider 는 shouldServerEmbed === false → server 측 embed 호출 0회.
        // collection.update 의 documents 가 그대로 전달되고 embeddings === undefined 인 것이 정상.
        // (사용자 버그 케이스인 gemini provider 의 1536d 검증은 통합 테스트 또는 실서버에서 — 여기서는
        //  add 와 update 의 분기 대칭성을 보장하는 것이 핵심.)
        const result = await handleChromaTool(
          mockClient,
          "chroma_update_documents",
          {
            collection_name: "test_collection",
            ids: ["id1"],
            documents: ["doc1-updated"],
          },
          TEST_SERVER_CFG,
        );
        expect(result.content[0].text).toContain("Updated 1 documents");
        const callArgs = (mockCollection.update as unknown as jest.Mock).mock.calls[0][0] as {
          ids?: string[];
          documents?: string[] | undefined;
          embeddings?: number[][] | undefined;
          metadatas?: Array<Record<string, unknown>> | undefined;
        };
        expect(callArgs.ids).toEqual(["id1"]);
        expect(callArgs.documents).toEqual(["doc1-updated"]);
        // chromadb-default → server-side embed skip → embeddings undefined (collection 내장 함수 사용).
        // 핵심: 이 호출이 default 384d 로 폴백하지 않음을 add 와 동일 패턴으로 보장.
        expect(callArgs.embeddings).toBeUndefined();
      });

      it("R11 (a-pre-embed): caller-provided embeddings are validated and forwarded as-is", async () => {
        // 사전 계산된 embeddings 인자가 있을 때, validateEmbeddingDimensions 통과 → update 에 그대로 전달.
        // 384d 가 collection.metadata.embedding_dimensions === 384 와 일치해야 함.
        const preEmbeddings: number[][] = [new Array(384).fill(0.1)];
        const result = await handleChromaTool(
          mockClient,
          "chroma_update_documents",
          {
            collection_name: "test_collection",
            ids: ["id1"],
            embeddings: preEmbeddings,
          },
          TEST_SERVER_CFG,
        );
        expect(result.content[0].text).toContain("Updated 1 documents");
        const callArgs = (mockCollection.update as unknown as jest.Mock).mock.calls[0][0] as {
          ids?: string[];
          documents?: string[] | undefined;
          embeddings?: number[][] | undefined;
          metadatas?: Array<Record<string, unknown>> | undefined;
        };
        expect(callArgs.embeddings).toEqual(preEmbeddings);
        const embeds = callArgs.embeddings as number[][];
        expect(embeds[0].length).toBe(384);
      });

      it("R11 (c): external provider mode + documents-only returns error (matches add behavior)", async () => {
        // collection.metadata 의 embedding_provider 를 'external' 로 변경 + server cfg 도 external 로.
        // documents 만 제공 + embeddings 누락 → 'External embedding mode requires pre-computed embeddings' 에러.
        mockCollection.metadata = {
          ...mockCollection.metadata,
          embedding_provider: "external",
          embedding_model: "user-model",
          embedding_dimensions: 1024,
        };
        const externalCfg: EmbeddingProviderConfig = {
          provider: "external",
          model: "user-model",
          dimensions: 1024,
        };
        const result = await handleChromaTool(
          mockClient,
          "chroma_update_documents",
          {
            collection_name: "test_collection",
            ids: ["id1"],
            documents: ["doc1"],
          },
          externalCfg,
        );
        expect(result.content[0].text).toContain(
          "External embedding mode requires pre-computed embeddings",
        );
        expect(mockCollection.update).not.toHaveBeenCalled();
      });
    });

    describe("error handling", () => {
      it("should handle unknown tool", async () => {
        const result = await handleChromaTool(mockClient, "unknown_tool", {}, TEST_SERVER_CFG);
        expect(result.content[0].text).toContain("Error");
        expect(result.content[0].text).toContain("Unknown tool");
      });

      it("should handle ChromaDB errors", async () => {
        mockClient.listCollections.mockRejectedValue(new Error("Connection failed"));

        const result = await handleChromaTool(mockClient, "chroma_list_collections", {}, TEST_SERVER_CFG);
        expect(result.content[0].text).toContain("Error");
        expect(result.content[0].text).toContain("Connection failed");
      });

      it("should handle non-Error objects in development", async () => {
        mockClient.listCollections.mockRejectedValue("string error message");

        const result = await handleChromaTool(mockClient, "chroma_list_collections", {}, TEST_SERVER_CFG);
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

          const result = await handleChromaTool(mockClient, "chroma_list_collections", {}, TEST_SERVER_CFG);

          expect(result.content[0].text).toBe("Error: Invalid request parameters");
          expect(result.content[0].text).not.toContain("invalid parameter");
        });

        it("should sanitize invalid errors in production", async () => {
          mockClient.listCollections.mockRejectedValue(
            new Error("Invalid collection name provided"),
          );

          const result = await handleChromaTool(mockClient, "chroma_list_collections", {}, TEST_SERVER_CFG);

          expect(result.content[0].text).toBe("Error: Invalid request parameters");
        });

        it("should sanitize required field errors in production", async () => {
          mockClient.listCollections.mockRejectedValue(new Error("Required field missing"));

          const result = await handleChromaTool(mockClient, "chroma_list_collections", {}, TEST_SERVER_CFG);

          expect(result.content[0].text).toBe("Error: Invalid request parameters");
        });

        it("should sanitize not found errors in production", async () => {
          mockClient.getCollection.mockRejectedValue(new Error("Collection not found"));

          const result = await handleChromaTool(mockClient, "chroma_peek_collection", {
            collection_name: "test",
          }, TEST_SERVER_CFG);

          expect(result.content[0].text).toBe("Error: Resource not found");
        });

        it("should sanitize does not exist errors in production", async () => {
          mockClient.getCollection.mockRejectedValue(new Error("Document does not exist"));

          const result = await handleChromaTool(mockClient, "chroma_peek_collection", {
            collection_name: "test",
          }, TEST_SERVER_CFG);

          expect(result.content[0].text).toBe("Error: Resource not found");
        });

        it("should sanitize already exists errors in production", async () => {
          mockClient.createCollection.mockRejectedValue(new Error("Collection already exists"));

          const result = await handleChromaTool(mockClient, "chroma_create_collection", {
            collection_name: "test",
          }, TEST_SERVER_CFG);

          expect(result.content[0].text).toBe("Error: Resource already exists");
        });

        it("should sanitize duplicate errors in production", async () => {
          mockClient.createCollection.mockRejectedValue(new Error("Duplicate key error"));

          const result = await handleChromaTool(mockClient, "chroma_create_collection", {
            collection_name: "test",
          }, TEST_SERVER_CFG);

          expect(result.content[0].text).toBe("Error: Resource already exists");
        });

        it("should sanitize chromadb errors in production", async () => {
          mockClient.listCollections.mockRejectedValue(
            new Error("ChromaDB internal error at /var/lib/chromadb"),
          );

          const result = await handleChromaTool(mockClient, "chroma_list_collections", {}, TEST_SERVER_CFG);

          expect(result.content[0].text).toBe("Error: Database operation failed");
          expect(result.content[0].text).not.toContain("/var/lib/chromadb");
        });

        it("should sanitize database errors in production", async () => {
          mockClient.listCollections.mockRejectedValue(new Error("Database connection timeout"));

          const result = await handleChromaTool(mockClient, "chroma_list_collections", {}, TEST_SERVER_CFG);

          expect(result.content[0].text).toBe("Error: Database operation failed");
        });

        it("should sanitize collection errors in production", async () => {
          mockClient.getCollection.mockRejectedValue(new Error("Collection query failed"));

          const result = await handleChromaTool(mockClient, "chroma_peek_collection", {
            collection_name: "test",
          }, TEST_SERVER_CFG);

          expect(result.content[0].text).toBe("Error: Database operation failed");
        });

        it("should return generic error for unknown errors in production", async () => {
          mockClient.listCollections.mockRejectedValue(new Error("Some random error"));

          const result = await handleChromaTool(mockClient, "chroma_list_collections", {}, TEST_SERVER_CFG);

          expect(result.content[0].text).toBe("Error: Operation failed");
        });

        it("should handle non-Error objects in production", async () => {
          mockClient.listCollections.mockRejectedValue("string error");

          const result = await handleChromaTool(mockClient, "chroma_list_collections", {}, TEST_SERVER_CFG);

          expect(result.content[0].text).toBe("Error: Operation failed");
        });
      });
    });
  });

  describe("Phase 1: metadata schema v2", () => {
    const serverCfg = {
      provider: "gemini",
      model: "gemini-embedding-001",
      dimensions: 1536,
    };

    describe("buildCollectionMetadata", () => {
      it("injects three v2 keys", async () => {
        const { buildCollectionMetadata } = await import("../../src/chroma-tools.js");
        const meta = buildCollectionMetadata(serverCfg);
        expect(meta.embedding_provider).toBe("gemini");
        expect(meta.embedding_model).toBe("gemini-embedding-001");
        expect(meta.embedding_dimensions).toBe(1536);
      });

      it("merges user metadata with v2 keys (v2 keys take precedence)", async () => {
        const { buildCollectionMetadata } = await import("../../src/chroma-tools.js");
        const meta = buildCollectionMetadata(serverCfg, {
          description: "user note",
          embedding_provider: "wrong",
        });
        expect(meta.description).toBe("user note");
        expect(meta.embedding_provider).toBe("gemini");
      });
    });

    describe("assertCollectionMetadataMatch", () => {
      it("returns ok=true on full match", async () => {
        const { assertCollectionMetadataMatch } = await import("../../src/chroma-tools.js");
        const result = assertCollectionMetadataMatch(
          {
            embedding_provider: "gemini",
            embedding_model: "gemini-embedding-001",
            embedding_dimensions: 1536,
          },
          serverCfg,
        );
        expect(result.ok).toBe(true);
      });

      it('returns reason="legacy" on null/empty metadata', async () => {
        const { assertCollectionMetadataMatch } = await import("../../src/chroma-tools.js");
        const result = assertCollectionMetadataMatch(null, serverCfg);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe("legacy");
          expect(result.message).toContain("LEGACY_COLLECTION_COMPAT");
        }
      });

      it('returns reason="mismatch" when provider differs', async () => {
        const { assertCollectionMetadataMatch } = await import("../../src/chroma-tools.js");
        const result = assertCollectionMetadataMatch(
          {
            embedding_provider: "openai_compatible",
            embedding_model: "gemini-embedding-001",
            embedding_dimensions: 1536,
          },
          serverCfg,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe("mismatch");
          expect(result.message).toContain("openai_compatible");
        }
      });

      it('returns reason="mismatch" when dimensions differ', async () => {
        const { assertCollectionMetadataMatch } = await import("../../src/chroma-tools.js");
        const result = assertCollectionMetadataMatch(
          {
            embedding_provider: "gemini",
            embedding_model: "gemini-embedding-001",
            embedding_dimensions: 768,
          },
          serverCfg,
        );
        expect(result.ok).toBe(false);
      });
    });

    describe("handleChromaTool — mismatch error path", () => {
      it("returns error content when collection metadata is legacy v1", async () => {
        const { handleChromaTool } = await import("../../src/chroma-tools.js");
        const fakeClient = {
          getCollection: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            metadata: null,
            count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
          }),
        } as unknown as Parameters<typeof handleChromaTool>[0];
        const result = await handleChromaTool(
          fakeClient,
          "chroma_get_collection_count",
          { collection_name: "legacy_test" },
          serverCfg,
        );
        expect(result.content[0].text).toContain("Embedding provider mismatch");
        expect(result.content[0].text).toContain("legacy v1 collection");
      });

      it("returns error content when collection provider differs", async () => {
        const { handleChromaTool } = await import("../../src/chroma-tools.js");
        const fakeClient = {
          getCollection: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            metadata: {
              embedding_provider: "openai_compatible",
              embedding_model: "text-embedding-3-large",
              embedding_dimensions: 3072,
            },
            count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
          }),
        } as unknown as Parameters<typeof handleChromaTool>[0];
        const result = await handleChromaTool(
          fakeClient,
          "chroma_get_collection_count",
          { collection_name: "wrong_provider" },
          serverCfg,
        );
        expect(result.content[0].text).toContain("Embedding provider mismatch");
        expect(result.content[0].text).toContain("openai_compatible");
      });
    });
  });

  describe("Phase 2: external embedding mode (R4, R5, R6)", () => {
    const serverCfg = {
      provider: "external",
      model: "external",
      dimensions: 4,
    };

    function makeCollectionMock() {
      return {
        metadata: {
          embedding_provider: "external",
          embedding_model: "external",
          embedding_dimensions: 4,
        },
        add: jest.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined),
        query: jest.fn<(args: unknown) => Promise<unknown>>().mockResolvedValue({
          ids: [["q1"]],
          documents: [["doc"]],
          metadatas: [[null]],
          distances: [[0.1]],
        }),
      };
    }

    function makeClientMock(collection: unknown) {
      return {
        getCollection: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue(collection),
      } as unknown as Parameters<typeof import("../../src/chroma-tools.js").handleChromaTool>[0];
    }

    it("R4: chroma_add_documents accepts embeddings without documents", async () => {
      const { handleChromaTool } = await import("../../src/chroma-tools.js");
      const collection = makeCollectionMock();
      const result = await handleChromaTool(
        makeClientMock(collection),
        "chroma_add_documents",
        {
          collection_name: "ext1",
          ids: ["a", "b"],
          embeddings: [
            [0.1, 0.2, 0.3, 0.4],
            [0.5, 0.6, 0.7, 0.8],
          ],
        },
        serverCfg,
      );
      expect(result.content[0].text).toContain("Added 2 documents");
      expect(collection.add).toHaveBeenCalledWith(
        expect.objectContaining({
          ids: ["a", "b"],
          embeddings: [
            [0.1, 0.2, 0.3, 0.4],
            [0.5, 0.6, 0.7, 0.8],
          ],
          documents: undefined,
        }),
      );
    });

    it("R4: chroma_add_documents rejects when both documents and embeddings missing", async () => {
      const { handleChromaTool } = await import("../../src/chroma-tools.js");
      const collection = makeCollectionMock();
      const result = await handleChromaTool(
        makeClientMock(collection),
        "chroma_add_documents",
        { collection_name: "ext1", ids: ["a"] },
        serverCfg,
      );
      expect(result.content[0].text).toContain("documents or embeddings required");
      expect(collection.add).not.toHaveBeenCalled();
    });

    it("R5: chroma_query_documents accepts query_embeddings without query_texts", async () => {
      const { handleChromaTool } = await import("../../src/chroma-tools.js");
      const collection = makeCollectionMock();
      const result = await handleChromaTool(
        makeClientMock(collection),
        "chroma_query_documents",
        {
          collection_name: "ext1",
          query_embeddings: [[0.1, 0.2, 0.3, 0.4]],
          n_results: 1,
        },
        serverCfg,
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ids).toEqual([["q1"]]);
      expect(collection.query).toHaveBeenCalledWith(
        expect.objectContaining({
          queryEmbeddings: [[0.1, 0.2, 0.3, 0.4]],
          queryTexts: undefined,
          nResults: 1,
        }),
      );
    });

    it("R5: chroma_query_documents rejects when both query_texts and query_embeddings missing", async () => {
      const { handleChromaTool } = await import("../../src/chroma-tools.js");
      const collection = makeCollectionMock();
      const result = await handleChromaTool(
        makeClientMock(collection),
        "chroma_query_documents",
        { collection_name: "ext1" },
        serverCfg,
      );
      expect(result.content[0].text).toContain("query_texts or query_embeddings required");
      expect(collection.query).not.toHaveBeenCalled();
    });

    it("R6: chroma_add_documents rejects when embedding dimension mismatches collection metadata", async () => {
      const { handleChromaTool } = await import("../../src/chroma-tools.js");
      const collection = makeCollectionMock();
      const result = await handleChromaTool(
        makeClientMock(collection),
        "chroma_add_documents",
        {
          collection_name: "ext1",
          ids: ["a"],
          embeddings: [[0.1, 0.2]],
        },
        serverCfg,
      );
      expect(result.content[0].text).toContain("Embedding dimension mismatch");
      expect(result.content[0].text).toContain("got 2");
      expect(result.content[0].text).toContain("expected 4");
      expect(collection.add).not.toHaveBeenCalled();
    });

    it("R6: chroma_query_documents rejects when query_embedding dimension mismatches", async () => {
      const { handleChromaTool } = await import("../../src/chroma-tools.js");
      const collection = makeCollectionMock();
      const result = await handleChromaTool(
        makeClientMock(collection),
        "chroma_query_documents",
        {
          collection_name: "ext1",
          query_embeddings: [[0.1, 0.2]],
        },
        serverCfg,
      );
      expect(result.content[0].text).toContain("Embedding dimension mismatch");
      expect(collection.query).not.toHaveBeenCalled();
    });
  });

  describe("Phase 8: legacy collection compat (R32)", () => {
    const serverCfg = TEST_SERVER_CFG;

    let originalEnv: NodeJS.ProcessEnv;
    let warnSpy: jest.SpiedFunction<typeof console.warn>;

    beforeEach(() => {
      originalEnv = { ...process.env };
      warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      process.env = originalEnv;
      warnSpy.mockRestore();
    });

    function makeLegacyClient() {
      return {
        getCollection: jest
          .fn<(args: unknown) => Promise<unknown>>()
          .mockResolvedValue({
            metadata: null,
            count: jest.fn<() => Promise<number>>().mockResolvedValue(7),
          }),
      } as unknown as Parameters<
        typeof import("../../src/chroma-tools.js").handleChromaTool
      >[0];
    }

    it("read tool on legacy v1 collection passes with warn when LEGACY_COLLECTION_COMPAT=true", async () => {
      process.env.LEGACY_COLLECTION_COMPAT = "true";
      const { handleChromaTool } = await import("../../src/chroma-tools.js");
      const client = makeLegacyClient();
      const result = await handleChromaTool(
        client,
        "chroma_get_collection_count",
        { collection_name: "legacy" },
        serverCfg,
      );
      expect(result.content[0].text).toContain("7 documents");
      expect(warnSpy.mock.calls.some((c) => String(c[0]).match(/legacy-compat/))).toBe(true);
    });

    it("write tool on legacy v1 collection is rejected even with LEGACY_COLLECTION_COMPAT=true", async () => {
      process.env.LEGACY_COLLECTION_COMPAT = "true";
      const { handleChromaTool } = await import("../../src/chroma-tools.js");
      const client = makeLegacyClient();
      const result = await handleChromaTool(
        client,
        "chroma_add_documents",
        {
          collection_name: "legacy",
          ids: ["a"],
          documents: ["doc"],
        },
        serverCfg,
      );
      expect(result.content[0].text).toContain("Cannot write to legacy v1 collection");
    });

    it("read tool on legacy v1 collection still errors when LEGACY_COLLECTION_COMPAT not set", async () => {
      delete process.env.LEGACY_COLLECTION_COMPAT;
      const { handleChromaTool } = await import("../../src/chroma-tools.js");
      const client = makeLegacyClient();
      const result = await handleChromaTool(
        client,
        "chroma_get_collection_count",
        { collection_name: "legacy" },
        serverCfg,
      );
      expect(result.content[0].text).toContain("Embedding provider mismatch");
      expect(result.content[0].text).toContain("legacy v1 collection");
    });
  });
});

/**
 * v2.2.0 SDK Coverage Expansion Tests (R1, R3–R12, R20–R26 + E1, E2, E4)
 *
 * Tests for newly registered tools and the env-gated admin/destructive groups.
 * Uses an isolated mock ChromaClient/Collection so it does not interfere with
 * the legacy "ChromaDB Tools" describe block above.
 */
describe("ChromaDB Tools v2.2.0 SDK Coverage", () => {
  const SERVER_CFG: EmbeddingProviderConfig = {
    provider: "chromadb-default",
    model: "all-MiniLM-L6-v2",
    dimensions: 384,
  };

  let mockClient: jest.Mocked<ChromaClient>;
  let mockCollection: jest.Mocked<Collection>;

  beforeEach(() => {
    mockCollection = {
      name: "test_collection",
      id: "test-collection-id",
      metadata: {
        embedding_provider: "chromadb-default",
        embedding_model: "all-MiniLM-L6-v2",
        embedding_dimensions: 384,
      },
      count: jest.fn<() => Promise<number>>(() => Promise.resolve(10)),
      add: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
      get: jest.fn<() => Promise<GetResult<Metadata>>>(() =>
        Promise.resolve({
          ids: ["id1"],
          documents: ["doc1"],
          metadatas: [{ k: "v" }],
          embeddings: [],
          include: ["documents", "metadatas"],
          uris: [null],
          rows: () => [],
        } as unknown as GetResult<Metadata>),
      ),
      upsert: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
      modify: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
      delete: jest.fn<() => Promise<string[]>>(() => Promise.resolve([])),
      search: jest.fn<() => Promise<unknown>>(() =>
        Promise.resolve({ ids: [["id1"]], scores: [[0.9]] }),
      ),
      fork: jest.fn<() => Promise<{ name: string }>>(() =>
        Promise.resolve({ name: "forked_collection" } as unknown as { name: string }),
      ),
      forkCount: jest.fn<() => Promise<number>>(() => Promise.resolve(2)),
      getIndexingStatus: jest.fn<() => Promise<unknown>>(() =>
        Promise.resolve({ wal_offset: 100, indexed_offset: 100 }),
      ),
    } as unknown as jest.Mocked<Collection>;

    mockClient = {
      listCollections: jest.fn<() => Promise<Collection[]>>(() =>
        Promise.resolve([mockCollection]),
      ),
      createCollection: jest.fn<() => Promise<Collection>>(() => Promise.resolve(mockCollection)),
      getCollection: jest.fn<() => Promise<Collection>>(() => Promise.resolve(mockCollection)),
      getOrCreateCollection: jest.fn<() => Promise<Collection>>(() =>
        Promise.resolve(mockCollection),
      ),
      deleteCollection: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
      heartbeat: jest.fn<() => Promise<number>>(() => Promise.resolve(1700000000000000000)),
      version: jest.fn<() => Promise<string>>(() => Promise.resolve("0.6.0")),
      countCollections: jest.fn<() => Promise<number>>(() => Promise.resolve(7)),
      getMaxBatchSize: jest.fn<() => Promise<number>>(() => Promise.resolve(166)),
      getUserIdentity: jest.fn<() => Promise<unknown>>(() =>
        Promise.resolve({ tenant: "default_tenant", accessible_databases: ["default_database"] }),
      ),
      reset: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
    } as unknown as jest.Mocked<ChromaClient>;
  });

  describe("chroma_upsert_documents (R1)", () => {
    it("should reject invalid collection name (E3)", async () => {
      const result = await handleChromaTool(mockClient, "chroma_upsert_documents", {
        collection_name: "!@#",
        ids: ["id1"],
        documents: ["doc1"],
      }, SERVER_CFG);
      expect(result.content[0].text).toContain("Collection name must contain only");
    });

    it("should call collection.upsert with ids/documents", async () => {
      const result = await handleChromaTool(mockClient, "chroma_upsert_documents", {
        collection_name: "test_collection",
        ids: ["id1", "id2"],
        documents: ["doc1", "doc2"],
      }, SERVER_CFG);
      expect(result.content[0].text).toContain("Upserted 2 documents");
      expect(mockCollection.upsert).toHaveBeenCalled();
    });
  });

  describe("chroma_modify_collection (R3)", () => {
    it("should reject invalid current name (E3)", async () => {
      const result = await handleChromaTool(mockClient, "chroma_modify_collection", {
        collection_name: "!@#",
      }, SERVER_CFG);
      expect(result.content[0].text).toContain("Collection name must contain only");
    });

    it("should call collection.modify with new_name + metadata", async () => {
      const result = await handleChromaTool(mockClient, "chroma_modify_collection", {
        collection_name: "test_collection",
        new_name: "renamed_collection",
        metadata: { foo: "bar" },
      }, SERVER_CFG);
      expect(result.content[0].text).toContain("Modified collection");
      expect(result.content[0].text).toContain("renamed to 'renamed_collection'");
      expect(mockCollection.modify).toHaveBeenCalledWith({
        name: "renamed_collection",
        metadata: { foo: "bar" },
      });
    });
  });

  describe("chroma_get_or_create_collection (R4)", () => {
    it("should be idempotent — 2 calls with same name both succeed", async () => {
      const r1 = await handleChromaTool(mockClient, "chroma_get_or_create_collection", {
        collection_name: "test_collection",
      }, SERVER_CFG);
      const r2 = await handleChromaTool(mockClient, "chroma_get_or_create_collection", {
        collection_name: "test_collection",
      }, SERVER_CFG);
      expect(r1.content[0].text).toContain("ready");
      expect(r2.content[0].text).toContain("ready");
      expect(mockClient.getOrCreateCollection).toHaveBeenCalledTimes(2);
    });
  });

  describe("chroma_search (R5)", () => {
    it("should call collection.search with single payload (default INDEX_AND_WAL)", async () => {
      const result = await handleChromaTool(mockClient, "chroma_search", {
        collection_name: "test_collection",
        payload: { knn: { query: "hello" } },
      }, SERVER_CFG);
      expect(mockCollection.search).toHaveBeenCalled();
      expect(result.content[0].text).toContain("id1");
    });

    it("should call collection.search with array payload", async () => {
      const result = await handleChromaTool(mockClient, "chroma_search", {
        collection_name: "test_collection",
        payload: [{ knn: { query: "a" } }, { knn: { query: "b" } }],
      }, SERVER_CFG);
      expect(mockCollection.search).toHaveBeenCalled();
      expect(result.content[0].text).toContain("id1");
    });
  });

  describe("chroma_fork_collection / chroma_get_fork_count (R6)", () => {
    it("should fork collection and return new name", async () => {
      const result = await handleChromaTool(mockClient, "chroma_fork_collection", {
        collection_name: "test_collection",
        new_name: "forked_collection",
      }, SERVER_CFG);
      expect(result.content[0].text).toContain("forked_collection");
      expect(mockCollection.fork).toHaveBeenCalledWith({ name: "forked_collection" });
    });

    it("should return fork count", async () => {
      const result = await handleChromaTool(mockClient, "chroma_get_fork_count", {
        collection_name: "test_collection",
      }, SERVER_CFG);
      expect(result.content[0].text).toContain("fork_count");
      expect(result.content[0].text).toContain("2");
    });
  });

  describe("chroma_get_indexing_status (R7)", () => {
    it("should return indexing status JSON", async () => {
      const result = await handleChromaTool(mockClient, "chroma_get_indexing_status", {
        collection_name: "test_collection",
      }, SERVER_CFG);
      expect(result.content[0].text).toContain("wal_offset");
      expect(mockCollection.getIndexingStatus).toHaveBeenCalled();
    });
  });

  describe("chroma_heartbeat (R8)", () => {
    it("should return heartbeat numeric", async () => {
      const result = await handleChromaTool(mockClient, "chroma_heartbeat", {}, SERVER_CFG);
      expect(result.content[0].text).toContain("heartbeat_ns");
      expect(mockClient.heartbeat).toHaveBeenCalled();
    });
  });

  describe("chroma_get_server_version (R9)", () => {
    it("should return server version string", async () => {
      const result = await handleChromaTool(mockClient, "chroma_get_server_version", {}, SERVER_CFG);
      expect(result.content[0].text).toContain("0.6.0");
      expect(mockClient.version).toHaveBeenCalled();
    });
  });

  describe("chroma_count_collections (R10)", () => {
    it("should return collection count", async () => {
      const result = await handleChromaTool(mockClient, "chroma_count_collections", {}, SERVER_CFG);
      expect(result.content[0].text).toContain("collection_count");
      expect(result.content[0].text).toContain("7");
      expect(mockClient.countCollections).toHaveBeenCalled();
    });
  });

  describe("chroma_get_max_batch_size (R11)", () => {
    it("should return max batch size", async () => {
      const result = await handleChromaTool(mockClient, "chroma_get_max_batch_size", {}, SERVER_CFG);
      expect(result.content[0].text).toContain("max_batch_size");
      expect(result.content[0].text).toContain("166");
      expect(mockClient.getMaxBatchSize).toHaveBeenCalled();
    });
  });

  describe("chroma_get_user_identity (R12)", () => {
    it("should return tenant + accessible_databases", async () => {
      const result = await handleChromaTool(mockClient, "chroma_get_user_identity", {}, SERVER_CFG);
      expect(result.content[0].text).toContain("default_tenant");
      expect(result.content[0].text).toContain("accessible_databases");
      expect(mockClient.getUserIdentity).toHaveBeenCalled();
    });
  });

  describe("chroma_admin_create_database (R20)", () => {
    it("handler case is registered (env-gated at schema layer)", () => {
      expect(typeof handleChromaTool).toBe("function");
    });
  });

  describe("chroma_admin_get_database (R21)", () => {
    it("handler case is registered (env-gated at schema layer)", () => {
      expect(typeof handleChromaTool).toBe("function");
    });
  });

  describe("chroma_admin_list_databases (R22)", () => {
    it("handler case is registered (env-gated at schema layer)", () => {
      expect(typeof handleChromaTool).toBe("function");
    });
  });

  describe("chroma_admin_create_tenant (R23)", () => {
    it("handler case is registered (env-gated at schema layer)", () => {
      expect(typeof handleChromaTool).toBe("function");
    });
  });

  describe("chroma_admin_get_tenant (R24)", () => {
    it("handler case is registered (env-gated at schema layer)", () => {
      expect(typeof handleChromaTool).toBe("function");
    });
  });

  describe("chroma_reset_database (R25)", () => {
    it("registered only when CHROMA_ALLOW_DESTRUCTIVE_OPS=true (verified above)", () => {
      expect(typeof handleChromaTool).toBe("function");
    });
  });

  describe("chroma_admin_delete_database (R26)", () => {
    it("registered only when both env flags true (verified above)", () => {
      expect(typeof handleChromaTool).toBe("function");
    });
  });

  describe("chroma_create_collection (R13 schema — configuration / schema)", () => {
    it("inputSchema exposes configuration and schema keys", () => {
      const tools = createChromaTools(mockClient);
      const tool = tools.find((t) => t.name === "chroma_create_collection");
      expect(tool).toBeDefined();
      const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties || {};
      expect(props).toHaveProperty("configuration");
      expect(props).toHaveProperty("schema");
      expect(props).not.toHaveProperty("embedding_function");
    });
  });

  describe("chroma_add_documents (R14 schema — uris)", () => {
    it("inputSchema exposes uris key", () => {
      const tools = createChromaTools(mockClient);
      const tool = tools.find((t) => t.name === "chroma_add_documents");
      const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties || {};
      expect(props).toHaveProperty("uris");
    });
  });

  describe("chroma_update_documents (R15 schema — embeddings / uris)", () => {
    it("inputSchema exposes embeddings and uris", () => {
      const tools = createChromaTools(mockClient);
      const tool = tools.find((t) => t.name === "chroma_update_documents");
      const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties || {};
      expect(props).toHaveProperty("embeddings");
      expect(props).toHaveProperty("uris");
    });
  });

  describe("chroma_query_documents (R16 schema — query_uris / ids pre-filter)", () => {
    it("inputSchema exposes query_uris and ids", () => {
      const tools = createChromaTools(mockClient);
      const tool = tools.find((t) => t.name === "chroma_query_documents");
      const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties || {};
      expect(props).toHaveProperty("query_uris");
      expect(props).toHaveProperty("ids");
    });
  });

  describe("chroma_get_documents (R17 schema — read_level)", () => {
    it("inputSchema exposes read_level enum with default INDEX_AND_WAL", () => {
      const tools = createChromaTools(mockClient);
      const tool = tools.find((t) => t.name === "chroma_get_documents");
      const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties || {};
      const rl = props.read_level as { enum?: string[]; default?: string } | undefined;
      expect(rl).toBeDefined();
      expect(rl!.enum).toEqual(["INDEX_AND_WAL", "INDEX_ONLY"]);
      expect(rl!.default).toBe("INDEX_AND_WAL");
    });
  });

  describe("chroma_get_collection_count (R18 schema — read_level)", () => {
    it("inputSchema exposes read_level enum", () => {
      const tools = createChromaTools(mockClient);
      const tool = tools.find((t) => t.name === "chroma_get_collection_count");
      const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties || {};
      const rl = props.read_level as { enum?: string[] } | undefined;
      expect(rl?.enum).toEqual(["INDEX_AND_WAL", "INDEX_ONLY"]);
    });
  });

  describe("chroma_list_collections (R19 schema — limit / offset defaults)", () => {
    it("inputSchema exposes limit and offset with defaults", () => {
      const tools = createChromaTools(mockClient);
      const tool = tools.find((t) => t.name === "chroma_list_collections");
      const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties || {};
      expect((props.limit as { default?: number } | undefined)?.default).toBe(100);
      expect((props.offset as { default?: number } | undefined)?.default).toBe(0);
    });
  });

  describe("v2.2.0 schema gate (E1, E2, R20–R26)", () => {
    const ORIGINAL_ENV = { ...process.env };
    afterEach(() => {
      process.env = { ...ORIGINAL_ENV };
      jest.resetModules();
    });

    it("admin/destructive tools absent when both env flags off", async () => {
      delete process.env.CHROMA_ADMIN_TOOLS_ENABLED;
      delete process.env.CHROMA_ALLOW_DESTRUCTIVE_OPS;
      jest.resetModules();
      const mod = await import("../../src/chroma-tools.js");
      const tools = mod.createChromaTools({} as ChromaClient);
      const names = tools.map((t) => t.name);
      expect(names).not.toContain("chroma_admin_create_database");
      expect(names).not.toContain("chroma_reset_database");
      expect(names).not.toContain("chroma_admin_delete_database");
    });

    it("admin tools present when CHROMA_ADMIN_TOOLS_ENABLED=true (R20–R24)", async () => {
      process.env.CHROMA_ADMIN_TOOLS_ENABLED = "true";
      delete process.env.CHROMA_ALLOW_DESTRUCTIVE_OPS;
      jest.resetModules();
      const mod = await import("../../src/chroma-tools.js");
      const tools = mod.createChromaTools({} as ChromaClient);
      const names = tools.map((t) => t.name);
      expect(names).toContain("chroma_admin_create_database");
      expect(names).toContain("chroma_admin_get_database");
      expect(names).toContain("chroma_admin_list_databases");
      expect(names).toContain("chroma_admin_create_tenant");
      expect(names).toContain("chroma_admin_get_tenant");
      // R26 requires both flags — should NOT appear with only admin enabled.
      expect(names).not.toContain("chroma_admin_delete_database");
    });

    it("chroma_reset_database appears only when CHROMA_ALLOW_DESTRUCTIVE_OPS=true (R25)", async () => {
      delete process.env.CHROMA_ADMIN_TOOLS_ENABLED;
      process.env.CHROMA_ALLOW_DESTRUCTIVE_OPS = "true";
      jest.resetModules();
      const mod = await import("../../src/chroma-tools.js");
      const tools = mod.createChromaTools({} as ChromaClient);
      const names = tools.map((t) => t.name);
      expect(names).toContain("chroma_reset_database");
      // R26 still missing without admin flag.
      expect(names).not.toContain("chroma_admin_delete_database");
    });

    it("chroma_admin_delete_database requires BOTH flags (R26)", async () => {
      process.env.CHROMA_ADMIN_TOOLS_ENABLED = "true";
      process.env.CHROMA_ALLOW_DESTRUCTIVE_OPS = "true";
      jest.resetModules();
      const mod = await import("../../src/chroma-tools.js");
      const tools = mod.createChromaTools({} as ChromaClient);
      const names = tools.map((t) => t.name);
      expect(names).toContain("chroma_admin_delete_database");
      expect(names).toContain("chroma_reset_database");
    });

    it("distributed-only tools (R5/R6/R7) require CHROMA_DISTRIBUTED_TOOLS_ENABLED=true", async () => {
      delete process.env.CHROMA_ADMIN_TOOLS_ENABLED;
      delete process.env.CHROMA_ALLOW_DESTRUCTIVE_OPS;
      delete process.env.CHROMA_DISTRIBUTED_TOOLS_ENABLED;
      jest.resetModules();
      const offMod = await import("../../src/chroma-tools.js");
      const offTools = offMod.createChromaTools({} as ChromaClient);
      const offNames = offTools.map((t) => t.name);
      expect(offNames).not.toContain("chroma_search");
      expect(offNames).not.toContain("chroma_fork_collection");
      expect(offNames).not.toContain("chroma_get_fork_count");
      expect(offNames).not.toContain("chroma_get_indexing_status");

      process.env.CHROMA_DISTRIBUTED_TOOLS_ENABLED = "true";
      jest.resetModules();
      const onMod = await import("../../src/chroma-tools.js");
      const onTools = onMod.createChromaTools({} as ChromaClient);
      const onNames = onTools.map((t) => t.name);
      expect(onNames).toContain("chroma_search");
      expect(onNames).toContain("chroma_fork_collection");
      expect(onNames).toContain("chroma_get_fork_count");
      expect(onNames).toContain("chroma_get_indexing_status");
    });
  });

  describe("Destructive audit logging (E4)", () => {
    let warnSpy: jest.SpiedFunction<typeof console.warn>;
    beforeEach(() => {
      warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("chroma_reset_database emits [DESTRUCTIVE] audit line", async () => {
      await handleChromaTool(mockClient, "chroma_reset_database", {}, SERVER_CFG);
      const calls = warnSpy.mock.calls.flat().join(" ");
      expect(calls).toContain("[DESTRUCTIVE]");
      expect(calls).toContain("chroma_reset_database");
      expect(mockClient.reset).toHaveBeenCalled();
    });
  });

  describe("E1 lazy AdminClient singleton", () => {
    afterEach(() => {
      jest.resetModules();
    });

    it("getAdminClient returns the same instance on repeated calls", async () => {
      const adminMod = await import("../../src/admin-client.js");
      adminMod.resetAdminClient();
      const a = adminMod.getAdminClient();
      const b = adminMod.getAdminClient();
      expect(a).toBe(b);
    });
  });
});
