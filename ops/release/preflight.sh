#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
EXPECTED_FLYWAY_VERSION="${EXPECTED_FLYWAY_VERSION:-2.20}"
GATEWAY_PORT="${GATEWAY_PORT:-7899}"
GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-http://127.0.0.1:${GATEWAY_PORT}}"
RUNTIME_CHECKS=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-runtime) RUNTIME_CHECKS=false ;;
    --runtime) RUNTIME_CHECKS=true ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
  shift
done

passed=0
failed=0
skipped=0

pass() {
  passed=$((passed + 1))
  printf '[PASS] [%s] %s\n' "$1" "$2"
}

fail() {
  failed=$((failed + 1))
  printf '[FAIL] [%s] %s\n' "$1" "$2"
}

skip() {
  skipped=$((skipped + 1))
  printf '[SKIP] [%s] %s\n' "$1" "$2"
}

require_cmd() {
  local cmd="$1"
  if command -v "$cmd" >/dev/null 2>&1; then
    pass "env" "command available: $cmd"
  else
    fail "env" "missing command: $cmd"
  fi
}

version_ge() {
  local actual="$1"
  local expected="$2"
  [[ "$(printf '%s\n%s\n' "$actual" "$expected" | sort -V | head -n1)" == "$expected" ]]
}

main() {
  echo "[INFO] preflight started at $(date -Iseconds)"
  cd "$PROJECT_DIR"

  require_cmd docker
  require_cmd curl

  if ! docker compose -f "$COMPOSE_FILE" config --quiet >/dev/null 2>&1; then
    fail "compose" "docker compose config failed for $COMPOSE_FILE"
  else
    pass "compose" "docker compose config valid ($COMPOSE_FILE)"
  fi

  if [[ "$RUNTIME_CHECKS" != "true" ]]; then
    skip "runtime" "runtime checks disabled (--no-runtime)"
  else
    if ! docker info >/dev/null 2>&1; then
      fail "runtime" "docker daemon unavailable"
    else
      pass "runtime" "docker daemon reachable"
    fi

    local required_services=(postgres backend ai-service gateway)
    for service in "${required_services[@]}"; do
      if docker compose -f "$COMPOSE_FILE" ps --status running "$service" 2>/dev/null | grep -q "$service"; then
        pass "runtime" "service running: $service"
      else
        fail "runtime" "service not running: $service"
      fi
    done

    local latest_version
    if latest_version=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
      psql -U aetherblog -d aetherblog -Atc "SELECT COALESCE(MAX(version),'0') FROM flyway_schema_history WHERE success = true;" 2>/dev/null); then
      if version_ge "$latest_version" "$EXPECTED_FLYWAY_VERSION"; then
        pass "migration" "flyway version $latest_version >= $EXPECTED_FLYWAY_VERSION"
      else
        fail "migration" "flyway version $latest_version < $EXPECTED_FLYWAY_VERSION"
      fi
    else
      fail "migration" "failed to query flyway_schema_history"
    fi

    if curl -fsS --max-time 5 "$GATEWAY_BASE_URL/health" >/dev/null; then
      pass "api" "gateway health reachable: $GATEWAY_BASE_URL/health"
    else
      fail "api" "gateway health check failed: $GATEWAY_BASE_URL/health"
    fi

    if docker compose -f "$COMPOSE_FILE" exec -T backend \
      sh -lc "curl -fsS --max-time 5 http://ai-service:8000/health >/dev/null" 2>/dev/null; then
      pass "api" "backend -> ai-service health reachable"
    else
      fail "api" "backend -> ai-service health failed"
    fi

    local auth_status
    auth_status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$GATEWAY_BASE_URL/api/v1/admin/stats/ai-dashboard" || true)
    if [[ "$auth_status" == "401" || "$auth_status" == "403" ]]; then
      pass "auth" "protected API enforces auth (status=$auth_status)"
    else
      fail "auth" "unexpected auth status for protected API: ${auth_status:-unknown}"
    fi

    local log_status
    log_status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$GATEWAY_BASE_URL/api/v1/admin/system/logs?level=ERROR&lines=10" || true)
    if [[ "$log_status" == "401" || "$log_status" == "403" ]]; then
      pass "auth" "log API enforces auth (status=$log_status)"
    else
      fail "auth" "unexpected auth status for log API: ${log_status:-unknown}"
    fi

    if docker compose -f "$COMPOSE_FILE" exec -T backend \
      sh -lc "test -d /app/logs && ls /app/logs >/dev/null" 2>/dev/null; then
      pass "logs" "backend log directory readable (/app/logs)"
    else
      fail "logs" "backend log directory unreadable (/app/logs)"
    fi
  fi

  echo "[INFO] preflight summary: pass=$passed fail=$failed skip=$skipped"

  if (( failed > 0 )); then
    echo "[ERROR] preflight failed"
    exit 1
  fi

  echo "[INFO] preflight completed successfully"
}

main "$@"
