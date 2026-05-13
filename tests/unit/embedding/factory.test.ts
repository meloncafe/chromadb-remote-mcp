import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { createEmbeddingProvider } from "../../../src/embedding/factory.js";
import {
  resolveProviderConfigForCollection,
  clearProviderCache,
  getProviderForConfig,
} from "../../../src/embedding/cache.js";
import { ChromadbDefaultProvider } from "../../../src/embedding/default.js";
import { ExternalProvider } from "../../../src/embedding/external.js";
import { OpenAICompatibleProvider } from "../../../src/embedding/openai-compatible.js";
import { GeminiProvider } from "../../../src/embedding/gemini.js";
import type { EmbeddingProviderConfig } from "../../../src/types.js";

describe("Phase 3: embedding/factory (R8) + cache (R12)", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    clearProviderCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    clearProviderCache();
  });

  describe("createEmbeddingProvider", () => {
    it("returns ChromadbDefaultProvider for chromadb-default", () => {
      const cfg: EmbeddingProviderConfig = {
        provider: "chromadb-default",
        model: "all-MiniLM-L6-v2",
        dimensions: 384,
      };
      const p = createEmbeddingProvider(cfg);
      expect(p).toBeInstanceOf(ChromadbDefaultProvider);
      expect(p.getProviderId()).toBe("chromadb-default");
      expect(p.getDimensions()).toBe(384);
    });

    it("returns ExternalProvider for external", () => {
      const cfg: EmbeddingProviderConfig = {
        provider: "external",
        model: "user-model",
        dimensions: 1024,
      };
      const p = createEmbeddingProvider(cfg);
      expect(p).toBeInstanceOf(ExternalProvider);
      expect(p.getModelId()).toBe("user-model");
      expect(p.getDimensions()).toBe(1024);
    });

    it("returns OpenAICompatibleProvider for openai_compatible", () => {
      process.env.EMBEDDING_API_BASE = "http://localhost:8080";
      process.env.EMBEDDING_API_KEY = "test-key";
      const cfg: EmbeddingProviderConfig = {
        provider: "openai_compatible",
        model: "bge-m3",
        dimensions: 1024,
      };
      const p = createEmbeddingProvider(cfg);
      expect(p).toBeInstanceOf(OpenAICompatibleProvider);
      expect(p.getProviderId()).toBe("openai_compatible");
    });

    it("returns GeminiProvider for gemini", () => {
      process.env.GEMINI_API_KEY = "fake-google-key";
      const cfg: EmbeddingProviderConfig = {
        provider: "gemini",
        model: "gemini-embedding-001",
        dimensions: 1536,
      };
      const p = createEmbeddingProvider(cfg);
      expect(p).toBeInstanceOf(GeminiProvider);
      expect(p.getProviderId()).toBe("gemini");
    });

    it("throws for unknown provider id", () => {
      const cfg: EmbeddingProviderConfig = {
        provider: "bogus-provider",
        model: "x",
        dimensions: 1,
      };
      expect(() => createEmbeddingProvider(cfg)).toThrow(/unknown EMBEDDING_PROVIDER/);
    });

    it("throws when Gemini dimensions is not 768/1536/3072", () => {
      process.env.GEMINI_API_KEY = "fake-google-key";
      const cfg: EmbeddingProviderConfig = {
        provider: "gemini",
        model: "gemini-embedding-001",
        dimensions: 1000,
      };
      expect(() => createEmbeddingProvider(cfg)).toThrow(/EMBEDDING_DIMENSIONS/);
    });

    it("throws when openai_compatible has no EMBEDDING_API_BASE", () => {
      delete process.env.EMBEDDING_API_BASE;
      const cfg: EmbeddingProviderConfig = {
        provider: "openai_compatible",
        model: "x",
        dimensions: 1,
      };
      expect(() => createEmbeddingProvider(cfg)).toThrow(/EMBEDDING_API_BASE/);
    });
  });

  describe("resolveProviderConfigForCollection (R12)", () => {
    const serverCfg: EmbeddingProviderConfig = {
      provider: "gemini",
      model: "gemini-embedding-001",
      dimensions: 1536,
    };

    it("returns server default when collection has no v2 metadata", () => {
      const resolved = resolveProviderConfigForCollection(serverCfg, null);
      expect(resolved).toEqual(serverCfg);
    });

    it("returns collection-specific config when v2 metadata present", () => {
      const resolved = resolveProviderConfigForCollection(serverCfg, {
        embedding_provider: "openai_compatible",
        embedding_model: "bge-m3",
        embedding_dimensions: 1024,
      });
      expect(resolved).toEqual({
        provider: "openai_compatible",
        model: "bge-m3",
        dimensions: 1024,
      });
    });

    it("falls back to server when metadata only partially declares", () => {
      const resolved = resolveProviderConfigForCollection(serverCfg, {
        embedding_provider: "openai_compatible",
        // model & dimensions missing
      });
      expect(resolved).toEqual(serverCfg);
    });
  });

  describe("getProviderForConfig — caching", () => {
    it("returns same instance for identical config", () => {
      const cfg: EmbeddingProviderConfig = {
        provider: "external",
        model: "m",
        dimensions: 4,
      };
      const a = getProviderForConfig(cfg);
      const b = getProviderForConfig({ ...cfg });
      expect(a).toBe(b);
    });

    it("returns different instances for different config keys", () => {
      const a = getProviderForConfig({ provider: "external", model: "m1", dimensions: 4 });
      const b = getProviderForConfig({ provider: "external", model: "m2", dimensions: 4 });
      expect(a).not.toBe(b);
    });
  });
});