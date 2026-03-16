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
| JDK | 25 (Early Access) |
| Docker & Docker Compose | 最新版 |
| Maven | 3.9+（或使用项目自带 `./mvnw`） |

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
cd apps/server && ./mvnw spring-boot:run -pl aetherblog-app

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

### 后端（Maven 多模块）

```bash
cd apps/server
mvn clean install              # 构建所有模块
mvn clean install -DskipTests  # 跳过测试构建
mvn spring-boot:run -pl aetherblog-app  # 启动应用
mvn test -pl blog-service      # 运行指定模块测试
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
apps/server/
├── aetherblog-app/          # 🚀 应用启动入口（可执行 JAR）
├── aetherblog-api/          # 📦 API 接口定义、DTO、VO
├── aetherblog-common/       # 🔧 公共模块（POM 聚合）
│   ├── common-core/         #    核心工具类、通用响应
│   ├── common-security/     #    JWT 认证、安全配置
│   ├── common-redis/        #    Redis 缓存配置
│   └── common-log/          #    日志管理
├── aetherblog-service/      # 💼 业务服务（POM 聚合）
│   └── blog-service/        #    博客核心业务实现
└── aetherblog-ai/           # 🤖 AI 模块（已弃用，迁移为独立服务）
    └── ai-client/           #    AI 服务 HTTP 客户端
```

| 模块 | 说明 | 打包类型 |
|------|------|----------|
| `aetherblog-app` | 应用启动入口，包含 main 方法 | JAR（可执行） |
| `aetherblog-api` | API 接口定义、DTO、VO | JAR（库） |
| `aetherblog-common` | 公共模块聚合 | POM |
| `common-core` | 核心工具类、通用响应 | JAR（库） |
| `common-security` | JWT 认证、安全配置 | JAR（库） |
| `common-redis` | Redis 缓存配置 | JAR（库） |
| `common-log` | 日志配置 | JAR（库） |
| `aetherblog-service` | 业务服务聚合 | POM |
| `blog-service` | 博客核心业务实现 | JAR（库） |

> ⚠️ **注意**: 只有 `aetherblog-app` 模块使用 `spring-boot-maven-plugin` 打包成可执行 JAR，其他模块作为库被引用，**不应该**配置此插件。

### 模块依赖关系

```
aetherblog-app（可执行 JAR 入口）
    ↓
aetherblog-service（blog-service）
    ↓
aetherblog-common（common-*）
    ↓
aetherblog-api（DTO）
```

> `common` 模块不能依赖 `service` 模块；`api` 模块不依赖其他内部模块。

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

### Maven 构建失败

```bash
cd apps/server
./mvnw clean install -DskipTests
```

### Elasticsearch 异常

如果 ES 日志出现 SIGILL / registerNatives 崩溃（Apple Silicon 常见）：

```bash
docker compose rm -sf elasticsearch
docker compose up -d elasticsearch
```
