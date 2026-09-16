import type { EmbeddingProvider, TaskType } from "./provider.js";

/**
 * Sentinel provider for external mode — caller supplies pre-computed embeddings.
 * embed() throws because the server never computes embeddings in this mode.
 * Dimension is configured via EMBEDDING_DIMENSIONS env (default 384).
 */
export class ExternalProvider implements EmbeddingProvider {
  private readonly dimensions: number;
  private readonly modelId: string;

  constructor(dimensions: number, modelId: string) {
    this.dimensions = dimensions;
    this.modelId = modelId;
  }

  embed(_texts: string[], _taskType: TaskType): Promise<number[][]> {
    return Promise.reject(
      new Error(
        "ExternalProvider.embed must not be called — pass pre-computed embeddings via tool arguments.",
      ),
    );
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getModelId(): string {
    return this.modelId;
  }

  getProviderId(): string {
    return "external";
  }
}