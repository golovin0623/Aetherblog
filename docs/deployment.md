# 🐳 部署指南

本文档涵盖 AetherBlog 的 Docker 镜像构建、生产部署、域名配置及常见运维操作。

> 返回 [项目主页](../README.md) · 查看 [开发指南](./development.md) · 查看 [架构说明](./architecture.md)

---

## 目录

- [Docker 镜像构建](#docker-镜像构建)
- [生产部署](#生产部署)
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

在服务器项目根目录下创建 `.env` 文件（参考 [`env.example`](../env.example)）：

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

---

## 相关文件

| 文件 | 说明 |
|------|------|
| [`docker-build.sh`](../docker-build.sh) | 多平台构建脚本（支持并行） |
| [`docker-compose.prod.yml`](../docker-compose.prod.yml) | 生产环境编排配置 |
| [`apps/server-go/Dockerfile`](../apps/server-go/Dockerfile) | 后端镜像（Go 后端） |
| [`apps/blog/Dockerfile`](../apps/blog/Dockerfile) | 博客前端镜像（Next.js standalone） |
| [`apps/admin/Dockerfile`](../apps/admin/Dockerfile) | 管理后台镜像（Vite + Nginx） |
| [`env.example`](../env.example) | 环境变量模板 |
| [`.github/CICD_GUIDE.md`](../.github/CICD_GUIDE.md) | CI/CD 配置指南 |
