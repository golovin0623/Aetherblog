# 🏗 系统架构

本文档介绍 AetherBlog 的整体架构、模块划分、技术选型及数据流转。

> 返回 [项目主页](../README.md) · 查看 [开发指南](./development.md) · 查看 [部署指南](./deployment.md)

---

## 目录

- [架构概览](#架构概览)
- [Monorepo 结构](#monorepo-结构)
- [后端架构](#后端架构)
- [AI 服务架构](#ai-服务架构)
- [前端架构](#前端架构)
- [API 设计](#api-设计)
- [数据流](#数据流)
- [技术选型](#技术选型)

---

## 架构概览

AetherBlog 采用微服务 + Monorepo 架构，由 5 个核心服务协同工作：

```
                    ┌──────────────────────────────────────────┐
                    │           Nginx Gateway (:7899)          │
                    └──────┬──────────┬──────────┬─────────────┘
                           │          │          │
                    ┌──────▼───┐ ┌────▼────┐ ┌───▼──────────┐
                    │  Blog    │ │  Admin  │ │   Backend    │
                    │ Next.js  │ │  Vite   │ │  Go (Echo)   │
                    │  :3000   │ │  :5173  │ │   :8080      │
                    └──────────┘ └────┬────┘ └──┬───────────┘
                                      │         │
                                      │    ┌────▼────────┐
                                      │    │ AI Service  │
                                      │    │  FastAPI    │
                                      │    │   :8000     │
                                      │    └──┬──────────┘
                                      │       │
                              ┌───────▼───────▼──────────┐
                              │     PostgreSQL + pgvector │
                              │          Redis           │
                              └──────────────────────────┘
```

| 服务 | 技术栈 | 职责 |
|------|--------|------|
| **Blog** | Next.js 15 + React 19 | 博客前台，SSR 渲染，SEO |
| **Admin** | Vite + React 19 | 管理后台，内容管理，AI 写作工具 |
| **Backend** | Go 1.24 (Echo) | 业务 API，认证授权，数据持久化 |
| **AI Service** | FastAPI + LiteLLM | AI 写作辅助，语义搜索，多模型路由 |
| **Gateway** | Nginx | 请求路由，静态资源代理，SSL 终止 |

---

## Monorepo 结构

项目使用 **pnpm workspace** 管理前端代码，**Go module** 管理后端代码：

```
AetherBlog/
├── apps/
│   ├── blog/                    # 📝 博客前台 (Next.js 15)
│   ├── admin/                   # ⚙️ 管理后台 (Vite + React 19)
│   ├── ai-service/              # 🤖 AI 服务 (FastAPI + LiteLLM)
│   └── server-go/               # 🔧 后端服务 (Go + Echo)
│       ├── cmd/server/           #    应用启动入口 (main.go)
│       ├── internal/api/         #    API 接口 / Handler / DTO
│       ├── internal/common/      #    公共模块
│       │   ├── core/             #    核心工具类
│       │   ├── security/         #    JWT 认证、RBAC
│       │   ├── redis/            #    Redis 缓存
│       │   └── log/              #    日志管理
│       ├── internal/service/     #    业务服务
│       │   └── blog/             #    博客核心逻辑
│       └── internal/ai/          #    AI 客户端
│           └── client/           #    AI 服务 HTTP 客户端
├── packages/
│   ├── ui/                      # 🎨 共享 UI 组件
│   ├── hooks/                   # 🪝 共享 React Hooks
│   ├── types/                   # 📋 TypeScript 类型定义
│   ├── utils/                   # 🔧 工具函数
│   └── editor/                  # ✏️ Markdown 编辑器
├── docs/                        # 📚 项目文档
├── nginx/                       # 🌐 Nginx 配置
├── ops/                         # 🔩 运维脚本
└── .github/workflows/           # 🔄 CI/CD 工作流
```

---

## 后端架构

### 模块依赖

```
cmd/server/main.go（Go 可执行入口）
    │
    ├── internal/service/blog（业务逻辑层）
    │       │
    │       ├── internal/common/*（基础设施层）
    │       │       │
    │       │       └── internal/api（接口 / Handler / DTO 层）
    │       │
    │       └── internal/ai/client（AI 服务客户端）
    │
    └── [Go 显式初始化 (Wire/手动注入)]
```

### 分层职责

| 层级 | 模块 | 职责 |
|------|------|------|
| **入口层** | `cmd/server` | main.go 启动入口、配置加载、Go main entry |
| **接口层** | `internal/api` | Handler、Request/Response DTO、枚举 |
| **业务层** | `internal/service/blog` | Handler、Service、Repository、实体 |
| **基础层** | `internal/common/*` | 安全、缓存、日志、通用工具 |
| **集成层** | `internal/ai/client` | 调用外部 AI 服务的 HTTP 客户端 |

### 核心 Handler

| Handler | 路径前缀 | 功能 |
|-----------|----------|------|
| `AuthHandler` | `/v1/auth` | 登录 / JWT 认证 |
| `PostHandler` | `/v1/admin/posts` | 文章管理 |
| `PublicPostHandler` | `/v1/public/posts` | 公开文章 API |
| `CategoryHandler` | `/v1/admin/categories` | 分类管理 |
| `TagHandler` | `/v1/admin/tags` | 标签管理 |
| `CommentHandler` | `/v1/admin/comments` | 评论管理 |
| `MediaHandler` | `/v1/admin/media` | 媒体库管理 |
| `StatsHandler` | `/v1/admin/stats` | 统计分析 |
| `AiHandler` | `/v1/admin/ai` | AI 配置 |
| `SystemMonitorHandler` | `/v1/admin/system` | 系统监控 |

---

## AI 服务架构

AI 服务作为独立微服务运行，通过 HTTP API 与后端通信：

```
┌─────────────────────────────────────────────────┐
│                  AI Service                     │
│                                                 │
│  ┌───────────┐   ┌──────────────┐              │
│  │  FastAPI   │──▶│  LLM Router  │              │
│  │  Routes    │   │  (LiteLLM)   │              │
│  └─────┬─────┘   └──────┬───────┘              │
│        │                 │                       │
│  ┌─────▼─────┐   ┌──────▼───────┐              │
│  │  Cache     │   │  Provider    │              │
│  │  (Redis)   │   │  Registry    │              │
│  └───────────┘   └──────┬───────┘              │
│                          │                       │
│                  ┌───────▼──────────┐           │
│                  │ OpenAI / DeepSeek│           │
│                  │ / 通义千问 / ...  │           │
│                  └──────────────────┘           │
│                                                 │
│  ┌───────────┐   ┌──────────────┐              │
│  │ Vector     │   │  Metrics     │              │
│  │ Store      │──▶│  Store       │              │
│  │ (pgvector) │   │  (Usage Log) │              │
│  └───────────┘   └──────────────┘              │
└─────────────────────────────────────────────────┘
```

### AI 能力

| 能力 | 端点 | 说明 |
|------|------|------|
| 内容摘要 | `/api/v1/ai/summary` | 自动生成文章摘要 |
| 标题建议 | `/api/v1/ai/titles` | 智能标题推荐 |
| 标签提取 | `/api/v1/ai/tags` | 关键词 / 标签生成 |
| 内容润色 | `/api/v1/ai/polish` | AI 文本优化 |
| 大纲生成 | `/api/v1/ai/outline` | 文章结构规划 |
| 翻译 | `/api/v1/ai/translate` | 多语言翻译 |
| 语义搜索 | `/api/v1/search/semantic` | 基于向量的内容检索 |

所有写作类端点同时支持普通响应和 SSE 流式响应（`/stream` 后缀），实现打字机效果。

---

## 前端架构

### 博客前台 (Next.js 15)

- **App Router** — 基于文件系统的路由
- **SSR / SSG** — 服务端渲染与静态生成结合
- **React 19** — 最新 React 特性
- **Rich Markdown** — Shiki 语法高亮 + KaTeX 数学公式 + Mermaid 图表

### 管理后台 (Vite + React 19)

- **SPA 架构** — 客户端渲染
- **Zustand** — 状态管理
- **React Router** — 客户端路由
- **Zod** — 表单验证
- **CodeMirror** — Markdown 编辑器核心
- **Framer Motion** — 动画交互

### 共享包

```
packages/
├── ui/       →  Button, Card, Modal, Toast, Input, ...
├── hooks/    →  useDebounce, useApi, useMediaQuery, useTheme, ...
├── types/    →  Post, User, Category, Tag, Comment, ...
├── utils/    →  cn(), formatDate(), ...
└── editor/   →  MarkdownEditor, MarkdownPreview, EditorWithPreview
```

---

## API 设计

### 路由规范

| 类型 | 前缀 | 说明 | 鉴权 |
|------|------|------|------|
| 认证 | `/v1/auth/*` | 登录 / 注册 | 否 |
| 公开 | `/v1/public/*` | 面向访客的内容 API | 否 |
| 管理 | `/v1/admin/*` | 后台管理 API | JWT |
| AI | `/api/v1/ai/*` | AI 服务代理 | JWT |

### 通用响应格式

```json
{
  "code": 200,
  "message": "success",
  "data": { ... }
}
```

---

## 数据流

### 文章发布流程

```
Admin Editor ──POST──▶ Backend API ──persist──▶ PostgreSQL
                              │
                              ├──cache──▶ Redis
                              │
                              └──index──▶ Elasticsearch (可选)
```

### AI 写作辅助流程

```
Admin Editor ──request──▶ Backend API ──proxy──▶ AI Service
                                                     │
                                                     ├── LiteLLM ──▶ LLM Provider
                                                     ├── Cache (Redis)
                                                     └── Usage Log (PostgreSQL)
                                                     │
Admin Editor ◀──SSE stream──────────────────────────┘
```

### 访客阅读流程

```
Browser ──GET──▶ Next.js (SSR) ──fetch──▶ Backend API ──query──▶ PostgreSQL
                     │
                     └── 渲染 HTML + Markdown → 返回完整页面
```

---

## 技术选型

| 领域 | 技术 | 选型理由 |
|------|------|---------|
| 博客前台 | Next.js 15 | SSR/SSG 支持，SEO 友好，App Router |
| 管理后台 | Vite + React 19 | 极速 HMR，SPA 架构适合后台 |
| 后端 | Go 1.24 + Echo | 高性能，编译型，并发原生支持 |
| AI 服务 | FastAPI + LiteLLM | 异步高性能，多模型路由，流式输出 |
| 数据库 | PostgreSQL 17 + pgvector | 关系型 + 向量检索一体化 |
| 缓存 | Redis 7 | 高性能缓存，会话管理 |
| 搜索 | Elasticsearch 8 | 全文搜索（可选） |
| 序列化 | encoding/json | Go 标准库内置支持 |
| 网关 | Nginx | 轻量高效，反向代理 |
| 容器 | Docker Compose | 一键部署，环境一致性 |
| CI/CD | GitHub Actions | 原生集成，自动构建部署 |
| Monorepo | pnpm workspace + Go module | 共享依赖，统一版本管理 |
