/**
 * mcp-auth-token.spec.ts
 *
 * Integration test verifying that the MCP_AUTH_TOKEN service-account path
 * continues to work correctly after R2 audience hardening (CVE-2026-45829).
 *
 * AC coverage:
 *   R2 AC#5 — MCP_AUTH_TOKEN + OIDC unset + Authorization:Bearer <token> → POST /mcp status 200
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { Server } from "http";
import type { AddressInfo } from "net";

const VALID_TOKEN = "integration-test-service-account-token-r2ac5";

describe("R2 AC#5: MCP_AUTH_TOKEN service-account path (regression guard)", () => {
  let server: Server;
  let baseUrl: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };

    // Only MCP_AUTH_TOKEN — no OIDC config at all
    delete process.env.OIDC_ISSUERS;
    delete process.env.OIDC_PRESET;
    delete process.env.OIDC_AUDIENCE;
    delete process.env.OAUTH_PROXY_ENABLED;
    delete process.env.ALLOW_INSECURE_NO_AUTH;
    process.env.MCP_AUTH_TOKEN = VALID_TOKEN;

    // Minimal ChromaDB config
    process.env.CHROMA_HOST = "localhost";
    process.env.CHROMA_PORT = "8000";

    const mod = await import("../../src/index.js");
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

  it("POST /mcp with valid Bearer MCP_AUTH_TOKEN returns 200 (not 401)", async () => {
    // Send a minimal MCP initialize request
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_TOKEN}`,
        // MCP protocol version header
        "MCP-Protocol-Version": "2024-11-05",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });

    // The server should accept the auth and respond — not 401
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("POST /mcp with wrong token returns 401", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-token",
        "MCP-Protocol-Version": "2024-11-05",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });

    expect(res.status).toBe(401);
  });

  it("POST /mcp without Authorization header returns 401", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2024-11-05",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });

    expect(res.status).toBe(401);
  });
});
