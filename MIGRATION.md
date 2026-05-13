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

---

## 한국어 — v2.0 → v2.1

### 한 줄 요약

v2.1 은 Google IdP 와 호환되는 **내장 OAuth 2.1 Authorization Server proxy** 를 추가합니다. Claude Desktop / Claude.ai Connectors 처럼 RFC 7591 Dynamic Client Registration 을 시도하는 클라이언트가 별도 client_id 입력 없이 동작합니다.

### 1. 활성화 여부 결정

- **기존 동작 유지**: `OAUTH_PROXY_ENABLED` 미설정. v2.0 동작과 완전히 동일.
- **Google OAuth proxy 활성화**: `OAUTH_PROXY_ENABLED=true` + Google credentials 추가.

활성 시:
- `/.well-known/oauth-protected-resource` 의 `authorization_servers` 가 server 자체 URL 로 변경됩니다 (Google 이 아닌).
- 신규 endpoint 5개 노출: `/oauth/{register,authorize,callback,token}`, `/.well-known/oauth-authorization-server`.

### 2. Google Cloud Console 설정

1. https://console.cloud.google.com/apis/credentials → OAuth 2.0 Client ID 생성 (Web application).
2. **Authorized redirect URIs** 에 다음을 등록:
   - `https://<your-mcp-server>/oauth/callback`
3. 발급된 **Client ID** + **Client Secret** 을 `.env` 에 추가:
   ```
   OAUTH_PROXY_ENABLED=true
   GOOGLE_OAUTH_CLIENT_ID=<client-id>.apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=<client-secret>
   OIDC_AUDIENCE=<client-id>.apps.googleusercontent.com
   OIDC_PRESET=google
   ```

### 3. 옵션 환경변수

- `OAUTH_PROXY_BASE_URL` — issuer/endpoint 의 base URL override (예: 프록시가 X-Forwarded-Proto 를 안 보낼 때).
- `OAUTH_PROXY_GOOGLE_SCOPES` — Google authorize 의 scope. 기본 `openid email profile`.
- `OAUTH_PROXY_STORE_MAX` — 메모리 store 최대 항목 수. 기본 10000.

### 4. 클라이언트 측

Claude Desktop / Claude.ai Connectors 등 OAuth 2.1 DCR 지원 클라이언트는 server URL 만 입력하면 자동으로 다음 흐름이 동작합니다: 메타데이터 조회 → DCR → Google 로그인 → callback → token.

`MCP_AUTH_TOKEN` 경로는 그대로 유지되며 (서비스 계정 / CI / Bearer 헤더 직접 사용 클라이언트) Google OAuth proxy 와 병용 가능합니다.

### 5. 트러블슈팅

- **`GOOGLE_OAUTH_CLIENT_ID is required when OAUTH_PROXY_ENABLED=true`** — `.env` 에 Google credentials 가 빠짐.
- **Google 로그인 화면이 안 뜨고 즉시 실패** — Authorized redirect URI 가 Google Cloud Console 에 등록되지 않았음. `<self base URL>/oauth/callback` 정확히 등록.
- **`invalid_grant` on `/oauth/token`** — code 가 만료됐거나 (TTL 10분) 이미 사용됨. 또는 `code_verifier` 가 일치하지 않음.

---

## English — v2.0 → v2.1

### TL;DR

v2.1 ships an **embedded OAuth 2.1 Authorization Server proxy** that handles Google login for clients that expect RFC 7591 Dynamic Client Registration (Claude Desktop / Claude.ai Connectors). Google itself doesn't support DCR; the proxy fills that gap.

### 1. Decide whether to enable

- **Keep v2.0 behaviour**: leave `OAUTH_PROXY_ENABLED` unset.
- **Enable Google OAuth proxy**: set `OAUTH_PROXY_ENABLED=true` and supply Google credentials.

When enabled:
- `/.well-known/oauth-protected-resource` advertises *this server* as the authorization server (not `accounts.google.com`).
- Five new endpoints become live: `/oauth/{register,authorize,callback,token}` and `/.well-known/oauth-authorization-server`.

### 2. Google Cloud Console setup

1. https://console.cloud.google.com/apis/credentials → create an OAuth 2.0 Client ID (Web application).
2. Add to **Authorized redirect URIs**:
   - `https://<your-mcp-server>/oauth/callback`
3. Copy the issued **Client ID** + **Client Secret** to `.env`:
   ```
   OAUTH_PROXY_ENABLED=true
   GOOGLE_OAUTH_CLIENT_ID=<client-id>.apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=<client-secret>
   OIDC_AUDIENCE=<client-id>.apps.googleusercontent.com
   OIDC_PRESET=google
   ```

### 3. Optional env

- `OAUTH_PROXY_BASE_URL` — override issuer/endpoint base URL (e.g., when the reverse proxy strips `X-Forwarded-Proto`).
- `OAUTH_PROXY_GOOGLE_SCOPES` — Google authorize scope. Default `openid email profile`.
- `OAUTH_PROXY_STORE_MAX` — per-store size cap. Default 10000.

### 4. Client side

Claude Desktop / Claude.ai Connectors and other DCR-aware OAuth 2.1 clients only need the server URL. They discover metadata, register dynamically, follow Google login, and exchange tokens — all automatically.

`MCP_AUTH_TOKEN` (service-to-service / CI / clients that send Bearer directly) continues to work alongside the proxy.

### 5. Troubleshooting

- **`GOOGLE_OAUTH_CLIENT_ID is required when OAUTH_PROXY_ENABLED=true`** — Google credentials missing from `.env`.
- **Google login screen never appears, immediate failure** — the Authorized redirect URI is not registered in Google Cloud Console. Register `<self base URL>/oauth/callback` exactly.
- **`invalid_grant` on `/oauth/token`** — code has expired (10 min TTL) or already been used; or `code_verifier` doesn't match.