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
| `DEPLOY_WEBHOOK_URL` | 部署 webhook 地址 | `https://deploy.example.com/deploy`（必须 HTTPS 或仅内网/VPN 可达；内网直连需带 `:7868`） |
| `DEPLOY_WEBHOOK_SECRET` | webhook HMAC 密钥 | `openssl rand -hex 32` 生成的 64 位 hex |

## Webhook 部署配置（服务器端）

### 首次安装

```bash
# 1. 克隆仓库到服务器
git clone https://github.com/golovin0623/AetherBlog.git /root/Aetherblog
cd /root/Aetherblog

# 2. 创建软链接（git pull 后自动更新脚本，无需手动 cp）
ln -sfn /root/Aetherblog/ops/webhook /root/Aetherblog/webhook
chmod +x /root/Aetherblog/ops/webhook/deploy.sh

# 3. 生成 webhook secret
WEBHOOK_SECRET=$(openssl rand -hex 32)
echo "保存此 secret，并同步写入 GitHub Actions 的 DEPLOY_WEBHOOK_SECRET"

# 4. 安装 systemd 服务
cp ops/webhook/deploy-webhook.service /etc/systemd/system/
sed -i "s/WEBHOOK_SECRET=change-me/WEBHOOK_SECRET=${WEBHOOK_SECRET}/" \
  /etc/systemd/system/deploy-webhook.service

# 5. 启动服务
systemctl daemon-reload
systemctl enable deploy-webhook
systemctl start deploy-webhook

# 6. 将 webhook URL 配置到 GitHub Secret
#    DEPLOY_WEBHOOK_URL = https://<your-domain>/deploy
#    （或仅内网/VPN 地址，内网直连需带端口 :7868；不要在公网明文 HTTP 暴露 webhook）
#    DEPLOY_WEBHOOK_SECRET = 上面生成的 WEBHOOK_SECRET
```

> webhook 鉴权使用 `X-Hub-Signature-256: sha256=<hmac>` 请求头；secret 不再放在 URL 路径里。生产环境必须使用 HTTPS，或放在仅内网/VPN 可达的私网入口并配合防火墙/反向代理。

### 从旧方式迁移（手动 cp → 软链接）

如果之前是手动复制文件到 `/root/Aetherblog/webhook/`：

```bash
rm -rf /root/Aetherblog/webhook
ln -sfn /root/Aetherblog/ops/webhook /root/Aetherblog/webhook
systemctl restart deploy-webhook
```

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
tail -n 50 /var/log/aetherblog-deploy.log
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
tail -n 50 /var/log/aetherblog-deploy.log
journalctl -u deploy-webhook -n 50
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
