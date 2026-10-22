# Changelog

[한국어 문서](CHANGELOG.ko.md)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`deploy.sh` — host-independent deployment helper for the Docker Compose stack** — 9 commands: `install` (first-time setup: creates `.env` from `.env.example` when missing and stops so you can edit it; otherwise pulls images and starts services), `update` (pull + `up -d --force-recreate` + dangling image prune + `CHROMA_SERVER_VERSION` sync, then prints the version information reusing that single judgment), `start`, `stop` (`docker compose down`, data is kept), `restart` (does not re-read `.env` — use `update`/`start` after changing it), `status`, `logs [service]`, `version`, `backup`; `help` prints the usage. Everything host specific lives in `.env` and optional extra compose files, never in the script.
- **`deploy.sh` compose file selection** — `COMPOSE_FILE` (process environment, then `.env`) is a colon-separated list merged in order (later files override earlier ones), exactly like `docker compose`; `COMPOSE_PATH_SEPARATOR` changes the separator. Relative entries resolve against the deploy directory, absolute entries are used unchanged. Every compose call gets `--project-directory`, so `.env` and relative paths always refer to the deploy directory. `COMPOSE_PROJECT_NAME` in `.env` sets the compose project name.
- **`deploy.sh` `CHROMA_SERVER_VERSION` auto-determination** — `version` / `update` compare the RepoDigest of the chromadb container's image with (a) the digest pinned in the compose file, then (b) the Docker Hub digest of the pinned tag, and record the result in `.env`; when the value changed, mcp-server alone is recreated with `up -d`. When the version cannot be determined, an existing `.env` value is preserved (warning only) and `unknown` is written only when no value exists yet. A match on the Docker Hub `latest` tag alone is treated as undeterminable. The chroma CLI binary version and the server's hardcoded REST "1.0.0" are not used as evidence.
- **`deploy.sh backup`** — archives the chroma data to `backups/chromadb_data_<timestamp>.tar.gz` through a throwaway container with a read-only mount, so root-owned bind directories and named volumes both work. The data location is detected automatically: the existing chromadb container's `/data` mount (named volume or bind source) first, otherwise `CHROMA_DATA_PATH` (absolute, `./` or `../` path = bind mount; bare name, default `chroma-data` = compose named volume `<project>_<name>`). The archive is written as `.tar.gz.partial` and renamed on success, deleted on failure; chromadb is stopped and restarted only if it was running before the backup. `SIGINT`/`SIGTERM` during the backup remove the `.partial` file, restart chromadb when this backup stopped it, and exit with the conventional code 130/143; the signal traps are cleared once the backup finishes.
- **`deploy.sh` `DRY_RUN=1`** — prints every docker command prefixed `[DRY-RUN]`, calls no docker and changes no file (works without docker installed): `install` prints its plan without copying `.env` or creating `backups/`; `version` / `update` skip the digest judgment, the `.env` write and the mcp-server recreation. A missing `.env` is downgraded to a warning: the plan is printed from the committed `.env.example` / compose defaults and no file is created (without `DRY_RUN` a missing `.env` is still an error).
- **`deploy.sh` English/Korean output** — help and log messages follow `DEPLOY_LANG` (`en` or `ko`; environment, then `.env`), otherwise the first non-empty of `LC_ALL`, `LC_MESSAGES`, `LANG`: `ko*` selects Korean, anything else English.
- **`docker-compose.traefik.example.yml`** — optional example override that publishes the stack behind a Traefik reverse proxy; it holds no host specific values. Copy it to `docker-compose.traefik.yml`, set `COMPOSE_FILE=docker-compose.yml:docker-compose.traefik.yml` plus the required `TRAEFIK_HOST` and `TRAEFIK_CERT_RESOLVER` in `.env` (optional: `TRAEFIK_NETWORK` default `traefik`, `TRAEFIK_ENTRYPOINT` default `websecure`, `TRAEFIK_MIDDLEWARES` only read when the `middlewares` label is uncommented, `TRAEFIK_ROUTER_NAME` default `chromadb-mcp`), and run `./deploy.sh update`. The `middlewares` label is commented out by default; once you uncomment it, `TRAEFIK_MIDDLEWARES` is required — an unset variable and an empty value (`TRAEFIK_MIDDLEWARES=`) both abort with `required variable TRAEFIK_MIDDLEWARES is missing a value`, so to run without middlewares keep the label commented out. It drops the base file's host port mapping with `!reset` (requires Docker Compose 2.24+) and joins the external Traefik network. Traefik router/service names are global — pick a `TRAEFIK_ROUTER_NAME` no other container on that Traefik uses.
- **`.env.example`** — documents `COMPOSE_FILE`, `COMPOSE_PATH_SEPARATOR`, `COMPOSE_PROJECT_NAME`, `DEPLOY_LANG`, `MCP_IMAGE_TAG`, the `TRAEFIK_*` override variables (commented examples) and `OAUTH_PROXY_ALLOW_PRESHARED_CLIENT`.

### Changed

- **`docker-compose.yml` mcp-server image tag is now `${MCP_IMAGE_TAG:-latest}`** — `devsaurus/chromadb-remote-mcp:${MCP_IMAGE_TAG:-latest}`; unset keeps the previous `latest` behavior, set it in `.env` to pin a release.

### Fixed

- **`docker-compose.yml` now passes `CHROMA_REST_PROXY_ENABLED` and `OAUTH_PROXY_REDIRECT_URI_ALLOWLIST` through to the mcp-server container** — previously they were not forwarded, so the v2.2.3 hardening settings had no effect even when present in `.env`. When unset, the source defaults apply (REST proxy OFF, DCR disabled), so existing deployments behave exactly as before.

## [3.0.16] - 2026-10-22

### Added

- **`CHROMA_SERVER_VERSION`** — operator-declared Chroma server version. `chroma_get_server_version` and `/health/detail` report it as the trusted Chroma version; when unset they report "unknown" with provenance instead of guessing, because the Chroma Rust server hardcodes "1.0.0" on its version endpoints (chroma-core/chroma 1.5.9, rust/frontend/src/server.rs:647-654). `docker-compose.yml` passes `${CHROMA_SERVER_VERSION:-1.5.9}` — keep it in sync with the chromadb image pin.
- **`MCP_SERVER_VERSION`** — MCP wrapper version, baked into the image at build time: the release workflow passes the tag-derived `VERSION` build-arg → Dockerfile `ARG VERSION=dev` → `ENV MCP_SERVER_VERSION`. Builds without the build-arg report "dev"; `package.json` is intentionally not a source (frozen at "3.0.0").
- **`/health/detail` version reporting** — now includes `mcp_version`, `chroma_version`, and `chroma_version_server_reported`; the disconnected branch also reports `mcp_version`. The public `/health` endpoint stays `{status:"ok"}` per the minimal-exposure contract (R6.b, CVE-2026-45829).

### Changed

- **`chroma_get_server_version` now returns a JSON report** — previously a plain `Chroma server version: <raw>` sentence. The JSON string carries: `text` (the legacy sentence, preserved), `mcp_version` / `chroma_version` as `{value, source}` pairs with explicit provenance, `chroma_version_server_reported` (raw value from the server's version endpoint), and `chroma_version_server_reported_trusted` (false when the server reports the hardcoded "1.0.0" sentinel). **Consumers parsing the plain-text response must update.**
- **MCP `initialize` serverInfo.version** — now reports the `MCP_SERVER_VERSION` value (previously hardcoded "2.0.0").

### Fixed

- **CI fixes** — chromadb-version-check workflow: removed the monorepo `working-directory: packages/chromadb-remote-mcp` default that broke the standalone repo. CodeQL (Security Scan): added `setup-node` (26.12.1), required for TypeScript extraction. `yarn install --frozen-lockfile` → `--immutable` across the codecov / publish-release / security-scan workflows. Security Scan now also runs on main pushes.

### Security

- **brace-expansion lockfile refresh** — vulnerable versions 2.1.1 / 5.0.7 / 5.0.9 refreshed to 2.1.7 / 5.0.12 in `yarn.lock`.
- **TruffleHog pinned to a checksum-verified v3.99.3 binary** — replaces the floating `trufflesecurity/trufflehog@main` action (its docker bind mount breaks on DooD self-hosted runners). Scan range mirrors the action's event logic: push scans before..after (full history on new branches, skipped when the commits array is empty), pull_request scans base..head, schedule/dispatch scan full history.

## [3.0.15] - 2026-10-22

### Fixed

- **Non-string `documents` / `query_texts` elements are now rejected before embedding** — `chroma_add_documents` / `chroma_update_documents` / `chroma_upsert_documents` (`documents`) and `chroma_query_documents` (`query_texts`) validate that every array element is a string with the new `validateStringArray` helper and fail fast before `getCollection`, so the Gemini `embedContent` call never receives object-shaped input (previously an opaque upstream HTTP 400 — "Starting an object on a scalar field"). Adds 23 unit tests (`tests/unit/chroma-tools.string-array-guard.test.ts`, including the object-shaped documents payload).
- **TypeScript pinned to 6.x until TS7 support lands** — `ts-jest` (peer `<7`) and `typescript-eslint` (peer `<6.1.0`) cannot load the TS7 native compiler, so `typescript` is reverted to `^6.0.2` (from `^7.0.2`) and the `@typescript/typescript6` alias is dropped. Renovate now holds `typescript` major updates (`.github/renovate.json`).

### Changed

- **Dependency updates from Renovate/Dependabot (#98, #102~#104)** — non-major/patch updates: ip-address, yarn engines, node CI (#98); baseline-browser-mapping, browserslist, fast-uri, hono, js-yaml, protobufjs, qs, tar, undici (#102, 9 packages); `@typescript-eslint/*` `^8.71.1` → `^8.72.0`, dotenv, eslint, jose, ts-jest, etc. (#103, non-major); handlebars `4.7.9` → `4.7.10`, proxy-addr (#104).
- **Direct dependency commits (82aec87, 0782ca3)** — runtime: `dotenv` `^17.4.2` → `^18.0.7` (major), `@modelcontextprotocol/sdk` `^1.30.0` → `^1.32.1`, `express` `^5.2.1` → `^5.3.0`, `express-rate-limit` `^8.7.0` → `^8.7.1`; dev: `@types/node` `^22.20.3` → `^26.6.5` (major); `packageManager` yarn `4.18.0` → `4.18.1`.

## [3.0.0] - 2026-06-03

### Security

- **CVE-2026-45829 (ChromaToast) hardening** — pre-auth RCE in the ChromaDB Python FastAPI server (user-controlled embedding-function config + `trust_remote_code` + a malicious HuggingFace model, CVSS 10.0). This MCP gateway itself is not the vulnerable server, and tool-path RCE is already neutralized by chromadb JS SDK 3.4.3 (`serializeEmbeddingFunction` drops the plain JSON the MCP layer hands over as `{type:"legacy"}`, so the sync never fires), but this release removes the "conditional amplifier" surface formed by the combination of fail-open auth + unfiltered catch-all REST proxy + unpinned server images.

### BREAKING

- **Fail-closed boot authentication** — boot is refused regardless of `NODE_ENV` unless either an OIDC issuer (`OIDC_ISSUERS`/`OIDC_PRESET`) or `MCP_AUTH_TOKEN` is configured (the previous implicit dev fail-open is removed). Unauthenticated development is allowed only via the explicit `ALLOW_INSECURE_NO_AUTH=true` opt-in, and even then the `/api/*` REST proxy paths never fail open.
- **OIDC `audience` mandatory** — when an OIDC issuer is configured, `OIDC_AUDIENCE` (or `GOOGLE_OAUTH_CLIENT_ID` of OAuth proxy mode) is required, and boot fails otherwise. Previously, with audience unset, jose skipped `aud` verification, so tokens minted for other clients of the same issuer could pass.
- **Catch-all REST proxy disabled by default** — the ChromaDB REST passthrough is now mounted only when `CHROMA_REST_PROXY_ENABLED=true` (previously it was unconditionally enabled).

### Added

- **`ALLOW_INSECURE_NO_AUTH`** — explicit opt-in for unauthenticated development (REST proxy paths excluded).
- **`CHROMA_REST_PROXY_ENABLED`** (default OFF) — gate for the catch-all ChromaDB REST proxy. When enabled, the chain is: `validateOriginHeader` (DNS-rebind defense) → `oidcAuthMiddleware` (ignores the opt-in, always authenticates) → pathFilter (blocks collection create/mutate and `/embedding` paths) — strips `configuration.embedding_function` from the proxyReq body.
- **`OAUTH_PROXY_BASE_URL`** — mandatory canonical-URL pin when OAuth proxy is enabled. Ignores `X-Forwarded-Host` spoofing.
- **`OAUTH_PROXY_REDIRECT_URI_ALLOWLIST`** — exact-match allowlist (comma-separated) for DCR `redirect_uris`. Unset + proxy enabled → all DCR requests rejected.
- **Google OIDC `azp` check** — additionally compares the authorized-party claim of Google-issued tokens against the expected client id.
- **`GET /health/detail`** — detailed health behind auth (internal ChromaDB host:port, connection status).
- **`.github/workflows/chromadb-version-check.yml`** — CI fails if the ChromaDB server is in the vulnerable range (1.0.0–1.5.8) or the chromadb SDK is `< 3.4.3`.

### Changed

- **`chroma_modify_collection` metadata preservation** — client-supplied `metadata` is wrapped with `buildCollectionMetadata` to preserve the server-owned `embedding_provider`/`embedding_model`/`embedding_dimensions` keys (consistent with the create/get-or-create path). Clients can no longer bypass-change embedding metadata.
- **`GET /health` information minimized** — the unauthenticated response returns only `{status:"ok"}` (internal host:port not exposed). Details moved to `/health/detail` (auth required).
- **ChromaDB server image pin** — all 3 docker-compose files pin `chromadb/chroma:1.5.9@sha256:1e0b73a187a28757c572acba508c46f48c9e8b0acaf5c20e6d95cdedce1acdf6` (first stable release just above the CVE-affected range). `.env.example` documents the non-vulnerable minimum `CHROMADB_VERSION`.

### Migration

- **Deployments that ran unauthenticated will fail to boot.** Configure `MCP_AUTH_TOKEN` or OIDC (`OIDC_ISSUERS`/`OIDC_PRESET` + `OIDC_AUDIENCE`), or — trusted internal environments only — explicitly set `ALLOW_INSECURE_NO_AUTH=true`.
- If you were using the ChromaDB REST passthrough, you must now explicitly set `CHROMA_REST_PROXY_ENABLED=true`. Most use cases are covered by the MCP tools; keeping it disabled is recommended.
- OIDC users (e.g. `OIDC_PRESET=google`) must add `OIDC_AUDIENCE` to boot.
- `OAUTH_PROXY_ENABLED=true` users must configure `OAUTH_PROXY_BASE_URL` and `OAUTH_PROXY_REDIRECT_URI_ALLOWLIST`.

## [2.2.3] - 2026-05-15

### Fixed

- **Google `invalid_scope: offline_access` regression resolved** — v2.2.1 auto-appended the OIDC-standard `offline_access` scope, but **Google OAuth does not support this scope** (`Some requested scopes were invalid. invalid=[offline_access]`). v2.2.3 removes the auto-append — to receive a refresh_token from Google, `access_type=offline` + `prompt=consent` (both in effect since v2.2.1) is sufficient. The `OAUTH_PROXY_GOOGLE_SCOPES` env is also used exactly as the user specified.
- **`/.well-known/oauth-authorization-server` `scopes_supported`** — removed the `offline_access` auto-append. Advertises only the scopes Google actually accepts.

### Migration

- Users whose OAuth flow was blocked by `invalid_scope` on v2.2.1 / v2.2.2 work normally after deploying v2.2.3. No further action needed.
- refresh_token behaviour is unchanged — with the `access_type=offline` + `prompt=consent` combination, Google issues a refresh_token at first consent, and the client auto-refreshes on 1-hour expiry.

## [2.2.2] - 2026-05-15

### Fixed

- **OAuth proxy: authentication failure due to browser CORS blocking (`Failed to fetch`)** — browser clients such as Claude.ai / the Cloudflare AI dashboard (`dash.cloudflare.com`) were blocked with `Access to fetch ... blocked by CORS policy` when POSTing to `/oauth/token`. The v2.1.0 `validateOriginHeader` middleware only blocked/allowed origins and did not set CORS response headers (`Access-Control-Allow-Origin` etc.), so browsers could not unwrap the response itself.

### Added

- **`corsMiddleware`** (`src/index.ts`) — registered globally. Preflight (`OPTIONS`) is answered with 204 + allowed headers; actual requests get `Access-Control-Allow-Origin`, `-Methods`, `-Headers`, `-Expose-Headers`, `-Max-Age` echoed back. `Access-Control-Allow-Credentials` is not set (Bearer tokens, no cookies).
- **`getCorsAllowedOrigins()`** — computes the CORS-allowed origins. Defaults:
  - `https://claude.ai`
  - `https://api.anthropic.com`
  - `https://dash.cloudflare.com` (Cloudflare AI Gateway dashboard)
  - localhost (all ports)
  - comma-separated entries from the `ALLOWED_ORIGINS` env merged automatically (idempotent)

### Notes

- `validateOriginHeader` is kept as is — DNS rebinding defense + `/mcp` protection.
- 9 unit tests added (`tests/unit/index.test.ts` `corsMiddleware` describe).

## [2.2.1] - 2026-05-15

### Fixed

- **OAuth proxy: forced hourly re-authentication regression resolved** — Claude Desktop connectors (or any MCP client based on Google ID Tokens) using the v2.1.0 OAuth proxy had to go through the full OAuth flow again every hour. Six causes acted at once:
  - `authorize.ts`: `access_type=online` (Google does not issue a refresh_token) → **changed to `offline`**
  - `authorize.ts`: `prompt=select_account` (no refresh_token for returning users) → **changed to `consent`**
  - `authorize.ts`: `offline_access` missing from scopes → **auto-append** (idempotent join regardless of the override env var)
  - `register.ts` / `metadata.ts`: `refresh_token` not declared in the `grant_types` response → **extended to `["authorization_code", "refresh_token"]`**
  - `token.ts`: `grant_type=refresh_token` rejected (immediate `unsupported_grant_type` return) → **branch added: forwards to the Google `/token` and responds with a new id_token + rotated refresh_token**
  - `callback.ts` / `state-store.ts`: `refresh_token` from the Google response not stored → **new `AuthzCodeEntry.refresh_token?` field + included in the `/oauth/token` authorization_code response**

### Migration

- Upgrading from v2.1.x to v2.2.1 requires **one re-authentication** (the existing Google grant lacks `offline_access`). Afterwards the client auto-refreshes on 1-hour expiry, so no re-authentication is needed.
- Even when the `OAUTH_PROXY_GOOGLE_SCOPES` env var is explicitly set, `offline_access` is auto-appended (idempotent — no duplicate addition if already present).

## [2.2.0] - 2026-05-15

### New tools

- **`chroma_upsert_documents`** — add+update in one call without worrying about id conflicts.
- **`chroma_modify_collection`** — change collection name / metadata / index settings.
- **`chroma_get_or_create_collection`** — idempotent creation (retry-safe).
- **`chroma_heartbeat`** / **`chroma_get_server_version`** — server health check + version lookup.
- **`chroma_count_collections`** — total collection count (fast lookup without listing).
- **`chroma_get_max_batch_size`** — limit lookup for client-side batch splitting.
- **`chroma_get_user_identity`** — current tenant + databases.

### New — Distributed/Cloud only (opt-in guard)

Exposed only when `CHROMA_DISTRIBUTED_TOOLS_ENABLED=true`. The chromadb server's internal frontend executor is split into local / distributed, and all 4 methods below are implemented only in the distributed executor, so the single-node open-source server (`chromadb/chroma:latest`) does not support them. Works only on Chroma Cloud or self-hosted distributed Chroma deployments. Hidden by default on single nodes to avoid LLM retry loops / context waste:

- **`chroma_search`** — dense + sparse hybrid search (ChromaDB 3.x SearchLike).
- **`chroma_fork_collection`** / **`chroma_get_fork_count`** — zero-copy fork + fork count lookup.
- **`chroma_get_indexing_status`** — visibility into WAL / indexing progress.

### New — Admin (multi-tenant, opt-in)

Exposed only when `CHROMA_ADMIN_TOOLS_ENABLED=true`:

- **`chroma_admin_create_database`** / **`chroma_admin_get_database`** / **`chroma_admin_list_databases`**
- **`chroma_admin_create_tenant`** / **`chroma_admin_get_tenant`**

### New — Dangerous operations (opt-in guard)

Exposed only when `CHROMA_ALLOW_DESTRUCTIVE_OPS=true`. Prints a `[DESTRUCTIVE]` audit line on invocation:

- **`chroma_reset_database`** — reset of the entire DB (irreversible).
- **`chroma_admin_delete_database`** — delete an admin DB (requires both the admin and destructive env vars).

### Changed — existing tool schema extensions (compatibility preserved)

- **`chroma_delete_documents`** — added `where` / `where_document` / `limit`. Allows deletion by metadata filter alone, in addition to ids alone.
- **`chroma_create_collection`** — added `configuration` (HNSW/SPANN) and `schema`.
- **`chroma_add_documents`** / **`chroma_update_documents`** — added `uris` (multimodal). update also exposes `embeddings` in its schema.
- **`chroma_query_documents`** — added `query_uris` and `ids` (pre-filter).
- **`chroma_get_documents`** / **`chroma_get_collection_count`** — added the `read_level` enum (`INDEX_AND_WAL` / `INDEX_ONLY`).
- **`chroma_list_collections`** — explicit `limit` / `offset` defaults (default 100 / 0).

### Environment variables

- `CHROMA_ADMIN_TOOLS_ENABLED` (default `false`) — enables the admin tool group.
- `CHROMA_ALLOW_DESTRUCTIVE_OPS` (default `false`) — enables dangerous operations.
- `CHROMA_DISTRIBUTED_TOOLS_ENABLED` (default `false`) — enables distributed-only tools (unsupported on a single node).

## [2.1.2] - 2026-05-14

### Fixed

- **`chroma_update_documents` silent pass on missing ids** — regression where an update for a non-existent id passed without error on the ChromaDB SDK side. Existence is verified with `collection.get({ids})` immediately before the call, and any missing id returns an explicit error response (R12).
- **`chroma_delete_collection` false-error after successful delete** — regression where the ChromaDB v2 SDK's `deleteCollection` threw during response parsing even after a successful delete (the deletion itself succeeded). The actual state is checked with `listCollections` for silent recovery — only genuine failures propagate the throw (R13).

## [2.1.1] - 2026-05-14

### Fixed

- **Claude Desktop Connectors handshake at root path** — `POST /` (path-less Connector URL) now routes through the MCP handler chain (`validateProtocolVersion` → `validateOriginHeader` → `oidcAuthMiddleware` → `mcpHandler`) instead of being captured by the catch-all ChromaDB proxy. Users who registered `https://<host>` (without `/mcp`) no longer hit a silent handshake failure (R2).
- **`chroma_update_documents` embedding dimension mismatch** — the update handler used to call `collection.update({ids, documents, metadatas})` without explicit `embeddings`, causing the ChromaDB SDK to fall back to its default 384d embedding function (`all-MiniLM-L6-v2`) and break collections that use other providers (e.g. `gemini-embedding-001` at 1536d → `Embedding dimension 384 expected, got 1536`). The handler now mirrors `chroma_add_documents`: resolves the per-collection provider config, computes embeddings server-side when applicable, and passes them to `collection.update`. Metadata-only updates (no `documents`) skip embedding recomputation and preserve the existing vectors. External-provider mode requires pre-computed `embeddings`, mirroring add (R11).
- **LibreChat-style pre-shared `client_id` is now accepted** — when `OAUTH_PROXY_ALLOW_PRESHARED_CLIENT=true` and the requested `client_id` equals `GOOGLE_OAUTH_CLIENT_ID`, `/oauth/authorize` and `/oauth/token` accept the request as an ephemeral pre-registered client. PKCE (S256 + `code_verifier`) and `redirect_uri` consistency remain mandatory; the flag is opt-in (default off) so DCR clients are unaffected (R3, E2).
- **`OIDC_AUDIENCE` automatically falls back to `GOOGLE_OAUTH_CLIENT_ID` when OAuth Proxy is enabled** — Google ID tokens always carry `aud == client_id`, so requiring both env vars to be set was redundant. With `OAUTH_PROXY_ENABLED=true` the verifier now uses `GOOGLE_OAUTH_CLIENT_ID` as the audience when `OIDC_AUDIENCE` is unset; explicit `OIDC_AUDIENCE` still wins, and OAuth Proxy off keeps v2.0.0 behaviour byte-identical (R4).
- **Banner version is no longer hardcoded to `v2.0.0`** — the startup banner now reads `package.json#version` at startup (`readFileSync`-based, build/start-safe) and prints the actual release tag (R6).

### Changed

- **`resolveResourceBaseUrl` honours `OAUTH_PROXY_BASE_URL` first** — when the env var is set, the protected-resource metadata returns it verbatim (trailing slash stripped). The previous `X-Forwarded-Proto` / `X-Forwarded-Host` / `req.headers.host` fallback chain is preserved when the env is unset, so OAuth-Proxy-off deployments are unchanged. This fixes a regression where Caddy without `X-Forwarded-Proto` exposed a plain-`http://` resource that OAuth 2.1 clients refused (R5).
- **New env: `OAUTH_PROXY_ALLOW_PRESHARED_CLIENT`** — boolean opt-in flag for the pre-shared `client_id` fallback above. Default `false`. Propagated through `docker-compose.yml` / `docker-compose.dev.yml` (E2).

### Migration

- **`docker-compose.yml` / `docker-compose.dev.yml` now propagate the v2.1.0 OAuth-Proxy env block** (`OAUTH_PROXY_ENABLED`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `OAUTH_PROXY_BASE_URL`, `OAUTH_PROXY_GOOGLE_SCOPES`, `OAUTH_PROXY_STORE_MAX`) plus the new v2.1.1 `OAUTH_PROXY_ALLOW_PRESHARED_CLIENT`. Operators who manually patched their compose file in v2.1.0 can drop those local additions (R1, R10).

## [2.1.0] - 2026-05-13

### Added

- **Embedded OAuth 2.1 Authorization Server proxy for Google IdP** (`OAUTH_PROXY_ENABLED=true`) — the server now exposes `/oauth/{register,authorize,callback,token}` plus `/.well-known/oauth-authorization-server` (RFC 8414), so MCP clients (Claude Desktop / Claude.ai Connectors, mcp-remote, ...) that rely on Dynamic Client Registration (RFC 7591) can authenticate against Google without a pre-issued client_id. Google itself does not support DCR; the proxy fills that gap.
- **Dynamic Client Registration** (`POST /oauth/register`) — issues a public client_id with `token_endpoint_auth_method: "none"` and PKCE-required (R1).
- **PKCE S256 mandatory** — `code_challenge` + `code_challenge_method=S256` are required at `/oauth/authorize`; `code_verifier` is validated at `/oauth/token` (R5).
- **Google id_token passthrough** — `/oauth/token` returns the Google `id_token` byte-identical (no re-signing); the existing OIDC verifier validates `iss=accounts.google.com` + `aud=GOOGLE_OAUTH_CLIENT_ID` (R6).
- **`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`** — server-side credentials used to perform the actual code → id_token exchange with Google (R3).
- **`OAUTH_PROXY_BASE_URL`** — explicit issuer/base URL override for environments where `X-Forwarded-Proto` is stripped (E1).
- **`OAUTH_PROXY_GOOGLE_SCOPES`** — scope override for the Google authorize redirect (default `openid email profile`) (E4).
- **`OAUTH_PROXY_STORE_MAX`** — per-store size cap with oldest-expires-first eviction (default 10000) (E3).

### Changed

- **`/.well-known/oauth-protected-resource`** — when `OAUTH_PROXY_ENABLED=true`, the `authorization_servers` field now points at the MCP server itself rather than `https://accounts.google.com`. This is what makes the DCR flow work end to end. With the flag off, behaviour is byte-identical to v2.0.0 (R8, R10).
- **`validateEnvironmentVariables`** — fails fast at boot when `OAUTH_PROXY_ENABLED=true` but `GOOGLE_OAUTH_CLIENT_ID` or `GOOGLE_OAUTH_CLIENT_SECRET` is missing (R3).

### Security

- **Secrets never logged** — `client_secret`, `code_verifier`, `id_token`, and `GOOGLE_OAUTH_CLIENT_SECRET` are excluded from all logging paths in the oauth-proxy module (R14).
- **Rate limiting** — all 5 oauth-proxy endpoints sit behind the existing global `limiter`, with `Retry-After` on 429 (R13).
- **State / code one-shot consumption** — `consumeAuthzState` and `consumeAuthzCode` remove entries on first read; replay returns `invalid_grant` / `invalid_state` (R5).
- **In-memory TTL ≤ 10 min** — `TTL_SEC=600` for state/code/client stores (R5).

### Compatibility

- `OAUTH_PROXY_ENABLED` is opt-in (default off). Existing v2.0.0 deployments using `OIDC_PRESET=google` + `Authorization: Bearer <google_id_token>` (clients that handle OAuth themselves) continue to work unchanged (R7, R8).

## [2.0.0] - 2026-05-13

### Breaking changes

- **Collection metadata schema v2** — All new collections persist `embedding_provider`, `embedding_model`, `embedding_dimensions` in metadata. Existing v1 collections fail with `Embedding provider mismatch` on read/write. Set `LEGACY_COLLECTION_COMPAT=true` to allow read-only access to v1 collections, or re-index per `MIGRATION.md`.
- **Default embedding behaviour** — Previous releases silently used ChromaDB's built-in `all-MiniLM-L6-v2` (English-only, 384 dim). v2 emits a startup warning when `EMBEDDING_PROVIDER` is unset and the default is in use.
- **Authentication — `Authorization: Bearer` only** — `/mcp` and the catch-all REST proxy now go through the OIDC-aware middleware. Previously supported `X-Chroma-Token` header and `?apiKey=` / `?token=` / `?api_key=` query-parameter auth paths are removed. `MCP_AUTH_TOKEN` continues to work as a service-to-service credential and must be sent as `Authorization: Bearer <token>`. OAuth 2.1 OIDC is the recommended path for human users.
- **Removed env** — `ALLOW_QUERY_AUTH` is no longer read by the server; the startup banner no longer displays `Query Auth`. Existing values are silently ignored.

### Added

- **Embedding provider abstraction** (`src/embedding/`) — pluggable providers selected by `EMBEDDING_PROVIDER`:
  - `chromadb-default` — built-in `all-MiniLM-L6-v2` (English-only fallback)
  - `external` — caller supplies pre-computed embeddings via tool arguments
  - `openai_compatible` — any `/v1/embeddings` endpoint (OpenAI, Together, Ollama, TEI, vLLM)
  - `gemini` — Google AI Studio Embedding API (`gemini-embedding-001`) with task_type split (`RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`) and Matryoshka dimensions (768/1536/3072)
  - `voyage` — Voyage AI `/v1/embeddings` with `input_type` query/document split and `output_dimension` (voyage-3 / voyage-3-large / voyage-3.5)
- **External embedding mode** — `chroma_add_documents` accepts `embeddings`; `chroma_query_documents` accepts `query_embeddings`. Server validates dimensions against collection metadata.
- **Per-collection provider override** — collection metadata with explicit `embedding_provider`/`embedding_model`/`embedding_dimensions` overrides the server default for that collection only.
- **Confidence gating** — `chroma_query_documents` gains `min_score` (0-1); items below the similarity threshold are dropped, and a `confidence_gate: "no_confident_match"` flag is emitted when every result is filtered. Default sourced from `CONFIDENCE_THRESHOLD`.
- **Reranker layer (fail-soft)** — `chroma_query_documents` gains `rerank` / `rerank_top_n` / `rerank_top_k`. Reranker is contacted via `RERANKER_API_BASE` (OpenAI-compatible `/rerank`). All failures (timeout, HTTP error, missing config) degrade silently to original ordering.
- **OAuth 2.1 OIDC multi-provider** — `OIDC_ISSUERS` (comma-separated) or `OIDC_PRESET=google,github,microsoft`. Verifies signature (RS256/ES256/EdDSA), `iss`, `aud` (`OIDC_AUDIENCE`), `exp`, `nbf/iat` (60s clock skew). JWKS auto-discovered via `/.well-known/openid-configuration` and cached for 1 h (rotation-safe).
- **RFC 9728 Protected Resource Metadata** — `GET /.well-known/oauth-protected-resource` returns `resource`, `authorization_servers`, `bearer_methods_supported`, `scopes_supported`. 401 responses include `resource_metadata=` in `WWW-Authenticate` and use the correct RFC 6750 `error=` parameter (`invalid_request` / `invalid_token` / `insufficient_scope`).
- **User identity logging** — authenticated requests log the `sub` claim hashed (SHA-256 first 12 chars) by default, raw with `OIDC_LOG_SUB_MODE=full`.
- **`MIGRATION.md`** — step-by-step v1 → v2 guide in Korean and English.

### Dependencies

- Added `jose@^6.1.3` (JWT verification).

### Fixed

- `docker-compose.yml` and `docker-compose.dev.yml` now propagate every v2.0.0 env var (`EMBEDDING_*`, `GEMINI_API_KEY`, `CONFIDENCE_THRESHOLD`, `RERANKER_*`, `OIDC_*`, `LEGACY_COLLECTION_COMPAT`) to the `mcp-server` container.
- `package.json` `jose` constraint matches `yarn.lock` (`^6.1.3`); previously the lockfile resolved `6.2.2` while the manifest pinned `^5.9.0`, making `yarn install --immutable` (and therefore the Docker build) fail.
- `chroma_query_documents` / `chroma_add_documents` short-circuit with a friendly error when the active provider is `external` but the caller passed `query_texts` / `documents` only. Previously the ChromaDB v3 client transparently default-embedded the text (384d), leaking the internal ChromaDB host and collection UUID through the dimension-mismatch error.
- Read/write tool branches now use `chromaClient.getCollection({ name })` instead of `getOrCreateCollection(...)`. v1.x silently created orphan collections with server-default v2 metadata when callers asked to read or write to a non-existent collection.
- `WWW-Authenticate` header's `error_description` parameter and the JSON body's `error_description` field now carry the same text. Previously the header transformed inner `"` to `'`, producing two different strings for the same error.

## [1.0.2] - 2025-10-31
- fix(security): configure CodeQL to suppress log injection warnings [#d7365c1](https://github.com/meloncafe/chromadb-remote-mcp/commit/d7365c16498bc0856b2e7728c8a399f6dee4844d)
- fix(security): enhance log sanitization to resolve CodeQL warnings [#d3eb3ec](https://github.com/meloncafe/chromadb-remote-mcp/commit/d3eb3ecdc140614264d2a10c1daab534f94baa3a)
- [ci: update .deepsource.toml by @deepsource-autofix[bot]](https://github.com/meloncafe/chromadb-remote-mcp/pull/9)
- [Potential fix for code scanning alert no. 12: Log injection by @meloncafe](https://github.com/meloncafe/chromadb-remote-mcp/pull/8)
- [Potential fix for code scanning alert no. 6: Log injection by @meloncafe](https://github.com/meloncafe/chromadb-remote-mcp/pull/10)
- [chore(style): update MseeP.ai badge to shields.io format by @meloncafe](https://github.com/meloncafe/chromadb-remote-mcp/pull/13)
- [Add MseeP.ai badge by @lwsinclair](https://github.com/meloncafe/chromadb-remote-mcp/pull/12)
- [chore(deps): bump tar from 7.5.1 to 7.5.2 in the npm_and_yarn group across 1 directory by @dependabot[bot]](https://github.com/meloncafe/chromadb-remote-mcp/pull/14)

## [1.0.1] - 2025-10-26

- fix(docs): update installation scripts by @meloncafe in #3
- fix(docker): update volume path in docker-compose files to use /data by @meloncafe in #4
- feat(docker): add MCP Register Label to Dockerfile by @meloncafe in #5

## [1.0.0] - 2025-10-25

### Added

#### Core Features

- Remote MCP server with Streamable HTTP transport (2025-03-26 spec)
- ChromaDB integration with complete CRUD operations via MCP tools
- REST API proxy for direct ChromaDB access from Python/JavaScript clients
- Cross-platform support for Claude Desktop, Mobile, and Code

#### MCP Tools

- Collection management:

  - `chroma_list_collections`
  - `chroma_create_collection`
  - `chroma_delete_collection`
  - `chroma_get_collection_info`
  - `chroma_get_collection_count`
  - `chroma_peek_collection`

- Document operations:
  - `chroma_add_documents`
  - `chroma_query_documents`
  - `chroma_get_documents`
  - `chroma_update_documents`
  - `chroma_delete_documents`

#### Security

- Unified authentication system with three methods: Bearer token, X-Chroma-Token header, query parameter
- Rate limiting (100 requests per 15 minutes per IP, configurable)
- Strict Content Security Policy (CSP) with XSS and code injection protection
- Security headers: X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS
- DNS rebinding attack prevention with Origin header validation
- Timing-safe token comparison to prevent timing attacks
- Log injection prevention with ANSI escape sequence filtering

#### Deployment

- One-command automated installation script
- Docker Compose configuration for production and development
- Multi-platform Docker images (linux/amd64, linux/arm64)
- Supply Chain Attestation (SBOM and Provenance) via Docker Scout
- GitHub Actions CI/CD pipeline with automated release workflow

#### Documentation

- [README](README.md) in English and Korean
- [Security Policy](SECURITY.md) in English and Korean
- [Contributing Guidelines](CONTRIBUTING.md) in English and Korean
- [Code of Conduct](CODE_OF_CONDUCT.md) in English and Korean

#### Testing & Quality

- Unit tests with 83% code coverage
- Real validation logic
- TypeScript strict mode with full type safety
- Automated security scanning (DeepSource, CodeQL, Dependabot, Docker Scout)

### Security

- Resolved all OWASP and CWE security findings (DeepSource verified)
- Achieved Docker Scout 8/8 compliance
- Zero active vulnerabilities in dependencies

[Unreleased]: https://github.com/meloncafe/chromadb-remote-mcp/compare/v3.0.16...HEAD
[3.0.16]: https://github.com/meloncafe/chromadb-remote-mcp/compare/v3.0.15...v3.0.16
[3.0.15]: https://github.com/meloncafe/chromadb-remote-mcp/compare/v3.0.14...v3.0.15
[1.0.2]: https://github.com/meloncafe/chromadb-remote-mcp/releases/tag/v1.0.2
[1.0.1]: https://github.com/meloncafe/chromadb-remote-mcp/releases/tag/v1.0.1
[1.0.0]: https://github.com/meloncafe/chromadb-remote-mcp/releases/tag/v1.0.0