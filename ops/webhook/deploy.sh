#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="${PROJECT_DIR:-/root/Aetherblog}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
LOCK_FILE="${LOCK_FILE:-/var/lock/aetherblog-deploy.lock}"
LOG_FILE="${LOG_FILE:-/var/log/aetherblog-deploy.log}"

PREFLIGHT_SCRIPT="${PREFLIGHT_SCRIPT:-$PROJECT_DIR/ops/release/preflight.sh}"
PREFLIGHT_BLOCK="${PREFLIGHT_BLOCK:-true}"
PREFLIGHT_ARGS="${PREFLIGHT_ARGS:-}"

DEPLOY_MODE="${DEPLOY_MODE:-full}"   # full | canary | rollback
CANARY_SERVICES="${CANARY_SERVICES:-backend,ai-service}"
ROLLBACK_VERSION="${ROLLBACK_VERSION:-}"

mkdir -p "$(dirname "$LOCK_FILE")"
mkdir -p "$(dirname "$LOG_FILE")"

exec >>"$LOG_FILE" 2>&1

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
  echo "[$(date -Iseconds)] Loading env from $PROJECT_DIR/.env"
  set -a
  . ./.env
  set +a
fi

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

if [ -x "$PREFLIGHT_SCRIPT" ]; then
  echo "[$(date -Iseconds)] Running preflight script: $PREFLIGHT_SCRIPT $PREFLIGHT_ARGS"
  if [ "$PREFLIGHT_BLOCK" = "true" ]; then
    # shellcheck disable=SC2086
    "$PREFLIGHT_SCRIPT" $PREFLIGHT_ARGS
  else
    # shellcheck disable=SC2086
    "$PREFLIGHT_SCRIPT" $PREFLIGHT_ARGS || echo "[$(date -Iseconds)] WARN: preflight failed but PREFLIGHT_BLOCK=false"
  fi
else
  echo "[$(date -Iseconds)] WARN: preflight script not found or not executable: $PREFLIGHT_SCRIPT"
fi

run_full_deploy() {
  echo "[$(date -Iseconds)] Running docker compose pull (full)"
  docker compose -f "$COMPOSE_FILE" pull

  echo "[$(date -Iseconds)] Running docker compose up -d (full)"
  docker compose -f "$COMPOSE_FILE" up -d
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

echo "[$(date -Iseconds)] Current compose service status"
docker compose -f "$COMPOSE_FILE" ps

echo "[$(date -Iseconds)] Running docker image prune -f"
docker image prune -f

echo "[$(date -Iseconds)] Deployment completed"
