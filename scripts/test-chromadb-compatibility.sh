#!/usr/bin/env bash
# v2.2.0 ChromaDB compatibility test — exercises every new tool against a live
# docker-compose chromadb instance via the MCP HTTP endpoint.
#
# Prerequisites:
#   - docker-compose -f docker-compose.test.yml up -d chromadb
#   - server running on $MCP_BASE_URL (default http://localhost:3000)
#   - CHROMA_ADMIN_TOOLS_ENABLED=true
#   - CHROMA_ALLOW_DESTRUCTIVE_OPS=true
set -euo pipefail

MCP_BASE_URL="${MCP_BASE_URL:-http://localhost:3000}"
MCP_ENDPOINT="${MCP_BASE_URL}/mcp"
AUTH_HEADER=""
if [ -n "${MCP_AUTH_TOKEN:-}" ]; then
  AUTH_HEADER="-H Authorization: Bearer ${MCP_AUTH_TOKEN}"
fi

# Tools exercised:
# Collection-method (R1, R3, R4): chroma_upsert_documents, chroma_modify_collection, chroma_get_or_create_collection
# Search/fork/indexing/client-info (R5–R12): chroma_search, chroma_fork_collection, chroma_get_fork_count, chroma_get_indexing_status, chroma_heartbeat, chroma_get_server_version, chroma_count_collections, chroma_get_max_batch_size, chroma_get_user_identity
# AdminClient (R20–R24): chroma_admin_create_database, chroma_admin_get_database, chroma_admin_list_databases, chroma_admin_create_tenant, chroma_admin_get_tenant
# Destructive (R25–R26): chroma_reset_database, chroma_admin_delete_database

call_tool() {
  local tool_name="$1"
  local args_json="$2"
  echo ">>> ${tool_name}"
  curl -sS -X POST "${MCP_ENDPOINT}" \
    ${AUTH_HEADER} \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"${tool_name}\",\"arguments\":${args_json}}}" \
    -o /dev/null -w "  HTTP %{http_code}\n"
}

TEST_TENANT="compat_tenant_$$"
TEST_DB="compat_db_$$"
TEST_COLLECTION="compat_collection_$$"

call_tool chroma_heartbeat '{}'
call_tool chroma_get_server_version '{}'
call_tool chroma_count_collections '{}'
call_tool chroma_get_max_batch_size '{}'
call_tool chroma_get_user_identity '{}'

call_tool chroma_admin_create_tenant "{\"name\":\"${TEST_TENANT}\"}"
call_tool chroma_admin_get_tenant "{\"name\":\"${TEST_TENANT}\"}"
call_tool chroma_admin_create_database "{\"name\":\"${TEST_DB}\",\"tenant\":\"${TEST_TENANT}\"}"
call_tool chroma_admin_get_database "{\"name\":\"${TEST_DB}\",\"tenant\":\"${TEST_TENANT}\"}"
call_tool chroma_admin_list_databases "{\"tenant\":\"${TEST_TENANT}\"}"

call_tool chroma_get_or_create_collection "{\"collection_name\":\"${TEST_COLLECTION}\"}"
call_tool chroma_upsert_documents "{\"collection_name\":\"${TEST_COLLECTION}\",\"ids\":[\"a\",\"b\"],\"documents\":[\"doc a\",\"doc b\"]}"
call_tool chroma_modify_collection "{\"collection_name\":\"${TEST_COLLECTION}\",\"metadata\":{\"updated\":\"v2.2.0\"}}"
call_tool chroma_get_indexing_status "{\"collection_name\":\"${TEST_COLLECTION}\"}"
call_tool chroma_search "{\"collection_name\":\"${TEST_COLLECTION}\",\"payload\":{\"knn\":{\"query\":\"doc\",\"limit\":3}}}"
call_tool chroma_fork_collection "{\"collection_name\":\"${TEST_COLLECTION}\",\"new_name\":\"${TEST_COLLECTION}_fork\"}"
call_tool chroma_get_fork_count "{\"collection_name\":\"${TEST_COLLECTION}\"}"

call_tool chroma_admin_delete_database "{\"name\":\"${TEST_DB}\",\"tenant\":\"${TEST_TENANT}\"}"
if [ "${COMPAT_RUN_RESET:-0}" = "1" ]; then
  call_tool chroma_reset_database '{}'
else
  echo ">>> chroma_reset_database  SKIPPED (set COMPAT_RUN_RESET=1 to exercise)"
fi

echo "compatibility script finished"