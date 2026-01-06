# AetherBlog

> 🌟 AetherBlog - 智能博客系统，融合 AI 与现代 Web 技术

## 🛠 技术栈

| 模块 | 技术 |
|------|------|
| 博客前台 | Next.js 15 + React 19 |
| 管理后台 | Vite + React 19 |
| 后端服务 | Spring Boot 3.4 + JDK 21 |
| AI 能力 | Spring AI 1.0 |
| 数据库 | PostgreSQL 17 + pgvector |
| 缓存 | Redis 7 |
| 搜索 | Elasticsearch 8 |

## 📁 项目结构

```
AetherBlog/
├── apps/
│   ├── blog/                    # 博客前台 (Next.js)
│   ├── admin/                   # 管理后台 (Vite + React)
│   └── server/                  # 后端服务 (Spring Boot)
│       ├── aetherblog-app/      # 🚀 应用启动模块（可执行 JAR 入口）
│       ├── aetherblog-api/      # 📦 API 接口定义、DTO、VO
│       ├── aetherblog-common/   # 🔧 公共模块
│       │   ├── common-core/     #    ├─ 核心工具类
│       │   ├── common-security/ #    ├─ 安全认证
│       │   ├── common-redis/    #    ├─ Redis 缓存
│       │   └── common-log/      #    └─ 日志管理
│       ├── aetherblog-service/  # 💼 业务服务模块
│       │   └── blog-service/    #    └─ 博客核心服务
│       └── aetherblog-ai/       # 🤖 AI 模块
│           ├── ai-core/         #    ├─ AI 核心
│           ├── ai-rag/          #    ├─ RAG 检索增强
│           ├── ai-agent/        #    └─ AI Agent
│           └── ai-prompt/       #    └─ Prompt 管理
├── packages/
│   ├── ui/                      # 共享 UI 组件
│   ├── utils/                   # 工具函数
│   └── types/                   # TypeScript 类型
├── start.sh                     # 一键启动脚本
├── stop.sh                      # 一键停止脚本
└── docker-compose.yml           # 中间件服务
```

## 🚀 快速开始

### 环境要求

- Node.js >= 20
- pnpm >= 9
- JDK 21
- Docker & Docker Compose
- Maven 3.9+

### 一键启动（推荐）

```bash
# 启动所有服务（中间件 + 后端 + 前端）
./start.sh

# 停止所有服务
./stop.sh

# 停止所有服务（包括中间件）
./stop.sh --all
```

启动成功后：
- 📝 博客前台: http://localhost:3000
- ⚙️ 管理后台: http://localhost:5173
- 🔧 后端 API: http://localhost:8080/api

### 分步启动

```bash
# 1. 安装前端依赖
pnpm install

# 2. 启动数据库服务
docker compose up -d

# 3. 启动后端服务
cd apps/server && ./mvnw spring-boot:run -pl aetherblog-app

# 4. 启动管理后台
pnpm dev:admin

# 5. 启动博客前台
pnpm dev:blog
```

## ⚠️ 常见问题

### 停止脚本使用说明

```bash
# 1️⃣ 停止应用服务（保留中间件运行）
./stop.sh

# 2️⃣ 停止所有服务（包括 Docker 中间件）
./stop.sh --all

# 3️⃣ 完全清理（强制移除所有容器并释放端口）
docker compose down --remove-orphans
./stop.sh
```

> **推荐**: 开发时使用 `./stop.sh` 保留中间件，可加快下次启动速度。

### Docker 容器异常导致端口残留

**症状**: 运行 `./start.sh` 时报错 `port is already allocated`，但 `./stop.sh` 无效。

**原因**: 容器可能因系统休眠/意外关机/Docker重启而异常退出（`Exited (128)`），端口映射未被操作系统正常回收。

**快速解决**:
```bash
# 方法1: 强制清理异常容器
docker compose down --remove-orphans
./start.sh

# 方法2: 查找并杀死占用端口的进程
lsof -i :6379   # 查看 Redis 端口
lsof -i :5432   # 查看 PostgreSQL 端口
# 如果输出显示 com.docke 占用，执行方法1
```

> **提示**: `start.sh` 已优化为自动检测并清理异常退出的容器，正常情况下不会再遇到此问题。

### 端口冲突（非 Docker 原因）

如果端口被其他应用程序占用：

```bash
# 查看端口占用
lsof -i :8080   # 后端 API
lsof -i :3000   # 博客前台
lsof -i :5173   # 管理后台

# 终止占用进程
kill -9 <PID>
```

### Maven 构建问题

如果遇到依赖问题，尝试清理并重新构建：

```bash
cd apps/server
./mvnw clean install -DskipTests
```

## 🔧 后端模块说明

| 模块 | 说明 | 打包类型 |
|------|------|----------|
| `aetherblog-app` | 应用启动入口，包含 main 方法 | JAR (可执行) |
| `aetherblog-api` | API 接口定义、DTO、VO | JAR (库) |
| `aetherblog-common` | 公共模块聚合 | POM |
| `common-core` | 核心工具类、通用响应 | JAR (库) |
| `common-security` | JWT 认证、安全配置 | JAR (库) |
| `common-redis` | Redis 缓存配置 | JAR (库) |
| `common-log` | 日志配置 | JAR (库) |
| `aetherblog-service` | 业务服务聚合 | POM |
| `blog-service` | 博客核心业务实现 | JAR (库) |
| `aetherblog-ai` | AI 模块聚合 | POM |

> ⚠️ **注意**: 只有 `aetherblog-app` 模块使用 `spring-boot-maven-plugin` 打包成可执行 JAR，其他业务模块（如 `blog-service`）作为库被引用，**不应该**配置 `spring-boot-maven-plugin`。

## 🐳 Docker 生产部署

### 镜像构建

项目提供了优化的多平台构建脚本 `docker-build.sh`，支持并行构建充分利用多核 CPU。

#### 构建命令

```bash
# 并行构建并推送到 Docker Hub (推荐，利用多核 CPU)
./docker-build.sh --push --version v1.0.0

# 串行构建 (网络不稳定时)
./docker-build.sh --push --sequential --version v1.0.0

# 只构建单个镜像
./docker-build.sh --only backend --push
./docker-build.sh --only blog --push
./docker-build.sh --only admin --push

# 本地构建测试 (不推送)
./docker-build.sh --version v1.0.0

# 指定 CPU 并行度
./docker-build.sh --cores 4 --push

# 查看帮助
./docker-build.sh --help
```

#### 构建参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--push` | 推送镜像到 Docker Hub | 否 |
| `--version` | 版本标签 | `v1.0.0` |
| `--parallel` | 并行构建所有镜像 | 是 |
| `--sequential` | 串行构建 | 否 |
| `--only NAME` | 只构建指定镜像 (backend/blog/admin) | 全部 |
| `--cores N` | 指定构建并行度 | CPU 核心数 |

#### 生成的镜像

| 镜像名称 | 说明 | 大小 |
|----------|------|------|
| `golovin0623/aetherblog-backend` | Spring Boot 后端 | ~300MB |
| `golovin0623/aetherblog-blog` | Next.js 博客前台 | ~200MB |
| `golovin0623/aetherblog-admin` | Vite + Nginx 管理后台 | ~50MB |

#### 支持平台

- `linux/amd64` - 常规 x86 服务器 (CentOS, Ubuntu 等)
- `linux/arm64` - ARM 服务器、Mac M1/M2/M3

---

### 端口映射

| 服务 | 端口 | 说明 |
|------|------|------|
| 博客前台 | **7893** | Next.js SSR |
| 管理后台 | **7894** | Vite + Nginx |
| PostgreSQL | 5433 | pgvector (避免与现有5432冲突) |
| 后端 API | 内部 | 仅容器间通信 |

### 部署架构

```
用户请求
    │
    ├── :7893 → blog (Next.js)
    │              └── API代理 → backend:8080
    │
    └── :7894 → admin (Nginx)
                   └── /api 代理 → backend:8080
                   
backend:8080 ← postgres:5432 (容器内)
            ← redis:6999 (宿主机现有服务)
```

---

### 服务器部署

#### 1. 配置环境变量 (推荐)
在服务器项目根目录下创建 `.env` 文件：
```bash
cat > .env <<EOF
DOCKER_REGISTRY=golovin0623
VERSION=v1.1.0
POSTGRES_PASSWORD=aetherblog123
REDIS_HOST=host.docker.internal
REDIS_PORT=6999
REDIS_PASSWORD=你的密码  # 如果没有密码可不填
OPENAI_API_KEY=你的API_KEY
EOF
```

#### 2. 启动服务
```bash
# 拉取最新镜像
docker-compose -f docker-compose.prod.yml pull

# 启动 (后台运行)
docker-compose -f docker-compose.prod.yml up -d
```

#### 3. 访问与登录
- **博客前台**: `http://<服务器IP>:7893`
- **管理后台**: `http://<服务器IP>:7894`
- **后端 API**: `http://<服务器IP>:8080/api`

---

### 🔑 默认管理员凭据

| 用户名 | 默认密码 | 说明 |
|:---|:---|:---|
| `admin` | `admin123` | **首次登录成功后必须修改密码** |

---

### 🛠 登录故障排查

如果在服务器部署后无法使用 `admin123` 登录：

1.  **检查后端日志**：
    ```bash
    docker-compose -f docker-compose.prod.yml logs -f backend
    ```
    确认没有 Redis 或数据库连接错误。
2.  **手动重置密码**：
    如果你确信密码正确但无法登录，可以使用 Navicat 运行以下 SQL 将密码强制重置为 `123456`：
    ```sql
    UPDATE users SET password_hash = '$2a$10$8.UnVuG9HHgffUDAlk8q2OuVGkqBKkjJRqdE7z6OcExSqz8tRdByW' WHERE username = 'admin';
    ```
    重置后请尝试使用 `admin` / `123456` 登录。

---

#### 4. 查看日志
```bash
docker-compose -f docker-compose.prod.yml logs -f
```

### 常用运维命令
```bash
# 查看所有容器状态
docker-compose -f docker-compose.prod.yml ps

# 查看后端日志
docker-compose -f docker-compose.prod.yml logs -f backend

# 停止并移除容器
docker-compose -f docker-compose.prod.yml down
```

---

### 相关文件

| 文件 | 说明 |
|------|------|
| `docker-build.sh` | 多平台构建脚本 (支持并行) |
| `docker-compose.prod.yml` | 生产环境编排配置 |
| `apps/server/Dockerfile` | 后端镜像 (Spring Boot + JRE 21) |
| `apps/blog/Dockerfile` | 博客前端镜像 (Next.js standalone) |
| `apps/admin/Dockerfile` | 管理后台镜像 (Vite + Nginx) |
| `apps/admin/nginx.conf` | Nginx 配置 (含 API 代理) |
| `.env.example` | 环境变量模板 |
| `.dockerignore` | Docker 构建排除 |

### 使用现有 Redis

如果服务器已有 Redis 服务，配置 `.env`：

```bash
REDIS_HOST=host.docker.internal
REDIS_PORT=6999  # 你的 Redis 端口
```

## 📄 许可证

MIT License
