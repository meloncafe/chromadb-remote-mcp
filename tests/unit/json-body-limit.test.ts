/**
 * json-body-limit.test.ts
 *
 * R2: MCP_JSON_BODY_LIMIT 환경 변수로 express.json 본문 한도를 제어하는
 * src/json-body-limit.ts 의 실제 구현을 호출해 검증한다 (모의 없음).
 * 경계 시험은 실제 express 앱을 listen(0) 으로 띄워 Node http 로 요청한다.
 */

import { describe, it, expect, jest, beforeEach, afterEach, afterAll } from "@jest/globals";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { readFileSync } from "fs";
import { resolve } from "path";

type LimitModule = typeof import("../../src/json-body-limit.js");

const ENV_KEY = "MCP_JSON_BODY_LIMIT";
const DEFAULT_BYTES = 1048576;

let mod: LimitModule | undefined;
const savedEnv = process.env[ENV_KEY];

async function load(): Promise<LimitModule> {
  if (mod === undefined) {
    mod = await import("../../src/json-body-limit.js");
  }
  return mod;
}

function setEnv(value: string | undefined): void {
  if (value === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = value;
  }
}

/** Build a JSON body whose UTF-8 byte length is exactly `bytes`. */
function jsonBodyOfBytes(bytes: number): Buffer {
  const overhead = Buffer.byteLength(JSON.stringify({ a: "" }));
  if (bytes < overhead) {
    throw new Error("bytes too small");
  }
  const body = JSON.stringify({ a: "x".repeat(bytes - overhead) });
  const buf = Buffer.from(body, "utf8");
  if (buf.length !== bytes) {
    throw new Error(`body length mismatch ${buf.length} != ${bytes}`);
  }
  return buf;
}

async function startApp(limit: number): Promise<{ server: http.Server; port: number }> {
  const app = express();
  app.use(express.json({ limit }));
  app.post("/echo", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  const server = http.createServer(app);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as AddressInfo).port;
  return { server, port };
}

function post(port: number, body: Buffer): Promise<number> {
  return new Promise((resolveStatus, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/echo",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": body.length },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolveStatus(res.statusCode ?? 0));
      },
    );
    req.on("error", (err: NodeJS.ErrnoException) => {
      // Server may close early on 413 before the body is fully flushed.
      reject(err);
    });
    req.end(body);
  });
}

async function statusFor(limit: number, bytes: number): Promise<number> {
  const { server, port } = await startApp(limit);
  try {
    return await post(port, jsonBodyOfBytes(bytes));
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
}

describe("json-body-limit (MCP_JSON_BODY_LIMIT)", () => {
  let warnSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    setEnv(undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  afterAll(() => {
    setEnv(savedEnv);
  });

  // 4. import side effects (must run first: module is cached afterwards)
  describe("import side effects and call-time env read", () => {
    it("importing the module with an invalid MCP_JSON_BODY_LIMIT does not warn or log", async () => {
      setEnv("abc");
      const m = await load();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
      expect(m.DEFAULT_JSON_BODY_LIMIT_BYTES).toBe(DEFAULT_BYTES);
    });

    it("resolveJsonBodyLimit() reads process.env at call time", async () => {
      const { resolveJsonBodyLimit } = await load();
      setEnv("512kb");
      expect(resolveJsonBodyLimit()).toBe(524288);
      setEnv("2mb");
      expect(resolveJsonBodyLimit()).toBe(2097152);
      setEnv("100kb");
      expect(resolveJsonBodyLimit()).toBe(102400);
      setEnv(undefined);
      expect(resolveJsonBodyLimit()).toBe(DEFAULT_BYTES);
    });

    it("explicit argument takes precedence over process.env", async () => {
      const { resolveJsonBodyLimit } = await load();
      setEnv("2mb");
      expect(resolveJsonBodyLimit("512kb")).toBe(524288);
    });

    it("src/index.ts wires express.json limit to resolveJsonBodyLimit()", () => {
      const src = readFileSync(resolve(__dirname, "../../src/index.ts"), "utf8");
      expect(src).toContain("app.use(express.json({limit: resolveJsonBodyLimit()}));");
    });
  });

  // 1. default boundary (real express app, env unset)
  describe("default limit (env unset)", () => {
    it("resolves to 1048576 bytes with no warning", async () => {
      const { resolveJsonBodyLimit, DEFAULT_JSON_BODY_LIMIT_BYTES } = await load();
      expect(DEFAULT_JSON_BODY_LIMIT_BYTES).toBe(DEFAULT_BYTES);
      expect(resolveJsonBodyLimit()).toBe(DEFAULT_BYTES);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("accepts a 102401 byte body (old 100KB boundary is now allowed)", async () => {
      const { resolveJsonBodyLimit } = await load();
      expect(await statusFor(resolveJsonBodyLimit(), 102401)).toBe(200);
    });

    it("accepts exactly 1048576 bytes", async () => {
      const { resolveJsonBodyLimit } = await load();
      expect(await statusFor(resolveJsonBodyLimit(), 1048576)).toBe(200);
    });

    it("rejects 1048577 bytes with 413", async () => {
      const { resolveJsonBodyLimit } = await load();
      expect(await statusFor(resolveJsonBodyLimit(), 1048577)).toBe(413);
    });
  });

  // 2. env applied
  describe("MCP_JSON_BODY_LIMIT=512kb", () => {
    it("accepts 524288 bytes and rejects 524289 with 413", async () => {
      const { resolveJsonBodyLimit } = await load();
      setEnv("512kb");
      const limit = resolveJsonBodyLimit();
      expect(limit).toBe(524288);
      expect(await statusFor(limit, 524288)).toBe(200);
      expect(await statusFor(limit, 524289)).toBe(413);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("MCP_JSON_BODY_LIMIT=2mb", () => {
    it("is interpreted as 2097152 bytes", async () => {
      const { resolveJsonBodyLimit } = await load();
      setEnv("2mb");
      expect(resolveJsonBodyLimit()).toBe(2097152);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  // 3. invalid values
  describe("invalid values fall back to the default", () => {
    it.each([
      ["empty string", ""],
      ["abc", "abc"],
      ["0", "0"],
      ["-5", "-5"],
      ["10abc", "10abc"],
      ["Infinity", "Infinity"],
      ["1e400", "1e400"],
    ])("%s -> 1048576 with exactly one console.warn and no console.log", async (_name, raw) => {
      const { resolveJsonBodyLimit } = await load();
      setEnv(raw);
      expect(resolveJsonBodyLimit()).toBe(DEFAULT_BYTES);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
      expect(String(warnSpy.mock.calls[0][0])).toContain("MCP_JSON_BODY_LIMIT");
    });

    it("unset env produces zero warnings", async () => {
      const { resolveJsonBodyLimit } = await load();
      setEnv(undefined);
      expect(resolveJsonBodyLimit()).toBe(DEFAULT_BYTES);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("parseJsonBodyLimit", () => {
    it("parses units case-insensitively and rejects garbage", async () => {
      const { parseJsonBodyLimit } = await load();
      expect(parseJsonBodyLimit("1KB")).toBe(1024);
      expect(parseJsonBodyLimit(" 2 mb ")).toBe(2097152);
      expect(parseJsonBodyLimit("1gb")).toBe(1073741824);
      expect(parseJsonBodyLimit("100")).toBe(100);
      expect(parseJsonBodyLimit("1.5kb")).toBe(1536);
      expect(parseJsonBodyLimit("0")).toBeNull();
      expect(parseJsonBodyLimit("-5")).toBeNull();
      expect(parseJsonBodyLimit("10abc")).toBeNull();
      expect(parseJsonBodyLimit("1e400")).toBeNull();
      expect(parseJsonBodyLimit("")).toBeNull();
    });
  });
});
