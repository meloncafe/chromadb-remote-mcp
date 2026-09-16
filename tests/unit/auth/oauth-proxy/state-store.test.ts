import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import {
  registerClient,
  getClient,
  putAuthzState,
  consumeAuthzState,
  putAuthzCode,
  consumeAuthzCode,
  _resetForTests,
  TTL_SEC,
} from "../../../../src/auth/oauth-proxy/state-store.js";

describe("oauth-proxy: state-store (R5, E3)", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    _resetForTests();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.useRealTimers();
  });

  describe("TTL constant (R5)", () => {
    it("TTL_SEC is 600 or less", () => {
      expect(TTL_SEC).toBeLessThanOrEqual(600);
    });
  });

  describe("client store", () => {
    it("registerClient returns client_id + entry, getClient retrieves within TTL", () => {
      const { client_id, entry } = registerClient({ redirect_uris: ["http://localhost/cb"] });
      expect(typeof client_id).toBe("string");
      expect(client_id.length).toBeGreaterThan(0);
      expect(entry.redirect_uris).toEqual(["http://localhost/cb"]);
      expect(entry.token_endpoint_auth_method).toBe("none");

      const fetched = getClient(client_id);
      expect(fetched).toBeDefined();
      expect(fetched?.redirect_uris).toEqual(["http://localhost/cb"]);
    });

    it("getClient returns undefined after TTL", () => {
      jest.useFakeTimers();
      const { client_id } = registerClient({ redirect_uris: ["http://localhost/cb"] });
      jest.advanceTimersByTime((TTL_SEC + 1) * 1000);
      expect(getClient(client_id)).toBeUndefined();
    });
  });

  describe("authz state store (R5)", () => {
    it("putAuthzState returns proxy_state, consumeAuthzState consumes one-shot", () => {
      const proxy_state = putAuthzState({
        client_id: "c1",
        client_redirect_uri: "http://localhost/cb",
        client_state: "orig",
        code_challenge: "ch",
        code_challenge_method: "S256",
        scope: "openid",
      });
      expect(typeof proxy_state).toBe("string");
      expect(proxy_state.length).toBeGreaterThan(0);

      const first = consumeAuthzState(proxy_state);
      expect(first).toBeDefined();
      expect(first?.client_id).toBe("c1");

      const second = consumeAuthzState(proxy_state);
      expect(second).toBeUndefined();
    });

    it("consumeAuthzState returns undefined after TTL", () => {
      jest.useFakeTimers();
      const proxy_state = putAuthzState({
        client_id: "c1",
        client_redirect_uri: "http://localhost/cb",
        client_state: "orig",
        code_challenge: "ch",
        code_challenge_method: "S256",
        scope: "openid",
      });
      jest.advanceTimersByTime((TTL_SEC + 1) * 1000);
      expect(consumeAuthzState(proxy_state)).toBeUndefined();
    });
  });

  describe("authz code store (R5)", () => {
    it("putAuthzCode + consumeAuthzCode one-shot", () => {
      const code = putAuthzCode({
        client_id: "c1",
        client_redirect_uri: "http://localhost/cb",
        code_challenge: "ch",
        code_challenge_method: "S256",
        id_token: "google-id",
        scope: "openid",
        expires_in: 3600,
      });

      const first = consumeAuthzCode(code);
      expect(first?.id_token).toBe("google-id");

      const second = consumeAuthzCode(code);
      expect(second).toBeUndefined();
    });

    it("consumeAuthzCode returns undefined after TTL", () => {
      jest.useFakeTimers();
      const code = putAuthzCode({
        client_id: "c1",
        client_redirect_uri: "http://localhost/cb",
        code_challenge: "ch",
        code_challenge_method: "S256",
        id_token: "google-id",
        scope: "openid",
        expires_in: 3600,
      });
      jest.advanceTimersByTime((TTL_SEC + 1) * 1000);
      expect(consumeAuthzCode(code)).toBeUndefined();
    });
  });

  describe("size cap eviction (E3)", () => {
    it("OAUTH_PROXY_STORE_MAX=2 evicts oldest-expires-first on overflow (authz state)", () => {
      process.env.OAUTH_PROXY_STORE_MAX = "2";
      jest.useFakeTimers();
      const s1 = putAuthzState({
        client_id: "c", client_redirect_uri: "u", client_state: "1",
        code_challenge: "ch", code_challenge_method: "S256", scope: "openid",
      });
      jest.advanceTimersByTime(1000);
      const s2 = putAuthzState({
        client_id: "c", client_redirect_uri: "u", client_state: "2",
        code_challenge: "ch", code_challenge_method: "S256", scope: "openid",
      });
      jest.advanceTimersByTime(1000);
      const s3 = putAuthzState({
        client_id: "c", client_redirect_uri: "u", client_state: "3",
        code_challenge: "ch", code_challenge_method: "S256", scope: "openid",
      });

      expect(consumeAuthzState(s1)).toBeUndefined();
      expect(consumeAuthzState(s2)).toBeDefined();
      expect(consumeAuthzState(s3)).toBeDefined();
    });

    it("OAUTH_PROXY_STORE_MAX=2 evicts oldest-expires-first on overflow (authz code)", () => {
      process.env.OAUTH_PROXY_STORE_MAX = "2";
      jest.useFakeTimers();
      const c1 = putAuthzCode({
        client_id: "c", client_redirect_uri: "u",
        code_challenge: "ch", code_challenge_method: "S256",
        id_token: "i1", scope: "openid", expires_in: 3600,
      });
      jest.advanceTimersByTime(1000);
      const c2 = putAuthzCode({
        client_id: "c", client_redirect_uri: "u",
        code_challenge: "ch", code_challenge_method: "S256",
        id_token: "i2", scope: "openid", expires_in: 3600,
      });
      jest.advanceTimersByTime(1000);
      const c3 = putAuthzCode({
        client_id: "c", client_redirect_uri: "u",
        code_challenge: "ch", code_challenge_method: "S256",
        id_token: "i3", scope: "openid", expires_in: 3600,
      });

      expect(consumeAuthzCode(c1)).toBeUndefined();
      expect(consumeAuthzCode(c2)?.id_token).toBe("i2");
      expect(consumeAuthzCode(c3)?.id_token).toBe("i3");
    });
  });

  describe("_resetForTests clears all stores", () => {
    it("removes existing entries", () => {
      const { client_id } = registerClient({ redirect_uris: ["u"] });
      const state = putAuthzState({
        client_id: "c", client_redirect_uri: "u", client_state: undefined,
        code_challenge: "ch", code_challenge_method: "S256", scope: "openid",
      });
      const code = putAuthzCode({
        client_id: "c", client_redirect_uri: "u",
        code_challenge: "ch", code_challenge_method: "S256",
        id_token: "i", scope: "openid", expires_in: 3600,
      });

      _resetForTests();
      expect(getClient(client_id)).toBeUndefined();
      expect(consumeAuthzState(state)).toBeUndefined();
      expect(consumeAuthzCode(code)).toBeUndefined();
    });
  });
});