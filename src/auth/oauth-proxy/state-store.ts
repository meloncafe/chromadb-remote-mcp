import { randomBytes } from "crypto";

export const TTL_SEC = 600;
const TTL_MS = TTL_SEC * 1000;

/**
 * Maximum entries per in-memory store. Tunable via `OAUTH_PROXY_STORE_MAX`
 * env var. When the cap is exceeded on insertion, the entry whose
 * `expires_at` is earliest is evicted first (oldest-expires-first).
 *
 * Default 10_000 is well above a normal MCP server's concurrent OAuth
 * session count; the cap exists to bound memory under abuse / DoS.
 */
function getStoreMax(): number {
  const raw = process.env.OAUTH_PROXY_STORE_MAX;
  if (typeof raw !== "string") return 10_000;
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n > 0) return n;
  return 10_000;
}

function evictOldestExpiresFirst<V extends { expires_at: number }>(store: Map<string, V>, cap: number): void {
  while (store.size >= cap) {
    let oldestKey: string | undefined;
    let oldestExpiresAt = Number.POSITIVE_INFINITY;
    for (const [key, entry] of store) {
      if (entry.expires_at < oldestExpiresAt) {
        oldestExpiresAt = entry.expires_at;
        oldestKey = key;
      }
    }
    if (oldestKey === undefined) break; // safety net — should not happen
    store.delete(oldestKey);
  }
}

export interface ClientEntry {
  redirect_uris: string[];
  token_endpoint_auth_method: "none";
  client_id_issued_at: number;
  expires_at: number;
}

export interface AuthzStateEntry {
  client_id: string;
  client_redirect_uri: string;
  client_state: string | undefined;
  code_challenge: string;
  code_challenge_method: "S256";
  scope: string;
  expires_at: number;
}

export interface AuthzCodeEntry {
  client_id: string;
  client_redirect_uri: string;
  code_challenge: string;
  code_challenge_method: "S256";
  id_token: string;
  scope: string;
  expires_in: number;
  expires_at: number;
}

const clientStore = new Map<string, ClientEntry>();
const authzStateStore = new Map<string, AuthzStateEntry>();
const authzCodeStore = new Map<string, AuthzCodeEntry>();

function generateId(): string {
  return randomBytes(32).toString("base64url");
}

function isExpired(expires_at: number): boolean {
  return Date.now() > expires_at;
}

// --- Public API — clients ---

export function registerClient(input: { redirect_uris: string[] }): { client_id: string; entry: ClientEntry } {
  const client_id = generateId();
  const now = Date.now();
  const entry: ClientEntry = {
    redirect_uris: input.redirect_uris,
    token_endpoint_auth_method: "none",
    client_id_issued_at: now,
    expires_at: now + TTL_MS,
  };
  evictOldestExpiresFirst(clientStore, getStoreMax());
  clientStore.set(client_id, entry);
  return { client_id, entry };
}

export function getClient(client_id: string): ClientEntry | undefined {
  const entry = clientStore.get(client_id);
  if (entry === undefined) {
    return undefined;
  }
  if (isExpired(entry.expires_at)) {
    clientStore.delete(client_id);
    return undefined;
  }
  return entry;
}

// --- Public API — authz states ---

export function putAuthzState(entry: Omit<AuthzStateEntry, "expires_at">): string {
  const proxy_state = generateId();
  const fullEntry: AuthzStateEntry = {
    ...entry,
    expires_at: Date.now() + TTL_MS,
  };
  evictOldestExpiresFirst(authzStateStore, getStoreMax());
  authzStateStore.set(proxy_state, fullEntry);
  return proxy_state;
}

export function consumeAuthzState(proxy_state: string): AuthzStateEntry | undefined {
  const entry = authzStateStore.get(proxy_state);
  if (entry === undefined) {
    return undefined;
  }
  authzStateStore.delete(proxy_state);
  if (isExpired(entry.expires_at)) {
    return undefined;
  }
  return entry;
}

// --- Public API — authz codes ---

export function putAuthzCode(entry: Omit<AuthzCodeEntry, "expires_at">): string {
  const proxy_code = generateId();
  const fullEntry: AuthzCodeEntry = {
    ...entry,
    expires_at: Date.now() + TTL_MS,
  };
  evictOldestExpiresFirst(authzCodeStore, getStoreMax());
  authzCodeStore.set(proxy_code, fullEntry);
  return proxy_code;
}

export function consumeAuthzCode(proxy_code: string): AuthzCodeEntry | undefined {
  const entry = authzCodeStore.get(proxy_code);
  if (entry === undefined) {
    return undefined;
  }
  authzCodeStore.delete(proxy_code);
  if (isExpired(entry.expires_at)) {
    return undefined;
  }
  return entry;
}

// --- Test/maintenance ---

export function _resetForTests(): void {
  clientStore.clear();
  authzStateStore.clear();
  authzCodeStore.clear();
}