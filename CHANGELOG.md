# Changelog

All notable changes to AetherBlog will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] — AI 工具箱输出承接链路修复

### 🐛 修复 (Fixes)

#### AI 工具箱「输出 → 承接」断链
- **问题背景**：此前 `AIToolsPage` 的所有工具（summary / tags / titles / outline / polish / translate）无论输出形态都以 `<MarkdownPreview>` 渲染，tags / titles 的数组结构被抹平成字符串；结果区只有「复制到剪贴板」一个按钮，无法直接应用到文章；翻译的 targetLanguage / 润色的 tone / 大纲的 depth 等参数均硬编码在 `AIToolsWorkspace.tsx` 中无法调节。
- **修复方案**：
  - **Python (`apps/ai-service/app/api/routes/ai.py`)**：在 `_stream_with_think_detection` 中累积非 `isThink` 文本，在收到 `done` 事件之前追加一个结构化 `{"type":"result","data":{...}}` SSE 事件，payload 与对应的非 stream 响应 DTO 完全同形（`SummaryData` / `TagsData` / `TitlesData` / `PolishData` / `OutlineData` / `TranslateData`）。
  - 新增鲁棒的 `_parse_tags()` / `_parse_titles()` 解析器，支持 JSON 数组、编号列表、多种分隔符与 Unicode 引号。
  - **`apps/admin/src/hooks/useStreamResponse.ts`**：扩展 `StreamEvent` 支持 `result` 分支，新增 `result: StreamResult` 返回字段，前端优先消费结构化 payload、失败才回落到原始 `streamContent`。
  - **`apps/admin/src/hooks/useAiToolTarget.ts`** (新增)：封装"目标文章"概念，localStorage 持久化 targetPostId，提供 `applySummary` / `applyTitle` / `applyTags` (含标签解析/自动创建/合并) / `applyContent` (append / replace 两种模式) 等 action。
  - **`apps/admin/src/components/ai/results/ToolResultRenderer.tsx`** (新增)：分发式渲染——tags 渲染为多选 chips + 「追加到文章标签」按钮；titles 渲染为单选列表 + 「设为文章标题」按钮；summary 渲染 Markdown + 「设为文章摘要」按钮；polish / translate 渲染 Markdown + ConfirmModal 护栏下的「替换正文」按钮；outline 渲染 Markdown + 「追加到末尾 / 替换正文」双操作。所有工具保留「复制」作为无 target 时的 fallback。
  - **`apps/admin/src/components/ai/ToolParamsPanel.tsx`** (新增) + `useToolParams` hook：每个工具独立参数面板（translate 目标语言下拉、polish tone 选项、outline depth/style、tags maxTags、titles maxTitles、summary maxLength），localStorage 按工具 key 持久化。
  - **`apps/admin/src/components/ai/AIToolsWorkspace.tsx`**：移除所有硬编码参数，使用 `useToolParams(selectedTool.id)`；结果渲染切换为 `<ToolResultRenderer>`（preview 模式）+ 原始文本（code 模式）；头部新增「参数」折叠按钮、「导入正文」按钮（从目标文章读取 content 填入 textarea）、目标文章下拉选择器。
  - **`apps/admin/src/pages/AIToolsPage.tsx`**：顶层调用 `useAiToolTarget()`，`target` 作为 prop 下传；支持 `?tool=<code>&postId=<id>` URL 参数深链（CreatePostPage 日后可携带当前文章 ID 跳转）。
- **Python Prompt 渲染健壮性 (`apps/ai-service/app/services/llm_router.py`)**：替换 `str.format(**kwargs)` 为基于 token 的 `_safe_format` 函数，只替换已知键的 `{name}` 占位符，用户内容中的 `{}` / JSON / 代码块将原样保留，不再因为代码片段出现 `KeyError`。

### 📄 架构 / 数据流变更

- SSE 协议新增终稿事件：`data: {"type":"result","data":<StructuredPayload>}\n\n`，在 `done` 事件之前发送。旧的消费者无感知——前端忽略未知类型事件。
- Go 代理层 (`apps/server-go/internal/handler/ai_handler.go`) 无需改动：`/stream` 端点只做逐行 SSE 透传，结构化事件随着原字节流直接到达前端。

### 🧹 清理与完整化（同批次补丢）

- **AiWritingWorkspacePage**（`apps/admin/src/pages/posts/AiWritingWorkspacePage.tsx`）：
  - 移除 mock 的 `expand` 工具（代码里直接返回 `selectedText + '[AI 扩写的内容...]'`，前端给出"完成"提示但后端根本没有对应端点）。
  - 移除 `tone: '专业'` 与 `aiModel: 'gpt-4'` 硬编码；polish 调用现在从 `loadToolParams('polish')` 读取 ToolParamsPanel 共享的 localStorage，summary 同理读取 `maxLength`。
  - 未知工具分支返回明确的 toast 错误，避免静默失败覆盖原文。
- **CreatePostPage**（`apps/admin/src/pages/posts/CreatePostPage.tsx`）：顶部工具栏新增「工具箱」按钮，携带当前 postId 深链到 `/ai-tools?tool=summary&postId=<id>`，打开 AIToolsPage 后目标文章会自动锁定，配合「导入正文」即可把当前正文带入测试区。新文章（postId === null）隐藏按钮避免混淆。
- **Go DTO 幽灵字段清理**（`apps/server-go/internal/dto/ai.go`）：删除 `SummaryRequest.Model / Style`、`TagsRequest.Model`、`TitlesRequest.Count / Style / Model`、`PolishRequest.PolishType / Style / Model`、`OutlineRequest.Model` 等 Python Pydantic schema 从未存在的兼容别名；保留 `ModelID` + `ProviderCode`。文件头部新增注释说明 Go 侧 DTO 只作声明文档用途、handler 通过 `proxySyncPost` 透传字节流。
- **PolishData.changes 字段删除**（`apps/ai-service/app/schemas/ai.py`、`apps/admin/src/services/aiService.ts`、`apps/admin/src/pages/posts/components/AiToolbar.tsx`）：历史上声明但从未写入的"变更说明"字段彻底移除；`AiToolbar.handlePolishContent` 不再读取 `res.data.changes`。新增代码注释说明"若未来需要 diff/变更说明，请通过独立端点 `/api/v1/ai/polish/diff` 提供"。
- **Embedding 等非文本生成类任务自动过滤**（`apps/admin/src/pages/AIToolsPage.tsx`）：`fetchAllData` 对 `aiProviderService.listTasks()` 的结果按 `model_type` 过滤——只保留 `chat / reasoning / completion / code`，把 `embedding / tts / stt` 等类型挡在 AI 工具箱外（这些任务产生的是向量/音频，没有"应用到文章"语义，误导用户）。日后这些应由「索引管理 / RAG 配置」模块单独呈现。
- **新增 `apps/ai-service/tests/test_ai_routes.py`**：41 个单元测试覆盖：
  - `_parse_tags` / `_parse_titles` / `_split_list` 的所有解析分支（JSON 数组、编号列表、Unicode 智能引号、中文分隔符、`#hashtag` 前缀）。
  - `_build_stream_result_payload` 对 6 种 task_type 的输出形状（含 empty fallback 与未知 task_type 的 `None` 返回）。
  - 6 个非 stream 业务端点（`summary / tags / titles / polish / outline / translate`）的端到端 shape 契约，包括「PolishData 不再暴露 `changes` 属性」的回归测试。
  - `_stream_with_think_detection` 的三个关键行为：`result` 事件在 `done` 之前发送、`isThink` 内容不污染 result、缺少显式 `done` 时仍自动补齐 result+done。
  - `LlmRouter._safe_format` 的七个 Phase 4.1 回归：用户内容含 `{}` 代码块、未知占位符原样保留、缺少闭合大括号、`None` 值替换、等等。
- **Token 解析器鲁棒性加强**（`apps/ai-service/app/api/routes/ai.py`）：新增 `_strip_token` 辅助函数，`_OUTER_STRIP` 扩展为 `_QUOTE_STRIP + "[]【】《》"`，即使 LLM 返回用智能引号包裹的伪 JSON（`[\u201ctag1\u201d, \u201ctag2\u201d]`）也能被 fallback 路径正确清洗。

### 📄 文档

- `docs/architecture.md` 更新 AI SSE 协议节，记录 `result` 事件格式。
- `CLAUDE.md` AI 服务能力节补充「stream 端点的结构化终稿」说明。

---

## [v0.0.3] — 2026-04-04

> 持续开发阶段，包含 AI 能力全面升级、媒体库深度优化（Phase 1–6）、博客前台功能增强及多项基础设施改进。

### ✨ 新功能 (Features)

#### AI 配置与工具中心 (`apps/admin`)
- **AI 配置中心** (`ai-config`)：三栏式界面，统一管理 AI 供应商、模型与凭证；集成 `@lobehub/icons` v4.1.0 展示品牌图标
- **AI 工具中心** (`ai-tools`)：7 个专项工具页面——内容重写 (ContentRewriter)、QA 生成 (QA)、SEO 优化 (SeoOptimizer)、摘要 (Summary)、标签提取 (Tagger)、文本清理 (TextCleaner)，统一入口 `AIToolsPage`
- **斜杠命令菜单** (`SlashCommandMenu`)：文章编辑器内输入 `/` 触发快捷命令浮层
- **文本选中 AI 工具条** (`SelectionAiToolbar`)：选中文本后浮现 AI 操作快捷工具
- **提示块类型选择器** (`AlertBlockDropdownButton`)：编辑器工具栏支持快速插入 Note/Warning/Error 提示块
- **迁移工具页** (`MigrationPage`)：Vanblog 数据一键导入管理界面

#### 媒体库深度优化 Phase 1–5 (`apps/admin`)
- **文件夹层级管理**：无限嵌套（最大 10 层），物化路径 O(1) 查询，拖拽移动，面包屑导航，统计缓存，颜色/图标自定义
- **智能标签系统**：多标签关联，标签自动补全，批量打标签，使用统计，标签来源追踪（MANUAL/AI_AUTO/AI_SUGGESTED）
- **云存储与 CDN**：存储抽象层（策略+工厂模式），支持 LOCAL/S3/MinIO 多后端，`StorageProviderSettings` 配置页，连接测试
- **图像处理**：`ImageEditor` 组件支持裁剪/旋转/缩放，多尺寸缩略图自动生成（THUMBNAIL/SMALL/MEDIUM/LARGE），EXIF 元数据提取，Blurhash 占位符
- **协作与权限**：5 级 ACL 权限系统（VIEW/UPLOAD/EDIT/DELETE/ADMIN），UUID 分享令牌+密码加密+过期控制，`VersionHistory` 版本历史查看与一键恢复，`ShareDialog` 分享链接管理

#### 媒体库深度优化 Phase 6 (`apps/admin`)
- **虚拟滚动** (`VirtualMediaGrid`)：超过 100 项自动启用 `react-window` 虚拟滚动，DOM 节点减少 98%，滚动帧率稳定 60 fps
- **骨架屏加载** (`MediaSkeleton`)：网格/列表/文件夹树三态骨架屏，CLS 降为 0，消除内容跳动
- **键盘快捷键** (`useMediaKeyboardShortcuts`)：7 个标准快捷键（上传/新建/全选/删除/搜索/取消/帮助），跨平台支持（Ctrl/⌘）

#### 博客前台 (`apps/blog`)
- **AlertBlock 提示块**：支持 Note / Warning / Error 三种类型的富文本提示块渲染，含 `remarkAlertBlock` remark 插件
- **ViewModeToggle**：文章列表视图切换控件
- **VisitTracker**：客户端访问量追踪组件

#### 活动事件与 AI 使用分析
- **活动事件系统**：新增 `activity_events` 表，支持 post/comment/user/system/friend/media/ai 七类事件实时追踪；Admin 活动面板 (`activities/`)
- **AI 使用日志增强**：记录 task_type、provider_code、model_id、total_tokens、estimated_cost，支持精细化成本分析

---

### 🗄️ 数据库变更 (Database Migrations)

| 迁移编号 | 说明 |
|---------|------|
| `000015` | ai_vector_store：向量存储表，启用 pgvector |
| `000016` | ai_usage_logs：AI 使用日志基础表 |
| `000017` | ai_providers：AI 供应商基础表（模型、类型、状态） |
| `000018` | 更新基础模型标识（gpt-5） |
| `000019` | 预置 AI 任务类型种子数据 |
| `000020` | 回填旧 AI Schema：新增 ai_credentials、ai_task_types、ai_task_routing 表；扩展 ai_providers 表（display_name/api_type/base_url/icon/priority/capabilities） |
| `000021` | 修正 AI 模型类型约束，扩展支持 12 种类型 |
| `000022` | 新增 activity_events 表（7 类事件分类，GIN 索引） |
| `000023` | 增强 ai_usage_logs：新增 task_type/provider_code/model_id 字段 |
| `000024` | 修复 AI 使用回填逻辑及字段长度约束 |
| `000025` | 规范化 ai_usage_logs：新增 total_tokens/estimated_cost 字段 |
| `000026` | 预置主流 AI 供应商配置（OpenAI/Anthropic/Google/Azure/DeepSeek 等） |
| `000027` | posts 表新增 Vanblog 迁移字段（is_hidden/source_key/legacy_author_name/legacy_visited_count/legacy_copyright） |
| `000028` | 数据库支持 preserve_updated_at 会话变量，保留原始 updated_at 时间戳 |

---

### 🤖 AI 服务增强 (`apps/ai-service`)

- **独立 AI 服务架构**（FastAPI + LiteLLM）：从 Spring AI 嵌入式方案迁移到独立 Python 服务，零耦合主后端
- **流式响应支持**：summary/tags/titles/polish/outline/translate 全端点新增 `+stream` 流式版本（NDJSON 打字机效果）
- **凭证管理端点**：创建、列出、解密（`/providers/credentials/:id/reveal`）、删除凭证
- **远程模型同步**：`/providers/:code/models/remote` 从供应商 API 拉取最新模型列表
- **模型批量操作**：batch-toggle（批量启用/禁用）、sort（排序）
- **供应商批量操作**：batch-toggle 批量启用/禁用
- **JWT 鉴权中间件**：支持 Go 后端签发的 Token 验证
- **Redis 多维限流**：用户级 + 全局级频率限制，内容哈希响应缓存

---

### 🏗️ 基础设施 (Infrastructure)

- **Nginx 特殊路由**：`/api/v1/ai/*` 路径设置 600s 超时 + SSE 流式支持（禁用缓冲）
- **Docker 资源限制**：精细化各服务内存上限配置

---

### 📦 依赖升级 (Dependencies)

| 组件 | 变更前 | 变更后 |
|------|--------|--------|
| Go | 1.24 | **1.24.1** |
| Vite | 5.x | **6.0.6** |
| Next.js | 15.x | **15.1.3** |
| zod | 3.x | **4.3.5** |
| @lobehub/icons | — | **4.1.0**（新增） |
| react-window | — | **1.8.10**（新增） |
| react-hotkeys-hook | — | **4.5.1**（新增） |
| react-image-crop | — | **10.x**（新增） |
| @dnd-kit/core | — | **6.x**（新增） |

---

## [v0.0.2] — 2026-03-30

> **⚠️ 重大重构版本** — 后端从 Java Spring Boot 全面迁移至 Go (Echo + sqlx + go-redis)。
> 此版本标志着 AetherBlog 进入全新的技术演进阶段，同时带来大量 UI/UX、无障碍与性能优化。

### 💥 破坏性变更 (Breaking Changes)

- **后端运行时从 JVM 切换至 Go**：原 `apps/server`（Spring Boot 4.0 / JDK 25）已被 `apps/server-go`（Go 1.24 / Echo v4）完全替代。
- 部署方式变更：Go 二进制直接运行，无需 JDK 环境；Docker 镜像体积大幅缩小。
- 配置文件格式保持兼容，但部分环境变量前缀调整为 `AETHERBLOG_*`（详见 `apps/server-go/config.yaml`）。

---

### 🚀 核心重构 (Core Refactoring)

#### 后端 Go 重构 (`apps/server-go`)
- **框架迁移**：Spring Boot → Echo v4（高性能、低内存占用 HTTP 框架）
- **数据库访问**：Hibernate/JPA → sqlx（原生 SQL + 结构映射，避免 N+1 问题）
- **缓存层**：Spring Cache → go-redis v9
- **JWT 认证**：Spring Security → golang-jwt/v5
- **配置管理**：Spring Config → koanf（支持 YAML 文件 + 环境变量双源加载）
- **日志**：SLF4J/Logback → zerolog（结构化 JSON 日志，零分配设计）
- **数据库迁移**：Flyway → golang-migrate/v4
- **图片处理**：Java ImageIO → disintegration/imaging
- **对象存储**：Spring S3 → aws-sdk-go-v2/s3
- **输入验证**：Bean Validation → go-playground/validator v10
- **项目结构**：标准 Go 分层架构（`cmd/` + `internal/{handler,service,repository,model,dto,middleware,pkg}`）

#### CI/CD 增量部署
- 新增 `restart.sh` 快速重启脚本，支持只重启单个服务
- CI 流水线支持增量部署：仅重建变更的服务镜像，减少 70%+ 构建时长
- Webhook 部署服务支持 `PYTHON_PATH` 环境变量自定义 Python 解释器路径
- 修复 `deploy.sh` 使用 `tee` 确保 Webhook 能捕获部署输出
- 修复 Python 3.6 兼容性（`subprocess` API 回退）

---

### ✨ 新功能 (Features)

#### 博客前台 (`apps/blog`)
- **移动端底部上滑导航**：Chrome 风格磁吸手势，RAF 节流 + 被动事件监听，零卡顿滚动体验
- **iOS PWA 原生体验**：修复 iOS 独立模式下的渲染闪烁，完善 Safe Area 适配
- **Apple Photos 风格媒体轮播**：触摸滑动 + 电影胶片缩略图，支持键盘导航
- **衬线/书法字体排版**：文章详情页标签与时间线页采用高质感衬线字体
- **视差滚动优化**：首页 Hero 视差效果平滑度与协调性大幅提升

#### 管理后台 (`apps/admin`)
- **容器监控升级**：改用 Docker Socket API 采集实时 CPU/内存数据，取代轮询式抓取
- **VanBlog 数据迁移**：迁移端点新增速率限制（Rate Limit），防止大批量导入压垮服务
- **仪表盘数据精度**：趋势百分比限制为 1 位小数，消除过长小数显示问题

---

### 🎨 UI/UX 改进

- **Hero 按钮重设计**：暗色模式下采用毛玻璃（Glass-morphism）效果替代实色按钮
- **评论区配色修复**：统一使用主题变量，消除硬编码 Indigo 颜色
- **文章上下篇导航**：修正"上一篇"/"下一篇"方向逻辑与移动端布局
- **媒体库预览优化**：缩略图条自动滚动 + 修复移动端裁切问题
- **容器监控图标对齐**：容器类型与图标映射关系全面梳理
- **移动端统计卡片**：修复错位与内容溢出问题
- **时间线折叠动画**：年份分组折叠/展开增加流畅过渡动画
- **移动端菜单右边距**：修复因 `scrollbar-gutter` 导致的右侧空隙

---

### ♿ 无障碍优化 (Accessibility)

- 全站交互元素补全 `focus-visible` 焦点环（BlogHeader、MobileMenu、编辑器工具栏等）
- `ArticleFloatingActions` 补全 ARIA 属性，修正 `aria-live` 配置
- `ThemeToggle` 下拉菜单键盘导航优化
- `FriendsList` 视图切换按钮无障碍属性补全
- 编辑器工具栏焦点状态与 ARIA 属性完善
- SearchPanel 焦点样式修复

---

### ⚡ 性能优化 (Performance)

- `ScrollToTop` 组件使用 `React.memo` 避免不必要的重渲染
- AI 工具栏文本选择事件使用 `requestAnimationFrame` 节流
- 字体字重精简至 400+700，减少字体文件加载体积
- 时间线页使用 `isPending`（TanStack Query v5）替代 `isLoading`，修复并发渲染边界
- 博客 Hero 按钮改用 `<Link>` 组件，增加 `/posts` 路由骨架屏，实现即时导航感知

---

### 🐛 Bug 修复 (Bug Fixes)

- 修复文章详情页加载动画双重淡入导致的闪烁（PageTransition 嵌套冲突）
- 修复环境变量解析时字段名下划线被错误替换的问题
- 修复 SearchPanel focus 样式在测试中 import 路径不规范问题
- 修复代码评审发现的若干边界 Bug（2 处服务层逻辑错误）
- 修复容器监控筛选器下拉框与主内容区重叠问题

---

### 📚 文档更新

- 全量文档梳理，对齐 Java→Go 后端迁移后的实际架构
- 更新 `CLAUDE.md`：准确描述 `apps/server-go` 包结构与启动命令
- 更新 `docs/` 目录：部署指南、开发指南、架构文档与 CI/CD 说明同步更新

---

### 🏗 依赖与环境

| 组件 | v0.0.1 | v0.0.2 |
|------|--------|--------|
| 后端运行时 | JDK 25 + Spring Boot 4.0 | **Go 1.24** |
| HTTP 框架 | Spring MVC | **Echo v4.15** |
| 数据库访问 | JPA / Hibernate | **sqlx v1.4** |
| 缓存 | Spring Cache / Lettuce | **go-redis v9** |
| JWT | Spring Security | **golang-jwt v5** |
| 日志 | SLF4J / Logback | **zerolog v1.35** |
| 配置 | Spring Config | **koanf v2** |
| 博客前台 | Next.js 15 / React 19 | Next.js 15 / React 19 _(不变)_ |
| 管理后台 | Vite / React 19 | Vite / React 19 _(不变)_ |
| AI 服务 | FastAPI + LiteLLM | FastAPI + LiteLLM _(不变)_ |
| 数据库 | PostgreSQL 17 + pgvector | PostgreSQL 17 + pgvector _(不变)_ |
| 缓存中间件 | Redis 7 | Redis 7 _(不变)_ |

---

## [0.0.1] — 2026-02-01

> 初始版本发布，确立完整的全栈智能博客体系。

### 功能亮点

- 博客前台（Next.js 15）：Markdown 渲染、语义搜索、评论、时间线、友链、主题切换
- 管理后台（Vite + React 19）：文章管理、AI 编辑器、媒体库、评论管理、系统监控
- AI 写作辅助：摘要、标题建议、标签提取、内容润色、大纲生成、多语言翻译（SSE 流式输出）
- AI 配置中心：多模型路由（OpenAI / DeepSeek / 通义千问等）动态切换
- 后端 API：Spring Boot 4.0 + JDK 25 + PostgreSQL 17 + Redis 7 + Elasticsearch 8
- Docker Compose 一键部署，Nginx 统一网关

---

[v0.0.3]: https://github.com/golovin0623/AetherBlog/compare/v0.0.2...v0.0.3
[v0.0.2]: https://github.com/golovin0623/AetherBlog/compare/0.0.1...v0.0.2
[0.0.1]: https://github.com/golovin0623/AetherBlog/releases/tag/0.0.1
