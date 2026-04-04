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

**触发条件：**
- Push 到 `main` 或 `develop` — 增量构建 + 增量部署
- Push Tag `v*` — 全量构建 + 全量部署（标志全部置为 true，忽略变更检测）
- PR 到 `main` — 仅测试 + lint，不构建镜像

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
| `DEPLOY_WEBHOOK_URL` | 部署 webhook 地址 | `http://your-server:7868/deploy/your-secret` |
| `JWT_SECRET` | JWT 密钥（可选，用于 AI 服务） | 随机字符串 |

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
echo "保存此 secret: $WEBHOOK_SECRET"

# 4. 安装 systemd 服务
cp ops/webhook/deploy-webhook.service /etc/systemd/system/
sed -i "s/WEBHOOK_SECRET=change-me/WEBHOOK_SECRET=${WEBHOOK_SECRET}/" \
  /etc/systemd/system/deploy-webhook.service

# 5. 启动服务
systemctl daemon-reload
systemctl enable deploy-webhook
systemctl start deploy-webhook

# 6. 将 webhook URL 配置到 GitHub Secret
#    DEPLOY_WEBHOOK_URL = http://<server-ip>:7868/deploy/<WEBHOOK_SECRET>
```

### 从旧方式迁移（手动 cp → 软链接）

如果之前是手动复制文件到 `/root/Aetherblog/webhook/`：

```bash
rm -rf /root/Aetherblog/webhook
ln -sfn /root/Aetherblog/ops/webhook /root/Aetherblog/webhook
systemctl restart deploy-webhook
```

### 验证

```bash
# 增量部署测试
curl -i -X POST -H "Content-Type: application/json" \
  -d '{"services": "backend gateway"}' \
  "http://127.0.0.1:7868/deploy/<WEBHOOK_SECRET>"

# 全量部署测试（不传 services）
curl -i -X POST "http://127.0.0.1:7868/deploy/<WEBHOOK_SECRET>"

# 查看日志
journalctl -u deploy-webhook -n 50 --no-pager
tail -n 50 /var/log/aetherblog-deploy.log
```

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
# 常规发布（推送 tag 触发全量构建 + 部署）
git tag v1.2.0
git push origin v1.2.0

# 日常推 main（只构建变更模块 + 增量部署）
git push origin main
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
