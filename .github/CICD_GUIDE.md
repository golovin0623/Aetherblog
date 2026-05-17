# GitHub Actions CI/CD 配置指南

本项目使用 GitHub Actions + Webhook 实现自动化 CI/CD，支持增量部署（只重启变更的服务，不动中间件）。

## 工作流概览

### `ci-cd.yml` — 主流程

```
detect-changes ──┬─→ frontend-quality ──┬─→ build-blog     ──┐
                 ├─→ backend-test     ──┼─→ build-backend   ──┤
                 ├─→ ai-test          ──┼─→ build-ai-service──┼─→ deploy (webhook)
                 └─→ config-validate  ──┴─→ build-admin     ──┘
```

`config-validate` 会同时校验 Docker Compose 渲染与 Go migration 版本唯一性，避免多个 PR 抢同一个 `0000xx` 迁移号后在部署阶段才失败。

**触发条件：**
- Push 到 `main` — 增量构建 + 增量部署 + push `:latest`
- Push 到 `develop` — 增量构建（不发部署 webhook，不动 `:latest`）
- PR 到 `main` — 仅测试 + lint，不构建镜像

> SECURITY: Tag 推送（`v*` 等）**不**触发 CI 构建或部署。Tag 不经过 PR review，
> 历史上曾是镜像/部署链路的授权绕过点。版本化镜像通过 `docker-build.sh --push --version vX.Y.Z`
> 在受控环境本地构建后推送，回滚走 `DEPLOY_MODE=rollback ROLLBACK_VERSION=vX.Y.Z`。

### 路径变更检测

| 模块 | 触发路径 | 说明 |
|------|----------|------|
| **backend** | `apps/server-go/**` | Go 后端 |
| **ai-service** | `apps/ai-service/**` | Python AI 服务 |
| **blog** | `apps/blog/**`, `packages/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | Next.js 博客 |
| **admin** | `apps/admin/**`, `packages/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | Vite 管理后台 |

全局触发（所有模块重建）：`docker-compose*.yml`、`.github/workflows/ci-cd.yml`

### 增量部署

CI 自动检测哪些模块变更，只将变更的服务名传给服务器 webhook：

```
CI: {"services": "backend gateway"} → webhook → deploy.sh incremental
→ docker compose pull backend gateway
→ docker compose up -d --no-deps backend gateway
→ postgres/redis 完全不受影响
```

### Docker 镜像名称规范

| 镜像 | 完整名称 | 说明 |
|------|---------|------|
| Go 后端 | `golovin0623/aetherblog-backend` | Echo HTTP 服务 |
| Python AI | `golovin0623/aetherblog-ai-service` | FastAPI + LiteLLM |
| 博客前台 | `golovin0623/aetherblog-blog` | Next.js standalone |
| 管理后台 | `golovin0623/aetherblog-admin` | Vite + Nginx 静态 |

镜像由 `DOCKER_REGISTRY` 环境变量 + 固定后缀组成：`${DOCKER_REGISTRY}/aetherblog-{service}`。

## GitHub Secrets 配置

在仓库 Settings → Secrets and variables → Actions 中设置：

| Secret | 说明 | 示例 |
|--------|------|------|
| `DOCKER_USERNAME` | Docker Hub 用户名 | `golovin0623` |
| `DOCKER_PASSWORD` | Docker Hub Access Token | (在 Docker Hub → Account Settings → Security 创建) |
| `DEPLOY_WEBHOOK_URL` | 部署 webhook 地址 | 当前直连形态: `http://<server-public-ip>:7868/deploy`; 若已配置 nginx/HTTPS 反代, 用 `https://deploy.example.com/deploy` |
| `DEPLOY_WEBHOOK_SECRET` | webhook HMAC 密钥 | `openssl rand -hex 32` 生成的 64 位 hex |

## Webhook 部署配置（服务器端）

### 首次安装

当前生产 webhook 以无特权 `webhook` 用户运行:

| 路径 | 用途 |
|---|---|
| `/var/lib/aetherblog/repo` | `PROJECT_DIR`, webhook 收到 CI 请求后在这里 `git fetch + reset` |
| `/var/lib/aetherblog/webhook` | `deploy-webhook.service` 的运行副本目录, 只放 `webhook_server.py` / `deploy.sh` |
| `/etc/aetherblog/webhook.env` | `WEBHOOK_SECRET` 环境文件 |
| `/var/log/aetherblog/deploy.log` | 部署脚本日志 |

完整安装流程如下:

```bash
# 1. 准备一份源码 checkout
#    fresh install 可临时 clone 到 /root/Aetherblog 或 /tmp/aetherblog-src。
#    如果仓库是 private, 这里 root 能 clone 只代表安装源码可用,
#    不代表 deploy-webhook 运行时能拉代码; 运行时权限见下方“私有仓库 SSH 访问”。
#    private repo 可改用 git@github.com:golovin0623/Aetherblog.git 或带认证的 HTTPS。
git clone https://github.com/golovin0623/Aetherblog.git /root/Aetherblog
cd /root/Aetherblog

# 2. 运行幂等 bootstrap 脚本（二选一）
#    fresh install:
sudo ./ops/bootstrap-webhook.sh

#    旧 root 模式迁移:
#    sudo ./ops/bootstrap-webhook.sh --from /root/Aetherblog

# 3. 按脚本输出同步 GitHub Actions Secrets
#    Settings -> Secrets and variables -> Actions:
#    DEPLOY_WEBHOOK_URL    = http://<server-public-ip>:7868/deploy
#      若已配置 nginx/HTTPS 反代, 用 https://<your-domain>/deploy
#    DEPLOY_WEBHOOK_SECRET = /etc/aetherblog/webhook.env 中 WEBHOOK_SECRET 的值

# 4. 验证 systemd 进程
systemctl status deploy-webhook --no-pager
journalctl -u deploy-webhook -n 50 --no-pager
```

旧 root 模式迁移时, `--from` 会把旧仓库 rsync 到 `/var/lib/aetherblog/repo`,
清理历史 `systemctl edit` override, 并切到 `webhook` 用户运行形态。

> webhook 鉴权使用 `X-Hub-Signature-256: sha256=<hmac>` 请求头；secret 不再放在 URL 路径里。当前 unit 默认 `WEBHOOK_BIND=0.0.0.0:7868`, 因此 `DEPLOY_WEBHOOK_URL` 可先用 `http://<server-public-ip>:7868/deploy`。更稳妥的生产形态是后续加 nginx/HTTPS 反代或限制为内网/VPN 入口, 但不能只改 URL, 还要同步落地反代路由与 GitHub Secret。

> 旧文档中的 `/root/Aetherblog/webhook` 软链接方式已经不是推荐生产形态。当前 unit 使用 `User=webhook` 和 `ProtectHome=true`, 不应继续依赖 `/root/.ssh`、`/root/.pyenv` 或 `/root/Aetherblog/webhook` 作为运行时资源。

### 私有仓库 SSH 访问（private repo 分支）

如果仓库是 private, CI 最后一步触发的不是 Actions runner 上的 git pull, 而是服务器
`deploy-webhook.service` 里的 `webhook` 用户在
`/var/lib/aetherblog/repo` 执行 git fetch。root 用户下配置
`/root/.ssh/id_ed25519` 并手动 fetch 成功, 不能证明 webhook 能成功。

这一步是 private repo 的分支处理: 公共仓库可以跳过; 私有仓库必须让
`webhook` 用户本身具备只读拉取权限。

给 `webhook` 用户配置只读 GitHub Deploy Key。若 key 已存在, 不要覆盖, 直接查看
现有 `.pub` 并确认它已添加到 GitHub:

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

把公钥添加到 GitHub 仓库 `Settings -> Deploy keys -> Add deploy key`, 只读部署不要勾选 write access。然后:

```bash
sudo -u webhook -H ssh-keyscan github.com | sudo tee -a /var/lib/aetherblog/webhook/.ssh/known_hosts >/dev/null
sudo chown -R webhook:webhook /var/lib/aetherblog/webhook/.ssh
sudo chmod 0700 /var/lib/aetherblog/webhook/.ssh
sudo chmod 0600 /var/lib/aetherblog/webhook/.ssh/id_ed25519
sudo chmod 0644 /var/lib/aetherblog/webhook/.ssh/id_ed25519.pub
sudo chmod 0644 /var/lib/aetherblog/webhook/.ssh/known_hosts

# CentOS 7 Git 可能不支持 `git -C`, 用 cd 写法验证真实运行身份。
sudo -u webhook -H sh -lc 'cd /var/lib/aetherblog/repo && git remote set-url origin git@github.com:golovin0623/Aetherblog.git'
# 可选: 观察 GitHub SSH 认证输出; GitHub 不提供 shell, 这条可能非 0, 不作为最终判定。
sudo -u webhook -H ssh -T git@github.com || true
sudo -u webhook -H sh -lc 'cd /var/lib/aetherblog/repo && git fetch --quiet --tags origin main'
```

最后一条成功后, CI webhook 才具备私有仓库读取权限。

### 验证

```bash
# 健康检查（未签名，应返回 401 Invalid signature）
curl --noproxy '*' -i --max-time 5 -X POST http://127.0.0.1:7868/deploy

# 签名探测（非法服务名，应返回 400 Invalid services field，不触发部署）
body='{"services": "__probe__"}'
sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | awk '{print $NF}')
printf '%s' "$body" | curl --noproxy '*' -i --max-time 5 -X POST \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$sig" \
  --data-binary @- \
  http://127.0.0.1:7868/deploy

# 查看日志
journalctl -u deploy-webhook -n 50 --no-pager
tail -n 50 /var/log/aetherblog/deploy.log
```

### Webhook Secret 轮换

如果 `DEPLOY_WEBHOOK_SECRET` 被贴到聊天、日志、工单或截图里，必须立即轮换。完整步骤见
[`ops/webhook/README.md`](../ops/webhook/README.md#webhook-secret-轮换)。

### 部署模式

| 模式 | 触发方式 | 行为 |
|------|---------|------|
| **incremental** | CI 自动（传 services JSON） | 只 pull + restart 变更的服务，`--no-deps` 跳过中间件 |
| **full** | 不传 services / 手动触发 | 全量 pull + up -d |
| **canary** | `DEPLOY_MODE=canary` | 指定服务灰度部署 |
| **rollback** | `DEPLOY_MODE=rollback ROLLBACK_VERSION=v1.0.0` | 回滚到指定版本 |

## 手动部署 / 快速重启

服务器上日常运维，不走 CI：

```bash
cd /root/Aetherblog

# 只重启应用层（不动 postgres/redis）— 最常用
./restart.sh

# 只重启后端
./restart.sh backend

# 拉取最新镜像后重启
./restart.sh --pull

# 全量启动（含中间件，首次部署用）
docker compose -f docker-compose.prod.yml up -d
```

## 版本发布

```bash
# 日常推 main —— 只构建变更模块 + 增量部署，自动更新 :latest
git push origin main

# 版本化镜像 —— 在受控环境本地构建并 push（CI 不再处理 tag 推送）
./docker-build.sh --push --version v1.2.0

# 推 tag 仅作为代码版本标记，不触发 CI 镜像构建/部署
git tag v1.2.0
git push origin v1.2.0
```

## 常见问题

### Docker Hub 推送失败
- 检查 `DOCKER_USERNAME` / `DOCKER_PASSWORD` 是否正确
- 确保使用 Access Token 而不是密码

### Webhook 返回 500
```bash
# 查看详细错误
tail -n 50 /var/log/aetherblog/deploy.log
journalctl -u deploy-webhook -n 50 --no-pager

# 如果响应体包含 Permission denied (publickey), 必须用 webhook 用户验证:
sudo -u webhook -H sh -lc 'cd /var/lib/aetherblog/repo && git fetch --quiet --tags origin main'
```

### 构建超时
- 已配置 Docker 缓存（registry cache），正常构建 < 5 分钟
- Go 后端构建 ~20s，前端 ~2-3 分钟

## 相关文件

| 文件 | 说明 |
|------|------|
| [`.github/workflows/ci-cd.yml`](../../../.github/workflows/ci-cd.yml) | CI/CD 主流程 |
| [`ops/webhook/`](../../ops/webhook/) | Webhook 部署脚本 + systemd 服务 |
| [`restart.sh`](../../restart.sh) | 快速重启脚本（不动中间件） |
| [`docker-compose.prod.yml`](../../docker-compose.prod.yml) | 生产环境编排 |
| [`docker-build.sh`](../../docker-build.sh) | 本地手动构建脚本 |
