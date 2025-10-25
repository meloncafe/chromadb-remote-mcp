#!/bin/bash
set -e

# ChromaDB Remote MCP - Integration Test Script
# Usage: ./scripts/test.sh [options]

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Default values
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yml}"
CLEANUP="${CLEANUP:-true}"
TEST_TOKEN="test-token-$(openssl rand -hex 16)"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --no-cleanup)
      CLEANUP="false"
      shift
      ;;
    --compose-file)
      COMPOSE_FILE="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --no-cleanup           Keep containers running after tests"
      echo "  --compose-file <file>  Use specific docker-compose file (default: docker-compose.dev.yml)"
      echo "  --help, -h             Show this help message"
      echo ""
      echo "Examples:"
      echo "  # Run tests and cleanup"
      echo "  $0"
      echo ""
      echo "  # Run tests and keep containers for debugging"
      echo "  $0 --no-cleanup"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  ChromaDB Remote MCP - Integration Tests${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Detect docker-compose command
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
elif docker compose version &> /dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
else
    echo -e "${RED}❌ Docker Compose not found${NC}"
    exit 1
fi

echo -e "${YELLOW}🧹 Cleaning up any existing test containers...${NC}"
$DOCKER_COMPOSE -f "$COMPOSE_FILE" down -v 2>/dev/null || true

# Create temporary .env file for testing
echo -e "${YELLOW}📝 Creating test environment configuration...${NC}"
cat > .env.test << EOF
PORT=3000
CHROMA_DATA_PATH=chroma-test-data
CHROMA_HOST=chromadb
CHROMA_PORT=8000
CHROMA_TENANT=default_tenant
CHROMA_DATABASE=default_database
MCP_AUTH_TOKEN=${TEST_TOKEN}
RATE_LIMIT_MAX=1000
EOF

# Start services
echo -e "${YELLOW}🚀 Starting test services...${NC}"
MCP_AUTH_TOKEN="$TEST_TOKEN" $DOCKER_COMPOSE -f "$COMPOSE_FILE" up -d

# Wait for services to be ready
echo -e "${YELLOW}⏳ Waiting for services to be ready...${NC}"
MAX_WAIT=60
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
    if curl -s http://localhost:8080/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Services are ready!${NC}"
        break
    fi
    echo -n "."
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo -e "\n${RED}❌ Services failed to start within ${MAX_WAIT}s${NC}"
    echo -e "${YELLOW}📋 Service logs:${NC}"
    $DOCKER_COMPOSE -f "$COMPOSE_FILE" logs
    $DOCKER_COMPOSE -f "$COMPOSE_FILE" down -v
    rm -f .env.test
    exit 1
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Running Tests${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

FAILED_TESTS=0

# Test 1: Health Check (No Auth Required)
echo -e "${YELLOW}Test 1: Health Check${NC}"
if curl -s http://localhost:8080/health | grep -q "ok"; then
    echo -e "${GREEN}  ✅ PASS${NC}"
else
    echo -e "${RED}  ❌ FAIL${NC}"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# Test 2: MCP Endpoint - Unauthorized (No Token)
echo -e "${YELLOW}Test 2: MCP Endpoint - Unauthorized${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8080/mcp \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
if [ "$HTTP_CODE" == "401" ]; then
    echo -e "${GREEN}  ✅ PASS (Got 401 as expected)${NC}"
else
    echo -e "${RED}  ❌ FAIL (Expected 401, got $HTTP_CODE)${NC}"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# Test 3: MCP Endpoint - Authorized (Bearer Token)
echo -e "${YELLOW}Test 3: MCP Endpoint - Bearer Token Auth${NC}"
RESPONSE=$(curl -s -X POST http://localhost:8080/mcp \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TEST_TOKEN" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
if echo "$RESPONSE" | grep -q "chroma_list_collections"; then
    echo -e "${GREEN}  ✅ PASS${NC}"
else
    echo -e "${RED}  ❌ FAIL${NC}"
    echo "  Response: $RESPONSE"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# Test 4: MCP Endpoint - Query Parameter Auth
echo -e "${YELLOW}Test 4: MCP Endpoint - Query Parameter Auth${NC}"
RESPONSE=$(curl -s -X POST "http://localhost:8080/mcp?apiKey=$TEST_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
if echo "$RESPONSE" | grep -q "chroma_list_collections"; then
    echo -e "${GREEN}  ✅ PASS${NC}"
else
    echo -e "${RED}  ❌ FAIL${NC}"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# Test 5: ChromaDB REST API Proxy - Unauthorized
echo -e "${YELLOW}Test 5: ChromaDB REST API - Unauthorized${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/v2/heartbeat)
if [ "$HTTP_CODE" == "401" ]; then
    echo -e "${GREEN}  ✅ PASS (Got 401 as expected)${NC}"
else
    echo -e "${RED}  ❌ FAIL (Expected 401, got $HTTP_CODE)${NC}"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# Test 6: ChromaDB REST API Proxy - Authorized
echo -e "${YELLOW}Test 6: ChromaDB REST API - X-Chroma-Token Auth${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/v2/heartbeat \
    -H "X-Chroma-Token: $TEST_TOKEN")
if [ "$HTTP_CODE" == "200" ]; then
    echo -e "${GREEN}  ✅ PASS${NC}"
else
    echo -e "${RED}  ❌ FAIL (Expected 200, got $HTTP_CODE)${NC}"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# Test 7: Create Collection via MCP
echo -e "${YELLOW}Test 7: Create Collection via MCP${NC}"
RESPONSE=$(curl -s -X POST "http://localhost:8080/mcp?apiKey=$TEST_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "jsonrpc":"2.0",
        "id":2,
        "method":"tools/call",
        "params":{
            "name":"chroma_create_collection",
            "arguments":{"collection_name":"test_collection"}
        }
    }')
if echo "$RESPONSE" | grep -q "created successfully"; then
    echo -e "${GREEN}  ✅ PASS${NC}"
else
    echo -e "${RED}  ❌ FAIL${NC}"
    echo "  Response: $RESPONSE"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# Test 8: List Collections via MCP
echo -e "${YELLOW}Test 8: List Collections via MCP${NC}"
RESPONSE=$(curl -s -X POST "http://localhost:8080/mcp?apiKey=$TEST_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "jsonrpc":"2.0",
        "id":3,
        "method":"tools/call",
        "params":{
            "name":"chroma_list_collections",
            "arguments":{}
        }
    }')
if echo "$RESPONSE" | grep -q "test_collection"; then
    echo -e "${GREEN}  ✅ PASS${NC}"
else
    echo -e "${RED}  ❌ FAIL${NC}"
    echo "  Response: $RESPONSE"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Test Results${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

TOTAL_TESTS=8
PASSED_TESTS=$((TOTAL_TESTS - FAILED_TESTS))

echo -e "Total:  ${BLUE}$TOTAL_TESTS${NC}"
echo -e "Passed: ${GREEN}$PASSED_TESTS${NC}"
echo -e "Failed: ${RED}$FAILED_TESTS${NC}"
echo ""

# Cleanup
if [ "$CLEANUP" == "true" ]; then
    echo -e "${YELLOW}🧹 Cleaning up test environment...${NC}"
    $DOCKER_COMPOSE -f "$COMPOSE_FILE" down -v
    rm -f .env.test
    echo -e "${GREEN}✅ Cleanup complete${NC}"
else
    echo -e "${YELLOW}⚠️  Test containers are still running${NC}"
    echo -e "${YELLOW}   Stop with: $DOCKER_COMPOSE -f $COMPOSE_FILE down -v${NC}"
fi

echo ""
if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 0
else
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}❌ $FAILED_TESTS test(s) failed${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 1
fi
