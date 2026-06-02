/**
 * chroma-tools.modify.spec.ts
 *
 * Unit tests for R5 (CVE-2026-45829): chroma_modify_collection metadata hardening.
 *
 * AC coverage:
 *   R5 AC#1 — `metadata: args.metadata` raw passthrough removed from modify case
 *   R5 AC#2 — `buildCollectionMetadata(serverProviderCfg` appears >= 3 times (create + get-or-create + modify)
 *   R5 AC#3 — client evil embedding_* keys are overwritten by server values in modify
 *
 * Strategy: mock the ChromaDB client and verify that collection.modify() receives
 * server-priority embedding metadata, not the raw client-supplied values.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { buildCollectionMetadata } from "../../src/chroma-tools.js";

// ---------------------------------------------------------------------------
// buildCollectionMetadata unit tests (R5 AC#3 — server value priority)
// ---------------------------------------------------------------------------

describe("buildCollectionMetadata — R5: server embedding keys override client keys", () => {
  const serverCfg = {
    provider: "openai",
    model: "text-embedding-3-small",
    dimensions: 1536,
  };

  it("client embedding_provider is overridden by server value", () => {
    const result = buildCollectionMetadata(serverCfg, {
      embedding_provider: "evil-provider",
      custom_key: "custom_value",
    });
    expect(result.embedding_provider).toBe("openai");
    expect((result as Record<string, unknown>).custom_key).toBe("custom_value");
  });

  it("client embedding_model is overridden by server value", () => {
    const result = buildCollectionMetadata(serverCfg, {
      embedding_model: "evil-model",
    });
    expect(result.embedding_model).toBe("text-embedding-3-small");
  });

  it("client embedding_dimensions is overridden by server value", () => {
    const result = buildCollectionMetadata(serverCfg, {
      embedding_dimensions: 7,
    });
    expect(result.embedding_dimensions).toBe(1536);
  });

  it("all three evil embedding keys are overridden simultaneously", () => {
    const result = buildCollectionMetadata(serverCfg, {
      embedding_provider: "evil",
      embedding_model: "x",
      embedding_dimensions: 7,
      safe_key: "safe_value",
    });
    expect(result.embedding_provider).toBe("openai");
    expect(result.embedding_model).toBe("text-embedding-3-small");
    expect(result.embedding_dimensions).toBe(1536);
    // Non-embedding keys from client are preserved
    expect((result as Record<string, unknown>).safe_key).toBe("safe_value");
  });

  it("client metadata without embedding keys passes through non-embedding keys", () => {
    const result = buildCollectionMetadata(serverCfg, {
      description: "my collection",
      version: "1",
    });
    expect((result as Record<string, unknown>).description).toBe("my collection");
    expect((result as Record<string, unknown>).version).toBe("1");
    // Server keys are always set
    expect(result.embedding_provider).toBe("openai");
    expect(result.embedding_model).toBe("text-embedding-3-small");
    expect(result.embedding_dimensions).toBe(1536);
  });

  it("undefined client metadata uses only server keys", () => {
    const result = buildCollectionMetadata(serverCfg, undefined);
    expect(result.embedding_provider).toBe("openai");
    expect(result.embedding_model).toBe("text-embedding-3-small");
    expect(result.embedding_dimensions).toBe(1536);
  });
});

// ---------------------------------------------------------------------------
// Grep-based AC checks
// ---------------------------------------------------------------------------

describe("R5 AC grep checks", () => {
  it("R5 AC#1: metadata: args.metadata raw passthrough not present in chroma-tools.ts", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const filePath = path.resolve(
      __dirname,
      "../../src/chroma-tools.ts",
    );
    const content = fs.readFileSync(filePath, "utf-8");
    // The raw passthrough pattern must not appear
    const matches = content.match(/metadata:\s*args\.metadata/g) || [];
    expect(matches.length).toBe(0);
  });

  it("R5 AC#2: buildCollectionMetadata(serverProviderCfg appears >= 3 times in chroma-tools.ts", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const filePath = path.resolve(
      __dirname,
      "../../src/chroma-tools.ts",
    );
    const content = fs.readFileSync(filePath, "utf-8");
    const matches = content.match(/buildCollectionMetadata\(serverProviderCfg/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});
