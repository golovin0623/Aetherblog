# 02 · 文件夹与权限

> 描述:`media_folders` 物化路径树 + `folder_permissions` 5 级授权 + Upload/Move 入口 `assertFolderWritable` 强制校验。
> 关键文件:`internal/service/folder_service.go` · `internal/repository/folder_repo.go` · `internal/repository/permission_repo.go` · `internal/service/media_service.go:148-209`(`assertFolderWritable`)。
> 重大变更:**PR #647** "云储存优化批次 2" 在 service 层接入 folder_permissions 校验,堵住"任何 admin 都能上传到他人私有文件夹"的漏洞。

---

## 1. 责任范围

`media_folders` 表 + 配套权限模型解决两个问题:

1. **多租户命名空间** — 让不同 admin / contributor 拥有自己的 folder 树,各管各的;
2. **共享授权** — 在 owner-based 之上叠加细粒度授权,允许"folder owner 把 UPLOAD 权限发给某个用户而不交出所有权"。

物理结构:
- 物化路径(`path = "/root/photos/2026"` + `depth`),便于查询整棵子树。
- 唯一根 `id=1`(migration 000007 种入)。
- ON DELETE CASCADE 父删子级;`folder_id` 列在 `media_files` 是 ON DELETE SET NULL(file 不被级联删除)。

---

## 2. 关键代码入口

| 入口 | 文件 / 行 | 备注 |
| --- | --- | --- |
| 树形列表 | `folder_handler.go:33` `Tree` → `FolderService.GetTree:22` | 两遍遍历构造嵌套树 |
| 单个查询 | `folder_handler.go:43` `Get` → `FolderService.GetByID:31` | |
| 直接子节点 | `folder_handler.go:60` `Children` → `FolderService.GetChildren:51` | 不递归 |
| 创建 | `folder_handler.go:74` `Create` → `FolderService.Create:61` → `FolderRepo.Create:61` | 默认 `visibility=PRIVATE` |
| 修改 | `folder_handler.go:93` `Update` | **入口先校验 owner**(VULN-039) |
| 删除 | `folder_handler.go:123` `Delete` | **owner 校验** |
| 移动(改 parent_id) | `folder_handler.go:144` `Move` → `FolderRepo.Move:98` | 重新计算 path/depth |
| 物化路径计算 | `folder_repo.go:113` `computePathDepth` | parent_id nil → 根级 |
| Slug 生成 | `folder_repo.go:131` `slugifySimple` | 只保留 `[a-z0-9]`,空格/连字符/下划线 → `-`,中文丢弃 |
| **写入护栏** | `media_service.go:178` `assertFolderWritable` | Upload/Move 入口前调用 |
| HasWriteAccess | `permission_repo.go:81` | 单条 EXISTS 查询 |
| 权限授予 | `permission_handler.go:56` `Grant` | folder owner 才能 grant |
| 权限撤销 | `permission_handler.go:134` `Revoke` | folder owner 才能 revoke |

---

## 3. 数据流(Upload 写入 PRIVATE 文件夹的越权场景)

```
账号 A 是 folder 12 的 owner;账号 B 是另一个 admin。
B 用自己的 JWT 提交 POST /api/v1/admin/media/upload?folderId=12

┌──────────────────────────────────────────────────────────────────┐
│ MediaHandler.Upload (media_handler.go:102)                       │
│   • 解析 folderId=12 → *int64                                    │
│   • lu.UserID = B → uploaderID                                   │
│   • call svc.Upload(ctx, fh, uploaderID, &12)                    │
└──────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────┐
│ MediaService.Upload (media_service.go:296)                       │
│   ┌───────────────────────────────────────────────────────────┐  │
│   │ assertFolderWritable(ctx, &12, &B.UserID)                  │  │
│   │   1. folderID 非 nil → 继续                                │  │
│   │   2. folderLookup/permLookup 都注入 → 继续                 │  │
│   │   3. folderRepo.FindByID(12) → folder{ID:12, OwnerID:A}    │  │
│   │   4. folder.OwnerID = A,非 nil → 继续                     │  │
│   │   5. uploaderID(B) ≠ OwnerID(A) → 不能短路放行            │  │
│   │   6. permRepo.HasWriteAccess(12, B):                        │  │
│   │       SELECT EXISTS (                                      │  │
│   │         SELECT 1 FROM folder_permissions                   │  │
│   │         WHERE folder_id=12 AND user_id=B                  │  │
│   │           AND permission_level IN (                        │  │
│   │             'UPLOAD','EDIT','DELETE','ADMIN'               │  │
│   │           )                                                 │  │
│   │           AND (expires_at IS NULL OR expires_at > NOW())   │  │
│   │       )                                                     │  │
│   │     → false (B 没有授权)                                    │  │
│   │   7. return ErrFolderForbidden                             │  │
│   └───────────────────────────────────────────────────────────┘  │
│   error 返回到 handler                                           │
└──────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────┐
│ media_handler.go:126 errors.Is(err, ErrFolderForbidden)          │
│ → response.FailWith(c, response.Forbidden, "无权写入该文件夹")    │
│ HTTP 403 + JSON {code:403, message:"..."}                        │
└──────────────────────────────────────────────────────────────────┘
```

**关键约束**(`media_service.go:182-184`):

> 依赖未注入(folderLookup/permLookup == nil) → 放行(向后兼容,server.go 必须显式 SetFolderAccess 才启用)

也就是说,生产 server.go 必须显式调用 `mediaSvc.SetFolderAccess(folderRepo, permissionRepo)`(`server.go:297`),否则上传**完全不校验** —— 这是 batch 2 上线前后的状态切换。

---

## 4. assertFolderWritable 7 步短路全表

| 步 | 条件 | 结果 |
| --- | --- | --- |
| 1 | `folderID == nil` | 放行(根目录) |
| 2 | `folderLookup == nil` 或 `permLookup == nil` | 放行(向后兼容) |
| 3 | `folderRepo.FindByID(*folderID)` 错误 | 包装为 `folder lookup failed: ...` |
| 4 | `folder == nil` | `ErrFolderNotFound`(handler 映射 400) |
| 5 | `folder.OwnerID == nil`(系统文件夹) | 放行 |
| 6a | `uploaderID != nil && *uploaderID == *folder.OwnerID` | 放行(自家) |
| 6b | `uploaderID == nil`(匿名上传) | `ErrFolderForbidden`(系统文件夹除外,见步 5) |
| 6c | `permRepo.HasWriteAccess(folderID, uploaderID)` 错误 | 包装为 `permission lookup failed: ...` |
| 7 | `HasWriteAccess` 返回 `true` | 放行 |
| 8 | 否则 | `ErrFolderForbidden`(handler 映射 403) |

---

## 5. folder_permissions 5 级权限语义

`migrations/000011_add_permissions_and_sharing.up.sql:14`:

```sql
CONSTRAINT chk_permission_level CHECK (permission_level IN ('VIEW', 'UPLOAD', 'EDIT', 'DELETE', 'ADMIN'))
```

| 级别 | 含义(目前后端实际拦截语义) | 备注 |
| --- | --- | --- |
| `VIEW` | 仅前端 hide 可见性,**后端没有强校验** —— 没人查这个值,任何登录管理员都能 GET。 | 前端责任 |
| `UPLOAD` | 可往该文件夹 Upload / MoveBatch 文件 | 真正被 `HasWriteAccess` 检查 |
| `EDIT` | 包含 UPLOAD,可修改文件元数据 | 没单独校验,被 `HasWriteAccess` 一并放行 |
| `DELETE` | 包含上,可软/硬删除文件 | 没单独校验 |
| `ADMIN` | 包含所有,理论上可在该 folder 下 Grant 权限给他人 | 但 `Grant` handler 实际只校验 folder owner_id,**不让 ADMIN 级别的授权用户再次 grant** |

**实现实情:**
- `HasWriteAccess`(`permission_repo.go:81`)把 `UPLOAD/EDIT/DELETE/ADMIN` 当一组"可写"判断;**VIEW 不在此组**。
- 没有 `HasReadAccess` 函数 —— 当前只关心可写。
- ADMIN 不能下放 Grant 权限(VULN-038 修复时定的边界,见 `permission_handler.go:62-74`)—— 只有 folder owner_id 才能 Grant/Update/Revoke。

**已知 bug(model 注释 vs schema 不一致):** `internal/model/folder_permission.go:11` 注释写"如 read/write/admin",但实际 schema 是 `VIEW/UPLOAD/EDIT/DELETE/ADMIN`。早期注释,未更新。

---

## 6. PR #647 修复要点(批次 2)

> 出处:`CHANGELOG.md:42-46` + `permission_repo.go:79-95` 注释。

### 6.1 P1:HasWriteAccess SQL 把 'write','admin' 当成枚举值

原版用 `'write'`/`'admin'` 这种小写值在 SQL 里查 `permission_level IN ('write','admin')`,但 DB CHECK 约束(`migrations/000011`)要求大写 `VIEW/UPLOAD/EDIT/DELETE/ADMIN`。

**结果:** 任何显式授权用户的 SQL 永远返回 false → 即使授了 UPLOAD 权限也被拒,只有 owner 自己能上传。

**修复:** SQL 改用大写枚举值(`permission_repo.go:88`)。

### 6.2 P2:assertFolderWritable 用 sentinel error

原版 `errors.New("无权...")` 字符串,handler 用 `strings.Contains` 判定 → 难维护、易碰撞、容易漏 case。

**修复:** 定义两个 `var Err...` sentinel(`media_service.go:161/165`),handler 走 `errors.Is`(`media_handler.go:25-34` `respondMediaError`)。

| Sentinel | handler 映射 |
| --- | --- |
| `ErrFolderForbidden` | 403 Forbidden |
| `ErrFolderNotFound` | 400 BadRequest(故意不返 404,防 ID 探测) |
| 其它 | 500 Internal |

### 6.3 Move / MoveBatch 也接入 assertFolderWritable

原版只有 `Upload` 走校验,`Move` 不校验 → 用户可以"先 Upload 到自己的根目录,再 Move 到他人 PRIVATE 文件夹" 绕过权限。

**修复:** `Service.Move`(`media_service.go:614`)+ `Service.MoveBatch`(`media_service.go:623`)开头都调一次 `assertFolderWritable`。Move 还把 `uploaderID` 从 handler 透传过来。

### 6.4 deepMergeStringMap null 处理

不在 folder/permission 范围,但同 PR 解决:JSON `null` 应等同"缺失"回退旧值,而非把旧值覆盖为 nil。详见 §03。

---

## 7. 数据库表 + 字段 + 索引

### 7.1 `media_folders`(migration 000007)

| 字段 | 类型 | 备注 |
| --- | --- | --- |
| `id` | BIGSERIAL PK | id=1 是默认 Root |
| `name` | VARCHAR(100) NOT NULL | 显示名 |
| `slug` | VARCHAR(100) NOT NULL | URL slug,**不强制全表唯一**,只 path 唯一 |
| `description` | TEXT | |
| `parent_id` | BIGINT FK media_folders | ON DELETE CASCADE → 删父级会级联删整棵子树 |
| `path` | VARCHAR(1000) NOT NULL | 物化路径,如 `/root/photos/2026` |
| `depth` | INT default 0 | 根=0 |
| `sort_order` | INT default 0 | 用于 UI 排序 |
| `color` / `icon` / `cover_image` | VARCHAR | 主题装饰,可选 |
| `owner_id` | BIGINT FK users | ON DELETE SET NULL,**核心权限边界字段** |
| `visibility` | VARCHAR(20) NOT NULL DEFAULT 'PRIVATE' | CHECK ∈ {PRIVATE, TEAM, PUBLIC} |
| `file_count` / `total_size` | INT/BIGINT | **缓存值,但当前代码不维护** —— 永远是 0 |
| `created_by` / `updated_by` | BIGINT FK users | 审计字段 |
| `created_at` / `updated_at` | TIMESTAMP | |
| `UNIQUE (path)` | | 物化路径冲突即拒插入 |

**索引:**
- `idx_media_folders_parent` (parent_id)
- `idx_media_folders_path` (path)
- `idx_media_folders_owner` (owner_id)
- `idx_media_folders_visibility` (visibility)
- `idx_media_folders_created_at` (created_at)

### 7.2 `folder_permissions`(migration 000011)

| 字段 | 类型 | 备注 |
| --- | --- | --- |
| `id` | BIGSERIAL PK | |
| `folder_id` | BIGINT FK media_folders | ON DELETE CASCADE |
| `user_id` | BIGINT FK users | ON DELETE CASCADE |
| `permission_level` | VARCHAR(20) NOT NULL | CHECK ∈ {VIEW, UPLOAD, EDIT, DELETE, ADMIN} |
| `granted_by` | BIGINT FK users | nil 表示系统授权 |
| `granted_at` | TIMESTAMP default now | |
| `expires_at` | TIMESTAMP NULL | nil = 永不过期 |
| `UNIQUE (folder_id, user_id)` | | 一个用户对一个 folder 只有一条 |

**索引:**
- `idx_folder_permissions_folder` (folder_id)
- `idx_folder_permissions_user` (user_id)

---

## 8. 配置 / 环境变量

本子模块**没有自己的 env / config 项**,完全靠 server.go wire 时注入依赖:

```go
// server.go:284-297
folderRepo := repository.NewFolderRepo(s.DB)
mediaSvc := service.NewMediaService(mediaRepo, localStore, storageProviderRepo, s.Config.Upload.Path)
permissionRepo := repository.NewPermissionRepo(s.DB)
mediaSvc.SetFolderAccess(folderRepo, permissionRepo)
folderSvc := service.NewFolderService(folderRepo)
```

`MediaService.SetFolderAccess` 是**显式 opt-in** 接口 —— 删掉这一行就回退到 PR #647 之前的"任何 admin 可写所有 folder"行为。**不要这样做**。

---

## 9. 与其他模块耦合

| 模块 | 关系 |
| --- | --- |
| **MediaService**(§01) | Upload / Move / MoveBatch 入口校验 |
| **VersionService** | 无直接耦合(版本只挂 media,不挂 folder) |
| **ShareService** | folder 也能被分享(`media_shares.share_type='FOLDER'`),但当前 share 是 owner 主动 create,不走 folder_permissions |
| **AI 模块** | 上传 AI 生成图片到指定 folder 时同样走 assertFolderWritable |
| **Admin UI** | `MediaPage` 折叠树形渲染来自 `GetTree`;权限管理在 SettingsPage 子页面 |

---

## 10. 已知限制

1. **`file_count` / `total_size` 是死字段** — schema 设计上是缓存,但 service 层从来不维护。前端 / API 拿到的永远是 0。
2. **物化路径冲突难诊断。** 两个相同名字的 folder 在不同 parent 下经过 slugifySimple 后可能产生相同 path → UNIQUE 冲突。Create 直接报 DB error,没有友好提示。
3. **slugify 丢弃中文。** `slugifySimple`(`folder_repo.go:131`)只保留 ASCII。叫"我的相册"的 folder slug 退化为 `folder-9`(用字符串字节数兜底),不可读。
4. **没有读权限校验。** Tree / Get / Children 接口对所有 admin 暴露所有 folder 元数据 —— 包括他人 PRIVATE 文件夹的存在性。VIEW 级别授权完全靠前端 hide。
5. **Update folder 不能改 parent_id**(只走 Move)—— Update 函数只允许改 name/desc/color/icon/visibility,但 Update 接口仍接受 ParentID 参数,接收后被忽略。
6. **`Move` 不校验目标 parent 的写权限** — 把自己的 folder 挪到他人 folder 下不会被 assertFolderWritable 拦(那是 file 层的护栏)。
7. **VULN-039(handler 层 ownership)只校验当事 folder 的 owner**,不校验"将要修改成的 owner_id 是否跟当前用户匹配"。Update 请求体里偷偷把 `OwnerID` 改成自己仍然成立 —— 但 Update 没把 OwnerID 字段开放给 service,该 vector 实际不存在。

---

## 11. 测试覆盖说明

| 测试 | 文件 | 覆盖什么 |
| --- | --- | --- |
| `TestAssertFolderWritable` | `media_service_test.go:47` | 10 个表驱动子用例 — 覆盖 nil / 不存在 / system / owner / mismatch / 显式授权 / repo error / nil uploader |
| `TestAssertFolderWritable_BackwardCompat` | `media_service_test.go:154` | 依赖未注入时不拒任何上传 |
| `TestAssertFolderWritable_SentinelErrors` | `media_service_test.go:164` | `errors.Is(..., ErrFolderForbidden)` / `ErrFolderNotFound` |

**未覆盖:**
- `FolderRepo.computePathDepth` 的边界(parent 不存在时降级为根)
- 删除 folder 级联清空子级 + media 的行为
- `slugify` 的中文 / emoji 行为
- VULN-039 handler 层 ownership 校验
- VULN-038 permission_handler Grant/Update/Revoke owner 校验
