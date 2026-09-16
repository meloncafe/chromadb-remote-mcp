import type { EmbeddingProvider, TaskType } from "./provider.js";

interface GeminiEmbedContentResponse {
  embedding: { values: number[] };
}

const ALLOWED_DIMENSIONS = [768, 1536, 3072] as const;

function taskTypeToGemini(taskType: TaskType): string {
  return taskType === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
}

/**
 * Google AI Studio Embedding API (gemini-embedding-001) provider.
 * Supports task_type split (RETRIEVAL_DOCUMENT/QUERY) and Matryoshka dimensions.
 */
export class GeminiProvider implements EmbeddingProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimensions: number;

  constructor(apiKey: string, model: string, dimensions: number) {
    if (!apiKey) throw new Error("GeminiProvider: GEMINI_API_KEY is required");
    if (!ALLOWED_DIMENSIONS.includes(dimensions as 768 | 1536 | 3072)) {
      throw new Error(
        `GeminiProvider: EMBEDDING_DIMENSIONS must be one of ${ALLOWED_DIMENSIONS.join("/")}, got ${dimensions}`,
      );
    }
    this.apiKey = apiKey;
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(texts: string[], taskType: TaskType): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];

    const results: number[][] = [];
    for (const text of texts) {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent` +
        `?key=${encodeURIComponent(this.apiKey)}`;

      const body = {
        content: { parts: [{ text }] },
        taskType: taskTypeToGemini(taskType),
        outputDimensionality: this.dimensions,
      };

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(
          `GeminiProvider: HTTP ${response.status} from embedContent — ${errText.slice(0, 200)}`,
        );
      }

      const json = (await response.json()) as GeminiEmbedContentResponse;
      if (!json.embedding || !Array.isArray(json.embedding.values)) {
        throw new Error("GeminiProvider: invalid response shape (missing embedding.values)");
      }
      results.push(json.embedding.values);
    }
    return results;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getModelId(): string {
    return this.model;
  }

  getProviderId(): string {
    return "gemini";
  }
}