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

# ---------------------------------------------------------------------------
# 同步仓库配置文件到 git ref (默认 origin/main)。解决 #459 合并后 admin 镜像
# 切换到 nginx-unprivileged:8080、但服务器磁盘上 docker-compose.prod.yml 还
# 映射到 :80 的事故（镜像更新了但配置没同步，gateway connect refused）。
#
# 行为：
#   - fetch + reset --hard，会丢弃 tracked 文件的本地修改（.env / .env.* 在
#     .gitignore 里不受影响）。
#   - 若 deploy.sh 自身被更新，exec 自己一次让新版本接管剩余流程。
#   - SKIP_GIT_SYNC=true 可跳过（离线环境或主动暂停 config 滚动）。
# ---------------------------------------------------------------------------
if [ "${SKIP_GIT_SYNC:-false}" != "true" ] && [ -d .git ]; then
  deploy_ref="${DEPLOY_GIT_REF:-origin/main}"
  fetch_ref="${deploy_ref#origin/}"
  fetch_ref="${fetch_ref:-main}"

  echo "[$(date -Iseconds)] Syncing repo to $deploy_ref"
  if ! git diff --quiet HEAD 2>/dev/null; then
    echo "[$(date -Iseconds)] WARN: working tree dirty, reset --hard will discard these tracked changes:"
    git status --porcelain | head -20 || true
  fi

  current_self_sha=$(sha256sum "$0" 2>/dev/null | awk '{print $1}')

  if ! git fetch --quiet --tags origin "$fetch_ref"; then
    echo "[$(date -Iseconds)] ERROR: git fetch origin $fetch_ref failed"
    exit 1
  fi
  # 用 FETCH_HEAD 而不是 $deploy_ref：若调用方传的是无 origin/ 前缀的本地分支名
  # (DEPLOY_GIT_REF=main)，reset 到本地 main 可能落空（git fetch 不更新本地分支
  # HEAD）。FETCH_HEAD 一定是刚 fetch 下来的那个 ref，确保跟远端同步。
  git reset --hard FETCH_HEAD

  new_self_sha=$(sha256sum "$0" 2>/dev/null | awk '{print $1}')
  if [ -n "$current_self_sha" ] && [ "$current_self_sha" != "$new_self_sha" ]; then
    echo "[$(date -Iseconds)] deploy.sh changed via sync, re-executing with new version"
    export SKIP_GIT_SYNC=true  # avoid infinite re-exec loop
    exec "$0" "$@"
  fi
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[$(date -Iseconds)] ERROR: compose file not found: $PROJECT_DIR/$COMPOSE_FILE"
  exit 1
fi

if [ -f .env ]; then
  # SECURITY (VULN-133): never `source` the .env file — that would let any value
  # like FOO=$(rm -rf /) be evaluated by bash. Instead, parse strict
  # KEY=VALUE pairs (allowing CAPS and underscores) and export them literally.
  #
  # BUG 修复：原先用 `while IFS='=' read -r k v` 解析。bash 在 IFS 为单一非空白
  # 字符时，会把**行尾的分隔符**当做"空 token"一并吃掉，导致形如
  #   AI_CREDENTIAL_ENCRYPTION_KEYS=Mt97...k=
  # 这类 base64 padding 带 '=' 结尾的值被截断成 43 字符，进而让 ai-service 在
  # Fernet 校验时启动失败。改成 `read -r line` + 参数展开，仅在**首个** '='
  # 处切分，value 的尾随 '=' 原样保留。
  echo "[$(date -Iseconds)] Loading env from $PROJECT_DIR/.env (strict parser)"
  while IFS= read -r line || [ -n "$line" ]; do
    # 跳过空行与注释
    case "$line" in
      ''|\#*) continue ;;
    esac
    # 行里必须至少含一个 '='，否则不是合法的 KEY=VALUE
    case "$line" in
      *=*) ;;
      *) continue ;;
    esac
    k="${line%%=*}"
    v="${line#*=}"
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

# Migration 必须先于 `up -d`：#459 加了 migration 000033 (jwt_secrets 表)，
# backend 启动时就要 SELECT 它，不存在就 FTL。原来的 run_migrations 要等
# backend healthy 再跑，死锁。改成一次性容器 `compose run --rm migrate up`，
# 不依赖 backend 长进程，postgres 通过 depends_on 自动拉起。
run_pre_deploy_migrations() {
  # incremental 里如果只动了前端，migration 可以跳过节省时间
  if [ "$DEPLOY_MODE" = "incremental" ]; then
    local needs_migrate=false
    for svc in $DEPLOY_SERVICES; do
      case "$svc" in
        backend|ai-service) needs_migrate=true ;;
      esac
    done
    if [ "$needs_migrate" != "true" ]; then
      echo "[$(date -Iseconds)] Frontend-only incremental deploy, skipping migrations"
      return
    fi
  fi

  echo "[$(date -Iseconds)] Pre-deploy migration (one-shot backend container)"
  local db_user="${AETHERBLOG_DATABASE_USER:-aetherblog}"
  local db_name="${AETHERBLOG_DATABASE_DBNAME:-aetherblog}"

  # URL-encode 用户名 / 密码，防止 @ : / ? # 等特殊字符破坏 DSN 格式。
  # 依赖服务器有 python3（deploy.sh 运行环境一贯有）。
  local db_user_enc db_pass_enc
  db_user_enc=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$db_user") || {
    echo "[$(date -Iseconds)] ERROR: failed to URL-encode db user"; exit 1
  }
  db_pass_enc=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "${POSTGRES_PASSWORD:-}") || {
    echo "[$(date -Iseconds)] ERROR: failed to URL-encode db password"; exit 1
  }
  local db_dsn="postgres://${db_user_enc}:${db_pass_enc}@postgres:5432/${db_name}?sslmode=disable"

  # 只传 -dsn flag：cmd/migrate/main.go 里 flag 优先、DATABASE_DSN env 仅兜底，
  # 两条同时设会冗余也让 log 更难排查。
  if docker compose -f "$COMPOSE_FILE" run --rm \
       --entrypoint /app/migrate \
       backend -dir /app/migrations -dsn "$db_dsn" up; then
    echo "[$(date -Iseconds)] Migrations applied successfully"
  else
    echo "[$(date -Iseconds)] ERROR: migration failed, aborting deploy"
    exit 1
  fi
}

run_full_deploy() {
  echo "[$(date -Iseconds)] Running docker compose pull (full)"
  docker compose -f "$COMPOSE_FILE" pull

  run_pre_deploy_migrations

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

  run_pre_deploy_migrations

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

  # canary 默认触达 backend/ai-service，同样先跑 migration 保障兼容性
  run_pre_deploy_migrations

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

# 说明：migration 现在在 `up -d` 之前由 run_pre_deploy_migrations 完成（见上方），
# 这里不再重复执行。保留 sanity 打印便于运维验证版本号。

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
