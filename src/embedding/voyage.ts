import type { EmbeddingProvider, TaskType } from "./provider.js";

interface VoyageEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model?: string;
}

/**
 * Embedding provider for Voyage AI's embeddings API.
 *
 * Voyage uses `output_dimension` (not `dimensions`) and supports
 * `input_type: "query" | "document"` for asymmetric embeddings.
 */
export class VoyageProvider implements EmbeddingProvider {
  private readonly apiBase: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimensions: number;

  constructor(apiBase: string, apiKey: string, model: string, dimensions: number) {
    if (!apiBase) {
      throw new Error("VoyageProvider: apiBase must not be empty");
    }
    if (!apiKey) {
      throw new Error("VoyageProvider: apiKey must not be empty");
    }
    if (!model) {
      throw new Error("VoyageProvider: model must not be empty");
    }
    this.apiBase = apiBase.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(texts: string[], taskType?: TaskType): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const inputType: "query" | "document" = taskType === "query" ? "query" : "document";

    const body = {
      model: this.model,
      input: texts,
      input_type: inputType,
      output_dimension: this.dimensions,
    };

    const url = `${this.apiBase}/v1/embeddings`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      const snippet = text.slice(0, 200);
      throw new Error(
        `VoyageProvider: HTTP ${response.status} from ${url} — ${snippet}`,
      );
    }

    const json = (await response.json()) as VoyageEmbeddingResponse;

    if (!Array.isArray(json.data)) {
      throw new Error('VoyageProvider: invalid response shape (missing "data" array)');
    }

    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getModelId(): string {
    return this.model;
  }

  getProviderId(): string {
    return "voyage";
  }
}
