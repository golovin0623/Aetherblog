# 01 - Docker / Compose / 镜像构建

> 范围:三个 compose 文件的差异、四个 app 的 Dockerfile、镜像分层策略、数据卷、健康检查、`docker-build.sh` 构建链路。

---

## 1. 三个 Compose 文件的角色矩阵

| 文件 | 路径 | 行数 | 启用场景 | 启用方式 |
| --- | --- | --- | --- | --- |
| 默认中间件 only | `docker-compose.yml` | 45 | `./start.sh` 直连模式 | `docker compose up -d` |
| Dev gateway | `docker-compose.dev.yml` | 75 | `./start.sh --gateway` | `docker compose -f docker-compose.dev.yml up -d` |
| 生产全栈 | `docker-compose.prod.yml` | 467 | 生产 / `./start.sh --prod` | `docker compose -f docker-compose.prod.yml up -d` |

### 1.1 `docker-compose.yml`(根目录,本地默认)

只装 **postgres + redis**(`docker-compose.yml:1-46`)。被 `start.sh` 在 `--with-middleware` 或 `--prod` 模式下加载;直连模式不会启动这个 compose,中间件由用户手动起。

特征:
- `postgres:5432` / `redis:6379` 都是 `127.0.0.1:` 绑定
- PostgreSQL / Redis 凭据应由本地 `.env` 显式提供;历史开发兜底值不应复制到文档或生产配置
- 命名网络 `aetherblog-network`,**显式指定 `name: aetherblog_aetherblog-network`** 与 prod 不冲突
- 数据卷 `postgres_data` / `redis_data`(无前缀)

### 1.2 `docker-compose.dev.yml`(本地网关 dev)

在中间件之上加一个 **nginx:alpine 容器**(`docker-compose.dev.yml:59-71`):
- `extra_hosts: "host.docker.internal:host-gateway"` 让网关容器解析到宿主机 IP
- 挂载 `./nginx/nginx.dev.conf:/etc/nginx/conf.d/default.conf:ro`
- `${GATEWAY_PORT:-7899}:80`

中间件配置同根 compose,但有几处加固调整:
- `docker-compose.dev.yml:20` `POSTGRES_PASSWORD: ${DB_PASSWORD:?DB_PASSWORD env var is required}` — 不再带兜底默认值,强制 `.env` 显式声明(VULN-118)
- `docker-compose.dev.yml:43` redis 同样 `${REDIS_PASSWORD:?...}` 必填(VULN-118/119)
- `docker-compose.dev.yml:25,46` 端口绑定到 `0.0.0.0`(VULN-122 dev 回退,允许局域网真机调试)
- 数据卷改名 `aetherblog_postgres_data` / `aetherblog_redis_data`,与生产一致

### 1.3 `docker-compose.prod.yml`(生产全栈)

`name: aetherblog`(`docker-compose.prod.yml:24`),所有资源前缀统一。

服务列表:

| 服务 | 镜像 | 容器名 | 端口暴露 | 健康检查 |
| --- | --- | --- | --- | --- |
| `gateway` | nginx:alpine | aetherblog-gateway | `7899:80` | `wget /health` 30s |
| `postgres` | pgvector/pgvector:pg17 | aetherblog-postgres | `7895:5432` | `pg_isready` 3s |
| `redis` | redis:7.2-alpine(profile: with-redis) | aetherblog-redis | `6379:6379` | `redis-cli ping` 10s |
| `docker-socket-proxy` | tecnativa/docker-socket-proxy:0.3.0(profile: with-monitor) | aetherblog-docker-socket-proxy | 仅 `expose: 2375` | — |
| `backend` | `${REGISTRY}/aetherblog-backend:${VERSION}` | aetherblog-backend | 仅 `expose: 8080` | `/app/server -health` 3s,start_period 30s |
| `ai-service` | `${REGISTRY}/aetherblog-ai-service:${VERSION}` | aetherblog-ai-service | 仅 `expose: 8000` | `curl /health` 10s,start_period 45s |
| `blog` | `${REGISTRY}/aetherblog-blog:${VERSION}` | aetherblog-blog | `7893:3000` | image 内 `wget` 30s |
| `admin` | `${REGISTRY}/aetherblog-admin:${VERSION}` | aetherblog-admin | `7894:8080` | image 内 `wget` 30s |

**Profile 机制**:
- `--profile with-redis`(`docker-compose.prod.yml:123-124`) 启用内置 Redis;不带 profile 时假定外部 Redis(由 `.env` 中 `REDIS_HOST` 指向)
- `--profile with-monitor` 启用 docker-socket-proxy 让 admin "容器监控" 面板可用;不开时面板显示 "Docker API 不可用"(预期行为)

**强制必填变量**(`docker-compose.prod.yml:88,120,247,249,321,325,327,341`):
- `POSTGRES_PASSWORD:?` — VULN-117
- `REDIS_PASSWORD:?` — VULN-119
- `JWT_SECRET:?...min 32 chars` — VULN-120
- `AI_INTERNAL_SERVICE_TOKEN:?` — backend ↔ ai-service 服务间认证
- `AI_CREDENTIAL_ENCRYPTION_KEYS:?` — VULN-056 Provider Key 加密

任一缺失,`docker compose config --quiet` 即失败,CI 在 `config-validate` job(`.github/workflows/ci-cd.yml:218-273`)直接红。

---

## 2. 容器加固模板(prod)

所有应用服务套用同一份(`docker-compose.prod.yml:48-75,274-297,354-380`):

```yaml
security_opt:
  - no-new-privileges:true   # VULN-123 禁止权限提升
cap_drop:
  - ALL                      # 默认零 capability
cap_add:                     # 仅按需放行(gateway 需要 NET_BIND_SERVICE 绑 :80)
  - NET_BIND_SERVICE
read_only: true              # 根文件系统只读
tmpfs:
  - /tmp:rw,size=64M,mode=1777
deploy:
  resources:
    limits:
      memory: 768M
    reservations:
      memory: 256M
```

### 2.1 各服务的 cap_add 细节

| 服务 | cap_add | 原因 |
| --- | --- | --- |
| gateway | CHOWN + SETUID + SETGID + NET_BIND_SERVICE | nginx master 启动时 chown / 切到非特权 worker,以及绑 80 |
| docker-socket-proxy | CHOWN + SETUID + SETGID | haproxy drop privileges |
| backend | (无,完全 drop) | 二进制只写 /app/uploads(named volume) + /app/logs + /tmp |
| ai-service | (无,完全 drop) | Python 只写 /tmp + /app/logs |
| blog / admin | (默认 cap_drop 无,prod 配 read_only=false) | Next.js standalone / nginx 静态资源,无网络绑特权端口 |

### 2.2 健康检查的 `start_period` 调优历史

- **VULN-150 修复**:backend `start_period: 30s`(`docker-compose.prod.yml:291`)。早期 1s,会让崩溃循环看起来 "暂时还健康",explicit 30s 给 Go 进程真正起来的时间。
- **ai-service start_period: 45s**(`docker-compose.prod.yml:371`):Python 导入 litellm/asyncpg/pgvector + FastAPI lifespan 里 `asyncpg.create_pool(min_size=1)` 首连 + `jwt_keys.start_refresher` 首次 DB 拉取,慢机上可超 30s。`interval: 10s`(从 30s 缩),让进程真正起来后能更快翻 healthy。

### 2.3 Docker socket 安全

历史上 backend 通过 bind mount `/var/run/docker.sock:ro` 实现 admin 容器监控面板。**已移除**(`docker-compose.prod.yml:266-268` 的注释):`:ro` 仍授予宿主 root 等价权限。改为 `tecnativa/docker-socket-proxy` 代理(`docker-compose.prod.yml:160-214`),环境变量白名单到只允许 `GET /containers/json` + `GET /containers/*/stats`,杜绝 `exec/start/stop`。

---

## 3. 各 app 的 Dockerfile

### 3.1 `apps/server-go/Dockerfile`(45 行,双阶段)

```
Stage 1: golang:1.24-alpine AS builder
  WORKDIR /app
  COPY go.mod go.sum
  RUN go mod download
  COPY .
  RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o server ./cmd/server
  RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o migrate ./cmd/migrate

Stage 2: alpine:3.21 (运行时)
  apk add ca-certificates tzdata
  mkdir -p /app/{uploads,logs,migrations}
  COPY --from=builder /app/{server,migrate,config.yaml,migrations}
  addgroup/adduser appuser:1001
  chown -R appuser:appgroup /app
  chmod 0775 /app/logs        ← 与 ai-service 共享 named volume
  USER appuser
  HEALTHCHECK CMD ["/app/server", "-health"]
  ENTRYPOINT ["/app/server"]
```

关键点:
- `apps/server-go/Dockerfile:34-35` 用 UID/GID 1001,与 ai-service 一致 → 共享 `aetherblog_logs` 卷无 chmod 冲突
- `apps/server-go/Dockerfile:35` `chmod 0775 /app/logs` 让 group 也可写,允许 ai-service 容器写日志(它的主组可能因 `group_add` 不同)
- 选 `alpine:3.21` 而非 `scratch`:需要 ca-certificates + tzdata + shell 跑 healthcheck
- 镜像目标 `<30 MB`(注释,实际未量化测试)

### 3.2 `apps/ai-service/Dockerfile`(29 行,单阶段)

```
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt
apt install curl     ← healthcheck 需要
pip install -r requirements.txt
COPY apps/ai-service/app ./app
mkdir /app/logs + addgroup/adduser appuser:1001
chmod 0775 /app/logs
USER appuser
CMD uvicorn app.main:app --host 0.0.0.0 --port 8000
```

关键点:
- 单阶段:`pip install` 在最终 image 里,体积约 700MB(litellm 重)
- `apps/ai-service/Dockerfile:19-23` UID/GID **必须** 1001,与 backend 共享 `aetherblog_logs` 卷
- 没有 image 内 HEALTHCHECK(由 compose `healthcheck` 接管,`docker-compose.prod.yml:364-374`)

### 3.3 `apps/blog/Dockerfile`(80 行,三阶段 multi-platform)

```
Stage 1: deps (BUILDPLATFORM)
  pnpm install --frozen-lockfile
  COPY pnpm 工作区文件 + apps/blog/package.json
  --mount=type=cache,target=/root/.local/share/pnpm/store

Stage 2: builder (BUILDPLATFORM)
  COPY --from=deps /app/node_modules
  COPY .
  ARG NEXT_PUBLIC_API_URL=/api
  ARG NEXT_PUBLIC_ADMIN_URL=/admin/
  --mount=type=cache,target=/app/apps/blog/.next/cache
  pnpm --filter @aetherblog/blog build

Stage 3: runner (TARGETPLATFORM, node:20-alpine)
  USER nextjs:1001
  COPY --from=builder /app/apps/blog/{public, .next/standalone, .next/static}
  ENV NODE_OPTIONS="--max-old-space-size=512"
  HEALTHCHECK wget :3000
  CMD ["node", "apps/blog/server.js"]
```

关键点:
- Stage 1+2 用 `--platform=$BUILDPLATFORM` 在 build host 原生架构编译,Stage 3 才用 target 架构 → 避免 emulated arm64 build 慢
- `apps/blog/Dockerfile:39` `NEXT_PUBLIC_API_URL=/api` **写死相对路径**(VULN-144):防止把 `http://backend:8080` 烤进客户端 bundle 暴露内部拓扑
- Next.js standalone 模式:`/app/apps/blog/.next/standalone/server.js` 自带 minimal node_modules,不需要全量 node_modules
- `--max-old-space-size=512` 防止容器 OOM

### 3.4 `apps/admin/Dockerfile`(60 行,双阶段)

```
Stage 1: builder (node:20-alpine)
  pnpm install --frozen-lockfile
  ENV NODE_OPTIONS="--max-old-space-size=4096"
  pnpm --filter @aetherblog/admin build

Stage 2: runner (nginxinc/nginx-unprivileged:alpine)
  USER root  (临时切换以删除默认 conf 与 chown)
  rm /etc/nginx/conf.d/default.conf
  COPY apps/admin/nginx.conf
  COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html
  chown -R nginx:nginx /usr/share/nginx/html
  USER nginx
  EXPOSE 8080            ← 非特权,所以是 8080 不是 80
  HEALTHCHECK wget :8080
  CMD ["nginx", "-g", "daemon off;"]
```

关键点:
- `apps/admin/Dockerfile:37` 用 `nginxinc/nginx-unprivileged` 替代官方 `nginx`(VULN-124):master 进程不跑 root → 限制容器逃逸危害
- builder 阶段设置 `NODE_OPTIONS="--max-old-space-size=4096"`:Admin Vite bundle 体量增长后,GitHub buildx / Docker builder 的 Node 默认 heap 容易在 `pnpm --filter @aetherblog/admin build` 时 OOM。这个环境变量只影响构建阶段,runner 仍是 nginx 静态站点。
- 暴露 8080 而非 80:非特权 nginx 不能绑 <1024
- `apps/admin/nginx.conf:26` SPA CSP 与 gateway `nginx.conf:39` 的 CSP 必须一致,任何修改要同步两处(注释里 explicit warn)

---

## 4. 镜像分层 / 缓存策略

### 4.1 Dockerfile 端

| 镜像 | 缓存 mount 数量 | 缓存内容 |
| --- | --- | --- |
| backend | 0 | go mod cache 走 layer 缓存 |
| ai-service | 0 | pip cache 走 layer 缓存 |
| blog | 2 | pnpm store + Next.js .next/cache |
| admin | 1 | pnpm store |

### 4.2 CI / docker-build.sh 端

GitHub Actions(`.github/workflows/ci-cd.yml:451-457` 等)双缓存:
- `cache-from: type=gha,scope=<service>` — GitHub Actions 跨 workflow 缓存
- `cache-from: type=registry,ref=...:buildcache` — 每个镜像有专门的 `buildcache` tag,防止 GHA 缓存过期(7d 自动清)失忆

`docker-build.sh:204-209` 本地构建:
- `--build-arg BUILDKIT_INLINE_CACHE=1` 让镜像自带缓存元数据
- `--cache-from type=registry,ref=...:cache` 复用上次推到 Hub 的缓存

### 4.3 `docker-build.sh` 模式

```bash
./docker-build.sh                    # 本地构建 4 个镜像,默认 --parallel(4 个并行 buildx)
./docker-build.sh --push             # 构建 + 推 docker.io
./docker-build.sh --version v1.2.0   # 打 v1.2.0 + latest 双 tag
./docker-build.sh --all              # multi-arch (linux/amd64+arm64)
./docker-build.sh --only backend     # 只构建一个
./docker-build.sh --sequential       # 串行(网络不稳)
./docker-build.sh --cores 8          # 自定义 buildkit 并行度
```

并行构建实现(`docker-build.sh:228-341`):
- 每个镜像 spawn 后台 subshell + 写状态文件 `/tmp/aetherblog-status-<name>`
- 父进程 polling 状态文件,实时打印完成情况
- 任一失败 `failed++`,最后非零退出

### 4.4 Multi-arch 限制

- `docker-build.sh:191-194`:`--all`(amd64+arm64)与 `--load` 互斥,buildx 只能在 push 时支持 multi-arch
- 默认 `linux/amd64`(注释 "CentOS 7 服务器"),Mac M1/M2 dev 用户想本地测要加 `--all`

---

## 5. 数据卷

| 卷名(prod) | 挂载点 | 说明 |
| --- | --- | --- |
| `aetherblog_postgres_data` | postgres:/var/lib/postgresql/data | PGDATA;**首次初始化后 POSTGRES_PASSWORD 锁定**,改 .env 无效 |
| `aetherblog_redis_data` | redis:/data | AOF 持久化(`--appendonly yes`) |
| `aetherblog_uploads` | backend:/app/uploads | 用户上传(若不切外部对象存储) |
| `aetherblog_logs` | backend + ai-service:/app/logs | 共享日志,UID 1001 + GID 1001 同 owner |

`docker-compose.yml`(根)卷名是 `postgres_data` / `redis_data`(无前缀),与 prod 不同。两个 compose **不能同时跑** —— 端口冲突 + 卷名分叉。

---

## 6. 健康检查汇总

| 服务 | 配置 | 文件位置 | 备注 |
| --- | --- | --- | --- |
| postgres | `pg_isready -U aetherblog -d aetherblog` 3s | `docker-compose.prod.yml:99-102` | `start_period` 默认 |
| redis | `REDISCLI_AUTH=$REDIS_PASSWORD redis-cli ping` 10s | `docker-compose.prod.yml:135` | VULN-147 用 env 而非 `-a` 防 ps 泄露 |
| gateway | `wget --spider /health` 30s | `docker-compose.prod.yml:65-68` | nginx 自身 location /health |
| backend | `/app/server -health` 3s,start_period 30s | `docker-compose.prod.yml:285-291` | -health flag 是 Go 二进制内部模式 |
| ai-service | `curl /health` 10s,start_period 45s | `docker-compose.prod.yml:365-374` | start_period 反复调过(VULN-150 教训) |
| blog | image HEALTHCHECK `wget` 30s | `apps/blog/Dockerfile:77-78` | compose 不再覆盖 |
| admin | image HEALTHCHECK `wget` 30s | `apps/admin/Dockerfile:57-58` | 同上 |

---

## 7. 已知限制

1. **多 ssh 部署不支持**:`docker-compose.prod.yml` 假定 single host,backend 数据卷未抽到外部存储,横向扩需要 NFS / 外部对象存储。
2. **`apps/ai-service/Dockerfile`** 没多阶段 + 没 `.dockerignore` 隔离,镜像 ~700MB,build 慢且占 registry 容量。
3. **`docker-build.sh`** REGISTRY 默认硬编码 `golovin0623`(`docker-build.sh:33`),fork 用户必须传 env 或改源码。
4. **`docker-hub-cleanup.sh:10`** 缺 `aetherblog-ai-service`,跑了会留 ai-service 镜像。
5. **`apps/blog/Dockerfile:34` `COPY . .`** 把整个 repo 拷进 builder,虽然 `.dockerignore` 排除 node_modules / .next,但 `.claude/`、`docs/` 等仍进 layer,任意文档改动都让 builder layer 失效。建议改成 `COPY apps/blog ./apps/blog && COPY packages ./packages && COPY pnpm-*.yaml package.json ./`。
6. **prod compose 仍 `expose` 业务端口到宿主机**(blog:7893 / admin:7894 / pg:7895),VULN-122 dev/prod 双向回退,要求 host 防火墙兜底。
7. **`with-redis` profile 的 redis 与外部 Redis 互斥** —— `.env` 里 `REDIS_HOST` 指向哪边没有静态校验,运维容易误开 profile 又指外部 host 导致内置 redis 永远没流量。
