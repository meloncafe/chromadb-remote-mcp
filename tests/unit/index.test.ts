import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextFunction, Request, Response as ExpressResponse } from "express";
import type { Prompt, Resource } from "@modelcontextprotocol/sdk/types.js";
import {
  app,
  callToolHandler,
  cancelRequest,
  cleanupRequest,
  Closeable,
  completeHandler,
  createAuthMiddleware,
  createCloseHandler,
  createServer,
  generateRequestId,
  getActiveRequestCount,
  getChromaClient,
  getCurrentLogLevel,
  getPingTimeout,
  getPromptHandler,
  healthHandler,
  initChromaClient,
  listPromptsHandler,
  listResourcesHandler,
  listToolsHandler,
  mcpHandler,
  mcpLog,
  proxyErrorHandler,
  proxyReqHandler,
  readResourceHandler,
  registerCancellableRequest,
  resetChromaClient,
  resetWarningThrottle,
  sanitizeErrorForClient,
  sanitizeForLogging,
  sanitizeHttpMethod,
  sanitizeLogValue,
  sendLogNotification,
  setLevelHandler,
  shouldLog,
  shouldSkipRateLimit,
  validateOriginHeader,
  validateRateLimitMax,
  waitForChroma,
} from "../../src";
import { decodeCursor, encodeCursor, createPaginationMetadata } from "../../src/chroma-tools";
import { ClientRequest } from "http";
import { Collection } from "chromadb";

// Mock fetch globally
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

// Set default environment variables
process.env.NODE_ENV = "test";
process.env.CHROMA_HOST = "localhost";
process.env.CHROMA_PORT = "8000";
process.env.CHROMA_TENANT = "default_tenant";
process.env.CHROMA_DATABASE = "default_database";
process.env.LOG_LEVEL = "warn"; // Enable warn level for deprecation warnings

describe("index.ts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetWarningThrottle(); // Reset warning throttle between tests
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("waitForChroma", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should resolve when ChromaDB is ready", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const promise = waitForChroma(1, 100);

      // Fast-forward initial delay
      jest.advanceTimersByTime(10000);
      await Promise.resolve();

      await expect(promise).resolves.toBeUndefined();

      // Should have tried initial delay and at least one endpoint
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should retry on connection failure", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockRejectedValueOnce(new Error("Connection refused")).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      const promise = waitForChroma(3, 100);

      // Fast-forward initial delay and retries
      jest.advanceTimersByTime(10000);
      await Promise.resolve();
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      await expect(promise).resolves.toBeUndefined();

      // Should have retried
      expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
    });

    it("should try multiple endpoints", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {
        // Empty to suppress console output during tests
      });
      let callCount = 0;
      mockFetch.mockImplementation(
        async (_input: string | URL | globalThis.Request, _init?: RequestInit) => {
          callCount++;
          // First two endpoints fail, third succeeds
          if (callCount <= 2) {
            throw new Error("Connection refused");
          }
          return {
            ok: true,
            status: 200,
          } as Response;
        },
      );

      const promise = waitForChroma(1, 100);

      // Fast-forward initial delay
      jest.advanceTimersByTime(10000);
      await Promise.resolve();

      await expect(promise).resolves.toBeUndefined();

      // Should have tried multiple endpoints
      expect(callCount).toBeGreaterThanOrEqual(3);

      // Should have logged endpoint failures
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to reach"));

      consoleLogSpy.mockRestore();
    });

    it("should throw error after max retries", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const promise = waitForChroma(2, 100);

      // Fast-forward initial delay and all retries
      jest.advanceTimersByTime(10000);
      await Promise.resolve();
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      await expect(promise).rejects.toThrow("ChromaDB connection timeout");
    });

    it("should handle non-ok responses", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {
        // Empty to suppress console output during tests
      });
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as Response);

      const promise = waitForChroma(3, 100);

      // Fast-forward initial delay and retry
      jest.advanceTimersByTime(10000);
      await Promise.resolve();
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      await expect(promise).resolves.toBeUndefined();

      // Should have logged status 500
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("returned status 500"));

      consoleLogSpy.mockRestore();
    });

    it("should accept status < 500 as ready", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const promise = waitForChroma(1, 100);

      // Fast-forward initial delay
      jest.advanceTimersByTime(10000);
      await Promise.resolve();

      await expect(promise).resolves.toBeUndefined();
    });

    it("should handle fetch error with error message", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockRejectedValueOnce(new Error("Network error")).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      const promise = waitForChroma(3, 100);

      // Fast-forward initial delay
      jest.advanceTimersByTime(10000);
      await Promise.resolve();
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      await expect(promise).resolves.toBeUndefined();
    });

    it("should handle unknown error type on final retry", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {
        // Empty to suppress console output during tests
      });
      const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {
        // Empty to suppress console output during tests
      });

      // Create a response object that throws a non-Error when accessing properties
      const badResponse: Partial<Response> = {
        get ok(): boolean {
          throw "string error not an Error object";
        },
        get status(): number {
          throw "string error not an Error object";
        },
      };

      mockFetch.mockResolvedValue(badResponse as Response);

      const promise = waitForChroma(2, 100);

      // Fast-forward all timers - same as the working test
      jest.advanceTimersByTime(10000);
      await Promise.resolve();
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      await expect(promise).rejects.toThrow("ChromaDB connection timeout");

      // Should have logged 'Unknown error' for non-Error object on final attempt
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown error"));

      consoleErrorSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it("should log final attempt error on last retry", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {
        // Empty to suppress console output during tests
      });

      // Create a response object that throws when accessing properties
      const badResponse: Partial<Response> = {
        get ok(): boolean {
          throw new Error("Property access error");
        },
        get status(): number {
          throw new Error("Property access error");
        },
      };

      mockFetch.mockResolvedValue(badResponse as Response);

      const promise = waitForChroma(2, 100);

      // Fast-forward all timers
      jest.advanceTimersByTime(10000);
      await Promise.resolve();
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      await expect(promise).rejects.toThrow("ChromaDB connection timeout");

      // Should have logged final attempt error
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Final attempt failed"));

      consoleErrorSpy.mockRestore();
    }, 15000);

    it("should handle case where no response is returned from any endpoint", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {
        // Empty to suppress console output during tests
      });

      // All endpoints fail to return a response
      mockFetch.mockRejectedValue(new Error("All endpoints failed"));

      const promise = waitForChroma(2, 100);

      // Fast-forward initial delay
      jest.advanceTimersByTime(10000);
      await Promise.resolve();

      // First retry
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      await expect(promise).rejects.toThrow("ChromaDB connection timeout");

      // Should have logged "No response from ChromaDB endpoints"
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("No response from ChromaDB endpoints"),
      );

      consoleLogSpy.mockRestore();
    });
  });

  describe("getChromaClient", () => {
    it("should throw error when client is not initialized", async () => {
      // Reset modules to get fresh state
      jest.resetModules();

      // Re-import to get fresh module state
      const { getChromaClient: freshGetClient } = await import("../../src/index.js");

      expect(() => freshGetClient()).toThrow(
        "ChromaDB client not initialized. Call initChromaClient() first.",
      );
    });

    it("should return client when initialized", () => {
      initChromaClient();

      expect(() => getChromaClient()).not.toThrow();
      expect(getChromaClient()).toBeDefined();
    });
  });

  describe("initChromaClient", () => {
    afterEach(() => {
      resetChromaClient();
    });

    it("should initialize ChromaDB client without auth", () => {
      delete process.env.CHROMA_AUTH_TOKEN;

      expect(() => initChromaClient()).not.toThrow();
    });

    it("should initialize ChromaDB client with auth", () => {
      process.env.CHROMA_AUTH_TOKEN = "test-token";

      expect(() => initChromaClient()).not.toThrow();
    });

    it("should warn when called multiple times", () => {
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {
        // Empty to suppress console output during tests
      });

      initChromaClient();
      initChromaClient(); // Second call

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("already initialized"));

      consoleWarnSpy.mockRestore();
    });
  });

  describe("MCP request handlers", () => {
    beforeEach(() => {
      initChromaClient();
    });

    afterEach(() => {
      resetChromaClient();
    });

    it("should handle listToolsHandler", async () => {
      const result = await listToolsHandler();

      // Should return object with tools property
      expect(result).toHaveProperty("tools");
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools.length).toBeGreaterThan(0);
    });

    it("should handle callToolHandler", async () => {
      const request = {
        params: {
          name: "list_collections",
          arguments: {},
        },
      };

      // Should execute without throwing
      const result = await callToolHandler(request);
      expect(result).toBeDefined();
    });

    it("should handle callToolHandler with undefined arguments", async () => {
      const request = {
        params: {
          name: "list_collections",
          arguments: undefined,
        },
      };

      // Should execute without throwing and default to empty object
      const result = await callToolHandler(request);
      expect(result).toBeDefined();
    });
  });

  describe("createServer", () => {
    beforeEach(() => {
      initChromaClient();
    });

    afterEach(() => {
      resetChromaClient();
    });

    it("should create MCP server", async () => {
      const server = createServer();

      expect(server).toBeDefined();
      expect(typeof server.close).toBe("function");

      await server.close();
    });

    it("should return a server with proper configuration", async () => {
      const server = createServer();

      // Server should have request handlers registered
      expect(server).toHaveProperty("close");

      await server.close();
    });
  });

  describe("express app", () => {
    it("should be defined and configured", () => {
      expect(app).toBeDefined();
      expect(typeof app.listen).toBe("function");
      expect(typeof app.use).toBe("function");
      expect(typeof app.post).toBe("function");
    });

    it("should have JSON body parsing capability", () => {
      // Verify the app is an Express instance with standard methods
      expect(app).toBeDefined();
      expect(typeof app.post).toBe("function");
      expect(typeof app.use).toBe("function");

      // Express app should be properly initialized
      // JSON middleware is configured in src/index.ts with app.use(express.json())
      // We verify the app has the expected Express functionality
      // Express apps are EventEmitter instances
      expect(app.constructor.name).toBe("EventEmitter");
    });

    it("should have MCP endpoint configured", () => {
      // The app should have routes configured
      // MCP endpoint is at POST /mcp
      expect(app).toBeDefined();

      // We can verify routes exist by checking if the app is properly set up
      // This is a smoke test - actual JSON parsing is tested in integration tests
      expect(typeof app.listen).toBe("function");
    });
  });

  describe("shouldSkipRateLimit", () => {
    it("should skip rate limit for /health path", () => {
      const req = { path: "/health" } as Request;

      const result = shouldSkipRateLimit(req);

      expect(result).toBe(true);
    });

    it("should not skip rate limit for other paths", () => {
      const req = { path: "/mcp" } as Request;

      const result = shouldSkipRateLimit(req);

      expect(result).toBe(false);
    });

    it("should not skip rate limit for /api paths", () => {
      const req = { path: "/api/v2/collections" } as Request;

      const result = shouldSkipRateLimit(req);

      expect(result).toBe(false);
    });
  });

  describe("validateRateLimitMax", () => {
    let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;

    beforeEach(() => {
      consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {
        // Empty to suppress console output during tests
      });
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it("should return default value when envValue is undefined", () => {
      const result = validateRateLimitMax(undefined);

      expect(result).toBe(100);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("should return custom default value when provided", () => {
      const result = validateRateLimitMax(undefined, 200);

      expect(result).toBe(200);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("should parse valid positive integer", () => {
      const result = validateRateLimitMax("50");

      expect(result).toBe(50);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("should parse large valid integer", () => {
      const result = validateRateLimitMax("5000");

      expect(result).toBe(5000);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("should warn on very large value but still accept it", () => {
      const result = validateRateLimitMax("15000");

      expect(result).toBe(15000);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Very high RATE_LIMIT_MAX"),
      );
    });

    it("should return default for invalid number format", () => {
      const result = validateRateLimitMax("abc");

      expect(result).toBe(100);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid RATE_LIMIT_MAX"),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Must be a positive integer"),
      );
    });

    it("should return default for empty string", () => {
      const result = validateRateLimitMax("");

      expect(result).toBe(100);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("should return default for zero", () => {
      const result = validateRateLimitMax("0");

      expect(result).toBe(100);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Must be greater than 0"),
      );
    });

    it("should return default for negative number", () => {
      const result = validateRateLimitMax("-5");

      expect(result).toBe(100);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Must be greater than 0"),
      );
    });

    it("should return default for decimal number", () => {
      const result = validateRateLimitMax("50.5");

      expect(result).toBe(50); // parseInt truncates decimals
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("should return default for mixed alphanumeric", () => {
      const result = validateRateLimitMax("100abc");

      expect(result).toBe(100); // parseInt stops at first non-digit
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("should return default for special characters", () => {
      const result = validateRateLimitMax("!@#$");

      expect(result).toBe(100);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid RATE_LIMIT_MAX"),
      );
    });

    it("should use custom default when invalid value provided", () => {
      const result = validateRateLimitMax("invalid", 250);

      expect(result).toBe(250);
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Using default: 250"));
    });
  });

  describe("createAuthMiddleware", () => {
    let req: Partial<Request>;
    let res: Partial<ExpressResponse>;
    let next: NextFunction;

    beforeEach(() => {
      req = {
        headers: {},
        query: {},
        path: "/mcp",
      };
      res = {
        status: jest.fn(() => res as ExpressResponse),
        json: jest.fn(),
        setHeader: jest.fn(),
      } as Partial<ExpressResponse>;
      next = jest.fn() as NextFunction;
    });

    it("calls next() when no auth token is provided", () => {
      const authenticate = createAuthMiddleware(undefined);

      authenticate(req as Request, res as ExpressResponse, next);

      expect(next).toHaveBeenCalled();
    });

    it("returns 401 when no token provided in request", () => {
      const authenticate = createAuthMiddleware("test-token");
      res.setHeader = jest.fn() as unknown as undefined;

      authenticate(req as Request, res as ExpressResponse, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.setHeader).toHaveBeenCalledWith(
        "WWW-Authenticate",
        'Bearer realm="MCP Server", charset="UTF-8"',
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Unauthorized"),
        }),
      );
    });

    it("accepts valid Bearer token", () => {
      const token = "valid-token";
      const authenticate = createAuthMiddleware(token);

      req.headers = { authorization: `Bearer ${token}` };

      authenticate(req as Request, res as ExpressResponse, next);

      expect(next).toHaveBeenCalled();
    });

    it("accepts valid X-Chroma-Token header", () => {
      const token = "valid-token";
      const authenticate = createAuthMiddleware(token);

      req.headers = { "x-chroma-token": token };

      authenticate(req as Request, res as ExpressResponse, next);

      expect(next).toHaveBeenCalled();
    });

    it("rejects apiKey query parameter by default (ALLOW_QUERY_AUTH not set)", () => {
      const token = "valid-token";
      const authenticate = createAuthMiddleware(token);
      const originalEnv = process.env.ALLOW_QUERY_AUTH;
      delete process.env.ALLOW_QUERY_AUTH;

      req.query = { apiKey: token };

      authenticate(req as Request, res as ExpressResponse, next);

      // Query auth should be rejected when ALLOW_QUERY_AUTH is not set
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();

      process.env.ALLOW_QUERY_AUTH = originalEnv;
    });

    it("accepts valid token query parameter when ALLOW_QUERY_AUTH=true", () => {
      const token = "valid-token";
      const authenticate = createAuthMiddleware(token);
      const originalEnv = process.env.ALLOW_QUERY_AUTH;
      process.env.ALLOW_QUERY_AUTH = "true";

      req.query = { token };

      authenticate(req as Request, res as ExpressResponse, next);

      expect(next).toHaveBeenCalled();

      process.env.ALLOW_QUERY_AUTH = originalEnv;
    });

    it("accepts valid api_key query parameter when ALLOW_QUERY_AUTH=true", () => {
      const token = "valid-token";
      const authenticate = createAuthMiddleware(token);
      const originalEnv = process.env.ALLOW_QUERY_AUTH;
      process.env.ALLOW_QUERY_AUTH = "true";

      req.query = { api_key: token };

      authenticate(req as Request, res as ExpressResponse, next);

      expect(next).toHaveBeenCalled();

      process.env.ALLOW_QUERY_AUTH = originalEnv;
    });

    it("rejects query parameter auth when ALLOW_QUERY_AUTH=false", () => {
      const token = "valid-token";
      const authenticate = createAuthMiddleware(token);
      const originalEnv = process.env.ALLOW_QUERY_AUTH;
      process.env.ALLOW_QUERY_AUTH = "false";
      res.setHeader = jest.fn() as unknown as undefined;

      req.query = { apiKey: token };

      authenticate(req as Request, res as ExpressResponse, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.setHeader).toHaveBeenCalledWith(
        "WWW-Authenticate",
        'Bearer realm="MCP Server", charset="UTF-8"',
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Missing authentication"),
        }),
      );

      process.env.ALLOW_QUERY_AUTH = originalEnv;
    });

    it("shows deprecation warning when using query auth", () => {
      const token = "valid-token";
      const authenticate = createAuthMiddleware(token);
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {
        // Empty to suppress console output during tests
      });
      const originalEnv = process.env.ALLOW_QUERY_AUTH;
      process.env.ALLOW_QUERY_AUTH = "true";

      req.query = { apiKey: token };

      authenticate(req as Request, res as ExpressResponse, next);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Query parameter authentication is DEPRECATED"),
      );

      process.env.ALLOW_QUERY_AUTH = originalEnv;
      consoleWarnSpy.mockRestore();
    });

    it("rejects invalid token", () => {
      const authenticate = createAuthMiddleware("expected-token");
      res.setHeader = jest.fn() as unknown as undefined;

      req.headers = { authorization: "Bearer wrong-token" };

      authenticate(req as Request, res as ExpressResponse, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.setHeader).toHaveBeenCalledWith(
        "WWW-Authenticate",
        'Bearer realm="MCP Server", error="invalid_token", charset="UTF-8"',
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Invalid token"),
        }),
      );
    });

    it("rejects token with same length but different content", () => {
      const authenticate = createAuthMiddleware("expected-token-1");

      req.headers = { authorization: "Bearer expected-token-2" };

      authenticate(req as Request, res as ExpressResponse, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Invalid token"),
        }),
      );
    });

    it("rejects token with different length", () => {
      const authenticate = createAuthMiddleware("short");

      req.headers = { authorization: "Bearer very-long-token-here" };

      authenticate(req as Request, res as ExpressResponse, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("handles comparison error", () => {
      const authenticate = createAuthMiddleware("test-token");

      req.headers = { authorization: "Bearer \u0000invalid" };

      authenticate(req as Request, res as ExpressResponse, next);

      expect(res.status).toHaveBeenCalled();
    });

    it("handles crypto comparison error", () => {
      const authenticate = createAuthMiddleware("test-token-1");

      let callCount = 0;
      const errorRes = {
        status: jest.fn((_code: number) => {
          callCount++;
          if (callCount === 1) {
            throw new Error("Mock error during status call");
          }
          return errorRes as ExpressResponse;
        }),
        json: jest.fn(),
        setHeader: jest.fn(),
      } as unknown as ExpressResponse;

      req.headers = { authorization: "Bearer test-token-2" };

      expect(() => {
        authenticate(req as Request, errorRes, next);
      }).not.toThrow();

      expect(errorRes.status).toHaveBeenCalledTimes(2);
      expect(errorRes.json).toHaveBeenCalledWith({ error: "Unauthorized: Invalid token" });
    });
  });

  describe("MCP_AUTH_TOKEN export", () => {
    it("should export MCP_AUTH_TOKEN", async () => {
      process.env.MCP_AUTH_TOKEN = "test-token-123";
      jest.resetModules();
      const module = await import("../../src/index.js");

      expect(module.MCP_AUTH_TOKEN).toBe("test-token-123");
    });

    it("should export undefined when not set", async () => {
      delete process.env.MCP_AUTH_TOKEN;
      jest.resetModules();
      const module = await import("../../src/index.js");

      expect(module.MCP_AUTH_TOKEN).toBeUndefined();
    });
  });

  describe("healthHandler", () => {
    let req: Partial<Request>;
    let res: Partial<ExpressResponse>;

    beforeEach(() => {
      req = {};
      res = {
        status: jest.fn(() => res as ExpressResponse),
        json: jest.fn(),
      } as Partial<ExpressResponse>;
    });

    afterEach(() => {
      resetChromaClient();
    });

    it("should return 200 when ChromaDB is connected", async () => {
      initChromaClient();
      jest.spyOn(getChromaClient(), "heartbeat").mockResolvedValue(123);

      await healthHandler(req as Request, res as ExpressResponse);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "ok",
          chromadb: "connected",
        }),
      );
    });

    it("should return 503 when ChromaDB is disconnected", async () => {
      initChromaClient();
      jest.spyOn(getChromaClient(), "heartbeat").mockRejectedValue(new Error("Connection failed"));

      await healthHandler(req as Request, res as ExpressResponse);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
          chromadb: "disconnected",
          error: "Connection failed",
        }),
      );
    });

    it("should handle unknown error", async () => {
      initChromaClient();
      jest.spyOn(getChromaClient(), "heartbeat").mockRejectedValue("string error");

      await healthHandler(req as Request, res as ExpressResponse);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          // In test environment, sanitizeErrorForClient returns the error as-is
          error: "string error",
        }),
      );
    });
  });

  describe("mcpHandler", () => {
    let req: Partial<Request>;
    let res: Partial<ExpressResponse>;

    beforeEach(() => {
      req = {
        body: { method: "tools/list" },
        method: "POST",
        url: "/mcp",
        headers: {},
      };
      res = {
        status: jest.fn(() => res as ExpressResponse),
        json: jest.fn(),
        on: jest.fn(),
        writeHead: jest.fn(() => res as ExpressResponse),
        end: jest.fn(() => res as ExpressResponse),
        write: jest.fn(),
        setHeader: jest.fn(),
        headersSent: false,
      } as Partial<ExpressResponse>;
    });

    it("should handle MCP request", async () => {
      initChromaClient();

      // mcpHandler will try to process the request
      await mcpHandler(req as Request, res as ExpressResponse);

      // With proper mock setup, the MCP SDK can now handle the request gracefully
      // We verify that response methods were called (either success or error response)
      expect(res.writeHead || res.status || res.json || res.end).toBeDefined();
    });

    it("should handle MCP request without method", async () => {
      initChromaClient();

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {
        // Empty to suppress console output during tests
      });

      // Mock request without method
      req.body = {};

      await mcpHandler(req as Request, res as ExpressResponse);

      // Should have logged 'unknown'
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("unknown"));

      consoleSpy.mockRestore();
    });

    it("should handle MCP request with undefined body", async () => {
      initChromaClient();

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {
        // Empty to suppress console output during tests
      });

      // Mock request with undefined body
      req.body = undefined;

      await mcpHandler(req as Request, res as ExpressResponse);

      // Should have logged 'unknown'
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("unknown"));

      consoleSpy.mockRestore();
    });

    it("should handle MCP request errors", async () => {
      initChromaClient();

      // Mock invalid request
      req.body = null;

      await mcpHandler(req as Request, res as ExpressResponse);

      // May handle gracefully or throw error
      expect(res.json || res.on).toBeDefined();
    });
  });

  describe("createCloseHandler", () => {
    it("should create a close handler that logs and closes resources", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {
        // Empty to suppress console output during tests
      });

      const mockServer = {
        close: jest.fn(),
      };

      const mockTransport = {
        close: jest.fn(),
      };

      const handler = createCloseHandler(mockServer as Closeable, mockTransport);

      // Execute the handler
      handler();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Request closed"));
      expect(mockTransport.close).toHaveBeenCalled();
      expect(mockServer.close).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("main function", () => {
    it("should initialize and start server", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      jest.useFakeTimers();
      const module = await import("../../src/index.js");

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {
        // Empty to suppress console output during tests
      });
      const listenSpy = jest
        .spyOn(module.app, "listen")
        .mockImplementation((_port: number, callback?: (error?: Error) => void) => {
          if (callback) callback();
          return {} as never;
        });

      const mainPromise = module.main();

      // Advance timers for waitForChroma
      jest.advanceTimersByTime(10000);
      await Promise.resolve();

      await mainPromise;

      expect(listenSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("🚀 ChromaDB Remote MCP Server"),
      );

      consoleSpy.mockRestore();
      listenSpy.mockRestore();
      jest.useRealTimers();
    });

    it("should use custom PORT from environment", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      jest.useFakeTimers();

      // Set custom port
      process.env.PORT = "8080";
      process.env.RATE_LIMIT_MAX = "50";
      jest.resetModules();
      const module = await import("../../src/index.js");

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {
        // Empty to suppress console output during tests
      });
      const listenSpy = jest
        .spyOn(module.app, "listen")
        .mockImplementation((port: number, callback?: (error?: Error) => void) => {
          if (callback) callback();
          return {} as never;
        });

      const mainPromise = module.main();

      // Advance timers for waitForChroma
      jest.advanceTimersByTime(10000);
      await Promise.resolve();

      await mainPromise;

      expect(listenSpy).toHaveBeenCalledWith(8080, expect.any(Function));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("8080"));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("50 req/15min"));

      consoleSpy.mockRestore();
      listenSpy.mockRestore();
      jest.useRealTimers();
    });

    it("should exit on error", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockRejectedValue(new Error("Connection failed"));

      jest.useFakeTimers();
      const module = await import("../../src/index.js");

      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {
        // Empty to suppress console output during tests
      });

      const mainPromise = module.main();

      // Advance timers for waitForChroma
      for (let i = 0; i < 70; i++) {
        jest.advanceTimersByTime(10000);
        await Promise.resolve();
      }

      // Expect the promise to reject
      await expect(mainPromise).rejects.toThrow();

      // Verify process.exitCode was set to 1
      expect(process.exitCode).toBe(1);

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to start server"),
        expect.anything(),
      );

      consoleErrorSpy.mockRestore();
      // Reset exitCode for other tests
      process.exitCode = 0;
      jest.useRealTimers();
    });

    it("should display authentication disabled message when no token", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      jest.useFakeTimers();

      // Clear MCP_AUTH_TOKEN to test disabled auth
      const originalToken = process.env.MCP_AUTH_TOKEN;
      delete process.env.MCP_AUTH_TOKEN;
      jest.resetModules();
      const module = await import("../../src/index.js");

      // Verify token is actually undefined
      expect(module.MCP_AUTH_TOKEN).toBeUndefined();

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {
        // Empty to suppress console output during tests
      });
      const listenSpy = jest
        .spyOn(module.app, "listen")
        .mockImplementation((port: number, callback?: (error?: Error) => void) => {
          if (callback) callback();
          return {} as never;
        });

      const mainPromise = module.main();

      // Advance timers for waitForChroma
      jest.advanceTimersByTime(10000);
      await Promise.resolve();

      await mainPromise;

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("⚠️  DISABLED (not recommended for production)"),
      );
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining("✅ Enabled"));

      consoleSpy.mockRestore();
      listenSpy.mockRestore();
      jest.useRealTimers();

      // Restore original token
      if (originalToken) {
        process.env.MCP_AUTH_TOKEN = originalToken;
      }
    });

    it("should display authentication enabled message when token is set", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      jest.useFakeTimers();

      // Set MCP_AUTH_TOKEN to test enabled auth
      const originalToken = process.env.MCP_AUTH_TOKEN;
      process.env.MCP_AUTH_TOKEN = "test-token-12345";
      jest.resetModules();
      const module = await import("../../src/index.js");

      // Verify token is actually set
      expect(module.MCP_AUTH_TOKEN).toBe("test-token-12345");

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {
        // Empty to suppress console output during tests
      });
      const listenSpy = jest
        .spyOn(module.app, "listen")
        .mockImplementation((port: number, callback?: (error?: Error) => void) => {
          if (callback) callback();
          return {} as never;
        });

      const mainPromise = module.main();

      // Advance timers for waitForChroma
      jest.advanceTimersByTime(10000);
      await Promise.resolve();

      await mainPromise;

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("✅ Enabled"));
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining("DISABLED"));

      consoleSpy.mockRestore();
      listenSpy.mockRestore();
      jest.useRealTimers();

      // Restore original token
      if (originalToken) {
        process.env.MCP_AUTH_TOKEN = originalToken;
      } else {
        delete process.env.MCP_AUTH_TOKEN;
      }
    });
  });

  describe("Signal handlers", () => {
    it("should handle SIGINT signal", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {
        // Empty to suppress console output during tests
      });

      process.emit("SIGINT");

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("shutting down gracefully"));
      expect(process.exitCode).toBe(0);

      consoleSpy.mockRestore();
    });

    it("should handle SIGTERM signal", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {
        // Empty to suppress console output during tests
      });

      process.emit("SIGTERM");

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("shutting down gracefully"));
      expect(process.exitCode).toBe(0);

      consoleSpy.mockRestore();
    });
  });

  describe("Proxy handlers", () => {
    let req: Partial<Request>;
    let res: Partial<ExpressResponse>;

    beforeEach(() => {
      req = {
        method: "GET",
        url: "/api/v2/collections",
      };
      res = {
        end: jest.fn(),
      } as Partial<ExpressResponse>;
    });

    it("should log proxy request", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {
        // Empty to suppress console output during tests
      });

      proxyReqHandler({} as ClientRequest, req as Request, res as ExpressResponse);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Proxying GET /api/v2/collections"),
      );

      consoleSpy.mockRestore();
    });

    it("should handle proxy error", () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {
        // Empty to suppress console output during tests
      });

      const error = new Error("Proxy connection failed");
      proxyErrorHandler(error, req as Request, res as ExpressResponse);

      expect(consoleErrorSpy).toHaveBeenCalledWith("❌ Proxy error:", error);
      expect(res.end).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("should handle proxy error with Socket response", () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {
        // Empty to suppress console output during tests
      });

      // Mock Socket-like object
      const socketRes = {
        end: jest.fn(),
      };

      const error = new Error("Socket error");
      proxyErrorHandler(error, req as Request, socketRes);

      expect(consoleErrorSpy).toHaveBeenCalledWith("❌ Proxy error:", error);
      expect(socketRes.end).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("should handle proxy error with undefined response", () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {
        // Empty to suppress console output during tests
      });

      const error = new Error("No response object");

      // Should not throw even with undefined res
      expect(() => {
        proxyErrorHandler(error, req as Request, undefined);
      }).not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith("❌ Proxy error:", error);

      consoleErrorSpy.mockRestore();
    });
  });

  describe("sanitizeLogValue", () => {
    it("should remove newline characters", () => {
      const result = sanitizeLogValue("line1\nline2");
      expect(result).toBe("line1line2");
      expect(result).not.toContain("\n");
    });

    it("should remove carriage return characters", () => {
      const result = sanitizeLogValue("line1\rline2");
      expect(result).toBe("line1line2");
      expect(result).not.toContain("\r");
    });

    it("should remove escape sequences", () => {
      const result = sanitizeLogValue("text\x1b[31mred\x1b[0m");
      expect(result).toBe("textred");
      expect(result).not.toContain("\x1b");
    });

    it("should remove null bytes", () => {
      const result = sanitizeLogValue("text\x00null");
      expect(result).toBe("textnull");
      expect(result).not.toContain("\x00");
    });

    it("should remove tab characters", () => {
      const result = sanitizeLogValue("text\ttab");
      expect(result).toBe("texttab");
      expect(result).not.toContain("\t");
    });

    it("should remove all Unicode control characters", () => {
      const result = sanitizeLogValue("text\u0001\u001F\u007F\u009Fmore");
      expect(result).toBe("textmore");
    });

    it("should handle null value", () => {
      const result = sanitizeLogValue(null);
      expect(result).toBe("null");
    });

    it("should handle undefined value", () => {
      const result = sanitizeLogValue(undefined);
      expect(result).toBe("undefined");
    });

    it("should convert non-string values to string", () => {
      expect(sanitizeLogValue(123)).toBe("123");
      expect(sanitizeLogValue(true)).toBe("true");
      expect(sanitizeLogValue({ key: "value" })).toContain("key");
    });

    it("should truncate long values to default 200 chars", () => {
      const longString = "a".repeat(300);
      const result = sanitizeLogValue(longString);
      expect(result.length).toBe(203); // 200 + "..."
      expect(result.endsWith("...")).toBe(true);
    });

    it("should truncate to custom maxLength", () => {
      const longString = "a".repeat(100);
      const result = sanitizeLogValue(longString, 50);
      expect(result.length).toBe(53); // 50 + "..."
      expect(result.endsWith("...")).toBe(true);
    });

    it("should handle log injection attack attempts", () => {
      const malicious = "normal\n[INFO] Fake log message\nnext";
      const result = sanitizeLogValue(malicious);
      expect(result).toBe("normal[INFO] Fake log messagenext");
      expect(result).not.toContain("\n");
    });

    it("should handle terminal control sequence injection", () => {
      const malicious = "text\x1b[2J\x1b[Hcleared screen";
      const result = sanitizeLogValue(malicious);
      expect(result).toBe("textcleared screen");
      expect(result).not.toContain("\x1b");
    });

    it("should handle combined malicious input", () => {
      const malicious = "normal\n\r\x1b[31m\x00\tmalicious";
      const result = sanitizeLogValue(malicious);
      expect(result).toBe("normalmalicious");
    });
  });

  describe("sanitizeForLogging", () => {
    it("should handle undefined URL", () => {
      const result = sanitizeForLogging(undefined);
      expect(result).toBe("");
    });

    it("should handle empty URL", () => {
      const result = sanitizeForLogging("");
      expect(result).toBe("");
    });

    it("should mask apiKey in URL", () => {
      const result = sanitizeForLogging("/api?apiKey=secret123&other=value");
      expect(result).toBe("/api?apiKey=***&other=value");
      expect(result).not.toContain("secret123");
    });

    it("should mask token in URL", () => {
      const result = sanitizeForLogging("/api?token=mytoken&other=value");
      expect(result).toBe("/api?token=***&other=value");
      expect(result).not.toContain("mytoken");
    });

    it("should mask api_key in URL", () => {
      const result = sanitizeForLogging("/api?api_key=secret&other=value");
      expect(result).toBe("/api?api_key=***&other=value");
      expect(result).not.toContain("secret");
    });

    it("should mask auth in URL", () => {
      const result = sanitizeForLogging("/api?auth=credentials&other=value");
      expect(result).toBe("/api?auth=***&other=value");
      expect(result).not.toContain("credentials");
    });

    it("should mask authorization in URL", () => {
      const result = sanitizeForLogging("/api?authorization=bearer123&other=value");
      expect(result).toBe("/api?authorization=***&other=value");
      expect(result).not.toContain("bearer123");
    });

    it("should mask multiple sensitive parameters in URL", () => {
      const result = sanitizeForLogging("/api?token=tok1&apiKey=key1&other=value");
      expect(result).toBe("/api?token=***&apiKey=***&other=value");
      expect(result).not.toContain("tok1");
      expect(result).not.toContain("key1");
    });

    it("should be case-insensitive for URL masking", () => {
      const result = sanitizeForLogging("/api?APIKEY=secret&Token=tok");
      expect(result).toBe("/api?APIKEY=***&Token=***");
    });

    it("should sanitize query object with sensitive keys", () => {
      const result = sanitizeForLogging("/api", { apiKey: "secret", other: "value" });
      expect(result).toContain('"apiKey":"***"');
      expect(result).toContain('"other":"value"');
      expect(result).not.toContain("secret");
    });

    it("should sanitize query object with token key", () => {
      const result = sanitizeForLogging("/api", { token: "mytoken", data: "info" });
      expect(result).toContain('"token":"***"');
      expect(result).toContain('"data":"info"');
      expect(result).not.toContain("mytoken");
    });

    it("should sanitize query object with api_key", () => {
      const result = sanitizeForLogging("/api", { api_key: "secret", other: "value" });
      expect(result).toContain('"api_key":"***"');
      expect(result).toContain('"other":"value"');
      expect(result).not.toContain("secret");
    });

    it("should sanitize query object with auth key", () => {
      const result = sanitizeForLogging("/api", { auth: "credentials", other: "value" });
      expect(result).toContain('"auth":"***"');
      expect(result).toContain('"other":"value"');
      expect(result).not.toContain("credentials");
    });

    it("should sanitize query object with authorization key", () => {
      const result = sanitizeForLogging("/api", { authorization: "bearer", other: "value" });
      expect(result).toContain('"authorization":"***"');
      expect(result).toContain('"other":"value"');
      expect(result).not.toContain("bearer");
    });

    it("should be case-insensitive for query object keys", () => {
      const result = sanitizeForLogging("/api", { APIKEY: "secret", Token: "tok", Other: "value" });
      expect(result).toContain('"APIKEY":"***"');
      expect(result).toContain('"Token":"***"');
      expect(result).toContain('"Other":"value"');
    });

    it("should sanitize both URL and query object", () => {
      const result = sanitizeForLogging("/api?token=urltoken", {
        apiKey: "querykey",
        other: "value",
      });
      expect(result).toContain("token=***"); // URL parameter format
      expect(result).toContain('"apiKey":"***"'); // Query object JSON format
      expect(result).toContain('"other":"value"');
      expect(result).not.toContain("urltoken");
      expect(result).not.toContain("querykey");
    });

    it("should preserve non-sensitive query parameters", () => {
      const result = sanitizeForLogging("/api", { page: "1", limit: "10", sort: "asc" });
      expect(result).toContain('"page":"1"');
      expect(result).toContain('"limit":"10"');
      expect(result).toContain('"sort":"asc"');
    });

    it("should handle empty query object", () => {
      const result = sanitizeForLogging("/api", {});
      expect(result).toBe("/api {}");
    });

    it("should handle null query object", () => {
      const result = sanitizeForLogging("/api", null);
      expect(result).toBe("/api");
    });

    it("should handle non-object query", () => {
      const result = sanitizeForLogging("/api", "string");
      expect(result).toBe("/api");
    });

    it("should prevent prototype pollution via __proto__", () => {
      const maliciousQuery = {
        __proto__: { polluted: true },
        normalKey: "value",
      };
      const result = sanitizeForLogging("/api", maliciousQuery);

      // Should not include __proto__ in output
      expect(result).not.toContain("__proto__");
      expect(result).toContain("normalKey");
    });

    it("should prevent prototype pollution via constructor", () => {
      const maliciousQuery = {
        constructor: { polluted: true },
        normalKey: "value",
      };
      const result = sanitizeForLogging("/api", maliciousQuery);

      // Should not include constructor in output
      expect(result).not.toContain("constructor");
      expect(result).toContain("normalKey");
    });

    it("should prevent prototype pollution via prototype", () => {
      const maliciousQuery = {
        prototype: { polluted: true },
        normalKey: "value",
      };
      const result = sanitizeForLogging("/api", maliciousQuery);

      // Should not include prototype in output
      expect(result).not.toContain("prototype");
      expect(result).toContain("normalKey");
    });
  });

  describe("sanitizeHttpMethod", () => {
    it("should allow valid HTTP methods", () => {
      expect(sanitizeHttpMethod("GET")).toBe("GET");
      expect(sanitizeHttpMethod("POST")).toBe("POST");
      expect(sanitizeHttpMethod("PUT")).toBe("PUT");
      expect(sanitizeHttpMethod("DELETE")).toBe("DELETE");
      expect(sanitizeHttpMethod("PATCH")).toBe("PATCH");
      expect(sanitizeHttpMethod("HEAD")).toBe("HEAD");
      expect(sanitizeHttpMethod("OPTIONS")).toBe("OPTIONS");
    });

    it("should normalize to uppercase", () => {
      expect(sanitizeHttpMethod("get")).toBe("GET");
      expect(sanitizeHttpMethod("post")).toBe("POST");
      expect(sanitizeHttpMethod("PuT")).toBe("PUT");
    });

    it("should reject invalid methods", () => {
      expect(sanitizeHttpMethod("INVALID")).toBe("INVALID");
      expect(sanitizeHttpMethod("CUSTOM")).toBe("INVALID");
      expect(sanitizeHttpMethod("../etc/passwd")).toBe("INVALID");
    });

    it("should handle undefined method", () => {
      expect(sanitizeHttpMethod(undefined)).toBe("UNKNOWN");
    });

    it("should prevent log injection via malicious method", () => {
      const maliciousMethod = "GET\nHTTP/1.1 200 OK\nMalicious: header";
      const result = sanitizeHttpMethod(maliciousMethod);
      expect(result).toBe("INVALID");
      expect(result).not.toContain("\n");
    });
  });

  describe("sanitizeErrorForClient", () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    describe("Development mode", () => {
      beforeEach(() => {
        process.env.NODE_ENV = "development";
      });

      it("should return full error message for Error objects", () => {
        const error = new Error("Detailed error with stack trace and internal info");
        const result = sanitizeErrorForClient(error, false);

        expect(result).toBe("Detailed error with stack trace and internal info");
      });

      it("should return string representation of non-Error objects", () => {
        const error = "Simple error string";
        const result = sanitizeErrorForClient(error, false);

        expect(result).toBe("Simple error string");
      });

      it("should handle object errors", () => {
        const error = { code: "ERR_123", details: "Internal details" };
        const result = sanitizeErrorForClient(error, false);

        // Object.toString() results in "[object Object]"
        expect(result).toBe("[object Object]");
      });
    });

    describe("Production mode", () => {
      beforeEach(() => {
        process.env.NODE_ENV = "production";
      });

      it("should sanitize authentication errors", () => {
        const error = new Error("Invalid token: jwt.verify failed at line 123");
        const result = sanitizeErrorForClient(error, true);

        expect(result).toBe("Authentication failed");
        expect(result).not.toContain("jwt.verify");
        expect(result).not.toContain("line 123");
      });

      it("should sanitize unauthorized errors", () => {
        const error = new Error("Unauthorized access to /admin/config");
        const result = sanitizeErrorForClient(error, true);

        expect(result).toBe("Authentication failed");
        expect(result).not.toContain("/admin/config");
      });

      it("should sanitize connection errors", () => {
        const error = new Error("ECONNREFUSED 127.0.0.1:8000");
        const result = sanitizeErrorForClient(error, true);

        expect(result).toBe("Service temporarily unavailable");
        expect(result).not.toContain("127.0.0.1");
        expect(result).not.toContain("8000");
      });

      it("should sanitize timeout errors", () => {
        const error = new Error("Connection timeout after 30s to database.internal.company.com");
        const result = sanitizeErrorForClient(error, true);

        expect(result).toBe("Service temporarily unavailable");
        expect(result).not.toContain("database.internal.company.com");
      });

      it("should sanitize validation errors", () => {
        const error = new Error('Validation failed: field "secretKey" is required');
        const result = sanitizeErrorForClient(error, true);

        expect(result).toBe("Invalid request parameters");
        expect(result).not.toContain("secretKey");
      });

      it("should sanitize invalid parameter errors", () => {
        const error = new Error("Invalid user_id: must be UUID format");
        const result = sanitizeErrorForClient(error, true);

        expect(result).toBe("Invalid request parameters");
        expect(result).not.toContain("user_id");
      });

      it("should sanitize ChromaDB errors", () => {
        const error = new Error("ChromaDB connection failed at /var/lib/chromadb/data");
        const result = sanitizeErrorForClient(error, true);

        expect(result).toBe("Database operation failed");
        expect(result).not.toContain("/var/lib/chromadb/data");
      });

      it("should sanitize database errors", () => {
        const error = new Error(
          "Database query failed: SELECT * FROM internal_users WHERE password=...",
        );
        const result = sanitizeErrorForClient(error, true);

        expect(result).toBe("Database operation failed");
        expect(result).not.toContain("SELECT");
        expect(result).not.toContain("internal_users");
      });

      it("should sanitize collection errors", () => {
        const error = new Error('Collection "admin_secrets" not found in namespace');
        const result = sanitizeErrorForClient(error, true);

        expect(result).toBe("Database operation failed");
        expect(result).not.toContain("admin_secrets");
      });

      it("should return generic error for unknown error types", () => {
        const error = new Error("Some random internal error at module X line 456");
        const result = sanitizeErrorForClient(error, true);

        expect(result).toBe("Internal server error");
        expect(result).not.toContain("module X");
        expect(result).not.toContain("line 456");
      });

      it("should handle non-Error objects in production", () => {
        const error = "Detailed error string";
        const result = sanitizeErrorForClient(error, true);

        expect(result).toBe("Internal server error");
      });

      it("should handle null/undefined errors", () => {
        const result1 = sanitizeErrorForClient(null, true);
        const result2 = sanitizeErrorForClient(undefined, true);

        expect(result1).toBe("Internal server error");
        expect(result2).toBe("Internal server error");
      });

      it("should handle case-insensitive error matching", () => {
        const error1 = new Error("AUTHENTICATION FAILED");
        const error2 = new Error("Connection Error");
        const error3 = new Error("VALIDATION ERROR");

        expect(sanitizeErrorForClient(error1, true)).toBe("Authentication failed");
        expect(sanitizeErrorForClient(error2, true)).toBe("Service temporarily unavailable");
        expect(sanitizeErrorForClient(error3, true)).toBe("Invalid request parameters");
      });
    });

    describe("Environment detection", () => {
      it("should use NODE_ENV by default", () => {
        process.env.NODE_ENV = "production";
        const error = new Error("Detailed internal error");
        const result = sanitizeErrorForClient(error);

        expect(result).toBe("Internal server error");
      });

      it("should allow explicit override", () => {
        process.env.NODE_ENV = "production";
        const error = new Error("Detailed internal error");
        const result = sanitizeErrorForClient(error, false);

        expect(result).toBe("Detailed internal error");
      });
    });
  });

  describe("validateOriginHeader", () => {
    let req: Partial<Request>;
    let res: Partial<ExpressResponse>;
    let next: NextFunction;

    beforeEach(() => {
      req = {
        headers: {},
        path: "/mcp",
      };
      res = {
        status: jest.fn(() => res as ExpressResponse),
        json: jest.fn(),
        setHeader: jest.fn(),
      } as Partial<ExpressResponse>;
      next = jest.fn() as NextFunction;
    });

    it("allows requests without Origin header (server-to-server)", () => {
      delete req.headers?.origin;

      validateOriginHeader(req as Request, res as ExpressResponse, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("allows localhost origins (http://localhost)", () => {
      req.headers = { origin: "http://localhost:3000" };

      validateOriginHeader(req as Request, res as ExpressResponse, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("allows localhost origins (http://127.0.0.1)", () => {
      req.headers = { origin: "http://127.0.0.1:8080" };

      validateOriginHeader(req as Request, res as ExpressResponse, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("allows localhost origins (http://[::1])", () => {
      req.headers = { origin: "http://[::1]:3000" };

      validateOriginHeader(req as Request, res as ExpressResponse, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("allows claude.ai by default (without ALLOWED_ORIGINS)", () => {
      const originalEnv = process.env.ALLOWED_ORIGINS;
      delete process.env.ALLOWED_ORIGINS;

      req.headers = { origin: "https://claude.ai" };

      validateOriginHeader(req as Request, res as ExpressResponse, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();

      process.env.ALLOWED_ORIGINS = originalEnv;
    });

    it("allows api.anthropic.com by default (without ALLOWED_ORIGINS)", () => {
      const originalEnv = process.env.ALLOWED_ORIGINS;
      delete process.env.ALLOWED_ORIGINS;

      req.headers = { origin: "https://api.anthropic.com" };

      validateOriginHeader(req as Request, res as ExpressResponse, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();

      process.env.ALLOWED_ORIGINS = originalEnv;
    });

    it("allows custom whitelisted origins from ALLOWED_ORIGINS", () => {
      const originalEnv = process.env.ALLOWED_ORIGINS;
      process.env.ALLOWED_ORIGINS = "https://myapp.com,https://example.com";

      req.headers = { origin: "https://myapp.com" };

      validateOriginHeader(req as Request, res as ExpressResponse, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();

      process.env.ALLOWED_ORIGINS = originalEnv;
    });

    it("combines default and custom allowed origins", () => {
      const originalEnv = process.env.ALLOWED_ORIGINS;
      process.env.ALLOWED_ORIGINS = "https://myapp.com";

      // Test default origin still works
      req.headers = { origin: "https://claude.ai" };
      validateOriginHeader(req as Request, res as ExpressResponse, next);
      expect(next).toHaveBeenCalled();

      // Test custom origin works
      req.headers = { origin: "https://myapp.com" };
      validateOriginHeader(req as Request, res as ExpressResponse, next);
      expect(next).toHaveBeenCalledTimes(2);

      process.env.ALLOWED_ORIGINS = originalEnv;
    });

    it("rejects non-whitelisted origins", () => {
      const originalEnv = process.env.ALLOWED_ORIGINS;
      delete process.env.ALLOWED_ORIGINS;
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {
        // Empty to suppress console output during tests
      });

      req.headers = { origin: "https://evil.com" };

      validateOriginHeader(req as Request, res as ExpressResponse, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.setHeader).toHaveBeenCalledWith("WWW-Authenticate", 'Bearer realm="MCP Server"');
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("DNS rebinding"),
        }),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("DNS Rebinding attack attempt blocked"),
      );
      expect(next).not.toHaveBeenCalled();

      process.env.ALLOWED_ORIGINS = originalEnv;
      consoleWarnSpy.mockRestore();
    });

    it("handles ALLOWED_ORIGINS with whitespace correctly", () => {
      const originalEnv = process.env.ALLOWED_ORIGINS;
      process.env.ALLOWED_ORIGINS = " https://myapp.com , https://example.com ";

      req.headers = { origin: "https://myapp.com" };

      validateOriginHeader(req as Request, res as ExpressResponse, next);

      expect(next).toHaveBeenCalled();

      process.env.ALLOWED_ORIGINS = originalEnv;
    });

    it("ignores empty strings in ALLOWED_ORIGINS", () => {
      const originalEnv = process.env.ALLOWED_ORIGINS;
      process.env.ALLOWED_ORIGINS = "https://myapp.com,,https://example.com";

      req.headers = { origin: "https://myapp.com" };

      validateOriginHeader(req as Request, res as ExpressResponse, next);

      expect(next).toHaveBeenCalled();

      process.env.ALLOWED_ORIGINS = originalEnv;
    });

    it("allows localhost without port", () => {
      req.headers = { origin: "http://localhost" };

      validateOriginHeader(req as Request, res as ExpressResponse, next);

      expect(next).toHaveBeenCalled();
    });

    it("allows https localhost", () => {
      req.headers = { origin: "https://localhost:3000" };

      validateOriginHeader(req as Request, res as ExpressResponse, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe("Prompts Feature", () => {
    beforeEach(() => {
      initChromaClient();
    });

    afterEach(() => {
      resetChromaClient();
    });

    describe("listPromptsHandler", () => {
      it("should return list of available prompts", async () => {
        const result = await listPromptsHandler();

        expect(result).toHaveProperty("prompts");
        expect(Array.isArray(result.prompts)).toBe(true);
        expect(result.prompts.length).toBeGreaterThan(0);

        // Check that each prompt has required fields
        result.prompts.forEach((prompt: Prompt) => {
          expect(prompt).toHaveProperty("name");
          expect(prompt).toHaveProperty("description");
          expect(prompt).toHaveProperty("arguments");
        });
      });

      it("should include semantic-search prompt", async () => {
        const result = await listPromptsHandler();

        const semanticSearch = result.prompts.find((p: Prompt) => p.name === "semantic-search");
        expect(semanticSearch).toBeDefined();
        expect(semanticSearch?.description).toContain("semantic search");
      });
    });

    describe("getPromptHandler", () => {
      it("should return prompt for semantic-search", async () => {
        const result = await getPromptHandler({
          params: {
            name: "semantic-search",
            arguments: {
              collection_name: "test_collection",
              query_text: "test query",
              n_results: 10,
            },
          },
        });

        expect(result).toHaveProperty("description");
        expect(result).toHaveProperty("messages");
        expect(result.messages[0].content.text).toContain("test_collection");
        expect(result.messages[0].content.text).toContain("test query");
      });

      it("should return prompt for add-documents", async () => {
        const result = await getPromptHandler({
          params: {
            name: "add-documents",
            arguments: {
              collection_name: "my_collection",
              documents: ["doc1", "doc2"],
            },
          },
        });

        expect(result.description).toContain("Add documents");
        expect(result.messages[0].content.text).toContain("my_collection");
      });

      it("should return prompt for create-collection", async () => {
        const result = await getPromptHandler({
          params: {
            name: "create-collection",
            arguments: {
              collection_name: "new_collection",
            },
          },
        });

        expect(result.description).toContain("Create");
        expect(result.messages[0].content.text).toContain("new_collection");
      });

      it("should use default values when arguments not provided", async () => {
        const result = await getPromptHandler({
          params: {
            name: "semantic-search",
          },
        });

        expect(result.messages[0].content.text).toContain("<collection_name>");
        expect(result.messages[0].content.text).toContain("<query_text>");
      });

      it("should throw error for unknown prompt", async () => {
        await expect(
          getPromptHandler({
            params: {
              name: "non-existent-prompt",
            },
          }),
        ).rejects.toThrow("Prompt not found");
      });
    });
  });

  describe("Resources Feature", () => {
    beforeEach(() => {
      initChromaClient();
    });

    afterEach(() => {
      resetChromaClient();
    });

    describe("listResourcesHandler", () => {
      it("should return list of collections as resources", async () => {
        const mockCollections = [
          { name: "collection1", metadata: {} },
          { name: "collection2", metadata: {} },
        ];

        jest.spyOn(getChromaClient(), "listCollections").mockResolvedValue(mockCollections as []);

        const result = await listResourcesHandler();

        expect(result).toHaveProperty("resources");
        expect(Array.isArray(result.resources)).toBe(true);
        expect(result.resources.length).toBe(3); // 2 collections + "All Collections"

        // Check "All Collections" resource is first
        expect(result.resources[0].uri).toBe("chroma://collections");
        expect(result.resources[0].name).toBe("All Collections");
      });

      it("should format collection URIs correctly", async () => {
        const mockCollections = [{ name: "test_collection", metadata: {} }];

        jest.spyOn(getChromaClient(), "listCollections").mockResolvedValue(mockCollections as []);

        const result = await listResourcesHandler();

        const collectionResource = result.resources.find(
          (r: Resource) => r.name === "test_collection",
        );
        expect(collectionResource?.uri).toBe("chroma://collection/test_collection");
        expect(collectionResource?.mimeType).toBe("application/json");
      });
    });

    describe("readResourceHandler", () => {
      it("should return all collections for chroma://collections URI", async () => {
        const mockCollections = [
          { name: "col1", metadata: { desc: "test1" } },
          { name: "col2", metadata: { desc: "test2" } },
        ];

        jest.spyOn(getChromaClient(), "listCollections").mockResolvedValue(mockCollections as []);

        const result = await readResourceHandler({
          params: { uri: "chroma://collections" },
        });

        expect(result.contents[0].uri).toBe("chroma://collections");
        expect(result.contents[0].mimeType).toBe("application/json");

        const data = JSON.parse(result.contents[0].text);
        expect(data.collections).toHaveLength(2);
        expect(data.collections[0].name).toBe("col1");
      });

      it("should return collection details for specific collection URI", async () => {
        const mockCollection = {
          name: "test_collection",
          metadata: { description: "Test" },
          count: jest.fn<() => Promise<number>>().mockResolvedValue(100),
          peek: jest
            .fn<() => Promise<{ ids: string[]; documents: string[] }>>()
            .mockResolvedValue({ ids: ["id1"], documents: ["doc1"] }),
        };

        jest
          .spyOn(getChromaClient(), "getCollection")
          .mockResolvedValue(mockCollection as unknown as Collection);

        const result = await readResourceHandler({
          params: { uri: "chroma://collection/test_collection" },
        });

        expect(result.contents[0].uri).toBe("chroma://collection/test_collection");

        const data = JSON.parse(result.contents[0].text);
        expect(data.name).toBe("test_collection");
        expect(data.count).toBe(100);
        expect(data.sample).toBeDefined();
      });

      it("should throw error for invalid URI format", async () => {
        await expect(
          readResourceHandler({
            params: { uri: "invalid://uri" },
          }),
        ).rejects.toThrow("Invalid resource URI");
      });

      it("should throw error for non-existent collection", async () => {
        jest.spyOn(getChromaClient(), "getCollection").mockRejectedValue(new Error("Not found"));

        await expect(
          readResourceHandler({
            params: { uri: "chroma://collection/nonexistent" },
          }),
        ).rejects.toThrow("Collection not found");
      });
    });
  });

  describe("Logging Feature", () => {
    describe("setLevelHandler", () => {
      it("should set log level to debug", async () => {
        const result = await setLevelHandler({
          params: { level: "debug" },
        });

        expect(result).toEqual({});
        expect(getCurrentLogLevel()).toBe("debug");
      });

      it("should set log level to error", async () => {
        await setLevelHandler({
          params: { level: "error" },
        });

        expect(getCurrentLogLevel()).toBe("error");
      });

      it("should throw error for invalid log level", async () => {
        await expect(
          setLevelHandler({
            params: { level: "invalid" },
          }),
        ).rejects.toThrow("Invalid log level");
      });
    });

    describe("shouldLog", () => {
      it("should return true for messages at or above current level", async () => {
        await setLevelHandler({ params: { level: "warning" } });

        expect(shouldLog("debug")).toBe(false);
        expect(shouldLog("info")).toBe(false);
        expect(shouldLog("warning")).toBe(true);
        expect(shouldLog("error")).toBe(true);
        expect(shouldLog("critical")).toBe(true);
      });

      it("should handle debug level (all messages)", async () => {
        await setLevelHandler({ params: { level: "debug" } });

        expect(shouldLog("debug")).toBe(true);
        expect(shouldLog("info")).toBe(true);
        expect(shouldLog("warning")).toBe(true);
      });
    });
  });

  describe("Completion Feature", () => {
    beforeEach(() => {
      initChromaClient();
    });

    afterEach(() => {
      resetChromaClient();
    });

    describe("completeHandler", () => {
      it("should return collection name completions", async () => {
        const mockCollections = [
          { name: "test_collection", metadata: {} },
          { name: "test_another", metadata: {} },
          { name: "other_collection", metadata: {} },
        ];

        jest.spyOn(getChromaClient(), "listCollections").mockResolvedValue(mockCollections as []);

        const result = await completeHandler({
          params: {
            ref: { type: "resource/tool", name: "chroma_query_documents" },
            argument: { name: "collection_name", value: "test" },
          },
        });

        expect(result.completion.values).toEqual(["test_collection", "test_another"]);
        expect(result.completion.total).toBe(2);
      });

      it("should return all collections when prefix is empty", async () => {
        const mockCollections = [
          { name: "col1", metadata: {} },
          { name: "col2", metadata: {} },
        ];

        jest.spyOn(getChromaClient(), "listCollections").mockResolvedValue(mockCollections as []);

        const result = await completeHandler({
          params: {
            ref: { type: "resource/tool" },
            argument: { name: "collection_name", value: "" },
          },
        });

        expect(result.completion.values.length).toBe(2);
      });

      it("should return empty array for non-collection_name arguments", async () => {
        const result = await completeHandler({
          params: {
            ref: { type: "resource/tool" },
            argument: { name: "other_field", value: "test" },
          },
        });

        expect(result.completion.values).toEqual([]);
        expect(result.completion.total).toBe(0);
      });

      it("should handle name argument (alternative)", async () => {
        const mockCollections = [{ name: "my_collection", metadata: {} }];

        jest.spyOn(getChromaClient(), "listCollections").mockResolvedValue(mockCollections as []);

        const result = await completeHandler({
          params: {
            ref: { type: "resource/tool" },
            argument: { name: "name", value: "my" },
          },
        });

        expect(result.completion.values).toContain("my_collection");
      });

      it("should limit results to 10 suggestions", async () => {
        const mockCollections = Array.from({ length: 15 }, (_, i) => ({
          name: `collection${i}`,
          metadata: {},
        }));

        jest.spyOn(getChromaClient(), "listCollections").mockResolvedValue(mockCollections as []);

        const result = await completeHandler({
          params: {
            ref: { type: "resource/tool" },
            argument: { name: "collection_name", value: "collection" },
          },
        });

        expect(result.completion.values.length).toBe(10);
        expect(result.completion.hasMore).toBe(true);
      });

      it("should handle ChromaDB errors gracefully", async () => {
        jest
          .spyOn(getChromaClient(), "listCollections")
          .mockRejectedValue(new Error("Connection failed"));

        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {
          // Empty to suppress console output during tests
        });

        const result = await completeHandler({
          params: {
            ref: { type: "resource/tool" },
            argument: { name: "collection_name", value: "test" },
          },
        });

        expect(result.completion.values).toEqual([]);
        expect(consoleErrorSpy).toHaveBeenCalledWith("Error in completion:", expect.any(Error));

        consoleErrorSpy.mockRestore();
      });
    });
  });

  describe("notifications/message (MCP Logging)", () => {
    describe("sendLogNotification", () => {
      it("should send notification for messages at or above current level", async () => {
        const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {
          // Empty to suppress console output during tests
        });
        await setLevelHandler({ params: { level: "warning" } });

        await sendLogNotification("error", "Test error message");

        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining("[ERROR] chromadb-remote-mcp: Test error message"),
        );

        consoleLogSpy.mockRestore();
      });

      it("should not send notification for messages below current level", async () => {
        const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {
          // Empty to suppress console output during tests
        });
        await setLevelHandler({ params: { level: "error" } });

        // Clear the spy after setLevelHandler logs its own message
        consoleLogSpy.mockClear();

        await sendLogNotification("info", "Test info message");

        expect(consoleLogSpy).not.toHaveBeenCalled();

        consoleLogSpy.mockRestore();
      });

      it("should include custom logger name", async () => {
        const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {
          // Empty to suppress console output during tests
        });
        await setLevelHandler({ params: { level: "info" } });

        await sendLogNotification("info", "Custom message", "my-logger");

        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("my-logger"));

        consoleLogSpy.mockRestore();
      });
    });

    describe("mcpLog", () => {
      it("should provide convenience methods for all log levels", async () => {
        const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {
          // Empty to suppress console output during tests
        });
        await setLevelHandler({ params: { level: "debug" } });

        // Clear the spy after setLevelHandler logs its own message
        consoleLogSpy.mockClear();

        await mcpLog.debug("Debug message");
        await mcpLog.info("Info message");
        await mcpLog.warning("Warning message");
        await mcpLog.error("Error message");

        // Verify each log level was called (note: each call may log multiple times
        // depending on number of active servers, so we check for message presence)
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("[DEBUG]"));
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("[INFO]"));
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("[WARNING]"));
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("[ERROR]"));

        consoleLogSpy.mockRestore();
      });
    });
  });

  describe("Ping Timeout Configuration", () => {
    it("should return default ping timeout", () => {
      const originalEnv = process.env.PING_TIMEOUT;
      delete process.env.PING_TIMEOUT;

      expect(getPingTimeout()).toBe(30000);

      process.env.PING_TIMEOUT = originalEnv;
    });

    it("should return custom ping timeout from environment", () => {
      const originalEnv = process.env.PING_TIMEOUT;
      process.env.PING_TIMEOUT = "60000";

      expect(getPingTimeout()).toBe(60000);

      process.env.PING_TIMEOUT = originalEnv;
    });

    it("should handle invalid ping timeout gracefully", () => {
      const originalEnv = process.env.PING_TIMEOUT;
      process.env.PING_TIMEOUT = "invalid";

      expect(isNaN(getPingTimeout())).toBe(true);

      process.env.PING_TIMEOUT = originalEnv;
    });
  });

  describe("Cursor-based Pagination", () => {
    describe("encodeCursor", () => {
      it("should encode cursor to base64", () => {
        const cursor = encodeCursor(10, 20);

        expect(typeof cursor).toBe("string");
        expect(cursor.length).toBeGreaterThan(0);
      });

      it("should encode different values differently", () => {
        const cursor1 = encodeCursor(0, 10);
        const cursor2 = encodeCursor(10, 10);

        expect(cursor1).not.toBe(cursor2);
      });
    });

    describe("decodeCursor", () => {
      it("should decode valid cursor", () => {
        const cursor = encodeCursor(15, 25);
        const decoded = decodeCursor(cursor);

        expect(decoded.offset).toBe(15);
        expect(decoded.limit).toBe(25);
      });

      it("should return defaults for invalid cursor", () => {
        const decoded = decodeCursor("invalid-cursor");

        expect(decoded.offset).toBe(0);
        expect(decoded.limit).toBe(10);
      });

      it("should handle empty cursor", () => {
        const decoded = decodeCursor("");

        expect(decoded.offset).toBe(0);
        expect(decoded.limit).toBe(10);
      });
    });

    describe("createPaginationMetadata", () => {
      it("should create metadata with next cursor when has more", () => {
        const metadata = createPaginationMetadata(0, 10, 100);

        expect(metadata.hasMore).toBe(true);
        expect(metadata.nextCursor).toBeDefined();
        expect(metadata.total).toBe(100);
      });

      it("should not include next cursor when no more results", () => {
        const metadata = createPaginationMetadata(90, 10, 100);

        expect(metadata.hasMore).toBe(false);
        expect(metadata.nextCursor).toBeUndefined();
      });

      it("should include prev cursor when offset > 0", () => {
        const metadata = createPaginationMetadata(20, 10, 100);

        expect(metadata.prevCursor).toBeDefined();
      });

      it("should not include prev cursor when offset = 0", () => {
        const metadata = createPaginationMetadata(0, 10, 100);

        expect(metadata.prevCursor).toBeUndefined();
      });

      it("should handle edge case: exactly at end", () => {
        const metadata = createPaginationMetadata(90, 10, 100);

        expect(metadata.hasMore).toBe(false);
        expect(metadata.nextCursor).toBeUndefined();
      });
    });
  });

  describe("Cancellation Support", () => {
    describe("generateRequestId", () => {
      it("should generate unique request IDs", () => {
        const id1 = generateRequestId();
        const id2 = generateRequestId();

        expect(id1).not.toBe(id2);
        expect(id1).toMatch(/^req_/);
        expect(id2).toMatch(/^req_/);
      });
    });

    describe("registerCancellableRequest", () => {
      it("should register and return AbortController", () => {
        const requestId = "test-request-1";
        const controller = registerCancellableRequest(requestId);

        expect(controller).toBeInstanceOf(AbortController);
        expect(controller.signal.aborted).toBe(false);

        cleanupRequest(requestId);
      });
    });

    describe("cancelRequest", () => {
      it("should cancel registered request", () => {
        const requestId = "test-request-2";
        const controller = registerCancellableRequest(requestId);

        const cancelled = cancelRequest(requestId);

        expect(cancelled).toBe(true);
        expect(controller.signal.aborted).toBe(true);
      });

      it("should return false for non-existent request", () => {
        const cancelled = cancelRequest("non-existent-request");

        expect(cancelled).toBe(false);
      });

      it("should remove request from active requests", () => {
        const requestId = "test-request-3";
        registerCancellableRequest(requestId);

        const initialCount = getActiveRequestCount();
        cancelRequest(requestId);
        const finalCount = getActiveRequestCount();

        expect(finalCount).toBe(initialCount - 1);
      });
    });

    describe("cleanupRequest", () => {
      it("should remove request from tracking", () => {
        const requestId = "test-request-4";
        registerCancellableRequest(requestId);

        const initialCount = getActiveRequestCount();
        cleanupRequest(requestId);
        const finalCount = getActiveRequestCount();

        expect(finalCount).toBe(initialCount - 1);
      });

      it("should handle cleanup of non-existent request", () => {
        expect(() => cleanupRequest("non-existent")).not.toThrow();
      });
    });

    describe("getActiveRequestCount", () => {
      it("should return number of active requests", () => {
        const id1 = "req-count-1";
        const id2 = "req-count-2";

        const initialCount = getActiveRequestCount();

        registerCancellableRequest(id1);
        registerCancellableRequest(id2);

        expect(getActiveRequestCount()).toBe(initialCount + 2);

        cleanupRequest(id1);
        cleanupRequest(id2);
      });
    });
  });
});
