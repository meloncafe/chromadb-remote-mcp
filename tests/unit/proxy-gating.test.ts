/**
 * proxy-gating.test.ts
 *
 * Unit tests for R3 (CVE-2026-45829) catch-all REST proxy hardening.
 *
 * AC coverage:
 *   R3 AC#1 — CHROMA_REST_PROXY_ENABLED unset → GET /api/v2/heartbeat returns 404 (mount skipped)
 *   R3 AC#2 — proxy active + auth + collection write path → status >= 400 (pathFilter blocked)
 *   R3 AC#3 — proxy active + Origin: http://evil.example → 403 (DNS-rebind defense)
 *   R3 AC#4 — proxy active + body contains configuration.embedding_function → 400
 *   R3 AC#5 — CHROMA_REST_PROXY_ENABLED appears in src/index.ts (source grep)
 *
 * Strategy: spin up an in-process http.Server on an ephemeral port for each test
 * group, using jest.resetModules() between groups to get a fresh app instance
 * with different env variable configurations.
 */

import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import type { Server } from "http";
import type { AddressInfo } from "net";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_ENV: Record<string, string> = {
  NODE_ENV: "test",
  CHROMA_HOST: "localhost",
  CHROMA_PORT: "8000",
  CHROMA_TENANT: "default_tenant",
  CHROMA_DATABASE: "default_database",
  LOG_LEVEL: "error",
};

const CLEAR_KEYS = [
  "CHROMA_REST_PROXY_ENABLED",
  "MCP_AUTH_TOKEN",
  "OIDC_ISSUERS",
  "OIDC_PRESET",
  "OIDC_AUDIENCE",
  "ALLOW_INSECURE_NO_AUTH",
  "OAUTH_PROXY_ENABLED",
  "ALLOWED_ORIGINS",
];

function applyEnv(overrides: Record<string, string | undefined>) {
  for (const k of CLEAR_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(BASE_ENV)) process.env[k] = v;
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function startServer(overrides: Record<string, string | undefined>): Promise<{
  server: Server;
  baseUrl: string;
}> {
  applyEnv(overrides);
  jest.resetModules();
  const mod = await import("../../src/index.js");
  const app = (mod as { app: import("express").Express }).app;
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

// ---------------------------------------------------------------------------
// R3 AC#1 — proxy OFF (default)
// ---------------------------------------------------------------------------

describe("R3 AC#1 — proxy OFF (CHROMA_REST_PROXY_ENABLED unset)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await startServer({
      MCP_AUTH_TOKEN: "test-token",
      // CHROMA_REST_PROXY_ENABLED intentionally not set
    }));
  });

  afterAll(async () => {
    await stopServer(server);
    jest.resetModules();
  });

  it("GET /api/v2/heartbeat → 404 (proxy not mounted)", async () => {
    const res = await fetch(`${baseUrl}/api/v2/heartbeat`, {
      headers: { Authorization: "Bearer test-token" },
    });
    expect(res.status).toBe(404);
  });
});

describe("R3 AC#1 — proxy OFF (CHROMA_REST_PROXY_ENABLED=false)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await startServer({
      MCP_AUTH_TOKEN: "test-token",
      CHROMA_REST_PROXY_ENABLED: "false",
    }));
  });

  afterAll(async () => {
    await stopServer(server);
    jest.resetModules();
  });

  it("GET /api/v2/heartbeat → 404 (proxy not mounted)", async () => {
    const res = await fetch(`${baseUrl}/api/v2/heartbeat`, {
      headers: { Authorization: "Bearer test-token" },
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// R3 AC#2 + AC#3 + AC#4 — proxy ON
// ---------------------------------------------------------------------------

describe("R3 AC#2 + AC#3 + AC#4 — proxy ON (CHROMA_REST_PROXY_ENABLED=true)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await startServer({
      MCP_AUTH_TOKEN: "test-token",
      CHROMA_REST_PROXY_ENABLED: "true",
    }));
  });

  afterAll(async () => {
    await stopServer(server);
    jest.resetModules();
  });

  // R3 AC#2: collection write paths blocked by pathFilter
  it("POST /api/v2/.../collections → status >= 400 (collection create blocked)", async () => {
    const res = await fetch(
      `${baseUrl}/api/v2/tenants/default_tenant/databases/default_database/collections`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "my-collection" }),
      },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("DELETE /api/v2/.../collections/:id → status >= 400 (collection delete blocked)", async () => {
    const res = await fetch(
      `${baseUrl}/api/v2/tenants/default_tenant/databases/default_database/collections/some-id`,
      {
        method: "DELETE",
        headers: { Authorization: "Bearer test-token" },
      },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("PUT /api/v2/.../collections/:id → status >= 400 (collection modify blocked)", async () => {
    const res = await fetch(
      `${baseUrl}/api/v2/tenants/default_tenant/databases/default_database/collections/abc-123`,
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "renamed" }),
      },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("GET /api/v2/.../embedding_function → status >= 400 (embedding path blocked)", async () => {
    const res = await fetch(
      `${baseUrl}/api/v2/tenants/t/databases/d/collections/c/embedding_function`,
      {
        headers: { Authorization: "Bearer test-token" },
      },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  // R3 AC#3: DNS-rebind defense — untrusted Origin → 403
  it("GET /api/v2/heartbeat with Origin: http://evil.example → 403", async () => {
    const res = await fetch(`${baseUrl}/api/v2/heartbeat`, {
      headers: {
        Authorization: "Bearer test-token",
        Origin: "http://evil.example",
      },
    });
    expect(res.status).toBe(403);
  });

  it("GET /api/v2/heartbeat with trusted Origin (localhost) → not 403", async () => {
    const res = await fetch(`${baseUrl}/api/v2/heartbeat`, {
      headers: {
        Authorization: "Bearer test-token",
        Origin: "http://localhost:3000",
      },
    });
    // validateOriginHeader passes localhost → not 403
    // pathFilter passes /heartbeat GET → proxy no-op mock → any non-403 is correct
    expect(res.status).not.toBe(403);
  });

  // R3 AC#4: body with embedding_function → 400
  it("POST body with configuration.embedding_function → 400 (body sanitize rejects)", async () => {
    // Use /api/v2/heartbeat (not a collection write path, so it passes pathFilter)
    // but include the forbidden body key — body sanitize fires after pathFilter
    const res = await fetch(`${baseUrl}/api/v2/heartbeat`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
        Origin: "http://localhost",  // trusted origin to avoid 403
      },
      body: JSON.stringify({
        configuration: {
          embedding_function: {
            name: "default",
            config: { trust_remote_code: true, model: "evil/model" },
          },
        },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST body without embedding_function passes body sanitize", async () => {
    const res = await fetch(`${baseUrl}/api/v2/heartbeat`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({ name: "safe-payload" }),
    });
    // No forbidden key → sanitize passes → not 400
    expect(res.status).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// R3 AC#5 — CHROMA_REST_PROXY_ENABLED appears in src/index.ts
// ---------------------------------------------------------------------------

describe("R3 AC#5 — source contains CHROMA_REST_PROXY_ENABLED", () => {
  it("src/index.ts contains CHROMA_REST_PROXY_ENABLED", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const src = readFileSync(join(process.cwd(), "src/index.ts"), "utf-8");
    expect(src).toMatch(/CHROMA_REST_PROXY_ENABLED/);
  });
});
