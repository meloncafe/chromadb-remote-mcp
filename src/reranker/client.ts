const RERANK_TIMEOUT_MS = 30000;

export interface RerankCandidate {
  id: string;
  document: string | null;
  metadata: Record<string, unknown> | null;
  distance: number | null;
}

export interface RerankResponse {
  /**
   * Indices into the input candidates, sorted by reranker score (best first).
   * Length is min(input.length, top_k).
   */
  indices: number[];
  /**
   * True when the reranker actually ran (vs. fail-soft pass-through).
   */
  reranked: boolean;
}

interface RerankerResult {
  // Cohere-style top-level key
  results?: Array<{ index: number; relevance_score: number }>;
  // Voyage-style top-level key
  data?: Array<{ index: number; relevance_score: number }>;
}

/**
 * Calls an external reranker over query + candidates and returns ranked indices.
 * fail-soft: any error (no config, timeout, HTTP failure) returns identity ordering
 * truncated to topK without throwing.
 */
export async function rerank(
  query: string,
  candidates: RerankCandidate[],
  topK: number,
): Promise<RerankResponse> {
  const apiBase = process.env.RERANKER_API_BASE;
  const apiKey = process.env.RERANKER_API_KEY;
  const model = process.env.RERANKER_MODEL || "bge-reranker-v2-m3";

  if (!apiBase) {
    console.warn("RERANKER_API_BASE not set — skipping rerank, returning original order.");
    return identityRanking(candidates, topK);
  }

  if (candidates.length === 0) {
    return { indices: [], reranked: false };
  }

  const documents = candidates.map((c) => c.document ?? "");

  // Rerankers score (query, document) pairs. If the candidates were fetched
  // without document text every entry collapses to "", which providers such as
  // Voyage reject with HTTP 400 — the request is spent and fail-soft returns the
  // original ordering anyway. Bail out early with a warning that names the fix.
  if (documents.every((d) => d.trim().length === 0)) {
    console.warn(
      "Rerank candidates carry no document text — add \"documents\" to the query's `include` — returning original order.",
    );
    return identityRanking(candidates, topK);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const body = {
    model,
    query,
    documents,
    top_k: topK,
  };

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);

  try {
    const response = await fetch(`${apiBase.replace(/\/+$/, "")}/rerank`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      // The status code alone does not say which field the provider rejected,
      // and fail-soft hides the failure from the caller, so the body is the only
      // diagnostic that ever reaches an operator.
      const detail = await response.text().catch(() => "");
      console.warn(
        `Reranker HTTP ${response.status} — returning original order.` +
          (detail ? ` Response: ${detail.slice(0, 500)}` : ""),
      );
      return identityRanking(candidates, topK);
    }

    const json = (await response.json()) as RerankerResult;
    const list = Array.isArray(json?.results)
      ? json.results
      : Array.isArray(json?.data)
        ? json.data
        : null;
    if (!list) {
      console.warn(
        "Reranker returned unexpected shape (expected 'results' or 'data' array) — returning original order.",
      );
      return identityRanking(candidates, topK);
    }

    const indices = list
      .filter((r) => Number.isInteger(r.index) && r.index >= 0 && r.index < candidates.length)
      .slice(0, topK)
      .map((r) => r.index);

    return { indices, reranked: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`Reranker call failed (${reason}) — returning original order.`);
    return identityRanking(candidates, topK);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function identityRanking(candidates: RerankCandidate[], topK: number): RerankResponse {
  const limit = Math.min(candidates.length, topK);
  const indices: number[] = [];
  for (let i = 0; i < limit; i++) indices.push(i);
  return { indices, reranked: false };
}
