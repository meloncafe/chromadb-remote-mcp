/**
 * Confidence gating filter for ChromaDB query results.
 * Converts distances to similarity scores and drops items below min_score.
 */

export interface QueryResultSubset {
  ids: string[][];
  documents?: (string | null)[][];
  metadatas?: (Record<string, unknown> | null)[][];
  distances?: (number | null)[][];
  embeddings?: (number[] | null)[][];
  uris?: (string | null)[][];
  include?: string[];
}

export interface ConfidenceFilterOutput {
  results: QueryResultSubset;
  filtered: boolean;
  removed: number;
}

/**
 * Converts a distance to a similarity score in [0, 1].
 * Uses 1 / (1 + distance) so smaller distance → higher similarity.
 */
export function distanceToSimilarity(distance: number | null | undefined): number {
  if (distance === null || distance === undefined || Number.isNaN(distance)) {
    return 0;
  }
  return 1 / (1 + Math.max(0, distance));
}

/**
 * Applies min_score gate to a ChromaDB query result.
 * Items whose similarity < minScore are removed per query group.
 * minScore = 0 disables filtering.
 */
export function applyConfidenceFilter(
  results: QueryResultSubset,
  minScore: number,
): ConfidenceFilterOutput {
  if (!minScore || minScore <= 0) {
    return { results, filtered: false, removed: 0 };
  }

  const distances = results.distances ?? [];
  const out: QueryResultSubset = {
    ids: [],
    documents: results.documents ? [] : undefined,
    metadatas: results.metadatas ? [] : undefined,
    distances: results.distances ? [] : undefined,
    embeddings: results.embeddings ? [] : undefined,
    uris: results.uris ? [] : undefined,
    include: results.include,
  };

  let removed = 0;

  for (let g = 0; g < results.ids.length; g++) {
    const groupIds: string[] = [];
    const groupDocs: (string | null)[] = [];
    const groupMetas: (Record<string, unknown> | null)[] = [];
    const groupDists: (number | null)[] = [];
    const groupEmbs: (number[] | null)[] = [];
    const groupUris: (string | null)[] = [];

    const idGroup = results.ids[g] ?? [];
    const distGroup = distances[g] ?? [];

    for (let i = 0; i < idGroup.length; i++) {
      const sim = distanceToSimilarity(distGroup[i] ?? null);
      if (sim < minScore) {
        removed += 1;
        continue;
      }
      groupIds.push(idGroup[i]);
      if (results.documents) groupDocs.push(results.documents[g]?.[i] ?? null);
      if (results.metadatas) groupMetas.push(results.metadatas[g]?.[i] ?? null);
      if (results.distances) groupDists.push(distGroup[i] ?? null);
      if (results.embeddings) groupEmbs.push(results.embeddings[g]?.[i] ?? null);
      if (results.uris) groupUris.push(results.uris[g]?.[i] ?? null);
    }

    out.ids.push(groupIds);
    if (out.documents) out.documents.push(groupDocs);
    if (out.metadatas) out.metadatas.push(groupMetas);
    if (out.distances) out.distances.push(groupDists);
    if (out.embeddings) out.embeddings.push(groupEmbs);
    if (out.uris) out.uris.push(groupUris);
  }

  return { results: out, filtered: true, removed };
}

/**
 * Returns true when every query group's id list is empty.
 * Used to emit the "no_confident_match" metadata flag (R16).
 */
export function isResultEmpty(results: QueryResultSubset): boolean {
  if (!results.ids || results.ids.length === 0) return true;
  return results.ids.every((group) => !group || group.length === 0);
}

/**
 * Resolves effective min_score: tool arg has priority over env default.
 * Returns 0 (disabled) when neither is set.
 */
export function resolveMinScore(toolArg: unknown, envValue: string | undefined): number {
  if (typeof toolArg === "number" && toolArg >= 0 && toolArg <= 1) return toolArg;
  if (envValue) {
    const parsed = parseFloat(envValue);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  }
  return 0;
}