# 04 · 媒体标签与按标签检索

> 描述:`media_tags` + `media_file_tags` 关联表 + `MediaTagService` 完整 CRUD,支持 SYSTEM/AI_DETECTED/CUSTOM 三类。
> 关键文件:`internal/handler/media_tag_handler.go` · `internal/service/media_tag_service.go` · `internal/repository/media_tag_repo.go` · `internal/model/media_tag.go`。
> 路由前缀:`/api/v1/admin/media/tags` 与 `/api/v1/admin/media/files/:fileId/tags`。

---

## 1. 责任范围

| 子能力 | 说明 |
| --- | --- |
| 标签管理 | 列表 / 热门 / 搜索 / 创建 / 删除 |
| 文件-标签关联 | 单文件多标签 / 单标签多文件批量打标 |
| usage_count 维护 | 每次 Tag/Untag 自动 INCR/DECR 标签的使用计数 |
| 来源标记 | `MANUAL` / `AI_AUTO` / `AI_SUGGESTED`(关联表 source 字段) |

**不在本模块的:** 按标签**筛选**媒体列表 — `MediaRepo.FindForAdmin`(`media_repo.go:88`)目前**不支持** tag 过滤,前端要做 tag 筛选只能多调一次 `GetFileTags` 然后客户端 join。

---

## 2. 关键代码入口

| 入口 | 文件 / 行 | 备注 |
| --- | --- | --- |
| GetAll | `media_tag_handler.go:57` → `service.GetAll:23` | 按 usage_count DESC + name ASC |
| GetPopular | `media_tag_handler.go:67` → `service.GetPopular:33` | 默认 limit=20 |
| Search | `media_tag_handler.go:78` → `service.Search:45` | name / slug ILIKE,关键词必填 |
| Create | `media_tag_handler.go:91` → `service.Create:55` | slug 自动生成,默认 color `#6366f1` 默认 category `CUSTOM` |
| Delete | `media_tag_handler.go:104` → `service.Delete:82` | 物理删除,关联表走 ON DELETE CASCADE |
| GetFileTags | `media_tag_handler.go:117` → `service.GetFileTags:87` | INNER JOIN media_file_tags |
| TagFile | `media_tag_handler.go:131` → `service.TagFile:97` | 入口校验 ownership,逐 tagID 检查重复后插入 |
| UntagFile | `media_tag_handler.go:157` → `service.UntagFile:119` | ownership 校验,DECR usage_count |
| BatchTag | `media_tag_handler.go:178` → `service.BatchTag:136` | 单标签批量打到多个文件;**没有 ownership 校验** |
| repo Create | `media_tag_repo.go:56` | RETURNING id, created_at, updated_at |
| repo TagFile | `media_tag_repo.go:85` | INSERT 关联 + ON CONFLICT DO NOTHING(幂等) |
| repo IncrementUsageCount | `media_tag_repo.go:101` | UPDATE 原子加减 |
| repo CountFileTag | `media_tag_repo.go:108` | 检查关联是否已存在 |
| slug 生成 | `media_tag_service.go:186` `slugify` | 与 folder 不同:**保留 `>127` 的多字节 rune**(中文不丢) |

---

## 3. 数据流(单文件打 3 个标签)

```
POST /api/v1/admin/media/files/42/tags
{ "tagIds": [10, 11, 12] }

┌─────────────────────────────────────────────────────────────┐
│ MediaTagHandler.TagFile (media_tag_handler.go:131)           │
│   • fileID = 42                                             │
│   • assertFileOwnership(c, 42)  ← VULN-041                  │
│       └─ mediaSvc.GetUploaderID(ctx, 42)                    │
│           → (found=true, uploaderID=*int64)                 │
│       └─ middleware.AssertOwnership(c, uploaderID)          │
│           ├─ admin → 放行                                    │
│           └─ uploaderID == lu.UserID → 放行                 │
│   • bind req.TagIDs = [10,11,12]                            │
│   • call svc.TagFile(ctx, 42, [10,11,12], &lu.UserID)       │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ MediaTagService.TagFile (media_tag_service.go:97)             │
│   for tagID in [10, 11, 12]:                                 │
│     n = repo.CountFileTag(42, tagID)                         │
│     if n > 0: continue   // 幂等                             │
│     repo.TagFile(42, tagID, &createdBy)                      │
│       └─ INSERT ON CONFLICT DO NOTHING                       │
│     repo.IncrementUsageCount(tagID, +1)                      │
│       └─ UPDATE media_tags SET usage_count = usage_count +1  │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
response.OKEmpty(c)  → {code:200, data:null}
```

**注意点:**
1. 检查重复关联用 `CountFileTag`(返回 0 或 1)在 service 层先于 INSERT 走一次 query —— 然后又用了 ON CONFLICT,**双重保险**。代价:每个 tagID 多一次 SELECT,3 个标签 = 6 次 DB 调用。
2. INCR 没在事务中 —— 中途 INSERT 成功但 INCR 失败,会让 usage_count 短缺,但不会让 INSERT 回滚。低概率,无功能影响(usage_count 只用于排序展示)。
3. **没有批量插入**(单 SQL VALUES 多 row):每个 tagID 三次 DB query,3 个标签 = 6 个 query。

---

## 4. 标签来源(source)语义

`media_file_tags.source` 是关联表上的字段(`migrations/000008:30`):

```sql
source VARCHAR(20) DEFAULT 'MANUAL',
CONSTRAINT chk_tag_source CHECK (source IN ('MANUAL', 'AI_AUTO', 'AI_SUGGESTED'))
```

| 来源 | 触发场景 |
| --- | --- |
| `MANUAL` | admin 在 UI 主动打的标签;`repo.TagFile`(`media_tag_repo.go:85`)硬编码 `'MANUAL'` |
| `AI_AUTO` | AI 服务自动打的"高置信度"标签 — **当前代码没人写这个 source**,字段在 schema 里但没 INSERT 语句产出 |
| `AI_SUGGESTED` | AI 服务"建议但未确认"的标签 — **同样无 INSERT 路径** |

**结论:** AI 自动打标的能力**目前未实现**。`media_tags.category='AI_DETECTED'` 配合 `media_file_tags.source='AI_AUTO'/'AI_SUGGESTED'` 是 schema 预留,但 service 层没接通 AI 模块。

---

## 5. usage_count 维护

`media_tag_service.go:97-115` `TagFile` 流程:

1. 检查关联存在 → 是 → skip;
2. INSERT 关联;
3. `IncrementUsageCount(tagID, +1)`。

`UntagFile`(`media_tag_service.go:119`)反向:

1. CountFileTag → 0 → 直接 return(标签关联本就不存在);
2. DELETE 关联;
3. `IncrementUsageCount(tagID, -1)`。

**漂移风险:**
- INSERT 成功但 INCR 失败:usage_count 偏低;
- 用户绕过 service 直接 SQL 删除 `media_file_tags` 行:usage_count 不会 DECR;
- 删除标签时(`Delete`)**不重置或修复 usage_count**,但因为级联 CASCADE 会清掉所有 `media_file_tags` 行,反正 tag 也没了。

**没有自动校准任务** —— 长期运行可能导致 usage_count 与实际关联数不一致;前端只用它来排序,误差不大。

---

## 6. slug 生成(与 folder 区别)

| 函数 | 文件 / 行 | 行为 |
| --- | --- | --- |
| `slugify` | `media_tag_service.go:186` | 保留 `[a-z0-9]` + **多字节 rune (`>127`)**,空格/连字符/下划线 → `-`;空 fallback 为 `tag` |
| `slugifySimple` | `folder_repo.go:131` | 仅保留 `[a-z0-9]`,**多字节 rune 丢弃**;空 fallback 为 `folder-{长度}` |

**为什么不一致:** 标签想保留中文(用户搜"摄影"能命中),folder 当 URL 用所以更严格。**目前 slug 在标签上其实只用作 ILIKE 搜索**,不出现在 URL 中,所以保留 unicode 没破坏什么。

---

## 7. 数据库表 + 字段 + 索引

### 7.1 `media_tags`(migration 000008)

| 字段 | 类型 | 备注 |
| --- | --- | --- |
| `id` | BIGSERIAL PK | |
| `name` | VARCHAR(50) NOT NULL UNIQUE | UI 显示名 |
| `slug` | VARCHAR(50) NOT NULL UNIQUE | URL slug,但实际只用于 ILIKE search |
| `description` | TEXT | |
| `color` | VARCHAR(20) default `#6366f1` | UI 渲染 |
| `category` | VARCHAR(20) default `CUSTOM` | CHECK ∈ {CUSTOM, AI_DETECTED, SYSTEM} |
| `usage_count` | INT default 0 | 缓存值,Tag/Untag 维护 |
| `created_at` / `updated_at` | TIMESTAMP | |

**索引:**
- `idx_media_tags_slug` (slug)
- `idx_media_tags_usage` (usage_count DESC)
- `idx_media_tags_category` (category)

**默认种子(migration 000008):**

```sql
INSERT INTO media_tags (name, slug, category, color) VALUES
('重要', 'important', 'SYSTEM', '#ef4444'),
('草稿', 'draft', 'SYSTEM', '#f59e0b'),
('已发布', 'published', 'SYSTEM', '#10b981'),
('存档', 'archived', 'SYSTEM', '#6b7280');
```

### 7.2 `media_file_tags` 关联表(migration 000008)

| 字段 | 类型 | 备注 |
| --- | --- | --- |
| `media_file_id` | BIGINT FK media_files | ON DELETE CASCADE |
| `tag_id` | BIGINT FK media_tags | ON DELETE CASCADE |
| `tagged_at` | TIMESTAMP default now | |
| `tagged_by` | BIGINT FK users | nil 表示系统操作 |
| `source` | VARCHAR(20) default `MANUAL` | CHECK ∈ {MANUAL, AI_AUTO, AI_SUGGESTED} |
| `PRIMARY KEY (media_file_id, tag_id)` | | 一个 file 一个 tag 只能有一行 |

**索引:**
- `idx_media_file_tags_file` (media_file_id)
- `idx_media_file_tags_tag` (tag_id)
- `idx_media_file_tags_source` (source)

### 7.3 `media_metadata`(同 000008,但目前未使用)

| 字段 | 类型 | 备注 |
| --- | --- | --- |
| `id` / `media_file_id` / `meta_key` / `meta_value` / `meta_type` | ... | 自定义元数据 |
| `UNIQUE (media_file_id, meta_key)` | | |

**当前状态:** 表存在,无任何 service / handler 使用。预留给未来"自定义字段"功能。

---

## 8. 配置 / 环境变量

无独立 env / config 项。

---

## 9. 与其他模块耦合

| 模块 | 关系 |
| --- | --- |
| **MediaService**(§01) | `MediaTagHandler` 持有 `mediaSvc` 引用做 ownership 校验(`mediaSvc.GetUploaderID`) |
| **AI 模块** | schema 已预留 `category=AI_DETECTED` + `source=AI_AUTO/AI_SUGGESTED`,但**当前没有 AI 服务调用 admin API 写标签** |
| **AI 模块(Search)** | search 模块对 post 做向量化,但**不索引 media tag** —— 标签搜索完全本地 ILIKE |
| **VersionService** | 无关联 |
| **Admin UI** | MediaPage 的标签筛选侧栏(目前主要走 `GetPopular` + 手动 join) |

---

## 10. 已知限制

1. **`MediaRepo.FindForAdmin` 不支持 tag 过滤。** 前端要按 tag 筛选只能客户端 join — 大量文件时性能差。修复需要在 SQL 加 `EXISTS (SELECT 1 FROM media_file_tags ft WHERE ft.media_file_id = id AND ft.tag_id IN (...))`。
2. **AI 自动打标未实现。** Schema 字段都到位但没有 service 接通 AI。`media_tags.category=AI_DETECTED` 这条路径目前只能手动 INSERT。
3. **BatchTag 不做 ownership 校验。** `media_tag_handler.go:178` `BatchTag` 没调 `assertFileOwnership` —— 任何 admin 可以给任意 fileID 列表打标。等同于 VULN-041 的 BatchTag 端点遗漏。
4. **usage_count 漂移** 长期可能与实际关联数不一致,无校准任务。
5. **删除 tag 不二次确认。** 直接 `DELETE FROM media_tags WHERE id=?`,关联表 CASCADE 也跟着删 — 用户失误删 SYSTEM 标签会丢所有"已发布"打标。前端应有二次确认,但后端无任何拒绝。
6. **`Search` 用 ILIKE `%keyword%`** — 大表性能差,没建 trigram 索引。tag 数量目前小(几十条),问题不大。
7. **没有 tag 改名**(Update 接口不存在),只能 Delete + Create。改名的代价:所有 `media_file_tags` 关联会因 CASCADE 丢失。
8. **`media_metadata` 表没人用。** Schema 预留但 service 层没实现任何 CRUD。

---

## 11. 测试覆盖说明

**`media_tag_service.go` 没有单元测试。** 整个标签子模块测试覆盖率为 0。

**未覆盖:**
- `TagFile` / `UntagFile` 幂等 / usage_count 维护
- `BatchTag` 边界(空 fileIDs / 重复 tagID)
- `slugify` 多字节 / 边界
- `Search` ILIKE 转义
- ownership 校验链
