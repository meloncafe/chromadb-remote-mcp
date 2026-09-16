import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { Server } from "http";
import type { AddressInfo } from "net";

describe("OAuth Proxy: rate limit (R13)", () => {
  let server: Server;
  let baseUrl: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    // Very low limit so a small loop triggers 429 quickly.
    process.env.RATE_LIMIT_MAX = "3";
    process.env.OAUTH_PROXY_ENABLED = "true";
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-google-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-google-secret";
    process.env.OIDC_PRESET = "google";
    process.env.OIDC_AUDIENCE = "test-google-client-id";
    process.env.CHROMA_HOST = "127.0.0.1";
    process.env.CHROMA_PORT = "1";

    const mod = await import("../../../../src/index.js");
    await new Promise<void>((resolve) => {
      server = mod.app.listen(0, () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    process.env = originalEnv;
  });

  it("RATE_LIMIT_MAX+1 calls from same IP receive 429 + Retry-After header", async () => {
    // Hit the public metadata endpoint repeatedly. limit=3 → 4th call → 429.
    const url = `${baseUrl}/.well-known/oauth-authorization-server`;

    let okCount = 0;
    let limitedCount = 0;
    let retryAfter: string | null = null;

    for (let i = 0; i < 6; i++) {
      const r = await fetch(url);
      if (r.status === 200) {
        okCount++;
      } else if (r.status === 429) {
        limitedCount++;
        if (!retryAfter) retryAfter = r.headers.get("retry-after");
      }
    }

    expect(okCount).toBeGreaterThanOrEqual(1); // some requests succeeded
    expect(limitedCount).toBeGreaterThanOrEqual(1); // at least one 429
    expect(retryAfter).not.toBeNull();
    expect(retryAfter && retryAfter.length > 0).toBe(true);
  });
});