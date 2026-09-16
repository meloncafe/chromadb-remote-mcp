import { ChromaClient } from "chromadb";
import { handleChromaTool } from "../../src/chroma-tools.js";
import type { EmbeddingProviderConfig } from "../../src/types.js";

const CHROMA_HOST = process.env.CHROMA_HOST || "localhost";
const CHROMA_PORT = parseInt(process.env.CHROMA_PORT || "8000", 10);

const serverCfg: EmbeddingProviderConfig = {
  provider: "test-provider",
  model: "test-model-v1",
  dimensions: 128,
};

const TEST_COLLECTION_PREFIX = "p1_metadata_v2_";

describe("Integration: Phase 1 metadata schema v2 (R1)", () => {
  let client: ChromaClient;
  let createdCollections: string[];

  beforeAll(async () => {
    client = new ChromaClient({
      host: CHROMA_HOST,
      port: CHROMA_PORT,
      ssl: false,
    });
    createdCollections = [];
  });

  afterAll(async () => {
    for (const name of createdCollections) {
      try {
        await client.deleteCollection({ name });
      } catch {
        // Ignore — best-effort cleanup
      }
    }
  });

  it("persists embedding_provider/model/dimensions on chroma_create_collection", async () => {
    const name = `${TEST_COLLECTION_PREFIX}${Date.now()}_create`;
    createdCollections.push(name);

    const result = await handleChromaTool(
      client,
      "chroma_create_collection",
      { collection_name: name },
      serverCfg,
    );
    expect(result.content[0].text).toContain("created successfully");

    const collection = await client.getCollection({ name });
    expect(collection.metadata).toBeDefined();
    expect(collection.metadata?.embedding_provider).toBe("test-provider");
    expect(collection.metadata?.embedding_model).toBe("test-model-v1");
    expect(collection.metadata?.embedding_dimensions).toBe(128);
  });

  it("persists v2 metadata via getOrCreateCollection path (chroma_get_collection_info)", async () => {
    const name = `${TEST_COLLECTION_PREFIX}${Date.now()}_getor`;
    createdCollections.push(name);

    const result = await handleChromaTool(
      client,
      "chroma_get_collection_info",
      { collection_name: name },
      serverCfg,
    );
    expect(result.content[0].text).toContain(name);

    const collection = await client.getCollection({ name });
    expect(collection.metadata?.embedding_provider).toBe("test-provider");
    expect(collection.metadata?.embedding_dimensions).toBe(128);
  });

  it("merges user-supplied metadata with v2 keys (v2 keys win on conflict)", async () => {
    const name = `${TEST_COLLECTION_PREFIX}${Date.now()}_merge`;
    createdCollections.push(name);

    await handleChromaTool(
      client,
      "chroma_create_collection",
      {
        collection_name: name,
        metadata: {
          description: "user-provided note",
          embedding_provider: "user-wrong-value",
        },
      },
      serverCfg,
    );

    const collection = await client.getCollection({ name });
    expect(collection.metadata?.description).toBe("user-provided note");
    expect(collection.metadata?.embedding_provider).toBe("test-provider");
  });
});