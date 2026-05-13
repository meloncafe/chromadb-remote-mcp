import type { EmbeddingProvider } from "./provider.js";
import type { EmbeddingProviderConfig } from "../types.js";
import { createEmbeddingProvider } from "./factory.js";

/**
 * Resolves provider config for a specific collection.
 * If the collection metadata declares its own provider/model/dimensions,
 * those override the server default.
 */
export function resolveProviderConfigForCollection(
  serverCfg: EmbeddingProviderConfig,
  collectionMetadata: Record<string, unknown> | null | undefined,
): EmbeddingProviderConfig {
  const meta = collectionMetadata || {};
  const provider = meta.embedding_provider;
  const model = meta.embedding_model;
  const dimensions = meta.embedding_dimensions;

  if (
    typeof provider === "string" &&
    typeof model === "string" &&
    typeof dimensions === "number"
  ) {
    return { provider, model, dimensions };
  }
  return serverCfg;
}

interface CacheKey {
  provider: string;
  model: string;
  dimensions: number;
}

function keyOf(cfg: CacheKey): string {
  return `${cfg.provider}::${cfg.model}::${cfg.dimensions}`;
}

const providerCache = new Map<string, EmbeddingProvider>();

/**
 * Returns a cached EmbeddingProvider matching the config, or creates one.
 * Cache survives the process lifetime — provider instances are stateless.
 */
export function getProviderForConfig(cfg: EmbeddingProviderConfig): EmbeddingProvider {
  const key = keyOf(cfg);
  const cached = providerCache.get(key);
  if (cached) return cached;
  const created = createEmbeddingProvider(cfg);
  providerCache.set(key, created);
  return created;
}

/**
 * Clears the provider cache (test helper only).
 */
export function clearProviderCache(): void {
  providerCache.clear();
}