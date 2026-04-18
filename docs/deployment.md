# 🐳 部署指南

本文档涵盖 AetherBlog 的 Docker 镜像构建、生产部署、域名配置及常见运维操作。

> 返回 [项目主页](../README.md) · 查看 [开发指南](./development.md) · 查看 [架构说明](./architecture.md)

---

## 目录

- [Docker 镜像构建](#docker-镜像构建)
- [生产部署](#生产部署)
- [CI/CD 自动化发布链路](#cicd-自动化发布链路)
- [容器安全加固](#容器安全加固)
- [域名配置](#域名配置)
- [运维命令](#运维命令)
- [故障排查](#故障排查)

---

## Docker 镜像构建

项目提供了优化的多平台构建脚本 `docker-build.sh`，支持并行构建充分利用多核 CPU。

### 特性

- ⚡ **并行构建** — 同时构建 backend / blog / admin 三个镜像
- 📡 **实时进度** — 每个镜像完成后立即通知，可提前在服务器拉取
- 🔐 **密码加密** — 登录密码 AES 加密传输
- 🌐 **多平台** — 支持 amd64 和 arm64 架构

### 构建命令

```bash
# 并行构建并推送到 Docker Hub（推荐）
./docker-build.sh --push --version v1.1.1

# 串行构建（网络不稳定时）
./docker-build.sh --push --sequential --version v1.1.1

# 只构建单个镜像
./docker-build.sh --only backend --push
./docker-build.sh --only blog --push
./docker-build.sh --only admin --push

# 本地构建测试（不推送）
./docker-build.sh --version v1.1.1

# 指定 CPU 并行度
./docker-build.sh --cores 4 --push

# 查看帮助
./docker-build.sh --help
```

### 构建参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--push` | 推送镜像到 Docker Hub | 否 |
| `--version` | 版本标签 | `v1.0.0` |
| `--all` | 构建全平台镜像 (amd64 + arm64) | 否（仅 amd64） |
| `--parallel` | 并行构建所有镜像 | 是 |
| `--sequential` | 串行构建 | 否 |
| `--only NAME` | 只构建指定镜像 (backend/blog/admin) | 全部 |
| `--cores N` | 指定构建并行度 | CPU 核心数 |

### 生成的镜像

| 镜像名称 | 说明 | 大小 |
|----------|------|------|
| `golovin0623/aetherblog-backend` | Go 后端（静态编译） | ~20-30 MB |
| `golovin0623/aetherblog-ai-service` | Python AI 服务 | ~200 MB |
| `golovin0623/aetherblog-blog` | Next.js 博客前台 | ~200 MB |
| `golovin0623/aetherblog-admin` | Vite + Nginx 管理后台 | ~50 MB |

### 支持平台

- **默认**: `linux/amd64` — 常规 x86 服务器 (CentOS, Ubuntu 等)
- **--all**: `linux/amd64` + `linux/arm64` — 同时支持 ARM 服务器、Mac M1/M2/M3

---

## 生产部署

### 1. 配置环境变量

在服务器项目根目录下创建 `.env` 文件（参考 [`.env.example`](../.env.example)，所有必填项均为空占位，须填入真实值后才能启动）：

```bash
cat > .env <<EOF
# 端口配置
GATEWAY_PORT=7899
BLOG_PORT=7893
ADMIN_PORT=7894
POSTGRES_PORT=7895

# 数据库
POSTGRES_PASSWORD=aetherblog123

# Redis（使用现有服务）
REDIS_HOST=host.docker.internal
REDIS_PORT=6379

# JWT 认证
JWT_SECRET=换成随机长字符串

# AI 功能
OPENAI_API_KEY=你的API_KEY
OPENAI_BASE_URL=https://api.openai.com/v1
AI_MOCK_MODE=false

# Docker 镜像（CI/CD 或手动部署时使用）
DOCKER_REGISTRY=golovin0623
VERSION=latest
EOF
```

### 2. 配置 Webhook 自动部署

参考 [CI/CD 配置指南](../.github/CICD_GUIDE.md#webhook-部署配置服务器端) 完成 webhook 安装，实现 git push 后自动增量部署。

### 3. 启动服务

```bash
# 首次全量启动
export DOCKER_REGISTRY=golovin0623
export VERSION=latest
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

# 日常重启应用（不动中间件，推荐）
./restart.sh

# 只重启后端
./restart.sh backend

# 拉取最新镜像后重启
./restart.sh --pull
```

### 3. 配置域名

参考下方 [域名配置](#域名配置) 章节，将域名代理到网关端口 (7899)。

### 4. 访问与登录

- **博客前台**: `https://yourdomain.com/`
- **管理后台**: `https://yourdomain.com/admin`
- **后端 API**: `https://yourdomain.com/api`

### 端口映射

| 服务 | 端口 | 环境变量 | 说明 |
|------|------|----------|------|
| **统一网关** | **7899** | `GATEWAY_PORT` | ⭐ 推荐使用，自动路由所有请求 |
| 博客前台 | 7893 | `BLOG_PORT` | 可选，直接访问 |
| 管理后台 | 7894 | `ADMIN_PORT` | 可选，直接访问 |
| PostgreSQL | 7895 | `POSTGRES_PORT` | pgvector 数据库 |
| 后端 API | 内部 | — | 仅容器间通信 |

### 容器资源限制

生产环境各服务的内存限制（`docker-compose.prod.yml` 中配置）：

| 服务 | 内存限制 | 说明 |
|------|----------|------|
| gateway | 64M | Nginx 网关，轻量 |
| backend | 128M | Go 后端，静态编译低内存 |
| ai-service | 768M | Python AI 服务，依赖较重 |
| blog | 512M | Next.js SSR 前台 |
| admin | 128M | Vite + Nginx 静态管理后台 |

### 部署架构

```
                     ┌──────────────────────────────────────────────┐
                     │           统一网关 (:7899)                    │
                     │           Nginx Gateway                      │
                     └──┬──────────┬──────────┬──────────┬──────────┘
                        │          │          │          │
           /            │  /admin/ │  /api/   │/api/v1/  │
                        │          │  (Go)    │  ai/*    │
           ▼            │          ▼          ▼          ▼
   ┌───────────────┐    │  ┌────────────┐ ┌──────────┐ ┌──────────────┐
   │  blog:3000    │    │  │ admin:80   │ │backend   │ │ ai-service   │
   │  (Next.js)    │◄───┘  │ (SPA)      │ │ :8080    │ │   :8000      │
   └───────────────┘       └────────────┘ │ (Go)     │ │ (FastAPI)    │
                                          └────┬─────┘ └──────────────┘
                                               │
                                    ┌──────────┴──────────┐
                                    ▼                     ▼
                              postgres:5432          redis:6379
                              (pgvector)             (容器内)
```

### 使用现有 Redis

如果服务器已有 Redis 服务，配置 `.env`：

```bash
REDIS_HOST=host.docker.internal
REDIS_PORT=6999  # 你的 Redis 端口
```

---

## CI/CD 自动化发布链路

从 `git push` 到生产生效的**全链路由五个阶段**组成，服务器端**无需人工介入**：

```
① GitHub Actions (ci-cd.yml)
      │ build & push multi-arch images
      ▼
② HMAC-SHA256 签名 POST /deploy
      │ payload: {ref, sha, mode, services, version}
      ▼
③ 服务器 webhook_server.py  (ops/webhook/)
      │ 校验签名 → fork deploy.sh → 返回 202
      ▼
④ deploy.sh  (ops/webhook/)
      ├─ flock 独占锁  (/var/lock/aetherblog-deploy.lock)
      ├─ git fetch + reset --hard FETCH_HEAD   ← 自动拉取最新代码
      ├─ self-reexec  (deploy.sh 本身被更新时)
      ├─ 严格 KEY=VALUE 解析 .env  (NOT `source`, NOT IFS='=')
      ├─ docker compose pull
      ├─ pre-deploy migration  (一次性容器 `compose run --rm migrate up`)
      └─ docker compose up -d   (支持 full / incremental / canary / rollback 四模式)
      ▼
⑤ ops/release/preflight.sh
      ├─ static 校验  (compose config, 必备命令)
      └─ runtime 校验  (12 项：服务 running、migration 版本、gateway 健康、
                        ai-service 健康 ≤ ~120s 重试窗口、auth 生效、
                        ai_providers/ai_models 计数、backend 日志纯净)
```

失败时 preflight 阻断发布 (`exit 1`)，webhook 返回 5xx；所有步骤日志追加到 `/var/log/aetherblog-deploy.log`。

### 关键安全与可靠性设计

| 点 | 位置 | 规避的坑 |
|---|---|---|
| HMAC-SHA256 签名校验 | `webhook_server.py` | 防止未授权触发发布 |
| `flock` 独占锁 | `deploy.sh:30-33` | 两次 push 并发触发时串行化，避免 compose up 撞车 |
| `git reset --hard FETCH_HEAD` | `deploy.sh:68` | 配置漂移 (#459 admin 镜像升 8080 但 compose 还映射 80) 自动修复 |
| deploy.sh self-reexec | `deploy.sh:70-75` | 同一次发布中脚本自身被更新时，新版本立即接管剩余流程 |
| 严格 `.env` 解析器 | `deploy.sh:95-117` | **VULN-133** 不 `source` 防命令注入；**同时**用 `${line%%=*}` / `${line#*=}` 而非 `IFS='='`，避免 bash IFS 机制吞掉尾随 `=`（对 `AI_CREDENTIAL_ENCRYPTION_KEYS=...k=` 这类 base64 padding 值是致命的） |
| pre-deploy migration | `deploy.sh:155-195` | 旧版 backend 启动后再 migrate 会 SELECT 不存在的表 (FTL)；改为一次性容器 |
| preflight 冷启动重试 | `preflight.sh:125-144` | ai-service 首次拉起 litellm/asyncpg/pgvector + asyncpg.create_pool + jwt_keys 首拉 DB，慢机可超过 60s — 24 次 × 5s = ~120s，允许 docker inspect health=healthy 或容器内 curl 任一成立 |
| `unset MIN_AI_*` | `deploy.sh:126` | 历史 `.env` 残留过紧阈值卡发布；仓库 `preflight.sh` 是单一真源 |

### 部署模式

| 模式 | 调用方式 | 触发场景 |
|---|---|---|
| `full` | `DEPLOY_MODE=full` (默认) | 首次发布 / 需要重拉所有镜像 |
| `incremental` | `DEPLOY_MODE=incremental DEPLOY_SERVICES="backend ai-service"` | 只改了部分服务；中间件 (postgres/redis) 不重启 |
| `canary` | `DEPLOY_MODE=canary CANARY_SERVICES=backend,ai-service` | 金丝雀，先升核心服务观察 |
| `rollback` | `DEPLOY_MODE=rollback ROLLBACK_VERSION=v1.1.0` | 紧急回滚到指定版本 |

前端-only 的 incremental 部署会跳过 migration，节省 20~40s。

### 手动触发 deploy.sh

调试或一次性发布时可直接在服务器执行：

```bash
cd /root/Aetherblog
SKIP_GIT_SYNC=true ./ops/webhook/deploy.sh          # 不拉代码，只重新发起 compose up
DEPLOY_MODE=incremental DEPLOY_SERVICES="ai-service" ./ops/webhook/deploy.sh
DEPLOY_MODE=rollback ROLLBACK_VERSION=v1.1.1 ./ops/webhook/deploy.sh
```

webhook systemd 单元文件见 `ops/webhook/deploy-webhook.service`，部署与认证令牌设置详见 `.github/CICD_GUIDE.md`。

---

## 容器安全加固

生产 `docker-compose.prod.yml` 对每个应用容器启用以下运行时约束（**VULN-123**）：

| 约束 | 配置 | 作用 |
|---|---|---|
| 权限提升阻断 | `security_opt: [no-new-privileges:true]` | setuid 二进制也无法提权 |
| Capability 剥离 | `cap_drop: [ALL]` + 按需 `cap_add` | gateway 仅保留 `CHOWN/SETUID/SETGID/NET_BIND_SERVICE`，backend/ai-service 全部剥离 |
| 只读根文件系统 | `read_only: true` | 漏洞被利用后无法落地持久化二进制 |
| 临时目录 tmpfs | `tmpfs: /tmp` 等 | 容器仍能写 /tmp / /var/cache/nginx 等工作目录，但这些不落盘 |
| Redis 认证 | `--requirepass ${REDIS_PASSWORD}` (**VULN-119**) | 移除历史 `sh -c` 条件 fallback，空密码启动被禁 |
| Redis CLI 健康检查 | `REDISCLI_AUTH=` (**VULN-147**) | 不再通过 `-a` 让密码出现在 `ps auxf` |
| JWT_SECRET 必填 | `${JWT_SECRET:?...}` (**VULN-120**) | compose 直接在变量替换层 fail-fast，无静默空 |
| AI 凭证加密密钥 | `${AI_CREDENTIAL_ENCRYPTION_KEYS:?...}` (**VULN-056**) | 与 `JWT_SECRET` 解耦，支持 MultiFernet 多 key 零停机轮换；**新版允许末尾缺失 '=' padding**，config.py 的 `_pad_b64url` 自动补齐 |
| ai-service healthcheck | `start_period: 45s, interval: 10s` | Python 冷启动窗口 ≤ 45s 不计 retries，部署 preflight 不会误判 docker=starting |
| backend healthcheck | `start_period: 30s, interval: 3s` (**VULN-150**) | 避免把 crash loop 识别为 "healthy yet" |

### Docker socket 访问的权衡

`backend` 以只读方式挂载 `/var/run/docker.sock:ro` 给 `/v1/admin/monitor/*` 做容器列表与 stats 查询。**注意**：`:ro` 只阻止写套接字文件本身，Docker API 仍具备 root 等效能力。自托管且只有 admin JWT 能命中该接口是当前可接受的妥协；加固部署应改用 `tecnativa/docker-socket-proxy` 将 API 限制到 `/containers/json` + `/containers/*/stats`。

宿主 docker 组 GID 通常不是容器里默认的 999，必须通过 `.env` 的 `DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)` 显式对齐，否则 UID 1001 无法读套接字。

---

## 域名配置

### 方式一：Nginx Proxy Manager（推荐）

如果您使用 [Nginx Proxy Manager](https://nginxproxymanager.com/)，配置非常简单：

#### 1. 添加 Proxy Host

| 字段 | 值 |
|------|-----|
| **Domain Names** | `yourdomain.com` |
| **Scheme** | `http` |
| **Forward Hostname/IP** | `127.0.0.1` 或服务器内网 IP |
| **Forward Port** | `7899` |

#### 2. 勾选选项

- ✅ **Websockets Support** ← AI 实时对话必需
- ✅ **Block Common Exploits**

#### 3. Advanced 配置

在 "Custom Nginx Configuration" 中添加（支持大文件上传和 AI 长连接）：

```nginx
# 大文件上传支持（图片/视频）
client_max_body_size 500M;

# AI 长连接超时（多轮对话/工具调用）
proxy_read_timeout 600s;
proxy_send_timeout 600s;

# SSE 流式响应（AI 实时输出）
proxy_buffering off;
```

### 方式二：手动配置 Nginx

如果您使用标准 Nginx，添加以下配置：

```nginx
server {
    listen 80;
    server_name yourdomain.com;  # 替换为您的域名

    location / {
        proxy_pass http://127.0.0.1:7899;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 支持（AI 实时对话）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 大文件上传（图片/视频）
        client_max_body_size 500M;

        # AI 长连接超时
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;

        # SSE 流式响应
        proxy_buffering off;
    }
}
```

然后重载配置：

```bash
sudo nginx -t && sudo nginx -s reload
```

---

## 运维命令

```bash
# 快速重启应用（不动中间件，推荐）
./restart.sh

# 只重启指定服务
./restart.sh backend
./restart.sh blog admin

# 拉新镜像后重启
./restart.sh --pull

# 查看所有容器状态
docker compose -f docker-compose.prod.yml ps

# 查看后端日志
docker compose -f docker-compose.prod.yml logs -f backend

# 查看全部日志
docker compose -f docker-compose.prod.yml logs -f

# 停止并移除容器
docker compose -f docker-compose.prod.yml down
```

### 默认管理员凭据

| 用户名 | 默认密码 | 说明 |
|:---|:---|:---|
| `admin` | `admin123` | **首次登录成功后必须修改密码** |

### 登录故障排查

如果在服务器部署后无法使用 `admin123` 登录：

1. **检查后端日志**：
   ```bash
   docker-compose -f docker-compose.prod.yml logs -f backend
   ```
   确认没有 Redis 或数据库连接错误。

2. **手动重置密码**：
   如果确信密码正确但无法登录，运行以下 SQL 将密码重置为 `123456`：
   ```sql
   UPDATE users SET password_hash = '$2a$10$8.UnVuG9HHgffUDAlk8q2OuVGkqBKkjJRqdE7z6OcExSqz8tRdByW' WHERE username = 'admin';
   ```

---

## 故障排查

### Docker 容器异常导致端口残留

**症状**: 运行 `./start.sh` 时报错 `port is already allocated`，但 `./stop.sh` 无效。

**原因**: 容器可能因系统休眠/意外关机/Docker 重启而异常退出，端口映射未被操作系统正常回收。

**快速解决**:

```bash
# 方法 1：强制清理异常容器
docker compose down --remove-orphans
./start.sh

# 方法 2：查找并杀死占用端口的进程
lsof -i :6379   # 查看 Redis 端口
lsof -i :5432   # 查看 PostgreSQL 端口
```

> **提示**: `start.sh` 已优化为自动检测并清理异常退出的容器，正常情况下不会再遇到此问题。

### 端口冲突（非 Docker 原因）

```bash
# 查看端口占用
lsof -i :8080   # 后端 API
lsof -i :3000   # 博客前台
lsof -i :5173   # 管理后台

# 终止占用进程
kill -9 <PID>
```

### Go 构建问题

如果遇到编译问题：

```bash
cd apps/server-go
go clean -cache
go build ./...
```

### ai-service 启动即挂 / preflight 卡在 `docker health=starting`

**症状**：CI preflight 循环输出 `[FAIL] [api] ai-service health check failed (docker health=starting); last error: curl: (7) Failed to connect to localhost port 8000`。进入容器看 uvicorn 根本没有 bind 端口。

**排障入口**：

```bash
docker logs aetherblog-ai-service --tail 200
```

常见根因（按出现频率）：

| 错误片段 | 根因 | 修复 |
|---|---|---|
| `ValueError: Invalid Fernet key in AI_CREDENTIAL_ENCRYPTION_KEYS: ... length=43, expected 32 bytes base64url` | `.env` 里 44 字符密钥尾部 `=` 被 deploy.sh 旧 `IFS='='` 解析器吞掉；或密钥被 shell / CI / 模板引擎二次 strip | (1) `git pull` 获取新版 `deploy.sh` 严格解析器；(2) 最新 `config.py._pad_b64url` 已经能自动补齐 padding，pull 最新镜像或重新构建即可；(3) 确认 `.env` 原值带 `=` |
| `ValidationError: AI_CREDENTIAL_ENCRYPTION_KEYS is required` | env 根本没注入；或 webhook systemd 单元未加载 `.env` | 检查 `deploy-webhook.service` 的 `EnvironmentFile=`，以及 deploy.sh 输出 `Loading env from .../.env (strict parser)` 是否出现 |
| `asyncpg.exceptions.*` / `connection refused` | postgres 还没 ready 就被依赖；或 `POSTGRES_DSN` 配错 | 检查 compose `depends_on: postgres: condition: service_healthy`；检查 DSN 用户名/密码特殊字符是否做了 URL-encode |
| uvicorn 正常启动但 preflight 仍失败 | 冷启动 > preflight 重试窗口 | 确认仓库 `preflight.sh` 已升级到 24 次 × 5s (~120s)，同时 compose `start_period: 45s` |

**永久防御**：三层都已落地
1. `deploy.sh` 严格 `KEY=VALUE` 解析器，不再吞 `=`；
2. `apps/ai-service/app/core/config.py._pad_b64url` 自动补齐缺失的 base64url `=` padding，已有 DB 加密凭证的解密一致性不受影响；
3. `ops/release/preflight.sh` 扩大重试窗口并以 `docker inspect` 健康状态作为兜底判活信号。

### 健康探活日志刷屏

**症状**：`docker logs aetherblog-backend` 每 3 秒出现一条 `GET /api/actuator/health 200` INFO 日志，业务日志被淹没。

**根因**：Docker healthcheck + SystemMonitor 巡检以 3~10s 周期轮询 `/api/actuator/health`、`/api/v1/admin/system/health`、`/api/v1/admin/system/metrics`，旧版 `trace` 中间件对所有 2xx 请求打 INFO 级。

**修复（已落地 `apps/server-go/internal/middleware/trace.go`）**：
- 引入 `isHealthProbePath()` 判定健康探活 / liveness 路径（固定三条 + `/health`、`/ready` 后缀兜底）；
- 探活成功（2xx 3xx）降级为 `Debug`，4xx/5xx 仍按 `Warn/Error` 正常走告警。

> 若自建新巡检路径，请统一以 `/health` / `/ready` 结尾命名，自动沾降级规则。

---

## 相关文件

| 文件 | 说明 |
|------|------|
| [`docker-build.sh`](../docker-build.sh) | 多平台构建脚本（支持并行） |
| [`docker-compose.prod.yml`](../docker-compose.prod.yml) | 生产环境编排配置 |
| [`apps/server-go/Dockerfile`](../apps/server-go/Dockerfile) | 后端镜像（Go 后端） |
| [`apps/blog/Dockerfile`](../apps/blog/Dockerfile) | 博客前端镜像（Next.js standalone） |
| [`apps/admin/Dockerfile`](../apps/admin/Dockerfile) | 管理后台镜像（Vite + Nginx） |
| [`.env.example`](../.env.example) | 环境变量模板（所有密钥为空占位） |
| [`.github/CICD_GUIDE.md`](../.github/CICD_GUIDE.md) | CI/CD 配置指南 |
