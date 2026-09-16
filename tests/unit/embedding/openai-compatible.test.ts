import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { OpenAICompatibleProvider } from "../../../src/embedding/openai-compatible.js";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: { model: string; input: string[]; dimensions?: number };
}

describe("Phase 10: OpenAICompatibleProvider (R9, R37)", () => {
  let originalFetch: typeof fetch;
  let captured: Captured;

  beforeEach(() => {
    originalFetch = global.fetch;
    captured = { url: "", headers: {}, body: { model: "", input: [] } };
    global.fetch = jest.fn(async (url: unknown, init?: unknown) => {
      const initRecord = init as { headers?: Record<string, string>; body?: string };
      captured.url = String(url);
      captured.headers = initRecord?.headers || {};
      captured.body = initRecord?.body ? JSON.parse(initRecord.body) : captured.body;
      return new Response(
        JSON.stringify({
          data: [
            { index: 0, embedding: [0.1, 0.2] },
            { index: 1, embedding: [0.3, 0.4] },
          ],
          model: "bge-m3",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends Authorization header when API key set", async () => {
    const p = new OpenAICompatibleProvider("http://host", "sk-test", "bge-m3", 1024, false);
    await p.embed(["a", "b"], "document");
    expect(captured.headers["Authorization"]).toBe("Bearer sk-test");
    expect(captured.url).toBe("http://host/v1/embeddings");
    expect(captured.body.model).toBe("bge-m3");
    expect(captured.body.input).toEqual(["a", "b"]);
    expect(captured.body.dimensions).toBeUndefined();
  });

  it("omits Authorization header when API key absent", async () => {
    const p = new OpenAICompatibleProvider("http://host", undefined, "bge-m3", 1024, false);
    await p.embed(["a"], "document");
    expect(captured.headers["Authorization"]).toBeUndefined();
  });

  it("sends dimensions when explicitDimensions=true", async () => {
    const p = new OpenAICompatibleProvider("http://host", undefined, "bge-m3", 768, true);
    await p.embed(["a"], "document");
    expect(captured.body.dimensions).toBe(768);
  });

  it("returns embeddings sorted by index", async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { index: 1, embedding: [9, 9] },
              { index: 0, embedding: [1, 1] },
            ],
            model: "bge-m3",
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const p = new OpenAICompatibleProvider("http://host", undefined, "bge-m3", 2, false);
    const result = await p.embed(["a", "b"], "document");
    expect(result).toEqual([
      [1, 1],
      [9, 9],
    ]);
  });

  it("throws on HTTP error", async () => {
    global.fetch = jest.fn(
      async () => new Response("bad", { status: 500 }),
    ) as unknown as typeof fetch;
    const p = new OpenAICompatibleProvider("http://host", undefined, "bge-m3", 2, false);
    await expect(p.embed(["a"], "document")).rejects.toThrow(/HTTP 500/);
  });

  it("throws when missing EMBEDDING_API_BASE in constructor", () => {
    expect(() => new OpenAICompatibleProvider("", undefined, "m", 1, false)).toThrow(
      /EMBEDDING_API_BASE/,
    );
  });
});