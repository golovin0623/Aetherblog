# AetherBlog CI/CD & Webhook 自动部署手册

> 版本基线：2026-05-06 (PR #605 + #612 + #617 + #618 全部合并后的状态)
> 维护者：每次结构性改动后回填本文件

---

## 1. 整体架构

```
┌─ GitHub Actions Runner ──────────────────────────────────┐
│ push to main                                             │
│   → detect-changes (paths-filter@v3)                     │
│   → build-{backend,ai-service,blog,admin}                │
│      (only when 对应模块路径变更)                        │
│   → trivy-scan / forbidden-defaults-guard / gitleaks     │
│   → deploy job: HMAC-SHA256 sign body → POST /deploy     │
└────────────────────────┬─────────────────────────────────┘
                         │ HTTPS POST
                         ▼
┌─ Production: VM-16-2-centos (CentOS 7, systemd 219) ─────┐
│                                                          │
│ deploy-webhook.service        (systemd)                  │
│   User=webhook                                           │
│   ExecStart=/usr/bin/python3 \                           │
│     /var/lib/aetherblog/webhook/webhook_server.py        │
│   ProtectHome=true, ProtectSystem=full,                  │
│   NoNewPrivileges=true, CapabilityBoundingSet=,          │
│   PrivateTmp=true, RuntimeDirectory=aetherblog           │
│   EnvironmentFile=/etc/aetherblog/webhook.env (0640)     │
│                                                          │
│ aetherblog-webhook-restart.path     (root, 监听 sentinel) │
│ aetherblog-webhook-restart.service  (root, oneshot)      │
│   ExecStart=sleep 2 && rm sentinel && systemctl restart  │
│             deploy-webhook.service                       │
│                                                          │
│ /var/lib/aetherblog/webhook/    ← ExecStart 副本目录     │
│ /var/lib/aetherblog/repo/       ← PROJECT_DIR (git fetch)│
│ /etc/aetherblog/webhook.env     ← HMAC secret            │
│ /var/log/aetherblog/deploy.log  ← deploy.sh stdout       │
│ /run/aetherblog/                ← lock + restart sentinel│
└──────────────────────────────────────────────────────────┘
```

---

## 2. CI 触发条件

CI 定义在 `.github/workflows/ci-cd.yml`。

### 2.1 总入口

```yaml
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
```

PR 阶段只跑 lint / test / config-validate；deploy 仅在 `push to main` 触发。

### 2.2 路径过滤 (detect-changes)

| 过滤标签 | 触发路径 |
|---|---|
| `backend` | `apps/server-go/**`, `docker-compose*.yml`, `.github/workflows/ci-cd.yml` |
| `ai-service` | `apps/ai-service/**`, `docker-compose*.yml`, `.github/workflows/ci-cd.yml` |
| `blog` | `apps/blog/**`, `packages/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `docker-compose*.yml`, `.github/workflows/ci-cd.yml` |
| `admin` | `apps/admin/**`, `packages/**`, ... 同 blog |
| `ops_webhook` | `ops/webhook/**` (PR #618 加的) |

`any_changed = backend || ai-service || blog || admin || ops_webhook` —— 这条决定 deploy job 是否运行。

### 2.3 SERVICES 计算

```bash
SERVICES=""
[backend changed]    && SERVICES+=" backend"
[ai-service changed] && SERVICES+=" ai-service"
[blog changed]       && SERVICES+=" blog"
[admin changed]      && SERVICES+=" admin"

# 仅 ops/webhook 变更 → SERVICES=gateway (轻量, 触发 deploy.sh 跑 trap EXIT)
[ -z "$SERVICES" ] && [ops_webhook changed] && SERVICES="gateway"

# 任何应用变更都要重启 gateway (nginx 路由可能受影响), 但不重复
[ -n "$SERVICES" ] && [["$SERVICES" != *gateway*]] && SERVICES+=" gateway"
```

### 2.4 Deploy 调用

`deploy` job 计算 HMAC-SHA256(body, WEBHOOK_SECRET)，POST 到 `DEPLOY_WEBHOOK_URL`：

```bash
body='{"services": "<SERVICES>"}'
sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex)
curl -X POST --max-time 900 --retry 2 --retry-delay 2 \
  -H "X-Hub-Signature-256: sha256=$sig" \
  --data-raw "$body" \
  "$WEBHOOK_URL"
```

---

## 3. Webhook 服务端处理流程

### 3.1 webhook_server.py 入口

1. 收到 POST /deploy
2. **HMAC 校验** (`X-Hub-Signature-256` 头, 比对 HMAC-SHA256 of body)
3. **body 解析**: `services` 字段 (空白分隔, 仅允许 `backend|ai-service|blog|admin|gateway`); `commit_sha` 字段 (可选, 完整 hex)
4. **`_deploy_lock()`**: 短暂持有 `/run/aetherblog/deploy.lock` (flock) 期间执行 `_sync_repo`, 然后立即释放让 deploy.sh 自己重新 acquire
5. **`_sync_repo()`**: `git fetch + reset --hard FETCH_HEAD` (或调用方传的 commit_sha) 在 `PROJECT_DIR=/var/lib/aetherblog/repo`
6. **spawn deploy.sh** (`/var/lib/aetherblog/webhook/deploy.sh`), `env["SKIP_GIT_SYNC"]=true`, `env["DEPLOY_COMMIT_SHA"]=<resolved sha>`
7. 等待 deploy.sh 退出 (timeout DEPLOY_TIMEOUT=900s)
8. 返回 200 (或 500 + tail of stdout/stderr)

### 3.2 deploy.sh 主流程

```
1. flock /run/aetherblog/deploy.lock
2. cd $PROJECT_DIR (=/var/lib/aetherblog/repo)
3. 加载 .env (严格 KEY=VALUE 解析, 不 source)
4. unset MIN_AI_PROVIDER_COUNT/MIN_AI_MODEL_COUNT (用 preflight 默认阈值)
5. SKIP_GIT_SYNC=true → 跳过 deploy.sh 自带 sync (webhook 已经做过了)
6. validate docker compose config
7. preflight --no-runtime (静态检查)
8. run_pre_deploy_migrations:
   - 探测 schema_migrations 状态
   - 已知 dirty 自愈 (v34→35, v38→38 让 039 接管, v57 仅在确认 `knowledge_bases` 不存在时 force 56 后重放)
   - migrate up
9. case DEPLOY_MODE in:
   - full        → docker compose pull && up -d
   - incremental → docker compose pull <SERVICES> && up -d --no-deps <SERVICES>
   - canary      → 仅指定 services
   - rollback    → VERSION=$ROLLBACK_VERSION + full deploy
10. docker compose ps
11. trap _post_deploy_hooks EXIT  ← 注册退出 hook
12. preflight (post-deploy, 完整运行时检查 + webhook freshness 守门)
13. docker image prune -f
14. echo "Deployment completed"
15. bash 退出 → trap EXIT 触发:
    a. sync_webhook_files_to_runtime —— cp PROJECT_DIR/ops/webhook/{deploy.sh,
       webhook_server.py} 到 WEBHOOK_RUNTIME_DIR (=/var/lib/aetherblog/webhook/)
       (用 mtime 对比, 仅在 src 较新时 cp; realpath 对比避免老 root 模式 self-cp)
    b. restart_webhook_if_stale —— 比对 WEBHOOK_RUNTIME_PY mtime 与 webhook
       进程 ActiveEnterTimestamp, 较新则:
         - 写 /run/aetherblog/restart-webhook (sentinel) ← hardened 模式
         - 或 systemd-run --on-active=2s ... systemctl restart deploy-webhook
           ← legacy root 模式 fallback
```

### 3.3 自重启链 (hardened 模式)

```
deploy.sh trap EXIT
  └─ writes /run/aetherblog/restart-webhook
       │ (kernel inotify)
       ▼
aetherblog-webhook-restart.path (root)
  PathExists=/run/aetherblog/restart-webhook
  Unit=aetherblog-webhook-restart.service
       │ (~ms 内触发)
       ▼
aetherblog-webhook-restart.service (root, oneshot)
  ExecStart=/bin/sh -c '
    sleep 2 &&                    ← 让 webhook 把 200 写回 CI
    rm -f /run/aetherblog/restart-webhook &&
    /usr/bin/systemctl restart deploy-webhook.service
  '
       │
       ▼
deploy-webhook.service 重启 → 加载新 webhook_server.py
```

**关键不变量:**
- webhook user 没有 root 权限 (NoNewPrivileges=true 拦死 sudo) —— sentinel 间接调用是唯一路径
- +2s 延迟保证 trap EXIT 写完 sentinel 后 webhook_server 把 200/500 flush 回 CI 再被 SIGTERM
- trap EXIT 在 set -e 触发的退出也会跑 (preflight FAIL 不阻断恢复)

---

## 4. 文件 / 目录布局

| 路径 | 所有者 | 权限 | 用途 |
|---|---|---|---|
| `/etc/systemd/system/deploy-webhook.service` | root:root | 0644 | webhook 主 unit |
| `/etc/systemd/system/aetherblog-webhook-restart.path` | root:root | 0644 | sentinel 监听 |
| `/etc/systemd/system/aetherblog-webhook-restart.service` | root:root | 0644 | sentinel 触发的 root 重启器 |
| `/etc/aetherblog/webhook.env` | root:webhook | 0640 | `WEBHOOK_SECRET=<32+ hex>` |
| `/var/lib/aetherblog/webhook/webhook_server.py` | webhook:webhook | 0755 | ExecStart 真正加载的 Python |
| `/var/lib/aetherblog/webhook/deploy.sh` | webhook:webhook | 0755 | 部署脚本 (副本) |
| `/var/lib/aetherblog/repo/` | webhook:webhook | 0750 | git work-tree, PROJECT_DIR |
| `/var/log/aetherblog/deploy.log` | webhook:webhook | 0640 (auto) | deploy.sh stdout/stderr (tee) |
| `/run/aetherblog/deploy.lock` | webhook:webhook | 0644 | 部署互斥 flock |
| `/run/aetherblog/restart-webhook` | webhook:webhook | n/a | sentinel 文件 (短暂存在) |

`RuntimeDirectory=aetherblog` 自动创建 `/run/aetherblog`; `LogsDirectory=aetherblog` 在 systemd 235+ 才有, CentOS 7 (219) 上 `/var/log/aetherblog` 由 install 阶段手动 chown。

---

## 5. 关键环境变量

### 5.1 systemd unit 注入 (`/etc/systemd/system/deploy-webhook.service`)

| Var | Value | 说明 |
|---|---|---|
| `WEBHOOK_PORT` | `7868` | 监听端口 |
| `WEBHOOK_BIND` | `0.0.0.0` | 公网暴露; HMAC 兜底; 切 127.0.0.1 必须先落 nginx /deploy 反代 + 改 GitHub secret |
| `WEBHOOK_REQUEST_TIMEOUT` | `15` | socket recvfrom 超时 (防 scanner 半开连接) |
| `WEBHOOK_MAX_BODY_BYTES` | `8192` | 防大 body 拒服务 |
| `DEPLOY_SCRIPT` | `/var/lib/aetherblog/webhook/deploy.sh` | 副本路径 (不是 repo 路径) |
| `DEPLOY_TIMEOUT` | `900` | subprocess.run 超时 (秒) |
| `PROJECT_DIR` | `/var/lib/aetherblog/repo` | git work-tree, 覆盖默认 `/root/Aetherblog` |
| `LOG_FILE` | `/var/log/aetherblog/deploy.log` | deploy.sh tee 目标 |
| `LOCK_FILE` | `/run/aetherblog/deploy.lock` | flock |
| `WEBHOOK_RUNTIME_DIR` | `/var/lib/aetherblog/webhook` | sync_webhook_files_to_runtime 目标 |
| `WEBHOOK_RUNTIME_PY` | `/var/lib/aetherblog/webhook/webhook_server.py` | restart_webhook_if_stale mtime 对照源 |
| `PYTHON_BIN` | `/usr/bin/python3` | 系统自带 (3.6.8); ProtectHome=true 后 pyenv 不可达 |

### 5.2 EnvironmentFile (`/etc/aetherblog/webhook.env`)

| Var | Value |
|---|---|
| `WEBHOOK_SECRET` | 32+ hex (openssl rand -hex 32); 同步到 GitHub Actions repo secret `DEPLOY_WEBHOOK_SECRET` |

### 5.3 GitHub Actions Repo Secrets

| Secret | Value |
|---|---|
| `DEPLOY_WEBHOOK_URL` | `http://<server-public-ip>:7868/deploy` |
| `DEPLOY_WEBHOOK_SECRET` | 与 `/etc/aetherblog/webhook.env` 内 `WEBHOOK_SECRET` 同值 |
| `DOCKER_USERNAME` / `DOCKER_PASSWORD` | Docker Hub 凭据 |

### 5.4 Git remote 与认证

`deploy-webhook.service` 以 `User=webhook` 运行, repo sync 使用的是
`PROJECT_DIR=/var/lib/aetherblog/repo`, 不是 root shell 当前目录。仓库改成
private 后, 任何验证都必须用 `webhook` 用户和真实部署目录执行; root 下
`ssh -T git@github.com` 或 `git fetch` 成功不能证明 CI webhook 能成功。

推荐给仓库配置只读 Deploy Key。若 key 已存在, 不要覆盖, 直接查看现有 `.pub`
并确认它已添加到 GitHub:

```bash
sudo install -d -m 0700 -o webhook -g webhook /var/lib/aetherblog/webhook/.ssh

if [ ! -f /var/lib/aetherblog/webhook/.ssh/id_ed25519 ]; then
  sudo -u webhook -H ssh-keygen -t ed25519 \
    -C "aetherblog-deploy-webhook" \
    -f /var/lib/aetherblog/webhook/.ssh/id_ed25519 \
    -N ""
fi

sudo -u webhook -H cat /var/lib/aetherblog/webhook/.ssh/id_ed25519.pub
```

把输出的公钥整行添加到 GitHub 仓库:

```
Settings -> Deploy keys -> Add deploy key
```

只需要部署拉代码时不要勾选 write access。然后固定 known_hosts 与权限:

```bash
sudo -u webhook -H ssh-keyscan github.com | sudo tee -a /var/lib/aetherblog/webhook/.ssh/known_hosts >/dev/null
sudo chown -R webhook:webhook /var/lib/aetherblog/webhook/.ssh
sudo chmod 0700 /var/lib/aetherblog/webhook/.ssh
sudo chmod 0600 /var/lib/aetherblog/webhook/.ssh/id_ed25519
sudo chmod 0644 /var/lib/aetherblog/webhook/.ssh/id_ed25519.pub
sudo chmod 0644 /var/lib/aetherblog/webhook/.ssh/known_hosts
```

CentOS 7 自带 Git 可能不支持 `git -C <dir>`。统一使用 `cd` 写法验证:

```bash
sudo -u webhook -H sh -lc 'cd /var/lib/aetherblog/repo && git remote -v'
sudo -u webhook -H sh -lc 'cd /var/lib/aetherblog/repo && git remote set-url origin git@github.com:golovin0623/Aetherblog.git'
# 可选: 观察 GitHub SSH 认证输出; GitHub 不提供 shell, 这条可能非 0, 不作为最终判定。
sudo -u webhook -H ssh -T git@github.com || true
sudo -u webhook -H sh -lc 'cd /var/lib/aetherblog/repo && git fetch --quiet --tags origin main'
```

最后一条成功才算 webhook 部署链路具备私有仓库读取权限。

HTTPS + 代理仅作为无法使用 Deploy Key 时的 fallback:

```
[http]
    proxy = http://127.0.0.1:7890
[https]
    proxy = http://127.0.0.1:7890
```

使用 HTTPS fallback 时, `/var/lib/aetherblog/repo/.git/config` 的
`remote.origin.url` 必须是 HTTPS, 并确保 credential/helper 或 token 方案不把
密钥写进仓库。

---

## 6. 一键 bootstrap (新机器 / 灾后重建)

```bash
# 在仓库 checkout 路径执行
sudo ./ops/bootstrap-webhook.sh                            # 全新机
sudo ./ops/bootstrap-webhook.sh --from /root/Aetherblog    # 从老 root 模式迁
sudo ./ops/bootstrap-webhook.sh --secret "<32+ hex>"       # 复用现有 secret
sudo ./ops/bootstrap-webhook.sh --dry-run                  # 仅打印
```

幂等; 重复跑安全。完成后:
1. 把脚本打印的 `WEBHOOK_SECRET` 同步到 GitHub Actions `DEPLOY_WEBHOOK_SECRET`
2. 设置 GitHub Actions `DEPLOY_WEBHOOK_URL` = `http://<server-ip>:7868/deploy`
3. 推一个 trivial commit 触发 CI, `journalctl -u deploy-webhook -f` 观察

---

## 7. 故障排查 (按症状 → 检查顺序)

### 7.1 CI deploy step: `curl: (52) Empty reply from server`

**症状**: TCP 通了, 但 webhook 没回包。

**检查顺序**:
```bash
# 1. webhook 进程是否还活着, 跑的是哪版 webhook_server.py
sudo systemctl status deploy-webhook --no-pager | head -10
ps -L -o pid,user,cmd -p $(systemctl show -p MainPID deploy-webhook | cut -d= -f2-)

# 2. 进程是否卡在 recvfrom (scanner abuse 或代码 bug)
sudo cat /proc/$MAINPID/wchan
sudo cat /proc/$MAINPID/stack | head -10

# 3. 看是否有 Python TypeError / Permission denied
sudo journalctl -u deploy-webhook -n 50 --no-pager | grep -iE 'error|fatal|traceback'

# 4. 本机 401 测试 (绕过 webhook 网络问题)
curl --noproxy '*' -i --max-time 5 -X POST -d '{}' http://127.0.0.1:7868/deploy
```

**已知触发原因**:
- ✅ webhook_server.py 有 Python 3.7+ 语法 (text=True 等), CentOS 7 自带 3.6.8 跑不了 → 改用 universal_newlines (PR #617)
- ✅ webhook 进程跑老代码 (磁盘改了但没重启) → 看 7.4 自愈链
- ✅ scanner 半开连接钉死单线程 recvfrom → ThreadingMixIn + settimeout (PR #612 已修)

### 7.2 CI deploy step: `curl: (56) Connection reset by peer`

**症状**: 连接打通后中途被对端 RST。

**检查顺序**:
```bash
# 1. webhook 是否反复重启
sudo journalctl -u deploy-webhook --since '10 min ago' --no-pager | grep -E 'Started|Stopped'

# 2. 端口是否被云防火墙封 (从外部测)
# 用第三方机器: curl -v --max-time 10 http://<server-ip>:7868/deploy
# 如果连接 timeout 但本机 OK → Tencent Cloud 高危端口策略已封, 换端口

# 3. accept queue 是否爆满
sudo ss -tlnp | grep 7868
# 看 Recv-Q 列, 大于 0 表明有未 accept 的连接堆积
```

### 7.3 webhook 返回 `Repo sync failed`

**症状**: webhook 已通过 HMAC 校验, 但部署前 repo sync 失败。常见错误包括
`Permission denied (publickey)`、`Encountered end of file`、`Could not read from
remote repository`。

**检查顺序**:
```bash
# 1. 确认 systemd 实际运行身份与 PROJECT_DIR
systemctl show deploy-webhook -p User -p Environment

# 2. 验证 webhook user 能直接 git fetch
#    用 sh -lc + cd 兼容 CentOS 7 老 Git, 不要依赖 `git -C`.
sudo -u webhook -H sh -lc 'cd /var/lib/aetherblog/repo && git remote -v'
# 可选: 观察 GitHub SSH 认证输出; GitHub 不提供 shell, 这条可能非 0, 不作为最终判定。
sudo -u webhook -H ssh -T git@github.com || true
sudo -u webhook -H sh -lc 'cd /var/lib/aetherblog/repo && git fetch --quiet --tags origin main'

# 3. 如果是 HTTPS fallback, 看 system gitconfig 有没有配代理
git config --system --get-regexp '^http'

# 4. 看代理本身是否在跑
ss -tlnp | grep 7890   # clash / v2ray 默认 7890

# 5. 如果未配, 配上
git config --system http.proxy "http://127.0.0.1:7890"
git config --system https.proxy "http://127.0.0.1:7890"
```

`Permission denied (publickey)` 的关键判断: root 用户下生成的
`/root/.ssh/id_ed25519` 对 webhook 服务无效。当前 unit 使用
`User=webhook` 且 `ProtectHome=true`, 运行进程读不到 `/root/.ssh`。需要把
deploy key 放在 `/var/lib/aetherblog/webhook/.ssh/` 并授权给 `webhook:webhook`。

### 7.4 webhook 跑老代码 (运行副本不是仓库最新)

**症状**: 改了 `ops/webhook/webhook_server.py` 推到 main 后 webhook 行为没变化。

**检查顺序**:
```bash
# 1. webhook 进程启动时间 vs 副本文件 mtime
systemctl show deploy-webhook -p ActiveEnterTimestamp | cut -d= -f2-
stat -c %y /var/lib/aetherblog/webhook/webhook_server.py

# 2. 副本 vs repo 是否一致
diff /var/lib/aetherblog/webhook/webhook_server.py \
     /var/lib/aetherblog/repo/ops/webhook/webhook_server.py

# 3. preflight 看 webhook freshness 报告
sudo tail -n 50 /var/log/aetherblog/deploy.log | grep webhook

# 4. 自愈链 path-unit 是否在跑
systemctl is-active aetherblog-webhook-restart.path
sudo journalctl -u aetherblog-webhook-restart.service -n 10 --no-pager

# 5. 手工触发: 写 sentinel
sudo touch /run/aetherblog/restart-webhook
# 应在 ~3s 内看到 webhook 重启
sudo journalctl -u deploy-webhook -n 5 --no-pager
```

### 7.5 webhook 进程卡死 / accept 队列堆积

**症状**: `ss -tlnp` 看 `Recv-Q > 0`, 本机 curl 也无响应。

**急救**:
```bash
sudo systemctl restart deploy-webhook
```

**事后定位** (重启前先抓):
```bash
MAINPID=$(systemctl show -p MainPID deploy-webhook | cut -d= -f2-)
sudo cat /proc/$MAINPID/stack
sudo timeout 5 strace -f -p $MAINPID 2>&1 | tail -30
ls /proc/$MAINPID/task | wc -l
sudo lsof /var/lock/aetherblog-deploy.lock /run/aetherblog/deploy.lock
```

**已知触发**: scanner 在 recvfrom 上卡死单线程 (PR #612 之前的代码), 现在 ThreadingMixIn 兜住; 仍可能有未知阻塞点 (TLS 握手 / DNS 等), 抓 stack 看具体函数。

### 7.6 preflight FAIL `webhook process is older than webhook_server.py`

**预期行为**: 一次性的, 自动恢复。看到这个 FAIL 不必慌:

1. preflight 检测到副本比进程新 (新代码刚 sync 进来)
2. set -e 退出 deploy.sh, CI 拿 500
3. **但** trap EXIT 已经跑了 sync + sentinel
4. ~3s 内 path-unit 重启 webhook
5. CI curl `--retry 2` 自动 retry → 命中新进程 → preflight PASS → 200

如果观察到反复 FAIL (>2 个连续 deploy 都中):
```bash
# 检查 sentinel 是否真的写出 / path-unit 是否激活
ls -la /run/aetherblog/
systemctl is-active aetherblog-webhook-restart.path
sudo journalctl -u aetherblog-webhook-restart.service -n 20 --no-pager
```

### 7.7 部署后某容器 unhealthy

```bash
# 1. preflight 哪条 FAIL 的
sudo grep FAIL /var/log/aetherblog/deploy.log | tail -10

# 2. 容器自身日志
docker compose -f /var/lib/aetherblog/repo/docker-compose.prod.yml logs --tail 100 <service>

# 3. health 详情
docker inspect --format '{{json .State.Health}}' aetherblog-<service> | jq .
```

---

## 8. Secret 轮换

```bash
NEW_SECRET="$(openssl rand -hex 32)"

# 1. 服务器
sudo cp /etc/aetherblog/webhook.env \
       /etc/aetherblog/webhook.env.bak.$(date +%Y%m%d%H%M%S)
sudo bash -c "cat > /etc/aetherblog/webhook.env <<EOF
WEBHOOK_SECRET=${NEW_SECRET}
EOF
chmod 0640 /etc/aetherblog/webhook.env
chown root:webhook /etc/aetherblog/webhook.env"
sudo systemctl restart deploy-webhook

# 2. GitHub
gh secret set DEPLOY_WEBHOOK_SECRET \
  --repo golovin0623/Aetherblog \
  --body "$NEW_SECRET"

# 3. 验证 (两台用旧 secret 应回 401, 用新的应回 200)
curl -i --max-time 5 -X POST http://127.0.0.1:7868/deploy   # 401 (无 sig)

# 4. 清理变量
unset NEW_SECRET
```

---

## 9. 已知坑 / 设计选择 (FAQ)

### Q: 为什么 webhook 要 cp 副本到 `/var/lib/aetherblog/webhook/`, 不直接读 repo?

A: ProtectHome=true + ProtectSystem=full + ReadWritePaths 收敛, repo 是 git work-tree 会被频繁 reset; ExecStart 副本是稳定的 immutable 入口, deploy.sh 改动不会半路被覆盖。

### Q: 为什么用 sentinel + path-unit, 不直接 sudo systemctl?

A: NoNewPrivileges=true 让 webhook 无法用 setuid 二进制 (sudo 是 setuid), polkit 在 CentOS 7 上没 JS 引擎所以无法做按 unit 的细粒度授权。sentinel + root path-unit 是最小特权设计。

### Q: 为什么 systemd-run +2s 延迟, 不是立即重启?

A: 让 deploy.sh 的 bash 真正退出 + webhook_server.py 的 subprocess.run 返回 + 200 response flush 到 CI 三件事先发生, 否则 systemctl restart 通过 KillMode=control-group 把 deploy.sh 一起 SIGTERM, CI 看到 500。

### Q: 为什么不一次性把所有现代 sandbox 指令都开?

A: 生产是 CentOS 7 / systemd 219, 不识别 systemd 232+ 的指令 (LogsDirectory, ProtectSystem=strict, ReadWritePaths, ProtectKernelTunables, MemoryDenyWriteExecute, ${VAR} in ExecStart 等), 写上去整个 unit 加载失败, ExecStart 都装不上 = 等价于完全没改。OS 升级到 systemd 232+ 后再加回。

### Q: 为什么 WEBHOOK_BIND 还是 0.0.0.0?

A: 仓库 nginx 配置没有 `/deploy` → 127.0.0.1:7868 反代; CI workflow 的 `DEPLOY_WEBHOOK_URL` 是直连公网 7868。切 127.0.0.1 必须在同一 PR 里同时落 nginx 反代 + 改 GitHub secret + 验证一次, 否则会断 CI 自己。短期靠 HMAC + ThreadingMixIn + settimeout 兜底。

### Q: 私有仓库应该用 SSH 还是 HTTPS?

A: 推荐 SSH Deploy Key。当前 `webhook` 用户的 home 是
`/var/lib/aetherblog/webhook`, 可以在
`/var/lib/aetherblog/webhook/.ssh/id_ed25519` 放只读 deploy key。HTTPS + 代理
仍可作为 fallback, 但要避免把 token 或密码写进仓库配置。

### Q: 为什么主仓库还在 `/root/Aetherblog`?

A: 你想保留 cd 习惯。建议加 symlink: `ln -sfn /var/lib/aetherblog/repo /root/Aetherblog` (在 mv 旧目录到 backup 之后), webhook 用真实路径不受影响。

---

## 10. 历史事故索引

| 日期 | 事件 | 根因 | 修复 PR |
|---|---|---|---|
| 2026-05-05 | webhook 跑 5 月 3 日老代码 8 小时, scanner 卡死 | 进程没及时重启捡新 webhook_server.py | PR #612 (auto-restart) |
| 2026-05-05 | PR #602 deploy.sh ref hardening 后部署成功 | (无事故, 正常加固) | PR #602 |
| 2026-05-05 | PR #605 切 User=webhook 后 systemctl show --value 不识别, 误触发每次重启 | systemd 230+ 才有 --value | PR #605 commit 20c5717 |
| 2026-05-05 | PR #605 自愈 timer 在 preflight 期间 SIGTERM deploy.sh | timer +2s 太短 + 顺序错 | PR #605 commit 906cf85 (trap EXIT) |
| 2026-05-05 | PR #605 unit 用了 232+ 指令, CentOS 7 拒载 | systemd 219 vs 232+ | PR #605 commit c680d6e |
| 2026-05-05 | PR #605 后 self-restart 无权限 (User=webhook) | sudo 被 NoNewPrivileges 拦死 | PR #605 commit 4591eca (sentinel + path-unit) |
| 2026-05-05 | PR #617 (text=True 修复) 没进 PR #605 merge | 推 commit 时 PR 已合 | PR #617 (cherry-pick) |
| 2026-05-06 | webhook user git fetch 失败 (SSH key 没了) | ProtectHome=true 拦 /root/.ssh; 没配代理 | 改 HTTPS remote + git system http.proxy |
| 2026-05-18 | 仓库改 private 后 CI deploy 最后一步 500: `Permission denied (publickey)` | 只给 root 配了 SSH key; `deploy-webhook.service` 实际用 `webhook` 用户, 且 CentOS 7 Git 不支持 `git -C` 排障命令 | 给 `/var/lib/aetherblog/webhook/.ssh/` 配只读 Deploy Key; 用 `sudo -u webhook -H sh -lc 'cd /var/lib/aetherblog/repo && git fetch --quiet --tags origin main'` 验证 |
| 2026-05-06 | ops/webhook/** 改动不触发 CI deploy | path filter 没覆盖 | PR #618 |

---

## 11. 维护检查清单

每次 webhook 路径相关的改动后:

- [ ] PR 描述说明会不会改变 7.x 的某个故障路径
- [ ] 跑 `bash -n ops/webhook/deploy.sh` + `python3 -m unittest ops/webhook/test_webhook_server.py`
- [ ] 合并到 main 后, 看一眼下一次 CI deploy job 是否成功 (期望 200, 第一次可能 500 + retry 200)
- [ ] 如果引入新加固指令, 确认 systemd 219 是否支持 (查文档: introduced in version)
- [ ] 如果改 webhook_server.py, 确认没用 Python 3.7+ 语法 (顶部 docstring 有禁用列表)
- [ ] 部署完成后 `journalctl -u deploy-webhook -n 20 --no-pager` 应该看到 `Webhook server running on 0.0.0.0:7868` 没有 traceback

---

*末次更新: 2026-05-06 / Generated post PR #618 merge*
