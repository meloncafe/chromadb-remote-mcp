# 보안 정책

[English](SECURITY.md) | 한국어

## 지원 버전

보안 취약점에 대한 패치를 릴리스합니다. 패치를 받을 수 있는 버전은 CVSS v3.0 등급에 따라 다릅니다:

| 버전  | 지원 여부          |
| ----- | ------------------ |
| 1.x.x | :white_check_mark: |
| < 1.0 | :x:                |

## 취약점 보고

ChromaDB Remote MCP Server의 보안을 중요하게 생각합니다. 보안 취약점을 발견했다고 생각되면 아래 설명된 대로 보고해 주십시오.

### 보안 취약점 보고 방법

**공개 GitHub 이슈를 통해 보안 취약점을 보고하지 마십시오.**

대신 다음을 통해 보고하십시오:

1. **GitHub Security Advisories**: [Security 탭](https://github.com/meloncafe/chromadb-remote-mcp/security/advisories)으로 이동하여 "Report a vulnerability" 클릭
2. **이메일**: GitHub 프로필 연락처를 통해 관리자에게 이메일 전송

보고서에 다음 정보를 포함하십시오:

- 이슈 유형 (예: 버퍼 오버플로우, SQL 인젝션, 크로스사이트 스크립팅 등)
- 이슈의 표현과 관련된 소스 파일의 전체 경로
- 영향을 받는 소스 코드의 위치 (태그/브랜치/커밋 또는 직접 URL)
- 이슈를 재현하는 데 필요한 특별한 구성
- 이슈를 재현하는 단계별 지침
- 개념 증명 또는 익스플로잇 코드 (가능한 경우)
- 공격자가 이슈를 악용할 수 있는 방법을 포함한 이슈의 영향

### 예상되는 내용

- **확인**: 48시간 이내에 이메일 확인
- **커뮤니케이션**: 취약점 수정 진행 상황에 대해 계속 알림
- **크레딧**: 보안 권고에서 크레딧 (익명을 선호하지 않는 한)
- **타임라인**: 중요한 취약점은 7일 이내, 기타 취약점은 30일 이내에 수정 목표

## 보안 모범 사례

ChromaDB Remote MCP Server를 배포할 때:

### 1. 인증

- 서버를 공개 인터넷에 노출할 때 **항상** `MCP_AUTH_TOKEN` 설정
- 강력하고 무작위로 생성된 토큰 사용 (최소 32바이트)
- 정기적으로 토큰 로테이션 (권장: 90일마다)
- 버전 관리에 토큰 커밋 금지

안전한 토큰 생성:

```bash
# 방법 1: Node.js (권장)
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 방법 2: OpenSSL
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

### 2. 네트워크 보안

- **HTTPS 사용**: 프로덕션에서 항상 HTTPS 사용 (Tailscale, 리버스 프록시 등)
- **VPN 우선**: Tailscale Serve (VPN 전용)를 Funnel (공개 인터넷)보다 선호
- **방화벽**: 가능한 경우 알려진 IP 주소로 액세스 제한
- **Docker 네트워크**: ChromaDB를 프라이빗 Docker 네트워크에 유지

### 3. Docker 보안

- Docker 이미지를 최신 상태로 유지: `docker compose pull && docker compose up -d`
- 프로덕션에서 `latest` 대신 특정 버전 태그 사용
- 최소 권한으로 컨테이너 실행
- 정기적으로 컨테이너 로그에서 의심스러운 활동 검토

### 4. 데이터 보호

- **백업**: ChromaDB 데이터를 정기적으로 백업 (`CHROMA_DATA_PATH` 참조)
- **저장 시 암호화**: 민감한 데이터에 암호화된 볼륨 사용
- **액세스 제어**: 데이터 디렉토리에 대한 파일 시스템 액세스 제한

### 5. 모니터링

```bash
# 인증 실패 모니터링
docker compose logs mcp-server | grep "Unauthorized"

# 비정상적인 트래픽 패턴 확인
docker compose logs caddy | grep -E "POST /mcp"

# 리소스 사용 모니터링
docker stats
```

## 알려진 보안 고려사항

### URL의 인증 토큰

쿼리 매개변수 인증 (`?apiKey=TOKEN`)을 사용할 때 다음 사항에 유의하십시오:

- 토큰이 서버 로그에 나타날 수 있음
- 토큰이 브라우저 히스토리에 캐시될 수 있음
- 더 나은 보안을 위해 헤더 기반 인증 사용 고려

### ChromaDB 보안

- 기본 구성에서 ChromaDB는 인증 없이 실행
- MCP 서버가 인증 게이트웨이 역할
- ChromaDB는 인터넷에 직접 노출되지 않음
- MCP 서버(인증 포함)만 공개적으로 액세스 가능

### Rate Limiting

- 서버에는 내장 속도 제한 포함 (IP당 15분 동안 100개 요청)
- 필요한 경우 환경 변수를 통해 제한 조정
- 리버스 프록시 수준에서 추가 속도 제한 고려

## 보안 기능

### Content Security Policy (CSP)

서버는 XSS 및 코드 인젝션 공격을 방지하기 위해 엄격한 Content Security Policy를 구현합니다:

```
default-src 'none'           # 기본적으로 모든 것을 차단
script-src 'self'           # 동일 출처의 스크립트만
connect-src 'self'          # 동일 출처로의 fetch/XHR만
img-src 'self' data:        # 동일 출처의 이미지 + data URI
style-src 'self' 'unsafe-inline'  # 스타일 (Swagger UI용 unsafe-inline)
font-src 'self'             # 동일 출처의 폰트
frame-ancestors 'none'      # iframe 임베딩 방지
base-uri 'self'             # <base> 태그 제한
form-action 'self'          # 폼 제출 제한
```

**스타일에 `'unsafe-inline'`을 사용하는 이유는?**

- Swagger UI 문서 인터페이스에 필요
- 스타일은 여전히 동일 출처로 제한됨
- 보안과 기능 사이의 절충

### 기타 보안 헤더

- **X-Frame-Options**: `DENY` - 클릭재킹 방지
- **X-Content-Type-Options**: `nosniff` - MIME 스니핑 방지
- **Referrer-Policy**: `strict-origin-when-cross-origin` - 민감한 URL 유출 방지
- **Permissions-Policy**: 브라우저 기능 제한 (지리적 위치, 마이크, 카메라)
- **HSTS**: `max-age=31536000; includeSubDomains` - HTTPS 강제 (프록시 뒤에 있을 때)

## 보안 업데이트

- **이 저장소 감시**하여 보안 업데이트에 대한 알림 받기
- 포크에서 **Dependabot 알림 활성화**하여 의존성 취약점 추적
- **릴리스 구독**하여 보안 패치에 대한 정보 유지

## 보안 스캐닝

이 프로젝트는 자동화된 보안 스캐닝을 사용합니다:

- **Dependabot**: 자동 의존성 취약점 알림
- **CodeQL**: 정적 애플리케이션 보안 테스팅 (SAST)
- **Container Scanning**: Docker 이미지 취약점 스캐닝
- **DeepSource**: 지속적인 코드 품질 및 보안 분석
- **Manual Review**: 보안 영향에 대한 코드 변경 검토

### 정적 분석 결과

정적 분석으로 식별된 모든 보안 문제가 해결되었습니다:

- ✅ **OWASP 취약점**: 활성 이슈 없음
- ✅ **CWE 발견 사항**: 모든 발견 사항 해결 및 수정
- ✅ **코드 품질**: 업계 표준 및 모범 사례 충족

최신 분석 보고서 보기: [DeepSource 공개 보고서](https://app.deepsource.com/report/1c2f3d5c-df61-4e60-b20c-5a82adc729f7)

> **참고**: 코드가 업데이트되거나 월별로 보고서 링크가 변경될 수 있습니다. 현재 상태는 저장소 배지를 확인하십시오.

## 규정 준수

이 프로젝트는 다음의 보안 모범 사례를 따릅니다:

- OWASP Top 10
- Docker 보안 모범 사례
- Node.js 보안 모범 사례
- Model Context Protocol 보안 가이드라인

## 문의

취약점이 아닌 보안 관련 질문의 경우:

- [GitHub 이슈](https://github.com/meloncafe/chromadb-remote-mcp/issues)에서 이슈 열기
- 기존 이슈 및 문서 확인

## 공개 정책

책임 있는 공개 원칙을 따릅니다:

1. 보안 이슈가 비공개로 보고됨
2. 조사하고 수정 개발
3. 새 버전에서 수정 릴리스
4. 수정이 제공된 후 7일 후 보안 권고 게시
5. 보고자에게 크레딧 (허가 받은 경우)

## CVE 할당

다음 기준을 충족하는 취약점에 대해 CVE ID를 요청합니다:

- **중요/높은 심각도**: 인증 우회, 원격 코드 실행, 데이터 노출
- **광범위한 영향**: 지원되는 버전의 모든 사용자에게 영향
- **공개적으로 악용 가능**: 특별한 액세스 또는 구성이 필요하지 않음

CVE 요청은 다음을 통해 이루어집니다:

- GitHub Security Advisories
- MITRE CVE Request Form (백업)

ChromaDB Remote MCP Server와 사용자를 안전하게 유지하는 데 도움을 주셔서 감사합니다!
