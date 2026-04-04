<div align="center">

# ✨ AetherBlog

**智能博客系统 — 融合 AI 写作辅助与现代 Web 技术**

[![CI/CD Pipeline](https://github.com/golovin0623/AetherBlog/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/golovin0623/AetherBlog/actions/workflows/ci-cd.yml)
![Go](https://img.shields.io/badge/Go-1.24-00ADD8?logo=go)
![Echo](https://img.shields.io/badge/Echo-v4-lightgrey)
![Next.js](https://img.shields.io/badge/Next.js-15-black)
![React](https://img.shields.io/badge/React-19-61dafb)
![License](https://img.shields.io/badge/License-MIT-blue)

*「Cognitive Elegance」— 以高端 SaaS 品质打造的博客体验*

</div>

---

## 🌟 项目简介

AetherBlog 是一个**全栈智能博客系统**，将 AI 能力深度融入内容创作流程。前台追求极致的阅读体验，后台提供高效的内容管理与 AI 写作工具，同时通过独立 AI 服务实现多模型路由与流式输出。

### 设计理念

- 🎨 **Cognitive Elegance** — 灵感源自 Linear、Raycast、Vercel 的设计语言
- 🌙 **暗色优先** — 丰富的光晕渐变 + 毛玻璃质感，营造沉浸阅读氛围
- 🤖 **AI 原生** — 写作辅助不是附加功能，而是内置于编辑器的核心体验
- ⚡ **现代技术栈** — 前后端均采用最新框架版本，追求极致性能

---

## ✨ 核心功能

### 📝 博客前台

- **丰富的 Markdown 渲染** — Shiki 语法高亮 + KaTeX 数学公式 + Mermaid 图表
- **全文语义搜索** — 基于 pgvector 的向量检索，超越关键词匹配
- **评论系统** — 支持嵌套回复的访客评论
- **时间线视图** — 文章时间轴浏览
- **友链页面** — 蜂巢布局的友链展示
- **主题切换** — 明暗模式无缝切换，View Transitions API 动画
- **响应式设计** — 桌面端与移动端自适应布局
- **SSR 渲染** — Next.js App Router，SEO 友好

### ⚙️ 管理后台

- **仪表盘** — 访问统计、AI 用量分析、系统状态一览
- **文章管理** — 创建、编辑、发布、归档完整生命周期
- **AI 编辑器** — 集成 AI 侧栏、Slash 命令、选中文本 AI 工具栏
- **分类与标签** — 灵活的内容组织体系
- **媒体库** — 文件夹管理 + 拖拽上传 + 图片处理
- **评论管理** — 审核、回复、批量操作
- **系统监控** — 容器状态、实时日志、性能趋势
- **数据迁移** — 支持从 VanBlog 一键导入

### 🤖 AI 写作辅助

| 能力 | 说明 |
|------|------|
| **内容摘要** | 自动提取文章核心要点 |
| **标题建议** | 智能推荐多个标题选项 |
| **标签提取** | 关键词与标签自动生成 |
| **内容润色** | AI 优化文本表达 |
| **大纲生成** | 一键生成文章结构 |
| **多语言翻译** | 文章内容翻译 |

所有 AI 能力支持 **SSE 流式输出**（打字机效果），通过独立 AI 服务实现 **多模型路由**（OpenAI / DeepSeek / 通义千问等）。

---

## 🛠 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 博客前台 | Next.js + React | 15 / 19 |
| 管理后台 | Vite + React | 6 / 19 |
| 后端服务 | **Go + Echo** | **1.24 / v4** |
| AI 服务 | FastAPI + LiteLLM | — |
| 数据库 | PostgreSQL + pgvector | 17 |
| 缓存 | Redis | 7 |
| 搜索 | Elasticsearch | 8 |
| 序列化 | encoding/json | Go 标准库 |
| 容器化 | Docker Compose | — |
| CI/CD | GitHub Actions | — |
| Monorepo | pnpm workspace | — |

---

## 📁 项目结构

```
AetherBlog/
├── apps/
│   ├── blog/              # 📝 博客前台 (Next.js 15)
│   ├── admin/             # ⚙️ 管理后台 (Vite + React 19)
│   ├── ai-service/        # 🤖 AI 服务 (FastAPI + LiteLLM)
│   └── server-go/         # 🔧 后端 API (Go 1.24 + Echo v4)
├── packages/
│   ├── ui/                # 🎨 共享 UI 组件
│   ├── hooks/             # 🪝 共享 React Hooks
│   ├── types/             # 📋 TypeScript 类型
│   ├── utils/             # 🔧 工具函数
│   └── editor/            # ✏️ Markdown 编辑器
├── docs/                  # 📚 项目文档
├── nginx/                 # 🌐 Nginx 配置
├── .github/workflows/     # 🔄 CI/CD 工作流
├── start.sh               # 一键启动
├── stop.sh                # 一键停止
└── restart.sh             # 一键重启
```

> 详细的模块依赖与分层说明请参考 [系统架构文档](./docs/architecture.md)。

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 20 · pnpm ≥ 9
- **Go 1.24+**
- Docker & Docker Compose

### 一键启动

```bash
# 克隆项目
git clone https://github.com/golovin0623/AetherBlog.git
cd AetherBlog

# 安装前端依赖
pnpm install

# 启动开发环境（含中间件）
./start.sh --with-middleware
```

启动后访问：

| 服务 | 地址 |
|------|------|
| 📝 博客前台 | http://localhost:3000 |
| ⚙️ 管理后台 | http://localhost:5173 |
| 🔧 后端 API | http://localhost:8080/api |

> 默认管理员：`admin` / `admin123`（首次登录后请修改密码）

更多启动选项和分步说明请参考 [开发指南](./docs/development.md)。

---

## 🐳 部署

```bash
# 配置环境变量
cp env.example .env
# 编辑 .env 填入实际配置

# 拉取镜像并启动
export DOCKER_REGISTRY=golovin0623
export VERSION=latest
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d
```

生产模式通过 **Nginx 网关 (:7899)** 统一路由：

| 路由 | 服务 |
|------|------|
| `/` | 博客前台 |
| `/admin` | 管理后台 |
| `/api` | 后端 API |

> 详细的 Docker 构建、域名配置、运维命令请参考 [部署指南](./docs/deployment.md)。

---

## 📚 文档导航

| 文档 | 说明 |
|------|------|
| 📖 [开发指南](./docs/development.md) | 环境搭建、构建命令、模块说明、调试技巧 |
| 🏗 [系统架构](./docs/architecture.md) | 架构概览、模块依赖、技术选型、数据流 |
| 🐳 [部署指南](./docs/deployment.md) | Docker 构建、生产部署、域名配置、运维 |
| 🔄 [CI/CD 指南](./.github/CICD_GUIDE.md) | GitHub Actions 配置、自动构建部署 |
| 📋 [更新日志](./CHANGELOG.md) | 版本发布记录与变更说明 |
| 📂 [文档中心](./docs/INDEX.md) | 全部文档索引（含设计文档、QA 报告等） |

---

## 📄 许可证

MIT License
