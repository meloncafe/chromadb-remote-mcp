import { describe, it, expect } from "@jest/globals";
import {
  applyConfidenceFilter,
  distanceToSimilarity,
  isResultEmpty,
  resolveMinScore,
} from "../../../src/confidence/filter.js";

describe("Phase 5: confidence filter (R15, R16, R17)", () => {
  describe("distanceToSimilarity", () => {
    it("maps small distance to high similarity", () => {
      expect(distanceToSimilarity(0)).toBeCloseTo(1, 5);
      expect(distanceToSimilarity(0.1)).toBeGreaterThan(0.9);
    });

    it("maps large distance to low similarity", () => {
      expect(distanceToSimilarity(10)).toBeLessThan(0.1);
    });

    it("returns 0 for null/undefined/NaN", () => {
      expect(distanceToSimilarity(null)).toBe(0);
      expect(distanceToSimilarity(undefined)).toBe(0);
      expect(distanceToSimilarity(NaN)).toBe(0);
    });
  });

  describe("applyConfidenceFilter (R15)", () => {
    it("filters out items below min_score, keeps items above", () => {
      const result = applyConfidenceFilter(
        {
          ids: [["a", "b", "c"]],
          documents: [["doc-a", "doc-b", "doc-c"]],
          distances: [[0.1, 0.5, 0.9]],
        },
        0.6,
      );
      expect(result.filtered).toBe(true);
      expect(result.results.ids).toEqual([["a", "b"]]);
      expect(result.results.documents).toEqual([["doc-a", "doc-b"]]);
      expect(result.results.distances).toEqual([[0.1, 0.5]]);
      expect(result.removed).toBe(1);
    });

    it("returns unchanged when min_score is 0 (disabled)", () => {
      const input = {
        ids: [["a"]],
        distances: [[5]],
      };
      const result = applyConfidenceFilter(input, 0);
      expect(result.filtered).toBe(false);
      expect(result.results).toBe(input);
    });

    it("preserves per-group structure when one group becomes empty", () => {
      const result = applyConfidenceFilter(
        {
          ids: [["a"], ["b"]],
          distances: [[0.1], [10]],
        },
        0.6,
      );
      expect(result.results.ids).toEqual([["a"], []]);
      expect(result.removed).toBe(1);
    });
  });

  describe("isResultEmpty (R16)", () => {
    it("returns true when all groups empty", () => {
      expect(isResultEmpty({ ids: [[]] })).toBe(true);
      expect(isResultEmpty({ ids: [[], []] })).toBe(true);
    });

    it("returns false when any group has items", () => {
      expect(isResultEmpty({ ids: [["a"]] })).toBe(false);
      expect(isResultEmpty({ ids: [[], ["b"]] })).toBe(false);
    });
  });

  describe("resolveMinScore (R17)", () => {
    it("uses tool arg when valid", () => {
      expect(resolveMinScore(0.7, undefined)).toBe(0.7);
      expect(resolveMinScore(0.7, "0.5")).toBe(0.7);
    });

    it("falls back to env when tool arg missing", () => {
      expect(resolveMinScore(undefined, "0.5")).toBe(0.5);
    });

    it("returns 0 when both missing or invalid", () => {
      expect(resolveMinScore(undefined, undefined)).toBe(0);
      expect(resolveMinScore("bad", "abc")).toBe(0);
      expect(resolveMinScore(2, undefined)).toBe(0);
      expect(resolveMinScore(-1, undefined)).toBe(0);
    });
  });
});