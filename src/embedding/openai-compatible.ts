import type { EmbeddingProvider, TaskType } from "./provider.js";

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
}

/**
 * OpenAI /v1/embeddings compatible provider.
 * Works with OpenAI, Voyage, Together, Ollama, TEI, vLLM, local servers.
 */
export class OpenAICompatibleProvider implements EmbeddingProvider {
  private readonly apiBase: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly dimensions: number;
  private readonly explicitDimensions: boolean;

  constructor(
    apiBase: string,
    apiKey: string | undefined,
    model: string,
    dimensions: number,
    explicitDimensions: boolean,
  ) {
    if (!apiBase) throw new Error("OpenAICompatibleProvider: EMBEDDING_API_BASE is required");
    if (!model) throw new Error("OpenAICompatibleProvider: EMBEDDING_MODEL is required");
    this.apiBase = apiBase.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.model = model;
    this.dimensions = dimensions;
    this.explicitDimensions = explicitDimensions;
  }

  async embed(texts: string[], _taskType: TaskType): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const body: Record<string, unknown> = {
      model: this.model,
      input: texts,
    };
    if (this.explicitDimensions) {
      body.dimensions = this.dimensions;
    }

    const response = await fetch(`${this.apiBase}/v1/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `OpenAICompatibleProvider: HTTP ${response.status} from ${this.apiBase}/v1/embeddings — ${errText.slice(0, 200)}`,
      );
    }

    const json = (await response.json()) as OpenAIEmbeddingResponse;
    if (!Array.isArray(json.data)) {
      throw new Error(
        `OpenAICompatibleProvider: invalid response shape (missing "data" array)`,
      );
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
    return "openai_compatible";
  }
}