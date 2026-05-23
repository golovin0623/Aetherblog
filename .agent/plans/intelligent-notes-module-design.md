# AetherBlog 智能笔记模块设计评审

更新时间: 2026-05-23  
状态: 设计评审稿, 等待批准后实施

## 1. 背景与目标

本设计面向后台新增独立内容域「智能笔记」:

- 入口位置: 后台侧边栏 `INTELLIGENCE` 分组, 放在「灵境」下方, 名称为「智能笔记」。
- 产品定位: 面向私人/后台知识沉淀、快速记录、后续 AI 引用和检索, 不作为博客文章发布系统的一部分。
- 当前阶段: 参照「文章管理」的列表、编辑、复制、删除、分页和编辑器能力迁移一套可用体验, 但删掉文章发布系统中的公开展示、SEO、评论、浏览量、置顶发布等强约束。
- 明确边界: 不显示到首页、`/posts`、归档、分类文章页、公开搜索和前台文章详情中。

核心原则:

1. 笔记不是隐藏文章。不能用 `posts.is_hidden=true` 伪装笔记, 否则会继承文章的发布、评论、搜索、共享、索引、统计等副作用。
2. 先做到简单可靠。MVP 以快速创建、快速搜索、Markdown 编辑、标签/文件夹组织为主。
3. 为 AI 留足底座。数据模型要支持后续语义索引、来源引用、双链、块级引用和 Agent 工具调用, 但 UI 不提前堆满复杂概念。

## 2. 当前仓库现状

### 2.1 后台路由与导航

- 后台入口在 `apps/admin/src/App.tsx`, 目前文章路由为:
  - `/posts`
  - `/posts/new`
  - `/posts/:id/edit`
  - `/posts/ai-writing/new`
  - `/posts/ai-writing/:id`
- 侧边栏在 `apps/admin/src/components/layout/Sidebar.tsx`, 当前 `INTELLIGENCE` 分组顺序为:
  - 灵境 `/aetherhub`
  - 智能编排 `/agent-workflows`
  - 写作助手 `/ai-tools`
  - 全局价格
  - 数据分析
  - 搜索配置
  - 模型中心

设计落点:

- 新增 `/notes`, `/notes/new`, `/notes/:id/edit`。
- 侧边栏插入 `{ path: '/notes', label: '智能笔记' }`, 位于 `/aetherhub` 之后。
- 命令面板与侧边栏搜索需要补充「前往 · 智能笔记」和「新建笔记」。

### 2.2 文章管理可复用点

文章列表 `apps/admin/src/pages/PostsPage.tsx` 已具备:

- 搜索关键词同步 URL query。
- 分页、page size、空状态、骨架屏。
- 状态筛选和高级筛选。
- 桌面 table + 移动 card 双视图。
- 复制、删除、编辑、属性弹窗。
- `AdminPagination` 作为后台分页标准。

文章编辑 `apps/admin/src/pages/posts/CreatePostPage.tsx` 已具备:

- `@aetherblog/editor` CodeMirror Markdown 编辑器。
- 预览/分屏/编辑模式。
- 自动保存草稿。
- 图片上传、Markdown 工具栏、快捷格式化。
- Slash command、选中文本 AI、AI 侧栏。
- 移动端默认 edit、桌面 split 的响应式体验。

可复用但需要减法:

- 复用 `@aetherblog/editor`、`AdminPagination`、列表骨架和移动布局。
- 保留自动保存、Markdown、标签、复制、软删除。
- 去掉文章发布按钮、分类必选、SEO、评论、密码保护、公开/隐藏切换、浏览量、发布时间、AI 协同写作入口。

### 2.3 后端文章域副作用

Go 后端当前文章系统:

- `posts` 表是博客核心内容表。
- 公开列表只查 `status='PUBLISHED' AND is_hidden=false AND deleted=false`。
- 首页 `getRecentPosts` 读取 `/api/v1/public/posts`。
- 文章保存/发布会触发 `post_embeddings` 语义索引。
- 文章共享、Agent 文章 picker、公开搜索、归档、分类、标签统计都与 `posts` 强绑定。

结论:

- 新笔记不能复用 `posts` 表并靠状态过滤隔离。
- 推荐新建 `notes` 领域: `model` / `dto` / `repository` / `service` / `handler` 全链路独立。
- 与文章共享基础设施, 但不共享业务表和公开路由。

### 2.4 当前代码证据与影响面

本轮调研基于当前工作区实查, 不是只按抽象架构推断:

- 后台侧边栏 `apps/admin/src/components/layout/Sidebar.tsx` 当前 `INTELLIGENCE` 分组中, 「灵境」路径为 `/aetherhub`, 因此「智能笔记」应插在该 item 后方。
- 后台路由 `apps/admin/src/App.tsx` 当前文章管理集中在 `/posts`, `/posts/new`, `/posts/:id/edit`, `/posts/ai-writing/*`; 智能笔记应新增独立 `/notes` 路由组, 不挂在 `/posts` 子路由下。
- 后端 `apps/server-go/internal/server/server.go` 当前文章管理挂在 `/v1/admin/posts`, 公开文章挂在 `/v1/public/posts`, 协作共享文章挂在 `/v1/collaboration/posts`; 智能笔记只应新增 `/v1/admin/notes`, 不新增 public/collaboration notes。
- 前台 `apps/blog/app/lib/api.ts` 只定义公开文章 API, 首页通过 `apps/blog/app/lib/services.ts#getRecentPosts` 获取 `/api/v1/public/posts`; 智能笔记隔离的验证点是这里不新增 notes API, 首页也不读取 notes。
- 当前迁移最新编号为 `000053_add_editor_image_smart_compression_setting`; 若实施前没有新迁移合入, 智能笔记迁移建议使用 `000054_*`。实施当天仍需重新 `rg --files apps/server-go/migrations | sort | tail` 复核编号。
- `apps/admin/src/services/postService.ts` 和 `packages/types/src/models/post.ts` 可作为 DTO 命名风格参考, 但不能直接扩展为 notes, 否则会把文章协议和笔记协议耦合在一起。

影响面分级:

| 影响面 | 是否必须改 | 原因 |
| --- | --- | --- |
| `apps/server-go/migrations` | 是 | 新建独立 notes 数据域 |
| `apps/server-go/internal/model/dto/repository/service/handler` | 是 | 新建 admin-only notes API |
| `apps/server-go/internal/server/server.go` | 是 | 挂载 `/v1/admin/notes` |
| `apps/admin/src/App.tsx` | 是 | 新增 `/notes` 路由 |
| `apps/admin/src/components/layout/Sidebar.tsx` | 是 | 在「灵境」下方加「智能笔记」 |
| `apps/admin/src/services` | 是 | 新建 `noteService.ts` |
| `apps/admin/src/pages` | 是 | 新建列表与编辑页 |
| `packages/types/src` | 是 | 新增共享 note 类型 |
| `apps/blog/app/lib/api.ts` | 原则上不改 | 不暴露前台 notes API |
| `apps/blog/app/lib/services.ts` 和首页 | 原则上不改 | 笔记不显示到首页 |
| `docker-compose*` / `.env*` | 不改 | Phase 1 不引入新服务或配置 |

## 3. 市场优秀产品借鉴

本设计不照搬单一产品, 而是提炼主流产品的稳定共性。

### 3.1 Notion: 结构化属性 + 多视图

Notion 的强项是把页面放进数据库, 通过属性、视图、过滤、排序、分组来组织内容。其帮助文档强调数据库视图可以按布局、属性可见性、过滤、排序和分组独立配置。

可借鉴:

- 笔记列表不是只做一张表, 而是支持「全部」「最近」「置顶」「归档」「未整理」这类轻量视图。
- 属性要可扩展, 但默认不要打扰用户。
- 未来可以做自定义视图/智能筛选, MVP 只做内置视图。

不建议当前照搬:

- 不做 Notion 式万能数据库。
- 不引入自定义字段编辑器, 否则第一版复杂度过高。

### 3.2 Obsidian: Markdown、双链、属性和图谱

Obsidian 的核心价值是本地 Markdown、内部链接、反向链接、属性和图谱。官方文档说明内部链接支持 wiki link 和 Markdown link, Graph view 用节点和连线展示笔记关系, Properties 用结构化数据组织笔记。

可借鉴:

- 内容格式继续使用 Markdown。
- 支持 `[[笔记标题]]` 语法解析, 保存时写入 `note_links`。
- 笔记详情页展示「反向链接」和「相关笔记」作为后续增强。
- 为未来知识图谱和 AI 上下文召回预留关系表。

不建议当前照搬:

- 第一版不做完整图谱画布。
- 不做本地文件 vault 模式。

### 3.3 Apple Notes: 快速记录、标签、智能文件夹

Apple Notes 的 Quick Note 关注「无论正在做什么都能快速记下」, 标签可放在笔记任意位置, Smart Folder 可按标签、日期、提及等条件自动归集。

可借鉴:

- 新建笔记应极快: 标题可选, 空标题由首行或时间自动生成。
- 标签可以通过正文中的 `#tag` 轻量提取, 不强制先去维护标签库。
- 提供「未整理」「今日」「最近 7 天」「含待办」等智能视图。

不建议当前照搬:

- 不做系统级浮窗 Quick Note, 先做后台内快速新建和命令面板入口。

### 3.4 Evernote: 搜索优先、附件和 OCR 思路

Evernote 的优势是跨笔记、标签、附件和扫描件检索, 并提供自然语言 AI 搜索。

可借鉴:

- MVP 的核心体验必须是搜索快、结果可信。
- 数据层要为附件和来源 URL 留字段。
- 后续 AI 搜索不应只返回回答, 还要能回到原笔记和片段。

不建议当前照搬:

- 不做复杂附件 OCR。
- 不做邮件转发、网页剪藏等重入口。

### 3.5 Logseq/Roam: Daily Notes 与块级引用

Logseq/Roam 的价值是日记式捕捉、块级引用和 Linked References。它适合长期知识网络, 但实现复杂。

可借鉴:

- 后续可以新增「每日笔记」视图。
- 数据层预留 `note_blocks` 或 chunk 机制, 让 AI 可以引用到具体段落/块。

不建议当前照搬:

- 第一版不做 outliner 块编辑器。
- 不改变现有 Markdown 编辑器。

### 3.6 NotebookLM: 来源接地与可验证 AI

NotebookLM 的关键模式是围绕 sources 做问答、摘要和引用。对 AetherBlog 来说, 智能笔记未来要成为 AI 的可靠知识来源。

可借鉴:

- 笔记需要 `source_type` / `source_url` / `source_title` / `source_meta`。
- AI 召回结果要能引用 note id、标题、chunk/段落位置。
- 后续 Agent 使用笔记时, 要遵守权限和来源边界。

### 3.7 市场能力取舍矩阵

| 市场能力 | 代表产品 | 是否采纳 | 阶段 | 评审理由 |
| --- | --- | --- | --- | --- |
| Markdown 原生编辑 | Obsidian / Logseq | 采纳 | Phase 1 | 仓库已有 `@aetherblog/editor`, 复用成本低, 也符合开发者笔记习惯 |
| 快速创建/无标题笔记 | Apple Notes | 采纳 | Phase 1 | 是笔记区别于文章的核心体验, 应弱化标题和发布约束 |
| 搜索优先 | Evernote | 采纳 | Phase 1 | 比复杂分类更符合笔记找回场景, 后续可平滑接 AI 搜索 |
| 标签 + 文件夹 | Apple Notes / Evernote | 采纳 | Phase 1 | 轻量组织足够, 且不污染文章 categories/tags |
| 最近/置顶/未整理/归档视图 | Notion / Apple Notes | 采纳 | Phase 1 | 固定视图能提升效率, 不需要第一版实现自定义视图系统 |
| `[[双链]]` 与反链 | Obsidian / Logseq / Roam | 采纳 | Phase 2 | 是后续知识图谱和 AI 上下文召回的重要结构化信号 |
| 内联 `#tag` 提取 | Apple Notes / Logseq | 采纳 | Phase 2 | 减少管理成本, 但需要可撤销和去重逻辑 |
| 来源字段与引用 | NotebookLM | 采纳 | Phase 1 数据底座, Phase 3 AI | 对 AI 接地很关键, 但第一版只保存来源元数据, 不做自动抓取 |
| 数据库自定义属性 | Notion | 延后 | Phase 4 | 能力强但复杂, 第一版用固定字段防止产品失焦 |
| 图谱/画布 | Obsidian / Heptabase | 延后 | Phase 4 | 依赖 `note_links` 积累, 早做容易变成展示噱头 |
| 块级引用 | Logseq / Roam | 延后 | Phase 4 | 需要 `note_blocks` 与编辑器结构化改造, 不适合首版 |
| 附件 OCR | Evernote | 延后 | Phase 4 | 需要存储、OCR、索引、权限一整套链路 |
| 协作共享 | Notion / Evernote Teams | 不采纳首版 | 后续产品决策 | 当前目标是后台私有笔记, 共享会扩大权限风险 |
| 公开发布 | Notion public page / 博客文章 | 不采纳 | 不做 | 与用户要求“不同文章管理体系、不显示首页”冲突 |

## 4. 推荐产品方案

### 4.1 信息架构

后台侧边栏:

```text
INTELLIGENCE
  灵境
  智能笔记
  智能编排
  写作助手
  ...
```

智能笔记内部:

```text
/notes
  顶部: 模块标题、当前视图、匹配数量、新建按钮、快速记录按钮
  搜索: 标题/正文/标签
  视图 tabs: 全部、最近、置顶、未整理、已归档
  轻筛选: 文件夹、标签、来源、是否含待办
  列表: 标题、摘要/首段、标签、文件夹、更新时间、操作

/notes/new
/notes/:id/edit
  顶部: 返回、标题输入、标签/文件夹、保存状态、保存按钮
  主体: Markdown 编辑器
  右侧: 信息面板, 包含属性、反向链接、AI 扩展预留
```

### 4.2 与文章管理的差异

| 能力 | 文章管理 | 智能笔记 |
| --- | --- | --- |
| 内容定位 | 可发布博客文章 | 后台私有知识/草稿/材料 |
| 数据表 | `posts` | `notes` |
| 首页展示 | 已发布可见文章展示 | 永不展示 |
| 必填项 | 标题、正文; 发布时要求分类 | 正文或标题至少一项; 分类不强制 |
| 状态 | DRAFT/PUBLISHED/ARCHIVED/SCHEDULED | ACTIVE/ARCHIVED 或 archived boolean |
| 分类 | 文章分类, 影响前台聚合 | 可选文件夹/集合, 不影响前台 |
| 标签 | 文章标签, 影响文章统计 | 独立笔记标签, 不影响文章标签计数 |
| SEO/评论/密码 | 文章能力 | 移除 |
| 浏览量/发布时间 | 文章展示指标 | 移除 |
| AI | 写作辅助、文章索引 | 知识检索、摘要、关联、问答底座 |

## 5. 数据模型设计

### 5.1 MVP 表

#### notes

建议字段:

- `id BIGSERIAL PRIMARY KEY`
- `title VARCHAR(200) NOT NULL DEFAULT ''`
- `content_markdown TEXT NOT NULL DEFAULT ''`
- `summary TEXT`
- `folder_id BIGINT NULL REFERENCES note_folders(id) ON DELETE SET NULL`
- `author_id BIGINT REFERENCES users(id) ON DELETE SET NULL`
- `source_type VARCHAR(30) NOT NULL DEFAULT 'manual'`
- `source_url TEXT`
- `source_title VARCHAR(300)`
- `source_meta JSONB NOT NULL DEFAULT '{}'::jsonb`
- `is_pinned BOOLEAN NOT NULL DEFAULT FALSE`
- `is_favorite BOOLEAN NOT NULL DEFAULT FALSE`
- `archived BOOLEAN NOT NULL DEFAULT FALSE`
- `deleted BOOLEAN NOT NULL DEFAULT FALSE`
- `word_count INT NOT NULL DEFAULT 0`
- `embedding_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'`
- `last_opened_at TIMESTAMPTZ`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

约束:

- `CHECK (btrim(title) <> '' OR btrim(content_markdown) <> '')`
- `CHECK (embedding_status IN ('PENDING', 'INDEXED', 'FAILED', 'SKIPPED'))`
- `CHECK (source_type IN ('manual', 'web', 'article', 'chat', 'import', 'api'))`

索引:

- `idx_notes_author_updated ON notes(author_id, updated_at DESC) WHERE deleted=false`
- `idx_notes_folder_updated ON notes(folder_id, updated_at DESC) WHERE deleted=false`
- `idx_notes_archived_updated ON notes(archived, updated_at DESC) WHERE deleted=false`
- `idx_notes_pinned_updated ON notes(is_pinned DESC, updated_at DESC) WHERE deleted=false`
- `idx_notes_fulltext ON notes USING gin(to_tsvector('simple', title || ' ' || COALESCE(summary,'') || ' ' || content_markdown))`

#### note_folders

用途: 可选组织层, 类似 Apple Notes folders, 但不强制。

字段:

- `id BIGSERIAL PRIMARY KEY`
- `name VARCHAR(100) NOT NULL`
- `slug VARCHAR(120) NOT NULL`
- `parent_id BIGINT REFERENCES note_folders(id) ON DELETE SET NULL`
- `sort_order INT NOT NULL DEFAULT 0`
- `created_at`, `updated_at`

唯一约束:

- 同一父级下 `name` 或 `slug` 唯一。

#### note_tags

用途: 独立于文章标签, 避免污染 `tags.post_count`。

字段:

- `id BIGSERIAL PRIMARY KEY`
- `name VARCHAR(50) NOT NULL`
- `slug VARCHAR(80) NOT NULL UNIQUE`
- `color VARCHAR(20)`
- `usage_count INT NOT NULL DEFAULT 0`
- `created_at`, `updated_at`

#### note_tag_links

字段:

- `note_id BIGINT REFERENCES notes(id) ON DELETE CASCADE`
- `tag_id BIGINT REFERENCES note_tags(id) ON DELETE CASCADE`
- `source VARCHAR(20) NOT NULL DEFAULT 'manual'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `PRIMARY KEY(note_id, tag_id)`

`source` 可为 `manual` / `inline` / `ai`。

#### note_links

用途: 支撑双链、反链、相关笔记、未来图谱。

字段:

- `id BIGSERIAL PRIMARY KEY`
- `source_note_id BIGINT NOT NULL REFERENCES notes(id) ON DELETE CASCADE`
- `target_note_id BIGINT REFERENCES notes(id) ON DELETE SET NULL`
- `target_title VARCHAR(200) NOT NULL`
- `link_text VARCHAR(200)`
- `link_type VARCHAR(20) NOT NULL DEFAULT 'wiki'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

约束:

- `link_type IN ('wiki', 'markdown', 'manual', 'ai')`

保存笔记时从正文解析 `[[标题]]` 和站内 note 链接, 重建该 note 的 outgoing links。

### 5.2 AI 扩展表

建议第一版创建 `note_embeddings`, 但不急着接入索引任务 UI。

#### note_embeddings

对齐现有 `post_embeddings` + `search_profiles` 设计:

- `id BIGSERIAL PRIMARY KEY`
- `note_id BIGINT NOT NULL REFERENCES notes(id) ON DELETE CASCADE`
- `profile_id BIGINT NOT NULL REFERENCES search_profiles(id) ON DELETE CASCADE`
- `model_id VARCHAR(120) NOT NULL`
- `dim INT NOT NULL CHECK (dim > 0 AND dim <= 4096)`
- `embedding vector NOT NULL`
- `status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'shadow', 'deprecated'))`
- `chunk_index INT NOT NULL DEFAULT 0`
- `chunk_text TEXT`
- `parent_text TEXT`
- `indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `UNIQUE(note_id, profile_id, chunk_index)`

索引:

- `idx_note_emb_note_status ON note_embeddings(note_id, status)`
- `idx_note_emb_profile_status ON note_embeddings(profile_id, status)`
- HNSW partial index 可在真正接入语义检索时加; 如果第一版只落 schema, 可以先不建 HNSW, 避免空表优化过度。

### 5.3 可延后表

`note_blocks` 可延后到需要块级引用时再加:

- `id`
- `note_id`
- `block_uid`
- `block_index`
- `heading_path`
- `content`
- `content_hash`
- `created_at`, `updated_at`

理由:

- 现有编辑器是 Markdown 文档编辑器, 强行第一版切块会增加保存逻辑和 UI 认知成本。
- AI chunking 已可从 `content_markdown` 派生, 不必为了未来可能的块编辑器提前改变用户体验。

## 6. 后端 API 设计

### 6.1 管理端 API

仅挂载在 `/api/v1/admin/notes`, 不提供 `/api/v1/public/notes`。

```text
GET    /v1/admin/notes
GET    /v1/admin/notes/:id
POST   /v1/admin/notes
PUT    /v1/admin/notes/:id
PATCH  /v1/admin/notes/:id/properties
POST   /v1/admin/notes/:id/auto-save
DELETE /v1/admin/notes/:id
POST   /v1/admin/notes/:id/duplicate

GET    /v1/admin/note-folders
POST   /v1/admin/note-folders
PUT    /v1/admin/note-folders/:id
DELETE /v1/admin/note-folders/:id

GET    /v1/admin/note-tags
POST   /v1/admin/note-tags
DELETE /v1/admin/note-tags/:id
```

列表查询参数:

- `pageNum`, `pageSize`
- `keyword`
- `folderId`
- `tagId`
- `archived`
- `pinned`
- `favorite`
- `sourceType`
- `hasTodo`
- `startDate`, `endDate`

### 6.2 DTO

`CreateNoteRequest`:

- `title?: string`
- `content?: string`
- `summary?: string`
- `folderId?: number`
- `tagIds?: number[]`
- `inlineTags?: string[]`
- `sourceType?: string`
- `sourceUrl?: string`
- `sourceTitle?: string`
- `sourceMeta?: Record<string, unknown>`

规则:

- `title` 和 `content` 至少一个非空。
- title 为空时:
  - 取正文首个非空行, 去掉 Markdown 标记后截断 80 字。
  - 仍为空则用 `未命名笔记 · yyyy-MM-dd HH:mm`。
- content 为空允许创建, 方便先记标题。
- 不要求 folder/tag。

`UpdateNotePropertiesRequest`:

- `title`
- `summary`
- `folderId`
- `tagIds`
- `isPinned`
- `isFavorite`
- `archived`
- `sourceType`
- `sourceUrl`
- `sourceTitle`
- `sourceMeta`

### 6.3 服务层职责

`NoteService`:

- 创建/更新笔记。
- 生成标题、摘要和字数。
- 维护 tag links。
- 解析正文中的 `#tag` 和 `[[note title]]`。
- 重建 `note_links`。
- 管理 Redis auto-save, key 建议 `note:draft:<id>`。
- 触发未来索引: 第一版可以只把 `embedding_status` 置为 `PENDING`, 不调用 ai-service。

`NoteRepo`:

- CRUD。
- 后台分页。
- tags/folders/links 批量查询。
- `FindOwnership` 轻量查询, 对齐文章的写前校验思路。

`NoteHandler`:

- 挂在 admin group 下, 继承 admin JWT + role 校验。
- 每个写接口调用 ownership 校验。
- 记录活动事件: `note.create`, `note.update`, `note.delete`, `note.archive`。

## 7. 前端设计

### 7.1 服务与类型

新增:

- `apps/admin/src/services/noteService.ts`
- `apps/admin/src/types/note.ts`
- `packages/types/src/models/note.ts`
- `packages/types/src/models/index.ts` 导出 note 类型

### 7.2 页面

新增:

- `apps/admin/src/pages/NotesPage.tsx`
- `apps/admin/src/pages/notes/CreateNotePage.tsx`
- `apps/admin/src/pages/notes/components/NoteTableRow.tsx`
- `apps/admin/src/pages/notes/components/NotePropertiesPanel.tsx`
- `apps/admin/src/pages/notes/components/QuickNoteDialog.tsx`

`NotesPage` 推荐从 `PostsPage` 裁剪:

- 保留 URL search 同步。
- 保留 `AdminPagination`。
- 保留桌面 table + 移动 card。
- 状态 tab 改为:
  - 全部
  - 最近
  - 置顶
  - 未整理
  - 已归档
- 高级筛选改为:
  - 文件夹
  - 标签
  - 来源
  - 含待办
- 列字段:
  - 标题/摘要
  - 标签
  - 文件夹
  - 来源
  - 更新时间
  - 操作

去掉:

- 文章状态 DRAFT/PUBLISHED/ARCHIVED。
- 可见性筛选。
- 浏览量筛选。
- 发布时间筛选。
- AI 协同写作按钮。

`CreateNotePage` 推荐从 `CreatePostPage` 裁剪:

- 顶部标题输入 placeholder: `未命名笔记`
- 操作按钮:
  - 保存
  - 归档/取消归档
  - 信息面板
- 编辑器:
  - 继续使用 `EditorWithPreview`
  - 移动端默认 edit, 桌面默认 split
  - 保留 Markdown 工具栏
  - 保留图片上传能力, 因为笔记也需要贴图
- 右侧面板:
  - 文件夹
  - 标签
  - 来源 URL
  - 反向链接
  - AI 准备状态, 只展示状态, 不承诺未实现操作

去掉:

- 发布按钮。
- 分类必选校验。
- SEO、评论、密码、浏览量、发布时间。
- 深链到文章 AI 工具箱。

### 7.3 快捷体验

第一版建议支持:

- `/notes/new` 直接创建。
- `QuickNoteDialog`: 在列表页一键快速记录, 默认只显示一个 textarea。
- 命令面板:
  - `前往 · 智能笔记`
  - `新建笔记`
- 侧边栏搜索:
  - 可以先不搜索笔记内容, 只补导航入口。
  - 第二步再将 noteService 搜索接入 `SidebarSearchPalette`。

## 8. 前台隔离策略

必须保证:

- 不新增 `/api/v1/public/notes`。
- `apps/blog/app/lib/api.ts` 不新增 notes 公开 endpoint。
- 首页 `getRecentPosts` 不改。
- `/posts`, 归档, 分类, 标签, 搜索继续只读 `public/posts`。
- 公开搜索和 AI QA 第一阶段不召回 notes。

需要特别审查:

- `apps/blog/app/lib/services.ts`
- `apps/blog/app/lib/api.ts`
- `apps/server-go/internal/handler/post_handler.go`
- `apps/server-go/internal/repository/post_repo.go`
- `apps/server-go/internal/service/search_service.go`
- `apps/ai-service/app/services/vector_store.py`

## 9. 权限与安全

第一版安全策略:

- 管理端 `/v1/admin/notes/*` 继承 legacy admin 强校验。
- 预留 RBAC permission: `content.notes.manage`。
- 若未来普通 AUTHOR 也能使用, 再通过 `RequirePermission` 放宽, 不在 MVP 中扩大访问面。
- 写操作校验 owner/admin, 与文章 `FindOwnership` 模式一致。
- 软删除优先, 不做物理删除。
- 来源 URL 只作为文本保存, 不做服务端抓取, 避免 SSRF。
- AI 后续读取 notes 时必须显式权限过滤, 不得把后台私密笔记混入公开搜索。

迁移中需要同步:

- `permissions` seed 增加 `content.notes.manage`。
- ADMIN 自动拥有。
- AUTHOR 是否拥有需要产品决策。建议第一版只 ADMIN, 第二版再开放。

## 10. 实施阶段建议

### Phase 1: 独立笔记 CRUD + 管理端 UI

目标:

- 独立 notes 数据域。
- 后台「智能笔记」入口。
- 列表、搜索、分页、新建、编辑、复制、归档、删除。
- Markdown 编辑器和自动保存。
- 独立 note tags/folders。
- 不进入前台。

交付:

- migration 000054。
- Go model/dto/repo/service/handler。
- admin route/sidebar/service/types/pages。
- 基础 Go repository/service/handler 测试。
- admin typecheck。

### Phase 2: 笔记关系与快速捕捉

目标:

- `[[双链]]` 解析。
- 反向链接面板。
- QuickNoteDialog。
- 命令面板和侧边栏搜索补全。
- 内联 `#tag` 自动提取。

### Phase 3: AI-ready indexing

目标:

- note_embeddings 写入流程。
- search profile 复用。
- 管理端索引状态。
- 灵境/Agent 可选择性引用智能笔记。

关键要求:

- 默认不把 notes 混入公开 QA。
- AI 回答引用必须包含 note title / chunk / link。

### Phase 4: 高级知识管理

候选能力:

- 每日笔记。
- 智能文件夹/保存视图。
- 图谱视图。
- Web clipper/import。
- 附件 OCR。
- 块级引用。

## 11. 风险评审

### 风险 1: 复用 posts 导致内容泄漏或首页污染

评级: 高  
结论: 不采纳复用 `posts` 方案。  
控制: 新建 `notes` 表和 admin-only API。

### 风险 2: 第一版过度产品化

评级: 中  
结论: 笔记软件市场功能很多, 不能一次实现 Notion/Obsidian/NotebookLM。  
控制: Phase 1 只做 CRUD + 搜索 + Markdown + 标签/文件夹 + 自动保存。

### 风险 3: AI 索引与现有 post_embeddings 混乱

评级: 高  
结论: 不改 `post_embeddings`, 新建 `note_embeddings`。  
控制: 复用 `search_profiles`, 但索引表独立, 公开搜索默认不读 notes。

### 风险 4: 标签/分类统计污染

评级: 中  
结论: 不复用 `categories` 和 `tags`。  
控制: 新建 `note_folders`, `note_tags`, `note_tag_links`。

### 风险 5: UI 从文章管理照搬后仍然太重

评级: 中  
结论: 列表框架可复用, 操作和文案必须做减法。  
控制: 不出现发布、SEO、评论、浏览量、公开可见性等词。

## 12. 验收标准

功能验收:

- 后台侧边栏「灵境」下方出现「智能笔记」。
- `/notes` 可查看笔记列表, 支持搜索、分页、归档过滤。
- `/notes/new` 可在无标题情况下创建笔记, 系统自动生成标题。
- `/notes/:id/edit` 可编辑 Markdown 并保存。
- 笔记可复制、归档、删除。
- 标签/文件夹可选, 不选择也能保存。
- 新笔记不出现在首页、`/posts`、归档、分类、公开搜索中。

技术验收:

- `pnpm --filter @aetherblog/admin typecheck` 通过。
- `cd apps/server-go && go test ./... -v` 至少相关新增包通过。
- migration up/down 可执行。
- `go build ./...` 通过。
- 若改 compose/env, 需要同步配置文档; 本方案 Phase 1 不需要改 compose/env。

安全验收:

- 未新增公开 notes API。
- notes 来源 URL 不触发服务端抓取。
- 删除为软删除。
- 访问控制不弱于现有 admin posts。

## 13. 推荐结论

建议批准 Phase 1 + Phase 2 的合并实施范围:

1. Phase 1 必做, 交付独立可用的「智能笔记」。
2. Phase 2 中的 QuickNoteDialog、命令面板入口和 `[[双链]]` 解析建议一起做, 因为它们是笔记体验和后续 AI 扩展的关键, 且不会显著扩大后端风险。
3. Phase 3 的 note_embeddings 只建议先落基础表和状态字段; 真正 AI 索引与灵境引用作为后续独立 PR/任务, 避免第一版把业务闭环拉得过长。

最终推荐技术路线:

- 独立数据域: `notes` / `note_folders` / `note_tags` / `note_links`。
- 独立管理 API: `/v1/admin/notes`。
- 前台零暴露。
- UI 从文章管理裁剪, 不复制文章发布体系。
- 为 AI 建立来源、链接和 embedding 状态底座, 但第一版不承诺完整 AI 检索体验。

## 14. 批准后实施蓝图

若批准实施, 建议按以下文件级顺序推进, 每一步都保持可回滚和可验证。

### 14.1 后端实施清单

1. 新增迁移:
   - `apps/server-go/migrations/000054_create_notes.up.sql`
   - `apps/server-go/migrations/000054_create_notes.down.sql`
   - 实施前重新确认编号, 避免与并行迁移冲突。
2. 新增模型与 DTO:
   - `apps/server-go/internal/model/note.go`
   - `apps/server-go/internal/dto/note.go`
3. 新增仓储层:
   - `apps/server-go/internal/repository/note_repo.go`
   - 列表查询必须默认 `deleted=false`。
   - 管理员可按 `keyword/view/folderId/tag/sourceType/archived/pageNum/pageSize` 查询。
4. 新增服务层:
   - `apps/server-go/internal/service/note_service.go`
   - 负责标题自动生成、字数统计、软删除、归档、复制、自动保存、标签/双链解析。
5. 新增 handler:
   - `apps/server-go/internal/handler/note_handler.go`
   - 只实现 `MountAdmin`, 不实现 `MountPublic`。
6. 挂载路由:
   - 在 `apps/server-go/internal/server/server.go` 增加 `handler.NewNoteHandler(...).MountAdmin(admin.Group("/notes"))`。
   - 不修改 public/collaboration group。
7. 权限:
   - 迁移 seed 增加 `content.notes.manage`。
   - 第一版建议仅 ADMIN 默认拥有; 若要 AUTHOR 使用, 另行明确产品权限。

### 14.2 前端实施清单

1. 新增共享类型:
   - `packages/types/src/models/note.ts`
   - `packages/types/src/index.ts` 导出。
2. 新增管理端类型与服务:
   - `apps/admin/src/types/note.ts`
   - `apps/admin/src/services/noteService.ts`
3. 新增页面:
   - `apps/admin/src/pages/NotesPage.tsx`
   - `apps/admin/src/pages/notes/CreateNotePage.tsx`
   - `apps/admin/src/pages/notes/components/NotePropertiesPanel.tsx`
   - `apps/admin/src/pages/notes/components/QuickNoteDialog.tsx`
4. 修改路由:
   - `apps/admin/src/App.tsx` 增加 `/notes`, `/notes/new`, `/notes/:id/edit`。
5. 修改导航:
   - `apps/admin/src/components/layout/Sidebar.tsx` 在 `/aetherhub` 下方加 `/notes`。
   - 若当前侧边栏搜索有静态索引, 同步补「前往 · 智能笔记」「新建笔记」。
6. 页面减法约束:
   - 不显示发布、公开、SEO、评论、密码、阅读量、发布时间等文章字段。
   - 保存按钮文案使用「保存」, 不使用「发布」。
   - 标签/文件夹可为空。

### 14.3 API 合约草案

列表:

```text
GET /api/v1/admin/notes?keyword=&view=&folderId=&tag=&sourceType=&archived=&pageNum=&pageSize=
```

返回:

```ts
type NoteListResponse = {
  items: NoteListItem[]
  total: number
  pageNum: number
  pageSize: number
}
```

创建:

```text
POST /api/v1/admin/notes
```

请求:

```ts
type CreateNoteRequest = {
  title?: string
  contentMarkdown?: string
  folderId?: number | null
  tags?: string[]
  sourceType?: 'manual' | 'web' | 'article' | 'chat' | 'import' | 'api'
  sourceUrl?: string
  sourceTitle?: string
}
```

标题自动生成规则:

1. `title.trim()` 非空时使用 title。
2. 否则取正文第一行 Markdown 去标记后的前 60 个字符。
3. 仍为空时使用 `未命名笔记 YYYY-MM-DD HH:mm`。

### 14.4 禁止事项

实施时不得做以下事情:

- 不得把笔记写入 `posts`。
- 不得新增 `/api/v1/public/notes`。
- 不得让首页、文章归档、分类页、标签页读取 notes。
- 不得复用文章 `categories` / `tags` 统计。
- 不得在保存 source URL 时服务端主动抓取 URL。
- 不得把 notes 默认加入公开搜索或公开 AI QA。
- 不得引入新的环境变量、Docker 服务或网关规则, 除非另行批准。

### 14.5 实施后验证命令

批准并完成实现后, 至少执行:

```bash
pnpm --filter @aetherblog/admin typecheck
cd apps/server-go && go test ./... -v
cd apps/server-go && go build ./...
```

若本地数据库可用, 还需要执行 notes migration up/down 验证。若数据库不可用, 需要在汇报中明确说明未验证 migration runtime, 并至少通过 SQL 语法和 migrate 文件命名检查。
