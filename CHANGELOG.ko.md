# 변경 로그

[English Documentation](CHANGELOG.md)

이 프로젝트의 주요 변경 사항을 모두 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)를 따르며,
버전 관리는 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)을 따릅니다.

## [Unreleased]

## [3.0.16] - 2026-10-22

### Added

- **`CHROMA_SERVER_VERSION`** — 운영자가 선언하는 Chroma 서버 버전. `chroma_get_server_version` 과 `/health/detail` 은 이 값을 신뢰할 수 있는 Chroma 버전으로 보고하고, 미설정 시 추측 대신 출처 설명과 함께 "unknown" 을 보고한다 — Chroma Rust 서버가 버전 엔드포인트에 "1.0.0" 을 하드코딩하기 때문이다 (chroma-core/chroma 1.5.9, rust/frontend/src/server.rs:647-654). `docker-compose.yml` 은 `${CHROMA_SERVER_VERSION:-1.5.9}` 를 넘기며, chromadb 이미지 핀과 함께 함께 올려야 한다.
- **`MCP_SERVER_VERSION`** — MCP 래퍼 버전으로, 이미지 빌드 시 구워진다: 릴리스 워크플로가 태그에서 뽑은 `VERSION` build-arg → Dockerfile `ARG VERSION=dev` → `ENV MCP_SERVER_VERSION`. build-arg 없는 빌드는 "dev" 를 보고한다. `package.json` 은 의도적으로 출처가 아니다 ("3.0.0" 에 고정).
- **`/health/detail` 버전 보고** — `mcp_version`, `chroma_version`, `chroma_version_server_reported` 를 추가로 담는다. 연결 끊김 분기도 `mcp_version` 을 보고한다. 공개 `/health` 는 최소 노출 계약(R6.b, CVE-2026-45829)대로 `{status:"ok"}` 그대로다.

### Changed

- **`chroma_get_server_version` 이 JSON 리포트를 반환** — 기존에는 `Chroma server version: <raw>` 평문이었다. JSON 문자열은 다음을 담는다: `text` (기존 문장, 보존), 출처를 명시한 `mcp_version` / `chroma_version` 의 `{value, source}` 쌍, `chroma_version_server_reported` (서버 버전 엔드포인트의 원본 값), `chroma_version_server_reported_trusted` (서버가 하드코딩된 "1.0.0" 센티널을 보고하면 false). **평문 응답을 파싱하던 소비자는 수정이 필요하다.**
- **MCP `initialize` serverInfo.version** — 이제 `MCP_SERVER_VERSION` 값을 보고한다 (기존엔 "2.0.0" 하드코딩).

### Fixed

- **CI 수정** — chromadb-version-check 워크플로: 단독 레포를 깨뜨리던 모노레포 `working-directory: packages/chromadb-remote-mcp` 기본값 제거. CodeQL (Security Scan): TypeScript 추출에 필요한 `setup-node` (26.12.1) 추가. codecov / publish-release / security-scan 워크플로의 `yarn install --frozen-lockfile` → `--immutable`. Security Scan 이 main push 에서도 실행된다.

### Security

- **brace-expansion lockfile 갱신** — 취약 버전 2.1.1 / 5.0.7 / 5.0.9 를 `yarn.lock` 에서 2.1.7 / 5.0.12 로 갱신.
- **TruffleHog 를 체크섬 검증한 v3.99.3 고정 바이너리로 전환** — 떠다니는 `trufflesecurity/trufflehog@main` 액션 대체 (docker bind mount 가 DooD self-hosted 러너에서 깨진다). 스캔 범위는 액션의 이벤트 로직을 그대로 본뜬다: push 는 before..after (새 브랜치는 전체 히스토리, commits 배열이 비면 생략), pull_request 는 base..head, schedule/dispatch 는 전체 히스토리.

## [3.0.15] - 2026-10-22

### Fixed

- **문자열이 아닌 `documents` / `query_texts` 원소를 임베딩 전에 거부** — `chroma_add_documents` / `chroma_update_documents` / `chroma_upsert_documents` 의 `documents` 와 `chroma_query_documents` 의 `query_texts` 는 신규 `validateStringArray` 헬퍼로 배열 원소 전체가 문자열인지 검증하고, `getCollection` 직전에 fail-fast 하여 Gemini `embedContent` 가 객체 입력을 받지 않도록 한다 (기존에는 불투명한 업스트림 HTTP 400 — "Starting an object on a scalar field" — 로 실패). 단위 테스트 23건 추가 (`tests/unit/chroma-tools.string-array-guard.test.ts`, 객체형 documents 페이로드 포함).
- **TS7 지원 전까지 TypeScript 6.x 고정** — `ts-jest` (peer `<7`) 와 `typescript-eslint` (peer `<6.1.0`) 가 TS7 native compiler 를 로드할 수 없어 `typescript` 를 `^7.0.2` → `^6.0.2` 로 되돌리고 `@typescript/typescript6` 별칭을 제거했다. Renovate 는 `typescript` major 업데이트를 홀드한다 (`.github/renovate.json`).

### Changed

- **Renovate/Dependabot 의존성 갱신 (#98, #102~#104)** — non-major/patch 갱신: ip-address, yarn engines, node CI (#98); baseline-browser-mapping, browserslist, fast-uri, hono, js-yaml, protobufjs, qs, tar, undici (#102, 9종); `@typescript-eslint/*` `^8.71.1` → `^8.72.0`, dotenv, eslint, jose, ts-jest 등 (#103, non-major); handlebars `4.7.9` → `4.7.10`, proxy-addr (#104).
- **직접 의존성 커밋 (82aec87, 0782ca3)** — 런타임: `dotenv` `^17.4.2` → `^18.0.7` (major), `@modelcontextprotocol/sdk` `^1.30.0` → `^1.32.1`, `express` `^5.2.1` → `^5.3.0`, `express-rate-limit` `^8.7.0` → `^8.7.1`; dev: `@types/node` `^22.20.3` → `^26.6.5` (major); `packageManager` yarn `4.18.0` → `4.18.1`.

## [3.0.0] - 2026-06-03

### Security

- **CVE-2026-45829 (ChromaToast) 대응 하드닝** — ChromaDB Python FastAPI 서버의 pre-auth RCE(사용자 제어 embedding-function config + `trust_remote_code` + 악성 HuggingFace 모델, CVSS 10.0). 본 MCP 게이트웨이는 취약 서버가 아니며 도구 경로 RCE는 chromadb JS SDK 3.4.3 이 중립화하지만(`serializeEmbeddingFunction` 이 MCP 가 넘기는 plain JSON 을 `{type:"legacy"}` 로 떨궈 싱크 미도달), fail-open 인증 + 무필터 catch-all REST 프록시 + unpinned 서버 이미지가 결합한 "조건부 증폭기" 표면을 제거.

### BREAKING

- **fail-closed 부팅 인증** — OIDC 발급자(`OIDC_ISSUERS`/`OIDC_PRESET`)도 `MCP_AUTH_TOKEN` 도 설정되지 않으면 `NODE_ENV` 와 무관하게 부팅을 거부한다 (기존 dev 암묵 fail-open 제거). 개발용 무인증은 `ALLOW_INSECURE_NO_AUTH=true` 명시 옵트인에서만 허용되며, 이 경우에도 `/api/*` REST 프록시 경로는 절대 fail-open 되지 않는다.
- **OIDC `audience` 필수** — OIDC 발급자가 설정된 경우 `OIDC_AUDIENCE`(또는 OAuth proxy 모드의 `GOOGLE_OAUTH_CLIENT_ID`) 가 필수. 미설정 시 부팅 실패. 이전엔 audience 미설정 시 jose 가 `aud` 검증을 건너뛰어 동일 발급자의 타 클라이언트 토큰이 통과할 수 있었다.
- **catch-all REST 프록시 기본 비활성** — ChromaDB REST 패스스루는 이제 `CHROMA_REST_PROXY_ENABLED=true` 일 때만 mount 된다 (이전엔 무조건 활성).

### Added

- **`ALLOW_INSECURE_NO_AUTH`** — 개발용 무인증 명시 옵트인 (REST 프록시 경로 제외).
- **`CHROMA_REST_PROXY_ENABLED`** (기본 OFF) — catch-all ChromaDB REST 프록시 게이트. 활성화 시 체인: `validateOriginHeader`(DNS-rebind 방어) → `oidcAuthMiddleware`(옵트인 무시, 항상 인증) → pathFilter(컬렉션 생성/변형 + `/embedding` 경로 차단) → proxyReq 본문에서 `configuration.embedding_function` strip.
- **`OAUTH_PROXY_BASE_URL`** — OAuth proxy 활성 시 canonical URL 고정값(필수). `X-Forwarded-Host` 스푸핑을 무시.
- **`OAUTH_PROXY_REDIRECT_URI_ALLOWLIST`** — DCR `redirect_uris` exact-match allowlist (콤마 구분). 미설정 + proxy 활성 시 모든 DCR 요청 거부.
- **Google OIDC `azp` 검증** — Google 발급 토큰의 authorized-party claim 을 expected client id 와 추가 대조.
- **`GET /health/detail`** — 인증 뒤 상세 health(내부 ChromaDB host:port, 연결 상태).
- **`.github/workflows/chromadb-version-check.yml`** — ChromaDB 서버 이미지가 취약 범위(1.0.0–1.5.8) 이거나 chromadb SDK `< 3.4.3` 이면 CI fail.

### Changed

- **`chroma_modify_collection` 메타데이터 보존** — 클라이언트 `metadata` 를 `buildCollectionMetadata` 로 감싸 서버 소유 `embedding_provider`/`embedding_model`/`embedding_dimensions` 키를 보존(create/get-or-create 경로와 일관). 클라이언트가 임베딩 메타데이터를 우회 변경할 수 없다.
- **`GET /health` 정보 최소화** — 무인증 응답이 `{status:"ok"}` 만 반환(내부 host:port 미노출). 상세는 `/health/detail`(인증 필요)로 이동.
- **ChromaDB 서버 이미지 핀** — 3 개 docker-compose 전부 `chromadb/chroma:1.5.9@sha256:1e0b73a187a28757c572acba508c46f48c9e8b0acaf5c20e6d95cdedce1acdf6` 로 고정(CVE 영향 범위 바로 위 첫 안정 릴리스). `.env.example` 에 `CHROMADB_VERSION` 비취약 최소 버전 문서화.

### Migration

- **무인증으로 운영하던 배포는 부팅에 실패한다.** `MCP_AUTH_TOKEN` 또는 OIDC(`OIDC_ISSUERS`/`OIDC_PRESET` + `OIDC_AUDIENCE`) 를 설정하거나, 신뢰된 내부 환경에 한해 `ALLOW_INSECURE_NO_AUTH=true` 를 명시한다.
- ChromaDB REST 패스스루를 사용 중이었다면 `CHROMA_REST_PROXY_ENABLED=true` 를 명시해야 한다. 대부분의 용례는 MCP 도구로 충분하므로 비활성 유지를 권장.
- `OIDC_PRESET=google` 등 OIDC 사용자는 `OIDC_AUDIENCE` 를 추가해야 부팅된다.
- `OAUTH_PROXY_ENABLED=true` 사용자는 `OAUTH_PROXY_BASE_URL` 과 `OAUTH_PROXY_REDIRECT_URI_ALLOWLIST` 를 설정해야 한다.

## [2.2.3] - 2026-05-15

### Fixed

- **Google `invalid_scope: offline_access` 회귀 해소** — v2.2.1 이 OIDC 표준 `offline_access` scope 를 자동 추가했으나 **Google OAuth 는 이 scope 를 미지원** (`Some requested scopes were invalid. invalid=[offline_access]`). v2.2.3 은 자동 추가를 제거 — Google 에서 refresh_token 을 받기 위해서는 `access_type=offline` + `prompt=consent` (둘 다 v2.2.1 부터 적용 중) 만으로 충분하다. `OAUTH_PROXY_GOOGLE_SCOPES` env 도 사용자 지정 그대로 사용.
- **`/.well-known/oauth-authorization-server` `scopes_supported`** — `offline_access` 자동 append 제거. Google 가 실제로 받는 scope 만 광고.

### Migration

- v2.2.1 / v2.2.2 에서 OAuth 흐름이 `invalid_scope` 로 막혔던 사용자는 v2.2.3 배포 후 정상 동작. 추가 작업 불필요.
- refresh_token 동작은 그대로 — `access_type=offline` + `prompt=consent` 조합으로 Google 이 첫 consent 시 refresh_token 발급, 1 시간 만료 시 클라이언트가 자동 갱신.

## [2.2.2] - 2026-05-15

### Fixed

- **OAuth proxy: 브라우저 CORS 차단으로 인증 실패 (`Failed to fetch`)** — Claude.ai / Cloudflare AI 대시보드 (`dash.cloudflare.com`) 같은 브라우저 클라이언트가 `/oauth/token` POST 시 `Access to fetch ... blocked by CORS policy` 로 차단되던 문제. v2.1.0 의 `validateOriginHeader` 미들웨어는 origin 차단/허용만 했고 CORS 응답 헤더 (`Access-Control-Allow-Origin` 등) 는 설정하지 않아 브라우저가 응답 자체를 unwrap 하지 못함.

### Added

- **`corsMiddleware`** (`src/index.ts`) — 글로벌 등록. preflight (`OPTIONS`) 는 204 + 허용 헤더로 응답하고, 실제 요청에는 `Access-Control-Allow-Origin`, `-Methods`, `-Headers`, `-Expose-Headers`, `-Max-Age` 를 echo back. `Access-Control-Allow-Credentials` 는 설정하지 않음 (Bearer 토큰 사용, 쿠키 미사용).
- **`getCorsAllowedOrigins()`** — CORS 허용 origin 산출. 기본값:
  - `https://claude.ai`
  - `https://api.anthropic.com`
  - `https://dash.cloudflare.com` (Cloudflare AI Gateway 대시보드)
  - localhost (모든 포트)
  - `ALLOWED_ORIGINS` env 의 콤마-구분 항목 자동 병합 (idempotent)

### Notes

- `validateOriginHeader` 는 그대로 유지 — DNS rebinding 방어 + `/mcp` 보호.
- 단위 테스트 9 건 추가 (`tests/unit/index.test.ts` `corsMiddleware` describe).

## [2.2.1] - 2026-05-15

### Fixed

- **OAuth proxy: 1시간마다 재인증 강제 회귀 해소** — Claude Desktop 커넥터(또는 Google ID Token 기반 모든 MCP 클라이언트) 가 v2.1.0 OAuth proxy 사용 시 1 시간마다 전체 OAuth 흐름을 다시 거치던 문제. 6 가지 원인이 동시 작동:
  - `authorize.ts`: `access_type=online` (Google 이 refresh_token 미발급) → **`offline` 으로 변경**
  - `authorize.ts`: `prompt=select_account` (returning user 에게 refresh_token 미발급) → **`consent` 로 변경**
  - `authorize.ts`: scope 에 `offline_access` 부재 → **자동 추가** (override 환경변수와 무관하게 idempotent join)
  - `register.ts` / `metadata.ts`: `grant_types` 응답에 `refresh_token` 미선언 → **`["authorization_code", "refresh_token"]` 로 확장**
  - `token.ts`: `grant_type=refresh_token` 거부 (`unsupported_grant_type` 즉시 반환) → **분기 추가, Google `/token` 으로 forward 후 새 id_token + 회전된 refresh_token 응답**
  - `callback.ts` / `state-store.ts`: Google 응답의 `refresh_token` 저장 안 함 → **`AuthzCodeEntry.refresh_token?` 신규 필드 + `/oauth/token` authorization_code 응답에 포함**

### Migration

- v2.1.x 환경에서 v2.2.1 로 업그레이드하면 **재인증 1 회 필요** (기존 Google grant 에 `offline_access` 가 없으므로). 이후부터 1 시간 만료 시 클라이언트가 자동 refresh 하여 재인증 불필요.
- `OAUTH_PROXY_GOOGLE_SCOPES` 환경 변수를 명시적으로 설정한 경우에도 `offline_access` 가 자동 append 됨 (idempotent — 이미 포함되어 있으면 중복 추가 안 함).

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

- **Claude Desktop Connectors 루트 경로 핸드셰이크** — `POST /` (경로 없는 Connector URL) 가 이제 catch-all ChromaDB 프록시에 가로채지 않고 MCP 핸들러 체인(`validateProtocolVersion` → `validateOriginHeader` → `oidcAuthMiddleware` → `mcpHandler`) 을 통과한다. `https://<host>` (`/mcp` 없이) 로 등록한 사용자는 더 이상 소리 없는 핸드셰이크 실패를 겪지 않는다 (R2).
- **`chroma_update_documents` 임베딩 차원 불일치** — update 핸들러가 명시적 `embeddings` 없이 `collection.update({ids, documents, metadatas})` 를 호출해 ChromaDB SDK 가 기본 384d 임베딩 함수(`all-MiniLM-L6-v2`) 로 폴백하여 다른 프로바이더를 쓰는 컬렉션을 깨뜨렸다 (예: 1536d `gemini-embedding-001` → `Embedding dimension 384 expected, got 1536`). 핸들러는 이제 `chroma_add_documents` 를 그대로 본떠: 컬렉션별 프로바이더 설정을 해석하고, 해당 시 서버 측에서 임베딩을 계산해 `collection.update` 로 전달한다. 메타데이터 전용 update (`documents` 없음) 는 임베딩 재계산을 건너뛰고 기존 벡터를 보존한다. external 프로바이더 모드는 add 와 마찬가지로 사전 계산된 `embeddings` 가 필요하다 (R11).
- **LibreChat 식 사전 공유 `client_id` 수용** — `OAUTH_PROXY_ALLOW_PRESHARED_CLIENT=true` 이고 요청한 `client_id` 가 `GOOGLE_OAUTH_CLIENT_ID` 와 같으면 `/oauth/authorize` 와 `/oauth/token` 이 임시 사전 등록 클라이언트로 요청을 수용한다. PKCE (S256 + `code_verifier`) 와 `redirect_uri` 일관성은 여전히 필수다. 이 플래그는 opt-in (기본 off) 이므로 DCR 클라이언트는 영향 없음 (R3, E2).
- **OAuth Proxy 활성 시 `OIDC_AUDIENCE` 가 `GOOGLE_OAUTH_CLIENT_ID` 로 자동 폴백** — Google ID 토큰은 항상 `aud == client_id` 이므로 두 env 를 모두 요구하는 것은 중복이었다. `OAUTH_PROXY_ENABLED=true` 일 때 검증기는 `OIDC_AUDIENCE` 미설정 시 `GOOGLE_OAUTH_CLIENT_ID` 를 audience 로 사용한다. 명시적 `OIDC_AUDIENCE` 는 여전히 우선하며, OAuth Proxy 가 off 면 v2.0.0 동작과 바이트 단위로 동일하다 (R4).
- **배너 버전이 더 이상 `v2.0.0` 으로 하드코딩되지 않음** — 시작 배너가 기동 시 `package.json#version` 을 읽어(`readFileSync` 기반, 빌드/시작 안전) 실제 릴리스 태그를 출력한다 (R6).

### Changed

- **`resolveResourceBaseUrl` 이 `OAUTH_PROXY_BASE_URL` 을 먼저 존중** — env 가 설정되면 protected-resource 메타데이터가 그 값을 그대로 반환한다(끝 슬래시 제거). env 미설정 시 기존 `X-Forwarded-Proto` / `X-Forwarded-Host` / `req.headers.host` 폴백 체인이 유지되므로 OAuth-Proxy-off 배포는 변화 없음. `X-Forwarded-Proto` 없는 Caddy 가 OAuth 2.1 클라이언트가 거부하는 plain-`http://` 리소스를 노출하던 회귀를 수정한다 (R5).
- **신규 env: `OAUTH_PROXY_ALLOW_PRESHARED_CLIENT`** — 위의 사전 공유 `client_id` 폴백용 boolean opt-in 플래그. 기본 `false`. `docker-compose.yml` / `docker-compose.dev.yml` 로 전파 (E2).

### Migration

- **`docker-compose.yml` / `docker-compose.dev.yml` 가 v2.1.0 OAuth-Proxy env 블록을 전파** (`OAUTH_PROXY_ENABLED`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `OAUTH_PROXY_BASE_URL`, `OAUTH_PROXY_GOOGLE_SCOPES`, `OAUTH_PROXY_STORE_MAX`) + 신규 v2.1.1 `OAUTH_PROXY_ALLOW_PRESHARED_CLIENT`. v2.1.0 에서 compose 파일을 수동 패치한 운영자는 그 로컬 추가를 제거할 수 있다 (R1, R10).

## [2.1.0] - 2026-05-13

### Added

- **Google IdP 용 내장 OAuth 2.1 Authorization Server 프록시** (`OAUTH_PROXY_ENABLED=true`) — 서버가 `/oauth/{register,authorize,callback,token}` 과 `/.well-known/oauth-authorization-server` (RFC 8414) 를 노출해, Dynamic Client Registration (RFC 7591) 에 의존하는 MCP 클라이언트(Claude Desktop / Claude.ai Connectors, mcp-remote, ...) 가 사전 발급된 client_id 없이 Google 로 인증할 수 있다. Google 자체는 DCR 을 지원하지 않으며 이 프록시가 그 공백을 메운다.
- **Dynamic Client Registration** (`POST /oauth/register`) — `token_endpoint_auth_method: "none"` 과 PKCE 필수인 public client_id 를 발급한다 (R1).
- **PKCE S256 필수** — `/oauth/authorize` 에서 `code_challenge` + `code_challenge_method=S256` 가 필요하고, `/oauth/token` 에서 `code_verifier` 를 검증한다 (R5).
- **Google id_token passthrough** — `/oauth/token` 은 Google `id_token` 을 바이트 동일하게 반환한다(재서명 없음). 기존 OIDC 검증기가 `iss=accounts.google.com` + `aud=GOOGLE_OAUTH_CLIENT_ID` 로 검증한다 (R6).
- **`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`** — Google 과의 실제 code → id_token 교환에 쓰이는 서버 측 자격증명 (R3).
- **`OAUTH_PROXY_BASE_URL`** — `X-Forwarded-Proto` 가 제거되는 환경을 위한 명시적 issuer/base URL override (E1).
- **`OAUTH_PROXY_GOOGLE_SCOPES`** — Google authorize 리다이렉트의 scope override (기본 `openid email profile`) (E4).
- **`OAUTH_PROXY_STORE_MAX`** — store 별 크기 상한과 오래된-만료-먼저 추출 (기본 10000) (E3).

### Changed

- **`/.well-known/oauth-protected-resource`** — `OAUTH_PROXY_ENABLED=true` 일 때 `authorization_servers` 필드가 `https://accounts.google.com` 이 아니라 MCP 서버 자신을 가리킨다. DCR 흐름을 end-to-end 로 작동하게 만드는 부분이다. 플래그가 off 면 v2.0.0 과 바이트 단위로 동일하다 (R8, R10).
- **`validateEnvironmentVariables`** — `OAUTH_PROXY_ENABLED=true` 인데 `GOOGLE_OAUTH_CLIENT_ID` 나 `GOOGLE_OAUTH_CLIENT_SECRET` 이 없으면 기동 시 fail fast (R3).

### Security

- **시크릿 미로깅** — `client_secret`, `code_verifier`, `id_token`, `GOOGLE_OAUTH_CLIENT_SECRET` 는 oauth-proxy 모듈의 모든 로깅 경로에서 제외된다 (R14).
- **레이트 리밋** — 5 개 oauth-proxy 엔드포인트 전부 기존 글로벌 `limiter` 뒤에 있으며 429 시 `Retry-After` 를 반환한다 (R13).
- **state / code 일회성 소비** — `consumeAuthzState` 와 `consumeAuthzCode` 는 첫 읽기에서 항목을 제거한다. 재생은 `invalid_grant` / `invalid_state` 를 반환한다 (R5).
- **인메모리 TTL ≤ 10 분** — state/code/client store 의 `TTL_SEC=600` (R5).

### Compatibility

- `OAUTH_PROXY_ENABLED` 는 opt-in (기본 off). `OIDC_PRESET=google` + `Authorization: Bearer <google_id_token>` (OAuth 를 직접 처리하는 클라이언트) 로 운영되던 기존 v2.0.0 배포는 변경 없이 계속 동작한다 (R7, R8).

## [2.0.0] - 2026-05-13

### Breaking changes

- **컬렉션 metadata schema v2** — 새 컬렉션은 모두 `embedding_provider`, `embedding_model`, `embedding_dimensions` 를 metadata 에 저장한다. 기존 v1 컬렉션은 읽기/쓰기 시 `Embedding provider mismatch` 로 실패한다. v1 컬렉션 읽기 전용 접근을 허용하려면 `LEGACY_COLLECTION_COMPAT=true` 를 설정하거나 `MIGRATION.md` 대로 재인덱싱한다.
- **기본 임베딩 동작** — 이전 릴리스는 조용히 ChromaDB 내장 `all-MiniLM-L6-v2` (영어 전용, 384 dim) 를 사용했다. v2 는 `EMBEDDING_PROVIDER` 미설정 상태로 기본값이 사용되면 시작 시 경고를 출력한다.
- **인증 — `Authorization: Bearer` 전용** — `/mcp` 와 catch-all REST 프록시는 이제 OIDC 인식 미들웨어를 거친다. 기존에 지원하던 `X-Chroma-Token` 헤더와 `?apiKey=` / `?token=` / `?api_key=` 쿼리 파라미터 인증 경로는 제거됐다. `MCP_AUTH_TOKEN` 은 service-to-service 자격증명으로 계속 동작하며 `Authorization: Bearer <token>` 으로 보내야 한다. 사람 사용자에게는 OAuth 2.1 OIDC 가 권장 경로다.
- **제거된 env** — `ALLOW_QUERY_AUTH` 는 더 이상 서버가 읽지 않으며 시작 배너에 `Query Auth` 도 표시되지 않는다. 기존 값은 조용히 무시된다.

### Added

- **임베딩 프로바이더 추상화** (`src/embedding/`) — `EMBEDDING_PROVIDER` 로 선택하는 플러그형 프로바이더:
  - `chromadb-default` — 내장 `all-MiniLM-L6-v2` (영어 전용 폴백)
  - `external` — 호출자가 도구 인자로 사전 계산된 임베딩을 공급
  - `openai_compatible` — 임의의 `/v1/embeddings` 엔드포인트 (OpenAI, Together, Ollama, TEI, vLLM)
  - `gemini` — Google AI Studio Embedding API (`gemini-embedding-001`), task_type 분리 (`RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`) 와 Matryoshka 차원 (768/1536/3072)
  - `voyage` — Voyage AI `/v1/embeddings`, `input_type` query/document 분리와 `output_dimension` (voyage-3 / voyage-3-large / voyage-3.5)
- **External 임베딩 모드** — `chroma_add_documents` 는 `embeddings` 를, `chroma_query_documents` 는 `query_embeddings` 를 받는다. 서버가 컬렉션 metadata 대비 차원을 검증한다.
- **컬렉션별 프로바이더 override** — `embedding_provider`/`embedding_model`/`embedding_dimensions` 를 명시한 컬렉션 metadata 는 해당 컬렉션에 한해 서버 기본값을 덮어쓴다.
- **신뢰도 게이팅** — `chroma_query_documents` 에 `min_score` (0-1) 추가. 유사도 임계 미만 항목은 버려지고 모든 결과가 걸러지면 `confidence_gate: "no_confident_match"` 플래그가 나온다. 기본값은 `CONFIDENCE_THRESHOLD` 에서 온다.
- **리랭커 계층 (fail-soft)** — `chroma_query_documents` 에 `rerank` / `rerank_top_n` / `rerank_top_k` 추가. 리랭커는 `RERANKER_API_BASE` (OpenAI 호환 `/rerank`) 로 연락하며, 모든 실패(타임아웃, HTTP 오류, 설정 누락)는 조용히 원래 순서로 저하된다.
- **OAuth 2.1 OIDC 멀티 프로바이더** — `OIDC_ISSUERS` (콤마 구분) 또는 `OIDC_PRESET=google,github,microsoft`. 서명(RS256/ES256/EdDSA), `iss`, `aud` (`OIDC_AUDIENCE`), `exp`, `nbf/iat` (60s 클록 스큐) 를 검증한다. JWKS 는 `/.well-known/openid-configuration` 으로 자동 발견되며 1시간 캐시(로테이션 안전)된다.
- **RFC 9728 Protected Resource Metadata** — `GET /.well-known/oauth-protected-resource` 가 `resource`, `authorization_servers`, `bearer_methods_supported`, `scopes_supported` 를 반환한다. 401 응답은 `WWW-Authenticate` 에 `resource_metadata=` 를 포함하고 올바른 RFC 6750 `error=` 파라미터(`invalid_request` / `invalid_token` / `insufficient_scope`) 를 쓴다.
- **사용자 식별 로깅** — 인증된 요청은 기본적으로 `sub` 클레임을 해싱해(SHA-256 앞 12자) 기록하고, `OIDC_LOG_SUB_MODE=full` 이면 원문을 기록한다.
- **`MIGRATION.md`** — 한글·영문 v1 → v2 단계별 가이드.

### Dependencies

- `jose@^6.1.3` 추가 (JWT 검증).

### Fixed

- `docker-compose.yml` 과 `docker-compose.dev.yml` 이 v2.0.0 env 전부(`EMBEDDING_*`, `GEMINI_API_KEY`, `CONFIDENCE_THRESHOLD`, `RERANKER_*`, `OIDC_*`, `LEGACY_COLLECTION_COMPAT`) 를 `mcp-server` 컨테이너로 전파한다.
- `package.json` 의 `jose` 제약이 `yarn.lock` 과 일치(`^6.1.3`) — 이전엔 lockfile 이 `6.2.2` 로 풀었는데 매니페스트가 `^5.9.0` 을 고정해 `yarn install --immutable` (그리고 Docker 빌드) 가 실패했다.
- `chroma_query_documents` / `chroma_add_documents` 는 활성 프로바이더가 `external` 인데 호출자가 `query_texts` / `documents` 만 넘기면 친절한 오류로 short-circuit 한다. 이전엔 ChromaDB v3 클라이언트가 투명하게 기본 임베딩(384d) 을 적용해 차원 불일치 오류로 내부 ChromaDB 호스트와 컬렉션 UUID 를 누출했다.
- 읽기/쓰기 도구 분기가 이제 `getOrCreateCollection(...)` 대신 `chromaClient.getCollection({ name })` 을 쓴다. v1.x 는 존재하지 않는 컬렉션에 읽기/쓰기를 요청받으면 서버 기본 v2 metadata 의 고아 컬렉션을 조용히 만들었다.
- `WWW-Authenticate` 헤더의 `error_description` 파라미터와 JSON 본문의 `error_description` 필드가 같은 텍스트를 담는다. 이전엔 헤더가 내부 `"` 를 `'` 로 바꿔 같은 오류에 서로 다른 두 문자열이 생겼다.

## [1.0.2] - 2025-10-31
- fix(security): CodeQL 이 로그 인젝션 경고를 억제하도록 설정 [#d7365c1](https://github.com/meloncafe/chromadb-remote-mcp/commit/d7365c16498bc0856b2e7728c8a399f6dee4844d)
- fix(security): CodeQL 경고 해소를 위한 로그 새니타이제이션 강화 [#d3eb3ec](https://github.com/meloncafe/chromadb-remote-mcp/commit/d3eb3ecdc140614264d2a10c1daab534f94baa3a)
- [ci: .deepsource.toml 갱신 by @deepsource-autofix[bot]](https://github.com/meloncafe/chromadb-remote-mcp/pull/9)
- [코드 스캐닝 알림 12번 잠재 수정: @meloncafe 의 Log injection](https://github.com/meloncafe/chromadb-remote-mcp/pull/8)
- [코드 스캐닝 알림 6번 잠재 수정: @meloncafe 의 Log injection](https://github.com/meloncafe/chromadb-remote-mcp/pull/10)
- [chore(style): @meloncafe 의 MseeP.ai 배지 shields.io 형식 갱신](https://github.com/meloncafe/chromadb-remote-mcp/pull/13)
- [@lwsinclair 의 MseeP.ai 배지 추가](https://github.com/meloncafe/chromadb-remote-mcp/pull/12)
- [chore(deps): @dependabot[bot] 의 npm_and_yarn 그룹 1 디렉터리 tar 7.5.1→7.5.2 bump](https://github.com/meloncafe/chromadb-remote-mcp/pull/14)

## [1.0.1] - 2025-10-26

- fix(docs): @meloncafe 의 설치 스크립트 갱신 (#3)
- fix(docker): @meloncafe 의 docker-compose 파일 볼륨 경로를 /data 로 갱신 (#4)
- feat(docker): @meloncafe 의 Dockerfile MCP Register Label 추가 (#5)

## [1.0.0] - 2025-10-25

### Added

#### 핵심 기능

- Streamable HTTP 전송(2025-03-26 스펙) 원격 MCP 서버
- MCP 도구를 통한 완전한 CRUD 의 ChromaDB 통합
- Python/JavaScript 클라이언트가 직접 ChromaDB 에 접근하는 REST API 프록시
- Claude Desktop, Mobile, Code 크로스 플랫폼 지원

#### MCP 도구

- 컬렉션 관리:

  - `chroma_list_collections`
  - `chroma_create_collection`
  - `chroma_delete_collection`
  - `chroma_get_collection_info`
  - `chroma_get_collection_count`
  - `chroma_peek_collection`

- 문서 작업:
  - `chroma_add_documents`
  - `chroma_query_documents`
  - `chroma_get_documents`
  - `chroma_update_documents`
  - `chroma_delete_documents`

#### 보안

- Bearer 토큰, X-Chroma-Token 헤더, 쿼리 파라미터 세 방식의 통합 인증 시스템
- 레이트 리밋 (IP 당 15분 100 요청, 설정 가능)
- XSS·코드 인젝션 방어의 엄격한 Content Security Policy (CSP)
- 보안 헤더: X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS
- Origin 헤더 검증의 DNS rebinding 공격 방지
- 타이밍 공격 방지의 타이밍 안전 토큰 비교
- ANSI 이스케이프 시퀀스 필터링의 로그 인젝션 방지

#### 배포

- 원 커맨드 자동 설치 스크립트
- 프로덕션·개발용 Docker Compose 구성
- 멀티 플랫폼 Docker 이미지 (linux/amd64, linux/arm64)
- Docker Scout 의 공급망 증명 (SBOM 및 Provenance)
- 자동 릴리스 워크플로가 있는 GitHub Actions CI/CD 파이프라인

#### 문서

- 영문·한글 [README](README.md)
- 영문·한글 [보안 정책](SECURITY.md)
- 영문·한글 [기여 가이드라인](CONTRIBUTING.md)
- 영문·한글 [행동 강령](CODE_OF_CONDUCT.md)

#### 테스트·품질

- 코드 커버리지 83% 의 단위 테스트
- 실제 검증 로직
- 완전한 타입 안전성을 갖춘 TypeScript strict 모드
- 자동 보안 스캐닝 (DeepSource, CodeQL, Dependabot, Docker Scout)

### Security

- OWASP·CWE 보안 발견 항목 전부 해소 (DeepSource 검증)
- Docker Scout 8/8 컴플라이언스 달성
- 의존성 활성 취약점 제로

[Unreleased]: https://github.com/meloncafe/chromadb-remote-mcp/compare/v3.0.16...HEAD
[3.0.16]: https://github.com/meloncafe/chromadb-remote-mcp/compare/v3.0.15...v3.0.16
[3.0.15]: https://github.com/meloncafe/chromadb-remote-mcp/compare/v3.0.14...v3.0.15
[1.0.2]: https://github.com/meloncafe/chromadb-remote-mcp/releases/tag/v1.0.2
[1.0.1]: https://github.com/meloncafe/chromadb-remote-mcp/releases/tag/v1.0.1
[1.0.0]: https://github.com/meloncafe/chromadb-remote-mcp/releases/tag/v1.0.0