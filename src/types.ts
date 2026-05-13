import type { CollectionMetadata } from "chromadb";

export interface ChromaConfig {
  host: string;
  port: number;
  authToken?: string;
  tenantName?: string;
  databaseName?: string;
}

/**
 * Collection metadata schema v2.
 * Stored on every collection so add/query/get can detect provider mismatch.
 * Extends ChromaDB's CollectionMetadata so the three v2 keys are required
 * while keeping the index-signature compatibility ChromaDB expects.
 */
export type CollectionMetadataV2 = CollectionMetadata & {
  embedding_provider: string;
  embedding_model: string;
  embedding_dimensions: number;
};

/**
 * Server-wide embedding provider configuration.
 * Resolved from environment variables at startup.
 */
export interface EmbeddingProviderConfig {
  provider: string;
  model: string;
  dimensions: number;
}