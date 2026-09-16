import { ChromaClient } from "chromadb";
import { handleChromaTool } from "../../src/chroma-tools.js";
import type { EmbeddingProviderConfig } from "../../src/types.js";

const CHROMA_HOST = process.env.CHROMA_HOST || "localhost";
const CHROMA_PORT = parseInt(process.env.CHROMA_PORT || "8000", 10);

const externalCfg: EmbeddingProviderConfig = {
  provider: "external",
  model: "external-test-model",
  dimensions: 4,
};

const COLLECTION_PREFIX = "p10_v2_";

describe("Phase 10: v2 integration scenarios (R39)", () => {
  let client: ChromaClient;
  let createdCollections: string[];

  beforeAll(async () => {
    client = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT, ssl: false });
    createdCollections = [];
  });

  afterAll(async () => {
    for (const name of createdCollections) {
      try {
        await client.deleteCollection({ name });
      } catch {
        // best-effort cleanup
      }
    }
  });

  it("external mode: add pre-computed embeddings and query by embedding", async () => {
    const name = `${COLLECTION_PREFIX}${Date.now()}_ext`;
    createdCollections.push(name);

    const addResult = await handleChromaTool(
      client,
      "chroma_add_documents",
      {
        collection_name: name,
        ids: ["doc1", "doc2"],
        embeddings: [
          [1, 0, 0, 0],
          [0, 1, 0, 0],
        ],
        metadatas: [{ source: "a" }, { source: "b" }],
      },
      externalCfg,
    );
    expect(addResult.content[0].text).toContain("Added 2 documents");

    const queryResult = await handleChromaTool(
      client,
      "chroma_query_documents",
      {
        collection_name: name,
        query_embeddings: [[1, 0, 0, 0]],
        n_results: 1,
      },
      externalCfg,
    );
    const parsed = JSON.parse(queryResult.content[0].text);
    expect(parsed.ids[0][0]).toBe("doc1");
  });

  const itGemini = process.env.GEMINI_API_KEY ? it : it.skip;

  itGemini("gemini mode: real API embedding round-trip when GEMINI_API_KEY is set", async () => {
    const geminiCfg: EmbeddingProviderConfig = {
      provider: "gemini",
      model: "gemini-embedding-001",
      dimensions: 1536,
    };
    const name = `${COLLECTION_PREFIX}${Date.now()}_gemini`;
    createdCollections.push(name);

    const addResult = await handleChromaTool(
      client,
      "chroma_add_documents",
      {
        collection_name: name,
        ids: ["greeting"],
        documents: ["안녕하세요 반갑습니다"],
      },
      geminiCfg,
    );
    expect(addResult.content[0].text).toContain("Added 1 documents");

    const queryResult = await handleChromaTool(
      client,
      "chroma_query_documents",
      {
        collection_name: name,
        query_texts: ["인사말"],
        n_results: 1,
      },
      geminiCfg,
    );
    const parsed = JSON.parse(queryResult.content[0].text);
    expect(parsed.ids[0][0]).toBe("greeting");
  }, 60000);
});