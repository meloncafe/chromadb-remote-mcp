#!/bin/bash
set -e

# ChromaDB Remote MCP - Docker Build Script
# Usage: ./scripts/build.sh [options]

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
DOCKER_REPO="${DOCKER_REPO:-yourname/chromadb-remote-mcp}"
VERSION="${VERSION:-latest}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
PUSH="${PUSH:-false}"
LOAD="${LOAD:-true}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --repo)
      DOCKER_REPO="$2"
      shift 2
      ;;
    --version|-v)
      VERSION="$2"
      shift 2
      ;;
    --platform)
      PLATFORMS="$2"
      shift 2
      ;;
    --push)
      PUSH="true"
      LOAD="false"
      shift
      ;;
    --load)
      LOAD="true"
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --repo <repository>    Docker repository (default: yourname/chromadb-remote-mcp)"
      echo "  --version, -v <ver>    Version tag (default: latest)"
      echo "  --platform <platforms> Build platforms (default: linux/amd64,linux/arm64)"
      echo "  --push                 Push to registry (disables --load, requires 'docker login')"
      echo "  --load                 Load image to local Docker (default: true)"
      echo "  --help, -h             Show this help message"
      echo ""
      echo "Environment variables:"
      echo "  DOCKER_REPO            Docker repository"
      echo "  VERSION                Version tag"
      echo "  PLATFORMS              Build platforms"
      echo ""
      echo "Examples:"
      echo "  # Build for local testing (single platform, load to Docker)"
      echo "  $0 --platform linux/amd64 --load"
      echo ""
      echo "  # Build and push multi-platform image"
      echo "  $0 --version 1.2.3 --push"
      echo ""
      echo "  # Build with custom repository"
      echo "  $0 --repo myuser/my-mcp --version dev --push"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Validation
if [[ "$PUSH" == "true" && "$LOAD" == "true" ]]; then
  echo -e "${YELLOW}Warning: Cannot use --push and --load together. Disabling --load.${NC}"
  LOAD="false"
fi

# Display configuration
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  ChromaDB Remote MCP - Docker Build${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "Repository:  ${GREEN}${DOCKER_REPO}${NC}"
echo -e "Version:     ${GREEN}${VERSION}${NC}"
echo -e "Platforms:   ${GREEN}${PLATFORMS}${NC}"
echo -e "Push:        ${GREEN}${PUSH}${NC}"
echo -e "Load:        ${GREEN}${LOAD}${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    exit 1
fi

# Check if buildx is available
if ! docker buildx version &> /dev/null; then
    echo -e "${RED}❌ Docker buildx is not available${NC}"
    exit 1
fi

# Create builder if needed
BUILDER_NAME="chromadb-mcp-builder"
if ! docker buildx inspect "$BUILDER_NAME" &> /dev/null; then
    echo -e "${YELLOW}📦 Creating buildx builder: ${BUILDER_NAME}${NC}"
    docker buildx create --name "$BUILDER_NAME" --use
else
    echo -e "${GREEN}✅ Using existing builder: ${BUILDER_NAME}${NC}"
    docker buildx use "$BUILDER_NAME"
fi

# Build tags
TAGS=()
TAGS+=("${DOCKER_REPO}:${VERSION}")

# Add 'latest' tag if version is a semver release
if [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    TAGS+=("${DOCKER_REPO}:latest")
    echo -e "${GREEN}✅ Adding 'latest' tag for semver release${NC}"
fi

# Build tag arguments
TAG_ARGS=""
for tag in "${TAGS[@]}"; do
    TAG_ARGS+="--tag $tag "
done

# Build options
BUILD_ARGS="--platform ${PLATFORMS}"

if [[ "$PUSH" == "true" ]]; then
    BUILD_ARGS+=" --push"
    echo -e "${YELLOW}🚀 Building and pushing to registry...${NC}"
elif [[ "$LOAD" == "true" ]]; then
    # For --load, only single platform is supported
    if [[ "$PLATFORMS" == *","* ]]; then
        echo -e "${RED}❌ --load only supports single platform${NC}"
        echo -e "${YELLOW}💡 Use --platform linux/amd64 or --platform linux/arm64${NC}"
        exit 1
    fi
    BUILD_ARGS+=" --load"
    echo -e "${YELLOW}🔨 Building for local Docker...${NC}"
else
    echo -e "${YELLOW}🔨 Building without push or load...${NC}"
fi

# Build command
echo -e "${BLUE}Running: docker buildx build ${BUILD_ARGS} ${TAG_ARGS}.${NC}"
echo ""

# Execute build
if docker buildx build \
    "$BUILD_ARGS" \
    "$TAG_ARGS" \
    .; then
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✅ Build completed successfully!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Built tags:"
    for tag in "${TAGS[@]}"; do
        echo -e "  ${GREEN}✓${NC} $tag"
    done
    echo ""

    if [[ "$PUSH" == "true" ]]; then
        echo -e "${GREEN}🎉 Images pushed to registry${NC}"
        echo ""
        echo "Pull command:"
        echo -e "  ${BLUE}docker pull ${DOCKER_REPO}:${VERSION}${NC}"
    elif [[ "$LOAD" == "true" ]]; then
        echo -e "${GREEN}🎉 Image loaded to local Docker${NC}"
        echo ""
        echo "Run command:"
        echo -e "  ${BLUE}docker run -p 3000:3000 ${DOCKER_REPO}:${VERSION}${NC}"
    fi
    echo ""
else
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}❌ Build failed${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 1
fi
