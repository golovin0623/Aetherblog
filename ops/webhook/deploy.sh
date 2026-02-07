#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="${PROJECT_DIR:-/root/Aetherblog}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
LOCK_FILE="${LOCK_FILE:-/var/lock/aetherblog-deploy.lock}"
LOG_FILE="${LOG_FILE:-/var/log/aetherblog-deploy.log}"

mkdir -p "$(dirname "$LOCK_FILE")"
mkdir -p "$(dirname "$LOG_FILE")"

exec >>"$LOG_FILE" 2>&1

echo "[$(date -Iseconds)] Deployment requested"

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

echo "[$(date -Iseconds)] Using DOCKER_REGISTRY=$DOCKER_REGISTRY VERSION=$VERSION"
echo "[$(date -Iseconds)] Validating docker compose config"
docker compose -f "$COMPOSE_FILE" config --quiet

echo "[$(date -Iseconds)] Running docker compose pull"
docker compose -f "$COMPOSE_FILE" pull

echo "[$(date -Iseconds)] Running docker compose up -d"
docker compose -f "$COMPOSE_FILE" up -d

echo "[$(date -Iseconds)] Running docker image prune -f"
docker image prune -f

echo "[$(date -Iseconds)] Deployment completed"
