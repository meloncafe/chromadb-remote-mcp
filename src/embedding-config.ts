import type { EmbeddingProviderConfig } from "./types.js";

/**
 * Resolves server-wide embedding provider config from environment.
 * Emits R3 warning to stdout when defaulting to ChromaDB built-in embedder.
 */
export function resolveEmbeddingProviderConfig(): EmbeddingProviderConfig {
  const provider = (process.env.EMBEDDING_PROVIDER || "chromadb-default").trim();
  const model = (process.env.EMBEDDING_MODEL || "all-MiniLM-L6-v2").trim();
  const dimensions = parseInt(process.env.EMBEDDING_DIMENSIONS || "384", 10);

  if (provider === "chromadb-default" || !process.env.EMBEDDING_PROVIDER) {
    console.warn(
      "Using ChromaDB default embedding (all-MiniLM-L6-v2, English-only). " +
        "For multilingual or production use, set EMBEDDING_PROVIDER. " +
        "See README §Embedding Configuration.",
    );
  }

  return { provider, model, dimensions };
}

export const embeddingProviderConfig: EmbeddingProviderConfig = resolveEmbeddingProviderConfig();