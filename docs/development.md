# 🛠 开发指南

本文档涵盖 AetherBlog 的本地开发环境搭建、构建命令、模块说明及调试技巧。

> 返回 [项目主页](../README.md) · 查看 [架构说明](./architecture.md) · 查看 [部署指南](./deployment.md)

---

## 目录

- [环境要求](#环境要求)
- [一键启动](#一键启动)
- [分步启动](#分步启动)
- [常用命令](#常用命令)
- [后端模块说明](#后端模块说明)
- [前端共享包](#前端共享包)
- [移动端调试](#移动端调试)
- [常见问题](#常见问题)

---

## 环境要求

| 工具 | 版本 |
|------|------|
| Node.js | ≥ 20 |
| pnpm | ≥ 9 |
| Go | 1.24 |
| Docker & Docker Compose | 最新版 |

---

## 一键启动

```bash
# 开发模式 - 直接访问各端口
./start.sh

# 开发模式 + 启动中间件 (PostgreSQL / Redis / Elasticsearch)
./start.sh --with-middleware

# 如果 Elasticsearch 反复重启，可先跳过（当前版本不强依赖 ES）
./start.sh --with-middleware --skip-elasticsearch

# 网关模式 - 统一入口 + 保留热更新（适合移动端调试）
./start.sh --gateway

# 生产模式 - 启动网关统一入口 (:7899)
./start.sh --prod

# 停止应用服务（保留中间件）
./stop.sh

# 停止所有服务（包括中间件）
./stop.sh --all
```

### 开发模式访问地址

| 服务 | 地址 |
|------|------|
| 📝 博客前台 | http://localhost:3000 |
| ⚙️ 管理后台 | http://localhost:5173 |
| 🔧 后端 API | http://localhost:8080/api |

### 生产/网关模式统一入口

| 路由 | 地址 |
|------|------|
| 🌐 统一入口 | http://localhost:7899 |
| `/` | → 博客前台 |
| `/admin` | → 管理后台 |
| `/api` | → 后端 API |

---

## 分步启动

如果不使用一键脚本，可以手动按顺序启动各服务：

```bash
# 1. 安装前端依赖
pnpm install

# 2. 启动数据库服务
docker compose up -d
# 如果 Elasticsearch 启动异常，可先跳过：
#   docker compose up -d postgres redis

# 3. 启动后端服务
cd apps/server-go && go run ./cmd/server

# 4. 启动管理后台
pnpm dev:admin

# 5. 启动博客前台
pnpm dev:blog
```

---

## 常用命令

### 前端（pnpm workspace）

```bash
pnpm install          # 安装所有依赖
pnpm dev:blog         # 启动博客前台 (Next.js, :3000)
pnpm dev:admin        # 启动管理后台 (Vite, :5173)
pnpm dev              # 别名，等同于 dev:admin
pnpm build            # 构建所有包
pnpm build:blog       # 仅构建博客
pnpm build:admin      # 仅构建管理后台
pnpm lint             # 全部代码检查
pnpm clean            # 清理所有 node_modules 和构建产物
```

### 后端（Go）

```bash
cd apps/server-go
go build ./...                 # 构建所有包
go run ./cmd/server            # 启动应用
go test ./... -v               # 运行所有测试
go test ./internal/service/... -v # 运行指定模块测试
```

### AI 服务（Python FastAPI）

```bash
cd apps/ai-service
pip install -r requirements-dev.txt
pytest                         # 运行测试
uvicorn app.main:app --reload  # 启动开发服务器
```

### Docker 中间件

```bash
docker compose up -d       # 启动 PostgreSQL / Redis
docker compose logs -f     # 查看日志
docker compose down        # 停止
```

---

## 后端模块说明

```
apps/server-go/
├── cmd/
│   ├── server/              # 🚀 应用启动入口（main.go）
│   └── migrate/             # 🗃 数据库迁移工具
├── internal/
│   ├── config/              # ⚙️ 配置加载与管理
│   ├── handler/             # 🌐 HTTP 请求处理器（24 个模块）
│   ├── service/             # 💼 业务逻辑层
│   ├── repository/          # 🗄 数据访问层（数据库操作）
│   ├── model/               # 📦 数据模型定义
│   ├── dto/                 # 📋 请求/响应 DTO 结构
│   ├── middleware/          # 🔐 中间件（JWT、CORS、限流）
│   ├── server/              # 🔧 HTTP 服务器初始化与路由注册
│   └── pkg/                 # 🛠 内部公共工具包
│       ├── ctxutil/         #    上下文工具
│       ├── pagination/      #    分页处理
│       ├── response/        #    统一响应结构
│       ├── imgproc/         #    图片处理
│       ├── storage/         #    文件存储
│       └── jwtutil/         #    JWT 工具
├── migrations/              # 📄 SQL 迁移文件（000001–000032）
├── go.mod                   #    Go 模块依赖管理
└── go.sum
```

| 目录 | 说明 |
|------|------|
| `cmd/server` | 应用启动入口，包含 main 函数 |
| `cmd/migrate` | 独立的数据库迁移工具 |
| `internal/config` | 配置管理（koanf） |
| `internal/handler` | HTTP 请求处理器，每个业务模块一个文件（24 个） |
| `internal/service` | 业务逻辑层，调用 repository |
| `internal/repository` | 数据访问层（sqlx） |
| `internal/model` | 数据库实体模型 |
| `internal/dto` | 请求/响应数据传输对象 |
| `internal/middleware` | HTTP 中间件（JWT 认证、CORS、限流等） |
| `internal/server` | HTTP 服务器初始化与路由注册 |
| `internal/pkg` | 内部公共工具（分页、响应格式、JWT、日志、Redis） |
| `migrations/` | 顺序编号 SQL 迁移文件（000001–000028） |

> ⚠️ **注意**: `internal/` 下的所有包仅限项目内部使用（Go 语言访问控制）。

---

## 前端共享包

本项目使用 pnpm workspace 管理共享前端包，位于 `packages/` 目录。

| 包名 | 路径 | 说明 |
|------|------|------|
| `@aetherblog/ui` | `packages/ui` | 共享 UI 组件（Button、Card、Modal、Toast 等） |
| `@aetherblog/hooks` | `packages/hooks` | 共享 React Hooks（useDebounce、useApi 等） |
| `@aetherblog/types` | `packages/types` | 共享 TypeScript 类型定义 |
| `@aetherblog/utils` | `packages/utils` | 工具函数（cn、formatDate 等） |
| `@aetherblog/editor` | `packages/editor` | Markdown 编辑器组件（CodeMirror） |

### 使用方式

```typescript
import { Button, Card } from '@aetherblog/ui';
import { useDebounce } from '@aetherblog/hooks';
import type { Post } from '@aetherblog/types';
import { cn } from '@aetherblog/utils';
```

> **重要**: 每个 `packages/*` 子目录必须在自己的 `package.json` 中声明所有依赖，依赖不会从根目录或其他包继承。

---

## 移动端调试

手机与 Mac 在同一 Wi-Fi 下，通过局域网 IP 访问本地开发服务器。

### 推荐方式：网关模式

```bash
./start.sh --gateway
```

手机浏览器访问 `http://<Mac IP>:7899`：
- `/` → 博客前台
- `/admin/` → 管理后台
- `/api` → 后端 API

### 备选方式：直连端口

```bash
cd apps/blog && npm run dev -- -p 3000           # 博客
cd apps/admin && npm run dev -- --host 0.0.0.0   # 管理后台（Vite 须加 --host）
```

### 远程调试

- **iOS Safari**: Mac Safari → 开发 → 选择设备
- **Android Chrome**: Mac Chrome → `chrome://inspect`

---

## 常见问题

### 停止脚本使用说明

```bash
./stop.sh          # 停止应用服务（保留中间件）
./stop.sh --all    # 停止所有服务（包括 Docker 中间件）

# 完全清理（强制移除所有容器并释放端口）
docker compose down --remove-orphans
./stop.sh
```

> **推荐**: 开发时使用 `./stop.sh` 保留中间件，可加快下次启动速度。

### 前端包解析错误

如果出现 `Failed to resolve import`：

1. 检查依赖是否在对应 `package.json` 中声明
2. 添加缺失依赖
3. 运行 `pnpm install`

### Go 构建失败

```bash
cd apps/server-go
go clean -cache          # 清理构建缓存
go mod tidy              # 整理依赖
go build ./...           # 重新构建
```

### Elasticsearch 异常

如果 ES 日志出现 SIGILL / registerNatives 崩溃（Apple Silicon 常见）：

```bash
docker compose rm -sf elasticsearch
docker compose up -d elasticsearch
```
