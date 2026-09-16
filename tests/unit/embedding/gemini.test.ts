import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { GeminiProvider } from "../../../src/embedding/gemini.js";

interface CapturedRequest {
  url: string;
  body: { taskType: string; outputDimensionality: number; content: { parts: { text: string }[] } };
}

describe("Phase 4: GeminiProvider task_type mapping (R13)", () => {
  let originalFetch: typeof fetch;
  let captured: CapturedRequest[];

  beforeEach(() => {
    originalFetch = global.fetch;
    captured = [];
    global.fetch = jest.fn(async (url: unknown, init?: unknown) => {
      const initRecord = init as { body?: string } | undefined;
      const body = initRecord?.body ? JSON.parse(initRecord.body) : {};
      captured.push({ url: String(url), body });
      return new Response(
        JSON.stringify({ embedding: { values: new Array(1536).fill(0.1) } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends taskType="RETRIEVAL_DOCUMENT" when called with "document"', async () => {
    const provider = new GeminiProvider("fake-key", "gemini-embedding-001", 1536);
    await provider.embed(["hello"], "document");
    expect(captured).toHaveLength(1);
    expect(captured[0].body.taskType).toBe("RETRIEVAL_DOCUMENT");
    expect(captured[0].body.outputDimensionality).toBe(1536);
    expect(captured[0].url).toContain("gemini-embedding-001:embedContent");
  });

  it('sends taskType="RETRIEVAL_QUERY" when called with "query"', async () => {
    const provider = new GeminiProvider("fake-key", "gemini-embedding-001", 768);
    await provider.embed(["search me"], "query");
    expect(captured).toHaveLength(1);
    expect(captured[0].body.taskType).toBe("RETRIEVAL_QUERY");
    expect(captured[0].body.outputDimensionality).toBe(768);
  });

  it("issues one HTTP call per input text", async () => {
    const provider = new GeminiProvider("fake-key", "gemini-embedding-001", 1536);
    await provider.embed(["a", "b", "c"], "document");
    expect(captured).toHaveLength(3);
  });

  it("returns [] for empty input without HTTP call", async () => {
    const provider = new GeminiProvider("fake-key", "gemini-embedding-001", 1536);
    const result = await provider.embed([], "document");
    expect(result).toEqual([]);
    expect(captured).toHaveLength(0);
  });

  it("propagates HTTP errors", async () => {
    global.fetch = jest.fn(async () => new Response("bad", { status: 500 })) as unknown as typeof fetch;
    const provider = new GeminiProvider("fake-key", "gemini-embedding-001", 1536);
    await expect(provider.embed(["x"], "document")).rejects.toThrow(/HTTP 500/);
  });
});