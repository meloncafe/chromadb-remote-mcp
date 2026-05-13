# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
