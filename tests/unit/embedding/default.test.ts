import { describe, it, expect } from "@jest/globals";
import { ChromadbDefaultProvider } from "../../../src/embedding/default.js";

describe("Phase 10: ChromadbDefaultProvider (R37)", () => {
  it("reports 384 dimensions and stable model id", () => {
    const p = new ChromadbDefaultProvider();
    expect(p.getDimensions()).toBe(384);
    expect(p.getModelId()).toBe("all-MiniLM-L6-v2");
    expect(p.getProviderId()).toBe("chromadb-default");
  });

  it("embed() rejects with sentinel error", async () => {
    const p = new ChromadbDefaultProvider();
    await expect(p.embed(["x"], "document")).rejects.toThrow(/must not be called/);
  });
});