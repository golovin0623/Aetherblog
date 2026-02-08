---
trigger: always_on
---

## 🎯 任务详情索引

### 阶段1: 项目基础架构搭建

| 任务ID | 任务名称 | 相关文档 | 产出物 | 预估时间 |
|:-------|:---------|:---------|:-------|:---------|
| 1.1 | 前端 Monorepo 初始化 | §3.1 | pnpm workspace, turbo.json | 4h |
| 1.2 | 后端 Maven 多模块初始化 | §4.1 | pom.xml, 模块结构 | 3h |
| 1.3 | 数据库初始化 | §6.1, §6.2 | SQL脚本, 初始数据 | 4h |
| 1.4 | Docker 开发环境 | §9 | docker-compose.yml | 2h |
| 1.5 | 共享配置包 | §3.1, §3.4 | packages/config | 3h |

### 阶段2: 后端核心服务开发

| 任务ID | 任务名称 | 相关文档 | 产出物 | 预估时间 |
|:-------|:---------|:---------|:-------|:---------|
| 2.1 | 公共模块开发 | §4.2 | common-core | 6h |
| 2.2 | 安全模块开发 | §4.4 | common-security | 8h |
| 2.3 | Redis 模块开发 | §4.2 | common-redis | 4h |
| 2.4 | 用户服务开发 | §4.3, §7.4 | user-service | 8h |
| 2.5 | 博客核心服务开发 | §4.3, §7.2 | blog-service | 12h |
| 2.6 | 媒体服务开发 | §4.3 | media-service | 6h |

### 阶段3: 前端基础组件开发

| 任务ID | 任务名称 | 相关文档 | 产出物 | 预估时间 |
|:-------|:---------|:---------|:-------|:---------|
| 3.1 | UI 组件库开发 | §3.2 | packages/ui | 10h |
| 3.2 | 编辑器包开发 | §3.2 | packages/editor | 8h |
| 3.3 | 共享 Hooks 开发 | §3.3 | packages/hooks | 4h |
| 3.4 | 共享工具包开发 | §3.1 | packages/utils | 3h |
| 3.5 | 类型定义包 | §3.1 | packages/types | 3h |

### 阶段4: 前端博客应用开发

| 任务ID | 任务名称 | 相关文档 | 产出物 | 预估时间 |
|:-------|:---------|:---------|:-------|:---------|
| 4.1 | 博客布局与导航 | §8.1 | Layout, Header, Footer | 6h |
| 4.2 | 首页开发 | §8.1 | HomePage, Hero, PostList | 8h |
| 4.3 | 文章详情页 | §8.1, §3.2 | PostDetail, TOC | 8h |
| 4.4 | 归档与时间树 | §3.2, §8.1 | TimeTree, Archives | 6h |
| 4.5 | 搜索功能 | §3.2, §8.1 | SearchPanel, Results | 6h |
| 4.6 | 友链与关于页 | §3.2, §8.1 | FriendCard, About | 4h |

### 阶段5: 管理后台开发

| 任务ID | 任务名称 | 相关文档 | 产出物 | 预估时间 |
|:-------|:---------|:---------|:-------|:---------|
| 5.1 | 后台布局与认证 | §8.2 | AdminLayout, Login | 6h |
| 5.2 | 仪表盘开发 | §8.2 | Dashboard, Charts | 8h |
| 5.3 | 文章管理 | §8.2, §3.2 | PostManager, Editor | 10h |
| 5.4 | 媒体库管理 | §8.2 | MediaLibrary, Upload | 6h |
| 5.5 | 分类标签管理 | §8.2 | CategoryManager, TagManager | 4h |
| 5.6 | 友链管理 | §8.2 | FriendLinkManager | 3h |
| 5.7 | 系统设置 | §8.2 | Settings, Profile | 4h |
| 5.8 | AI 配置中心 | §8.2, §5.1 | AiConfigPage, ProviderComponents | 12h |

### 阶段6: AI 服务开发

| 任务ID | 任务名称 | 相关文档 | 产出物 | 预估时间 |
|:-------|:---------|:---------|:-------|:---------|
| 6.1 | Python 服务初始化 | §5.1 | apps/ai-service, pyproject.toml | 4h |
| 6.2 | 核心功能开发 | §5.1 | LiteLLM路由, Auth中间件 | 8h |
| 6.3 | 业务 Agent 开发 | §5.1 | Agents (Summary, Tagging, Writing) | 12h |
| 6.4 | RAG 服务实现 | §5.2 | VectorStore, Retrievers | 10h |
| 6.5 | Prompt 管理服务 | §5.3 | PromptService, Templates | 4h |
| 6.6 | 前端 AI 助手集成 | §3.2, §8.3 | AiAssistant组件 (Stream) | 8h |
| 6.7 | AI 搜索集成 | §8.3 | SemanticSearch API | 6h |

### 阶段7-10: 后续阶段

*(任务详情结构同上，篇幅原因省略)*

---

## 🧭 2026-02-08 路线图增补 (v1.0.1)

### Phase 4 - AI 功能集成
- `AI-ROUTING-001` AI 服务启动稳定性修复（Python 3.9 注解兼容）
- `AI-ADMIN-002` AI 配置页图标与视觉规范统一

### Phase 5 - 优化与部署
- `OPS-STARTUP-003` 启动脚本依赖探测与健康检查鲁棒性增强
- `DOC-SYNC-004` 规则文档与设计文档同步

### CHANGELOG
- Added: `AI-ROUTING-001`, `AI-ADMIN-002`, `OPS-STARTUP-003`, `DOC-SYNC-004`
