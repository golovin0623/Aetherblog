#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
EXPECTED_MIGRATION_VERSION="${EXPECTED_MIGRATION_VERSION:-31}"
GATEWAY_PORT="${GATEWAY_PORT:-7899}"
GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-http://127.0.0.1:${GATEWAY_PORT}}"
MIN_AI_PROVIDER_COUNT="${MIN_AI_PROVIDER_COUNT:-60}"
# 内置模型种子数据使用保守下限阈值。
# 原始 seed 行可能在 (provider_id, model_id) 上有重复，
# 所以可达的有效计数低于原始 INSERT 行数。
MIN_AI_MODEL_COUNT="${MIN_AI_MODEL_COUNT:-1500}"
ADMIN_BEARER_TOKEN="${ADMIN_BEARER_TOKEN:-}"
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

compose_container_id() {
  local service="$1"
  docker compose -f "$COMPOSE_FILE" ps -q "$service" 2>/dev/null | head -n 1
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

    # Frontend containers can be "running" while Docker already marks them
    # unhealthy (or while restart=unless-stopped is hiding a crash loop). Wait
    # for their healthchecks as one concurrent group so a deploy cannot return
    # 200 with a dead admin/blog upstream. The ~75s ceiling covers the blog's
    # 30s start period plus its next 30s probe and 5s timeout, with margin for
    # scheduler drift, without serially waiting once per service.
    local frontend_services=(blog admin gateway)
    local frontend_attempt=0 frontend_attempts=25 frontend_pending=true
    local container_id service_status health_status
    while (( frontend_attempt < frontend_attempts )); do
      frontend_attempt=$((frontend_attempt + 1))
      frontend_pending=false
      for service in "${frontend_services[@]}"; do
        container_id=$(compose_container_id "$service" || true)
        if [[ -z "$container_id" ]]; then
          frontend_pending=true
          continue
        fi
        service_status=$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || echo missing)
        health_status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || echo missing)
        if [[ "$service_status" != "running" || "$health_status" != "healthy" ]]; then
          frontend_pending=true
        fi
      done
      if [[ "$frontend_pending" == "false" ]]; then
        break
      fi
      sleep 3
    done

    for service in "${frontend_services[@]}"; do
      container_id=$(compose_container_id "$service" || true)
      if [[ -z "$container_id" ]]; then
        fail "runtime" "frontend service missing after deploy: $service"
        continue
      fi
      service_status=$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || echo missing)
      health_status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || echo missing)
      if [[ "$service_status" == "running" && "$health_status" == "healthy" ]]; then
        pass "runtime" "frontend healthy: $service (attempt $frontend_attempt/$frontend_attempts)"
      else
        fail "runtime" "frontend unhealthy: $service (state=$service_status, health=$health_status)"
      fi
    done

    local latest_version
    if latest_version=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
      psql -U aetherblog -d aetherblog -Atc "SELECT COALESCE(MAX(version),0) FROM schema_migrations;" 2>/dev/null); then
      if [[ "$latest_version" =~ ^[0-9]+$ ]] && (( latest_version >= EXPECTED_MIGRATION_VERSION )); then
        pass "migration" "golang-migrate version $latest_version >= $EXPECTED_MIGRATION_VERSION"
      else
        fail "migration" "golang-migrate version ${latest_version:-unknown} < $EXPECTED_MIGRATION_VERSION"
      fi
    else
      fail "migration" "schema_migrations table not found (run: CREATE TABLE schema_migrations + INSERT version)"
    fi

    if curl -fsS --max-time 5 "$GATEWAY_BASE_URL/health" >/dev/null; then
      pass "api" "gateway health reachable: $GATEWAY_BASE_URL/health"
    else
      fail "api" "gateway health check failed: $GATEWAY_BASE_URL/health"
    fi

    # 在 ai-service 容器内执行 curl（与 docker healthcheck 保持一致）。
    # 避免对 host→容器 IP 路由的隐式假设，也避开多网络容器场景下
    # `hostname -i` 返回多个空格分隔 IP 的问题。
    #
    # 冷启动窗口：Python 导入 litellm/asyncpg/pgvector + FastAPI lifespan 里
    # asyncpg.create_pool(min_size=1) 首连 + jwt_keys 首次 DB 拉取，整段在慢机
    # 上可超过 60s。把 preflight 的重试窗口拉到 ~120s，匹配 docker-compose 里
    # ai-service 的 start_period=45s + 几轮 interval=10s 的 healthcheck。
    # 任一条件成立即视为通过：
    #   (a) docker inspect 已经 Health.Status=healthy（最权威），或
    #   (b) 在容器内 curl /health 成功（docker 本轮 interval 还没跑到也能判活）。
    local ai_ok=false ai_attempts=24 ai_attempt=0 ai_last_err="" ai_health="unknown"
    while (( ai_attempt < ai_attempts )); do
      ai_attempt=$((ai_attempt + 1))
      ai_health=$(docker inspect --format '{{.State.Health.Status}}' aetherblog-ai-service 2>/dev/null || echo unknown)
      if [[ "$ai_health" == "healthy" ]]; then
        ai_ok=true
        break
      fi
      if ai_last_err=$(docker compose -f "$COMPOSE_FILE" exec -T ai-service \
          curl -fsS --max-time 5 http://localhost:8000/health 2>&1); then
        ai_ok=true
        break
      fi
      sleep 5
    done
    if [[ "$ai_ok" == "true" ]]; then
      pass "api" "ai-service health reachable (docker=${ai_health}, attempt $ai_attempt/$ai_attempts)"
    else
      fail "api" "ai-service health check failed (docker health=${ai_health}); last error: ${ai_last_err}"
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

    if [[ -n "$ADMIN_BEARER_TOKEN" ]]; then
      local dashboard_status
      dashboard_status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 \
        -H "Authorization: Bearer $ADMIN_BEARER_TOKEN" \
        "$GATEWAY_BASE_URL/api/v1/admin/stats/ai-dashboard?days=7&pageNum=1&pageSize=20" || true)
      if [[ "$dashboard_status" == "200" ]]; then
        pass "api" "ai dashboard API reachable with auth (status=200)"
      else
        fail "api" "ai dashboard API failed with auth (status=${dashboard_status:-unknown})"
      fi
    else
      skip "api" "skip authenticated ai dashboard check (set ADMIN_BEARER_TOKEN)"
    fi

    local provider_count
    if provider_count=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
      psql -U aetherblog -d aetherblog -Atc "SELECT COUNT(*) FROM ai_providers;" 2>/dev/null); then
      if [[ "$provider_count" =~ ^[0-9]+$ ]] && (( provider_count >= MIN_AI_PROVIDER_COUNT )); then
        pass "migration" "ai_providers count=$provider_count (>= $MIN_AI_PROVIDER_COUNT)"
      else
        fail "migration" "ai_providers count too low: ${provider_count:-unknown} (< $MIN_AI_PROVIDER_COUNT)"
      fi
    else
      fail "migration" "failed to query ai_providers count"
    fi

    local model_count
    if model_count=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
      psql -U aetherblog -d aetherblog -Atc "SELECT COUNT(*) FROM ai_models;" 2>/dev/null); then
      if [[ "$model_count" =~ ^[0-9]+$ ]] && (( model_count >= MIN_AI_MODEL_COUNT )); then
        pass "migration" "ai_models count=$model_count (>= $MIN_AI_MODEL_COUNT)"
      else
        fail "migration" "ai_models count too low: ${model_count:-unknown} (< $MIN_AI_MODEL_COUNT)"
      fi
    else
      fail "migration" "failed to query ai_models count"
    fi

    if docker compose -f "$COMPOSE_FILE" logs --tail 400 backend 2>/dev/null | grep -q "AI schema health check found missing columns in ai_usage_logs"; then
      fail "logs" "backend logs contain ai_usage_logs schema-missing errors"
    else
      pass "logs" "backend logs have no ai_usage_logs schema-missing errors in recent window"
    fi

    if docker compose -f "$COMPOSE_FILE" exec -T backend \
      sh -lc "test -d /app/logs && ls /app/logs >/dev/null" 2>/dev/null; then
      pass "logs" "backend log directory readable (/app/logs)"
    else
      fail "logs" "backend log directory unreadable (/app/logs)"
    fi

    # ------------------------------------------------------------------------
    # webhook 进程新鲜度：deploy-webhook 是常驻 systemd 进程，磁盘上
    # webhook_server.py 改了之后必须重启进程才会被加载。
    # 若进程启动时间比文件 mtime 早 → 跑的是过期代码，FAIL 让运维立刻看见。
    # 历史事故 2026-05-05：进程跑 5 月 3 日的旧版本 8 小时，scanner 半开连接
    # 把单线程 recvfrom 钉死，PR #602 / #597 部署连续失败。详见
    # ops/webhook/deploy.sh 末尾的 restart_webhook_if_stale。
    # ------------------------------------------------------------------------
    local webhook_py="$PROJECT_DIR/ops/webhook/webhook_server.py"
    if ! command -v systemctl >/dev/null 2>&1; then
      skip "webhook" "systemctl not available, cannot check deploy-webhook freshness"
    elif [[ ! -f "$webhook_py" ]]; then
      skip "webhook" "webhook_server.py not found at $webhook_py"
    elif [[ "$(systemctl is-active deploy-webhook 2>/dev/null || true)" != "active" ]]; then
      skip "webhook" "deploy-webhook service not active on this host"
    else
      local wh_file_mtime wh_proc_iso wh_proc_epoch
      wh_file_mtime=$(stat -c %Y "$webhook_py" 2>/dev/null || echo 0)
      # `--value` 是 systemd 230+ 才有的 flag；CentOS 7 (systemd 219) 不识别会
      # 把 `ActiveEnterTimestamp=...` 整段返回，date -d 解析失败让本检查永远 skip。
      # 用 `cut -d= -f2-` 跨版本一致剥掉 KEY= 前缀。
      wh_proc_iso=$(systemctl show deploy-webhook --property=ActiveEnterTimestamp 2>/dev/null | cut -d= -f2- || true)
      wh_proc_epoch=$(date -d "$wh_proc_iso" +%s 2>/dev/null || echo 0)
      if (( wh_proc_epoch == 0 )); then
        skip "webhook" "deploy-webhook ActiveEnterTimestamp unavailable or unparseable ('$wh_proc_iso')"
      elif (( wh_proc_epoch >= wh_file_mtime )); then
        pass "webhook" "deploy-webhook process started after webhook_server.py mtime (proc=$wh_proc_iso)"
      else
        fail "webhook" "deploy-webhook process is older than webhook_server.py — run: sudo systemctl restart deploy-webhook (proc=$wh_proc_iso, file_mtime_epoch=$wh_file_mtime)"
      fi
    fi
  fi

  echo "[INFO] preflight summary: pass=$passed fail=$failed skip=$skipped"

  if (( failed > 0 )); then
    if [[ "$RUNTIME_CHECKS" == "true" ]]; then
      echo "[INFO] frontend runtime diagnostics (compose status + recent logs)"
      docker compose -f "$COMPOSE_FILE" ps -a || true
      docker compose -f "$COMPOSE_FILE" logs --tail 80 gateway admin blog || true
    fi
    echo "[ERROR] preflight failed"
    exit 1
  fi

  echo "[INFO] preflight completed successfully"
}

main "$@"
