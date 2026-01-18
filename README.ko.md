# ChromaDB Remote MCP Server

[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-blue)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![MseeP.ai](https://img.shields.io/badge/MseeP.ai-Audited-4c1)](https://mseep.ai/app/meloncafe-chromadb-remote-mcp)
[![codecov](https://codecov.io/gh/meloncafe/chromadb-remote-mcp/graph/badge.svg?token=0abUQsve4y)](https://codecov.io/gh/meloncafe/chromadb-remote-mcp)
[![DeepSource](https://app.deepsource.com/gh/meloncafe/chromadb-remote-mcp.svg/?label=Active+Issues&show_trend=true&token=Mzfb6tMnlzBIxaJO9CsYO3e8)](https://app.deepsource.com/gh/meloncafe/chromadb-remote-mcp/)

**Streamable HTTP** 방식의 MCP(Model Context Protocol) 서버로, Claude와 같은 AI 어시스턴트가 원격에서 ChromaDB에 접근할 수 있도록 합니다. 모바일 기기와 원격 위치에서 의미 검색 및 벡터 데이터베이스 작업을 지원합니다.

> **중요**: 이 프로젝트는 MCP Streamable HTTP (2025-03-26 스펙)를 사용합니다. SSE 전송 방식은 더 이상 사용되지 않습니다.

[English Documentation](README.md)

---

## Sponsors

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/termius-logo-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="assets/termius-logo-light.svg" />
  <img alt="Termius Logo" src="assets/termius-logo-light.svg" width="200" />
</picture>

Termius는 안전하고 신뢰할 수 있으며 협업이 가능한 SSH 클라이언트를 제공합니다.

---

## 다중 플랫폼 AI 메모리 서버

**다양한 AI 플랫폼 서비스를 지원합니다.:**

- Claude (Desktop, Mobile, Code)
- Gemini (CLI, Code Assist)
- Cursor, Cline, Windsurf, VS Code Copilot
- 그리고 Remote MCP를 사용할 수 있는 모든 도구

## 주요 기능

모든 Claude 클라이언트(Desktop, Code, Mobile)가 동일한 자가 호스팅 ChromaDB 인스턴스에 접근할 수 있는 원격 MCP 서버입니다.

- **기기 간 공유 메모리** - 모든 Claude 클라이언트가 동일한 ChromaDB 인스턴스 사용
- **자가 호스팅 및 프라이빗** - 데이터가 본인의 인프라에 보관됨
- **원격 접근** - Tailscale 또는 공개 인터넷을 통해 어디서나 접근
- **완전한 ChromaDB 지원** - MCP 도구를 통한 모든 CRUD 작업
- **REST API 프록시** - Python/JavaScript의 직접 ChromaDB 접근
- **통합 인증** - 단일 토큰으로 MCP와 REST API 모두 보호
- **간편한 배포** - 원 커맨드 설치

---

## 아키텍처

### 개요

```
┌──────────────────────────────┐     ┌──────────────┐
│   Claude Desktop + Mobile    │     │  Claude Code │
│   (커스텀 커넥터 - 자동 동기화)    │     │   (CLI 설정)  │
└──────────────┬───────────────┘     └──────┬───────┘
               │                            │
               │        MCP 원격 커넥터        │
               └─────────────┬──────────────┘
                             │ HTTPS
                   ┌─────────▼──────────┐
                   │   원격 MCP          │
                   │   서버 (Node.js)    │
                   │                    │
                   │ • 인증 게이트웨이      │
                   │ • MCP 프로토콜       │
                   │ • REST API 프록시   │
                   └─────────┬──────────┘
                             │
                   ┌─────────▼──────────┐
                   │   ChromaDB         │
                   │   (벡터 데이터베이스)  │
                   │                    │
                   │ • 임베딩            │
                   │ • 컬렉션            │
                   │ • 의미 검색          │
                   └────────────────────┘

```

**클라이언트 연결 방법:**

- **Claude Desktop + Mobile**: Claude Desktop에서 커스텀 커넥터로 한 번 설정하면 모바일 앱에 자동으로 동기화됩니다. 두 앱이 동일한 연결을 자동으로 공유합니다.
- **Claude Code**: `claude mcp add` CLI 명령어를 사용하여 별도로 설정해야 합니다.

모든 클라이언트가 이 원격 MCP 서버를 통해 동일한 자가 호스팅 ChromaDB에 접근합니다. 벡터 임베딩과 의미 검색 결과가 모든 플랫폼에서 지속됩니다.

### API 엔드포인트

| 경로            | 목적              | 클라이언트                 | 인증 |
| --------------- | ----------------- | -------------------------- | ---- |
| `/mcp`          | MCP 프로토콜      | Claude Desktop/Code/Mobile | ✅   |
| `/api/v2/*`     | ChromaDB REST API | Python                     | ✅   |
| `/docs`         | Swagger UI        | 브라우저 (API 문서)        | ✅   |
| `/openapi.json` | OpenAPI 스펙      | API 도구                   | ✅   |
| `/health`       | 헬스 체크         | 모니터링                   | ❌   |

### 작동 방식

1. **Claude Desktop/Mobile**: 커스텀 커넥터로 MCP 서버 추가 (기기 간 자동 동기화)
2. **Claude Code**: `claude mcp add` CLI 명령어로 MCP 서버 추가
3. **원격 MCP 서버**가 요청을 인증하고 MCP 프로토콜을 ChromaDB 작업으로 변환
4. **ChromaDB**가 의미 검색을 위한 벡터 임베딩을 저장하고 검색
5. **Python**도 프록시된 REST API를 통해 ChromaDB에 직접 접근 가능

**장점:**

- 모든 클라이언트에서 동일한 벡터 데이터베이스
- Desktop과 Mobile 간 연결 자동 공유
- 자가 호스팅 및 프라이빗
- 앱 재시작 후에도 지속되는 메모리
- 임베딩의 단일 소스

---

## 빠른 시작

### 원 커맨드 설치

```bash
curl -fsSL https://raw.githubusercontent.com/meloncafe/chromadb-remote-mcp/release/scripts/install.sh | bash
```

다음 작업을 자동으로 수행합니다:

1. `docker-compose.yml`과 `.env.example` 다운로드
2. Docker Compose 명령어 자동 감지 (`docker-compose` 또는 `docker compose`)
3. 보안 인증 토큰 자동 생성 (선택 사항)
4. ChromaDB 데이터 저장 위치 설정 (Docker 볼륨, 로컬 디렉토리, 또는 커스텀 경로)
5. Docker 이미지 풀
6. 생성된 인증 토큰 및 연결 URL 표시

### 수동 설치

#### 옵션 1: Docker (권장 - 사전 빌드된 이미지)

```bash
# 설정 파일 다운로드
mkdir chromadb-remote-mcp && cd chromadb-remote-mcp
curl -O https://raw.githubusercontent.com/meloncafe/chromadb-remote-mcp/release/docker-compose.yml
curl -O https://raw.githubusercontent.com/meloncafe/chromadb-remote-mcp/release/.env.example

# 환경 설정
cp .env.example .env
# .env를 수정하여 다음 항목 설정:
#   - MCP_AUTH_TOKEN (토큰 생성 방법은 아래 참조)
#   - PORT (기본값: 8080)
#   - CHROMA_DATA_PATH (기본값: chroma-data)

# 서비스 시작
docker compose up -d
# 또는: docker-compose up -d (구버전의 경우)

# 헬스 체크
curl http://localhost:8080/health

# 로그 확인
docker compose logs -f
```

#### 옵션 2: 소스에서 빌드

```bash
# 저장소 클론
git clone https://github.com/meloncafe/chromadb-remote-mcp.git
cd chromadb-remote-mcp

# 환경 설정
cp .env.example .env
# .env 수정

# docker-compose로 시작 (소스에서 이미지 빌드)
docker compose -f docker-compose.dev.yml up -d
# 또는: docker-compose -f docker-compose.dev.yml up -d (구버전의 경우)
```

#### 옵션 3: 로컬 개발

```bash
# 클론 및 설치
git clone https://github.com/meloncafe/chromadb-remote-mcp.git
cd chromadb-remote-mcp
yarn install

# 환경 설정
cp .env.example .env
# .env 파일 수정

# 빌드 및 실행
yarn build
yarn start
```

### 보안 토큰 생성

프로덕션 환경에서는 `.env`의 `MCP_AUTH_TOKEN`에 안전한 토큰을 생성하세요:

```bash
# 방법 1: Node.js (권장)
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 방법 2: OpenSSL
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

생성된 토큰을 `.env` 파일에 붙여넣으세요:

```env
MCP_AUTH_TOKEN=생성된-토큰-여기에
```

### 서버 엔드포인트

- MCP: `http://localhost:8080/mcp` (Caddy 프록시를 통해)
- Health: `http://localhost:8080/health`
- ChromaDB API: `http://localhost:8080/api/v2/*`
- Swagger UI: `http://localhost:8080/docs`

---

## 설정

### 환경 변수 (.env 파일)

모든 설정은 `.env` 파일을 통해 이루어집니다. `.env.example`을 `.env`로 복사하여 사용자 정의하세요:

```bash
cp .env.example .env
```

| 변수                | 설명                                                            | 기본값             | 필수                  |
| ------------------- | --------------------------------------------------------------- | ------------------ | --------------------- |
| `PORT`              | 외부 포트 (Caddy 리버스 프록시)                                 | `8080`             | 아니오                |
| `CHROMA_DATA_PATH`  | ChromaDB 데이터 저장 경로 (볼륨 이름, `./data`, 또는 절대 경로) | `chroma-data`      | 아니오                |
| `CHROMA_HOST`       | ChromaDB 호스트 (내부)                                          | `chromadb`         | 아니오                |
| `CHROMA_PORT`       | ChromaDB 포트 (내부)                                            | `8000`             | 아니오                |
| `CHROMA_TENANT`     | ChromaDB 테넌트                                                 | `default_tenant`   | 아니오                |
| `CHROMA_DATABASE`   | ChromaDB 데이터베이스                                           | `default_database` | 아니오                |
| `MCP_AUTH_TOKEN`    | MCP 및 REST API 인증 토큰                                       | -                  | **예** (공개 접근 시) |
| `CHROMA_AUTH_TOKEN` | ChromaDB 인증 토큰 (ChromaDB에서 인증이 필요한 경우)            | -                  | 아니오                |
| `RATE_LIMIT_MAX`    | IP당 15분당 최대 요청 수                                        | `100`              | 아니오                |
| `ALLOWED_ORIGINS`   | 허용된 origin 목록 (쉼표로 구분, DNS rebinding 방어)            | -                  | 아니오                |
| `ALLOW_QUERY_AUTH`  | 쿼리 파라미터 인증 활성화 (`?apiKey=TOKEN`)                     | `true`             | 아니오                |

### 인증

**중요:** 공개 인터넷 접근(Tailscale Funnel, Cloudflare Tunnel 등)을 위해서는 `.env` 파일에 `MCP_AUTH_TOKEN`을 **반드시** 설정해야 합니다.

보안 토큰 생성:

```bash
# 방법 1: Node.js (권장 - .env.example 참조)
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 방법 2: OpenSSL
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

`.env` 파일 수정:

```env
MCP_AUTH_TOKEN=생성된-토큰-여기에
```

서비스 재시작:

```bash
docker compose restart
# 또는: docker-compose restart
```

**지원되는 인증 방식:**

1. **Authorization 헤더** (가장 안전함): `Authorization: Bearer TOKEN`

   - API 클라이언트 및 자동화 도구에 권장
   - MCP 사양 준수
   - 예시: `curl -H "Authorization: Bearer YOUR_TOKEN"`

2. **X-Chroma-Token 헤더**: `X-Chroma-Token: TOKEN`

   - ChromaDB Python/JavaScript 라이브러리용
   - ChromaDB 클라이언트 SDK와 호환
   - 예시: `client = chromadb.HttpClient(headers={"X-Chroma-Token": "TOKEN"})`

3. **Query Parameter** (기본 활성화): `?apiKey=TOKEN`
   - **Claude Desktop Custom Connector에 필수**
   - 브라우저 기반 통합 지원
   - 기본적으로 활성화됨 (`ALLOW_QUERY_AUTH=true`)
   - 필요하지 않은 경우 `ALLOW_QUERY_AUTH=false`로 비활성화 가능

### Origin 헤더 검증 (DNS Rebinding 방어)

서버는 브라우저 요청에 대해 `Origin` 헤더를 검증하여 DNS rebinding 공격을 방지합니다. 이 보안 기능은 기본적으로 활성화되어 있으며 로컬 MCP 서버를 악의적인 웹사이트로부터 보호합니다.

**기본 허용 origin (항상 허용됨):**

- **Localhost 변형**: `localhost`, `127.0.0.1`, `[::1]`
- **Claude.ai 도메인**: `https://claude.ai`, `https://api.anthropic.com`

**추가 허용 origin 설정:**

추가 웹 애플리케이션이나 커스텀 도메인을 허용해야 하는 경우, `.env` 파일의 `ALLOWED_ORIGINS`에 추가하세요:

```env
# 추가 커스텀 도메인 설정 (Claude.ai는 기본으로 허용됨)
ALLOWED_ORIGINS=https://myapp.com,https://yourdomain.com
```

**ALLOWED_ORIGINS 설정이 필요한 경우:**

- ✅ Claude Desktop Custom Connector 사용 → **설정 불필요** (기본 허용)
- ✅ 커스텀 웹 애플리케이션에서 접근 → 애플리케이션 도메인 추가
- ✅ Swagger UI 원격 접근 → 서버 도메인 추가
- ❌ Claude Code CLI 사용 → 불필요 (Origin 헤더 없음)
- ❌ Python/JavaScript 클라이언트 사용 → 불필요 (Origin 헤더 없음)
- ❌ 로컬 개발만 사용 → 불필요 (localhost는 기본 허용)

**설정 예시:**

```env
# 커스텀 웹 애플리케이션용
ALLOWED_ORIGINS=https://myapp.com,https://app.mycompany.com

# 여러 커스텀 도메인 (쉼표로 구분, 공백은 자동 제거)
ALLOWED_ORIGINS=https://myapp.com, https://api.example.com, https://dashboard.mycompany.com

# Claude.ai와 localhost만 필요한 경우 비워두기
ALLOWED_ORIGINS=
```

**참고:** Claude.ai 도메인(`https://claude.ai`, `https://api.anthropic.com`)과 localhost는 `ALLOWED_ORIGINS`가 비어있어도 항상 허용됩니다. Origin 헤더가 없는 서버 간 요청은 항상 허용됩니다.

### 데이터 저장 설정

ChromaDB 데이터는 세 가지 방식으로 저장할 수 있습니다:

1. **Docker 볼륨 (기본값)**: `CHROMA_DATA_PATH=chroma-data`

   - Docker가 관리
   - 컨테이너 재시작 후에도 유지됨
   - `docker volume ls` 및 `docker volume inspect chroma-data` 명령어로 위치 확인

2. **로컬 디렉토리**: `CHROMA_DATA_PATH=./data`

   - 백업 및 접근이 용이함
   - 설치 디렉토리에 저장됨

3. **커스텀 경로**: `CHROMA_DATA_PATH=/path/to/data`
   - 절대 경로여야 함
   - 외부 스토리지 마운트에 유용함

`CHROMA_DATA_PATH` 변경 후 서비스를 재시작하세요:

```bash
docker compose restart
```

---

## Claude 연결

### Claude Desktop + Mobile

**방법 1: Custom Connector (권장 - Pro/Team/Enterprise)**

1. Claude Desktop → Settings → Integrations → Custom Connector 열기
2. "Add Custom Server" 클릭
3. 입력:
   - **Name**: `ChromaDB`
   - **URL**: `https://your-server.com/mcp?apiKey=YOUR_TOKEN`

> **참고**: Custom connector는 모바일 앱에 자동으로 동기화됩니다. 원격 접근 시 인증이 필수입니다.

**방법 2: mcp-remote 래퍼 (Free/Pro 사용자)**

Custom Connector 접근 권한이 없는 경우 `mcp-remote` 패키지를 사용하세요:

**설정 파일 위치:**

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**설정 파일에 추가:**

```json
{
  "mcpServers": {
    "chromadb": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-server.com/mcp?apiKey=YOUR_TOKEN"]
    }
  }
}
```

파일 수정 후 Claude Desktop을 재시작하세요.

> **중요**: 원격 MCP 서버는 `claude_desktop_config.json`에서 `streamableHttp` transport를 사용하여 직접 설정할 수 없습니다. Custom Connector 또는 `mcp-remote` 래퍼 패키지를 사용해야 합니다.

### Claude Code

**CLI 명령어:**

```bash
# 인증 없이
claude mcp add --transport http chromadb https://your-server.com/mcp

# 인증 포함 (Query Parameter - 권장)
claude mcp add --transport http chromadb https://your-server.com/mcp?apiKey=YOUR_TOKEN

# 인증 포함 (Header)
claude mcp add --transport http chromadb https://your-server.com/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"

# 확인
claude mcp list
```

---

## 사용 가능한 도구

MCP 서버는 Claude용으로 다음 도구를 제공합니다:

### 컬렉션 관리

- `chroma_list_collections` - 모든 컬렉션 목록 조회
- `chroma_create_collection` - 새 컬렉션 생성
- `chroma_delete_collection` - 컬렉션 삭제
- `chroma_get_collection_info` - 컬렉션 메타데이터 조회
- `chroma_get_collection_count` - 문서 개수 조회
- `chroma_peek_collection` - 컬렉션 내용 미리보기

### 문서 작업

- `chroma_add_documents` - 임베딩과 함께 문서 추가
- `chroma_query_documents` - 의미 검색 (벡터 유사도)
- `chroma_get_documents` - ID 또는 필터로 문서 조회
- `chroma_update_documents` - 기존 문서 수정
- `chroma_delete_documents` - 문서 삭제

---

## Python에서 ChromaDB 사용하기

MCP 서버는 모든 ChromaDB REST API 엔드포인트를 프록시하여 Python 클라이언트의 직접 접근을 허용합니다.

### Python 예제

```python
import chromadb

# HTTPS (Tailscale Funnel, 공개 배포)
client = chromadb.HttpClient(
    host="your-server.com",
    port=443,
    ssl=True,
    headers={
        "X-Chroma-Token": "YOUR_TOKEN"
    }
)

# 로컬 개발 (HTTP)
client = chromadb.HttpClient(
    host="localhost",
    port=8080,
    ssl=False,
    headers={
        "X-Chroma-Token": "YOUR_TOKEN"
    }
)

# 사용
collection = client.create_collection("my_collection")
collection.add(
    documents=["문서 1", "문서 2"],
    ids=["id1", "id2"]
)
results = collection.query(query_texts=["검색어"], n_results=2)
```

대체 인증 방법:

```python
from chromadb.config import Settings

client = chromadb.HttpClient(
    host="your-server.com",
    port=443,
    ssl=True,
    settings=Settings(
        chroma_client_auth_provider="chromadb.auth.token_authn.TokenAuthClientProvider",
        chroma_client_auth_credentials="YOUR_TOKEN"
    )
)
```

### API 문서

ChromaDB REST API 엔드포인트의 Swagger UI 문서: `https://your-server.com/docs`

---

## 배포

### 옵션 1: Tailscale VPN (권장)

**Tailscale 네트워크 내에서 안전한 접근:**

```bash
# 서비스 시작
docker compose up -d

# Tailscale Serve 활성화 (자동 인증서가 포함된 HTTPS)
tailscale serve https / http://127.0.0.1:8080

# 상태 확인
tailscale serve status
```

이제 서버는 Tailnet의 모든 기기에서 `https://your-machine.tailXXXXX.ts.net`으로 접근할 수 있습니다.

**장점:**

- 자동 HTTPS 인증서
- 공개 인터넷 노출 없음
- 암호화된 VPN 터널
- 인증 선택 사항 (VPN이 보안 계층 제공)

### 옵션 2: Tailscale Funnel (공개 인터넷)

**Claude Desktop UI Custom Connector를 사용하거나 공개적으로 공유하려면:**

```bash
# Funnel 활성화 (공개 인터넷 접근 허용)
tailscale funnel 8080 on
tailscale serve https / http://127.0.0.1:8080

# Funnel이 활성화되었는지 확인
tailscale serve status  # "Funnel on" 표시되어야 함
```

> **경고**: 이는 서버를 공개 인터넷에 노출합니다. **인증이 필수입니다!** 환경에 `MCP_AUTH_TOKEN`을 설정하세요.

**Funnel 비활성화:**

```bash
tailscale funnel 8080 off
```

### 옵션 3: Cloudflare Tunnel

```bash
# cloudflared 설치
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared

# 인증
./cloudflared tunnel login

# 터널 생성
./cloudflared tunnel create chroma-mcp

# 터널 실행
./cloudflared tunnel --url http://localhost:3000
```

### 옵션 4: Nginx 리버스 프록시

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 보안

### 코드 품질 및 보안 분석

이 프로젝트는 엄격한 보안 관행을 따르며 정적 분석으로 식별된 모든 보안 문제를 해결했습니다:

- ✅ **활성 이슈 0개**: 모든 OWASP 및 CWE 보안 문제 해결 완료
- 🔒 **정적 분석**: [DeepSource](https://app.deepsource.com/report/1328a083-a457-4598-b56f-e64dafdbcc28)를 통한 지속적인 모니터링
- 🛡️ **보안 표준**: OWASP Top 10 및 Node.js 보안 모범 사례 준수
- 📊 **자동 스캔**: Dependabot, CodeQL, 컨테이너 취약점 스캐닝

자세한 보안 정보는 [보안 정책](SECURITY.md)을 참조하세요.

### 보안 권장사항

1. **공개 접근을 위한 인증 활성화**

   - Tailscale Funnel이나 공개 인터넷 사용 시 `MCP_AUTH_TOKEN` 설정
   - 강력한 토큰 생성: `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`
   - 정기적으로 토큰 교체

2. **HTTPS 사용**

   - Tailscale은 자동 HTTPS 인증서 제공
   - 기타 배포의 경우 Let's Encrypt와 함께 리버스 프록시(Nginx/Caddy) 사용

3. **공개 인터넷보다 VPN 선호**

   - Tailscale Serve(VPN 전용)가 Funnel(공개)보다 안전
   - VPN 내에서는 인증이 선택 사항이지만 공개 접근에는 필수

4. **접근 모니터링**

   ```bash
   # 무단 접근 시도 확인
   docker compose logs mcp-server | grep "Unauthorized"
   ```

5. **네트워크 격리**
   - ChromaDB를 프라이빗 네트워크에 유지
   - MCP 서버만 공개 인터넷에 노출

---

## 테스트

### 로컬 테스트

```bash
# 헬스 체크
curl http://localhost:3000/health

# MCP 도구 목록
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# ChromaDB heartbeat
curl http://localhost:3000/api/v2/heartbeat
```

### 원격 테스트 (인증 포함)

```bash
# MCP 엔드포인트 (Bearer 토큰)
curl -X POST https://your-server.com/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# MCP 엔드포인트 (Query parameter)
curl -X POST "https://your-server.com/mcp?apiKey=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# ChromaDB REST API
curl https://your-server.com/api/v2/heartbeat \
  -H "X-Chroma-Token: YOUR_TOKEN"

# Swagger UI (브라우저)
https://your-server.com/docs?apiKey=YOUR_TOKEN
```

---

## 문제 해결

### ChromaDB 연결 실패

```bash
# ChromaDB가 실행 중인지 확인
curl http://localhost:8000/api/v2/heartbeat

# Docker로 ChromaDB 시작
docker run -d -p 8000:8000 chromadb/chroma:latest

# MCP 서버 로그 확인
docker compose logs mcp-server
```

### MCP 서버가 응답하지 않음

```bash
# 로그 확인
docker compose logs mcp-server

# 포트 충돌 확인
lsof -i :3000

# 서비스 재시작
docker compose restart
```

### Claude Desktop 연결 문제

1. Claude Desktop 재시작
2. URL에 `/mcp` 경로가 포함되어 있는지 확인
3. 전송 타입이 `streamableHttp`인지 확인 (`sse` 아님)
4. 인증이 활성화된 경우 인증 토큰 확인
5. Custom Connector용: Tailscale Funnel이 활성화되어 있는지 확인

### 로컬 네트워크에서 TLS Handshake 타임아웃

서버와 같은 로컬 네트워크에서 Tailscale Funnel HTTPS로 접속하는 경우:

**문제**: 같은 네트워크에서 `https://your-server.ts.net` 접속 시 TLS handshake 타임아웃 발생.

**원인**: Tailscale Funnel은 같은 LAN의 클라이언트가 공개 Funnel 도메인으로 접속할 때 TLS 종료 처리에 문제가 있음.

**해결**: Tailscale HTTPS 대신 로컬 네트워크 직접 연결 사용:

```bash
# 기존 설정 제거
claude mcp remove chromadb

# 로컬 IP 주소로 추가
claude mcp add chromadb --transport http \
  http://192.168.x.x:8080/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"

# 또는 DNS가 동작하면 호스트명 사용
claude mcp add chromadb --transport http \
  http://server-hostname:8080/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"
```

**확인**:
```bash
# 로컬 네트워크 연결 테스트
curl http://192.168.x.x:8080/health

# 응답: {"status":"ok","service":"chroma-remote-mcp",...}
```

**참고**: 외부 클라이언트는 계속 Tailscale Funnel HTTPS를 사용하면 됩니다. 이 문제는 서버와 같은 LAN의 클라이언트에만 해당됩니다.

### 인증 오류 (401)

```bash
# MCP_AUTH_TOKEN이 설정되어 있는지 확인
docker compose exec mcp-server env | grep MCP_AUTH_TOKEN

# 토큰 없이 테스트 (401 실패 예상)
curl -X POST https://your-server.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# 올바른 토큰으로 테스트 (성공 예상)
curl -X POST https://your-server.com/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

---

## 개발

### 소스에서 빌드

```bash
# 저장소 클론
git clone https://github.com/meloncafe/chromadb-remote-mcp.git
cd chromadb-remote-mcp

# 의존성 설치
yarn install

# 개발 모드 (자동 재로드)
yarn dev

# TypeScript 빌드
yarn build

# 타입 체크
yarn type-check
```

### 테스팅

프로젝트는 Docker 기반 E2E 검증을 포함한 통합 테스트를 제공합니다:

```bash
# 모든 테스트 실행 (서비스 시작, 테스트 실행, 정리)
yarn test

# 테스트 실행 후 컨테이너 유지 (디버깅용)
yarn test:keep

# 옵션이 있는 수동 테스트 스크립트
./scripts/test.sh --help
```

**통합 테스트 커버리지:**

- ✅ 헬스 체크 엔드포인트
- ✅ 인증 (Bearer 토큰, X-Chroma-Token, 쿼리 파라미터)
- ✅ MCP 프로토콜 (tools/list, tools/call)
- ✅ ChromaDB REST API 프록시
- ✅ 컬렉션 CRUD 작업
- ✅ Rate limiting
- ✅ 비인증 접근 처리

**단위 테스트:**

```bash
# 단위 테스트 실행
yarn test:unit

# watch 모드로 실행
yarn test:unit:watch

# 커버리지와 함께 실행
yarn test:unit:coverage

# 모든 테스트 실행 (단위 + 통합)
yarn test:all
```

**단위 테스트 커버리지:**

- ✅ 인증 유틸리티 (timing-safe 비교, 버퍼 작업)
- ✅ 입력 검증 (컬렉션 이름, 문서 ID, 메타데이터)
- ✅ 데이터 처리 (응답 포맷팅, JSON 직렬화)
- ✅ 에러 메시지 포맷팅

자세한 테스팅 전략은 `__tests__/README.md`를 참조하세요.

### 코드 품질 및 커버리지

이 프로젝트는 코드 커버리지 추적 및 테스트 분석을 위해 [Codecov](https://codecov.io/gh/meloncafe/chromadb-remote-mcp)를 사용합니다.

### Docker 개발

#### 로컬 빌드 및 테스트

```bash
# 로컬 테스트용 빌드 (단일 플랫폼, Docker에 로드)
yarn docker:build:local

# 또는 스크립트 직접 사용
./scripts/build.sh --platform linux/amd64 --load

# 빌드된 이미지 테스트
docker run -p 3000:3000 \
  -e MCP_AUTH_TOKEN=test123 \
  devsaurus/chromadb-remote-mcp:latest
```

#### 멀티 플랫폼 빌드

```bash
# 모든 플랫폼용 빌드 (amd64, arm64)
yarn docker:build

# 커스텀 버전으로 빌드
./scripts/build.sh --version 1.2.3

# 커스텀 저장소로 빌드
./scripts/build.sh --repo myuser/my-mcp --version dev
```

#### Docker Hub에 푸시

```bash
# latest 태그 푸시
yarn docker:push

# 특정 버전 푸시
VERSION=1.2.3 yarn docker:push

# 또는 스크립트 직접 사용
./scripts/build.sh --version 1.2.3 --push

# 커스텀 저장소 사용
DOCKER_REPO=myuser/my-mcp ./scripts/build.sh --version 1.2.3 --push
```

**Docker 스크립트용 환경 변수:**

```bash
export DOCKER_REPO=myuser/my-mcp       # Docker 저장소
export VERSION=1.2.3                    # 이미지 버전 태그
export DOCKER_USERNAME=myuser           # 푸시 인증용
export DOCKER_PASSWORD=mytoken          # Docker Hub 토큰
```

### 개발 스크립트

모든 개발 스크립트는 `scripts/` 디렉토리에 있습니다:

| 스크립트     | 목적                       | 사용법                      |
| ------------ | -------------------------- | --------------------------- |
| `build.sh`   | Docker 이미지 빌드 및 푸시 | `./scripts/build.sh --help` |
| `test.sh`    | 통합 테스트 실행           | `./scripts/test.sh --help`  |
| `install.sh` | 원 커맨드 설치             | `curl ... \| bash`          |

**빠른 개발 워크플로:**

```bash
# 1. 코드 변경
vim src/index.ts

# 2. 로컬 테스트
yarn dev

# 3. 통합 테스트 실행
yarn test

# 4. Docker 이미지 빌드
yarn docker:build:local

# 5. Docker 이미지 테스트
docker-compose up

# 6. 모든 것이 정상이면 멀티 플랫폼 빌드 및 푸시
./scripts/build.sh --version 1.2.3 --push
```

### 프로젝트 구조

```
chromadb-remote-mcp/
├── .github/
│   ├── ISSUE_TEMPLATE/       # GitHub 이슈 템플릿
│   └── workflows/            # GitHub Actions (publish-release, security-scan, chromadb-version-check)
├── scripts/
│   ├── build.sh             # Docker 빌드 및 푸시 스크립트 (멀티 플랫폼)
│   ├── test.sh              # 통합 테스트 러너
│   └── install.sh           # 원 커맨드 설치
├── src/
│   ├── index.ts             # 메인 서버 진입점
│   ├── chroma-tools.ts      # MCP 도구 정의 및 핸들러
│   └── types.ts             # TypeScript 타입 정의
├── docker-compose.yml       # 프로덕션 (사전 빌드된 이미지)
├── docker-compose.dev.yml   # 개발 (소스에서 빌드)
├── Dockerfile               # MCP 서버 Docker 이미지
├── .env.example             # 환경 변수 템플릿
├── package.json             # Node.js 의존성
├── tsconfig.json            # TypeScript 설정
├── SECURITY.md              # 보안 정책
├── CONTRIBUTING.md          # 기여 가이드라인
├── CODE_OF_CONDUCT.md       # 행동 강령
├── CHANGELOG.md             # 버전 히스토리
└── LICENSE                  # MIT 라이선스
```

---

## 기여

기여를 환영합니다! 이슈와 풀 리퀘스트를 자유롭게 제출해 주세요.

1. 저장소 포크
2. 기능 브랜치 생성 (`git checkout -b feature/amazing-feature`)
3. 변경사항 커밋 (`git commit -m 'Add amazing feature'`)
4. 브랜치에 푸시 (`git push origin feature/amazing-feature`)
5. Pull Request 열기

---

## 라이선스

[MIT License](LICENSE)

---

## 참고 자료

- [MCP 스펙](https://modelcontextprotocol.io/specification/2025-06-18/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [ChromaDB 문서](https://docs.trychroma.com/)
- [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve/)
- [Tailscale Funnel](https://tailscale.com/kb/1223/funnel)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)

---

## 지원

문제가 발생하거나 질문이 있으시면 [이슈를 열어주세요](https://github.com/meloncafe/chromadb-remote-mcp/issues).
