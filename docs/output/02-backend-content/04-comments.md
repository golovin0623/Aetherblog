# 04 · Comments（评论）

> 评论系统 5 状态审核流，支持嵌套回复，提交侧含 IP 限流和 XSS 净化。

---

## 1. 责任范围

- 公开评论提交（限流 5/min/IP）。
- 5 状态审核流（PENDING / APPROVED / REJECTED / SPAM / DELETED）。
- 嵌套评论树构建（前台读，按 parent_id 自引用）。
- 文章评论数实时回写（`UpdatePostCommentCount` 异步）。
- 批量审核 / 删除 / 永久删除。
- 防御性 XSS：bluemonday StrictPolicy 净化提交内容。
- 文章可评论性校验（VULN-043：草稿 / 隐藏 / 关闭评论 / 已删的文章拒绝新评论）。

---

## 2. 关键代码入口

### Handler 层
- `apps/server-go/internal/handler/comment_handler.go:21` — `commentSanitizer` 全局 bluemonday 实例。
- `apps/server-go/internal/handler/comment_handler.go:35-55` — `MountAdmin` / `MountPublic`。
- `apps/server-go/internal/handler/comment_handler.go:223-241` — `Submit`（公开提交，含 IP/UA 收集）。

### Service 层
- `apps/server-go/internal/service/comment_service.go:64-77` — `Approve`（含异步 UpdatePostCommentCount）。
- `apps/server-go/internal/service/comment_service.go:180-227` — `Submit`（含 VULN-043 文章状态校验）。
- `apps/server-go/internal/service/comment_service.go:315-352` — `buildCommentTree`（两轮指针挂载）。

### Repository 层
- `apps/server-go/internal/repository/comment_repo.go:36-43` — `FindByPostApproved`（前台读）。
- `apps/server-go/internal/repository/comment_repo.go:55-110` — `findWithFilter`（动态 WHERE 子句）。
- `apps/server-go/internal/repository/comment_repo.go:174-181` — `UpdatePostCommentCount`（重新统计回写）。

---

## 3. 路由表

### 管理端
| 方法 | 路径 | Handler | 说明 |
| --- | --- | --- | --- |
| GET | `/admin/comments` | `AdminList` | 多过滤分页 |
| GET | `/admin/comments/pending` | `Pending` | 仅 PENDING 状态 |
| GET | `/admin/comments/:id` | `AdminGet` | |
| PATCH | `/admin/comments/:id/approve` | `Approve` | → APPROVED |
| PATCH | `/admin/comments/:id/reject` | `Reject` | → REJECTED |
| PATCH | `/admin/comments/:id/spam` | `Spam` | → SPAM |
| PATCH | `/admin/comments/:id/restore` | `Restore` | → PENDING |
| DELETE | `/admin/comments/:id` | `Delete` | 软删（status=DELETED） |
| DELETE | `/admin/comments/:id/permanent` | `PermanentDelete` | 物理删除 |
| DELETE | `/admin/comments/batch` | `DeleteBatch` | body: {ids: []} |
| DELETE | `/admin/comments/batch/permanent` | `PermanentDeleteBatch` | |
| PATCH | `/admin/comments/batch/approve` | `ApproveBatch` | |

注：所有 admin 路由经 `JWT + admin + pwdRotated` 强校验。

### 公开端
| 方法 | 路径 | Handler | 限流 |
| --- | --- | --- | --- |
| GET | `/public/comments/post/:postId` | `ListByPost` | 无 |
| POST | `/public/comments/post/:postId` | `Submit` | 5/min/IP（`server.go:267`） |

---

## 4. 数据流

### 4.1 公开提交流（POST /public/comments/post/:postId）
```
POST + CreateCommentRequest body
   |
   v
middleware.RateLimitByIP("rate:comment", 5, 1m)
   |
   v
comment_handler.go:223 Submit
   ├─ bindAndValidate (DTO: nickname required, email/website 可选, content 1-5000)
   ├─ commentSanitizer.Sanitize(req.Content)   ← bluemonday StrictPolicy 全部 HTML 标签剥离
   ├─ ip = c.RealIP()
   ├─ ua = c.Request().UserAgent()
   |
   v
comment_service.go:180 Submit(postID, req, ip, ua)
   ├─ postRepo.FindByID(postID)
   ├─ VULN-043: 校验
   |    └─ post != nil && !post.Deleted && !post.IsHidden 
   |    └─ post.AllowComment && post.Status == 'PUBLISHED'
   ├─ if req.ParentID != nil:
   |    └─ FindByID(*ParentID) 校验存在 + parent.PostID == postID
   |
   v
comment_repo.go:114 Create
   └─ INSERT + RETURNING id, created_at, updated_at
   |     status='PENDING', is_admin=false 强制写入
   |
   v
return CommentVO
   |
   v
comment_handler.go:240 vo.ToPublic()    ← 丢弃 email/ip/status，返 PublicCommentVO
```

### 4.2 公开读流（GET /public/comments/post/:postId）
```
   |
   v
comment_service.go:168 GetByPost
   ├─ comment_repo.go:36 FindByPostApproved
   |    └─ WHERE post_id=$1 AND status='APPROVED'  ORDER BY created_at ASC
   ├─ buildCommentTree(toCommentVOs(cs))
   |    ├─ 第 1 轮：byID 映射 + 把子节点挂到父节点 .Children
   |    ├─ 第 2 轮：collectTree 递归收集，确保子节点完整挂载
   |
   v
ToPublicCommentVOs(vos)   ← 丢弃 email/ip/status
   |
   v
return {"list": [...]}
```

### 4.3 审核流（Approve）
```
PATCH /admin/comments/:id/approve
   |
   v
comment_service.go:64 Approve
   ├─ FindByID
   ├─ UpdateStatus(id, 'APPROVED')
   ├─ go UpdatePostCommentCount(c.PostID)   ← 异步重算 posts.comment_count
   |
   v
recordCommentActivity('comment.approve', ...)
```

---

## 5. DB 表

### comments（`migration 000001:141-159` + `000004` 扩展状态）

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| id | BIGSERIAL | | PK |
| post_id | BIGINT FK | | → posts.id (CASCADE) |
| parent_id | BIGINT FK | NULL | → comments.id (CASCADE)，自引用 |
| nickname | VARCHAR(50) | | 必填 |
| email | VARCHAR(100) | NULL | |
| website | VARCHAR(200) | NULL | |
| avatar | VARCHAR(200) | NULL | |
| content | TEXT | | 必填，bluemonday 已净化 |
| status | VARCHAR(20) | 'PENDING' | CHECK in (PENDING, APPROVED, REJECTED, SPAM, DELETED) |
| ip | VARCHAR(50) | NULL | |
| user_agent | VARCHAR(500) | NULL | |
| is_admin | BOOL | false | **代码强制写 false**（`comment_service.go:218`） |
| like_count | INT | 0 | **当前无写入路径** |
| created_at / updated_at | TIMESTAMP | NOW() | trigger 自动更新 |

索引：`post_id` / `parent_id` / `status` / `created_at DESC`。

### CHECK 约束变迁
- `migration 000001:158`：`(PENDING, APPROVED, REJECTED, SPAM)`
- `migration 000004`：扩为 `(PENDING, APPROVED, REJECTED, SPAM, DELETED)`，因为软删 = `status='DELETED'`，必须在 enum 里。

---

## 6. 评论树构建（`buildCommentTree` 详解）

`comment_service.go:315-352` 实现得**有点复杂**：

```go
func buildCommentTree(vos []CommentVO) []CommentVO {
    byID := make(map[int64]*CommentVO, len(vos))
    for i := range vos {
        vos[i].Children = nil
        byID[vos[i].ID] = &vos[i]
    }
    // 第 1 轮：用指针把子节点挂到父节点（仅占位）
    var rootIDs []int64
    for i := range vos {
        if vos[i].ParentID != nil {
            if parent, ok := byID[*vos[i].ParentID]; ok {
                parent.Children = append(parent.Children, CommentVO{}) // 占位
                parent.Children[len(parent.Children)-1] = *byID[vos[i].ID]
                continue
            }
        }
        rootIDs = append(rootIDs, vos[i].ID)
    }
    // 第 2 轮：递归 collectTree 重新读 byID 拼出完整结构
    var collectTree func(id int64) CommentVO
    collectTree = func(id int64) CommentVO {
        node := byID[id]
        result := *node
        if len(node.Children) > 0 {
            result.Children = make([]CommentVO, len(node.Children))
            for i, child := range node.Children {
                result.Children[i] = collectTree(child.ID)
            }
        }
        return result
    }
    roots := make([]CommentVO, 0, len(rootIDs))
    for _, id := range rootIDs {
        roots = append(roots, collectTree(id))
    }
    return roots
}
```

**为什么要 2 轮：**
- 第 1 轮单纯 append 子节点时，子节点本身的 Children 可能还没填好（父子顺序与查询顺序不一致），值拷贝会丢后续追加的孙子。
- 第 2 轮在所有 byID 都填完后再递归收集，确保每层都拿到最新状态。

**复杂度：** O(n) 每轮，深度 = 树高。性能在数千评论级别仍 OK。

> **怪味（非显然）：** 第 1 轮 `parent.Children = append(parent.Children, CommentVO{})` 后**立即赋值** `parent.Children[len-1] = *byID[vos[i].ID]`，这一步是值拷贝。当时若被拷贝的 byID[vos[i].ID].Children 还是 nil，第 2 轮 `collectTree(child.ID)` 又通过 byID 拿到带最新 children 的节点重做 —— 完全没问题，但代码可读性差，**第 1 轮的 placeholder 可以简化为 `nil` slice，第 2 轮反正会重写**。

---

## 7. 关键决策与怪味

### 7.1 软删除借用 status 列
不像 posts 有独立 `deleted BOOL` 列，comments **复用 status='DELETED'** 作为软删标志。
- 优点：少一列。
- 缺点：所有过滤都要 `status != 'DELETED'`；CHECK 约束需要含 'DELETED'（migration 000004 修复）。
- **没有"永久软删"语义**：UpdateStatusBatch DELETED 与 PermanentDelete (`DELETE FROM`) 共存，UI 必须区分。

### 7.2 IsAdmin 永远是 false
`Submit` 方法（`comment_service.go:218`）写死 `IsAdmin: false`，即使提交者是登录管理员。
- 实际效果：**前台无法显示"管理员标记"**。
- 修复：需要 handler 层从 `middleware.GetLoginUser` 读出 user role，传给 service。

### 7.3 like_count 无写入路径
DTO 返回 like_count，schema 有列，但**没有 +1 端点**。前台显示永远是 0（VanBlog 导入除外）。

### 7.4 IP 与 UA 进 DB（隐私问题）
- IP 明文存储（`migration 000001:151`）。
- 用户提交评论时无显式同意。
- 国内站点合规上需要 PIPL 同意提示，admin 拉评论列表时 `comment_handler.go:99-105` 直接返回 IP（CommentVO.IP）。
- **风险点：** 如果暴露给非 admin 用户，构成隐私泄漏。当前 `CommentVO` 没有 ToAdmin 包装；CommentHandler 公开端走 `ToPublic()` 已剥离 IP/email，**安全**。但任何新增的 admin handler 直接暴露 CommentVO 都会泄漏。

### 7.5 递归子评论嵌套**无深度限制**
`buildCommentTree` 不限深度。如果有人在前台 reply 链一直建一层一层，DB 会保留全部层级，前端显示会被 nested padding 推到屏外。
- 设计建议：在 service 层把超过 3 层的回复全部挂到第 3 层节点的 Children（"扁平化深层回复"）。

### 7.6 反垃圾仅靠 XSS 净化 + 限流
当前没有：
- 关键词黑名单。
- IP 黑名单。
- Akismet / 第三方反垃圾接入。
- captcha。
所有评论统一走 PENDING 队列，admin 手动批量 spam。
> 适合中小博客，规模化后会成为运维负担。

### 7.7 ListByPost 不分页
`FindByPostApproved` 直接 `SELECT *` 全部已审核评论，**没有 LIMIT/OFFSET**。爆款文章下成千上万条评论会拖慢前台。
- 修复方案：分页 + 子树懒加载（"加载更多回复"）。

### 7.8 Submit 不限内容大小（DTO 已限）
DTO 已经 `validate:"max=5000"`（`dto/comment.go:13`），但请求 body 上限是 Echo 默认（无限）。可以发 5000 字符的内容、10MB 的换行符 ——validator 只看 length 不看 byte。结合限流 5/min，理论压力可控但不优雅。

### 7.9 父评论同文章校验在 service 而非 DB
`comment_service.go:198` 校验 `parent.PostID == postID`，而 DB 没有约束。直接 INSERT 错的 parent_id（跨文章 reply）会通过。设计上由 service 兜底。

---

## 8. 配置 / 环境变量

| 来源 | 用途 |
| --- | --- |
| `cfg.Redis.*` | 限流 token bucket |
| `server.go:267` 硬编码 5/min | 公开提交速率 |

---

## 9. 与其他模块耦合

| 方向 | 模块 | 接触面 |
| --- | --- | --- |
| 依赖 | PostRepo | `Submit` 校验文章状态；`enrichCommentRefs` 拉文章 title/slug |
| 写依赖 | posts.comment_count | `UpdatePostCommentCount` 异步重算 |
| 数据库联动 | posts CASCADE | 删文章自动级联清评论 |
| 被依赖 | Activity | `recordCommentActivity` 写事件 |

---

## 10. 已知限制

1. `is_admin` 永远 false（详 §7.2）。
2. `like_count` 无写入路径（§7.3）。
3. IP 存明文，无同意 / 留存策略（§7.4）。
4. 嵌套深度无限制（§7.5）。
5. 公开列表不分页（§7.7）。
6. 反垃圾依赖 admin 手动审核（§7.6）。
7. `enrichCommentRefs` 在 admin 列表里 N+1 查 post（`comment_service.go:255` 一次循环单查）—— `FindByID` 调用次数 = 当前页不重复 postID 数；如果某次查询命中多种文章，每个文章都走单独 SQL，需要批量化。
8. `UpdateStatusBatch` 调用时**不更新 posts.comment_count**：批量 reject / spam 后文章评论数不刷新，只有单条 Approve/Delete 走 `go UpdatePostCommentCount`。
9. `commentSanitizer` 是 `StrictPolicy`：把所有 HTML 标签都去掉。如果将来想支持 markdown 评论，要替换成 `UGCPolicy` + 自定义白名单，否则 ` ** ** ` `[link](url)` 失效。

---

## 11. 测试覆盖

无。`comment_*_test.go` 全部不存在。

人工验收路径：
- 提交评论 5 次后第 6 次返 429（IP 限流）。
- 提交带 `<script>alert(1)</script>` 的内容，DB 入库被 strip 干净。
- 给已 deleted 文章提交评论返 400 "文章不允许评论或不存在"。
- ParentID 跨文章返 400 "无效的父评论"。
- Approve 后 `posts.comment_count` 增加。
- 嵌套 reply 在前台正确缩进。
