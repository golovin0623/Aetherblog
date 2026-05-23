# AetherBlog 智能笔记评审与验收清单

更新时间: 2026-05-23  
状态: 批准前 checklist, 与 `intelligent-notes-module-design.md` 和 `intelligent-notes-approval-brief.md` 配套使用

## 1. 使用方式

这份清单用于三个阶段:

1. 批准前: 判断设计是否满足原始目标, 是否存在不能接受的产品或安全风险。
2. 实施中: 防止把笔记误做成文章体系的一部分。
3. 验收时: 用真实代码、路由、接口和测试结果逐条证明功能完成。

所有条目在实现后都应能用当前工作区证据证明, 不能只靠口头说明。

## 2. 批准前必须确认

| 检查项 | 通过标准 | 当前设计状态 |
| --- | --- | --- |
| 独立内容域 | 方案使用 `notes`, 不复用 `posts` 或 `posts.is_hidden` | 通过 |
| 后台入口 | 入口位于 `INTELLIGENCE` 分组中 `/aetherhub`「灵境」下方 | 通过 |
| 前台隔离 | 不新增 `/api/v1/public/notes`, 不改首页 recent posts | 通过 |
| 文章能力减法 | 不出现发布、SEO、评论、密码、阅读量、发布时间、公开可见性 | 通过 |
| 简单快速 | 支持无标题创建、自动标题、Markdown、自动保存、快速记录 | 通过 |
| AI 底座 | 设计包含 source 字段、note links、embedding 状态和未来 chunk/blocks 路线 | 通过 |
| 市场借鉴 | 有 Notion、Obsidian、Apple Notes、Evernote、Logseq/Roam、NotebookLM 取舍 | 通过 |
| 实施边界 | 明确 Phase 1/2/3/4, 避免首版过度产品化 | 通过 |
| 安全边界 | 来源 URL 不抓取, notes 不进公开搜索/公开 QA | 通过 |

## 3. 批准后实施防偏清单

实施过程中如出现以下行为, 应立即停止并修正:

- 把笔记存进 `posts`。
- 给 `posts` 增加 `content_type='note'` 之类字段来兼容笔记。
- 让 `notes` 复用文章 `categories` 或 `tags` 统计。
- 在 `apps/blog` 新增 notes 公开 API 调用。
- 新增 `/v1/public/notes` 或 `/v1/collaboration/notes`。
- 把 notes 默认混入公开搜索、公开 QA、首页、归档、分类或标签页。
- 为保存 `source_url` 做服务端抓取。
- 引入新环境变量、Docker 服务、网关规则来支撑首版。
- 在笔记编辑页保留「发布」「SEO」「评论」「密码访问」「浏览量」等文章文案。

## 4. 后端验收证据

实现后需要逐项给出证据:

| 要求 | 证据来源 | 验收标准 |
| --- | --- | --- |
| migration 新增 notes 域 | `apps/server-go/migrations/*create_notes*` | up/down 成对存在, 表名独立 |
| notes 不依赖 posts | migration / model / repo | notes 表无 posts 业务外键 |
| admin-only route | `apps/server-go/internal/server/server.go` | 只挂载 `/v1/admin/notes` |
| 无 public notes | `server.go` / handler 搜索 | 不存在 `/v1/public/notes` |
| DTO 独立 | `apps/server-go/internal/dto/note.go` | 不复用 post DTO |
| repo 默认软删除过滤 | `note_repo.go` | 列表默认 `deleted=false` |
| 创建支持无标题 | service 测试或代码 | title 空时按规则自动生成 |
| 归档不是发布状态 | model / DTO | 使用 `archived` 或 ACTIVE/ARCHIVED, 不使用 PUBLISHED |
| 标签/文件夹独立 | migration / repo | 使用 `note_tags`, `note_folders` |
| 来源 URL 不抓取 | service / handler | 只保存文本, 不调用 HTTP client |
| 权限不弱于 posts | server/middleware/handler | 继承 admin 鉴权, 写操作有权限边界 |

## 5. 前端验收证据

实现后需要逐项给出证据:

| 要求 | 证据来源 | 验收标准 |
| --- | --- | --- |
| 导航位置正确 | `apps/admin/src/components/layout/Sidebar.tsx` | `/notes` 位于 `/aetherhub` 后 |
| 路由独立 | `apps/admin/src/App.tsx` | 存在 `/notes`, `/notes/new`, `/notes/:id/edit` |
| 服务独立 | `apps/admin/src/services/noteService.ts` | 调用 `/v1/admin/notes`, 不调用 postService |
| 类型独立 | `packages/types/src/models/note.ts` | note 类型不扩展 post 类型 |
| 列表比照文章管理 | `NotesPage.tsx` | 搜索、分页、移动/桌面视图、复制、删除/归档 |
| 编辑比照文章编辑器 | `CreateNotePage.tsx` | 使用 Markdown 编辑器、保存、自动保存 |
| 页面减法到位 | UI 代码/截图 | 不显示发布、SEO、评论、密码、浏览量 |
| 快捷体验 | QuickNoteDialog / 新建页 | 无标题快速创建可用 |
| 标签/文件夹可选 | 表单与保存逻辑 | 不填仍可保存 |

## 6. 前台隔离验收证据

实现后需要证明以下文件没有把 notes 接入前台:

- `apps/blog/app/lib/api.ts`
- `apps/blog/app/lib/services.ts`
- `apps/blog/app/page.tsx`
- `apps/blog/app/posts/**`
- 公开搜索相关代码
- 归档、分类、标签页相关代码

建议执行搜索:

```bash
rg -n 'notes|智能笔记|noteService|/v1/public/notes' apps/blog
```

可接受结果:

- 没有结果。
- 或仅有文档/注释式防护说明, 且不产生运行时 API 调用。

## 7. 测试与命令门禁

实施后必须至少执行:

```bash
pnpm --filter @aetherblog/admin typecheck
cd apps/server-go && go test ./... -v
cd apps/server-go && go build ./...
```

建议补充:

```bash
rg -n '/v1/public/notes|public.Group\\(\"/notes\"\\)|MountPublic\\(.*notes' apps/server-go apps/blog
rg -n 'postService|/v1/admin/posts' apps/admin/src/pages/NotesPage.tsx apps/admin/src/pages/notes apps/admin/src/services/noteService.ts
```

若本地数据库可用:

- 执行 migration up。
- 创建一条笔记。
- 搜索笔记。
- 归档笔记。
- 删除笔记。
- 执行 migration down。

若本地数据库不可用:

- 汇报中必须明确说明 migration runtime 未验证。
- 至少证明 SQL 文件命名、up/down 配对、外键和索引语法经过人工审查。

## 8. 最终验收判定

只有同时满足以下条件, 才能认为实施完成:

- 后台「智能笔记」可用。
- 笔记数据不进入文章体系。
- 前台完全不展示 notes。
- 文章管理原有功能没有退化。
- 管理端 typecheck 通过。
- Go 测试和构建通过, 或明确说明与本变更无关的既有失败。
- 安全边界没有放宽。

