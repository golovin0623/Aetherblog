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

### 端口冲突

如果遇到端口被占用的错误，检查并停止占用端口的服务：

```bash
# 查看端口占用
lsof -i :8080   # 后端 API
lsof -i :5432   # PostgreSQL
lsof -i :6379   # Redis

# 停止占用端口的 Docker 容器
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep -E "8080|5432|6379"
docker stop <容器名>
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

### 快速部署

```bash
# 1. 克隆项目到服务器
git clone https://github.com/your/AetherBlog.git
cd AetherBlog

# 2. 配置环境变量
cp .env.example .env
vim .env  # 配置 OPENAI_API_KEY (可选)

# 3. 构建并启动
docker-compose -f docker-compose.prod.yml up -d --build

# 4. 查看日志
docker-compose -f docker-compose.prod.yml logs -f

# 5. 停止服务
docker-compose -f docker-compose.prod.yml down
```

### 相关文件

| 文件 | 说明 |
|------|------|
| `docker-compose.prod.yml` | 生产环境编排配置 |
| `apps/blog/Dockerfile` | 博客前端镜像 (Next.js standalone) |
| `apps/admin/Dockerfile` | 管理后台镜像 (Vite + Nginx) |
| `apps/admin/nginx.conf` | Nginx 配置 (含 API 代理) |
| `apps/server/Dockerfile` | 后端镜像 (Spring Boot) |
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
