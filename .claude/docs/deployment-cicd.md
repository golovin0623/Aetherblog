# 部署、CI/CD、Nginx 网关

> **何时读：** 准备发版；调 webhook / preflight 行为；改 Docker 配置；改 Nginx 路由；新加容器安全配置；理解 deploy mode 选择。
>
> 完整运维文档：`docs/deployment.md`（特别是 `#cicd-自动化发布链路` 一节）。本文档是 **Claude 视角的速查**。

---

## 1. 镜像构建

```bash
# 并行构建 + push（推荐）
./docker-build.sh --push --version v1.1.1

# 串行构建（网络不稳时）
./docker-build.sh --push --sequential --version v1.1.1

# 单镜像
./docker-build.sh --only backend --push
./docker-build.sh --only blog --push
./docker-build.sh --only admin --push
```

---

## 2. 生产部署

```bash
# 配置环境
cp .env.example .env
# 编辑 .env

# 拉取并启动
export DOCKER_REGISTRY=golovin0623
export VERSION=v1.1.2
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d

# 跟踪日志
docker-compose -f docker-compose.prod.yml logs -f
```

### 端口映射

| 服务 | 端口 | 说明 |
| --- | --- | --- |
| Gateway（统一入口） | 7899 | 唯一对外端口 |
| Blog | 7893 | 可选直连 |
| Admin | 7894 | 可选直连 |
| PostgreSQL | 7895 | 可选直连（生产建议关） |
| Backend API | — | 仅容器内网络 |

---

## 3. CI/CD Webhook 自动化（五段式管线）

**生产部署完全由管线驱动 —— 服务器上无任何手动步骤。**

```
GitHub Actions (ci-cd.yml)
   │ build & push multi-arch images
   ▼
HMAC-SHA256 signed POST /deploy
   │
   ▼
webhook_server.py  (ops/webhook/)
   ├─ verify HMAC + parse services allowlist
   ├─ flock /var/lock/aetherblog-deploy.lock + git fetch + reset --hard FETCH_HEAD  ← 代码在此拉取（PR #525）
   ├─ release flock, fork deploy.sh with env["SKIP_GIT_SYNC"]="true"
   ▼
deploy.sh  (ops/webhook/)
   ├─ flock /var/lock/aetherblog-deploy.lock
   ├─ skip internal git sync（已在 webhook 层完成；fallback 路径保留给直接 `bash deploy.sh` 调用）
   ├─ 严格 KEY=VALUE .env 解析（NOT source、NOT IFS='='）
   ├─ compose pull
   ├─ pre-deploy migration（compose run --rm + dirty self-heal table）
   └─ compose up -d   (full / incremental / canary / rollback)
   ▼
ops/release/preflight.sh
   ├─ static: compose config, required cmds
   └─ runtime: services running, migration ≥33, gateway /health,
              ai-service /health (≤120s retry window),
              auth enforcement, ai_providers ≥60, ai_models ≥1500,
              backend logs clean, /app/logs readable
```

任一步失败 → `exit 1` 中止部署 + 日志追加到 `/var/log/aetherblog-deploy.log`。

---

## 4. Deploy 模式（通过 `DEPLOY_MODE` 环境变量）

| 模式 | 行为 |
| --- | --- |
| `full`（默认） | `compose pull` + `up -d` 所有服务 |
| `incremental` | 仅指定的 `DEPLOY_SERVICES`；纯前端发布跳过 migration |
| `canary` | 预定义 `CANARY_SERVICES=backend,ai-service` 的灰度 |
| `rollback` | `ROLLBACK_VERSION=vX.Y.Z` 回滚到指定镜像 tag |

---

## 5. 容器安全加固（所有应用服务）

| 项 | 配置 | 关联 VULN |
| --- | --- | --- |
| 不许提权 | `security_opt: [no-new-privileges:true]` | VULN-123 |
| 砍 capability | `cap_drop: [ALL]` | VULN-123 |
| 只读根文件系统 | `read_only: true` + `tmpfs` 挂载可写区 | VULN-123 |
| 强制密钥存在 | `JWT_SECRET:?...` / `AI_CREDENTIAL_ENCRYPTION_KEYS:?...` / `REDIS_PASSWORD:?...` 必须设置；compose 在缺失时 fail-fast | VULN-056 / -119 / -120 |
| ai-service 健康检查 | `start_period: 45s`、`interval: 10s` —— 给冷启动留余量（litellm/asyncpg/pgvector import + asyncpg pool + jwt_keys DB fetch） | — |
| backend 健康检查 | `start_period: 30s`、`interval: 3s` | VULN-150（不要把崩溃循环当"healthy yet"） |
| Docker socket | **默认不挂载**（PR #604）。`:ro` 不约束 Docker API 操作面 —— 等同 host-root 暴露。`/v1/admin/monitor/*` 会软失败为 `DockerAvailable: false` 空态。需要监控请引入 `tecnativa/docker-socket-proxy` 旁车并在代码侧改 `DialContext`，详见 `docs/deployment.md` §"Docker socket 访问的权衡"。 | — |

---

## 6. Nginx 网关路由

### 文件位置

- `nginx/nginx.conf` —— **生产**路由
- `nginx/nginx.dev.conf` —— **开发**路由（同样规则 + hot reload 代理）

### 生产规则速览

| 路径 | 上游 | 关键参数 |
| --- | --- | --- |
| `/api/v1/ai/*` | `ai_service` (FastAPI:8000) | timeout 600s、`X-Accel-Buffering: no`（SSE） |
| `/admin/` | admin (Vite:5173 / 编译后:80) | — |
| `/api/` | backend (Go:8080) | — |
| `/` | blog (Next.js:3000) | — |

`client_max_body_size: 10GB`（媒体上传）。

被 `./start.sh --gateway`（开发）和 `./start.sh --prod`（生产）使用。

### 详细规则与代理头部

见 `.agent/rules/nginx-guide.md`。

---

## 7. CI/CD GitHub Actions

| 工作流 | 用途 |
| --- | --- |
| `ci-cd.yml` | 主管线：build / test / 推 Docker 镜像 |
| `quick-build.yml` | 快速验证构建 |

详细：`.github/CICD_GUIDE.md` + `.github/VERSION_GUIDE.md`。
