# AetherBlog 智能笔记技术合约

更新时间: 2026-05-23  
状态: 批准前技术合约, 批准后作为后端/API/数据层实现基线

## 1. 合约目标

本合约把「智能笔记」从产品设计收敛到工程可实现边界:

- 后端保持 `handler -> service -> repository -> model/dto` 分层。
- API 采用现有管理端 REST 风格和 `response.OK/Error` 响应模式。
- 数据库使用独立 notes 表族, 不与 `posts` 业务表耦合。
- 查询默认排除软删除数据。
- 第一版只挂载 `/api/v1/admin/notes`, 不挂载 public/collaboration notes。
- 搜索参数统一使用 `keyword`, 对齐现有文章管理 `PostFilter.Keyword`。

## 2. 实施时的当前仓库约束

现有代码约束:

- 文章管理 handler 挂载在 `/v1/admin/posts`, public 文章挂载在 `/v1/public/posts`。
- 文章列表查询参数使用 `keyword`, `pageNum`, `pageSize`。
- 当前 migration 大多使用 `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`, 而不是全局统一 `TIMESTAMPTZ`。
- 文章 repo 已有 `FindOwnership` 最小列查询模式, notes 应复用这个思路。
- RBAC migration 已有 `permissions`, `roles`, `role_permissions`; 可新增 `content.notes.manage`。

技术决策:

- 时间字段首版建议沿用仓库主流 `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`, 保持迁移风格一致。若未来要统一 `TIMESTAMPTZ`, 应作为全局时间语义治理任务, 不夹在智能笔记首版里。
- 文本字段优先用 `TEXT`; title 可使用 `VARCHAR(200)` 对齐文章标题上限。
- 列表查询 offset pagination 对齐当前后台分页组件; cursor pagination 可后续优化。

## 3. 数据库合约

### 3.1 notes

职责: 笔记主表, 后台私有知识内容。

关键字段:

```sql
CREATE TABLE IF NOT EXISTS notes (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL DEFAULT '',
    content_markdown TEXT NOT NULL DEFAULT '',
    summary TEXT,
    folder_id BIGINT REFERENCES note_folders(id) ON DELETE SET NULL,
    author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    source_type VARCHAR(30) NOT NULL DEFAULT 'manual',
    source_url TEXT,
    source_title VARCHAR(300),
    source_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    word_count INT NOT NULL DEFAULT 0,
    embedding_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    last_opened_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_notes_not_empty CHECK (btrim(title) <> '' OR btrim(content_markdown) <> ''),
    CONSTRAINT chk_notes_source_type CHECK (source_type IN ('manual', 'web', 'article', 'chat', 'import', 'api')),
    CONSTRAINT chk_notes_embedding_status CHECK (embedding_status IN ('PENDING', 'INDEXED', 'FAILED', 'SKIPPED'))
);
```

索引:

```sql
CREATE INDEX IF NOT EXISTS idx_notes_author_updated
    ON notes(author_id, updated_at DESC)
    WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_notes_folder_updated
    ON notes(folder_id, updated_at DESC)
    WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_notes_archived_updated
    ON notes(archived, updated_at DESC)
    WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_notes_pinned_updated
    ON notes(is_pinned DESC, updated_at DESC)
    WHERE deleted = false AND archived = false;

CREATE INDEX IF NOT EXISTS idx_notes_source_type
    ON notes(source_type)
    WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_notes_fulltext
    ON notes USING gin (
        to_tsvector('simple', title || ' ' || COALESCE(summary, '') || ' ' || content_markdown)
    );
```

说明:

- `chk_notes_not_empty` 与“无标题快速创建”不冲突, 因为服务层在 title/content 都为空时生成默认标题。
- `folder_id` 引用 `note_folders`, 需要在 migration 中先创建 `note_folders`。
- fulltext 使用 `simple` 配置, 避免中文分词承诺; 第一版搜索仍可用 ILIKE, GIN 索引作为后续优化基础。

### 3.2 note_folders

职责: 笔记文件夹, 不等于文章分类。

```sql
CREATE TABLE IF NOT EXISTS note_folders (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    parent_id BIGINT REFERENCES note_folders(id) ON DELETE SET NULL,
    sort_order INT NOT NULL DEFAULT 100,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_note_folders_name_nonempty CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS idx_note_folders_parent_sort
    ON note_folders(parent_id, sort_order, name)
    WHERE deleted = false;
```

首版可只做平铺文件夹, `parent_id` 为后续树形结构预留。

### 3.3 note_tags / note_tag_links

职责: 独立笔记标签, 不污染文章 tags。

```sql
CREATE TABLE IF NOT EXISTS note_tags (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(80) NOT NULL UNIQUE,
    color VARCHAR(20) NOT NULL DEFAULT '#64748B',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_note_tags_name_nonempty CHECK (btrim(name) <> '')
);

CREATE TABLE IF NOT EXISTS note_tag_links (
    note_id BIGINT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id BIGINT NOT NULL REFERENCES note_tags(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_note_tag_links_tag
    ON note_tag_links(tag_id, note_id);
```

标签规范:

- `name` 进入数据库前 trim。
- 建议服务层做大小写去重策略; 若要数据库级大小写唯一, 可后续引入 `lower(name)` unique index。
- 内联 `#tag` 提取出的标签与手动标签走同一张表。

### 3.4 note_links

职责: 支撑 `[[双链]]`、反向链接、未来知识图谱和 AI 上下文召回。

```sql
CREATE TABLE IF NOT EXISTS note_links (
    id BIGSERIAL PRIMARY KEY,
    source_note_id BIGINT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    target_note_id BIGINT REFERENCES notes(id) ON DELETE SET NULL,
    target_title VARCHAR(200) NOT NULL,
    link_text VARCHAR(200) NOT NULL,
    position_start INT,
    position_end INT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_note_links_target_title_nonempty CHECK (btrim(target_title) <> ''),
    CONSTRAINT chk_note_links_link_text_nonempty CHECK (btrim(link_text) <> '')
);

CREATE INDEX IF NOT EXISTS idx_note_links_source
    ON note_links(source_note_id);

CREATE INDEX IF NOT EXISTS idx_note_links_target
    ON note_links(target_note_id);

CREATE INDEX IF NOT EXISTS idx_note_links_target_title
    ON note_links(target_title);
```

保存笔记时重建当前 note 的出链:

1. 删除 `source_note_id = note.id` 的旧 links。
2. 解析正文中的 `[[...]]`。
3. 按 title 查找 target note。
4. 找到则写 `target_note_id`, 未找到则仅写 `target_title`。

### 3.5 note_embeddings

职责: AI-ready 底座, 不承诺首版完整索引流程。

```sql
CREATE TABLE IF NOT EXISTS note_embeddings (
    id BIGSERIAL PRIMARY KEY,
    note_id BIGINT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    profile_id BIGINT REFERENCES search_profiles(id) ON DELETE SET NULL,
    chunk_index INT NOT NULL DEFAULT 0,
    chunk_text TEXT NOT NULL,
    parent_text TEXT,
    embedding vector,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_note_embeddings_status CHECK (status IN ('PENDING', 'INDEXED', 'FAILED', 'SKIPPED')),
    CONSTRAINT chk_note_embeddings_chunk_text_nonempty CHECK (btrim(chunk_text) <> '')
);

CREATE INDEX IF NOT EXISTS idx_note_emb_note_status
    ON note_embeddings(note_id, status);

CREATE INDEX IF NOT EXISTS idx_note_emb_profile_status
    ON note_embeddings(profile_id, status);
```

注意:

- 如果当前数据库未启用 pgvector 或 `vector` 类型不可用, 首版可以只建 notes.embedding_status, 暂缓 `note_embeddings` 实表。
- 若建表, 需要复核现有 `post_embeddings` 使用的 vector 维度和 migration 写法, 避免类型不一致。
- notes 默认不进入公开搜索或公开 QA。

## 4. DTO 合约

### 4.1 请求 DTO

```go
type CreateNoteRequest struct {
    Title           *string          `json:"title" validate:"omitempty,max=200"`
    ContentMarkdown *string          `json:"contentMarkdown"`
    Summary         *string          `json:"summary" validate:"omitempty,max=2000"`
    FolderID        *int64           `json:"folderId"`
    TagNames        []string         `json:"tagNames"`
    SourceType      *string          `json:"sourceType"`
    SourceURL       *string          `json:"sourceUrl"`
    SourceTitle     *string          `json:"sourceTitle"`
    SourceMeta      map[string]any   `json:"sourceMeta"`
    IsPinned        *bool            `json:"isPinned"`
    IsFavorite      *bool            `json:"isFavorite"`
}

type UpdateNotePropertiesRequest struct {
    Title       *string         `json:"title" validate:"omitempty,max=200"`
    Summary     *string         `json:"summary" validate:"omitempty,max=2000"`
    FolderID    *int64          `json:"folderId"`
    TagNames    []string        `json:"tagNames"`
    SourceType  *string         `json:"sourceType"`
    SourceURL   *string         `json:"sourceUrl"`
    SourceTitle *string         `json:"sourceTitle"`
    SourceMeta  map[string]any  `json:"sourceMeta"`
    IsPinned    *bool           `json:"isPinned"`
    IsFavorite  *bool           `json:"isFavorite"`
    Archived    *bool           `json:"archived"`
}

type AutoSaveNoteRequest struct {
    Title           *string        `json:"title"`
    ContentMarkdown *string        `json:"contentMarkdown"`
    FolderID        *int64         `json:"folderId"`
    TagNames        []string       `json:"tagNames"`
    SourceMeta      map[string]any `json:"sourceMeta"`
}
```

DTO 命名:

- 后端使用 `ContentMarkdown`, JSON 使用 `contentMarkdown`。
- 标签使用 `tagNames`, 不使用文章 `tagIds`, 因为笔记标签应支持轻量即输即建。
- 文件夹使用 `folderId`, 不使用 `categoryId`。

### 4.2 响应 DTO

```go
type NoteListItem struct {
    ID              int64      `json:"id"`
    Title           string     `json:"title"`
    Summary         *string    `json:"summary"`
    FolderID        *int64     `json:"folderId"`
    FolderName      *string    `json:"folderName"`
    TagNames        []string   `json:"tagNames"`
    SourceType      string     `json:"sourceType"`
    IsPinned        bool       `json:"isPinned"`
    IsFavorite      bool       `json:"isFavorite"`
    Archived        bool       `json:"archived"`
    WordCount       int        `json:"wordCount"`
    EmbeddingStatus string     `json:"embeddingStatus"`
    LastOpenedAt    *time.Time `json:"lastOpenedAt"`
    CreatedAt       time.Time  `json:"createdAt"`
    UpdatedAt       time.Time  `json:"updatedAt"`
}

type NoteDetail struct {
    NoteListItem
    ContentMarkdown string          `json:"contentMarkdown"`
    SourceURL       *string         `json:"sourceUrl"`
    SourceTitle     *string         `json:"sourceTitle"`
    SourceMeta      map[string]any  `json:"sourceMeta"`
    OutLinks        []NoteLinkItem  `json:"outLinks"`
    BackLinks       []NoteLinkItem  `json:"backLinks"`
    Draft           *CreateNoteRequest `json:"draft,omitempty"`
}
```

返回体使用现有 `response.OK(c, data)`, 分页使用现有 pagination 包返回结构, 不新增另一套 envelope。

## 5. API 合约

所有路由均在 `/api/v1/admin/notes` 下。

| 方法 | 路径 | 阶段 | 说明 |
| --- | --- | --- | --- |
| GET | `/notes` | Phase 1 | 列表, 搜索, 分页, 视图过滤 |
| GET | `/notes/:id` | Phase 1 | 详情, 含 draft |
| POST | `/notes` | Phase 1 | 创建笔记 |
| PUT | `/notes/:id` | Phase 1 | 全量保存内容 |
| PATCH | `/notes/:id/properties` | Phase 1 | 局部属性更新 |
| POST | `/notes/:id/auto-save` | Phase 1 | 自动保存 draft |
| DELETE | `/notes/:id` | Phase 1 | 软删除 |
| POST | `/notes/:id/duplicate` | Phase 1 | 复制笔记 |
| GET | `/notes/folders` | Phase 1 | 文件夹列表 |
| POST | `/notes/folders` | Phase 1 | 新建文件夹 |
| GET | `/notes/tags` | Phase 1 | 标签列表 |
| GET | `/notes/:id/backlinks` | Phase 2 | 反向链接 |

### 5.1 GET /notes

Query:

```text
keyword=
view=all|recent|pinned|unorganized|archived
folderId=
tag=
sourceType=manual|web|article|chat|import|api
archived=true|false
pageNum=1
pageSize=10
```

规则:

- `keyword` 对 title/content_markdown/summary/tag name 做搜索。
- `view=archived` 等价于 `archived=true`。
- `view=unorganized` 等价于 `folder_id IS NULL AND archived=false`。
- `view=pinned` 等价于 `is_pinned=true AND archived=false`。
- `view=recent` 按 `COALESCE(last_opened_at, updated_at) DESC` 排序。
- `deleted=false` 永远是默认条件。

### 5.2 POST /notes

规则:

- title/contentMarkdown 都为空时, 服务层生成默认标题。
- sourceType 为空时使用 `manual`。
- tagNames 允许为空。
- folderId 允许为空。
- 创建成功返回 `NoteDetail`。

### 5.3 PUT /notes/:id

规则:

- 更新 title/content/summary/folder/tags/source/pinned/favorite。
- 清除对应 `note:draft:<id>`。
- 重算 word_count。
- 重建 note_links。
- 将 embedding_status 置为 `PENDING` 或保留 `SKIPPED`, 具体取决于是否启用索引功能。首版建议内容变化时置为 `PENDING`。

### 5.4 PATCH /notes/:id/properties

允许列白名单:

```text
title
summary
folder_id
source_type
source_url
source_title
source_meta
is_pinned
is_favorite
archived
last_opened_at
updated_at
```

不得允许动态更新:

- `deleted`
- `author_id`
- `embedding_status`
- 任意 SQL 片段列名

### 5.5 POST /notes/:id/auto-save

规则:

- Redis key: `note:draft:<id>`。
- TTL 建议沿用文章草稿 TTL。
- 只写 Redis, 不更新 notes 表。
- 需要 ownership/admin 校验。

### 5.6 DELETE /notes/:id

规则:

- 软删除: `UPDATE notes SET deleted=true, updated_at=NOW() WHERE id=$1 AND deleted=false`。
- 不删除 note_tags。
- `note_links` 可保留到级联删除不会触发, 因为不是物理删除; 查询反链时必须排除 deleted source/target notes。

## 6. Repository 合约

推荐方法:

```go
type NoteRepo struct { db *sqlx.DB }

func (r *NoteRepo) FindByID(ctx context.Context, id int64) (*model.Note, error)
func (r *NoteRepo) FindOwnership(ctx context.Context, id int64) (exists bool, authorID *int64, err error)
func (r *NoteRepo) Create(ctx context.Context, n *model.Note) (*model.Note, error)
func (r *NoteRepo) Update(ctx context.Context, id int64, n *model.Note) (*model.Note, error)
func (r *NoteRepo) UpdateProperties(ctx context.Context, id int64, fields map[string]any) (*model.Note, error)
func (r *NoteRepo) SoftDelete(ctx context.Context, id int64) error
func (r *NoteRepo) Duplicate(ctx context.Context, id int64, authorID int64) (*model.Note, error)
func (r *NoteRepo) FindForAdmin(ctx context.Context, f AdminNoteFilter) ([]noteListRow, int64, error)
func (r *NoteRepo) ReplaceTags(ctx context.Context, noteID int64, tagNames []string) error
func (r *NoteRepo) ReplaceLinks(ctx context.Context, noteID int64, links []ParsedNoteLink) error
func (r *NoteRepo) FindBackLinks(ctx context.Context, noteID int64) ([]dto.NoteLinkItem, error)
```

查询要求:

- 列表投影不使用 `SELECT *`; 只取列表需要列。
- 详情可以取完整 content_markdown。
- `FindOwnership` 只取 `author_id`。
- 动态 update 必须有列白名单。
- 搜索 tags 时避免 N+1; 可用 `array_agg` 或一次性批量查询 tags 后组装。

## 7. Service 合约

服务层负责业务语义, handler 只做绑定/参数解析:

- 标题自动生成。
- sourceType 默认值和白名单校验。
- word_count 计算。
- inline `#tag` 提取与去重。
- `[[note title]]` 解析。
- 保存后重建 tags 和 links。
- 自动保存 Redis key 管理。
- duplicate 标题生成, 例如 `{title} 副本`。
- ownership/admin 校验前置。

标题生成规则:

1. request title trim 后非空: 使用 title。
2. contentMarkdown 第一条非空行去 Markdown 标记后非空: 取前 60 字符。
3. 否则: `未命名笔记 YYYY-MM-DD HH:mm`。

tag 规范:

- trim。
- 去掉开头 `#`。
- 空值过滤。
- 单条最长 80。
- 去重。

link 规范:

- 匹配 `[[...]]`。
- 去掉首尾空白。
- 空目标过滤。
- 同一 source 内重复 link 可保留一次。

## 8. Handler 合约

`NoteHandler` 只提供 `MountAdmin`:

```go
func (h *NoteHandler) MountAdmin(g *echo.Group) {
    g.GET("", h.AdminList)
    g.GET("/:id", h.AdminGet)
    g.POST("", h.Create)
    g.PUT("/:id", h.Update)
    g.PATCH("/:id/properties", h.UpdateProperties)
    g.POST("/:id/auto-save", h.AutoSave)
    g.DELETE("/:id", h.Delete)
    g.POST("/:id/duplicate", h.Duplicate)
    g.GET("/folders", h.ListFolders)
    g.POST("/folders", h.CreateFolder)
    g.GET("/tags", h.ListTags)
    g.GET("/:id/backlinks", h.BackLinks)
}
```

注意 route 顺序:

- Echo 的静态路径和参数路径需要避免冲突。
- `/folders`、`/tags` 应放在 `/:id` 之前, 或拆到 `/note-folders` / `/note-tags` 独立 group。
- 推荐实现时优先将 folders/tags 拆成 `/v1/admin/note-folders` 与 `/v1/admin/note-tags`, 可避免 `/:id` 路由歧义。

最终推荐:

```text
/v1/admin/notes
/v1/admin/note-folders
/v1/admin/note-tags
```

这样 REST 边界更清晰, 也避免 `GET /notes/folders` 被 `/:id` 捕获。

## 9. 权限合约

首版默认:

- ADMIN 可管理所有 notes。
- AUTHOR 不默认开放。
- 写操作不弱于 admin posts。

RBAC seed:

```sql
INSERT INTO permissions (code, module, action, name, description) VALUES
    ('content.notes.manage', 'content', 'notes.manage', '管理智能笔记', '创建、编辑、归档和删除智能笔记')
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    action = EXCLUDED.action,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'content.notes.manage'
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;
```

如果批准 AUTHOR 使用:

- 增加 AUTHOR role permission。
- 所有查询默认限制 `author_id = current_user_id`, ADMIN 可全局管理。
- 这会扩大实现范围, 不作为默认批准路径。

## 10. 测试合约

后端测试建议:

- `CreateNote` 空 title + 非空 content 生成标题。
- `CreateNote` 空 title + 空 content 生成默认标题。
- `CreateNote` 非法 sourceType 返回错误。
- `FindForAdmin` 默认排除 deleted。
- `FindForAdmin` archived 过滤正确。
- `FindForAdmin` keyword 能匹配 title/content。
- `UpdateProperties` 拒绝非法列。
- `AutoSave` 使用 `note:draft:` 前缀。
- `SoftDelete` 不物理删除。
- `ReplaceTags` 不污染文章 tags。
- `ReplaceLinks` 能写入 unresolved target_title。

前端类型门禁:

```bash
pnpm --filter @aetherblog/admin typecheck
```

后端门禁:

```bash
cd apps/server-go && go test ./... -v
cd apps/server-go && go build ./...
```

隔离搜索:

```bash
rg -n '/v1/public/notes|public.Group\\(\"/notes\"\\)|MountPublic\\(.*Note|notes' apps/blog apps/server-go/internal/server.go
```

验收时可接受:

- `apps/blog` 中没有 notes 运行时代码。
- server.go 只出现 admin notes 挂载。
- 没有 `MountPublic` notes。

## 11. 合约中的开放点

需要批准或实施前最终确认:

1. 是否首版创建 `note_embeddings` 实表。
   - 默认建议: 若 pgvector 已稳定启用则创建; 否则只保留 notes.embedding_status。
2. 是否 AUTHOR 可用。
   - 默认建议: 不开放, 首版 ADMIN only。
3. note folders/tags 路由是嵌套在 `/notes` 还是拆独立 group。
   - 默认建议: 拆为 `/note-folders` 和 `/note-tags`, 避免 Echo `/:id` 歧义。

