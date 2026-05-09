# 10 - 基础设施 / DevOps 总览

> 范围:Docker Compose 三件套、各 app 的 Dockerfile、Nginx 网关、`start.sh` 一键脚本、GitHub Actions、自托管 webhook 部署器、ops 运维脚本与生产 systemd unit。
>
> 本文档是 AetherBlog 全部 "把代码跑起来 / 让代码上线" 链路的入口,后续 6 份子文档按主题展开。

---

## 1. 基础设施全景图

```
                       ┌─────────────────────── GitHub ───────────────────────┐
                       │  push to main / PR                                   │
                       │      │                                               │
                       │      ▼                                               │
                       │  .github/workflows/ci-cd.yml                         │
                       │   ├─ detect-changes  (paths-filter)                  │
                       │   ├─ gitleaks  ✨ secret 扫描                        │
                       │   ├─ config-validate (compose config + migrations)   │
                       │   ├─ forbidden-defaults-guard (VERSION=latest 黑名单)│
                       │   ├─ frontend-quality (lint + typecheck)             │
                       │   ├─ backend-test  (go build + test + govulncheck)   │
                       │   ├─ ai-test       (py_compile + ruff + import 验证) │
                       │   ├─ build-{backend,ai-service,blog,admin}           │
                       │   │   ├─ docker buildx (linux/amd64)                 │
                       │   │   ├─ cache-from gha + registry buildcache        │
                       │   │   └─ push docker.io/golovin0623/aetherblog-*     │
                       │   ├─ trivy-scan (CVE 扫描,非阻断)                    │
                       │   └─ deploy → POST /deploy (HMAC-SHA256)             │
                       └─────────────────────┬─────────────────────────────────┘
                                             │
                                             ▼
                       ┌────────── 服务器 (single host) ──────────┐
                       │  systemd: deploy-webhook.service          │
                       │   ├─ User=webhook (无 shell, 加 docker)   │
                       │   ├─ ProtectSystem=full / ProtectHome     │
                       │   ├─ /var/lib/aetherblog/webhook (副本)   │
                       │   └─ webhook_server.py :7868              │
                       │           │                                │
                       │           ▼ 验证 HMAC + git fetch+reset   │
                       │   ops/webhook/deploy.sh                   │
                       │     ├─ flock /run/aetherblog/deploy.lock  │
                       │     ├─ docker compose pull                │
                       │     ├─ run-once: backend migrate up       │
                       │     ├─ docker compose up -d (incremental) │
                       │     └─ trap EXIT → sync_webhook + restart │
                       │                                            │
                       │  ┌───── docker network: aetherblog ─────┐ │
                       │  │ gateway (nginx:alpine) :7899 → 80    │ │
                       │  │   ├─ /            → blog:3000        │ │
                       │  │   ├─ /admin/      → admin:8080       │ │
                       │  │   ├─ /api/v1/ai/  → ai-service:8000  │ │
                       │  │   ├─ /api         → backend:8080     │ │
                       │  │   └─ /uploads/    → backend:8080     │ │
                       │  │                                      │ │
                       │  │ blog (Next.js standalone)            │ │
                       │  │ admin (nginx-unprivileged + Vite SPA)│ │
                       │  │ backend (Go + Echo)                  │ │
                       │  │ ai-service (FastAPI + LiteLLM)       │ │
                       │  │ postgres (pgvector/pg17)             │ │
                       │  │ redis (7.2-alpine, opt-in)           │ │
                       │  │ docker-socket-proxy (opt-in)         │ │
                       │  └──────────────────────────────────────┘ │
                       └────────────────────────────────────────────┘
```

---

## 2. 本地 vs 生产 拓扑差异

| 维度 | 本地 dev (`./start.sh`) | 本地 gateway dev (`./start.sh --gateway`) | 生产 (`docker-compose.prod.yml`) |
| --- | --- | --- | --- |
| Compose 文件 | `docker-compose.yml`(中间件 only) | `docker-compose.dev.yml`(中间件 + nginx) | `docker-compose.prod.yml`(全部) |
| backend / ai / blog / admin | 宿主机进程(`go run`/`uvicorn`/`pnpm dev`) | 宿主机进程 | 容器,镜像走 Docker Hub `golovin0623/aetherblog-*` |
| nginx | 不启 | nginx:alpine 容器 + `nginx.dev.conf`(走 `host.docker.internal`) | nginx:alpine 容器 + `nginx.conf`(走 docker network 服务名) |
| postgres / redis | docker-compose.yml 中间件容器 | 同左 | 同左,且 redis 需 `--profile with-redis` 显式启用 |
| 端口暴露 | 各服务直接暴露(3000/5173/8080/8000/5432/6379) | 同左 + 7899(gateway) | 仅 7899(gateway) + 可选 7893(blog) / 7894(admin) / 7895(pg) / 6379(redis) |
| 环境变量来源 | `.env`(根) + `apps/{blog,admin}/.env.local` | 同左 | `.env`(根),容器侧由 compose interpolation 注入 |
| 健康检查 | `start.sh` 内 `wait_for_http` (curl) | 同左 + 网关 `/health` | docker `HEALTHCHECK` + `start_period`(backend 30s / ai 45s) |

---

## 3. 端口分布与网关入口

### 网关 :7899 路由表

| 路径 | 后端 | 用途 | 备注 |
| --- | --- | --- | --- |
| `/` | `blog:3000` | Next.js 博客 | 默认 location,支持 ws upgrade(HMR) |
| `/_next/static` | `blog:3000` | 静态资源 | `expires 1y` + `immutable` |
| `/admin/` | `admin:8080` | Vite SPA | 容器内已用 nginx-unprivileged + try_files 兜底 |
| `/admin/assets/` | `admin:8080` | 静态资源 | `expires 1d` + `immutable` |
| `/api/v1/ai/` | `ai-service:8000` | AI 接口 | 边缘限流 10r/min + buffering off + 600s read timeout |
| `/api/v1/admin/providers` | `ai-service:8000` | provider 管理 | 直通 ai-service |
| `/api/v1/admin/search` | `backend:8080` | 索引/重建 | buffering off + 600s |
| `/api/v1/public/search` | `backend:8080` | 公开搜索 + SSE QA | 同上 |
| `/api/v1/agent` | `backend:8080` | Agent 工作台 SSE | thinking 模型可能数十秒首 token |
| `/api/v1/auth/login` | `backend:8080` | 登录 | 边缘限流 5r/min burst=3 防爆破 |
| `/api/(ws\|websocket\|socket)` | `backend:8080` | WebSocket | 1h read timeout |
| `/api/(upload\|media\|file)` | `backend:8080` | 大文件上传 | `client_max_body_size 10G`,1h timeout,关 request buffering |
| `/api/(ai\|chat\|stream)` | `backend:8080` | 老 SSE 入口 | 兼容路径 |
| `/uploads/` | `backend:8080` /api/uploads/ | 用户上传文件 | 7d 缓存,`.svg/.html/.xml` 强制 attachment |
| `/api` | `backend:8080` | 兜底 | 边缘限流 30r/s burst=20 |
| `/health` | nginx 自身 | 健康检查 | `return 200 'OK'` |

### 本地直连端口

- Blog Next.js dev: `3000`
- Admin Vite dev: `5173`
- Backend Go: `8080`
- AI Service FastAPI: `8000`
- Postgres: `5432`(本地)/`7895`(生产)
- Redis: `6379`
- Webhook deploy server: `7868`(仅生产服务器)

---

## 4. 一键启动链路 — `start.sh --gateway`

```
main()
  acquire_lock           ← .locks/start.lock 防并发
  check_dependencies     ← docker / node / pnpm / curl / python
  bootstrap_env          ← 自动生成 .env / 各 app .env.local + 强随机密钥
  start_middleware       ← docker compose up -d (postgres + redis)
  install_deps           ← pnpm install(若 node_modules 不存在)
  start_backend          ← go build + nohup ./bin/server,wait_for_http :8080
  start_ai_service       ← .venv + pip install + nohup uvicorn,wait_for_http :8000
  start_blog             ← pnpm install + nohup pnpm dev,wait_for_http :3000
  start_admin            ← pnpm install + nohup pnpm dev,wait_for_http :5173
  start_gateway          ← docker run nginx:alpine + nginx.dev.conf,wait_for_http /health
  show_status
```

关键防御:
- `start.sh:13` `set -euo pipefail` + `IFS=$'\n\t'`
- `start.sh:184-208` `docker_compose_project_name()` 解析项目名以正确定位 `${project}_postgres_data` 卷,避免硬编码
- `start.sh:386-413` `bootstrap_env` 仅在 postgres 数据卷不存在时才生成强随机口令(避免与既存 PGDATA 分叉造成 28P01)
- `start.sh:497-502` 把 `.env` 中的 PG/Redis 口令显式 export 回 host shell,避免 host shell 已 export 同名变量时 docker-compose interpolation 拿到错误值
- `start.sh:881-895` 启动前强校验 `JWT_SECRET` 长度 ≥32

完整流程见 `03-startup-scripts.md`。

---

## 5. 关键决策

### 5.1 为什么是 gateway :7899

- **Cookie 域统一**:`AUTH_COOKIE_SAME_SITE=Strict` 下,所有路径走同一 origin 才能让浏览器回带 cookie。直连模式 admin :5173 + backend :8080 跨端口拒绝下发。
- **SSE / WebSocket 透传验证**:nginx 必须 `proxy_buffering off` + `X-Accel-Buffering: no`,绕开网关无法验证。
- **CSP 单点维护**:CSP / HSTS / Permissions-Policy 全部由 `nginx/security-headers.conf` 通过 `include` 在每个 location 重新声明(`add_header` 不继承)。
- **大文件上传**:`/api/(upload|media|file)` 单独配 10G + `proxy_request_buffering off`,与默认 `client_max_body_size 50m` 区分。

### 5.2 为什么 dev / prod compose 分文件

- `docker-compose.yml`(45 行,根目录)只装中间件,`./start.sh` 把应用进程跑在宿主机,迭代快。
- `docker-compose.dev.yml`(75 行)加 gateway,nginx 配置走 `nginx.dev.conf` 通过 `host.docker.internal` 反代到宿主机进程,**保留 hot reload** 的同时验证网关行为。
- `docker-compose.prod.yml`(467 行)所有应用都进容器,镜像版本通过 `${VERSION:-latest}` 注入,引入容器加固(`security_opt: no-new-privileges`、`cap_drop: ALL`、`read_only: true` + `tmpfs`)。

### 5.3 为什么 webhook 自托管而不是直接 SSH 部署

- **Pull 模式**:服务器主动拉镜像,GitHub Actions 不持有 SSH key 也不持有 docker socket。
- **HMAC 兜底**:`X-Hub-Signature-256` 让公网 :7868 在没有 nginx 反代的情况下也能抗扫描器(`webhook_server.py:257-265`)。
- **flock 互斥**:`/run/aetherblog/deploy.lock` 让 webhook 与手动 `bash deploy.sh` 互斥(`deploy.sh:30-33`)。
- **服务名白名单**:`ALLOWED_SERVICES = {backend, ai-service, blog, admin, gateway}`(`webhook_server.py:90`),拒绝静默回退到全量部署(VULN-140)。

---

## 6. 已知问题

1. **`.github/workflows/README.md:7-21`** 引用了不存在的 `docker-build-push.yml`。当前实际工作流只有 `ci-cd.yml` 与 `quick-build.yml`。文档需要校对。
2. **`.github/CICD_GUIDE.md:75-114`** 描述的旧 root 模式安装步骤(`/root/Aetherblog/webhook` 软链 + 内联 `WEBHOOK_SECRET`)已与生产实践脱节,实际现状见 `ops/webhook/README.md` 的 hardened 模式(`User=webhook` + `/var/lib/aetherblog/webhook`)。两份文档存在冲突。
3. **`.github/workflows/ci-cd.yml:146,170`** `gitleaks-action@v2` 与 `trivy-action@v0.35.0` 仍用 floating tag 而非 SHA pin(VULN-136 TODO 未完成)。
4. **`docker-build.sh:33`** 默认 `REGISTRY=golovin0623`(硬编码用户),不读 `.env` 中的 `DOCKER_REGISTRY`,fork 仓库的人需要改两处。
5. **`docker-hub-cleanup.sh:10`** `REPOSITORIES` 缺 `aetherblog-ai-service`,跑这脚本会漏删 ai-service 镜像。
6. **`nginx/nginx.dev.conf` 缺 security-headers.conf include**:dev 网关只在 server 块直接 `add_header`,任何 location 内出现 `add_header` 都会压制 server 块所有头(nginx 行为)。当前仅 `/uploads/` 与可执行文件 location 显式重声明,其他 location(如 `/admin/`)在 dev 下没有安全头。生产 `nginx.conf` 通过 `include /etc/nginx/security-headers.conf` 解决。
7. **`docker-compose.dev.yml:25,46`** 把 PG / Redis 端口绑定到 `0.0.0.0`(VULN-122 dev 回退),局域网内任何人凭密码可达。生产 `docker-compose.prod.yml:93,128` 同样回退,要求 host 防火墙兜底。
8. **`docker-compose.prod.yml:402,433`** Blog/Admin 的 `BLOG_PORT/ADMIN_PORT` 默认对外暴露(同上回退),独立域名直挂场景使用,但 single-host 部署是冗余暴露面。
9. **`apps/server-go/Dockerfile:8`** `COPY apps/server-go/go.mod` 但 build context 是 `.`,不在 builder layer 单独 cache 工作区代码,任何源文件改动都会让 `go mod download` 重新跑(虽然有 `--mount=type=cache` 部分缓解)。
10. **`apps/blog/Dockerfile:34`** `COPY . .` 把整个 repo 拷进 builder layer,即使 `.dockerignore` 已排除 `node_modules` / `.next`,大量无关文件(.claude/、docs/)仍进了 build cache,层指纹不稳定。

---

## 7. 扩展点

| 场景 | 扩展位置 |
| --- | --- |
| 新加一个应用服务(Web Worker / 任务队列) | 1) `docker-compose.prod.yml` 加 service block,完整 security_opt/cap_drop/read_only 模板照抄 backend;2) `apps/<name>/Dockerfile` 新建多阶段构建;3) `nginx/nginx.conf` 加 location;4) `.github/workflows/ci-cd.yml` 复制一组 build-* job;5) `webhook_server.py:90` `ALLOWED_SERVICES` 加新名 |
| 切外部 Redis / 托管 Redis | `.env` 设 `REDIS_HOST=<外部 host>` + `REDIS_PORT` + `REDIS_PASSWORD`,**不要** `--profile with-redis` |
| 切对象存储替代本地 `/uploads/` | admin "存储管理" 后台配 provider(S3/COS/R2),不需要改 compose / nginx;`AETHERBLOG_SYNC_AUTO_ENABLED=true` 开启后台批量备份(默认关) |
| 启用容器监控面板 | `docker compose -f docker-compose.prod.yml --profile with-monitor up -d` + `.env` 设 `DOCKER_SOCKET_PROXY_URL=http://docker-socket-proxy:2375` |
| 多副本 backend(横向扩) | `docker-compose.prod.yml` `backend` 加 `deploy.replicas`;`nginx.conf:60-79` `upstream backend` 已声明 `keepalive 64`,加多行 `server backend:8080` 即可负载均衡 |
| 接 Cloudflare/CDN | gateway 上层加 CF Tunnel 或 cdn → :7899,nginx 内已配置 `X-Forwarded-Proto / X-Forwarded-For / X-Real-IP`,`set_real_ip_from` 需在 `nginx.conf` 头部加上 CF 的 IP 段 |
| HTTPS 终结 | `nginx.conf` 顶部加 `listen 443 ssl`,移除 `:80`,启用 HSTS(`security-headers.conf:23` 已 ready,触发条件是 `$scheme=https`) |

---

## 8. 关键文件索引

| 文件 | 职责 |
| --- | --- |
| `docker-compose.yml` | 中间件 only(本地默认) |
| `docker-compose.dev.yml` | 中间件 + nginx dev |
| `docker-compose.prod.yml` | 全部应用 + 加固配置 + opt-in profile |
| `apps/blog/Dockerfile` | Next.js standalone 三阶段 |
| `apps/admin/Dockerfile` | Vite + nginx-unprivileged 双阶段 |
| `apps/server-go/Dockerfile` | Go alpine 双阶段 |
| `apps/ai-service/Dockerfile` | Python slim 单阶段 |
| `nginx/nginx.conf` | 生产网关(422 行) |
| `nginx/nginx.dev.conf` | dev 网关 → 宿主机进程(255 行) |
| `nginx/security-headers.conf` | CSP / HSTS / Permissions-Policy 共用 |
| `apps/admin/nginx.conf` | admin 容器内 SPA 路由 + API 转发 |
| `start.sh` | 一键启动(1263 行) |
| `stop.sh` | 一键停止(324 行) |
| `restart.sh` | 应用层快速重启(110 行) |
| `docker-build.sh` | 本地多平台构建 + push(445 行) |
| `docker-hub-cleanup.sh` | Docker Hub tag 批量删除 |
| `.env.example` | 根环境变量模板 |
| `apps/{blog,admin}/.env.local.example` | 前端 env 模板 |
| `.github/workflows/ci-cd.yml` | 主 CI/CD 工作流(706 行) |
| `.github/workflows/quick-build.yml` | 手动触发的紧急构建 |
| `.github/setup-secrets.sh` | gh secret set 助手 |
| `ops/bootstrap-webhook.sh` | webhook 服务一键安装(294 行) |
| `ops/webhook/webhook_server.py` | HMAC 验签的 deploy webhook(469 行) |
| `ops/webhook/deploy.sh` | 五段式部署脚本(634 行) |
| `ops/webhook/deploy-webhook.service` | systemd unit(CentOS 7 兼容) |
| `ops/webhook/aetherblog-webhook-restart.{path,service}` | 自重启 sentinel 链路 |
| `ops/release/preflight.sh` | 部署前后健康验证(257 行) |
| `ops/release/post_release_observer.sh` | AI 可观测性指标采集 |

子文档:
- `01-docker.md` — Compose / Dockerfile / 构建链路
- `02-nginx-gateway.md` — 路由 / SSE / 安全头
- `03-startup-scripts.md` — start.sh / stop.sh / restart.sh
- `04-ci-cd.md` — GitHub Actions / webhook / preflight
- `05-environment-and-config.md` — env 字段全集 / 多环境差异
- `06-ops-and-monitoring.md` — ops/ 目录 / 监控 / 备份
