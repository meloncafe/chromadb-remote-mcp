# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.2.0] - 2026-05-15

### 신규 도구

- **`chroma_upsert_documents`** — id 충돌 신경 안 쓰고 한 번에 add+update.
- **`chroma_modify_collection`** — 컬렉션 이름 / 메타 / 인덱스 설정 변경.
- **`chroma_get_or_create_collection`** — 멱등 생성 (재시도 안전).
- **`chroma_heartbeat`** / **`chroma_get_server_version`** — 서버 헬스체크 + 버전 확인.
- **`chroma_count_collections`** — 컬렉션 총 개수 (list 없이 빠른 조회).
- **`chroma_get_max_batch_size`** — 클라이언트 배치 분할용 한도 조회.
- **`chroma_get_user_identity`** — 현재 tenant + databases.

### 신규 — Distributed/Cloud 전용 (opt-in 가드)

`CHROMA_DISTRIBUTED_TOOLS_ENABLED=true` 일 때만 노출. chromadb 서버 내부 frontend executor 가 local / distributed 로 분리되어 있고 아래 4 개 메서드 모두 distributed executor 에만 구현되어 있어, 단일 노드 open-source 서버 (`chromadb/chroma:latest`) 에서는 미지원. Chroma Cloud 또는 self-hosted distributed Chroma 배포에서만 동작. 단일 노드에서는 LLM 의 retry 루프 / 컨텍스트 낭비 회피를 위해 기본 숨김:

- **`chroma_search`** — dense + sparse 하이브리드 검색 (ChromaDB 3.x SearchLike).
- **`chroma_fork_collection`** / **`chroma_get_fork_count`** — zero-copy fork + 포크 수 조회.
- **`chroma_get_indexing_status`** — WAL / 인덱스 진행 상황 가시화.

### 신규 — Admin (멀티테넌트, opt-in)

`CHROMA_ADMIN_TOOLS_ENABLED=true` 일 때만 노출:

- **`chroma_admin_create_database`** / **`chroma_admin_get_database`** / **`chroma_admin_list_databases`**
- **`chroma_admin_create_tenant`** / **`chroma_admin_get_tenant`**

### 신규 — 위험 작업 (opt-in 가드)

`CHROMA_ALLOW_DESTRUCTIVE_OPS=true` 일 때만 노출. 호출 시 `[DESTRUCTIVE]` 감사 라인 출력:

- **`chroma_reset_database`** — 전체 DB 리셋 (irreversible).
- **`chroma_admin_delete_database`** — admin DB 삭제 (admin + destructive 두 env 모두 필요).

### 변경 — 기존 도구 schema 확장 (호환성 유지)

- **`chroma_delete_documents`** — `where` / `where_document` / `limit` 추가. ids 단독 외에 메타필터 단독 삭제 허용.
- **`chroma_create_collection`** — `configuration` (HNSW/SPANN), `schema` 추가.
- **`chroma_add_documents`** / **`chroma_update_documents`** — `uris` 추가 (멀티모달). update 는 `embeddings` 도 schema 노출.
- **`chroma_query_documents`** — `query_uris`, `ids` (사전 필터) 추가.
- **`chroma_get_documents`** / **`chroma_get_collection_count`** — `read_level` enum (`INDEX_AND_WAL` / `INDEX_ONLY`) 추가.
- **`chroma_list_collections`** — `limit`, `offset` 기본값 명시 (default 100 / 0).

### 환경 변수

- `CHROMA_ADMIN_TOOLS_ENABLED` (기본 `false`) — admin 도구 그룹 활성화.
- `CHROMA_ALLOW_DESTRUCTIVE_OPS` (기본 `false`) — 위험 작업 활성화.
- `CHROMA_DISTRIBUTED_TOOLS_ENABLED` (기본 `false`) — distributed 전용 도구 활성화 (단일 노드 미지원).

## [2.1.2] - 2026-05-14

### Fixed

- **`chroma_update_documents` silent pass on missing ids** — 존재하지 않는 id 에 대한 update 가 ChromaDB SDK 측에서 에러 없이 통과하던 회귀. 호출 직전에 `collection.get({ids})` 로 존재 검증하여 누락 id 가 있으면 명시적 에러 응답 반환 (R12).
- **`chroma_delete_collection` false-error after successful delete** — ChromaDB v2 SDK 의 `deleteCollection` 이 정상 삭제 후에도 응답 파싱에서 throw 하던 회귀 (실제 삭제는 성공). `listCollections` 로 실제 상태를 확인하여 silent recovery — 진짜 실패만 throw 전파 (R13).

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

[Unreleased]: https://github.com/meloncafe/chromadb-remote-mcp/compare/v1.0.0...HEAD
[1.0.2]: https://github.com/meloncafe/chromadb-remote-mcp/releases/tag/v1.0.2
[1.0.1]: https://github.com/meloncafe/chromadb-remote-mcp/releases/tag/v1.0.1
[1.0.0]: https://github.com/meloncafe/chromadb-remote-mcp/releases/tag/v1.0.0