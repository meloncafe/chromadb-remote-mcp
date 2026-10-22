import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Request, Response as ExpressResponse } from "express";
import type { ChromaClient } from "chromadb";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createServer,
  getChromaClient,
  healthDetailHandler,
  healthHandler,
  initChromaClient,
  resetChromaClient,
} from "../../src";
import { createChromaTools, handleChromaTool } from "../../src/chroma-tools.js";
import { CHROMA_SERVER_VERSION_ENV, MCP_SERVER_VERSION_ENV } from "../../src/version.js";
import type { EmbeddingProviderConfig } from "../../src/types.js";

/**
 * Version reporting surfaces wired to src/version.ts:
 *   - chroma_get_server_version tool payload
 *   - MCP initialize serverInfo.version
 *   - /health (must stay version-free — R6.b AC#b1)
 *   - /health/detail (mcp_version / chroma_version / chroma_version_server_reported)
 *
 * Only the external ChromaClient is mocked; version resolution runs the real code.
 */

const ENV_KEYS = [MCP_SERVER_VERSION_ENV, CHROMA_SERVER_VERSION_ENV] as const;

const TEST_SERVER_CFG: EmbeddingProviderConfig = {
  provider: "chromadb-default",
  model: "all-MiniLM-L6-v2",
  dimensions: 384,
};

const MCP_ENV_SOURCE = "env:MCP_SERVER_VERSION (baked from release tag at image build time)";
const MCP_UNSET_SOURCE = 'default:"dev" (MCP_SERVER_VERSION unset — non-release build)';
const CHROMA_DECLARED_SOURCE = "env:CHROMA_SERVER_VERSION (declared at deploy time)";

interface VersionToolPayload {
  text: string;
  mcp_version: { value: string; source: string };
  chroma_version: { value: string; source: string };
  chroma_version_server_reported: string | null;
  chroma_version_server_reported_trusted: boolean;
}

function makeRes(): Partial<ExpressResponse> {
  const res: Partial<ExpressResponse> = {};
  res.status = jest.fn(() => res as ExpressResponse) as unknown as ExpressResponse["status"];
  res.json = jest.fn(() => res as ExpressResponse) as unknown as ExpressResponse["json"];
  return res;
}

function jsonBody(res: Partial<ExpressResponse>): Record<string, unknown> {
  const mock = res.json as unknown as jest.Mock;
  expect(mock).toHaveBeenCalledTimes(1);
  return mock.mock.calls[0][0] as Record<string, unknown>;
}

describe("version reporting", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    jest.restoreAllMocks();
  });

  describe("chroma_get_server_version tool", () => {
    function mockClientReporting(raw: string): {
      client: ChromaClient;
      version: jest.Mock<() => Promise<string>>;
    } {
      const version = jest.fn<() => Promise<string>>(() => Promise.resolve(raw));
      return { client: { version } as unknown as ChromaClient, version };
    }

    async function callTool(client: ChromaClient): Promise<{
      text: string;
      payload: VersionToolPayload;
    }> {
      const result = await handleChromaTool(
        client,
        "chroma_get_server_version",
        {},
        TEST_SERVER_CFG,
      );
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      const text = result.content[0].text;
      return { text, payload: JSON.parse(text) as VersionToolPayload };
    }

    it("should return a JSON payload whose first key is the legacy text string", async () => {
      const { client, version } = mockClientReporting("1.0.0");

      const { payload } = await callTool(client);

      expect(version).toHaveBeenCalledTimes(1);
      expect(Object.keys(payload)).toEqual([
        "text",
        "mcp_version",
        "chroma_version",
        "chroma_version_server_reported",
        "chroma_version_server_reported_trusted",
      ]);
      expect(payload.text).toBe("Chroma server version: 1.0.0");
    });

    it("should keep the legacy 'Chroma server version: <raw>' string in the response text", async () => {
      const { client } = mockClientReporting("1.0.0");

      const { text } = await callTool(client);

      expect(text).toContain('"text": "Chroma server version: 1.0.0"');
    });

    it("should report dev + unknown when neither env is set and the server reports the sentinel", async () => {
      const { client } = mockClientReporting("1.0.0");

      const { payload } = await callTool(client);

      expect(payload.mcp_version).toEqual({ value: "dev", source: MCP_UNSET_SOURCE });
      expect(payload.chroma_version.value).toBe("unknown");
      expect(payload.chroma_version.source).toMatch(/^untrusted:/);
      expect(payload.chroma_version_server_reported).toBe("1.0.0");
      expect(payload.chroma_version_server_reported_trusted).toBe(false);
    });

    it("should report both declared versions when both env vars are set", async () => {
      process.env[MCP_SERVER_VERSION_ENV] = "3.0.16";
      process.env[CHROMA_SERVER_VERSION_ENV] = "1.5.9";
      const { client } = mockClientReporting("1.0.0");

      const { payload } = await callTool(client);

      expect(payload).toEqual({
        text: "Chroma server version: 1.0.0",
        mcp_version: { value: "3.0.16", source: MCP_ENV_SOURCE },
        chroma_version: { value: "1.5.9", source: CHROMA_DECLARED_SOURCE },
        chroma_version_server_reported: "1.0.0",
        chroma_version_server_reported_trusted: false,
      });
    });

    it("should trust a non-sentinel server-reported value when no Chroma version is declared", async () => {
      process.env[MCP_SERVER_VERSION_ENV] = "3.0.16";
      const { client } = mockClientReporting("1.6.0");

      const { payload } = await callTool(client);

      expect(payload).toEqual({
        text: "Chroma server version: 1.6.0",
        mcp_version: { value: "3.0.16", source: MCP_ENV_SOURCE },
        chroma_version: { value: "1.6.0", source: "server_reported:/api/v2/version" },
        chroma_version_server_reported: "1.6.0",
        chroma_version_server_reported_trusted: true,
      });
    });

    it("should prefer the declared Chroma version over a trusted server-reported value", async () => {
      process.env[CHROMA_SERVER_VERSION_ENV] = "1.5.9";
      const { client } = mockClientReporting("1.6.0");

      const { payload } = await callTool(client);

      expect(payload.chroma_version).toEqual({ value: "1.5.9", source: CHROMA_DECLARED_SOURCE });
      expect(payload.chroma_version_server_reported).toBe("1.6.0");
      expect(payload.chroma_version_server_reported_trusted).toBe(true);
    });

    it("should return an error text (not a JSON payload) when version() rejects", async () => {
      const version = jest.fn<() => Promise<string>>(() =>
        Promise.reject(new Error("version endpoint down")),
      );
      const client = { version } as unknown as ChromaClient;

      const result = await handleChromaTool(
        client,
        "chroma_get_server_version",
        {},
        TEST_SERVER_CFG,
      );

      expect(result.content[0].text).toMatch(/^Error: /);
      expect(result.content[0].text).toContain("version endpoint down");
    });

    it("should describe the provenance behaviour in the tool description", () => {
      const tool = createChromaTools({} as ChromaClient).find(
        (t) => t.name === "chroma_get_server_version",
      );

      expect(tool).toBeDefined();
      expect(tool?.description).toContain("provenance");
      expect(tool?.description).toContain("CHROMA_SERVER_VERSION");
    });
  });

  describe("MCP initialize serverInfo.version", () => {
    beforeEach(() => {
      initChromaClient();
    });

    afterEach(() => {
      resetChromaClient();
    });

    async function initializeAndGetServerInfo(): Promise<{ name: string; version: string }> {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = createServer();
      const client = new Client({ name: "version-reporting-test", version: "0.0.0" });
      try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        const info = client.getServerVersion();
        expect(info).toBeDefined();
        return { name: info?.name ?? "", version: info?.version ?? "" };
      } finally {
        await client.close();
        await server.close();
      }
    }

    it("should report MCP_SERVER_VERSION in the initialize response", async () => {
      process.env[MCP_SERVER_VERSION_ENV] = "3.0.16";

      await expect(initializeAndGetServerInfo()).resolves.toEqual({
        name: "chroma-remote-mcp",
        version: "3.0.16",
      });
    });

    it('should report "dev" in the initialize response when MCP_SERVER_VERSION is unset', async () => {
      await expect(initializeAndGetServerInfo()).resolves.toEqual({
        name: "chroma-remote-mcp",
        version: "dev",
      });
    });

    it("should no longer report the previously hardcoded 2.0.0", async () => {
      const info = await initializeAndGetServerInfo();

      expect(info.version).not.toBe("2.0.0");
    });
  });

  describe("/health (R6.b AC#b1: unauthenticated body is exactly {status})", () => {
    beforeEach(() => {
      process.env[MCP_SERVER_VERSION_ENV] = "3.0.16";
      process.env[CHROMA_SERVER_VERSION_ENV] = "1.5.9";
      initChromaClient();
    });

    afterEach(() => {
      resetChromaClient();
    });

    it("should not leak version keys on success even when both version envs are set", async () => {
      jest.spyOn(getChromaClient(), "heartbeat").mockResolvedValue(123);
      const versionSpy = jest.spyOn(getChromaClient(), "version").mockResolvedValue("1.0.0");
      const res = makeRes();

      await healthHandler({} as Request, res as ExpressResponse);

      const body = jsonBody(res);
      expect(Object.keys(body)).toEqual(["status"]);
      expect(body).toEqual({ status: "ok" });
      expect(res.status).not.toHaveBeenCalled();
      // /health must not even query the version endpoint.
      expect(versionSpy).not.toHaveBeenCalled();
    });

    it("should not leak version keys on 503 even when both version envs are set", async () => {
      jest.spyOn(getChromaClient(), "heartbeat").mockRejectedValue(new Error("down"));
      const res = makeRes();

      await healthHandler({} as Request, res as ExpressResponse);

      expect(res.status).toHaveBeenCalledWith(503);
      const body = jsonBody(res);
      expect(Object.keys(body)).toEqual(["status"]);
      expect(body).toEqual({ status: "error" });
    });
  });

  describe("/health/detail", () => {
    beforeEach(() => {
      initChromaClient();
    });

    afterEach(() => {
      resetChromaClient();
    });

    it("should include mcp_version, chroma_version and chroma_version_server_reported on success", async () => {
      process.env[MCP_SERVER_VERSION_ENV] = "3.0.16";
      process.env[CHROMA_SERVER_VERSION_ENV] = "1.5.9";
      jest.spyOn(getChromaClient(), "heartbeat").mockResolvedValue(123);
      jest.spyOn(getChromaClient(), "version").mockResolvedValue("1.0.0");
      const res = makeRes();

      await healthDetailHandler({} as Request, res as ExpressResponse);

      expect(res.status).not.toHaveBeenCalled();
      const body = jsonBody(res);
      expect(body).toEqual({
        status: "ok",
        service: "chroma-remote-mcp",
        // chromaConfig is captured at module load (before any test code runs).
        chroma: expect.stringMatching(/^http:\/\/[^:]+:\d+$/),
        chromadb: "connected",
        mcp_version: { value: "3.0.16", source: MCP_ENV_SOURCE },
        chroma_version: { value: "1.5.9", source: CHROMA_DECLARED_SOURCE },
        chroma_version_server_reported: "1.0.0",
      });
    });

    it("should report unknown chroma_version when undeclared and the server reports the sentinel", async () => {
      jest.spyOn(getChromaClient(), "heartbeat").mockResolvedValue(123);
      jest.spyOn(getChromaClient(), "version").mockResolvedValue("1.0.0");
      const res = makeRes();

      await healthDetailHandler({} as Request, res as ExpressResponse);

      const body = jsonBody(res);
      expect(body.mcp_version).toEqual({ value: "dev", source: MCP_UNSET_SOURCE });
      const chromaVersion = body.chroma_version as { value: string; source: string };
      expect(chromaVersion.value).toBe("unknown");
      expect(chromaVersion.source).toMatch(/^untrusted:/);
      expect(body.chroma_version_server_reported).toBe("1.0.0");
    });

    it("should stay 200 with chroma_version_server_reported=null when version() fails", async () => {
      jest.spyOn(getChromaClient(), "heartbeat").mockResolvedValue(123);
      const versionError = new Error("version endpoint down");
      jest.spyOn(getChromaClient(), "version").mockRejectedValue(versionError);
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const res = makeRes();

      await healthDetailHandler({} as Request, res as ExpressResponse);

      expect(res.status).not.toHaveBeenCalled();
      const body = jsonBody(res);
      expect(body.status).toBe("ok");
      expect(body.chromadb).toBe("connected");
      expect(body.chroma_version_server_reported).toBeNull();
      expect(body.chroma_version).toEqual({
        value: "unknown",
        source: "unavailable: Chroma server version endpoint unreachable",
      });
      expect(body.mcp_version).toEqual({ value: "dev", source: MCP_UNSET_SOURCE });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to query Chroma server version:",
        versionError,
      );
    });

    it("should keep the declared chroma_version when version() fails", async () => {
      process.env[CHROMA_SERVER_VERSION_ENV] = "1.5.9";
      jest.spyOn(getChromaClient(), "heartbeat").mockResolvedValue(123);
      jest.spyOn(getChromaClient(), "version").mockRejectedValue(new Error("down"));
      jest.spyOn(console, "error").mockImplementation(() => {});
      const res = makeRes();

      await healthDetailHandler({} as Request, res as ExpressResponse);

      const body = jsonBody(res);
      expect(body.chroma_version).toEqual({ value: "1.5.9", source: CHROMA_DECLARED_SOURCE });
      expect(body.chroma_version_server_reported).toBeNull();
    });

    it("should include mcp_version on the 503 heartbeat-failure path without querying version()", async () => {
      process.env[MCP_SERVER_VERSION_ENV] = "3.0.16";
      jest.spyOn(getChromaClient(), "heartbeat").mockRejectedValue(new Error("Connection failed"));
      const versionSpy = jest.spyOn(getChromaClient(), "version").mockResolvedValue("1.0.0");
      const res = makeRes();

      await healthDetailHandler({} as Request, res as ExpressResponse);

      expect(res.status).toHaveBeenCalledWith(503);
      const body = jsonBody(res);
      expect(body).toEqual({
        status: "error",
        service: "chroma-remote-mcp",
        chromadb: "disconnected",
        error: "Connection failed",
        mcp_version: { value: "3.0.16", source: MCP_ENV_SOURCE },
      });
      expect(versionSpy).not.toHaveBeenCalled();
    });
  });
});
