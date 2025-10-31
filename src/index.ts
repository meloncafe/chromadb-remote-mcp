import express from "express";
import type {ClientRequest, Server as HttpServer} from "http";
import {createProxyMiddleware} from "http-proxy-middleware";
import {ChromaClient} from "chromadb";
import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SetLevelRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {config} from "dotenv";
import rateLimit from "express-rate-limit";
import {timingSafeEqual} from "crypto";
import {createChromaTools, handleChromaTool} from "./chroma-tools.js";
import type {ChromaConfig} from "./types.js";

export interface Closeable {
  close(): void;
}

// Log level configuration
type LogLevel = "error" | "warn" | "info" | "debug";
const LOG_LEVEL = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) || "info";

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

// Warning throttling - track last warning time per message
const warningThrottle = new Map<string, number>();
const WARNING_THROTTLE_MS = 60000; // 1 minute

/**
 * Reset warning throttle (for testing)
 */
export function resetWarningThrottle(): void {
  warningThrottle.clear();
}

/**
 * Shared helper to filter control characters from a string
 * @param {string} str - Input string
 * @returns {string} String with control characters filtered out
 */
function filterControlCharacters(str: string): string {
  // First, remove ANSI escape sequences (ESC followed by bracket and parameters)
  // This handles sequences like \x1b[31m, \x1b[2J, etc.
  // Note: \x1b is the ESC character (ASCII 27) used in ANSI escape sequences
  // We intentionally match this control character to remove terminal escape codes
  // eslint-disable-next-line no-control-regex
  let result = str.replace(/\x1b\[[0-9;]*[a-zA-Z]/gu, '');  // skipcq: JS-0004, JS-W1035
  
  // Also remove other ESC sequences like \x1b(, \x1b), etc.
  // Note: These are character set selection sequences used in terminals
  // eslint-disable-next-line no-control-regex
  result = result.replace(/\x1b[()][AB012]/gu, '');  // skipcq: JS-0004, JS-W1035
  
  // Then filter out remaining control characters
  return result
    .split('')
    .filter(char => {
      const code = char.charCodeAt(0);
      // Keep only: printable ASCII (32-126) and safe extended Unicode (160+)
      return (code >= 32 && code <= 126) || code >= 160;
    })
    .join('');
}

/**
 * Remove all control characters from a string for security sanitization
 * @param {string} str - Input string
 * @returns {string} Sanitized string without control characters
 */
function removeControlCharacters(str: string): string {
  return filterControlCharacters(str);
}

/**
 * Sanitize log message with explicit control character removal
 * This is a wrapper around sanitizeLogValue with additional CodeQL-friendly checks
 * @internal
 */
function sanitizeLogMessage(message: string): string {
  return removeControlCharacters(message);
}

/**
 * Throttled warning logger - only logs same warning once per minute
 * SECURITY: Sanitizes message to prevent log injection attacks
 */
export function logWarn(message: string, alwaysLog = false): void {
  if (LOG_LEVELS[LOG_LEVEL] < LOG_LEVELS.warn) return;

  // Sanitize message to prevent log injection - explicit sanitization for CodeQL
  const sanitizedMessage = sanitizeLogMessage(message);

  if (alwaysLog) {
    console.warn(sanitizedMessage);
    return;
  }

  const now = Date.now();
  // Use original message for throttle key to maintain deduplication behavior
  const lastWarned = warningThrottle.get(message);

  if (!lastWarned || now - lastWarned > WARNING_THROTTLE_MS) {
    // lgtm[js/log-injection] - Message sanitized by sanitizeLogMessage (removes all control chars)
    console.warn(sanitizedMessage);
    warningThrottle.set(message, now);
  }
}

/**
 * Info logger with level control
 * SECURITY: Sanitizes message to prevent log injection attacks
 */
export function logInfo(message: string): void {
  if (LOG_LEVELS[LOG_LEVEL] >= LOG_LEVELS.info) {
    // lgtm[js/log-injection] - Message sanitized by sanitizeLogMessage (removes all control chars)
    console.log(sanitizeLogMessage(message));
  }
}

/**
 * Debug logger with level control
 * SECURITY: Sanitizes message to prevent log injection attacks
 */
export function logDebug(message: string): void {
  if (LOG_LEVELS[LOG_LEVEL] >= LOG_LEVELS.debug) {
    // lgtm[js/log-injection] - Message sanitized by sanitizeLogMessage (removes all control chars)
    console.log(sanitizeLogMessage(message));
  }
}

const activeRequests = new Map<string, AbortController>();

/**
 * Generates unique request ID for tracking cancellable operations.
 * @returns Unique request identifier.
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

/**
 * Registers request for cancellation tracking.
 * @param requestId - Request identifier.
 * @returns AbortController for request cancellation.
 */
export function registerCancellableRequest(requestId: string): AbortController {
  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  return controller;
}

/**
 * Cancels active request by ID.
 * @param requestId - Request identifier to cancel.
 * @returns True if request was found and cancelled.
 */
export function cancelRequest(requestId: string): boolean {
  const controller = activeRequests.get(requestId);
  if (controller) {
    controller.abort();
    activeRequests.delete(requestId);
    return true;
  }
  return false;
}

/**
 * Removes completed request from tracking.
 * @param requestId - Request identifier to clean up.
 */
export function cleanupRequest(requestId: string): void {
  activeRequests.delete(requestId);
}

/**
 * Returns count of active tracked requests.
 * @returns Number of active requests.
 */
export function getActiveRequestCount(): number {
  return activeRequests.size;
}

config();

/**
 * Validates environment variables and enforces production requirements.
 * @throws {Error} If validation fails with critical errors.
 */
export function validateEnvironmentVariables() {
  const errors: string[] = [];
  const warnings: string[] = [];

  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && !process.env.MCP_AUTH_TOKEN) {
    errors.push("❌ CRITICAL: MCP_AUTH_TOKEN is required in production environment");
  }

  if (!process.env.MCP_AUTH_TOKEN && !isProduction) {
    warnings.push(
      "⚠️  MCP_AUTH_TOKEN not set - authentication is disabled (not recommended for production)",
    );
  }

  if (process.env.CHROMA_PORT) {
    const port = parseInt(process.env.CHROMA_PORT, 10);
    if (isNaN(port) || port <= 0 || port > 65535) {
      errors.push(`❌ Invalid CHROMA_PORT: ${process.env.CHROMA_PORT} (must be 1-65535)`);
    }
  }

  if (process.env.PORT) {
    const port = parseInt(process.env.PORT, 10);
    if (isNaN(port) || port <= 0 || port > 65535) {
      errors.push(`❌ Invalid PORT: ${process.env.PORT} (must be 1-65535)`);
    }
  }

  if (process.env.REQUEST_TIMEOUT) {
    const timeout = parseInt(process.env.REQUEST_TIMEOUT, 10);
    if (isNaN(timeout) || timeout <= 0) {
      errors.push(
        `❌ Invalid REQUEST_TIMEOUT: ${process.env.REQUEST_TIMEOUT} (must be positive integer in milliseconds)`,
      );
    }
  }

  if (process.env.ALLOW_QUERY_AUTH && !["true", "false"].includes(process.env.ALLOW_QUERY_AUTH)) {
    warnings.push(
      `⚠️  Invalid ALLOW_QUERY_AUTH: ${process.env.ALLOW_QUERY_AUTH} (must be 'true' or 'false', defaulting to false)`,
    );
  }

  if (isProduction && process.env.ALLOW_QUERY_AUTH === "true") {
    warnings.push(
      "⚠️  ALLOW_QUERY_AUTH=true in production violates MCP spec (MUST NOT) - consider using Authorization header",
    );
  }

  warnings.forEach((warning) => console.warn(warning));

  if (errors.length > 0) {
    console.error("\n🚨 Environment variable validation failed:\n");
    errors.forEach((error) => console.error(error));
    console.error("\nPlease fix the configuration errors and restart the server.\n");
    throw new Error("Environment variable validation failed. See error messages above.");
  }

  if (warnings.length === 0 && errors.length === 0) {
    console.log("✅ Environment variables validated successfully");
  }
}

if (process.env.NODE_ENV !== "test") {
  validateEnvironmentVariables();
}

const chromaConfig: ChromaConfig = {
  host: process.env.CHROMA_HOST || "localhost",
  port: parseInt(process.env.CHROMA_PORT || "8000"),
  authToken: process.env.CHROMA_AUTH_TOKEN,
  tenantName: process.env.CHROMA_TENANT || "default_tenant",
  databaseName: process.env.CHROMA_DATABASE || "default_database",
};

/**
 * Waits for ChromaDB server to become available with retry logic.
 * @param maxRetries - Maximum retry attempts (default: 60 for production, 5 for test).
 * @param delay - Delay between retries in milliseconds.
 * @throws {Error} If ChromaDB fails to respond after all retries.
 */
export async function waitForChroma(maxRetries?: number, delay = 3000): Promise<void> {
  const isTest = process.env.NODE_ENV === "test";

  // Use reduced retries in test environment for faster execution
  const effectiveMaxRetries = maxRetries ?? (isTest ? 5 : 60);

  console.log(`⏳ Waiting for ChromaDB at http://${chromaConfig.host}:${chromaConfig.port}...`);

  // Initial delay to give ChromaDB time to start (skip in test environment)
  if (!isTest) {
    console.log("⏳ Initial delay of 10 seconds to allow ChromaDB to start...");
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  for (let i = 0; i < effectiveMaxRetries; i++) {
    try {
      // Try different endpoints as heartbeat might not exist
      const endpoints = ["/api/v2/version", "/api/v2", "/"];
      let response;
      let endpointUsed = "";

      for (const endpoint of endpoints) {
        try {
          response = await fetch(`http://${chromaConfig.host}:${chromaConfig.port}${endpoint}`);
          endpointUsed = endpoint;
          break;
        } catch (_err) {
          console.log(`⏳ Failed to reach ${endpoint}, trying next endpoint...`);
        }
      }

      if (response && (response.ok || response.status < 500)) {
        const fromEndpoint = sanitizeLogValue(endpointUsed);
        const returnStatus = sanitizeLogValue(response.status);
        console.log(
          `✅ ChromaDB is ready at ${fromEndpoint}! Status: ${returnStatus} (attempt ${
            i + 1
          }/${effectiveMaxRetries})`,
        );
        return;
      } else if (response) {
        const fromEndpoint = sanitizeLogValue(endpointUsed);
        const returnStatus = sanitizeLogValue(response.status);
        console.log(
          `⏳ ChromaDB returned status ${returnStatus} from ${fromEndpoint} (${
            i + 1
          }/${effectiveMaxRetries})`,
        );
      } else {
        console.log(`⏳ No response from ChromaDB endpoints (${i + 1}/${effectiveMaxRetries})`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      if (i < effectiveMaxRetries - 1) {
        console.log(
          `⏳ ChromaDB connection failed: ${sanitizeLogValue(errorMsg)} (${
            i + 1
          }/${effectiveMaxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error(`❌ Final attempt failed: ${sanitizeLogValue(errorMsg)}`);
      }
    }
  }

  throw new Error(`❌ ChromaDB connection timeout after ${effectiveMaxRetries} attempts`);
}

// Private ChromaDB client instance (initialized after waitForChroma)
let chromaClient: ChromaClient | null = null;

/**
 * Get the initialized ChromaDB client instance
 * @throws {Error} If client is not initialized
 * @returns {ChromaClient} The initialized ChromaDB client
 */
export function getChromaClient(): ChromaClient {
  if (!chromaClient) {
    throw new Error("ChromaDB client not initialized. Call initChromaClient() first.");
  }
  return chromaClient;
}

/**
 * Initialize the ChromaDB client with current configuration
 * @throws {Error} If client is already initialized
 */
export function initChromaClient(): void {
  if (chromaClient) {
    console.warn("⚠️ ChromaDB client already initialized, skipping re-initialization");
    return;
  }

  chromaClient = new ChromaClient({
    host: chromaConfig.host,
    port: chromaConfig.port,
    ssl: false,
    ...(chromaConfig.authToken && {
      headers: {
        provider: "token",
        credentials: chromaConfig.authToken,
      },
    }),
    tenant: chromaConfig.tenantName,
    database: chromaConfig.databaseName,
  });

  console.log(`✅ ChromaDB client initialized: http://${chromaConfig.host}:${chromaConfig.port}`);
}

/**
 * Reset the ChromaDB client instance (for testing purposes only)
 * @internal This function should only be used in tests
 */
export function resetChromaClient(): void {
  chromaClient = null;
}

/**
 * Sanitize value for safe logging (prevents log injection)
 * Removes all control characters and limits string length
 */
export function sanitizeLogValue(value: unknown, maxLength = 200): string {
  if (value === null) {
    return 'null';
  }
  
  if (value === undefined) {
    return 'undefined';
  }

  // Convert objects to JSON string for better logging
  let str: string;
  if (typeof value === 'object') {
    try {
      str = JSON.stringify(value);
    } catch {
      str = String(value);
    }
  } else {
    str = String(value);
  }

  // Remove all control characters including newlines
  const sanitized = filterControlCharacters(str);
  
  // Truncate and add ellipsis if needed
  if (sanitized.length > maxLength) {
    return `${sanitized.slice(0, maxLength)}...`;
  }

  return sanitized || '[empty]';
}

// Sanitize HTTP method for logging to prevent log injection
export function sanitizeHttpMethod(method: string | undefined): string {
  // Allowlist of valid HTTP methods
  const validMethods = [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "HEAD",
    "OPTIONS",
    "CONNECT",
    "TRACE",
  ];

  if (!method) {
    return "UNKNOWN";
  }

  const upperMethod = method.toUpperCase();
  return validMethods.includes(upperMethod) ? upperMethod : "INVALID";
}

// Sanitize sensitive data from URLs and query parameters for logging
// query can be unknown type to handle various Express request query formats
export function sanitizeForLogging(url: string | undefined, query?: unknown): string {
  // Handle undefined or null URL
  if (!url) {
    url = "";
  }

  // Remove any CR, LF characters to prevent log injection
  let sanitized = url.replace(/[\r\n]/g, "");

  // Mask sensitive query parameters in URL
  const sensitiveParams = ["apiKey", "token", "api_key", "auth", "authorization"];
  sensitiveParams.forEach((param) => {
    const regex = new RegExp(`([?&]${param}=)[^&]*`, "gi");
    sanitized = sanitized.replace(regex, "$1***");
  });

  // If query object is provided, create sanitized version
  if (query && typeof query === "object") {
    // Build sanitized array of key-value pairs for safe JSON serialization
    const sanitizedPairs: Array<{ key: string; value: unknown }> = [];

    // Validate and sanitize each key-value pair
    for (const [key, value] of Object.entries(query)) {
      // Skip prototype pollution vectors - these are dangerous property names
      // that could allow attackers to modify object prototypes
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }

      // Check if key matches any sensitive parameter (case-insensitive)
      const isSensitive = sensitiveParams.some(
        (param) => param.toLowerCase() === key.toLowerCase(),
      );

      // Add to safe array structure instead of using dynamic property assignment
      // This prevents prototype pollution while maintaining all query parameters
      sanitizedPairs.push({
        key,
        value: isSensitive ? "***" : value,
      });
    }

    // Convert to JSON-safe object representation
    // Using array of objects instead of dynamic properties avoids CodeQL warnings
    return `${sanitized} ${JSON.stringify(sanitizedPairs)}`;
  }

  return sanitized;
}

// Sanitize error messages for production to prevent information disclosure
export function sanitizeErrorForClient(
  error: unknown,
  isProduction: boolean = process.env.NODE_ENV === "production",
): string {
  // In development/test, provide detailed error messages for debugging
  if (!isProduction) {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  // In production, sanitize error messages to prevent information disclosure
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Authentication/Authorization errors - safe to return specific message
    if (
      message.includes("unauthorized") ||
      message.includes("authentication") ||
      message.includes("invalid token")
    ) {
      return "Authentication failed";
    }

    // Connection errors - check BEFORE database (timeout, econnrefused are more specific)
    if (message.includes("econnrefused") || message.includes("timeout")) {
      return "Service temporarily unavailable";
    }

    // Database/ChromaDB errors - more specific patterns
    if (
      message.includes("chromadb") ||
      message.includes("database query") ||
      message.includes("database operation") ||
      message.includes("collection")
    ) {
      return "Database operation failed";
    }

    // General connection errors (after specific checks)
    if (message.includes("connection")) {
      return "Service temporarily unavailable";
    }

    // Validation errors - safe to return
    if (
      message.includes("validation") ||
      message.includes("invalid") ||
      message.includes("required")
    ) {
      return "Invalid request parameters";
    }

    // Generic server error for everything else
    return "Internal server error";
  }

  // Non-Error objects
  return "Internal server error";
}

// MCP request handlers - exported for testing
export async function listToolsHandler() {
  const tools = createChromaTools(getChromaClient());
  return {tools};
}

// MCP tool call handler - request structure from MCP SDK
export async function callToolHandler(request: {
  params: { name: string; arguments?: Record<string, unknown> };
}) {
  const {name, arguments: args} = request.params;
  return handleChromaTool(getChromaClient(), name, args || {});
}

// ============================================================================
// Prompts Feature
// ============================================================================

// Define prompt templates for common ChromaDB queries
const CHROMA_PROMPTS = [
  {
    name: "semantic-search",
    description: "Perform semantic search on a ChromaDB collection",
    arguments: [
      {
        name: "collection_name",
        description: "Name of the collection to search",
        required: true,
      },
      {
        name: "query_text",
        description: "Text to search for semantically",
        required: true,
      },
      {
        name: "n_results",
        description: "Number of results to return (default: 5)",
        required: false,
      },
    ],
  },
  {
    name: "add-documents",
    description: "Add documents with embeddings to a collection",
    arguments: [
      {
        name: "collection_name",
        description: "Name of the collection",
        required: true,
      },
      {
        name: "documents",
        description: "Array of document texts to add",
        required: true,
      },
    ],
  },
  {
    name: "create-collection",
    description: "Create a new ChromaDB collection",
    arguments: [
      {
        name: "collection_name",
        description: "Name for the new collection",
        required: true,
      },
      {
        name: "metadata",
        description: "Optional metadata for the collection",
        required: false,
      },
    ],
  },
];

export async function listPromptsHandler() {
  return {
    prompts: CHROMA_PROMPTS.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments,
    })),
  };
}

export async function getPromptHandler(request: {
  params: { name: string; arguments?: Record<string, unknown> };
}) {
  const {name, arguments: args} = request.params;
  const prompt = CHROMA_PROMPTS.find((p) => p.name === name);

  if (!prompt) {
    throw new Error(`Prompt not found: ${name}`);
  }

  // Generate prompt message based on template and arguments
  let message = `# ${prompt.description}\n\n`;

  if (prompt.name === "semantic-search") {
    const collection = args?.collection_name || "<collection_name>";
    const query = args?.query_text || "<query_text>";
    const nResults = args?.n_results || 5;

    message += `To perform semantic search on the "${collection}" collection:\n\n`;
    message += "1. Use the `chroma_query_documents` tool\n";
    message += `2. Collection: ${collection}\n`;
    message += `3. Query: "${query}"\n`;
    message += `4. Number of results: ${nResults}\n\n`;
    message += "Example:\n```json\n";
    message += JSON.stringify(
      {
        collection_name: collection,
        query_texts: [query],
        n_results: nResults,
      },
      null,
      2,
    );
    message += "\n```";
  } else if (prompt.name === "add-documents") {
    const collection = args?.collection_name || "<collection_name>";
    const documents = (args?.documents as string[]) || ["document 1", "document 2"];

    message += `To add documents to the "${collection}" collection:\n\n`;
    message += "1. Use the `chroma_add_documents` tool\n";
    message += `2. Collection: ${collection}\n`;
    message += `3. Documents: ${JSON.stringify(documents)}\n\n`;
    message += "Example:\n```json\n";
    message += JSON.stringify(
      {
        collection_name: collection,
        documents,
        ids: documents.map((_: string, i: number) => `doc-${i + 1}`),
      },
      null,
      2,
    );
    message += "\n```";
  } else if (prompt.name === "create-collection") {
    const collection = args?.collection_name || "<collection_name>";
    const metadata = args?.metadata || {description: "My collection"};

    message += `To create a new collection named "${collection}":\n\n`;
    message += "1. Use the `chroma_create_collection` tool\n";
    message += `2. Collection: ${collection}\n`;
    message += `3. Metadata: ${JSON.stringify(metadata)}\n\n`;
    message += "Example:\n```json\n";
    message += JSON.stringify(
      {
        collection_name: collection,
        metadata,
      },
      null,
      2,
    );
    message += "\n```";
  }

  return {
    description: prompt.description,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: message,
        },
      },
    ],
  };
}

// ============================================================================
// Resources Feature
// ============================================================================

export async function listResourcesHandler() {
  try {
    const client = getChromaClient();
    const collections = await client.listCollections();

    const resources = collections.map((collection) => ({
      uri: `chroma://collection/${collection.name}`,
      name: collection.name,
      description: `ChromaDB collection: ${collection.name}`,
      mimeType: "application/json",
    }));

    // Add a special resource for listing all collections
    resources.unshift({
      uri: "chroma://collections",
      name: "All Collections",
      description: "List of all ChromaDB collections",
      mimeType: "application/json",
    });

    return {resources};
  } catch (error) {
    console.error("Error listing resources:", error);
    throw error;
  }
}

export async function readResourceHandler(request: { params: { uri: string } }) {
  const {uri} = request.params;

  if (uri === "chroma://collections") {
    // Return list of all collections
    const client = getChromaClient();
    const collections = await client.listCollections();

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              collections: collections.map((c) => ({
                name: c.name,
                metadata: c.metadata,
              })),
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  // Parse collection URI: chroma://collection/{name}
  const match = uri.match(/^chroma:\/\/collection\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const collectionName = match[1];
  const client = getChromaClient();

  try {
    const collection = await client.getCollection({name: collectionName});
    const count = await collection.count();
    const peek = await collection.peek({limit: 10});

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              name: collection.name,
              metadata: collection.metadata,
              count,
              sample: peek,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (_error) {
    throw new Error(`Collection not found: ${collectionName}`);
  }
}

// ============================================================================
// Logging Feature
// ============================================================================

// Log level management
let currentLogLevel:
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency" = "info";

// Store active server instances for sending notifications
const activeServers = new Set<Server>();

export function getCurrentLogLevel() {
  return currentLogLevel;
}

export async function setLevelHandler(request: { params: { level: string } }) {
  const {level} = request.params;

  const validLevels = [
    "debug",
    "info",
    "notice",
    "warning",
    "error",
    "critical",
    "alert",
    "emergency",
  ];

  if (!validLevels.includes(level)) {
    throw new Error(`Invalid log level: ${level}. Valid levels: ${validLevels.join(", ")}`);
  }

  currentLogLevel = level as typeof currentLogLevel;
  console.log(`📝 Log level set to: ${currentLogLevel}`);

  return {};
}

// Helper to check if message should be logged based on level
export function shouldLog(level: typeof currentLogLevel): boolean {
  const levels = ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"];
  const currentIndex = levels.indexOf(currentLogLevel);
  const messageIndex = levels.indexOf(level);

  return messageIndex >= currentIndex;
}

// Send log notification to all active clients
export async function sendLogNotification(
  level: typeof currentLogLevel,
  message: string,
  logger?: string,
  _data?: unknown, // Reserved for future MCP SDK notifications/message implementation
) {
  // Only send if message level is at or above current log level
  if (!shouldLog(level)) {
    return;
  }

  // Send to all active server instances
  // TODO: MCP SDK doesn't support notifications/message in Streamable HTTP mode
  //       Current workaround: console.log (sufficient for now)
  //       Blocked by: SDK limitation, not ChromaDB client issue
  for (const _server of activeServers) {
    try {
      console.log(
        `[${level.toUpperCase()}] ${sanitizeLogValue(
          logger || "chromadb-remote-mcp",
        )}: ${sanitizeLogValue(message)}`,
      );
    } catch (error) {
      console.error("Failed to send log notification:", error);
    }
  }
}

// Logging wrapper
export const mcpLog = {
  debug: (message: string, data?: unknown) =>
    sendLogNotification("debug", message, undefined, data),
  info: (message: string, data?: unknown) => sendLogNotification("info", message, undefined, data),
  notice: (message: string, data?: unknown) =>
    sendLogNotification("notice", message, undefined, data),
  warning: (message: string, data?: unknown) =>
    sendLogNotification("warning", message, undefined, data),
  error: (message: string, data?: unknown) =>
    sendLogNotification("error", message, undefined, data),
  critical: (message: string, data?: unknown) =>
    sendLogNotification("critical", message, undefined, data),
  alert: (message: string, data?: unknown) =>
    sendLogNotification("alert", message, undefined, data),
  emergency: (message: string, data?: unknown) =>
    sendLogNotification("emergency", message, undefined, data),
};

// ============================================================================
// Completion Feature
// ============================================================================

export async function completeHandler(request: {
  params: { ref: { type: string; name?: string }; argument: { name: string; value: string } };
}) {
  const {argument} = request.params;

  // Only provide completions for collection_name arguments
  if (argument.name !== "collection_name" && argument.name !== "name") {
    return {completion: {values: [], total: 0, hasMore: false}};
  }

  try {
    const client = getChromaClient();
    const collections = await client.listCollections();

    // Filter collections based on partial input
    const prefix = argument.value.toLowerCase();
    const matches = collections
      .filter((c) => c.name.toLowerCase().startsWith(prefix))
      .map((c) => c.name)
      .slice(0, 10); // Limit to 10 suggestions

    return {
      completion: {
        values: matches,
        total: matches.length,
        hasMore: collections.length > 10,
      },
    };
  } catch (error) {
    console.error("Error in completion:", error);
    return {completion: {values: [], total: 0, hasMore: false}};
  }
}

// Create MCP server factory function
export function createServer(): Server {
  const server = new Server(
    {
      name: "chroma-remote-mcp",
      version: "1.0.2",
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: {},
        logging: {},
        completion: {},
      },
    },
  );

  // Note: PING_TIMEOUT environment variable is currently unused
  // MCP SDK Server class doesn't expose ping timeout configuration directly
  // This would need to be set at the transport level when SDK supports it
  // For now, the default SDK ping timeout is used

  // MCP SDK doesn't have a built-in notification handler registration
  // This is handled internally by the SDK when a client sends notifications/cancelled
  // We track active requests using the activeRequests Map for manual cancellation support

  // Register tool handlers
  server.setRequestHandler(ListToolsRequestSchema, listToolsHandler);
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Generate request ID for cancellation tracking
    const requestId = generateRequestId();
    // TODO: Pass abort signal to callToolHandler
    //       Blocked by: ChromaDB client doesn't support AbortSignal
    //       Infrastructure ready: AbortController tracking implemented
    registerCancellableRequest(requestId);

    try {
      return await callToolHandler(request);
    } finally {
      // Cleanup request tracking
      cleanupRequest(requestId);
    }
  });

  // Register prompt handlers
  server.setRequestHandler(ListPromptsRequestSchema, listPromptsHandler);
  server.setRequestHandler(GetPromptRequestSchema, getPromptHandler);

  // Register resource handlers
  server.setRequestHandler(ListResourcesRequestSchema, listResourcesHandler);
  server.setRequestHandler(ReadResourceRequestSchema, readResourceHandler);

  // Register logging handler
  server.setRequestHandler(SetLevelRequestSchema, setLevelHandler);

  // Register completion handler
  server.setRequestHandler(CompleteRequestSchema, completeHandler);

  return server;
}

// Export ping timeout for testing and documentation
export function getPingTimeout(): number {
  return parseInt(process.env.PING_TIMEOUT || "30000", 10);
}

// Express app setup
export const app = express();

// Trust proxy - Required for rate limiting behind reverse proxy
// Tailscale Funnel setup: Client → Tailscale → Caddy → Express (2 proxies)
// Trust the first 2 proxies (Tailscale + Caddy) to prevent X-Forwarded-For spoofing
// For non-Tailscale deployments with only Caddy, set to 1
// See: https://expressjs.com/en/guide/behind-proxies.html
app.set("trust proxy", 2);

app.use(express.json());

// Rate limiter skip function - exported for testing
export function shouldSkipRateLimit(req: express.Request): boolean {
  return req.path === "/health";
}

// Validate and parse RATE_LIMIT_MAX environment variable
export function validateRateLimitMax(envValue: string | undefined, defaultValue = 100): number {
  // Use default if not provided
  if (!envValue) {
    return defaultValue;
  }

  // Try to parse as integer
  const parsed = parseInt(envValue, 10);

  // Check for invalid number
  if (isNaN(parsed)) {
    console.warn(
      `⚠️  Invalid RATE_LIMIT_MAX value "${envValue}". Must be a positive integer. Using default: ${defaultValue}`,
    );
    return defaultValue;
  }

  // Check for non-positive values
  if (parsed <= 0) {
    console.warn(
      `⚠️  Invalid RATE_LIMIT_MAX value "${envValue}". Must be greater than 0. Using default: ${defaultValue}`,
    );
    return defaultValue;
  }

  // Check for unreasonably large values (potential misconfiguration)
  if (parsed > 10000) {
    console.warn(
      `⚠️  Very high RATE_LIMIT_MAX value "${envValue}". Consider if this is intentional.`,
    );
  }

  return parsed;
}

// ✅ Rate Limiting (100 requests per 15 minutes per IP)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: validateRateLimitMax(process.env.RATE_LIMIT_MAX), // Limit each IP to max requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: "Too many requests from this IP, please try again later.",
  // Skip rate limiting for health check
  skip: shouldSkipRateLimit,
});

// Apply rate limiting to all requests
app.use(limiter);

// ✅ Protocol Version Validation
// MCP Spec: Servers SHOULD validate MCP-Protocol-Version header
export function validateProtocolVersion(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
) {
  const protocolVersion = req.headers["mcp-protocol-version"] as string | undefined;

  // Log protocol version if present
  if (protocolVersion) {
    logDebug(`📋 MCP Protocol Version: ${sanitizeLogValue(protocolVersion)}`);

    // Known supported versions (MCP SDK supports multiple versions)
    // 2024-11-05: MCP SDK 1.20.1 baseline
    // 2025-06-18: Latest spec version (forward compatible)
    const supportedVersions = ["2024-11-05", "2025-06-18"];

    if (!supportedVersions.includes(protocolVersion)) {
      logWarn(
        `⚠️  Unsupported MCP Protocol Version: ${sanitizeLogValue(
          protocolVersion,
        )}. Supported: ${supportedVersions.join(", ")}`,
      );
      // Note: We continue anyway as per MCP spec - version negotiation is handled by SDK
    }
  }

  next();
}

// Configurable timeout for all requests
export function createTimeoutMiddleware(timeoutMs?: number) {
  const timeout = timeoutMs || parseInt(process.env.REQUEST_TIMEOUT || "120000", 10); // Default 2 minutes

  return function timeoutMiddleware(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
    // Set timeout for this request
    req.setTimeout(timeout, () => {
      if (!res.headersSent) {
        // lgtm[js/log-injection] - All user inputs sanitized by sanitizeLogValue
        console.error(
          `⏱️  Request timeout after ${timeout}ms: ${sanitizeLogValue(
            req.method,
          )} ${sanitizeLogValue(req.path)}`,
        );
        res.status(408).json({
          error: "Request timeout",
          timeout: `${timeout}ms`,
        });
      }
    });

    // Set timeout for response
    res.setTimeout(timeout, () => {
      if (!res.headersSent) {
        // lgtm[js/log-injection] - All user inputs sanitized by sanitizeLogValue
        console.error(
          `⏱️  Response timeout after ${timeout}ms: ${sanitizeLogValue(
            req.method,
          )} ${sanitizeLogValue(req.path)}`,
        );
        res.status(504).json({
          error: "Gateway timeout",
          timeout: `${timeout}ms`,
        });
      }
    });

    next();
  };
}

// Apply timeout middleware
app.use(createTimeoutMiddleware());

// Add essential security headers (similar to helmet)
export function securityHeaders(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  // Prevent clickjacking attacks
  res.setHeader("X-Frame-Options", "DENY");

  // Prevent MIME type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Enable XSS protection (legacy but still useful)
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // Referrer Policy - don't leak sensitive URLs
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Content Security Policy - strict resource loading restrictions
  const cspDirectives = [
    "default-src 'none'", // Deny everything by default
    "script-src 'self'", // Only allow scripts from same origin
    "connect-src 'self'", // Only allow fetch/XHR to same origin
    "img-src 'self' data:", // Allow images from same origin and data URIs
    "style-src 'self' 'unsafe-inline'", // Allow styles (unsafe-inline for Swagger UI)
    "font-src 'self'", // Allow fonts from same origin
    "frame-ancestors 'none'", // Prevent embedding (redundant with X-Frame-Options)
    "base-uri 'self'", // Restrict <base> tag
    "form-action 'self'", // Restrict form submissions
  ].join("; ");
  res.setHeader("Content-Security-Policy", cspDirectives);

  // Permissions Policy - restrict browser features
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");

  // HTTPS Strict Transport Security (if behind HTTPS proxy)
  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
}

// Apply security headers
app.use(securityHeaders);

// MCP Spec: Servers MUST validate Origin header to prevent DNS rebinding attacks
export function validateOriginHeader(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const origin = req.headers.origin;

  // Origin header is only present in browser requests
  // If no Origin header, allow (server-to-server requests are OK)
  if (!origin) {
    return next();
  }

  // Default allowed origins (Claude Desktop Custom Connector)
  const defaultAllowedOrigins = ["https://claude.ai", "https://api.anthropic.com"];

  // Parse additional allowed origins from environment variable
  const customAllowedOrigins =
    process.env.ALLOWED_ORIGINS?.split(",")
      .map((o) => o.trim())
      .filter(Boolean) || [];

  // Combine default and custom allowed origins
  const allowedOrigins = [...defaultAllowedOrigins, ...customAllowedOrigins];

  // Localhost pattern (various formats)
  const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1])(:\d+)?$/;

  // Check whitelist or localhost
  if (allowedOrigins.includes(origin) || localhostPattern.test(origin)) {
    return next();
  }

  // Reject untrusted origin
  // lgtm[js/log-injection] - User input sanitized by sanitizeLogValue
  console.warn(`🚨 DNS Rebinding attack attempt blocked: ${sanitizeLogValue(origin)}`);
  res.setHeader("WWW-Authenticate", 'Bearer realm="MCP Server"');
  return res.status(403).json({
    error: "Forbidden: Invalid origin header. Possible DNS rebinding attack.",
  });
}

// Optional Authentication Middleware (supports multiple auth methods)
export const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

// Factory function for creating auth middleware (testable)
export function createAuthMiddleware(authToken?: string) {
  return function authenticate(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
    // Skip auth if authToken is not set
    if (!authToken) {
      return next();
    }

    let providedToken: string | undefined;

    // Method 1: Authorization header (RECOMMENDED - MCP spec compliant)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      providedToken = authHeader.substring(7); // Remove 'Bearer ' prefix
    }

    // Method 2: X-Chroma-Token header (RECOMMENDED - ChromaDB compatibility)
    if (!providedToken) {
      providedToken = req.headers["x-chroma-token"] as string;
    }

    // Method 3: Query parameter (DEPRECATED - MCP spec violation: MUST NOT)
    // Only enabled if ALLOW_QUERY_AUTH=true environment variable is set
    if (!providedToken && process.env.ALLOW_QUERY_AUTH === "true") {
      providedToken =
        (req.query.apiKey as string) ||
        (req.query.token as string) ||
        (req.query.api_key as string);

      if (providedToken) {
        logWarn(
          "⚠️  Query parameter authentication is DEPRECATED and violates MCP spec (MUST NOT). Use Authorization header instead.",
        );
      }
    }

    // No token provided - Return 401 with WWW-Authenticate header (MCP spec: MUST)
    if (!providedToken) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="MCP Server", charset="UTF-8"');
      return res.status(401).json({
        error:
          "Unauthorized: Missing authentication. Provide token via Authorization header or X-Chroma-Token header",
      });
    }

    // Validate token using constant-time comparison to prevent timing attacks
    try {
      const providedBuffer = Buffer.from(providedToken);
      const expectedBuffer = Buffer.from(authToken);

      // If lengths differ, still perform comparison to prevent timing attacks
      if (providedBuffer.length !== expectedBuffer.length) {
        res.setHeader(
          "WWW-Authenticate",
          'Bearer realm="MCP Server", error="invalid_token", charset="UTF-8"',
        );
        return res.status(401).json({error: "Unauthorized: Invalid token"});
      }

      // Use constant-time comparison
      if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
        res.setHeader(
          "WWW-Authenticate",
          'Bearer realm="MCP Server", error="invalid_token", charset="UTF-8"',
        );
        return res.status(401).json({error: "Unauthorized: Invalid token"});
      }
    } catch (_error) {
      // If any error occurs during comparison, deny access
      res.setHeader(
        "WWW-Authenticate",
        'Bearer realm="MCP Server", error="invalid_token", charset="UTF-8"',
      );
      return res.status(401).json({error: "Unauthorized: Invalid token"});
    }

    // Token is valid
    return next();
  };
}

// Default middleware instance using environment variable
export const authenticateMCP = createAuthMiddleware(MCP_AUTH_TOKEN);

// Close handler for MCP requests - exported for testing
export function createCloseHandler(server: Closeable, transport: Closeable) {
  return () => {
    console.log("🔌 Request closed");
    transport.close();
    server.close();
  };
}

// MCP endpoint handler - exported for testing
export async function mcpHandler(req: express.Request, res: express.Response) {
  const sanitizedUrl = sanitizeForLogging(req.url, req.query);
  const sanitizedMethod = sanitizeLogValue(req.body?.method || "unknown");

  // Use MCP logging for request tracking
  await mcpLog.info(`Received MCP request (incoming): '${sanitizedMethod}'`, {
    url: sanitizedUrl,
    method: sanitizedMethod,
  });

  try {
    // Create a new server and transport for each request
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    // Register server for notifications
    activeServers.add(server);

    // Connect server to transport
    await server.connect(transport);

    // Handle the request
    await transport.handleRequest(req, res, req.body);

    // Cleanup on request close
    /* istanbul ignore next */
    res.on("close", () => {
      activeServers.delete(server);
      createCloseHandler(server, transport)();
    });
  } catch (error) {
    console.error("❌ MCP request error:", error);
    await mcpLog.error("MCP request failed", {error: String(error)});

    // Only send error response if headers haven't been sent yet
    // This prevents "res.writeHead is not a function" errors when
    // the MCP SDK has already started sending a response
    if (!res.headersSent) {
      res.status(500).json({
        error: sanitizeErrorForClient(error),
      });
    }
  }
}

// MCP endpoint - Streamable HTTP Transport (with protocol version, origin validation and optional auth)
// This must be defined BEFORE the catch-all proxy
app.post("/mcp", validateProtocolVersion, validateOriginHeader, authenticateMCP, mcpHandler);

// Health check handler - exported for testing
export async function healthHandler(_req: express.Request, res: express.Response) {
  try {
    // Test actual ChromaDB connection
    await getChromaClient().heartbeat();
    res.json({
      status: "ok",
      service: "chroma-remote-mcp",
      chroma: `http://${chromaConfig.host}:${chromaConfig.port}`,
      chromadb: "connected",
    });
  } catch (error) {
    res.status(503).json({
      status: "error",
      service: "chroma-remote-mcp",
      chromadb: "disconnected",
      error: sanitizeErrorForClient(error),
    });
  }
}

// Health check endpoint (no authentication required)
app.get("/health", healthHandler);

// Proxy handlers - exported for testing
// proxyReq type is from http-proxy-middleware internal types
export function proxyReqHandler(
  _proxyReq: ClientRequest,
  req: express.Request,
  _res: express.Response,
) {
  const sanitizedMethod = sanitizeHttpMethod(req.method);
  const sanitizedUrl = sanitizeForLogging(req.url);
  // lgtm[js/log-injection] - All user inputs sanitized (HTTP method allowlist + URL sanitization)
  console.log(`🔄 Proxying ${sanitizedMethod} ${sanitizedUrl} → ChromaDB`);
}

export function proxyErrorHandler(
  err: Error,
  _req: express.Request,
  res?: express.Response | { end?: () => void },
) {
  console.error("❌ Proxy error:", err);
  if (res && typeof res.end === "function") {
    res.end();
  }
}

// Track active connections for graceful shutdown
const activeConnections = new Set<express.Response>();

// Middleware to track active connections
export function trackConnection(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  activeConnections.add(res);

  res.on("finish", () => {
    activeConnections.delete(res);
  });

  res.on("close", () => {
    activeConnections.delete(res);
  });

  next();
}

// Apply connection tracking (must be before routes)
app.use(trackConnection);

// ChromaDB REST API Proxy (catch-all for all other requests)
// This must be LAST to catch all non-MCP, non-health requests
app.use(
  authenticateMCP,
  createProxyMiddleware({
    target: `http://${chromaConfig.host}:${chromaConfig.port}`,
    changeOrigin: true,
    on: {
      proxyReq: proxyReqHandler,
      error: proxyErrorHandler,
    },
  }),
);

// Helper function to display config value with default indicator
export function formatConfigValue(
  value: string | undefined,
  defaultValue: string,
  unit = "",
): string {
  const actualValue = value || defaultValue;
  const isDefault = !value || value === defaultValue;
  const indicator = isDefault ? "📌" : "⚙️";
  return `${actualValue}${unit} ${indicator}`;
}

// Helper function to get config status
export function getConfigStatus(): {
  port: string;
  rateLimit: string;
  requestTimeout: string;
  pingTimeout: string;
  logLevel: string;
  allowQueryAuth: string;
  chromaTenant: string;
  chromaDatabase: string;
} {
  return {
    port: formatConfigValue(process.env.PORT, "3000"),
    rateLimit: formatConfigValue(process.env.RATE_LIMIT_MAX, "100", " req/15min"),
    requestTimeout: formatConfigValue(
      process.env.REQUEST_TIMEOUT
        ? (parseInt(process.env.REQUEST_TIMEOUT) / 1000).toString()
        : undefined,
      "120",
      "s",
    ),
    pingTimeout: formatConfigValue(
      process.env.PING_TIMEOUT ? (parseInt(process.env.PING_TIMEOUT) / 1000).toString() : undefined,
      "30",
      "s",
    ),
    logLevel: formatConfigValue(process.env.LOG_LEVEL, "info"),
    allowQueryAuth: formatConfigValue(process.env.ALLOW_QUERY_AUTH, "true"),
    chromaTenant: formatConfigValue(process.env.CHROMA_TENANT, "default_tenant"),
    chromaDatabase: formatConfigValue(process.env.CHROMA_DATABASE, "default_database"),
  };
}

// Main function: Wait for ChromaDB, then start server
export async function main() {
  try {
    // Wait for ChromaDB to be ready
    await waitForChroma();

    // Initialize ChromaDB client
    initChromaClient();

    // Get config status
    const config = getConfigStatus();
    const port = parseInt(process.env.PORT || "3000");

    // Start Express server
    // Return server for graceful shutdown
    return app.listen(port, () => {
      console.log(`
🚀 ChromaDB Remote MCP Server v1.0.2
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📡 Endpoints
   MCP:          http://localhost:${port}/mcp
   Health:       http://localhost:${port}/health
   API Docs:     http://localhost:${port}/docs

🗄️  ChromaDB
   Host:         ${chromaConfig.host}:${chromaConfig.port}
   Tenant:       ${config.chromaTenant}
   Database:     ${config.chromaDatabase}

🔐 Security
   Auth Token:   ${MCP_AUTH_TOKEN ? "✅ Enabled" : "⚠️  DISABLED (not recommended for production)"}
   Query Auth:   ${config.allowQueryAuth}
   Rate Limit:   ${config.rateLimit}

⚙️  Configuration
   Log Level:    ${config.logLevel}
   Timeout:      ${config.requestTimeout}
   Ping:         ${config.pingTimeout}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 = Default value  |  ⚙️  = Custom value

✅ Ready to accept MCP connections!
      `);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exitCode = 1;
    throw error;
  }
}

// Wait for active connections to complete before shutting down
export async function gracefulShutdown(signal: string, server?: HttpServer) {
  console.log(`\n👋 Received ${sanitizeLogValue(signal)}, shutting down gracefully...`);

  // Stop accepting new connections
  if (server) {
    server.close(() => {
      console.log("✅ HTTP server closed");
    });
  }

  // Wait for active connections to complete (with timeout)
  const shutdownTimeout = 30000; // 30 seconds
  const startTime = Date.now();

  while (activeConnections.size > 0 && Date.now() - startTime < shutdownTimeout) {
    console.log(`⏳ Waiting for ${activeConnections.size} active connection(s) to complete...`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (activeConnections.size > 0) {
    console.warn(`⚠️  Shutdown timeout - ${activeConnections.size} connection(s) still active`);
  } else {
    console.log("✅ All connections closed");
  }

  console.log("👋 Goodbye!");
  // Set exit code but let Node.js exit naturally
  process.exitCode = 0;
}

// Store server instance for graceful shutdown
let serverInstance: HttpServer | undefined;

// Graceful shutdown handlers
process.on("SIGINT", () => gracefulShutdown("SIGINT", serverInstance));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM", serverInstance));

// Start the application (skip in test environment)
/* istanbul ignore next */
if (process.env.NODE_ENV !== "test") {
  main().then((server) => {
    serverInstance = server;
  });
}
