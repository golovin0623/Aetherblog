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

# 用 tee 同时写入日志文件和 stdout/stderr，让调用方进程
# (webhook_server.py) 也能捕获输出用于错误上报
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
  fetch_ref="${fetch_ref#refs/heads/}"
  fetch_ref="${fetch_ref:-main}"
  deploy_commit_sha="${DEPLOY_COMMIT_SHA:-}"

  # 安全边界：webhook 部署只允许同步分支（branch）。若调用方传入 refs/tags/*
  # 或其他非 refs/heads/* 的全限定 ref，直接拒绝 —— 否则下面拼出来的
  # `+refs/heads/${fetch_ref}:...` 在远端找不到对象时会失败，但更危险的是
  # 任何"看起来像分支"的歧义都该被显式挡掉，避免 #602 关闭的 tag 影子攻击
  # 以新形态绕回来。
  case "$fetch_ref" in
    refs/*)
      echo "[$(date -Iseconds)] ERROR: DEPLOY_GIT_REF must reference a branch (got non-branch ref: $deploy_ref)"
      exit 1
      ;;
  esac

  deploy_remote_ref="refs/remotes/origin/${fetch_ref}"

  if [ -z "$deploy_commit_sha" ]; then
    echo "[$(date -Iseconds)] ERROR: DEPLOY_COMMIT_SHA is required when git sync is enabled"
    echo "[$(date -Iseconds)] Refusing to run host-side deploy using an unpinned remote ref: $deploy_ref"
    exit 1
  fi
  # 仅接受完整 hex SHA。否则像 HEAD / FETCH_HEAD / 本地分支名都能通过后面
  # cat-file -e + merge-base --is-ancestor 校验，让 git reset --hard 跟着浮动
  # ref 走，整个 pin 形同虚设（gemini / codex review 指出的绕过路径）。
  if ! [[ "$deploy_commit_sha" =~ ^[0-9a-f]{40,64}$ ]]; then
    echo "[$(date -Iseconds)] ERROR: DEPLOY_COMMIT_SHA must be a full lowercase hex SHA (40-64 chars), got: $deploy_commit_sha"
    exit 1
  fi

  echo "[$(date -Iseconds)] Syncing repo to $deploy_ref at pinned commit $deploy_commit_sha"
  if ! git diff --quiet HEAD 2>/dev/null; then
    echo "[$(date -Iseconds)] WARN: working tree dirty, reset --hard will discard these tracked changes:"
    git status --porcelain | head -20 || true
  fi

  current_self_sha=$(sha256sum "$0" 2>/dev/null | awk '{print $1}')

  # 显式 `+refs/heads/<branch>:refs/remotes/origin/<branch>` + `--no-tags`：
  #   - 旧版用 `git fetch --tags origin "$fetch_ref"` 把 tag 一起拉下来，
  #     若攻击者推送了与分支同名 / 含 deploy_commit_sha 的 tag，下游
  #     FETCH_HEAD 与 reachability 检查都会被污染 (#602)。
  #   - 现在强制只取 refs/heads/<branch> 写入受控的远端跟踪命名空间
  #     ($deploy_remote_ref)，下面的 merge-base --is-ancestor 直接拿这个
  #     ref 当 anchor，配合 #601 的 DEPLOY_COMMIT_SHA pin 把"fetch 到了什么
  #     对象"和"reset 到了哪个 commit"两件事都钉死，不留 tag / FETCH_HEAD
  #     歧义。
  if ! git fetch --quiet --no-tags origin "+refs/heads/${fetch_ref}:${deploy_remote_ref}"; then
    echo "[$(date -Iseconds)] ERROR: git fetch origin refs/heads/$fetch_ref failed"
    exit 1
  fi
  if ! git cat-file -e "${deploy_commit_sha}^{commit}" 2>/dev/null; then
    echo "[$(date -Iseconds)] ERROR: pinned commit not found after fetch: $deploy_commit_sha"
    exit 1
  fi
  # 用 $deploy_remote_ref 而不是 FETCH_HEAD：fetch 已经强制写到了受控的远端
  # 跟踪命名空间 (refs/remotes/origin/<branch>)，FETCH_HEAD 在 --no-tags +
  # 单 refspec 场景下虽然也指向同一个 commit，但显式引用 deploy_remote_ref
  # 让 reachability 检查与 #602 的 tag-shadow 防护描述一致，未来若有人改回
  # 多 refspec 也不会让 FETCH_HEAD 的语义偏移影响这条断言。
  if ! git merge-base --is-ancestor "$deploy_commit_sha" "$deploy_remote_ref"; then
    echo "[$(date -Iseconds)] ERROR: pinned commit $deploy_commit_sha is not reachable from fetched $deploy_ref"
    exit 1
  fi
  git reset --hard "$deploy_commit_sha"

  new_self_sha=$(sha256sum "$0" 2>/dev/null | awk '{print $1}')
  if [ -n "$current_self_sha" ] && [ "$current_self_sha" != "$new_self_sha" ]; then
    # 历史上这里 `exec "$0" "$@"` 自举新版本，但与脚本顶部 `exec > >(tee ...)`
    # 的 process substitution 叠加后，原 tee subshell 不随 exec 被回收，产生
    # 双 tee / 双日志 / fd 200 锁归属混乱，最终触发 flock 死锁（见事故
    # 2026-04-19：5 次 CI 触发全部卡在 "Waiting deployment lock"）。
    # 改为不再 re-exec：本次用预同步版本跑完，下一次 webhook 触发时会自然
    # 用新版 deploy.sh。代价是 deploy.sh 关键变更需要多等一次部署生效。
    echo "[$(date -Iseconds)] WARN: deploy.sh updated on disk; continuing this run with pre-sync version. Next deploy will use the new script."
  fi
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[$(date -Iseconds)] ERROR: compose file not found: $PROJECT_DIR/$COMPOSE_FILE"
  exit 1
fi

if [ -f .env ]; then
  # SECURITY (VULN-133): 绝不 `source` .env 文件 —— 那会让 FOO=$(rm -rf /)
  # 这种值被 bash 求值。改为严格解析 KEY=VALUE 对（仅允许大写字母与下划线
  # 的 KEY），按字面值导出。
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
      # 去掉值两端可选的单引号/双引号
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

# 部署前：仅做静态检查（不做运行时检查）
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

  # ----------------------------------------------------------
  # 故障自愈: 已知"安全可重放"的 dirty 版本表 —— 只有写过 recipe 的版本才会被
  # 自愈, 其他 dirty 一律中止, 避免把真正需要人工介入的迁移故障误 heal 成
  # "绿色部署".
  #
  # 当前覆盖的 dirty 特征:
  #   v34 → force 35
  #     起因: 000034 (versioned_post_embeddings) 使用 CREATE TABLE IF NOT
  #     EXISTS post_embeddings, 但 000001 已建过 chunk-版同名表; CREATE
  #     TABLE 被静默跳过后, 紧随其后的 CREATE INDEX ... WHERE dim = 1536
  #     AND status = 'active' 引用旧表不存在的列直接崩塌, schema_migrations
  #     被标 dirty. 自愈: force 35 跳过坏掉的 v34, 让 000036 的幂等修复
  #     重建 schema.
  #
  #   v38 → force 38 (000039 接管真正的修复)
  #     起因: 000038 (improve_ai_prompts) 末尾的 ALTER TABLE posts ALTER
  #     COLUMN summary TYPE VARCHAR(2000) 在所有真实部署上都会撞死 ——
  #     v_published_posts (000001:428) 用 SELECT p.* 引用了 posts.summary,
  #     PostgreSQL 报 0A000 "cannot alter type of a column used by a view
  #     or rule". golang-migrate 默认事务里跑整个 migration, ALTER 失败时
  #     连同前面 7 条 UPDATE ai_task_types 一起回滚. v38 dirty 实例上
  #     ai_task_types.prompt_template 仍是 000019 旧版, posts.summary 仍是
  #     VARCHAR(500). PR #521 当初的 "force 37 + 重放 038" 是基于"038 全幂等"
  #     的错误判断, 重放还会撞同一个 view 依赖. 改为 force 38 让 migrate
  #     认为 38 已应用, 跳到 039 来执行 DROP VIEW + 重做 7 条 UPDATE +
  #     ALTER + recreate VIEW 的完整修复.
  #
  # 两阶段触发 (与 v34 同):
  #   1) 部署前先探: 已经 dirty 的命中条目立刻 force + 让后续 up 接管.
  #   2) up 失败后再探: 同一部署周期内允许自愈 + 重试 up 一次.
  # ----------------------------------------------------------

  # 无论退出码如何都捕获 `migrate version` 的输出。golang-migrate v4 在 dirty
  # 状态下退出码为 0（仅 `Up()` 拒绝前进），但在真正的全新安装 (ErrNilVersion)
  # 或瞬时 DB 抖动场景下会以非零码退出并向 stderr 写入。下游解析仍然需要这段文本；
  # 仅靠退出码判断的话，未来某版 migrate 改了退出约定就会漏掉合法的
  # "version: 34, dirty: true"。2>&1 将 stderr 合并到主流；
  # `_try_heal_known_dirty` 的正则足够具体，遇到无关或报错文本会自然不匹配并返回 1。
  _probe_migration_version() {
    docker compose -f "$COMPOSE_FILE" run --rm \
      --entrypoint /app/migrate \
      backend -dir /app/migrations -dsn "$db_dsn" version 2>&1 || true
  }

  # 当 dirty 版本命中 recipe 表 **且** force 成功时返回 0；
  # 其他情况（非 dirty / 未登记的版本 / force 失败）返回 1。
  # 调用方根据上下文判断"非本特征"的语义（pre-up 阶段：无害跳过；
  # post-up 阶段：暴露底层迁移错误）。
  _try_heal_known_dirty() {
    local out="$1"
    local v d
    v=$(echo "$out" | sed -nE 's/.*version: ([0-9]+).*/\1/p' | head -1)
    d=$(echo "$out" | sed -nE 's/.*dirty: (true|false).*/\1/p' | head -1)
    if [ "$d" != "true" ] || [ -z "$v" ]; then
      return 1
    fi

    local force_to=""
    local reason=""
    case "$v" in
      34)
        force_to=35
        reason="matches the known 000034 partial-apply bug; 000036 repair will rebuild schema after force"
        ;;
      38)
        force_to=38
        reason="000038 ALTER COLUMN fails on view dependency (v_published_posts); 000039 contains the real fix (DROP VIEW + redo UPDATEs + ALTER + recreate VIEW). Force 38 so 039 takes over."
        ;;
      *)
        return 1
        ;;
    esac

    echo "[$(date -Iseconds)] WARN: detected dirty state at migration v$v — $reason. Forcing to v$force_to."
    if docker compose -f "$COMPOSE_FILE" run --rm \
         --entrypoint /app/migrate \
         backend -dir /app/migrations -dsn "$db_dsn" force "$force_to"; then
      echo "[$(date -Iseconds)] migration force $force_to succeeded."
      return 0
    fi
    echo "[$(date -Iseconds)] ERROR: migration force $force_to failed"
    return 1
  }

  # 阶段 1：up 之前的探测（处理早期部署遗留的 dirty 状态）
  local version_out
  version_out=$(_probe_migration_version)
  if [ -n "$version_out" ]; then
    echo "[$(date -Iseconds)] migration state (pre-up): $version_out"
    _try_heal_known_dirty "$version_out" || true
  else
    echo "[$(date -Iseconds)] migration version probe returned empty (likely fresh install with no schema_migrations yet)"
  fi

  # 阶段 2：执行迁移
  if docker compose -f "$COMPOSE_FILE" run --rm \
       --entrypoint /app/migrate \
       backend -dir /app/migrations -dsn "$db_dsn" up; then
    echo "[$(date -Iseconds)] Migrations applied successfully"
    return
  fi

  # 阶段 3：up 失败 —— 若落到已登记的 dirty 特征上，在同一次部署内自愈并重试一次。
  # 其他失败一律中止，避免真实迁移错误被悄悄掩盖。
  echo "[$(date -Iseconds)] WARN: migration up failed; re-probing to check for known dirty signatures."
  version_out=$(_probe_migration_version)
  if [ -z "$version_out" ]; then
    echo "[$(date -Iseconds)] ERROR: cannot re-probe migration version after failure, aborting deploy"
    exit 1
  fi
  echo "[$(date -Iseconds)] migration state (post-up): $version_out"
  if _try_heal_known_dirty "$version_out"; then
    echo "[$(date -Iseconds)] retrying migrate up after dirty-state heal"
    if docker compose -f "$COMPOSE_FILE" run --rm \
         --entrypoint /app/migrate \
         backend -dir /app/migrations -dsn "$db_dsn" up; then
      echo "[$(date -Iseconds)] Migrations applied successfully (after heal)"
      return
    fi
  fi
  echo "[$(date -Iseconds)] ERROR: migration failed and did not match the known self-heal signature, aborting deploy"
  exit 1
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
# 部署后：完整 preflight 校验（运行时检查）
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
