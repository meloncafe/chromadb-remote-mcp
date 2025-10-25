# ChromaDB Remote MCP Server 기여 가이드

[English](CONTRIBUTING.md) | 한국어

ChromaDB Remote MCP Server에 기여해 주셔서 감사합니다! 커뮤니티의 기여를 환영합니다.

## 목차

- [행동 강령](#행동-강령)
- [기여 방법](#기여-방법)
- [개발 환경 설정](#개발-환경-설정)
- [Pull Request 프로세스](#pull-request-프로세스)
- [코딩 표준](#코딩-표준)
- [테스팅](#테스팅)
- [문서화](#문서화)

## 행동 강령

이 프로젝트와 참여하는 모든 사람은 [행동 강령](CODE_OF_CONDUCT.ko.md)의 적용을 받습니다. 참여함으로써 이 규칙을 준수할 것으로 예상됩니다.

## 기여 방법

### 버그 보고

버그 보고를 작성하기 전에 중복을 피하기 위해 [기존 이슈](https://github.com/meloncafe/chromadb-remote-mcp/issues)를 확인하십시오.

버그 보고를 작성할 때 다음을 포함하십시오:

- 명확하고 설명적인 제목
- 문제를 재현하는 상세한 단계
- 예상 동작 vs 실제 동작
- 환경 정보 (OS, Docker 버전 등)
- 관련 로그 (`.github/ISSUE_TEMPLATE/bug_report.md` 참조)

### 개선 제안

개선 제안은 GitHub 이슈로 추적됩니다. 개선 제안을 작성할 때:

- 명확하고 설명적인 제목 사용
- 제안된 개선 사항에 대한 상세한 설명 제공
- 이 개선 사항이 유용한 이유 설명
- 고려한 대안 나열

### 코드 기여

1. 저장소 포크
2. 기능 브랜치 생성 (`git checkout -b feature/amazing-feature`)
3. 변경 사항 작성
4. 변경 사항 테스트
5. 변경 사항 커밋 ([커밋 메시지](#커밋-메시지) 참조)
6. 포크에 푸시 (`git push origin feature/amazing-feature`)
7. Pull Request 열기

## 개발 환경 설정

### 필수 요구사항

- Node.js >= 20.0.0
- Yarn >= 1.22.22
- Docker 및 Docker Compose (테스팅용)
- Git

### 로컬 개발

```bash
# 포크 클론
git clone https://github.com/YOUR_USERNAME/chromadb-remote-mcp.git
cd chromadb-remote-mcp

# 의존성 설치
yarn install

# 환경 변수 복사
cp .env.example .env
# .env 파일 편집

# ChromaDB 시작 (다른 터미널에서)
docker run -d -p 8000:8000 chromadb/chroma:latest

# 자동 재시작 개발 모드
yarn dev

# TypeScript 빌드
yarn build

# 프로덕션 빌드 실행
yarn start
```

### Docker 개발

```bash
# 모든 서비스 시작 (ChromaDB + MCP 서버)
docker compose -f docker-compose.dev.yml up

# 로그 보기
docker compose -f docker-compose.dev.yml logs -f

# 코드 변경 후 재빌드
docker compose -f docker-compose.dev.yml up --build
```

## Pull Request 프로세스

### 제출 전

1. **변경 사항 테스트**: 코드가 예상대로 작동하는지 확인
2. **타입 체크**: `yarn type-check`를 실행하여 TypeScript 타입 확인
3. **빌드**: `yarn build`를 실행하여 코드가 컴파일되는지 확인
4. **문서화**: 필요한 경우 README.md 업데이트
5. **변경 로그**: CHANGELOG.md에 변경 사항 추가 ("Unreleased" 아래)

### PR 가이드라인

- **PR당 하나의 기능**: Pull Request를 단일 기능이나 버그 수정에 집중
- **명확한 설명**: 무엇을 변경했고 왜 변경했는지 설명
- **이슈 링크**: 관련 이슈 참조 (예: "Fixes #123")
- **작은 커밋**: 명확한 메시지로 원자적 커밋 작성
- **테스트 업데이트**: 변경 사항에 대한 테스트 추가 또는 업데이트 (해당하는 경우)

### PR 템플릿

```markdown
## 설명

변경 사항에 대한 간략한 설명

## 변경 유형

- [ ] 버그 수정 (이슈를 수정하는 비호환 변경)
- [ ] 새로운 기능 (기능을 추가하는 비호환 변경)
- [ ] 호환성 손상 변경 (기존 기능을 변경하는 수정 또는 기능)
- [ ] 문서 업데이트

## 테스팅

- [ ] Docker로 로컬 테스트
- [ ] Claude Desktop으로 테스트
- [ ] 인증 방법 테스트
- [ ] 오류 케이스 테스트

## 체크리스트

- [ ] 코드가 프로젝트의 코딩 표준을 따름
- [ ] 문서 업데이트
- [ ] 테스트 추가/업데이트 (해당하는 경우)
- [ ] CHANGELOG.md 업데이트
- [ ] 모든 테스트가 로컬에서 통과
```

## 코딩 표준

### TypeScript 스타일

- 모든 새 코드에 TypeScript 사용
- 엄격한 타입 검사 활성화
- 객체 형태에 대해 type alias보다 interface 선호
- 의미 있는 변수 및 함수 이름 사용
- 공개 API에 대한 JSDoc 주석 추가

### 코드 포맷팅

```typescript
// 좋음: 명확하고, 타입이 지정되고, 문서화됨
interface ChromaConfig {
  host: string;
  port: number;
  authToken?: string;
}

/**
 * 구성으로 ChromaDB 클라이언트 초기화
 */
function initChromaClient(config: ChromaConfig): ChromaClient {
  return new ChromaClient(config);
}

// 나쁨: 타입이 지정되지 않고, 불명확함
function init(c: any) {
  return new ChromaClient(c);
}
```

### 파일 구조

```
src/
├── index.ts           # 메인 서버 진입점
├── chroma-tools.ts    # MCP 도구 정의
├── types.ts           # TypeScript 타입 정의
└── utils/             # 유틸리티 함수 (필요한 경우)
```

### 커밋 메시지

[Conventional Commits](https://www.conventionalcommits.org/) 사양을 따르십시오:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**타입**:

- `feat`: 새로운 기능
- `fix`: 버그 수정
- `docs`: 문서 변경
- `refactor`: 코드 리팩토링
- `test`: 테스트 추가 또는 업데이트
- `chore`: 유지보수 작업
- `perf`: 성능 개선
- `security`: 보안 수정

**예제**:

```bash
feat(auth): API 키 로테이션 지원 추가
fix(proxy): ChromaDB 연결 타임아웃 처리
docs(readme): 설치 지침 업데이트
refactor(tools): 컬렉션 생성 로직 단순화
security(auth): 상수 시간 토큰 비교 구현
```

## 테스팅

### 수동 테스팅

```bash
# 헬스 체크
curl http://localhost:3000/health

# MCP 엔드포인트 테스트 (인증 없이)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# MCP 엔드포인트 테스트 (인증 포함)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# ChromaDB 프록시 테스트
curl http://localhost:3000/api/v2/heartbeat
```

### 통합 테스팅

Claude Desktop으로 테스트:

```bash
# 서비스 시작
docker compose up -d

# Claude Desktop 구성에 추가
claude mcp add --transport http chromadb http://localhost:8080/mcp

# Claude Desktop에서 테스트
# Claude에게 질문: "내 ChromaDB 컬렉션 나열"
```

## 문서화

### 문서 업데이트 시기

다음을 수행할 때 문서를 업데이트하십시오:

- 새로운 기능 추가
- 기존 동작 변경
- 새로운 구성 옵션 추가
- 사용자에게 영향을 줄 수 있는 버그 수정

### 문서 파일

- `README.md`: 메인 문서 (영어)
- `README.ko.md`: 메인 문서 (한국어)
- `SECURITY.md`: 보안 정책 (영어)
- `SECURITY.ko.md`: 보안 정책 (한국어)
- `CONTRIBUTING.md`: 이 파일 (영어)
- `CONTRIBUTING.ko.md`: 이 파일
- 코드 주석: 복잡한 로직용

### 작성 스타일

- 명확하고 간결한 언어 사용
- 복잡한 기능에 대한 예제 제공
- 줄 길이를 120자 이하로 유지
- 구문 강조가 있는 코드 블록 사용
- UI 관련 변경 사항에 대한 스크린샷 포함

## 프로젝트 구조

```
chromadb-remote-mcp/
├── .github/              # GitHub 구성
│   ├── ISSUE_TEMPLATE/  # 이슈 템플릿
│   └── workflows/       # GitHub Actions
├── src/                 # 소스 코드
│   ├── index.ts        # 메인 서버
│   ├── chroma-tools.ts # MCP 도구
│   └── types.ts        # 타입 정의
├── docker-compose.yml   # 프로덕션 compose
├── docker-compose.dev.yml # 개발 compose
├── Dockerfile          # MCP 서버 이미지
├── package.json        # 의존성
├── tsconfig.json       # TypeScript 구성
├── .env.example        # 환경 템플릿
├── install.sh          # 설치 스크립트
├── README.md           # 문서 (영어)
├── README.ko.md        # 문서 (한국어)
├── SECURITY.md         # 보안 정책 (영어)
├── SECURITY.ko.md      # 보안 정책 (한국어)
├── CONTRIBUTING.md     # 기여 가이드 (영어)
├── CONTRIBUTING.ko.md  # 이 파일
├── CODE_OF_CONDUCT.md  # 행동 강령 (영어)
├── CODE_OF_CONDUCT.ko.md # 행동 강령 (한국어)
├── CHANGELOG.md        # 버전 히스토리
└── LICENSE             # MIT 라이선스
```

## 릴리스 프로세스

릴리스는 관리자가 처리합니다:

1. `package.json`에서 버전 업데이트
2. `CHANGELOG.md` 업데이트
3. git 태그 생성: `git tag -a v1.2.3 -m "Release v1.2.3"`
4. 태그 푸시: `git push origin v1.2.3`
5. GitHub Actions가 자동으로 Docker 이미지 빌드 및 게시
6. 변경 로그가 포함된 GitHub 릴리스 생성

## 도움 받기

- **문서**: [README.md](README.ko.md) 확인
- **질문**: [GitHub 이슈](https://github.com/meloncafe/chromadb-remote-mcp/issues)에서 질문

## 인정

기여자는 다음과 같이 인정받습니다:

- 릴리스 노트에 나열
- 프로젝트 README에 크레딧 (중요한 기여에 대해)
- 보안 권고에서 크레딧 (보안 보고에 대해)

ChromaDB Remote MCP Server에 기여해 주셔서 감사합니다!
