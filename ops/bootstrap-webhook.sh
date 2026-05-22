#!/usr/bin/env bash
# AetherBlog 部署 webhook 启动安装程序。
#
# 把今天我们手工跑的 7 步迁移流程封装成一行命令。覆盖：
#   - 创建无特权 `webhook` 系统用户 (加入 `docker` 组拿 docker.sock 权限)
#   - 建立 /var/lib/aetherblog/{webhook,repo}, /etc/aetherblog, /var/log/aetherblog
#   - 生成 32 字节 HMAC secret 写到 /etc/aetherblog/webhook.env (0640 root:webhook)
#   - 把仓库 rsync 到 PROJECT_DIR (默认 /var/lib/aetherblog/repo)，可从老 root
#     模式 (/root/Aetherblog) 迁移
#   - 把 webhook_server.py / deploy.sh 拷到 ExecStart 副本目录
#   - 安装 systemd unit (CentOS 7 systemd 219 兼容版)，daemon-reload + 起服务
#   - 401 烟雾测试
#
# 使用 (在仓库根目录执行)：
#   sudo ./ops/bootstrap-webhook.sh                            # 全新机器
#   sudo ./ops/bootstrap-webhook.sh --from /root/Aetherblog    # 从老 root 模式迁移
#   sudo ./ops/bootstrap-webhook.sh --secret "<32+hex>"        # 复用现有 secret
#   sudo ./ops/bootstrap-webhook.sh --dry-run                  # 只打印不执行
#
# 完成后还需要做：
#   - 把生成的 WEBHOOK_SECRET (脚本会打印路径) 同步到 GitHub Actions
#     repo secret `DEPLOY_WEBHOOK_SECRET`
#   - GitHub Actions secret `DEPLOY_WEBHOOK_URL` 设为
#     `http://<server-public-ip>:7868/deploy`
#   - 推一个 trivial commit 触发 CI, 观察 `journalctl -u deploy-webhook -f`
#
# 幂等性：脚本会检测已存在的用户 / 目录 / secret 文件并跳过对应步骤，
# 重复执行安全。
#
# 兼容性：targets CentOS 7 / RHEL 7 baseline (systemd 219). 在更新的发行版
# 上同样可跑，但加固面比 unit 文件实际能开的窄一截 —— 详见 unit 文件顶部
# `=== systemd 219 兼容性 ===` 注释。

set -euo pipefail

# -----------------------------------------------------------------------------
# 默认值与参数解析
# -----------------------------------------------------------------------------

PROJECT_DIR_DEFAULT=/var/lib/aetherblog/repo
RUNTIME_DIR_DEFAULT=/var/lib/aetherblog/webhook
WEBHOOK_USER=webhook
WEBHOOK_GROUP=webhook
SECRET_FILE=/etc/aetherblog/webhook.env
UNIT_FILE=/etc/systemd/system/deploy-webhook.service
LOG_DIR=/var/log/aetherblog

DRY_RUN=false
SECRET=""
MIGRATE_FROM=""
PROJECT_DIR="$PROJECT_DIR_DEFAULT"
RUNTIME_DIR="$RUNTIME_DIR_DEFAULT"

usage() {
  sed -n '/^# AetherBlog deploy-webhook bootstrap/,/^# 兼容性：/p' "$0" \
    | sed 's/^# //; s/^#$//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --runtime-dir) RUNTIME_DIR="$2"; shift 2 ;;
    --secret)      SECRET="$2"; shift 2 ;;
    --from)        MIGRATE_FROM="$2"; shift 2 ;;
    --dry-run)     DRY_RUN=true; shift ;;
    -h|--help)     usage; exit 0 ;;
    *) echo "ERROR: unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must run as root (try: sudo $0 $*)" >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# 通过此脚本的位置定位仓库根目录
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Sanity: 真的在 AetherBlog 仓库里执行?
if [[ ! -f "$REPO_ROOT/docker-compose.prod.yml" ]]; then
  echo "ERROR: $REPO_ROOT doesn't look like AetherBlog repo (no docker-compose.prod.yml)" >&2
  exit 1
fi
if [[ ! -f "$REPO_ROOT/ops/webhook/deploy-webhook.service" ]] \
   || [[ ! -f "$REPO_ROOT/ops/webhook/webhook_server.py" ]] \
   || [[ ! -f "$REPO_ROOT/ops/webhook/deploy.sh" ]]; then
  echo "ERROR: missing ops/webhook/{deploy-webhook.service,webhook_server.py,deploy.sh} in repo" >&2
  exit 1
fi

run() {
  if $DRY_RUN; then
    printf '[DRY-RUN] '
    printf '%q ' "$@"
    printf '\n'
  else
    "$@"
  fi
}

echo "=================================================================="
echo "AetherBlog deploy-webhook bootstrap"
echo "  REPO_ROOT     = $REPO_ROOT"
echo "  PROJECT_DIR   = $PROJECT_DIR"
echo "  RUNTIME_DIR   = $RUNTIME_DIR"
echo "  MIGRATE_FROM  = ${MIGRATE_FROM:-(fresh install from \$REPO_ROOT)}"
echo "  DRY_RUN       = $DRY_RUN"
echo "=================================================================="

# -----------------------------------------------------------------------------
# Step 1: webhook 系统用户/组 + docker 组成员
# -----------------------------------------------------------------------------
echo
echo ">>> Step 1/8: ensure webhook system user / group / docker membership"
if ! getent group "$WEBHOOK_GROUP" >/dev/null; then
  run groupadd --system "$WEBHOOK_GROUP"
else
  echo "    group $WEBHOOK_GROUP already exists, skip"
fi

if ! id "$WEBHOOK_USER" >/dev/null 2>&1; then
  run useradd --system --gid "$WEBHOOK_GROUP" \
    --home-dir "$RUNTIME_DIR" --no-create-home \
    --shell /usr/sbin/nologin "$WEBHOOK_USER"
else
  echo "    user $WEBHOOK_USER already exists, skip"
fi

if ! getent group docker >/dev/null; then
  echo "    WARN: 'docker' group not found —— Docker 还没装? 跳过 docker-group 步骤"
elif id -nG "$WEBHOOK_USER" | tr ' ' '\n' | grep -qx docker; then
  echo "    $WEBHOOK_USER already in docker group, skip"
else
  run usermod -aG docker "$WEBHOOK_USER"
fi

# -----------------------------------------------------------------------------
# Step 2: 目录骨架
# -----------------------------------------------------------------------------
echo
echo ">>> Step 2/8: create directory layout"
run install -d -m 0755 -o root           -g root           /var/lib/aetherblog
run install -d -m 0750 -o "$WEBHOOK_USER" -g "$WEBHOOK_GROUP" "$RUNTIME_DIR"
run install -d -m 0750 -o "$WEBHOOK_USER" -g "$WEBHOOK_GROUP" "$PROJECT_DIR"
run install -d -m 0750 -o root           -g "$WEBHOOK_GROUP" /etc/aetherblog
# LogsDirectory= 是 systemd 235+ 才有, CentOS 7 systemd 219 不支持, 这里手动建.
run install -d -m 0750 -o "$WEBHOOK_USER" -g "$WEBHOOK_GROUP" "$LOG_DIR"

# -----------------------------------------------------------------------------
# Step 3: 把仓库内容投递到 PROJECT_DIR
# -----------------------------------------------------------------------------
echo
echo ">>> Step 3/8: populate PROJECT_DIR ($PROJECT_DIR)"
if [[ -d "$PROJECT_DIR/.git" ]]; then
  echo "    PROJECT_DIR 已经是 git repo, 不再覆盖 (避免冲掉 .env / 本地修改)"
else
  RSYNC_SRC="${MIGRATE_FROM:-$REPO_ROOT}"
  if [[ ! -d "$RSYNC_SRC/.git" ]]; then
    echo "ERROR: $RSYNC_SRC 不是 git repo, 无法 rsync 过去" >&2
    exit 1
  fi
  echo "    rsync $RSYNC_SRC/ → $PROJECT_DIR/ (保留 .env, .git, 排除 node_modules / .next 等)"
  run rsync -aH --delete \
    --exclude='node_modules/' --exclude='.next/' --exclude='__pycache__/' \
    --exclude='.pids/' --exclude='.locks/' --exclude='logs/' \
    "$RSYNC_SRC/" "$PROJECT_DIR/"
  run chown -R "$WEBHOOK_USER:$WEBHOOK_GROUP" "$PROJECT_DIR"
fi

# -----------------------------------------------------------------------------
# Step 4: 拷 webhook 入口文件到 ExecStart 路径
# -----------------------------------------------------------------------------
echo
echo ">>> Step 4/8: install webhook entrypoint files to $RUNTIME_DIR"
run install -m 0755 -o "$WEBHOOK_USER" -g "$WEBHOOK_GROUP" \
  "$REPO_ROOT/ops/webhook/webhook_server.py" \
  "$REPO_ROOT/ops/webhook/deploy.sh" \
  "$RUNTIME_DIR/"

# -----------------------------------------------------------------------------
# Step 5: WEBHOOK_SECRET (生成或复用)
# -----------------------------------------------------------------------------
echo
echo ">>> Step 5/8: ensure $SECRET_FILE has WEBHOOK_SECRET"
if [[ -f "$SECRET_FILE" ]] && grep -q '^WEBHOOK_SECRET=.\{32,\}$' "$SECRET_FILE" 2>/dev/null; then
  echo "    $SECRET_FILE 已存在且 secret 长度 >= 32, 不覆盖"
  SECRET_GENERATED=false
else
  if [[ -z "$SECRET" ]]; then
    if ! command -v openssl >/dev/null 2>&1; then
      echo "ERROR: 既没有提供 --secret 也没装 openssl, 无法生成" >&2
      exit 1
    fi
    SECRET=$(openssl rand -hex 32)
  fi
  if (( ${#SECRET} < 32 )); then
    echo "ERROR: --secret 长度不足 32 字符 (got ${#SECRET})" >&2
    exit 1
  fi
  if $DRY_RUN; then
    echo "[DRY-RUN] write $SECRET_FILE with WEBHOOK_SECRET=*** (${#SECRET} chars)"
  else
    install -d -m 0750 -o root -g "$WEBHOOK_GROUP" "$(dirname "$SECRET_FILE")"
    umask 077
    cat > "$SECRET_FILE" <<EOF
WEBHOOK_SECRET=${SECRET}
EOF
    chmod 0640 "$SECRET_FILE"
    chown root:"$WEBHOOK_GROUP" "$SECRET_FILE"
  fi
  SECRET_GENERATED=true
fi

# -----------------------------------------------------------------------------
# Step 6: 安装 systemd unit (清掉历史 systemctl edit override)
# -----------------------------------------------------------------------------
echo
echo ">>> Step 6/8: install systemd unit + clear legacy overrides"
if [[ -d /etc/systemd/system/deploy-webhook.service.d ]]; then
  BACKUP="/root/deploy-webhook.service.d.bak.$(date +%Y%m%d%H%M%S)"
  echo "    发现历史 systemctl edit override, 备份到 $BACKUP 然后删除"
  run cp -a /etc/systemd/system/deploy-webhook.service.d "$BACKUP"
  run rm -rf /etc/systemd/system/deploy-webhook.service.d
fi

if $DRY_RUN; then
  echo "[DRY-RUN] cp $REPO_ROOT/ops/webhook/deploy-webhook.service $UNIT_FILE"
  echo "[DRY-RUN] cp $REPO_ROOT/ops/webhook/aetherblog-webhook-restart.{path,service} /etc/systemd/system/"
else
  cp "$REPO_ROOT/ops/webhook/deploy-webhook.service" "$UNIT_FILE"
  chmod 0644 "$UNIT_FILE"

  # 装 self-restart pair: path-unit 监听 sentinel + service-unit 真正 restart.
  # 解决 PR #605 切到 User=webhook 后 deploy.sh 无权 systemctl restart 的问题.
  cp "$REPO_ROOT/ops/webhook/aetherblog-webhook-restart.path" \
     /etc/systemd/system/aetherblog-webhook-restart.path
  cp "$REPO_ROOT/ops/webhook/aetherblog-webhook-restart.service" \
     /etc/systemd/system/aetherblog-webhook-restart.service
  chmod 0644 /etc/systemd/system/aetherblog-webhook-restart.path \
             /etc/systemd/system/aetherblog-webhook-restart.service
fi

run systemctl daemon-reload
# 启 path-unit (它装在 multi-user.target, 但显式 enable + start 让首次安装即时生效)
run systemctl enable aetherblog-webhook-restart.path
run systemctl start aetherblog-webhook-restart.path

# -----------------------------------------------------------------------------
# Step 7: 启服务 + 验证
# -----------------------------------------------------------------------------
echo
echo ">>> Step 7/8: enable + (re)start deploy-webhook"
run systemctl enable deploy-webhook
run systemctl restart deploy-webhook
run sleep 3
if ! $DRY_RUN; then
  systemctl status deploy-webhook --no-pager | head -10 || true
fi

echo
echo ">>> Step 8/8: smoke-test 401"
if ! $DRY_RUN; then
  CODE=$(curl --noproxy '*' -sS --max-time 5 -o /dev/null -w '%{http_code}' \
    -X POST -d '{}' "http://127.0.0.1:7868/deploy" || true)
  if [[ "$CODE" == "401" ]]; then
    echo "    OK: webhook 返回 401 Invalid signature, HMAC 鉴权生效"
  else
    echo "    WARN: 期望 401, 拿到 '$CODE'。看 journalctl -u deploy-webhook -n 50" >&2
  fi
fi

# -----------------------------------------------------------------------------
# 收尾提示
# -----------------------------------------------------------------------------
echo
echo "=================================================================="
echo "Bootstrap complete."
echo
if [[ "${SECRET_GENERATED:-false}" == "true" && "$DRY_RUN" == "false" ]]; then
  echo "WEBHOOK_SECRET 已生成。同步给 GitHub Actions:"
  echo "  - repo secret 名: DEPLOY_WEBHOOK_SECRET"
  echo "  - 取值: $(awk -F= '/^WEBHOOK_SECRET=/ {print $2}' "$SECRET_FILE" 2>/dev/null || echo '<read failed>')"
  echo
fi
echo "其他还要在 GitHub Actions 配的 repo secret:"
echo "  - DEPLOY_WEBHOOK_URL = http://<server-public-ip>:7868/deploy"
echo
echo "完成后, 推一个 trivial commit 到 main 触发 CI, 观察日志:"
echo "  journalctl -u deploy-webhook -f"
echo "=================================================================="
