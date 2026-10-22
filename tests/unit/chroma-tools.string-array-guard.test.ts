import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { ChromaClient, Collection, GetResult, Metadata, QueryResult } from "chromadb";
import { handleChromaTool, validateStringArray } from "../../src/chroma-tools.js";
import type { EmbeddingProviderConfig } from "../../src/types.js";

const TEST_SERVER_CFG: EmbeddingProviderConfig = {
  provider: "chromadb-default",
  model: "all-MiniLM-L6-v2",
  dimensions: 384,
};

/**
 * String-array validation guard tests (R3 — chroma-mcp-direct-upsert-guard).
 *
 * MCP clients can put object arrays (e.g. [{content, id, metadata}]) into
 * `documents` / `query_texts` even though the tool schemas declare
 * `items: {type: "string"}`. The handlers must reject those BEFORE any
 * embedding provider or ChromaDB call, with an error naming the offending
 * index and type.
 *
 * The guards are inserted as the first statement of each case block, before
 * `chromaClient.getCollection` — the first I/O of every one of these
 * handlers. Provider resolution and `provider.embed` (shouldServerEmbed:
 * gemini / voyage / openai_compatible) run strictly after getCollection, so
 * asserting that getCollection and the collection method are never called
 * proves the request failed before any embedding or Chroma I/O.
 */
describe("chroma-tools string-array guard", () => {
  let mockCollection: jest.Mocked<Collection>;
  let mockClient: jest.Mocked<ChromaClient>;

  beforeEach(() => {
    mockCollection = {
      name: "test_collection",
      id: "test-collection-id",
      metadata: {
        description: "Test collection",
        embedding_provider: "chromadb-default",
        embedding_model: "all-MiniLM-L6-v2",
        embedding_dimensions: 384,
      },
      get: jest.fn<() => Promise<GetResult<Metadata>>>(() =>
        Promise.resolve({
          ids: ["id1"],
          documents: ["doc1"],
          metadatas: [{ key: "value" }],
        } as unknown as GetResult<Metadata>),
      ),
      query: jest.fn<() => Promise<QueryResult<Metadata>>>(() =>
        Promise.resolve({
          ids: [["id1"]],
          documents: [["doc1"]],
          metadatas: [[{ key: "value" }]],
          distances: [[0.1]],
        } as unknown as QueryResult<Metadata>),
      ),
      add: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
      update: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
      upsert: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
    } as unknown as jest.Mocked<Collection>;

    mockClient = {
      getCollection: jest.fn<() => Promise<Collection>>(() => Promise.resolve(mockCollection)),
    } as unknown as jest.Mocked<ChromaClient>;
  });

  describe("validateStringArray", () => {
    it("should accept arrays of strings", () => {
      const result = validateStringArray(["doc one", "doc two"], "documents");
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should accept an empty array (presence gating stays in the handlers)", () => {
      const result = validateStringArray([], "documents");
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should reject non-array values", () => {
      for (const value of ["just-a-string", { content: "x" }, 42]) {
        const result = validateStringArray(value, "documents");
        expect(result.valid).toBe(false);
        expect(result.error).toContain("documents must be an array");
      }
    });

    it("should reject object elements naming index and type", () => {
      const result = validateStringArray([{ content: "x", id: "1" }], "documents");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("documents[0] must be a string, got object");
    });

    it("should reject number elements", () => {
      const result = validateStringArray([42], "documents");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("documents[0] must be a string, got number");
    });

    it("should reject null elements (typeof null is object, reported as null)", () => {
      const result = validateStringArray([null], "documents");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("documents[0] must be a string, got null");
    });

    it("should reject nested array elements", () => {
      const result = validateStringArray([["nested"]], "documents");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("documents[0] must be a string, got array");
    });

    it("should report the first offending index in mixed arrays", () => {
      const result = validateStringArray(["ok", "fine", 42], "documents");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("documents[2] must be a string, got number");
    });

    it("should use the provided field name in the error", () => {
      const result = validateStringArray([{ a: 1 }], "query_texts");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("query_texts[0] must be a string, got object");
    });
  });

  describe("chroma_add_documents", () => {
    it("should reject object documents before any Chroma/embedding I/O", async () => {
      const result = await handleChromaTool(
        mockClient,
        "chroma_add_documents",
        {
          collection_name: "test_collection",
          ids: ["id1"],
          documents: [{ content: "hello", id: "id1", metadata: {} }],
        },
        TEST_SERVER_CFG,
      );
      expect(result.content[0].text).toBe("Error: documents[0] must be a string, got object");
      expect(mockClient.getCollection).not.toHaveBeenCalled();
      expect(mockCollection.add).not.toHaveBeenCalled();
    });

    it("should reject number, null, and mixed-element documents", async () => {
      const badCases: unknown[] = [[42], [null], ["ok", { content: "x" }]];
      for (const documents of badCases) {
        const result = await handleChromaTool(
          mockClient,
          "chroma_add_documents",
          { collection_name: "test_collection", ids: ["id1"], documents },
          TEST_SERVER_CFG,
        );
        expect(result.content[0].text).toContain("must be a string");
        expect(mockCollection.add).not.toHaveBeenCalled();
      }
      expect(mockClient.getCollection).not.toHaveBeenCalled();
    });

    it("should accept valid string documents and reach collection.add", async () => {
      const result = await handleChromaTool(
        mockClient,
        "chroma_add_documents",
        {
          collection_name: "test_collection",
          ids: ["id1"],
          documents: ["doc one"],
        },
        TEST_SERVER_CFG,
      );
      expect(result.content[0].text).toContain("Added 1 documents");
      expect(mockCollection.add).toHaveBeenCalledTimes(1);
    });

    it("should not reject when documents is null (guard skips absent values)", async () => {
      const result = await handleChromaTool(
        mockClient,
        "chroma_add_documents",
        {
          collection_name: "test_collection",
          ids: ["id1"],
          documents: null,
        },
        TEST_SERVER_CFG,
      );
      expect(result.content[0].text).toContain("documents or embeddings required");
    });
  });

  describe("chroma_upsert_documents", () => {
    it("should reject object documents before any Chroma/embedding I/O", async () => {
      const result = await handleChromaTool(
        mockClient,
        "chroma_upsert_documents",
        {
          collection_name: "test_collection",
          ids: ["id1"],
          documents: [{ content: "hello", id: "id1" }],
        },
        TEST_SERVER_CFG,
      );
      expect(result.content[0].text).toBe("Error: documents[0] must be a string, got object");
      expect(mockClient.getCollection).not.toHaveBeenCalled();
      expect(mockCollection.upsert).not.toHaveBeenCalled();
    });

    it("should accept valid string documents and reach collection.upsert", async () => {
      const result = await handleChromaTool(
        mockClient,
        "chroma_upsert_documents",
        {
          collection_name: "test_collection",
          ids: ["id1"],
          documents: ["doc one"],
        },
        TEST_SERVER_CFG,
      );
      expect(result.content[0].text).toContain("Upserted 1 documents");
      expect(mockCollection.upsert).toHaveBeenCalledTimes(1);
    });

    it("should not reject when documents is null (guard skips absent values)", async () => {
      const result = await handleChromaTool(
        mockClient,
        "chroma_upsert_documents",
        {
          collection_name: "test_collection",
          ids: ["id1"],
          documents: null,
        },
        TEST_SERVER_CFG,
      );
      expect(result.content[0].text).toContain("documents or embeddings required");
    });
  });

  describe("chroma_update_documents", () => {
    it("should reject object documents before any Chroma/embedding I/O", async () => {
      const result = await handleChromaTool(
        mockClient,
        "chroma_update_documents",
        {
          collection_name: "test_collection",
          ids: ["id1"],
          documents: [{ content: "updated" }],
        },
        TEST_SERVER_CFG,
      );
      expect(result.content[0].text).toBe("Error: documents[0] must be a string, got object");
      // Guard runs before the R12 pre-check (collection.get) as well.
      expect(mockClient.getCollection).not.toHaveBeenCalled();
      expect(mockCollection.get).not.toHaveBeenCalled();
      expect(mockCollection.update).not.toHaveBeenCalled();
    });

    it("should pass when documents is omitted (ids-only update)", async () => {
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
    });

    it("should accept valid string documents and reach collection.update", async () => {
      const result = await handleChromaTool(
        mockClient,
        "chroma_update_documents",
        {
          collection_name: "test_collection",
          ids: ["id1"],
          documents: ["doc updated"],
        },
        TEST_SERVER_CFG,
      );
      expect(result.content[0].text).toContain("Updated 1 documents");
      expect(mockCollection.update).toHaveBeenCalledTimes(1);
    });

    it("should not reject when documents is null (guard skips absent values)", async () => {
      const result = await handleChromaTool(
        mockClient,
        "chroma_update_documents",
        {
          collection_name: "test_collection",
          ids: ["id1"],
          documents: null,
        },
        TEST_SERVER_CFG,
      );
      expect(result.content[0].text).toContain("Updated 1 documents");
      expect(mockCollection.update).toHaveBeenCalledTimes(1);
    });
  });

  describe("chroma_query_documents", () => {
    it("should reject object query_texts before any Chroma/embedding I/O", async () => {
      const result = await handleChromaTool(
        mockClient,
        "chroma_query_documents",
        {
          collection_name: "test_collection",
          query_texts: [{ content: "what is this" }],
        },
        TEST_SERVER_CFG,
      );
      expect(result.content[0].text).toBe("Error: query_texts[0] must be a string, got object");
      expect(mockClient.getCollection).not.toHaveBeenCalled();
      expect(mockCollection.query).not.toHaveBeenCalled();
    });

    it("should accept valid string query_texts and reach collection.query", async () => {
      const result = await handleChromaTool(
        mockClient,
        "chroma_query_documents",
        {
          collection_name: "test_collection",
          query_texts: ["hello world"],
        },
        TEST_SERVER_CFG,
      );
      expect(result.content[0].text).not.toContain("must be a string");
      expect(mockCollection.query).toHaveBeenCalledTimes(1);
    });

    it("should not reject when query_texts is null (guard skips absent values)", async () => {
      const result = await handleChromaTool(
        mockClient,
        "chroma_query_documents",
        {
          collection_name: "test_collection",
          query_texts: null,
        },
        TEST_SERVER_CFG,
      );
      expect(result.content[0].text).toContain("query_texts or query_embeddings required");
    });
  });
});
