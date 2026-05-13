import { describe, it, expect } from "@jest/globals";
import { ExternalProvider } from "../../../src/embedding/external.js";

describe("Phase 10: ExternalProvider (R37)", () => {
  it("reports constructor-supplied dimensions and model id", () => {
    const p = new ExternalProvider(1024, "custom-model");
    expect(p.getDimensions()).toBe(1024);
    expect(p.getModelId()).toBe("custom-model");
    expect(p.getProviderId()).toBe("external");
  });

  it("embed() rejects — external mode requires caller-supplied embeddings", async () => {
    const p = new ExternalProvider(1024, "m");
    await expect(p.embed(["hello"], "query")).rejects.toThrow(/must not be called/);
  });
});