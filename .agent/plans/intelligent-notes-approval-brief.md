# AetherBlog 智能笔记批准摘要

更新时间: 2026-05-23  
状态: 批准前评审摘要, 详细设计见 `intelligent-notes-module-design.md`

## 1. 结论

建议批准实施「智能笔记」, 但必须按独立内容域实施, 不得复用 `posts` 表模拟。

推荐批准范围:

- Phase 1 必做: 独立 notes CRUD、后台入口、列表、搜索、分页、新建、编辑、复制、归档、删除、Markdown 编辑器、自动保存、独立标签/文件夹。
- Phase 2 建议同批做: QuickNoteDialog、命令面板入口、`[[双链]]` 解析、反向链接基础数据。理由是这些能力决定笔记体验是否区别于文章, 且不会显著扩大公开暴露风险。
- Phase 3 只做底座: 可以先创建 `note_embeddings` 表和状态字段, 但不承诺首版完成灵境/Agent AI 检索闭环。

不建议批准的做法:

- 把笔记做成隐藏文章。
- 在 `posts` 上新增 note 类型。
- 复用文章分类/标签统计。
- 增加公开 notes API。
- 让首页、归档、分类、标签页或公开搜索读取 notes。

## 2. 原始要求对照

| 原始要求 | 设计响应 | 当前状态 |
| --- | --- | --- |
| 从目前文章体系拆分一类系统分类为笔记管理 | 新建 `notes` 领域, 不复用 `posts` | 已设计 |
| 参照文章管理一样 | 复用文章管理的列表、分页、编辑器、自动保存、复制、删除体验 | 已设计 |
| 不同文章管理在一个体系 | 独立 DB 表、DTO、repo、service、handler、admin route | 已设计 |
| 不显示到首页中 | 不新增 public notes API, 不改前台 getRecentPosts | 已设计 |
| 目录放到后台管理灵境下方 | 在 `INTELLIGENCE` 分组 `/aetherhub` 后新增 `/notes`「智能笔记」 | 已设计 |
| 去掉过多限制和约束 | 移除发布、SEO、评论、密码、阅读量、发布时间、分类必选 | 已设计 |
| 提供简单性和快捷性 | 无标题自动命名、快速记录、搜索优先、标签/文件夹可选 | 已设计 |
| 提供后续 AI 扩展性和底层数据支撑 | `source_*`, `note_links`, `note_embeddings`, chunk/blocks 延后方案 | 已设计 |
| 结合优秀笔记软件设计评审 | 对 Notion、Obsidian、Apple Notes、Evernote、Logseq/Roam、NotebookLM 做取舍矩阵 | 已设计 |
| 批准后开始实施 | 当前没有实现代码变更, 等待批准 | 已遵守 |

## 3. 推荐产品形态

后台导航:

```text
INTELLIGENCE
  灵境
  智能笔记
  智能编排
  写作助手
  ...
```

核心页面:

- `/notes`: 笔记列表。
- `/notes/new`: 新建笔记。
- `/notes/:id/edit`: 编辑笔记。

列表能力:

- 搜索标题/正文/标签。
- 分页。
- 视图: 全部、最近、置顶、未整理、已归档。
- 轻筛选: 文件夹、标签、来源、是否含待办。
- 操作: 新建、快速记录、复制、归档、删除。

编辑能力:

- Markdown 编辑。
- 标题可为空, 自动从首行或时间生成。
- 标签/文件夹可选。
- 自动保存。
- 右侧信息面板保留来源、反链、AI 扩展预留。

## 4. 数据域

首版建议表:

```text
notes
note_folders
note_tags
note_tag_links
note_links
note_embeddings
```

关键边界:

- `notes` 是后台私有内容。
- `note_folders` 不等于文章 `categories`。
- `note_tags` 不等于文章 `tags`。
- `note_embeddings` 不等于 `post_embeddings`。
- 公开搜索默认不读 notes。

## 5. 实施文件清单

后端:

- `apps/server-go/migrations/000054_create_notes.up.sql`
- `apps/server-go/migrations/000054_create_notes.down.sql`
- `apps/server-go/internal/model/note.go`
- `apps/server-go/internal/dto/note.go`
- `apps/server-go/internal/repository/note_repo.go`
- `apps/server-go/internal/service/note_service.go`
- `apps/server-go/internal/handler/note_handler.go`
- `apps/server-go/internal/server/server.go`

前端:

- `packages/types/src/models/note.ts`
- `packages/types/src/index.ts`
- `apps/admin/src/types/note.ts`
- `apps/admin/src/services/noteService.ts`
- `apps/admin/src/pages/NotesPage.tsx`
- `apps/admin/src/pages/notes/CreateNotePage.tsx`
- `apps/admin/src/pages/notes/components/NotePropertiesPanel.tsx`
- `apps/admin/src/pages/notes/components/QuickNoteDialog.tsx`
- `apps/admin/src/App.tsx`
- `apps/admin/src/components/layout/Sidebar.tsx`

原则上不改:

- `apps/blog/app/lib/api.ts`
- `apps/blog/app/lib/services.ts`
- `apps/blog/app/page.tsx`
- `docker-compose*.yml`
- `.env.example`
- `nginx/*`

## 6. 批准默认决策

若你直接回复“批准实施”, 默认按以下决策执行:

1. 只做后台 admin-only 智能笔记, 不做前台页面。
2. 第一版权限只开放 ADMIN。
3. 做 Phase 1 + Phase 2 的最小闭环。
4. 建 `note_embeddings` 基础表和状态字段, 但不接完整 AI 索引/灵境引用。
5. 不增加新的环境变量、Docker 服务或网关规则。
6. 不实现附件 OCR、图谱画布、块级编辑器、协作共享、公开发布。

若你想调整, 建议只在以下点上决策:

- 是否让 AUTHOR 也能使用智能笔记。
- 是否首版暂不建 `note_embeddings` 表。
- 是否把 QuickNoteDialog 放到第二批。

## 7. 实施验收门禁

功能门禁:

- 后台侧边栏「灵境」下方出现「智能笔记」。
- `/notes` 可搜索、分页、过滤、复制、归档、删除。
- `/notes/new` 支持无标题快速创建。
- `/notes/:id/edit` 支持 Markdown 编辑和保存。
- 标签/文件夹可为空。
- 新笔记不出现在首页、文章列表、归档、分类、标签页、公开搜索。

技术门禁:

```bash
pnpm --filter @aetherblog/admin typecheck
cd apps/server-go && go test ./... -v
cd apps/server-go && go build ./...
```

迁移门禁:

- migration up/down 可执行。
- notes 表与 posts 表没有业务外键耦合。
- `deleted=false` 是列表默认条件。

安全门禁:

- 不存在 `/api/v1/public/notes`。
- 来源 URL 只保存文本, 不服务端抓取。
- 删除为软删除。
- 访问控制不弱于现有 admin posts。
- AI 后续读取 notes 时必须显式权限过滤。

## 8. 当前工作区状态

截至本摘要生成时:

- 已完成设计评审文档。
- 已完成批准摘要。
- 未修改 `apps/` 和 `packages/` 中的实现代码。
- 未新增 migration。
- 未运行测试, 因为当前阶段只变更 `.agent/plans/` 下的评审材料。

