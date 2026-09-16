import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

describe("Phase 1: resolveEmbeddingProviderConfig — R3 startup warning", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_DIMENSIONS;
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    warnSpy.mockRestore();
  });

  it("emits R3 warning when EMBEDDING_PROVIDER is unset", async () => {
    const { resolveEmbeddingProviderConfig } = await import(
      "../../src/embedding-config.js"
    );
    const cfg = resolveEmbeddingProviderConfig();
    expect(cfg.provider).toBe("chromadb-default");
    expect(cfg.model).toBe("all-MiniLM-L6-v2");
    expect(cfg.dimensions).toBe(384);
    const warnMessages = warnSpy.mock.calls.map((args) => String(args[0])).join("\n");
    expect(warnMessages).toContain("all-MiniLM-L6-v2");
    expect(warnMessages).toContain("English-only");
    expect(warnMessages).toContain("EMBEDDING_PROVIDER");
  });

  it("emits R3 warning when EMBEDDING_PROVIDER is explicitly chromadb-default", async () => {
    process.env.EMBEDDING_PROVIDER = "chromadb-default";
    const { resolveEmbeddingProviderConfig } = await import(
      "../../src/embedding-config.js"
    );
    resolveEmbeddingProviderConfig();
    const warnMessages = warnSpy.mock.calls.map((args) => String(args[0])).join("\n");
    expect(warnMessages).toContain("English-only");
  });

  it("does not emit R3 warning when EMBEDDING_PROVIDER is gemini", async () => {
    process.env.EMBEDDING_PROVIDER = "gemini";
    process.env.EMBEDDING_MODEL = "gemini-embedding-001";
    process.env.EMBEDDING_DIMENSIONS = "1536";
    const { resolveEmbeddingProviderConfig } = await import(
      "../../src/embedding-config.js"
    );
    const cfg = resolveEmbeddingProviderConfig();
    expect(cfg.provider).toBe("gemini");
    expect(cfg.model).toBe("gemini-embedding-001");
    expect(cfg.dimensions).toBe(1536);
    const warnMessages = warnSpy.mock.calls.map((args) => String(args[0])).join("\n");
    expect(warnMessages).not.toContain("English-only");
  });
});