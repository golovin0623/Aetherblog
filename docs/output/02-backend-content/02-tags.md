# 02 · Tags（标签）

> 标签是文章的次级元数据，多对多挂在 `post_tags` 关联表。本模块提供 CRUD；AI"existing-aware"标签建议是 AI 模块的能力，但与本模块耦合，单独说明。

---

## 1. 责任范围

- 标签 CRUD（List / Get / Create / Update / Delete）。
- Slug 自动生成与唯一性校验。
- 默认颜色（#6366f1 indigo）。
- **不负责：** AI 标签建议 / merge / 文章关联（关联在 PostService.SetTags）。

---

## 2. 关键代码入口

### Handler 层
- `apps/server-go/internal/handler/tag_handler.go:14-104` — TagHandler 全部端点。
- `apps/server-go/internal/handler/tag_handler.go:20-26` — `MountAdmin` 注册路由。

### Service 层
- `apps/server-go/internal/service/tag_service.go:47-66` — `Create`（含 slug 生成与冲突检查）。
- `apps/server-go/internal/service/tag_service.go:74-97` — `Update`（slug 冲突排除自身）。
- `apps/server-go/internal/service/tag_service.go:106-113` — `generateTagSlug`（ToLower + 空格→连字符）。

### Repository 层
- `apps/server-go/internal/repository/tag_repo.go:21-25` — `FindAll`（按 post_count DESC）。
- `apps/server-go/internal/repository/tag_repo.go:62-70` — `Create`（INSERT RETURNING *）。
- `apps/server-go/internal/repository/tag_repo.go:86-89` — `Delete`（CASCADE 经 post_tags FK）。

---

## 3. 路由表

| 方法 | 路径 | Handler | 鉴权 |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/tags` | `List` | JWT + admin |
| GET | `/api/v1/admin/tags/:id` | `Get` | JWT + admin |
| POST | `/api/v1/admin/tags` | `Create` | JWT + admin |
| PUT | `/api/v1/admin/tags/:id` | `Update` | JWT + admin |
| DELETE | `/api/v1/admin/tags/:id` | `Delete` | JWT + admin |

> **注意：** **公开端没有标签列表接口**。前端 `/tags` 页面拉取标签是通过 SiteHandler 的 `/public/site/*` 端点（详见 SiteHandler，不在本模块）。

---

## 4. 数据流

### Create
```
POST /admin/tags + TagRequest body
   |
   v
tag_handler.go:60 Create
   ├─ bindAndValidate
   |
   v
tag_service.go:47 Create(req)
   ├─ if req.Slug == "" → generateTagSlug(req.Name)
   ├─ FindBySlug → 冲突则 return errors.New("标签 slug 已存在")
   ├─ color = req.Color || '#6366f1'
   |
   v
tag_repo.go:62 Create
   └─ INSERT RETURNING *  (post_count=0)
```

---

## 5. DB 表

### tags（`migration 000001:67-76`）

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| id | BIGSERIAL | | PK |
| name | VARCHAR(50) | | 必填 |
| slug | VARCHAR(50) UNIQUE | | URL 别名 |
| description | TEXT | NULL | 标签描述 |
| color | VARCHAR(20) | '#6366f1' | 十六进制色值 |
| post_count | INT | 0 | **stale 列**，无触发器维护（见 §7） |
| created_at / updated_at | TIMESTAMP | NOW() | trigger 自动更新 |

索引：`idx_tags_slug(slug)` / `idx_tags_post_count(post_count DESC)`。

### post_tags（关联表）见 `01-posts.md` §5。

---

## 6. AI "existing-aware" prompt（migration 000040）

### 6.1 背景
ai-service 的 `tags` 任务以前用 prompt：
> 输出一个 JSON 数组，长度恰好为 {max_tags}

问题：模型每次都新造词，前端无法把"机器学习"统一成"机器学习"（混入"机器学习算法"、"ML"、"machine learning"）。

### 6.2 migration 000040 改造
- 改 `prompt_template`（`apps/server-go/migrations/000040_tags_existing_aware_prompt.up.sql`）。
- 输出格式从扁平数组改为：
  ```json
  {
    "matches": [{"name": "现有标签名", "reason": "..."}],
    "suggestions": ["新标签1", "新标签2"]
  }
  ```
- 新占位符 `{existing_tags}`：由 ai-service 路由层注入（按热度排序，括号内是关联文章数）；空标签库时填 `(无)`。
- 兼容性：旧 LiteLLM provider 拒绝 JSON mode 时，ai-service 的 `_parse_tags_structured` 回退到旧扁平数组解析，**自动按现有标签库分桶**（已存在的标签放 matches，未匹配的放 suggestions）。

### 6.3 与本模块的边界
- backend `TagService` **不读 prompt_template**，不参与提示词管理。
- backend 只接 ai-service 返回的 `(matches, suggestions)`，前端拿到这两个数组后：
  - matches 直接用 ID 关联（前端在 `/admin/tags` 列表里查找 name 匹配项 → tag.id）。
  - suggestions 调 `POST /admin/tags` 创建新标签 → 拿到 ID。
  - 最后通过 `PATCH /admin/posts/:id/properties { tagIds: [...] }` 写关联。
- 因此本模块仍然只是简单 CRUD —— "existing-aware" 智能在 ai-service + 前端编排层。

### 6.4 数据契约（前端使用）
ai-service `/api/v1/admin/ai/tags` 返回（参考 ai_handler 文档）：
```json
{
  "matches": [{ "name": "机器学习", "reason": "文章主要在讨论 RAG" }],
  "suggestions": ["向量数据库"]
}
```
前端把 matches[0].name → 在 `/admin/tags` list 里找 → 取 ID；suggestions[0] → POST 创建 → 取 ID。

---

## 7. 关键决策与怪味

### 7.1 没有合并（merge）功能
TagService 只暴露 Create/Read/Update/Delete。**没有"把 tag-A 合并到 tag-B"的方法**，意味着：
- 文章误标"机器学习算法"和"机器学习"，无法批量合并。
- 唯一办法：逐篇文章 PATCH `tagIds`，再 DELETE 旧标签（经 CASCADE 清 post_tags）。

要补 merge：在 TagService 加方法
```go
func (s *TagService) Merge(ctx context.Context, fromID, toID int64) error {
    return s.repo.Tx(func(tx) error {
        // UPDATE post_tags SET tag_id=$2 WHERE tag_id=$1
        // DELETE FROM tags WHERE id=$1
    })
}
```

### 7.2 `post_count` 列是 stale 数据
- migration 000001 的触发器 `trigger_update_post_counts` 只更新 `categories.post_count`（`migration 000001:395-422`），**不触发 tags.post_count**。
- 新建标签永远 `post_count = 0`（`tag_repo.go:65` INSERT 写死 0）。
- VanBlog 导入路径 (`migration_repo.go`) 可能写过非零值。
- `FindAll` 的 `ORDER BY post_count DESC, id ASC`（`tag_repo.go:23`）实际等同于按 ID 排——所有新建标签都是 0，然后 ID 升序。
- **副作用：** 前端 hot-tags 排序失真。Admin /tags 列表的"使用次数"列也是错的。

修复路径：
- 短期：在 `PostRepo.SetTags` 完成后异步更新涉及的 tag 行 post_count。
- 长期：加 trigger ON post_tags INSERT/DELETE 自动累加。

### 7.3 删除标签 = 删除关联
`DELETE FROM tags WHERE id = $1` 通过 `post_tags` 表的 `ON DELETE CASCADE`（`migration 000001:130`）级联清掉所有文章关联，**没有"二次确认"或前置检查**（不像 categories 那样会 ExistsPostsInCategory 拦截）。
- 与 categories 行为不一致，对运维者可能误伤。
- 设计上的判断：标签是低权重元数据，丢失不致命；分类是导航骨架，丢失影响 URL。

### 7.4 Slug 生成保留 ASCII 但不保留 CJK
对比 `PostService.generateSlug`（`post_service.go:672-692`）保留 CJK 字符（U+4E00 ~ U+9FFF），`tag_service.go:107` 的 `generateTagSlug` 只是 `ToLower + Replace(" ", "-")`，**不去 CJK 字符也不清理特殊符号**。
- 标签 "机器学习" → slug "机器学习"，浏览器会 URL-encode 成 `%E6%9C%BA...`，可用但不优雅。
- 标签 "C++" → slug "c++"，URL-encoded `c%2B%2B`，可能破坏路由（`+` 在 query string 解析为空格）。

### 7.5 颜色无格式校验
DTO `TagRequest.Color` 是 `string`，没有 `validate:"hexcolor"` 之类标签。Service 层只检查 `if color == ""`。可以传任意字符串（如 "indigo"、"red-500"），前端展示时若用 inline style 会被浏览器忽略；用 Tailwind class 会失效。

---

## 8. 配置 / 环境变量

无专属配置。`#6366f1` 是硬编码默认色。

---

## 9. 与其他模块耦合

| 方向 | 模块 | 接触面 |
| --- | --- | --- |
| 被依赖 | PostService | `PostRepo.FindTagsByPostID(s)` 关联查询；`SetTags` 写关联 |
| 被依赖 | AI Service `tags` 任务 | 通过 ai_handler 路由，ai-service 内部读 `tags` 表注入 `{existing_tags}` 占位符 |
| 被依赖 | Public site | `SiteHandler` 的标签云走 `tagRepo.FindAll`（`server.go:254`） |

---

## 10. 已知限制

1. **`post_count` stale**（详 §7.2）。
2. **无 merge 操作**（详 §7.1）。
3. **slug 不规范化 CJK**（详 §7.4）。
4. **Color 无校验**（详 §7.5）。
5. **删除时无前置检查**（详 §7.3）。
6. **没有 GetByName**：repo 提供了 `FindByName`（`tag_repo.go:51-58`）但 service 不调用，AI matches 走 name 模糊匹配是前端职责。
7. **公开端无 tag 列表 API**：必须经过 SiteHandler 的 site.config 一次性吐全。

---

## 11. 测试覆盖

无。`tag_handler_test.go` / `tag_service_test.go` / `tag_repo_test.go` 都不存在。
