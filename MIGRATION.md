# Migration Guide: v1.x → v2.0

This release introduces a breaking collection metadata schema, configurable embedding providers, OAuth 2.1 OIDC authentication, optional reranking and confidence gating. Follow the steps for your language below.

---

## 한국어

### 한 줄 요약

v2.0 은 컬렉션 메타데이터 스키마 v2 와 OAuth 인증, 다중 임베딩 provider 를 도입합니다. **기존 컬렉션은 재인덱싱이 필요**합니다.

### 1. 호환성 옵션 검토 (재인덱싱이 어려울 때)

`LEGACY_COLLECTION_COMPAT=true` 를 설정하면 v1 컬렉션을 **읽기 전용**으로 계속 사용할 수 있습니다. 쓰기 (`chroma_add_documents` / `chroma_update_documents` / `chroma_delete_documents`) 는 거부됩니다. 새 컬렉션은 자동으로 v2 스키마로 생성됩니다.

### 2. 임베딩 provider 선택

| 환경 | 추천 provider | 설정 변수 |
|------|--------------|----------|
| 한국어 + 영어 혼재 | `gemini` | `GEMINI_API_KEY`, `EMBEDDING_MODEL=gemini-embedding-001`, `EMBEDDING_DIMENSIONS=1536` |
| 한국어 가성비 / 비대칭 query↔document | `voyage` | `EMBEDDING_API_KEY` (Voyage), `EMBEDDING_API_BASE=https://api.voyageai.com`, `EMBEDDING_MODEL=voyage-3`, `EMBEDDING_DIMENSIONS=1024` |
| 자체 호스팅 (Ollama / TEI / vLLM) | `openai_compatible` | `EMBEDDING_API_BASE`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` |
| 클라이언트 사전 계산 | `external` | `EMBEDDING_DIMENSIONS`, `EMBEDDING_MODEL` (식별자) |
| 시험용 (영어 전용) | unset / `chromadb-default` | — |

### 3. 기존 컬렉션 초기화

가장 단순한 경로:

```bash
docker compose down
docker volume rm chromadb-remote-mcp_chroma-data
docker compose up -d
```

또는 컬렉션을 하나씩 삭제하는 경우 MCP 클라이언트에서 `chroma_delete_collection` 호출. 재인덱싱은 새 provider 설정 하에서 `chroma_add_documents` 로 재수행.

### 4. OAuth 인증 설정

| 변수 | 용도 |
|------|------|
| `OIDC_ISSUERS` | issuer URL 목록 (콤마 구분). 예: `https://accounts.google.com` |
| `OIDC_PRESET` | `google,github,microsoft` 중 콤마 구분 (편의용) |
| `OIDC_AUDIENCE` | 검증할 `aud` claim |
| `MCP_AUTH_TOKEN` | 서비스간 / CI / 내부 스크립트 전용. 사람 사용자는 OAuth 사용 권장. |

`OIDC_ISSUERS` 와 `MCP_AUTH_TOKEN` 둘 다 미설정이면 dev 모드 경고와 함께 인증 없이 통과합니다.

### 5. 트러블슈팅

- **`Error: Embedding provider mismatch` — v1 컬렉션** → `LEGACY_COLLECTION_COMPAT=true` 설정하거나 컬렉션 재인덱싱.
- **`GeminiProvider: GEMINI_API_KEY is required`** → `.env` 에 `GEMINI_API_KEY` 추가.
- **`401 Unauthorized` + `WWW-Authenticate: ..., error="invalid_token"`** → 토큰의 `iss`/`aud`/`exp` 가 서버 설정과 일치하는지 확인.
- **Reranker 호출이 무시됨** → `RERANKER_API_BASE` 가 설정됐는지, `rerank: true` 인자가 query 호출에 포함됐는지 확인. fail-soft 이므로 reranker 장애가 query 실패로 이어지지 않습니다.

---

## English

### TL;DR

v2.0 introduces collection metadata schema v2, OAuth, and pluggable embedding providers. **Existing collections must be re-indexed.**

### 1. Compatibility flag (when re-indexing is hard)

Set `LEGACY_COLLECTION_COMPAT=true` to keep v1 collections **read-only**. Writes (`chroma_add_documents` / `chroma_update_documents` / `chroma_delete_documents`) are rejected. New collections are created with the v2 schema automatically.

### 2. Pick an embedding provider

| Environment | Recommended provider | Env vars |
|-------------|---------------------|----------|
| Mixed Korean + English / cross-lingual | `gemini` | `GEMINI_API_KEY`, `EMBEDDING_MODEL=gemini-embedding-001`, `EMBEDDING_DIMENSIONS=1536` |
| Korean cost-efficient / asymmetric query↔document | `voyage` | `EMBEDDING_API_KEY` (Voyage), `EMBEDDING_API_BASE=https://api.voyageai.com`, `EMBEDDING_MODEL=voyage-3`, `EMBEDDING_DIMENSIONS=1024` |
| Self-hosted (Ollama / TEI / vLLM) | `openai_compatible` | `EMBEDDING_API_BASE`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` |
| Client-side pre-computed | `external` | `EMBEDDING_DIMENSIONS`, `EMBEDDING_MODEL` (identifier) |
| Experimental (English only) | unset / `chromadb-default` | — |

### 3. Reset existing collections

Simplest path:

```bash
docker compose down
docker volume rm chromadb-remote-mcp_chroma-data
docker compose up -d
```

Or call `chroma_delete_collection` for each collection from your MCP client, then re-index via `chroma_add_documents` under the new provider config.

### 4. OAuth setup

| Variable | Purpose |
|----------|---------|
| `OIDC_ISSUERS` | Comma-separated issuer URLs (e.g. `https://accounts.google.com`) |
| `OIDC_PRESET` | Convenience names: `google,github,microsoft` |
| `OIDC_AUDIENCE` | Expected `aud` claim |
| `MCP_AUTH_TOKEN` | Service-to-service / CI / internal scripts. Use OAuth for human users. |

If neither `OIDC_ISSUERS` nor `MCP_AUTH_TOKEN` is set, the server logs a dev warning and accepts unauthenticated requests.

### 5. Troubleshooting

- **`Error: Embedding provider mismatch` on v1 collection** — Set `LEGACY_COLLECTION_COMPAT=true` or re-index.
- **`GeminiProvider: GEMINI_API_KEY is required`** — Add `GEMINI_API_KEY` to `.env`.
- **`401 Unauthorized` with `WWW-Authenticate: ..., error="invalid_token"`** — Verify the token's `iss`/`aud`/`exp` match the server configuration.
- **Reranker calls appear ignored** — Confirm `RERANKER_API_BASE` is set and `rerank: true` is passed in the query arguments. Reranker is fail-soft; outages never break query requests.