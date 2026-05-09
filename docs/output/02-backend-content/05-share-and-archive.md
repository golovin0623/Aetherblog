# 05 · Share & Archive（分享与归档）

> **核心声明（必读）：** 当前代码库中**没有"文章分享"实现**。`share_handler.go` / `share_service.go` / `share_repo.go` / `media_shares` 表全部针对**媒体文件 / 文件夹**，挂在 `/admin/media/shares/*` 路由组下。本文档仍按任务范围把它们记录下来作为对照，但**它们不属于内容模块**，建议读者去看媒体模块文档。
>
> 真正属于内容模块的"分享"其实是 `posts.password` 字段（详 `01-posts.md`）+ slug 公开 URL；任何人拿到 `/posts/:slug` URL + 密码就能访问。

---

## A. Archive（归档）

### A.1 责任范围

- 已发布文章按"YYYY-MM"分组的归档。
- 每月发文计数（用于侧边栏 mini histogram）。
- 路由挂在公开端 `/api/v1/public/archives/*`。

### A.2 关键代码入口

#### Handler 层
- `apps/server-go/internal/handler/archive_handler.go:11-40` —— 全部 41 行，最薄的 handler。

#### Service 层
- `apps/server-go/internal/service/post_service.go:499-517` — `GetArchives`（map[YYYY-MM]→items）。
- `apps/server-go/internal/service/post_service.go:520-530` — `GetArchiveStats`（[]{yearMonth, count}）。

#### Repository 层
- `apps/server-go/internal/repository/post_repo.go:456-463` — `FindArchiveStats`（按月聚合 COUNT）。
- `apps/server-go/internal/repository/post_repo.go:467-485` — `FindArchivePosts`（按月分组返回完整文章）。

### A.3 路由表

| 方法 | 路径 | Handler | 鉴权 |
| --- | --- | --- | --- |
| GET | `/api/v1/public/archives` | `List` | 公开 |
| GET | `/api/v1/public/archives/stats` | `Stats` | 公开 |

### A.4 数据流

```
GET /public/archives
   |
   v
archive_handler.go:24 List
   |
   v
post_service.go:499 GetArchives
   ├─ post_repo.go:467 FindArchivePosts
   |    └─ SELECT *, TO_CHAR(published_at, 'YYYY-MM') AS year_month
   |       FROM posts WHERE deleted=false AND status='PUBLISHED' AND is_hidden=false
   |       ORDER BY published_at DESC
   |    └─ 内存里 group by year_month → map[string][]Post
   |
   v
转 ArchiveItem  (id, title, slug, date='YYYY-MM-DD')
   |
   v
return map[string][]ArchiveItem
```

### A.5 DB 操作

**没有专属归档表**。归档完全是 posts 表的派生视图：
- `TO_CHAR(published_at, 'YYYY-MM')` 在 SQL 端做格式化。
- 内存里聚合（`m[ym] = append(m[ym], p)`）。

migration 000001:441-449 提供了一个 `v_post_archives` 视图，**但当前代码不用**：
```sql
CREATE OR REPLACE VIEW v_post_archives AS
SELECT 
    EXTRACT(YEAR FROM published_at)::INT as year,
    EXTRACT(MONTH FROM published_at)::INT as month,
    COUNT(*) as post_count
FROM posts
WHERE status = 'PUBLISHED' AND deleted = FALSE
GROUP BY year, month
ORDER BY year DESC, month DESC;
```
代码里走的是 `TO_CHAR + GROUP BY year_month` 的等价 SQL（`post_repo.go:458-462`）。

### A.6 关键决策与怪味

#### A.6.1 月份 key 用字符串 `YYYY-MM` 而非两字段
- 优点：JSON 直接当 map key 序列化方便。
- 缺点：前端排序得自己 sort string；2024-09 和 2024-10 字符串比较没问题，但跨千年会断（远期问题）。

#### A.6.2 `GetArchives` 不分页
拉所有已发布文章的 (id, title, slug, date) 字段。1000 篇文章约 100KB JSON，可接受；上万就慢。
- 修复方案：默认只返回最近 12 个月，传 `?year=2024` 才拉全年。

#### A.6.3 ArchiveItem 字段精简
只含 `id / title / slug / date`，不带 cover_image / summary。前端归档页显示卡片要再调 `/posts/:slug` 拉详情（除非只显示标题列表）。

#### A.6.4 stats 与 list 的语义不一致
- `Stats` 返回 `[]ArchiveStats { yearMonth, count }`（数组，按月份倒序）。
- `List` 返回 `map[YYYY-MM][]ArchiveItem`（字典，无顺序）。
- 前端要构建侧栏 + 主体，需要两个调用 + 自己合并。

#### A.6.5 排除规则与前台列表保持一致
- `deleted=false`、`status='PUBLISHED'`、`is_hidden=false`。
- 没有 `published_at IS NOT NULL` 校验（理论上 PUBLISHED 文章 published_at 不会为 NULL，但若 admin 通过 PATCH UpdateProperties 强行清空 published_at，会导致 `TO_CHAR(NULL, ...)` 返回 NULL，进 map 的 key 是空字符串）。

### A.7 与其他模块耦合

| 方向 | 模块 | 接触面 |
| --- | --- | --- |
| 依赖 | PostService | `GetArchives` / `GetArchiveStats` 直接复用 |
| 共享表 | posts | 无独立表 |

### A.8 已知限制

1. `GetArchives` 全量拉（详 A.6.2）。
2. ArchiveItem 字段薄（A.6.3）。
3. published_at 为 NULL 时 key 是空字符串（A.6.5）。
4. 无客户端缓存（response 不含 `Cache-Control` 头）。

### A.9 测试覆盖

无。

---

## B. Share（分享）

### B.1 关键事实重申

`share_handler.go` 全部针对**媒体**：
- 路由：`/admin/media/shares/file/:fileId`、`/admin/media/shares/folder/:folderId`、`/admin/media/shares/:shareId`。
- 服务于 `media_shares` 表（`migration 000011_add_permissions_and_sharing.up.sql`）。
- 与文章无任何耦合。

### B.2 文章如何"分享"

文章本身的"受控分享"靠 `posts.password` 字段：
- admin 在 `/admin/posts` 设置访问密码 → bcrypt 哈希存 `posts.password`。
- 公开 URL `/posts/:slug` 仍可见（只是 `content` 字段为空 + `passwordRequired=true`）。
- 访客在前端输入密码 → POST `/public/posts/:slug/verify-password` → 后端 bcrypt 比对（`post_service.go:417`）。
- 通过后 detail 含完整 content。

**没有的功能：**
- 一次性 link / 限次访问 link（媒体 share 有 `max_access_count`，文章没有）。
- 过期时间（媒体 share 有 `expires_at`）。
- 公开 URL 不变（无独立 share token，密码就是访问凭证）。

### B.3 为什么这样设计

- 博客文章的本质是"公开内容"，密码保护是边缘需求（草稿协作 / 内部公告）。
- 完整的 share token + 过期 + 限次需要新表，工程量比"加个 password 字段" 大得多。
- 当前实现已经覆盖 90% 用例（"给老婆看一段没准备好公开的草稿"）。

### B.4 如要补全文章 share token 系统

需要：
1. 新表 `post_shares(id, post_id FK CASCADE, share_token UNIQUE, access_type, expires_at, max_access_count, password_hash, created_by, created_at, access_count)`。
2. 新 handler `PostShareHandler` 挂 `/admin/posts/:postId/shares`。
3. 新公开路由 `/public/share/post/:token` 替代 slug 方式。
4. PostService.GetByShareToken。

参考实现就在 ShareService.CreateFileShare（`share_service.go:30-67`）—— 把 `media_file_id` 换成 `post_id` 即可几乎照抄。

### B.5 share_handler 的安全要点（媒体侧，仅备查）

- VULN-044：`GetSharesByFile` 必须校验调用者是文件 uploader（`share_handler.go:99-109`），否则任何登录用户能枚举他人 share_token。
- VULN-037：Update / Delete 校验 `share.created_by` ownership，admin / 创建者放行。
- 密码 bcrypt 加密（`share_service.go:54-60`）。
- share_token 来自 `crypto/rand` 32 字节十六进制（64 字符）。

详细见媒体模块文档。

### B.6 已知限制（媒体 share，仅备查）

1. `media_shares` 没有 `last_accessed_at`，难以判断"该清理的废弃链接"。
2. `access_count` 仅 INSERT 时写入 0，**没有公开访问端点 +1 它**——计数永远是 0。
3. 过期时间字段是 TIMESTAMP，无定时 GC 任务。

### B.7 测试覆盖

无。

---

## C. 路由总览（区分对照）

| 路径前缀 | 归属 | 与本模块关系 |
| --- | --- | --- |
| `/api/v1/public/archives` | 内容模块 | **本模块** |
| `/api/v1/public/posts/:slug/verify-password` | 内容模块 | **本模块**（密码"分享"） |
| `/api/v1/admin/media/shares/*` | 媒体模块 | 不属于本模块 |
| `/share/<token>` | 媒体模块（前端展示路由） | 不属于本模块 |

> 如果 PR 描述中说 "增强分享"，先确认它的目标对象（文章 vs 媒体），别看到路径里 share/post/file 字样就误判。

---

## D. 设计反思（建议）

1. **统一 share 抽象**：长期看，post 与 file 的 share 几乎是同一种业务（密码 + 过期 + 限次 + token），可以抽象到 `share` 通用表 + `share_target_type ('post','file','folder')`。当前分裂在两套表是历史包袱。

2. **archive 加 cache**：归档列表内容更新慢（每月一次），可加 30 分钟 in-memory cache 或 Redis cache。

3. **archive_handler 太薄**：把 ArchiveHandler 删了，把它的两个端点直接挂到 PostHandler 也许更内聚。但拆开了"公开 URL surface area" 的语义边界更清，这是品味之争。
