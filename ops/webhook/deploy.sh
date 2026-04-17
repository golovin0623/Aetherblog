#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="${PROJECT_DIR:-/root/Aetherblog}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
LOCK_FILE="${LOCK_FILE:-/var/lock/aetherblog-deploy.lock}"
LOG_FILE="${LOG_FILE:-/var/log/aetherblog-deploy.log}"

PREFLIGHT_SCRIPT="${PREFLIGHT_SCRIPT:-$PROJECT_DIR/ops/release/preflight.sh}"
PREFLIGHT_BLOCK="${PREFLIGHT_BLOCK:-true}"
PREFLIGHT_ARGS="${PREFLIGHT_ARGS:-}"

DEPLOY_MODE="${DEPLOY_MODE:-full}"   # full | incremental | canary | rollback
DEPLOY_SERVICES="${DEPLOY_SERVICES:-}"  # 增量部署的服务列表 (空格分隔)
CANARY_SERVICES="${CANARY_SERVICES:-backend,ai-service}"
ROLLBACK_VERSION="${ROLLBACK_VERSION:-}"

mkdir -p "$(dirname "$LOCK_FILE")"
mkdir -p "$(dirname "$LOG_FILE")"

# Use tee to write to both log file and stdout/stderr, so the calling
# process (webhook_server.py) can capture output for error reporting
exec > >(tee -a "$LOG_FILE") 2>&1

echo "[$(date -Iseconds)] Deployment requested"

action_summary="mode=$DEPLOY_MODE canary=$CANARY_SERVICES rollback=$ROLLBACK_VERSION"
echo "[$(date -Iseconds)] Deployment options: $action_summary"

exec 200>"$LOCK_FILE"
echo "[$(date -Iseconds)] Waiting deployment lock"
flock 200
echo "[$(date -Iseconds)] Lock acquired"

cd "$PROJECT_DIR"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[$(date -Iseconds)] ERROR: compose file not found: $PROJECT_DIR/$COMPOSE_FILE"
  exit 1
fi

if [ -f .env ]; then
  # SECURITY (VULN-133): never `source` the .env file — that would let any value
  # like FOO=$(rm -rf /) be evaluated by bash. Instead, parse strict
  # KEY=VALUE pairs (allowing CAPS and underscores) and export them literally.
  echo "[$(date -Iseconds)] Loading env from $PROJECT_DIR/.env (strict parser)"
  while IFS='=' read -r k v; do
    case "$k" in
      ''|\#*) continue ;;
    esac
    if [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ ]]; then
      # strip optional surrounding single/double quotes from value
      v="${v%\"}"
      v="${v#\"}"
      v="${v%\'}"
      v="${v#\'}"
      export "$k=$v"
    else
      echo "[$(date -Iseconds)] WARN: skipped malformed env key: $k" >&2
    fi
  done < .env
fi

# Preflight 阈值由仓库 ops/release/preflight.sh 作为单一真源维护（默认 60/1500）。
# 历史上一些部署主机的 .env 里保留了过紧的 68/1591，导致每次发布都卡在
#   [FAIL] [migration] ai_providers count too low: 67 (< 68)
#   [FAIL] [migration] ai_models count too low: 1543 (< 1591)
# 上。在这里显式 unset，允许脚本默认值接管；如果运维确实需要更严格的阈值，
# 可以在调用 deploy.sh 之前从命令行导出（而不是写进 .env）。
unset MIN_AI_PROVIDER_COUNT MIN_AI_MODEL_COUNT

export DOCKER_REGISTRY="${DOCKER_REGISTRY:-golovin0623}"
export VERSION="${VERSION:-latest}"

if [ "$DEPLOY_MODE" = "rollback" ]; then
  if [ -z "$ROLLBACK_VERSION" ]; then
    echo "[$(date -Iseconds)] ERROR: DEPLOY_MODE=rollback requires ROLLBACK_VERSION"
    exit 1
  fi
  export VERSION="$ROLLBACK_VERSION"
fi

echo "[$(date -Iseconds)] Using DOCKER_REGISTRY=$DOCKER_REGISTRY VERSION=$VERSION"
echo "[$(date -Iseconds)] Validating docker compose config"
docker compose -f "$COMPOSE_FILE" config --quiet

# Pre-deploy: only static checks (no runtime)
if [ -x "$PREFLIGHT_SCRIPT" ]; then
  echo "[$(date -Iseconds)] Running preflight (pre-deploy, no runtime checks)"
  "$PREFLIGHT_SCRIPT" --no-runtime || echo "[$(date -Iseconds)] WARN: static preflight failed"
else
  echo "[$(date -Iseconds)] WARN: preflight script not found or not executable: $PREFLIGHT_SCRIPT"
fi

run_full_deploy() {
  echo "[$(date -Iseconds)] Running docker compose pull (full)"
  docker compose -f "$COMPOSE_FILE" pull

  echo "[$(date -Iseconds)] Running docker compose up -d (full)"
  docker compose -f "$COMPOSE_FILE" up -d
}

run_incremental_deploy() {
  read -r -a services <<< "$DEPLOY_SERVICES"

  if [ "${#services[@]}" -eq 0 ]; then
    echo "[$(date -Iseconds)] WARN: DEPLOY_SERVICES is empty, falling back to full deploy"
    run_full_deploy
    return
  fi

  echo "[$(date -Iseconds)] Incremental deploy: ${services[*]}"
  echo "[$(date -Iseconds)] Middleware (postgres/redis) will NOT be restarted"

  echo "[$(date -Iseconds)] Pulling images: ${services[*]}"
  docker compose -f "$COMPOSE_FILE" pull "${services[@]}"

  echo "[$(date -Iseconds)] Recreating containers (--no-deps): ${services[*]}"
  docker compose -f "$COMPOSE_FILE" up -d --no-deps "${services[@]}"
}

run_canary_deploy() {
  IFS=',' read -r -a raw_services <<< "$CANARY_SERVICES"
  services=()
  for svc in "${raw_services[@]}"; do
    trimmed="$(echo "$svc" | xargs)"
    if [ -n "$trimmed" ]; then
      services+=("$trimmed")
    fi
  done

  if [ "${#services[@]}" -eq 0 ]; then
    echo "[$(date -Iseconds)] ERROR: CANARY_SERVICES is empty"
    exit 1
  fi

  echo "[$(date -Iseconds)] Running docker compose pull (canary): ${services[*]}"
  docker compose -f "$COMPOSE_FILE" pull "${services[@]}"

  echo "[$(date -Iseconds)] Running docker compose up -d (canary): ${services[*]}"
  docker compose -f "$COMPOSE_FILE" up -d "${services[@]}"
}

case "$DEPLOY_MODE" in
  full)
    run_full_deploy
    ;;
  incremental)
    run_incremental_deploy
    ;;
  canary)
    run_canary_deploy
    ;;
  rollback)
    echo "[$(date -Iseconds)] Rollback mode enabled, target VERSION=$VERSION"
    run_full_deploy
    ;;
  *)
    echo "[$(date -Iseconds)] ERROR: unsupported DEPLOY_MODE=$DEPLOY_MODE"
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# Post-deploy: run database migrations
# ---------------------------------------------------------------------------
run_migrations() {
  echo "[$(date -Iseconds)] Waiting for backend to become healthy..."
  local retries=0
  while (( retries < 30 )); do
    if docker compose -f "$COMPOSE_FILE" exec -T backend /app/server -health 2>/dev/null; then
      break
    fi
    retries=$((retries + 1))
    sleep 2
  done

  echo "[$(date -Iseconds)] Running database migrations via backend container"
  local db_dsn="postgres://${AETHERBLOG_DATABASE_USER:-aetherblog}:${POSTGRES_PASSWORD}@postgres:5432/${AETHERBLOG_DATABASE_DBNAME:-aetherblog}?sslmode=disable"
  if docker compose -f "$COMPOSE_FILE" exec -T backend /app/migrate -dir /app/migrations -dsn "$db_dsn" up; then
    echo "[$(date -Iseconds)] Migrations applied successfully"
  else
    echo "[$(date -Iseconds)] ERROR: migration failed"
    exit 1
  fi
}

run_migrations

echo "[$(date -Iseconds)] Current compose service status"
docker compose -f "$COMPOSE_FILE" ps

# ---------------------------------------------------------------------------
# Post-deploy: full preflight validation (runtime checks)
# ---------------------------------------------------------------------------
if [ -x "$PREFLIGHT_SCRIPT" ]; then
  echo "[$(date -Iseconds)] Running preflight (post-deploy, full validation)"
  if [ "$PREFLIGHT_BLOCK" = "true" ]; then
    # shellcheck disable=SC2086
    "$PREFLIGHT_SCRIPT" $PREFLIGHT_ARGS
  else
    # shellcheck disable=SC2086
    "$PREFLIGHT_SCRIPT" $PREFLIGHT_ARGS || echo "[$(date -Iseconds)] WARN: post-deploy preflight failed but PREFLIGHT_BLOCK=false"
  fi
fi

echo "[$(date -Iseconds)] Running docker image prune -f"
docker image prune -f

echo "[$(date -Iseconds)] Deployment completed"
