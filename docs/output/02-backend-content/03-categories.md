# 03 · Categories（分类）

> 分类是文章的导航骨架。一篇文章最多 1 个分类（`posts.category_id` 单列外键），分类之间通过 `parent_id` 形成多级树。

---

## 1. 责任范围

- 分类 CRUD（含树形 List）。
- Slug 自动生成与唯一性校验。
- 父子关系 / 排序权重 / 封面图 / 图标。
- 删除前置检查（分类下有文章则拒绝）。
- 触发器自动维护 `categories.post_count`（**这是与 tags 的关键差异**）。

---

## 2. 关键代码入口

### Handler 层
- `apps/server-go/internal/handler/category_handler.go:14-115` — 全部 CRUD。
- `apps/server-go/internal/handler/category_handler.go:22-33` — `MountAdmin` 与 `MountPublic`。

### Service 层
- `apps/server-go/internal/service/category_service.go:22-28` — `ListTree`（递归构建树）。
- `apps/server-go/internal/service/category_service.go:46-66` — `Create`。
- `apps/server-go/internal/service/category_service.go:100-110` — `Delete`（含 ExistsPostsInCategory 前置检查）。
- `apps/server-go/internal/service/category_service.go:148-166` — `buildTree`（O(n²) 朴素递归）。

### Repository 层
- `apps/server-go/internal/repository/category_repo.go:21-25` — `FindAll`（按 sort_order ASC, id ASC）。
- `apps/server-go/internal/repository/category_repo.go:59-64` — `ExistsPostsInCategory`（删除前置）。

---

## 3. 路由表

| 方法 | 路径 | Handler | 鉴权 | 备注 |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/categories` | `List` | JWT + admin | 树形（含 children 嵌套） |
| GET | `/api/v1/admin/categories/:id` | `Get` | JWT + admin | |
| POST | `/api/v1/admin/categories` | `Create` | JWT + admin | |
| PUT | `/api/v1/admin/categories/:id` | `Update` | JWT + admin | |
| DELETE | `/api/v1/admin/categories/:id` | `Delete` | JWT + admin | 分类下有文章则 400 |
| GET | `/api/v1/public/categories` | `ListPublic` | 公开 | **扁平**列表（不嵌套），供前端导航菜单使用 |

> **设计差异：** admin 拿树（递归），public 拿扁平。前端如果需要前台树形菜单，要么改 handler 加 `?tree=true`，要么自己拼。

---

## 4. 数据流

### 4.1 ListTree（admin）
```
GET /admin/categories
   |
   v
category_service.go:22 ListTree
   ├─ category_repo.go:21 FindAll    (按 sort_order ASC, id ASC)
   |
   v
buildTree(all, nil)        ← parentID=nil 收集顶级
   ├─ 遍历 all
   ├─ 顶级判定：c.ParentID == nil
   ├─ 命中 → 递归 buildTree(all, &c.ID) 收集子树
   |
   v
return []CategoryVO  (含 Children 嵌套)
```

> **复杂度：** `buildTree` 是 O(n²)（每层都重新扫整个 all 列表）。在分类数 < 100 完全无感；超过 1000 分类才需要优化为 O(n) 的 hash map 一次构建。当前 admin 场景预期分类数小于 50，可忽略。

### 4.2 Delete
```
DELETE /admin/categories/:id
   |
   v
category_service.go:100 Delete
   ├─ ExistsPostsInCategory(id)
   |    └─ SELECT COUNT(*) FROM posts WHERE category_id=$1 AND deleted=false
   ├─ 若 hasPosts → return errors.New("该分类下存在文章，无法删除")
   |
   v
category_repo.go:92 Delete  (DELETE FROM categories WHERE id=$1)
   └─ FK ON DELETE SET NULL: posts.category_id 自动置空
   └─ FK ON DELETE SET NULL: 子分类的 parent_id 自动置空（变成顶级分类）
```

---

## 5. DB 表

### categories（`migration 000001:48-60`）

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| id | BIGSERIAL | | PK |
| name | VARCHAR(100) | | 必填 |
| slug | VARCHAR(100) UNIQUE | | URL 别名 |
| description | TEXT | NULL | |
| cover_image | VARCHAR(500) | NULL | URL 字符串 |
| icon | VARCHAR(100) | NULL | emoji 或图标类名 |
| parent_id | BIGINT FK | NULL | → categories.id (SET NULL，自引用) |
| sort_order | INT | 0 | 显示排序，**数值小靠前** |
| post_count | INT | 0 | **由触发器维护**（与 tags 不同） |
| created_at / updated_at | TIMESTAMP | NOW() | trigger 自动更新 |

索引：`idx_categories_slug` / `idx_categories_parent` / `idx_categories_sort_order`。

---

## 6. 触发器（重点）

`migration 000001:395-422` 的 `update_post_counts()`:
- 监听 `posts` 表的 INSERT / UPDATE / DELETE。
- 仅更新 `categories.post_count`（**不更新 tags.post_count**）。
- 触发条件：
  - INSERT：仅当 `NEW.status='PUBLISHED' AND NEW.deleted=false` 且有 `category_id`。
  - UPDATE：当 `OLD.status != NEW.status OR OLD.deleted != NEW.deleted`。
  - DELETE：必触发（重算 OLD.category_id 的 post_count）。
- 实现：子查询 `SELECT COUNT(*) FROM posts WHERE category_id=... AND status='PUBLISHED' AND deleted=false`。

> **怪味：** 如果文章从分类 A 移到分类 B（`UPDATE category_id`），触发器**不监听** category_id 变化（条件只判断 status 与 deleted），所以 A 的 post_count 仍包含已迁走的文章，B 的 post_count 不包含新到的文章。需要手动重算或在 service 层补偿。

修复方案（如有需要）：
```sql
-- 在触发器条件里增加
IF OLD.category_id IS DISTINCT FROM NEW.category_id THEN
    -- 重算 OLD.category_id 与 NEW.category_id
END IF;
```

---

## 7. 关键决策与怪味

### 7.1 sort_order 由人工设置，无自动重排
`CategoryRequest.SortOrder` 由前端传，新建分类如果不指定，默认 0。多个 sort_order=0 的分类按 ID 排（`FindAll` 的 `ORDER BY sort_order ASC, id ASC`）。前端添加分类时若不强制要求 sort_order，会全部挤在前面。

### 7.2 父子关系无环检查
`Update` 允许把 `parent_id` 改为任意值，**不阻止"自指 parent_id=id"或"形成环"**。一旦形成环，`buildTree` 的递归会**永远出不来**（O(n²) → 死循环），admin 列表卡死。

修复（service 层）：
```go
// 检查 newParent 不在 self 的子树里
if newParentID != nil {
    descendants, _ := s.repo.GetDescendantIDs(ctx, id)
    if contains(descendants, *newParentID) || *newParentID == id {
        return errors.New("不允许的父分类（会形成环）")
    }
}
```

### 7.3 删除不级联子分类
父分类删除时，`parent_id` 是 `ON DELETE SET NULL`，子分类**自动晋升为顶级分类**，不会一起被删。这是合理的（避免误删一层就丢一棵子树），但前端 UI 应提示用户。

### 7.4 公开端列表是扁平的
`ListFlat`（`category_service.go:113-123`）直接把 `FindAll` 结果转 VO 列表，不构建树。前端如要在博客前台展示嵌套菜单，要么自己 group by parent_id，要么改 handler。

### 7.5 categories 与 tags 的设计差异
| 维度 | categories | tags |
| --- | --- | --- |
| 与文章关系 | 1:N（posts.category_id 单列） | M:N（post_tags 关联表） |
| 删除策略 | 前置检查（有文章拒绝） | CASCADE（直接清关联） |
| post_count | 触发器维护 | stale 列 |
| 树形结构 | 是（parent_id 自引用） | 否（扁平） |
| sort_order | 是 | 无 |
| Public API 形态 | 扁平 list | **无独立列表 API** |

---

## 8. 配置 / 环境变量

无专属配置。

---

## 9. 与其他模块耦合

| 方向 | 模块 | 接触面 |
| --- | --- | --- |
| 被依赖 | PostService | `PostRepo` 多处 LEFT JOIN categories；`enrichDetail` 从 `catRepo.FindByID` 拉名 |
| 被依赖 | Public site | `SiteHandler` 注入 `catRepo` |
| 数据库联动 | posts 触发器 | `update_post_counts` 写 categories.post_count |

---

## 10. 已知限制

1. **trigger 不监听 category_id 变化**（详 §6 怪味）。
2. **Update 不防环**（详 §7.2）。
3. **buildTree O(n²)**（详 §4.1，分类多了会慢）。
4. **slug 生成不保留 CJK**：`generateSlugFromName`（`category_service.go:137-144`）只 ToLower + Replace 空格，CJK 名称的 slug 会保留 CJK 但带空格全部转为 `-`，URL 末端会出现 `%XX` 编码。如要 URL 友好建议手动指定 slug。
5. **Update 不复用 trigger**：trigger_update_post_counts 监听的是 posts 表，与 categories 表的 Update 无关；改名/改 sort_order 不会触发任何后续动作。
6. **`Public/categories` 不带 children**：前端要在客户端构建嵌套结构，否则只能扁平显示。
7. **DELETE 报 400 而不是 409 Conflict**：服务返回的 error string 直接映射到 BadRequest，对 REST 客户端不友好。

---

## 11. 测试覆盖

无。`category_*_test.go` 全部不存在。

人工验收路径：
- 创建子分类 → 父分类树展示 children 正确。
- 删除分类下有文章 → 返回 400 + "该分类下存在文章"。
- 删除分类下无文章 → 子分类晋升顶级。
- 文章 publish 后 → categories.post_count + 1。
- 文章 archive → post_count - 1。
