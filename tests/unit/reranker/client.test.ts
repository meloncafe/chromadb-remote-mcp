import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { rerank } from "../../../src/reranker/client.js";

describe("Phase 6: reranker client (R18-R21)", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalFetch: typeof fetch;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalFetch = global.fetch;
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    delete process.env.RERANKER_API_BASE;
    delete process.env.RERANKER_API_KEY;
    delete process.env.RERANKER_MODEL;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    warnSpy.mockRestore();
  });

  const sampleCandidates = [
    { id: "a", document: "alpha", metadata: null, distance: 0.5 },
    { id: "b", document: "beta", metadata: null, distance: 0.3 },
    { id: "c", document: "gamma", metadata: null, distance: 0.8 },
  ];

  it("R20: returns identity ordering and warns when RERANKER_API_BASE unset", async () => {
    const result = await rerank("q", sampleCandidates, 2);
    expect(result.reranked).toBe(false);
    expect(result.indices).toEqual([0, 1]);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toMatch(/RERANKER_API_BASE not set/);
  });

  it("R18, R19: POSTs to /rerank with body and slices to topK", async () => {
    process.env.RERANKER_API_BASE = "http://localhost:9000";
    process.env.RERANKER_API_KEY = "xyz";
    process.env.RERANKER_MODEL = "bge-reranker-v2-m3";
    let capturedUrl: string = "";
    let capturedInit: { headers?: Record<string, string>; body?: string } | undefined;
    global.fetch = jest.fn(async (url: unknown, init?: unknown) => {
      capturedUrl = String(url);
      capturedInit = init as typeof capturedInit;
      return new Response(
        JSON.stringify({
          results: [
            { index: 2, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.7 },
            { index: 1, relevance_score: 0.5 },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await rerank("query text", sampleCandidates, 2);

    expect(capturedUrl).toBe("http://localhost:9000/rerank");
    expect(capturedInit?.headers?.["Authorization"]).toBe("Bearer xyz");
    const body = JSON.parse(capturedInit?.body || "{}");
    expect(body.model).toBe("bge-reranker-v2-m3");
    expect(body.query).toBe("query text");
    expect(body.top_n).toBe(2);
    expect(body.documents).toEqual(["alpha", "beta", "gamma"]);
    expect(result.reranked).toBe(true);
    expect(result.indices).toEqual([2, 0]);
  });

  it("R21: returns identity ordering when fetch rejects", async () => {
    process.env.RERANKER_API_BASE = "http://localhost:9000";
    global.fetch = jest.fn(() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;
    const result = await rerank("q", sampleCandidates, 2);
    expect(result.reranked).toBe(false);
    expect(result.indices).toEqual([0, 1]);
    expect(warnSpy.mock.calls.some((c) => String(c[0]).match(/Reranker call failed/))).toBe(true);
  });

  it("R21: returns identity ordering on HTTP 500", async () => {
    process.env.RERANKER_API_BASE = "http://localhost:9000";
    global.fetch = jest.fn(async () => new Response("oops", { status: 500 })) as unknown as typeof fetch;
    const result = await rerank("q", sampleCandidates, 2);
    expect(result.reranked).toBe(false);
    expect(result.indices).toEqual([0, 1]);
    expect(warnSpy.mock.calls.some((c) => String(c[0]).match(/HTTP 500/))).toBe(true);
  });

  it("R21: returns identity ordering on malformed response", async () => {
    process.env.RERANKER_API_BASE = "http://localhost:9000";
    global.fetch = jest.fn(
      async () => new Response(JSON.stringify({ foo: "bar" }), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await rerank("q", sampleCandidates, 2);
    expect(result.reranked).toBe(false);
    expect(result.indices).toEqual([0, 1]);
  });
});