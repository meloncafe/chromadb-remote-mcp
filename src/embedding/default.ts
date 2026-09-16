import type { EmbeddingProvider, TaskType } from "./provider.js";

/**
 * Sentinel provider for ChromaDB's built-in embedder (all-MiniLM-L6-v2).
 * embed() throws — caller must pass raw documents and let ChromaDB embed them.
 * Used for collection metadata identification only.
 */
export class ChromadbDefaultProvider implements EmbeddingProvider {
  embed(_texts: string[], _taskType: TaskType): Promise<number[][]> {
    return Promise.reject(
      new Error(
        "ChromadbDefaultProvider.embed must not be called — pass documents to ChromaDB directly.",
      ),
    );
  }

  getDimensions(): number {
    return 384;
  }

  getModelId(): string {
    return "all-MiniLM-L6-v2";
  }

  getProviderId(): string {
    return "chromadb-default";
  }
}