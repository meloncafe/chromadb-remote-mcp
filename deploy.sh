#!/bin/bash
# ================================================================================
# chromadb-remote-mcp - deployment helper / 배포 도우미
#
# Usage / 사용법:  ./deploy.sh <command>
#
#   install  first-time setup / 최초 설치          update   pull + recreate / 갱신
#   start    start services / 기동                  stop     stop services / 정지
#   restart  restart services / 재시작              status   service status / 상태
#   logs     follow logs / 로그                     version  versions / 버전 확인
#   backup   back up chroma data / 데이터 백업      help     usage (en/ko) / 도움말
#   self-update [tag]  refresh deploy.sh + compose files from a release / 릴리스로 스크립트·compose 갱신
#
# Host-independent: everything host specific lives in .env (see .env.example) and
# optional extra compose files, never in this script.
# 호스트 독립: 호스트별 값은 모두 .env(.env.example 참고)와 선택적 추가 compose 파일에
# 두며, 이 스크립트에는 넣지 않는다.
#
# Environment / 환경변수 (process env overrides .env / 프로세스 환경이 .env 보다 우선):
#   DEPLOY_LANG=en|ko        message language / 메시지 언어 (default: from locale / 기본: 로캘)
#   COMPOSE_FILE=a.yml:b.yml colon-separated compose files, merged in order (compose
#                            standard) / 콜론으로 구분한 compose 파일 목록(compose 표준, 순서대로 병합)
#   COMPOSE_PROJECT_NAME     compose project name (compose standard) / 프로젝트명(compose 표준)
#   CHROMA_DATA_PATH         named volume (default chroma-data) or bind path / 데이터 위치
#   PORT, MCP_IMAGE_TAG      published port, mcp image tag / 공개 포트, mcp 이미지 태그
#   DRY_RUN=1                print the commands only, change nothing / 명령만 출력, 변경 없음
#   DEPLOY_DIR=<dir>         target directory (tests) / 대상 디렉터리(테스트용)
#   CHROMA_IMAGE=<ref>       image used by `backup` tar / backup 의 tar 에 쓸 이미지
# ================================================================================

set -euo pipefail

# Configuration / 설정 -----------------------------------------------------------
# Target directory: DEPLOY_DIR (tests) or this script's directory.
# 대상 디렉터리: DEPLOY_DIR(테스트) 또는 스크립트 위치.
SCRIPT_DIR="${DEPLOY_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
ENV_FILE="${SCRIPT_DIR}/.env"
BACKUP_DIR="backups"
MCP_IMAGE_REPO="devsaurus/chromadb-remote-mcp"

# Container names: must match container_name in docker-compose.yml.
# 컨테이너 이름: docker-compose.yml 의 container_name 과 일치해야 한다.
CHROMA_CONTAINER="chromadb"
MCP_CONTAINER="chroma-mcp-server"
PROXY_CONTAINER="caddy-proxy"

# Resolved state (globals filled by the helpers below) / 해석된 전역 상태
COMPOSE_FILES=()
COMPOSE_ARGS=()
LANG_SEL="en"
REPO_PIN=""
PIN_TAG=""
PIN_DIGEST=""
LOCAL_CHROMA_DIGEST=""
RESOLVED_CHROMA_VERSION="unknown"
RESOLVED_HUB_TAG=""
RESOLVED_HUB_DIGEST=""
SYNC_CHANGED=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# .env helpers / .env 헬퍼 ---------------------------------------------------------
# Reads KEY=VALUE from .env (last wins, quotes and edge spaces stripped, comments ignored).
# When the .env does not exist (DRY_RUN preview on a fresh clone) the same lookup falls
# back to the committed .env.example so plans reflect the template values; nothing is
# ever written.
# .env 에서 KEY=VALUE 를 읽는다(마지막 값 우선, 따옴표·양끝 공백 제거, 주석 무시).
# .env 가 없으면(DRY_RUN 미리보기) 같은 조회를 커밋된 .env.example 로 대체해 계획이
# 템플릿 값을 반영하게 한다. 아무 파일도 쓰지 않는다.
read_env_var() {
    local src="${ENV_FILE}"
    [ -f "${src}" ] || src="${ENV_FILE}.example"
    [ -f "${src}" ] || return 0
    grep -E "^[[:space:]]*$1=" "${src}" 2>/dev/null \
        | tail -1 | cut -d= -f2- | tr -d "\"'" \
        | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' || true
}

# Language / 언어 -----------------------------------------------------------------
# Priority: DEPLOY_LANG env > DEPLOY_LANG in .env > first non-empty of LC_ALL,
# LC_MESSAGES, LANG (POSIX order); "ko*" selects Korean, anything else English.
# 우선순위: DEPLOY_LANG 환경변수 > .env 의 DEPLOY_LANG > LC_ALL, LC_MESSAGES, LANG 중
# 처음 비어 있지 않은 값(POSIX 순서). "ko*" 이면 한국어, 그 외는 영어.
detect_lang() {
    local choice="${DEPLOY_LANG:-}" v=""
    if [ -z "${choice}" ]; then choice="$(read_env_var DEPLOY_LANG)"; fi
    if [ -z "${choice}" ]; then
        for v in "${LC_ALL:-}" "${LC_MESSAGES:-}" "${LANG:-}"; do
            if [ -n "${v}" ]; then choice="${v}"; break; fi
        done
    fi
    case "${choice}" in
        ko*|KO*) LANG_SEL="ko" ;;
        *)       LANG_SEL="en" ;;
    esac
}

# L "English" "한국어": prints the string for the selected language. Pairs sit side by
# side at every call site so a missing translation is visible in review.
# 선택된 언어의 문자열을 출력한다. 번역 누락이 리뷰에서 보이도록 쌍을 호출부에 나란히 둔다.
L() {
    if [ "${LANG_SEL}" = "ko" ]; then printf '%s' "$2"; else printf '%s' "$1"; fi
}

# Logging / 로깅 -------------------------------------------------------------------
log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1" >&2; }
log_debug() {
    if [ "${DEBUG:-0}" = "1" ]; then
        echo -e "${CYAN}[DEBUG]${NC} $1" >&2
    fi
}

# Execution helpers / 실행 헬퍼 ------------------------------------------------------
# DRY_RUN=1 never calls docker and never touches the filesystem: it prints the plan.
# DRY_RUN=1 은 docker 를 호출하지 않고 파일도 바꾸지 않으며 계획만 출력한다.
dry_run() { [ "${DRY_RUN:-0}" = "1" ]; }

run() {
    if dry_run; then
        log_info "[DRY-RUN] $*"
        return 0
    fi
    "$@"
}

# dc: mutating compose call (dry-run aware). dcq: read-only query, always real.
# dc: 변경 compose 호출(dry-run 반영). dcq: 조회 전용, 항상 실제 실행.
dc()  { run docker compose "${COMPOSE_ARGS[@]}" "$@"; }
dcq() { docker compose "${COMPOSE_ARGS[@]}" "$@"; }

check_docker() {
    if dry_run; then return 0; fi
    if ! command -v docker &> /dev/null; then
        log_error "$(L "Docker is not installed" "Docker 가 설치되어 있지 않습니다")"
        exit 1
    fi
    if ! docker compose version &> /dev/null; then
        log_error "$(L "Docker Compose is not available" "Docker Compose 를 사용할 수 없습니다")"
        exit 1
    fi
}

check_env() {
    [ -f "${ENV_FILE}" ] && return 0
    if dry_run; then
        # Preview on a fresh clone: warn and plan from the template / compose defaults
        # instead of failing; no .env is created. A real run still requires .env.
        # 새 클론 미리보기: 실패 대신 경고하고 템플릿·compose 기본값으로 계획을 출력한다.
        # .env 는 만들지 않는다. 실제 실행은 여전히 .env 가 필요하다.
        log_warning "$(L ".env not found: ${ENV_FILE} — planning from .env.example / compose defaults (DRY_RUN)" ".env 파일이 없습니다: ${ENV_FILE} — .env.example / compose 기본값으로 계획을 출력합니다 (DRY_RUN)")"
        return 0
    fi
    log_error "$(L ".env file not found: ${ENV_FILE}" ".env 파일이 없습니다: ${ENV_FILE}")"
    log_info "$(L "Create it from the template and edit it:" "템플릿에서 만들고 편집하세요:")"
    echo "  cp .env.example .env"
    exit 1
}

# Compose file selection / compose 파일 선택 ------------------------------------------
# COMPOSE_FILE (process env, then .env) is a list separated by COMPOSE_PATH_SEPARATOR
# (default ":"), exactly like docker compose itself, so the files are merged in order
# (later files override earlier ones). Relative entries resolve against the target
# directory; absolute entries are kept unchanged (never joined twice). Every compose call
# gets --project-directory so ".env" and relative paths always mean the target directory.
# COMPOSE_FILE(프로세스 환경 → .env)은 COMPOSE_PATH_SEPARATOR(기본 ":")로 구분한 목록이며
# docker compose 와 동일하게 순서대로 병합된다(뒤 파일이 앞 파일을 덮어씀). 상대경로는
# 대상 디렉터리 기준, 절대경로는 변형 없이 쓴다(이중 결합 없음). 모든 compose 호출에
# --project-directory 를 붙여 ".env" 와 상대경로가 항상 대상 디렉터리를 가리키게 한다.
resolve_compose_files() {
    local raw="${COMPOSE_FILE:-}" sep="${COMPOSE_PATH_SEPARATOR:-}" item="" path=""
    local -a parts=()
    if [ -z "${raw}" ]; then raw="$(read_env_var COMPOSE_FILE)"; fi
    if [ -z "${sep}" ]; then sep="$(read_env_var COMPOSE_PATH_SEPARATOR)"; fi
    sep="${sep:-:}"
    raw="${raw:-docker-compose.yml}"
    COMPOSE_FILES=()
    COMPOSE_ARGS=(--project-directory "${SCRIPT_DIR}")
    IFS="${sep}" read -r -a parts <<< "${raw}"
    for item in "${parts[@]}"; do
        [ -n "${item}" ] || continue
        case "${item}" in
            /*) path="${item}" ;;
            *)  path="${SCRIPT_DIR}/${item}" ;;
        esac
        if [ ! -f "${path}" ]; then
            log_error "$(L "Compose file not found: ${path}" "compose 파일을 찾을 수 없습니다: ${path}")"
            log_error "$(L "Check COMPOSE_FILE in this host's .env (list entries are separated by '${sep}')." "이 호스트 .env 의 COMPOSE_FILE 을 확인하세요(목록 구분자: '${sep}').")"
            exit 1
        fi
        COMPOSE_FILES+=("${path}")
        COMPOSE_ARGS+=(-f "${path}")
    done
}

# Upserts KEY=VALUE in .env. An existing line is replaced in place, otherwise the pair is
# appended; commented examples stay untouched. Written via a temp file + `cat >` so .env
# keeps its permissions (it holds secrets) and GNU/BSD sed both work.
# .env 의 KEY=VALUE 를 갱신/추가한다. 기존 줄은 제자리 치환, 없으면 끝에 추가하며 주석 예시는
# 건드리지 않는다. 비밀을 담은 .env 의 권한을 지키고(GNU/BSD sed 공용) 임시 파일 + `cat >` 로 쓴다.
upsert_env_var() {
    local key="$1" value="$2" tmp=""
    if dry_run; then
        log_info "[DRY-RUN] $(L "skip .env write: ${key}=${value}" ".env 기록 생략: ${key}=${value}")"
        return 0
    fi
    if grep -qE "^[[:space:]]*${key}=" "${ENV_FILE}" 2>/dev/null; then
        tmp="${ENV_FILE}.tmp.$$"
        sed -E "s|^[[:space:]]*${key}=.*$|${key}=${value}|" "${ENV_FILE}" > "${tmp}"
        cat "${tmp}" > "${ENV_FILE}"
        rm -f "${tmp}"
    else
        {
            echo ""
            echo "# Managed by deploy.sh: version detected from the running chroma image."
            echo "# deploy.sh 가 관리: 실행 중인 chroma 이미지에서 판정한 버전."
            echo "${key}=${value}"
        } >> "${ENV_FILE}"
    fi
    return 0
}

# Chroma version detection / chroma 버전 판정 ------------------------------------------
# The Chroma server hardcodes "1.0.0" on its version endpoint and the in-image CLI has its
# own version, so neither says which server release runs. The image digest does: compare
# it with (a) the digest pinned in the compose file and (b) the Docker Hub digest of the
# pinned tag. Anything else (no image, no match, only `latest` matches) is "unknown".
# Chroma 서버는 버전 엔드포인트에 "1.0.0" 을 하드코딩하고 이미지 내 CLI 버전도 별개라 둘 다
# 서버 릴리스를 알려주지 못한다. 이미지 digest 는 알려준다: (a) compose 에 핀한 digest,
# (b) 핀 태그의 Docker Hub digest 와 대조한다. 그 외(이미지 없음·불일치·latest 만 일치)는 unknown.

# Parses the first `image: chromadb/chroma:<tag>@sha256:<digest>` found in the compose files.
# compose 파일들에서 첫 `image: chromadb/chroma:<tag>@sha256:<digest>` 를 파싱한다.
get_repo_pin() {
    local f="" line=""
    PIN_TAG="unknown"; PIN_DIGEST=""; REPO_PIN=""
    for f in "${COMPOSE_FILES[@]}" "${SCRIPT_DIR}/docker-compose.yml"; do
        line="$(grep -E '^[[:space:]]*image:[[:space:]]*chromadb/chroma:' "${f}" 2>/dev/null | head -1 || true)"
        [ -n "${line}" ] && break
    done
    [ -z "${line}" ] && return 0
    PIN_TAG="$(printf '%s\n' "${line}" | sed -E 's/^.*chromadb\/chroma:([^@[:space:]]+).*$/\1/')"
    PIN_DIGEST="$(printf '%s\n' "${line}" | grep -o 'sha256:[a-f0-9]*' | head -1 || true)"
    case "${PIN_TAG}" in ''|*' '*|*'@'*) PIN_TAG="unknown" ;; esac
    REPO_PIN="chromadb/chroma:${PIN_TAG}"
    return 0
}

# RepoDigest of the chromadb container's image (running or stopped); empty if none.
# chromadb 컨테이너 이미지의 RepoDigest(실행/정지 무관), 없으면 빈 값.
resolve_local_chroma_digest() {
    local cid="" image_id=""
    LOCAL_CHROMA_DIGEST=""
    if dry_run; then return 0; fi
    cid="$(dcq ps -aq "${CHROMA_CONTAINER}" 2>/dev/null | head -1 || true)"
    [ -z "${cid}" ] && return 0
    image_id="$(docker inspect "${cid}" --format '{{.Image}}' 2>/dev/null || true)"
    [ -z "${image_id}" ] && return 0
    LOCAL_CHROMA_DIGEST="$(docker image inspect "${image_id}" --format '{{range .RepoDigests}}{{println .}}{{end}}' 2>/dev/null | grep 'chromadb/chroma@' | head -1 | sed -E 's/^chromadb\/chroma@//' || true)"
    return 0
}

# Top-level manifest digest of a Docker Hub tag. The tag JSON lists the per-platform
# "images" digests first and the top-level "digest" last, so `tail -1` picks the right one
# without jq (head -1 would return a platform digest).
# Docker Hub 태그의 최상위 매니페스트 digest. 태그 JSON 은 플랫폼별 "images" digest 가 먼저,
# 최상위 "digest" 가 마지막이라 jq 없이 `tail -1` 로 고른다(head -1 은 플랫폼 digest 가 된다).
get_hub_tag_digest() {
    curl -fsSL --max-time 30 "https://hub.docker.com/v2/repositories/chromadb/chroma/tags/$1" 2>/dev/null \
        | grep -o '"digest":"sha256:[a-f0-9]*"' | tail -1 | grep -o 'sha256:[a-f0-9]*' || true
}

resolve_chroma_version() {
    local tag="" hub="" seen=""
    RESOLVED_CHROMA_VERSION="unknown"; RESOLVED_HUB_TAG=""; RESOLVED_HUB_DIGEST=""
    [ -z "${LOCAL_CHROMA_DIGEST}" ] && return 0
    if [ -n "${PIN_DIGEST}" ] && [ "${LOCAL_CHROMA_DIGEST}" = "${PIN_DIGEST}" ]; then
        RESOLVED_CHROMA_VERSION="${PIN_TAG}"; RESOLVED_HUB_TAG="${PIN_TAG}"; RESOLVED_HUB_DIGEST="${PIN_DIGEST}"
        return 0
    fi
    for tag in "${PIN_TAG}" "latest"; do
        case " ${seen} " in *" ${tag} "*) continue ;; esac
        seen="${seen} ${tag}"
        hub="$(get_hub_tag_digest "${tag}")"
        if [ -n "${hub}" ] && [ "${hub}" = "${LOCAL_CHROMA_DIGEST}" ]; then
            RESOLVED_HUB_TAG="${tag}"; RESOLVED_HUB_DIGEST="${hub}"
            # `latest` is not a version number: record the evidence, stay "unknown".
            # `latest` 는 버전 번호가 아니다: 근거만 남기고 unknown 으로 둔다.
            if [ "${tag}" = "latest" ] && [ "${PIN_TAG}" != "latest" ]; then return 0; fi
            RESOLVED_CHROMA_VERSION="${tag}"
            return 0
        fi
    done
    return 0
}

# Writes the detection result to .env (shared by update and version). Undetectable + an
# existing value keeps the value and only warns, so a transient docker/network failure
# cannot erase a good record; "unknown" is written only when nothing was recorded yet.
# SYNC_CHANGED=1 asks the caller to recreate mcp-server via `up -d`: `docker compose
# restart` does NOT re-read .env, so it would never inject the new value.
# 판정 결과를 .env 에 기록한다(update·version 공용). 판정 불가 + 기존 값이 있으면 값을 보존하고
# 경고만 한다(일시적 docker/네트워크 장애가 정상 기록을 지우지 않게). 기록이 없을 때만
# unknown 을 쓴다. SYNC_CHANGED=1 이면 호출자가 `up -d` 로 mcp-server 를 재생성해야 한다:
# `docker compose restart` 는 .env 를 다시 읽지 않아 새 값이 주입되지 않는다.
sync_chroma_server_version() {
    local prev=""
    SYNC_CHANGED=0
    get_repo_pin
    if dry_run; then
        log_info "[DRY-RUN] $(L "skip chroma version detection; .env unchanged" "chroma 버전 판정 생략, .env 미변경")"
        RESOLVED_CHROMA_VERSION="unknown"
        return 0
    fi
    resolve_local_chroma_digest
    resolve_chroma_version
    prev="$(read_env_var CHROMA_SERVER_VERSION)"
    if [ "${RESOLVED_CHROMA_VERSION}" = "unknown" ] && [ -n "${prev}" ]; then
        log_warning "$(L "Cannot detect the chroma version; keeping CHROMA_SERVER_VERSION=${prev}" "chroma 버전을 판정할 수 없어 CHROMA_SERVER_VERSION=${prev} 을 유지합니다")"
        return 0
    fi
    upsert_env_var CHROMA_SERVER_VERSION "${RESOLVED_CHROMA_VERSION}"
    if [ "${prev}" != "${RESOLVED_CHROMA_VERSION}" ]; then
        SYNC_CHANGED=1
        log_success "CHROMA_SERVER_VERSION: ${prev:-<unset>} -> ${RESOLVED_CHROMA_VERSION}"
    else
        log_info "$(L "CHROMA_SERVER_VERSION unchanged: ${RESOLVED_CHROMA_VERSION}" "CHROMA_SERVER_VERSION 변경 없음: ${RESOLVED_CHROMA_VERSION}")"
    fi
    return 0
}

apply_version_change() {
    [ "${SYNC_CHANGED}" = "1" ] || return 0
    log_info "$(L "CHROMA_SERVER_VERSION changed: recreating mcp-server to inject it" "CHROMA_SERVER_VERSION 이 바뀌어 mcp-server 를 재생성해 주입합니다")"
    dc up -d
}

# Commands / 명령 -----------------------------------------------------------------------

cmd_install() {
    log_info "$(L "Installing chromadb-remote-mcp..." "chromadb-remote-mcp 를 설치합니다...")"
    check_docker
    if [ ! -f "${ENV_FILE}" ]; then
        # DRY_RUN: plan only, no file is created / DRY_RUN: 계획만 출력, 파일 생성 없음
        if dry_run; then
            log_info "[DRY-RUN] cp ${SCRIPT_DIR}/.env.example ${ENV_FILE}"
            return 0
        fi
        cp "${SCRIPT_DIR}/.env.example" "${ENV_FILE}"
        log_warning "$(L "Created .env from the template. Edit it, then run install again." ".env 를 템플릿에서 만들었습니다. 편집한 뒤 install 을 다시 실행하세요.")"
        echo "  ${ENV_FILE}"
        exit 1
    fi
    if dry_run; then
        log_info "[DRY-RUN] mkdir -p ${SCRIPT_DIR}/${BACKUP_DIR}"
    else
        mkdir -p "${SCRIPT_DIR}/${BACKUP_DIR}"
    fi
    log_info "$(L "Pulling images..." "이미지를 가져오는 중...")"
    dc pull
    log_info "$(L "Starting services..." "서비스를 기동하는 중...")"
    dc up -d
    log_success "$(L "Installation complete. Next: ./deploy.sh status, ./deploy.sh version" "설치 완료. 다음: ./deploy.sh status, ./deploy.sh version")"
}

cmd_update() {
    log_info "$(L "Updating chromadb-remote-mcp..." "chromadb-remote-mcp 를 갱신합니다...")"
    check_docker
    check_env
    dc pull
    dc up -d --force-recreate
    run docker image prune -f
    # Detect on the recreated image, record, then inject the value if it changed.
    # 재생성된 이미지에서 판정하고 기록한 뒤, 값이 바뀌었으면 주입한다.
    sync_chroma_server_version
    apply_version_change
    log_success "$(L "Update complete" "갱신 완료")"
    log_info "$(L "Hint: ./deploy.sh self-update refreshes deploy.sh/compose files from the latest release (images only were updated here)" "안내: ./deploy.sh self-update 로 deploy.sh/compose 파일을 최신 릴리스로 갱신할 수 있습니다(여기서는 이미지만 갱신됨)")"
    # Show the version report reusing the judgment above (no second Hub pass).
    # 위 판정을 재사용해 버전 정보를 출력한다(Hub 판정 반복 없음).
    print_version_info
}

cmd_start()   { check_docker; check_env; dc up -d;    log_success "$(L "Services started" "서비스를 기동했습니다")"; }
cmd_stop()    { check_docker; dc down;                log_success "$(L "Services stopped" "서비스를 정지했습니다")"; }
cmd_restart() { check_docker; check_env; dc restart; log_success "$(L "Services restarted" "서비스를 재시작했습니다")"; }

cmd_status() {
    local c="" state=""
    check_docker
    log_info "$(L "Service status:" "서비스 상태:")"
    dc ps
    if dry_run; then return 0; fi
    for c in "${CHROMA_CONTAINER}" "${MCP_CONTAINER}" "${PROXY_CONTAINER}"; do
        state="$(docker inspect "${c}" --format '{{.State.Status}}' 2>/dev/null || echo "not-found")"
        # running/not-found are script labels; other states show the docker value as-is.
        # running/not-found 는 스크립트 라벨이고 다른 상태는 docker 값을 그대로 보여준다.
        if [ "${state}" = "running" ]; then
            log_success "  ${c}: $(L "running" "실행 중")"
        elif [ "${state}" = "not-found" ]; then
            log_warning "  ${c}: $(L "not found" "없음")"
        else
            log_warning "  ${c}: ${state}"
        fi
    done
}

cmd_logs() {
    check_docker
    dc logs -f --tail=100 "$@"
}

# Prints the version report. The caller must have run get_repo_pin; the chroma resolution
# lines reuse LOCAL_CHROMA_DIGEST / RESOLVED_* filled by sync_chroma_server_version, so
# update shows the same report without a second Hub judgment.
# 버전 정보를 출력한다. 호출자는 get_repo_pin 을 마쳐야 하고, chroma 판정 줄은
# sync_chroma_server_version 이 채운 LOCAL_CHROMA_DIGEST / RESOLVED_* 를 재사용해
# update 가 Hub 판정을 반복하지 않고도 같은 보고서를 출력한다.
print_version_info() {
    local tag="" mcp_ver=""
    tag="$(read_env_var MCP_IMAGE_TAG)"
    log_info "$(L "Version information:" "버전 정보:")"
    echo ""
    echo "$(L "MCP server" "MCP 서버"): ${MCP_IMAGE_REPO}:${tag:-latest}"
    if dry_run; then
        log_info "[DRY-RUN] docker exec ${MCP_CONTAINER} printenv MCP_SERVER_VERSION"
    else
        mcp_ver="$(docker exec "${MCP_CONTAINER}" printenv MCP_SERVER_VERSION 2>/dev/null || true)"
        echo "  MCP_SERVER_VERSION: ${mcp_ver:-$(L "unknown (container not running?)" "알 수 없음 (컨테이너 미실행?)")}"
    fi
    echo ""
    echo "$(L "Chroma server" "Chroma 서버"):"
    echo "  $(L "Compose files" "Compose 파일"): ${COMPOSE_FILES[*]}"
    echo "  $(L "Pinned image" "핀 이미지"): ${REPO_PIN} @ ${PIN_DIGEST:-$(L "(no digest)" "(digest 없음)")}"
    if dry_run; then
        log_info "[DRY-RUN] $(L "skip digest lookup, .env write and mcp-server recreation" "digest 조회, .env 기록, mcp-server 재생성 생략")"
        return 0
    fi
    echo "  $(L "Local image digest" "로컬 이미지 digest"): ${LOCAL_CHROMA_DIGEST:-$(L "(no chromadb image/container)" "(chromadb 이미지/컨테이너 없음)")}"
    echo "  $(L "Resolved version" "판정 버전"): ${RESOLVED_CHROMA_VERSION}"
    if [ -n "${RESOLVED_HUB_TAG}" ]; then
        echo "  $(L "Matched Docker Hub tag" "일치한 Docker Hub 태그"): ${RESOLVED_HUB_TAG} @ ${RESOLVED_HUB_DIGEST}"
    fi
}

cmd_version() {
    check_env
    get_repo_pin
    if dry_run; then
        print_version_info
        return 0
    fi
    # Same path as update: detect, record (undetectable keeps the old value), inject.
    # update 와 같은 경로: 판정, 기록(판정 불가면 기존 값 유지), 주입.
    sync_chroma_server_version
    print_version_info
    apply_version_change
}

# Backup / 백업 ---------------------------------------------------------------------------
# Finds what is mounted at /data so the backup mounts the same thing. Ground truth is the
# existing chromadb container's mount (volume name or bind source). Without a container
# (or in DRY_RUN) CHROMA_DATA_PATH decides: absolute path or ./relative = bind mount,
# a bare name (default "chroma-data") = compose named volume "<project>_<name>".
# 백업이 같은 곳을 마운트하도록 /data 의 마운트 대상을 찾는다. 기준은 기존 chromadb 컨테이너의
# 실제 마운트(볼륨명/bind 원본)다. 컨테이너가 없거나 DRY_RUN 이면 CHROMA_DATA_PATH 로 판정한다:
# 절대경로·./상대경로 = bind, 이름만(기본 "chroma-data") = compose named volume "<프로젝트>_<이름>".
resolve_backup_source() {
    local raw="" cid="" info="" rest="" mtype="" mname="" msrc="" project=""
    BK_KIND=""; BK_SRC=""
    if ! dry_run; then
        cid="$(dcq ps -aq "${CHROMA_CONTAINER}" 2>/dev/null | head -1 || true)"
        if [ -n "${cid}" ]; then
            info="$(docker inspect "${cid}" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}|{{.Name}}|{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
            mtype="${info%%|*}"; rest="${info#*|}"; mname="${rest%%|*}"; msrc="${rest#*|}"
            case "${mtype}" in
                volume) BK_KIND="volume"; BK_SRC="${mname}" ;;
                bind)   BK_KIND="bind";   BK_SRC="${msrc}" ;;
            esac
        fi
    fi
    [ -n "${BK_KIND}" ] && return 0
    raw="$(read_env_var CHROMA_DATA_PATH)"; raw="${raw:-chroma-data}"
    case "${raw}" in
        /*)       BK_KIND="bind"; BK_SRC="${raw}" ;;
        ./*)      BK_KIND="bind"; BK_SRC="${SCRIPT_DIR}/${raw#./}" ;;
        ../*)     BK_KIND="bind"; BK_SRC="${SCRIPT_DIR}/${raw}" ;;
        *)
            project="${COMPOSE_PROJECT_NAME:-$(read_env_var COMPOSE_PROJECT_NAME)}"
            project="${project:-$(basename "${SCRIPT_DIR}")}"
            project="$(printf '%s' "${project}" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
            BK_KIND="volume"; BK_SRC="${project}_${raw}"
            ;;
    esac
}

# Signal handlers for `backup` (top-level so shellcheck sees the trap references; they run
# inside cmd_backup's dynamic scope, so its locals — partial, was_running — are visible).
# If the operator interrupts the backup (Ctrl-C, `systemctl kill`): remove the .partial
# file, restart chromadb when this backup stopped it, and exit with the conventional code
# (SIGINT 130 / SIGTERM 143). cmd_backup clears the traps once the backup is done.
# `backup` 의 시그널 핸들러(shellcheck 가 trap 참조를 보도록 최상위에 둔다; cmd_backup 의
# 동적 스코프에서 실행되므로 지역 변수 partial·was_running 이 보인다). 운영자가 백업을
# 중단하면(Ctrl-C, `systemctl kill`) .partial 을 지우고, 이 백업이 정지시켰던 chromadb 를
# 다시 기동한 뒤 관례적 종료 코드로 종료한다(SIGINT 130 / SIGTERM 143). trap 해제는
# cmd_backup 이 백업 완료 시 한다.
backup_on_signal() {
    local rc="$1"
    rm -f "${partial}"
    if [ "${was_running}" = "1" ]; then dc start "${CHROMA_CONTAINER}"; fi
    trap - INT TERM
    exit "${rc}"
}
on_sigint()  { backup_on_signal 130; }
on_sigterm() { backup_on_signal 143; }

cmd_backup() {
    local backup_file="" partial="" ts="" image_ref="" image_id="" cid="" was_running="0"
    log_info "$(L "Backing up the chroma data..." "chroma 데이터를 백업합니다...")"
    check_docker
    check_env
    resolve_backup_source
    ts="$(date +%Y%m%d_%H%M%S)"
    backup_file="${SCRIPT_DIR}/${BACKUP_DIR}/chromadb_data_${ts}.tar.gz"
    partial="${backup_file}.partial"   # written under a temp name, renamed on success / 임시 이름으로 쓰고 성공 시 확정
    get_repo_pin
    if dry_run; then
        log_info "[DRY-RUN] $(L "data kind: ${BK_KIND}, source: ${BK_SRC}" "데이터 종류: ${BK_KIND}, 원본: ${BK_SRC}")"
        log_info "[DRY-RUN] mkdir -p ${SCRIPT_DIR}/${BACKUP_DIR}"
        log_info "[DRY-RUN] docker compose stop ${CHROMA_CONTAINER}  $(L "(only if it was running)" "(실행 중이었던 경우에만)")"
        log_info "[DRY-RUN] docker run --rm -v ${BK_SRC}:/data:ro --entrypoint tar <chromadb-image> -czf - -C /data . > ${partial}"
        log_info "[DRY-RUN] mv ${partial} ${backup_file}  $(L "(on success; removed on failure)" "(성공 시; 실패 시 삭제)")"
        log_info "[DRY-RUN] docker compose start ${CHROMA_CONTAINER}  $(L "(only if it was running before)" "(백업 전 실행 중이었던 경우에만)")"
        return 0
    fi
    if [ "${BK_KIND}" = "bind" ] && [ ! -d "${BK_SRC}" ]; then
        log_error "$(L "Data directory not found: ${BK_SRC}" "데이터 디렉터리를 찾을 수 없습니다: ${BK_SRC}")"
        exit 1
    fi
    if [ "${BK_KIND}" = "volume" ] && ! docker volume inspect "${BK_SRC}" > /dev/null 2>&1; then
        log_error "$(L "Docker volume not found: ${BK_SRC} (start the stack once, or check COMPOSE_PROJECT_NAME)" "Docker 볼륨을 찾을 수 없습니다: ${BK_SRC} (스택을 한 번 기동하거나 COMPOSE_PROJECT_NAME 을 확인하세요)")"
        exit 1
    fi
    mkdir -p "${SCRIPT_DIR}/${BACKUP_DIR}"
    # tar image: the container's image id (always local, so no pull) > CHROMA_IMAGE > pinned ref.
    # tar 이미지: 컨테이너의 이미지 ID(항상 로컬이라 pull 없음) > CHROMA_IMAGE > 핀 참조.
    cid="$(dcq ps -aq "${CHROMA_CONTAINER}" 2>/dev/null | head -1 || true)"
    if [ -n "${cid}" ]; then
        image_id="$(docker inspect "${cid}" --format '{{.Image}}' 2>/dev/null || true)"
        if [ "$(docker inspect "${cid}" --format '{{.State.Running}}' 2>/dev/null || echo false)" = "true" ]; then was_running="1"; fi
    fi
    image_ref="${image_id:-${CHROMA_IMAGE:-${REPO_PIN}}}"
    # Register the traps BEFORE stopping chromadb, so a signal arriving between the stop and the
    # trap can never leave chromadb stopped. partial and was_running are already set above, so
    # the handlers never meet an unset variable.
    # chromadb 를 정지하기 전에 trap 을 등록한다: stop 과 trap 등록 사이에 시그널이 와도 chromadb 가
    # 정지된 채 남지 않는다. partial 과 was_running 은 위에서 이미 정해져 있어 핸들러가 미정의 변수를
    # 만나지 않는다.
    trap on_sigint INT
    trap on_sigterm TERM
    if [ "${was_running}" = "1" ]; then
        log_info "$(L "Stopping chromadb for a consistent backup..." "일관된 백업을 위해 chromadb 를 정지합니다...")"
        dc stop "${CHROMA_CONTAINER}"
    else
        log_info "$(L "chromadb is already stopped: no stop/start around the backup" "chromadb 가 이미 정지 상태입니다: 백업 전후 정지/기동을 하지 않습니다")"
    fi
    # Why a container: bind data is often root-owned (the chroma container runs as root), so
    # a host-user tar gets permission denied and sudo needs a TTY/password. The docker daemon
    # runs as root, so a throwaway container reads the data with a read-only mount, and the
    # archive streams to stdout so the file is owned by the invoking user. Named volumes can
    # only be read through a container anyway.
    # 컨테이너를 쓰는 이유: bind 데이터는 root 소유인 경우가 많아(chroma 컨테이너가 root 로 실행)
    # 호스트 사용자 tar 는 permission denied 이고 sudo 는 TTY/비밀번호가 필요하다. docker 데몬은
    # root 로 돌므로 일회용 컨테이너가 읽기 전용 마운트로 읽고, 아카이브를 stdout 으로 스트리밍해
    # 파일 소유자가 실행 사용자가 된다. named volume 은 어차피 컨테이너로만 읽을 수 있다.
    log_info "$(L "Creating the archive (read-only mount)..." "아카이브를 만드는 중 (읽기 전용 마운트)...")"
    if ! docker run --rm -v "${BK_SRC}:/data:ro" --entrypoint tar "${image_ref}" -czf - -C /data . > "${partial}"; then
        rm -f "${partial}"
        log_error "$(L "tar failed; the partial file was removed" "tar 실패: 임시 파일을 삭제했습니다")"
        if [ "${was_running}" = "1" ]; then dc start "${CHROMA_CONTAINER}"; fi
        exit 1
    fi
    mv "${partial}" "${backup_file}"
    if [ "${was_running}" = "1" ]; then dc start "${CHROMA_CONTAINER}"; fi
    trap - INT TERM   # backup done / 백업 완료: 시그널 trap 해제
    log_success "$(L "Backup created: ${backup_file}" "백업 생성: ${backup_file}")"
    ls -lh "${backup_file}"
}

# Self-update / 자체 갱신 -------------------------------------------------------------------
# Replaces ONLY the repository-managed files (SELF_UPDATE_FILES) with the ones from a GitHub
# release tag. Never touched: .env, local compose overrides that are not in the release
# (e.g. a traefik file you copied from the example), and the data directory. Safety chain:
# download everything to a staging dir -> validate -> back up the current files -> replace
# each file atomically (temp file + mv) -> roll back from the backup on any failure/signal.
# Design: `update` (images) and `self-update` (scripts/compose) stay separate on purpose.
# Swapping docker-compose.yml inside `update` would change what the pull/recreate runs
# against mid-command and make the result unreproducible; so `update` only prints a hint and
# `self-update` ends with a hint to run `update`. A git checkout is refused (use git pull).
# 저장소가 관리하는 파일(SELF_UPDATE_FILES)만 GitHub 릴리스 태그의 것으로 교체한다. .env,
# 릴리스에 없는 로컬 compose override(예: 예제에서 복사한 traefik 파일), 데이터 디렉터리는
# 건드리지 않는다. 안전 순서: 스테이징 다운로드 -> 검증 -> 현재 파일 백업 -> 파일별 원자적
# 교체(임시 파일 + mv) -> 실패/시그널 시 백업에서 원복.
# 설계: `update`(이미지)와 `self-update`(스크립트·compose)는 의도적으로 분리한다. `update`
# 안에서 docker-compose.yml 을 바꾸면 pull/재생성의 기준이 명령 도중 바뀌어 재현이 안 되므로,
# `update` 는 안내만 출력하고 `self-update` 는 끝에서 `update` 실행을 안내한다.
# git 체크아웃에서는 거부한다(git pull 사용).
SELF_UPDATE_FILES_DEFAULT="deploy.sh docker-compose.yml docker-compose.traefik.example.yml .env.example"
SELF_UPDATE_REQUIRED="deploy.sh docker-compose.yml"
SU_STAGE=""
SU_BACKUP=""
SU_DONE=()

su_raw_base() { printf '%s/%s' "${DEPLOY_RAW_BASE:-https://raw.githubusercontent.com}" "${DEPLOY_REPO:-meloncafe/chromadb-remote-mcp}"; }

su_current_version() {
    local v=""
    if [ -f "${SCRIPT_DIR}/.deploy-release" ]; then v="$(head -1 "${SCRIPT_DIR}/.deploy-release" | tr -cd 'A-Za-z0-9._-')"; fi
    printf '%s' "${v:-unknown}"
}

# Latest release tag via the GitHub API (read-only); empty on failure.
# GitHub API 로 최신 릴리스 태그를 조회한다(읽기 전용). 실패 시 빈 값.
su_latest_tag() {
    curl -fsSL --max-time 30 "${DEPLOY_API_BASE:-https://api.github.com}/repos/${DEPLOY_REPO:-meloncafe/chromadb-remote-mcp}/releases/latest" 2>/dev/null \
        | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 \
        | sed -E 's/^.*:[[:space:]]*"([^"]*)"$/\1/' || true
}

su_cleanup_stage() {
    [ -n "${SU_STAGE}" ] && [ -d "${SU_STAGE}" ] || return 0
    find "${SU_STAGE}" -maxdepth 1 -type f -exec rm -f {} + 2>/dev/null || true
    rmdir "${SU_STAGE}" 2>/dev/null || true
}

# Restores every replaced file from the backup (removes files that did not exist before).
# 교체한 모든 파일을 백업에서 되돌린다(이전에 없던 파일은 삭제).
su_rollback() {
    local f="" dest=""
    for f in ${SU_DONE[@]+"${SU_DONE[@]}"}; do
        dest="${SCRIPT_DIR}/${f}"
        if [ -f "${SU_BACKUP}/${f}" ]; then
            if cp -p "${SU_BACKUP}/${f}" "${dest}.rb.$$"; then mv -f "${dest}.rb.$$" "${dest}"; fi
        else
            rm -f "${dest}"
        fi
    done
    SU_DONE=()
}

su_on_signal() {
    log_error "$(L "Interrupted: rolling back" "중단됨: 원복합니다")"
    su_rollback
    su_cleanup_stage
    trap - INT TERM
    exit "$1"
}
su_on_sigint()  { su_on_signal 130; }
su_on_sigterm() { su_on_signal 143; }

# Structural integrity of one downloaded file (non-empty; shell syntax; yaml top level).
# 내려받은 파일 하나의 구조 검증(비어있지 않음, 셸 문법, yaml 최상위).
su_validate_file() {
    local name="$1" path="$2"
    [ -s "${path}" ] || { log_error "$(L "Empty download: ${name}" "내용이 비어 있습니다: ${name}")"; return 1; }
    case "${name}" in
        *.sh)
            head -1 "${path}" | grep -q '^#!' || { log_error "$(L "Not a script (no shebang): ${name}" "스크립트가 아닙니다(shebang 없음): ${name}")"; return 1; }
            bash -n "${path}" || { log_error "$(L "Shell syntax error: ${name}" "셸 문법 오류: ${name}")"; return 1; }
            ;;
        *.yml|*.yaml)
            grep -qE '^services:' "${path}" || { log_error "$(L "Not a compose file (no services:): ${name}" "compose 파일이 아닙니다(services: 없음): ${name}")"; return 1; }
            ;;
    esac
    return 0
}

su_sha256() {
    if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
    else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# Verifies against a SHA256SUMS file when the release publishes one at the tag root.
# 릴리스가 태그 루트에 SHA256SUMS 를 게시하면 그것과 대조한다.
su_verify_sums() {
    local name="" want="" got="" checked=0
    if ! curl -fsSL --max-time 30 -o "${SU_STAGE}/.SHA256SUMS" "$(su_raw_base)/${SU_TAG}/SHA256SUMS" 2>/dev/null; then
        log_info "$(L "No SHA256SUMS published for ${SU_TAG}: relying on structural checks + TLS" "${SU_TAG} 에 SHA256SUMS 가 없어 구조 검증 + TLS 에 의존합니다")"
        return 0
    fi
    for name in "$@"; do
        want="$(awk -v n="${name}" '$2==n || $2=="*"n {print $1; exit}' "${SU_STAGE}/.SHA256SUMS")"
        [ -n "${want}" ] || continue
        got="$(su_sha256 "${SU_STAGE}/${name}")"
        if [ "${want}" != "${got}" ]; then
            log_error "$(L "sha256 mismatch: ${name}" "sha256 불일치: ${name}")"
            return 1
        fi
        checked=$((checked + 1))
    done
    log_success "$(L "sha256 verified: ${checked} file(s)" "sha256 검증 완료: ${checked}개 파일")"
}

cmd_self_update() {
    local requested="${DEPLOY_TAG:-}" current="" name="" ts="" dest="" mode=""
    local -a files=() fetched=()
    while [ $# -gt 0 ]; do
        case "$1" in
            --tag)   [ $# -ge 2 ] || { log_error "$(L "--tag needs a value" "--tag 에 값이 필요합니다")"; exit 1; }
                     requested="$2"; shift 2 ;;
            --tag=*) requested="${1#--tag=}"; shift ;;
            -*)      log_error "$(L "Unknown option: $1" "알 수 없는 옵션: $1")"; exit 1 ;;
            *)       requested="$1"; shift ;;
        esac
    done
    if [ -e "${SCRIPT_DIR}/.git" ]; then
        log_error "$(L "This is a git checkout: update it with 'git pull' (or checkout a tag), not self-update" "git 체크아웃입니다: self-update 대신 'git pull'(또는 태그 checkout)로 갱신하세요")"
        exit 1
    fi
    if ! command -v curl > /dev/null 2>&1; then
        log_error "$(L "curl is required" "curl 이 필요합니다")"; exit 1
    fi
    SU_TAG="${requested}"
    if [ -z "${SU_TAG}" ]; then
        SU_TAG="$(su_latest_tag)"
        [ -n "${SU_TAG}" ] || { log_error "$(L "Cannot resolve the latest release tag (network/API?). Pass one: ./deploy.sh self-update <tag>" "최신 릴리스 태그를 조회할 수 없습니다(네트워크/API?). 직접 지정: ./deploy.sh self-update <tag>")"; exit 1; }
    fi
    case "${SU_TAG}" in
        [A-Za-z0-9]*) ;;
        *) log_error "$(L "Invalid tag: ${SU_TAG}" "잘못된 태그: ${SU_TAG}")"; exit 1 ;;
    esac
    if [ -n "$(printf '%s' "${SU_TAG}" | tr -d 'A-Za-z0-9._-')" ]; then
        log_error "$(L "Invalid tag: ${SU_TAG}" "잘못된 태그: ${SU_TAG}")"; exit 1
    fi
    current="$(su_current_version)"
    log_info "$(L "Self-update: current ${current} -> target ${SU_TAG}" "자체 갱신: 현재 ${current} -> 대상 ${SU_TAG}")"
    if [ "${current}" = "${SU_TAG}" ] && [ "${SELF_UPDATE_FORCE:-0}" != "1" ]; then
        log_success "$(L "Already at ${SU_TAG} (SELF_UPDATE_FORCE=1 to reinstall)" "이미 ${SU_TAG} 입니다 (재설치는 SELF_UPDATE_FORCE=1)")"
        return 0
    fi
    read -r -a files <<< "${SELF_UPDATE_FILES:-${SELF_UPDATE_FILES_DEFAULT}}"
    for name in ${files[@]+"${files[@]}"}; do
        # Flat names only; .env (secrets) is never replaceable. / 평면 이름만, .env 는 교체 불가.
        if [ "${name}" = ".env" ] || [ -n "$(printf '%s' "${name}" | tr -d 'A-Za-z0-9._-')" ]; then
            log_error "$(L "Refusing unsafe file name: ${name}" "안전하지 않은 파일 이름을 거부합니다: ${name}")"; exit 1
        fi
    done
    ts="$(date +%Y%m%d_%H%M%S)"
    SU_BACKUP="${SCRIPT_DIR}/${BACKUP_DIR}/self-update_${ts}_${current}"
    if dry_run; then
        log_info "[DRY-RUN] $(L "download from $(su_raw_base)/${SU_TAG}/: ${files[*]}" "다운로드 원본 $(su_raw_base)/${SU_TAG}/: ${files[*]}")"
        log_info "[DRY-RUN] $(L "validate (non-empty, bash -n, services:, SHA256SUMS if published)" "검증 (비어있지 않음, bash -n, services:, SHA256SUMS 있으면 대조)")"
        log_info "[DRY-RUN] cp -p <current files> ${SU_BACKUP}/"
        log_info "[DRY-RUN] $(L "replace atomically (temp file + mv); roll back on failure; untouched: .env, local overrides, data" "원자적 교체(임시 파일 + mv), 실패 시 원복. 미접촉: .env, 로컬 override, 데이터")"
        return 0
    fi

    SU_STAGE="${SCRIPT_DIR}/.self-update.$$"
    mkdir -p "${SU_STAGE}"
    trap su_on_sigint INT
    trap su_on_sigterm TERM
    log_info "$(L "Downloading ${SU_TAG}..." "${SU_TAG} 를 내려받는 중...")"
    for name in "${files[@]}"; do
        if curl -fsSL --max-time 60 -o "${SU_STAGE}/${name}" "$(su_raw_base)/${SU_TAG}/${name}" 2>/dev/null; then
            su_validate_file "${name}" "${SU_STAGE}/${name}" || { su_cleanup_stage; exit 1; }
            fetched+=("${name}")
        elif case " ${SELF_UPDATE_REQUIRED} " in *" ${name} "*) true ;; *) false ;; esac; then
            log_error "$(L "Required file missing from ${SU_TAG}: ${name}" "${SU_TAG} 에 필수 파일이 없습니다: ${name}")"
            su_cleanup_stage; exit 1
        else
            log_warning "$(L "Not in ${SU_TAG}, skipped: ${name}" "${SU_TAG} 에 없어 건너뜁니다: ${name}")"
        fi
    done
    su_verify_sums "${fetched[@]}" || { su_cleanup_stage; exit 1; }

    mkdir -p "${SU_BACKUP}"
    for name in "${fetched[@]}"; do
        if [ -f "${SCRIPT_DIR}/${name}" ]; then cp -p "${SCRIPT_DIR}/${name}" "${SU_BACKUP}/${name}"; fi
    done
    log_info "$(L "Backup of current files: ${SU_BACKUP}" "현재 파일 백업: ${SU_BACKUP}")"

    for name in "${fetched[@]}"; do
        dest="${SCRIPT_DIR}/${name}"
        mode="644"; case "${name}" in *.sh) mode="755" ;; esac
        if cp "${SU_STAGE}/${name}" "${dest}.new.$$" && chmod "${mode}" "${dest}.new.$$" && mv -f "${dest}.new.$$" "${dest}"; then
            SU_DONE+=("${name}")
        else
            rm -f "${dest}.new.$$"
            log_error "$(L "Replace failed: ${name}; rolling back" "교체 실패: ${name}; 원복합니다")"
            SU_DONE+=("${name}")
            su_rollback; su_cleanup_stage; trap - INT TERM
            exit 1
        fi
    done
    printf '%s\n' "${SU_TAG}" > "${SCRIPT_DIR}/.deploy-release.new.$$" && mv -f "${SCRIPT_DIR}/.deploy-release.new.$$" "${SCRIPT_DIR}/.deploy-release"
    su_cleanup_stage
    trap - INT TERM
    log_success "$(L "Self-update complete: ${current} -> ${SU_TAG} (${fetched[*]})" "자체 갱신 완료: ${current} -> ${SU_TAG} (${fetched[*]})")"
    log_info "$(L "Next: ./deploy.sh update to apply the new compose file to the running stack" "다음: ./deploy.sh update 로 새 compose 파일을 실행 중인 스택에 반영하세요")"
}

# Help / 도움말 ---------------------------------------------------------------------------
# Printed in the selected language only (DEPLOY_LANG > .env > locale) / 선택된 언어로만 출력.
cmd_help() {
    echo "chromadb-remote-mcp - $(L "deployment helper" "배포 도우미")"
    echo ""
    echo "$(L "Usage" "사용법"): ./deploy.sh <command>"
    echo ""
    echo "$(L "Commands" "명령"):"
    echo "  install   $(L "first-time setup: create .env, pull images, start" "최초 설치: .env 생성, 이미지 pull, 기동")"
    echo "  update    $(L "pull, recreate, record CHROMA_SERVER_VERSION" "pull, 재생성, CHROMA_SERVER_VERSION 기록")"
    echo "  start     $(L "start services" "서비스 기동")"
    echo "  stop      $(L "stop and remove containers (data is kept)" "컨테이너 정지·제거 (데이터는 유지)")"
    echo "  restart   $(L "restart containers (does not re-read .env: use update/start)" "컨테이너 재시작 (.env 를 다시 읽지 않음: update/start 사용)")"
    echo "  status    $(L "service status" "서비스 상태")"
    echo "  logs      $(L "follow logs; optional service names: logs mcp-server" "로그 보기; 서비스명 지정 가능: logs mcp-server")"
    echo "  version   $(L "show mcp/chroma versions, record CHROMA_SERVER_VERSION" "mcp/chroma 버전 표시, CHROMA_SERVER_VERSION 기록")"
    echo "  backup    $(L "back up chroma data (named volume or bind path) to ${BACKUP_DIR}/" "chroma 데이터(named volume 또는 bind 경로)를 ${BACKUP_DIR}/ 에 백업")"
    echo "  self-update [tag]  $(L "replace deploy.sh/compose/.env.example from a release tag (default: latest); .env, local overrides, data untouched" "deploy.sh/compose/.env.example 를 릴리스 태그(기본: 최신)로 교체; .env·로컬 override·데이터는 미접촉")"
    echo "  help      $(L "show this help" "이 도움말 표시")"
    echo ""
    echo "$(L "Settings (process env overrides .env)" "설정 (프로세스 환경이 .env 보다 우선)"):"
    echo "  DEPLOY_LANG=en|ko          $(L "message language (default: locale)" "메시지 언어 (기본: 로캘)")"
    echo "  COMPOSE_FILE=a.yml:b.yml   $(L "compose files merged in order, e.g. docker-compose.yml:docker-compose.traefik.yml" "순서대로 병합할 compose 파일, 예: docker-compose.yml:docker-compose.traefik.yml")"
    echo "  COMPOSE_PROJECT_NAME       $(L "compose project name" "compose 프로젝트명")"
    echo "  CHROMA_DATA_PATH           $(L "named volume (default chroma-data) or absolute/./relative bind path" "named volume(기본 chroma-data) 또는 절대/./상대 bind 경로")"
    echo "  PORT, MCP_IMAGE_TAG        $(L "published port, mcp image tag" "공개 포트, mcp 이미지 태그")"
    echo "  DRY_RUN=1                  $(L "print the plan only; no docker call, no file change" "계획만 출력: docker 호출·파일 변경 없음")"
    echo "  DEPLOY_DIR, CHROMA_IMAGE   $(L "target directory (tests), image for the backup tar" "대상 디렉터리(테스트), 백업 tar 이미지")"
    echo "  DEPLOY_REPO, DEPLOY_TAG    $(L "self-update: GitHub owner/repo (default meloncafe/chromadb-remote-mcp), release tag" "self-update: GitHub owner/repo(기본 meloncafe/chromadb-remote-mcp), 릴리스 태그")"
    echo "  SELF_UPDATE_FILES          $(L "self-update: space-separated file names to replace" "self-update: 교체할 파일 이름 목록(공백 구분)")"
    echo "  SELF_UPDATE_FORCE=1        $(L "self-update: reinstall even when already at the target tag" "self-update: 이미 대상 태그여도 재설치")"
}

main() {
    local cmd="${1:-help}"
    detect_lang
    case "${cmd}" in
        help|--help|-h) cmd_help; return 0 ;;
        install|update|start|stop|restart|status|logs|version|backup|self-update) ;;
        *)
            log_error "$(L "Unknown command: ${cmd}" "알 수 없는 명령: ${cmd}")"
            echo "" >&2
            cmd_help >&2
            return 1
            ;;
    esac
    shift || true
    # self-update is the repair path: it must work even when compose files are missing/broken.
    # self-update 는 복구 경로라 compose 파일이 없거나 깨져도 동작해야 한다.
    if [ "${cmd}" = "self-update" ]; then cmd_self_update "$@"; return 0; fi
    resolve_compose_files
    case "${cmd}" in
        logs) cmd_logs "$@" ;;
        *)    "cmd_${cmd}" ;;
    esac
}

# Run only when executed, not when sourced (lets tests load the functions).
# 직접 실행할 때만 동작하고 source 될 때는 실행하지 않는다(테스트가 함수만 불러올 수 있게).
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    main "$@"
fi
