/**
 * Embedding task type — distinguishes document indexing from query encoding.
 * Some providers (Gemini) generate different embeddings for the same text
 * depending on whether it's being indexed or queried.
 */
export type TaskType = "document" | "query";

/**
 * Provider-agnostic embedding interface.
 * Implementations: ChromadbDefaultProvider, ExternalProvider,
 * OpenAICompatibleProvider, GeminiProvider.
 */
export interface EmbeddingProvider {
  /**
   * Compute embeddings for the given texts.
   * @param texts - Non-empty list of input strings.
   * @param taskType - "document" for indexing, "query" for search.
   * @returns Array of float vectors, one per input.
   */
  embed(texts: string[], taskType: TaskType): Promise<number[][]>;

  /**
   * Vector dimensionality this provider emits.
   */
  getDimensions(): number;

  /**
   * Stable identifier of the underlying model (for collection metadata).
   */
  getModelId(): string;

  /**
   * Provider key matching EMBEDDING_PROVIDER env values.
   * One of: "chromadb-default" | "external" | "openai_compatible" | "gemini".
   */
  getProviderId(): string;
}