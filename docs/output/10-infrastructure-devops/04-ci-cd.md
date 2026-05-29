# 04 - CI/CD - GitHub Actions / Webhook 部署 / Preflight

> 范围:`.github/workflows/{ci-cd,quick-build}.yml` 的 job 拓扑、变更检测、镜像构建链路、HMAC 验签 webhook、deploy.sh 五段式部署、preflight 验证。

---

## 1. workflow 文件

| 文件 | 行数 | 触发 | 用途 |
| --- | --- | --- | --- |
| `.github/workflows/ci-cd.yml` | 706 | push to main / develop / PR to main | 主 CI/CD 流程 |
| `.github/workflows/quick-build.yml` | 110 | workflow_dispatch(手动) | 紧急构建,跳过测试 |
| `.github/workflows/README.md` | 138 | — | 入门文档(部分内容已过时) |
| `.github/CICD_GUIDE.md` | 209 | — | 完整指南(部分过时) |
| `.github/CICD_README.md` | 156 | — | 快速上手 |
| `.github/setup-secrets.sh` | 96 | — | gh CLI 设置 secret 的助手 |

---

## 2. ci-cd.yml job 拓扑

```
push/PR 触发
    │
    ├─ detect-changes (5 min)            ← dorny/paths-filter@v3
    │   outputs: backend / ai-service / blog / admin / ops_webhook / frontend / any_changed
    │
    ├─ gitleaks (5 min)                  ← VULN-160 secret 扫描,continue-on-error
    │
    ├─ forbidden-defaults-guard (3 min)  ← VULN-117/143
    │   └─ block VERSION=latest
    │   └─ block "change-me-to-..." / "sk-proj-mock..." / "default-secret-for-dev..."
    │
    ├─ config-validate (5 min)
    │   ├─ Validate Go migration versions(版本号唯一性)
    │   └─ docker compose config --quiet  (compose.yml + compose.prod.yml)
    │
    ├─ frontend-quality (10 min)         ← if frontend == true
    │   ├─ pnpm install --ignore-scripts (VULN-138)
    │   ├─ pnpm audit --audit-level=high (VULN-157)
    │   ├─ pnpm lint
    │   └─ pnpm typecheck (admin + blog)
    │
    ├─ backend-test (15 min)             ← if backend == true
    │   ├─ go build ./...
    │   ├─ go test ./... -v -count=1
    │   └─ govulncheck (VULN-158, non-blocking)
    │
    ├─ ai-test (10 min)                  ← if ai-service == true
    │   ├─ pip install -r requirements.txt
    │   ├─ python -m py_compile (full tree)
    │   ├─ ruff check .
    │   └─ from app.main import app(冷启动验证)
    │
    └─ build-{backend,ai-service,blog,admin} (30 min each)
            ↑ if main + push + 对应模块 changed
            │ 显式 cache-from gha + registry buildcache
            │ 同模块 push 之间 concurrency串行
            │ platforms: linux/amd64
            ▼
       trivy-scan (15 min,if main + push)
            └─ image-ref: ${REGISTRY}/aetherblog-backend:${sha}
            └─ severity HIGH/CRITICAL,exit-code 0(观测,不阻断)
       deploy (10 min)
            ↑ needs: detect-changes + config-validate + 4 build job
            │ if any_changed && !contains(needs.*.result, 'failure')
            │ concurrency group: deploy-${ref},不 cancel-in-progress
            │
            └─ POST /deploy with HMAC-SHA256 → 服务器 webhook_server.py
```

### 2.1 并发策略

`ci-cd.yml:23-30`:

```yaml
concurrency:
  group: >-
    ${{ github.event_name == 'pull_request'
        && format('{0}-pr-{1}', github.workflow, github.ref)
        || format('{0}-push-{1}', github.workflow, github.run_id) }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

设计:
- PR:同一 ref 上旧 run 被取消(节省 runner)
- main push:每次给独立 group,所有"检查类" job 完全并行(避免连续合并时排队)
- deploy job 单独串行(按 commit 顺序,不能 cancel)

### 2.2 变更检测路径

`ci-cd.yml:64-90`:

```yaml
backend:    apps/server-go/** + docker-compose*.yml + ci-cd.yml
ai-service: apps/ai-service/** + docker-compose*.yml + ci-cd.yml
blog:       apps/blog/** + packages/** + package.json + pnpm-lock.yaml + pnpm-workspace.yaml + docker-compose*.yml + ci-cd.yml
admin:      apps/admin/** + packages/** + ...(同 blog)
ops_webhook: ops/webhook/**
```

聚合:
- `frontend = blog || admin`
- `any_changed = backend || ai-service || blog || admin || ops_webhook`

### 2.3 deploy 服务清单计算

`ci-cd.yml:629-655`:

```bash
SERVICES=""
[backend changed]  && SERVICES+=" backend"
[ai-service changed] && SERVICES+=" ai-service"
[blog changed]     && SERVICES+=" blog"
[admin changed]    && SERVICES+=" admin"

# 仅 ops/webhook 变更 → gateway-only(让 deploy.sh trap EXIT 完成 sync)
if [ -z "$SERVICES" ] && [[ ops_webhook == true ]]; then
    SERVICES="gateway"
fi

# 任何应用变更都重启 gateway(nginx 路由可能受影响)
if [ -n "$SERVICES" ] && [[ "$SERVICES" != *gateway* ]]; then
    SERVICES="$SERVICES gateway"
fi
```

### 2.4 webhook 调用

`ci-cd.yml:665-705`:

```bash
body=$(printf '{"services": "%s"}' "$SERVICES")
sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | awk '{print $NF}')

http_code=$(curl -sS -X POST \
    --noproxy "*" \
    --max-time 900 \
    --connect-timeout 10 \
    --retry 2 \
    --retry-delay 2 \
    --retry-connrefused \
    -H "Content-Type: application/json" \
    -H "X-Hub-Signature-256: sha256=$sig" \
    --data-raw "$body" \
    -w "%{http_code}" \
    "$WEBHOOK_URL")
```

要点:
- `awk '{print $NF}'` 兼容两种 openssl 输出格式(`(stdin)= <hex>` vs 纯 `<hex>`)
- `--noproxy "*"` 防止 Actions runner 代理变量误绕开 webhook
- `--max-time 900` 与 webhook_server 的 `DEPLOY_TIMEOUT=900` 对齐
- `--retry-connrefused` 处理服务器重启窗口(deploy-webhook 自重启时 ~2s 不响应)

---

## 3. quick-build.yml(紧急构建)

`.github/workflows/quick-build.yml`:

```
触发: workflow_dispatch
输入:
  service: backend / ai-service / blog / admin / all
  version: tag(默认 latest)

build-all (matrix): 4 个 service 并行构建,push 到
  ${REGISTRY}/aetherblog-${service}:${version}
  ${REGISTRY}/aetherblog-${service}:latest

build-single: 单个 service 构建
```

跳过所有测试(lint / typecheck / go test / py_compile)。**用于热修复或临时回滚镜像**。

注意 `quick-build.yml:64,98` 仍然 push `:latest` tag,与 forbidden-defaults-guard 不冲突(那个 guard 只查 `.env.example` 和 `docker-compose*.yml` 里写死的 `VERSION=latest`,不查动态构建生成的 tag)。

---

## 4. webhook 部署器架构

### 4.1 三件套 systemd unit

`ops/webhook/`:

```
deploy-webhook.service                  ← 主服务,跑 webhook_server.py :7868
aetherblog-webhook-restart.path         ← 监听 /run/aetherblog/restart-webhook
aetherblog-webhook-restart.service      ← path 触发的 oneshot,sleep 2 + systemctl restart
```

### 4.2 deploy-webhook.service 加固清单

`ops/webhook/deploy-webhook.service`(systemd 219 / CentOS 7 兼容):

| 配置 | 行号 | 作用 |
| --- | --- | --- |
| `User=webhook` / `Group=webhook` | 43-44 | 无 shell,加入 docker 组 |
| `EnvironmentFile=/etc/aetherblog/webhook.env` | 49 | secret 与 unit 分离,0640 root:webhook |
| `Environment=WEBHOOK_BIND=0.0.0.0` | 54 | HMAC 兜底下公网暴露(因 nginx 暂无 /deploy 反代) |
| `Environment=WEBHOOK_REQUEST_TIMEOUT=15` | 55 | 防半开请求挂死 |
| `Environment=WEBHOOK_MAX_BODY_BYTES=8192` | 56 | 防 OOM |
| `Environment=PROJECT_DIR=/var/lib/aetherblog/repo` | 62 | 与 ProtectHome=true 兼容 |
| `Environment=WEBHOOK_RUNTIME_DIR=/var/lib/aetherblog/webhook` | 78 | deploy.sh 副本目录 |
| `Environment=PYTHON_BIN=/usr/bin/python3` | 86 | ProtectHome=true 后 /root/.pyenv 不可访问 |
| `RuntimeDirectory=aetherblog` | 90 | 自动创建 /run/aetherblog/ |
| `NoNewPrivileges=true` | 92 | |
| `PrivateTmp=true` | 93 | |
| `ProtectSystem=full` | 97 | systemd 219 最强档,strict 是 232+ |
| `ProtectHome=true` | 98 | /root/* 不可读 |
| `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6` | 99 | |
| `CapabilityBoundingSet=` | 102 | 放弃所有 cap |
| `Restart=always` `RestartSec=3` | 103-104 | |

`deploy-webhook.service:23-38` 列出了 systemd 232+ 才有但**因 CentOS 7 systemd 219 不支持而被剔除**的指令:`LogsDirectory` / `ReadWritePaths` / `ProtectSystem=strict` / `ProtectKernelTunables` / `ProtectKernelModules` / `ProtectControlGroups` / `LockPersonality` / `MemoryDenyWriteExecute` / `AmbientCapabilities` / `${VAR}` ExecStart 展开 / `SystemCallFilter=@system-service`。等服务器 OS 升级到 systemd 232+ 再加回。

### 4.3 webhook_server.py 关键设计

`ops/webhook/webhook_server.py`(469 行):

#### 鉴权(VULN-132 / -140)

`webhook_server.py:257-265`:

```python
def _verify_signature(body: bytes, signature_header: Optional[str]) -> bool:
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    sent_sig = signature_header.split("=", 1)[1].strip()
    expected = hmac.new(WEBHOOK_SECRET, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sent_sig)
```

`hmac.compare_digest` 防 timing attack。

#### 服务名白名单

`webhook_server.py:90`:

```python
ALLOWED_SERVICES = {"backend", "ai-service", "blog", "admin", "gateway"}
```

VULN-140:**拒绝静默回退到全量部署**。任何不在白名单的服务名 → 400 Invalid services field。

#### Repo sync(PR #525)

`webhook_server.py:97-201` `_sync_repo()`:

1. **支持显式 commit_sha pin**(#601):请求体可带 `"commit_sha": "<40-64 hex>"`,服务端 `git cat-file -e + merge-base --is-ancestor` 双校验 reachable from `DEPLOY_GIT_REF`,才会 reset。
2. **fetch 重试**:GFW 瞬断指数退避 2s/4s/8s,默认 2 次重试 = 最多 3 次 fetch。
3. **--no-tags + 显式 refspec**(`webhook_server.py:171-180`):`+refs/heads/${fetch_ref}:refs/remotes/origin/${fetch_ref}`,防止 tag-shadow 攻击(#602)。
4. **TOCTOU 防护**:用 `git rev-parse FETCH_HEAD` 拿 immutable SHA,避免下一次并发 fetch 把 FETCH_HEAD 换走。

#### TCP keepalive(scanner 防御)

`webhook_server.py:426-455`:`DeployHTTPServer.get_request()` 重写,设:
- `SO_KEEPALIVE=1`
- `TCP_KEEPIDLE=9` / `TCP_KEEPINTVL=3` / `TCP_KEEPCNT=3` → 18s 总 keepalive 检测
- `TCP_USER_TIMEOUT=25000` ms → 已发数据 25s 内未收 ack 即 RST

加上 `ThreadingMixIn + daemon_threads=True`,scanner 阻塞的爆炸半径锁在单 worker 线程。

历史事故 2026-05-05:scanner 半开把单线程 recvfrom 钉死,PR #602 / #597 部署连续失败 8 小时。

### 4.4 deploy.sh 五段式

`ops/webhook/deploy.sh`(634 行):

```
1. flock /run/aetherblog/deploy.lock (与 webhook_server 共享)
2. cd $PROJECT_DIR
3. (webhook 路径下 SKIP_GIT_SYNC=true) git fetch+reset 由 webhook 完成
   (直接 bash deploy.sh 路径)显式 fetch + reset --hard DEPLOY_COMMIT_SHA
4. 严格 KEY=VALUE .env 解析(SECURITY VULN-133):
     不 source(防止 FOO=$(rm -rf /))
     不 IFS='=' read(会吃尾随 '=' 让 base64 padding 截断)
     用 read -r line + ${line%%=*} / ${line#*=}
5. unset MIN_AI_PROVIDER_COUNT / MIN_AI_MODEL_COUNT(防止部署主机 .env 里过紧阈值卡住 preflight)
6. preflight --no-runtime(静态)
7. run_pre_deploy_migrations:
     compose run --rm --entrypoint /app/migrate backend up
     dirty self-heal table:
       v34 → force 35 (000034 partial-apply bug)
       v38 → force 38 (000038 view dependency bug,000039 接管修复)
       v57 → 确认 knowledge_bases 不存在后 force 56 (重放 057,再让 058 创建缺失 KB schema)
8. 根据 DEPLOY_MODE 调度:
     full        → compose pull + up -d
     incremental → compose pull <services> + up -d --no-deps <services>
     canary      → compose pull <CANARY_SERVICES> + up -d
     rollback    → 同 full,VERSION=$ROLLBACK_VERSION
9. preflight(完整,含运行时)
10. docker image prune -f
11. trap EXIT _post_deploy_hooks:
     sync_webhook_files_to_runtime(repo → /var/lib/aetherblog/webhook/)
     restart_webhook_if_stale(touch sentinel → root path-unit → +2s restart)
```

### 4.5 dirty self-heal 表

`deploy.sh:285-319`:

```bash
case "$v" in
    34)
        force_to=35
        reason="000034 partial-apply: CREATE TABLE IF NOT EXISTS post_embeddings 静默跳过,
                后续 CREATE INDEX 引用旧表不存在的列直接崩塌。
                Force 35 跳过坏 v34,让 000036 幂等修复重建 schema。"
        ;;
    38)
        force_to=38
        reason="000038 ALTER COLUMN summary TYPE 撞 v_published_posts (000001:428) 依赖,
                PostgreSQL 0A000 'cannot alter type of a column used by a view'。
                Force 38 让 000039 接管 DROP VIEW + UPDATE + ALTER + recreate VIEW。"
        ;;
    57)
        # 先探测 knowledge_bases。只有确认缺失时才 force 56;
        # 已存在或无法判定时拒绝自愈,避免非幂等 058 already exists 后再次 dirty。
        force_to=56
        reason="000057 media folder 系统目录迁移已具备漂移防护。
                Force 56 后重放 057,再让 058 创建缺失的 KB schema。"
        ;;
    *)
        return 1   # 未登记的 dirty 一律中止,避免误 heal 真问题
        ;;
esac
```

两阶段触发:
1. 部署前先探:已 dirty 命中条目立刻 force + 让 up 接管
2. up 失败后再探:同一部署周期内允许自愈 + 重试 up 一次

### 4.6 post-deploy hooks 设计

`deploy.sh:444-477` 长注释总结了三个事故学习:

#### 坑 A:显式调用放在 preflight 之前

timer +2s 在 deploy.sh 还在跑 preflight / prune(常 ≥ 2s)的时候触发,`systemctl restart` 通过 `KillMode=control-group` 把 deploy.sh 一起 SIGTERM,subprocess.run 拿到非零 → CI 收到 500。

#### 坑 B:显式调用放在 preflight 之后

`set -e` + `PREFLIGHT_BLOCK=true` 默认下 preflight FAIL 直接 exit,restart hook 永远跑不到 → webhook 一直过期,每次部署都同一种 fail loop。

#### 解法:`trap _post_deploy_hooks EXIT`

bash 真正退出**那一瞬间**才进入 trap → deploy.sh 主流程已结束,timer +2s 期间 deploy.sh 早已 wait()'d,subprocess.run 已返回,response 已写回 socket。同时 `set -e` 触发的 exit 也会进 trap → preflight FAIL 不再阻断恢复。

### 4.7 自重启的两条路径

`deploy.sh:561-600`:

**(a) Sentinel + path-unit(推荐,hardened 模式必须走这条)**

```bash
echo "..." > /run/aetherblog/restart-webhook
# /etc/systemd/system/aetherblog-webhook-restart.path 监听
# → /etc/systemd/system/aetherblog-webhook-restart.service oneshot
# → sleep 2 && rm sentinel && systemctl restart deploy-webhook
```

webhook user 只对 sentinel 文件有 W 权限,不需要 sudo / polkit。

**(b) systemd-run direct(老 root 模式 / 手工 bash deploy.sh 兜底)**

```bash
systemd-run --on-active=2s --quiet --unit="$restart_unit" \
    systemctl restart deploy-webhook
```

要求当前 uid=0。transient unit 跑出 deploy-webhook 自己的 cgroup,不会被 KillMode=control-group 误伤。

---

## 5. preflight.sh

`ops/release/preflight.sh`(257 行):

### 5.1 静态检查(`--no-runtime`)

```bash
require_cmd docker
require_cmd curl
docker compose -f $COMPOSE_FILE config --quiet
```

### 5.2 运行时检查(默认)

```
[runtime]    docker daemon reachable
[runtime]    service running: postgres / backend / ai-service / gateway
[migration]  schema_migrations.MAX(version) >= EXPECTED_MIGRATION_VERSION (=31)
[api]        gateway /health 200
[api]        ai-service /health(2 路径任一通过):
              (a) docker inspect Health.Status=healthy
              (b) docker compose exec ai-service curl /health
             重试窗口 24×5s = 120s,匹配 ai-service start_period=45s + interval=10s
[auth]       /v1/admin/stats/ai-dashboard → 401/403(未携带 token)
[auth]       /v1/admin/system/logs → 401/403
[migration]  ai_providers count >= MIN_AI_PROVIDER_COUNT (=60)
[migration]  ai_models count >= MIN_AI_MODEL_COUNT (=1500)
[logs]       backend logs 不含 "AI schema health check found missing columns"
[logs]       /app/logs 可读
[webhook]    deploy-webhook ActiveEnterTimestamp >= webhook_server.py mtime
              (历史事故 2026-05-05:进程跑过期代码 8 小时)
```

### 5.3 webhook 新鲜度检查(`preflight.sh:212-243`)

```bash
wh_file_mtime=$(stat -c %Y "$webhook_py")
wh_proc_iso=$(systemctl show deploy-webhook --property=ActiveEnterTimestamp | cut -d= -f2-)
wh_proc_epoch=$(date -d "$wh_proc_iso" +%s)
if (( wh_proc_epoch >= wh_file_mtime )); then
    pass
else
    fail "deploy-webhook process is older than webhook_server.py — run: sudo systemctl restart deploy-webhook"
```

注意 `cut -d= -f2-` 跨 systemd 版本一致剥前缀,`--value` 只在 systemd 230+。

---

## 6. ops/bootstrap-webhook.sh — 服务器一键安装

`ops/bootstrap-webhook.sh`(294 行)封装手工 7 步迁移流程:

```
Step 1/8  ensure webhook system user / group / docker membership
Step 2/8  create directory layout (/var/lib/aetherblog/{webhook,repo}, /etc/aetherblog, /var/log/aetherblog)
Step 3/8  generate WEBHOOK_SECRET → /etc/aetherblog/webhook.env (0640 root:webhook)
Step 4/8  rsync repo to PROJECT_DIR (支持 --from /root/Aetherblog 迁移)
Step 5/8  install webhook code (deploy.sh + webhook_server.py) to RUNTIME_DIR
Step 6/8  install systemd unit + restart helper unit pair
Step 7/8  daemon-reload + enable + start
Step 8/8  401 烟雾测试(curl --noproxy '*' POST /deploy)
```

幂等:检测已存在的用户 / 目录 / secret 文件并跳过。

### 6.1 用法

```bash
sudo ./ops/bootstrap-webhook.sh                            # 全新机器
sudo ./ops/bootstrap-webhook.sh --from /root/Aetherblog    # 从老 root 模式迁移
sudo ./ops/bootstrap-webhook.sh --secret "<32+hex>"        # 复用现有 secret
sudo ./ops/bootstrap-webhook.sh --dry-run                  # 只打印
```

---

## 7. GitHub Secrets

### 7.1 必需 secrets

| Secret | 用途 | 生成方式 |
| --- | --- | --- |
| `DOCKER_USERNAME` | Docker Hub 推送身份 | Docker Hub 账号 |
| `DOCKER_PASSWORD` | Docker Hub access token | Docker Hub → Account Settings → Security |
| `DEPLOY_WEBHOOK_URL` | 服务器 webhook 地址 | `http://<server>:7868/deploy` 或 `https://deploy.example.com/deploy` |
| `DEPLOY_WEBHOOK_SECRET` | HMAC-SHA256 共享密钥 | `openssl rand -hex 32` |

### 7.2 setup-secrets.sh 助手

`.github/setup-secrets.sh:96 行`,封装 `gh secret set`:

```bash
DOCKER_USERNAME / DOCKER_PASSWORD       # 必须
SERVER_HOST / SERVER_USER / SERVER_SSH_KEY  # 旧 SSH 部署模式残留(当前 webhook 模式不需要)
```

### 7.3 GITHUB_TOKEN 权限

`ci-cd.yml:32-36`:

```yaml
permissions:
  contents: read
```

工作流级默认只读。需要写权限的单独 job(docker push / PR comment / security-events write)在本地 step 重新声明 `permissions:` 块。

`trivy-scan` job(`ci-cd.yml:159-176`)显式声明:

```yaml
permissions:
  contents: read
  security-events: write   # 写入 Security → Code scanning alerts
```

---

## 8. 安全防御汇总

| 防御 | 文件:行 | VULN |
| --- | --- | --- |
| HMAC-SHA256 验签 | webhook_server.py:257-265 | VULN-132 |
| 服务名白名单 | webhook_server.py:90 | VULN-140 |
| Body 大小限制(8192 B) | webhook_server.py:241-242 | — |
| Request timeout(15s) | webhook_server.py:236-251 | — |
| TCP keepalive scanner 防御 | webhook_server.py:426-455 | — |
| .env 严格解析(不 source) | deploy.sh:135-169 | VULN-133 |
| commit_sha pin | webhook_server.py:97-201 | #601 |
| --no-tags + 显式 refspec | deploy.sh:90-99 | #602 tag-shadow |
| User=webhook + ProtectSystem=full | deploy-webhook.service:43-98 | VULN-134 |
| Sentinel restart(无 sudo) | deploy.sh:575-587 | — |
| dirty migration self-heal | deploy.sh:285-319 | — |
| forbidden default secrets guard | ci-cd.yml:180-213 | VULN-117 |
| VERSION=latest guard | ci-cd.yml:187-194 | VULN-143 |
| pnpm install --ignore-scripts (PR) | ci-cd.yml:300-303 | VULN-138 |
| GITHUB_TOKEN 默认只读 | ci-cd.yml:32-36 | VULN-137 |
| BuildKit 移除 network=host | docker-build.sh:139-152 | VULN-145 |

---

## 9. 部署模式

| 模式 | 触发 | 行为 |
| --- | --- | --- |
| `incremental`(默认 webhook 路径) | CI 检测部分模块变更 | 只 pull + up -d --no-deps 变更服务,跳过中间件 |
| `full` | webhook 不传 services / 手工调用 | compose pull + up -d 全部 |
| `canary` | 手动 `DEPLOY_MODE=canary` | `CANARY_SERVICES` 灰度 |
| `rollback` | 手动 `DEPLOY_MODE=rollback ROLLBACK_VERSION=v1.0.0` | 用旧版本镜像 full 部署 |

---

## 10. 已知限制

1. **`.github/workflows/README.md` 引用的 `docker-build-push.yml` 不存在** — 历史文档,实际工作流只有 `ci-cd.yml` 与 `quick-build.yml`。
2. **`.github/CICD_GUIDE.md` 描述的旧 root 模式安装步骤已过时** — 当前生产是 `User=webhook` + `/var/lib/aetherblog/webhook` hardened 模式(见 `ops/webhook/README.md`)。两份文档冲突,且 `CICD_GUIDE.md:106-114` "从旧方式迁移" 一节已与现实严重脱节。
3. **`gitleaks-action@v2` / `trivy-action@v0.35.0` 仍用 floating tag** — `ci-cd.yml:145,167` 留了 `TODO(supply-chain) 钉死到 SHA (VULN-136)`,未完成。
4. **`pnpm audit` / `govulncheck` / `trivy-scan` / `gitleaks` 全是 non-blocking** — 当前作为可见性信号,等基线清干净后才切 `exit 1`。所以 CI 绿灯不代表零安全公告。
5. **deploy-webhook.service WEBHOOK_BIND=0.0.0.0** — 公网暴露 :7868 + HMAC 兜底,因为仓库 nginx 暂无 `/deploy` 反代路由,CI 直连公网。注释 explicit 说要切 127.0.0.1 必须同 PR 落地 nginx 反代 + 改 GitHub secret + 验证。
6. **systemd 219 / CentOS 7 限制** — 大量 232+ 加固指令(`LogsDirectory` / `ProtectSystem=strict` / `MemoryDenyWriteExecute` / `SystemCallFilter` / `${VAR}` ExecStart 展开)被剔除。等 OS 升级才能加回。
7. **dirty self-heal 仅覆盖 v34 / v38 / v57** — v57 还要求 `knowledge_bases` 确认不存在;任何新出现的 dirty 状态需要更新 `_try_heal_known_dirty` recipe 表,否则部署中止要人工介入。
8. **trivy-scan 在 build 完成后用 `${github.sha}` tag 拉镜像扫描** — 但 build job 用 `metadata-action` 生成的 tag 是 `branch-{sha}` 形式(`ci-cd.yml:441` `type=sha,prefix={{branch}}-`),与 trivy 的 `image-ref: ...:${github.sha}` 不一致,trivy 实际可能拉不到镜像(或拉到 latest)。这是一个潜在 bug。
9. **CI/CD doc 文档分散** — `.github/CICD_README.md` / `CICD_GUIDE.md` / `workflows/README.md` 三份内容重叠且部分过时,运维入门容易踩坑。建议 consolidate。
10. **webhook restart 路径仍依赖文件系统 sentinel** — `/run/aetherblog/restart-webhook` 必须由 webhook user 可写;若 systemd 219 不识别 `RuntimeDirectory=aetherblog` 没自动建目录,fallback 到 `systemd-run`(需 root)。bootstrap 脚本已处理 install -d 兜底。
