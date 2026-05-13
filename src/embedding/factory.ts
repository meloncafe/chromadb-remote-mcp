import type { EmbeddingProvider } from "./provider.js";
import type { EmbeddingProviderConfig } from "../types.js";
import { ChromadbDefaultProvider } from "./default.js";
import { ExternalProvider } from "./external.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { GeminiProvider } from "./gemini.js";
import { VoyageProvider } from "./voyage.js";

export type ProviderId =
  | "chromadb-default"
  | "external"
  | "openai_compatible"
  | "gemini"
  | "voyage";

const VALID_PROVIDERS: readonly ProviderId[] = [
  "chromadb-default",
  "external",
  "openai_compatible",
  "gemini",
  "voyage",
] as const;

function isValidProvider(value: string): value is ProviderId {
  return (VALID_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Builds an EmbeddingProvider from explicit fields (server-wide or per-collection).
 * Caller supplies already-resolved provider/model/dimensions; no env reads here.
 */
export function createEmbeddingProvider(cfg: EmbeddingProviderConfig): EmbeddingProvider {
  const id = cfg.provider;
  if (!isValidProvider(id)) {
    throw new Error(
      `createEmbeddingProvider: unknown EMBEDDING_PROVIDER "${id}". ` +
        `Expected one of ${VALID_PROVIDERS.join(", ")}.`,
    );
  }

  switch (id) {
    case "chromadb-default":
      return new ChromadbDefaultProvider();

    case "external":
      return new ExternalProvider(cfg.dimensions, cfg.model);

    case "openai_compatible": {
      const apiBase = process.env.EMBEDDING_API_BASE || "";
      const apiKey = process.env.EMBEDDING_API_KEY || undefined;
      const explicitDims = Boolean(process.env.EMBEDDING_DIMENSIONS);
      return new OpenAICompatibleProvider(
        apiBase,
        apiKey,
        cfg.model,
        cfg.dimensions,
        explicitDims,
      );
    }

    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY || "";
      return new GeminiProvider(apiKey, cfg.model, cfg.dimensions);
    }

    case "voyage": {
      const apiBase = process.env.EMBEDDING_API_BASE || "https://api.voyageai.com";
      const apiKey = process.env.EMBEDDING_API_KEY || "";
      return new VoyageProvider(apiBase, apiKey, cfg.model, cfg.dimensions);
    }
  }
}