# 03 · RBAC 与文件夹权限模型

> 关注问题: 角色枚举、角色检查链路、`folder_permissions` 表、Ownership 与 RBAC 协同(VULN-038 / VULN-IDOR-cluster)、与媒体上传深层校验的对接。

---

## 1. 责任范围

AetherBlog 的访问控制是 **粗粒度 RBAC + 细粒度 ABAC** 的混合:

1. **粗粒度 RBAC**: `users.role ∈ {ADMIN, AUTHOR, USER}`,决定**能不能进入**整组路由(主要是 `/v1/admin/*`)。由 `RequireRole("admin")` 中间件在 group 层强制。
2. **细粒度 ownership**: 业务 handler 在读取目标资源后,显式调 `middleware.AssertOwnership(c, ownerID)` —— ADMIN 直接放行,其他用户只能操作自己的资源。深度防御层。
3. **资源级 ABAC**: `folder_permissions` 表存"用户 → 文件夹 → 权限级别"的显式授权,覆盖跨用户的协作场景(`VIEW / UPLOAD / EDIT / DELETE / ADMIN` 五级递增)。媒体上传场景由 `PermissionRepo.HasWriteAccess` 校验。
4. **Permission 管理 API**: `GrantPermissionRequest` / `UpdatePermissionRequest` / `Revoke` 三组 admin 路由,挂载在 `/v1/admin/media/folders/:folderId/permissions` 与 `/v1/admin/media/permissions/:permissionId` 下。

> **本子模块特别强调**: RBAC 与 ownership / ABAC **不可互相替代**。`RequireRole("admin")` 在 group 层把 USER 拦在 `/v1/admin/*` 外;但即便是 ADMIN,在涉及他人文件夹的 Grant / Revoke 时也必须再走一次 ownership 校验(VULN-038)。这一点在 `permission_handler.go` 的注释里被反复重申。

---

## 2. 关键代码入口

### 2.1 RBAC 中间件

| 函数 | 位置 |
| --- | --- |
| `middleware.RequireRole(roles...)` | `apps/server-go/internal/middleware/jwt.go:147-165` |
| `middleware.AssertOwnership(c, ownerID)` | `apps/server-go/internal/middleware/jwt.go:101-123` |
| `middleware.LoginUserSnapshot` + `SnapshotFromContext` | `apps/server-go/internal/middleware/jwt.go:125-145` |
| `middleware.RequirePasswordRotated` | `apps/server-go/internal/middleware/jwt.go:167-193` |

### 2.2 Permission Handler / Service / Repo

| 函数 | 位置 |
| --- | --- |
| `PermissionHandler.Mount` 路由注册 | `apps/server-go/internal/handler/permission_handler.go:30-35` |
| `PermissionHandler.GetPermissions` | `:37-51` |
| `PermissionHandler.Grant`(VULN-038 ownership 拦截) | `:53-90` |
| `PermissionHandler.Update` | `:92-129` |
| `PermissionHandler.Revoke` | `:131-159` |
| `PermissionService.GetByFolderID` / `Grant` / `Update` / `Revoke` / `GetFolderID` | `apps/server-go/internal/service/permission_service.go:21-88` |
| `PermissionRepo.FindByFolderID` / `FindByID` / `Create` / `Update` / `Delete` / `HasWriteAccess` | `apps/server-go/internal/repository/permission_repo.go:21-95` |
| `FolderService.GetOwnerID`(供 ownership 校验拿目标 owner) | `apps/server-go/internal/service/folder_service.go:40-48` |

### 2.3 Server.go 路由挂载

```
/v1/admin                         (authMW + pwdRotated + RequireRole("admin"))
    └─ /auth                      (MountAdmin: /jwt-secret-meta, /rotate-jwt-secret)
    └─ /media                     (PermissionHandler.Mount → 见下方)
       ├─ /folders/:folderId/permissions (GET / POST)
       ├─ /permissions/:permissionId     (PUT / DELETE)
```

`server.go:208`(`admin := api.Group(...)` 处) + `:321`(`handler.NewPermissionHandler(...).Mount(admin.Group("/media"))`)。

---

## 3. 角色枚举与判定

### 3.1 角色种类

`users.role` 取值(migration 000001:35):

| 角色 | 大小写 | 实际作用范围 |
| --- | --- | --- |
| `ADMIN` | 大写 | 通过 `/v1/admin/*` 全域;`AssertOwnership` 自动放行 |
| `AUTHOR` | 大写 | 当前**没有** middleware 引用 —— 设计上是"作者",但代码没有 enforcement |
| `USER` | 大写 | 默认值;只能用 `/v1/auth/*` 与 `/v1/agent/*` 与公开 `/v1/public/*` |

> **观察**: AUTHOR 角色定义了但实际未被使用,所有"管理"动作都按 `RequireRole("admin")` 一刀切。如果未来要让 AUTHOR 能 `POST /v1/admin/posts` 但不能改全站设置,需要在每个 handler 路由处加 `RequireRole("admin","author")` 并在 service 层做内容 ownership 校验。

### 3.2 角色比较的 case-insensitive

`RequireRole`(`jwt.go:156-163`)与 `AssertOwnership`(`:116`)都用 `strings.ToLower(lu.Role) == strings.ToLower(r)` 比较。后端代码层和数据库 CHECK 约束是**大写**,但中间件是 case-insensitive,这层"宽容"是为了避免某些客户端 / token 自定义环境写成小写 admin 时还能正常通过。

### 3.3 JWT 中的 Role 来源

`generateAccessToken`(`auth_handler.go:451`)直接把 `user.Role` 写入 JWT claim;后续中间件不再回查 DB。意味着:

- **角色变更存在时延**: admin 修改 USER 的 role 后,该用户**手上的 access token 不会立刻失效**,直到自然过期(默认 24h)或主动 logout。
- 如果对实时性敏感(降权场景),需要走 `session.RevokeAllUserSessions(userID)`,但这只能让 refresh 失败,access token 在 TTL 内仍有效。

---

## 4. AssertOwnership 防御链(VULN-IDOR-cluster)

### 4.1 设计意图

`AssertOwnership` 注释(`jwt.go:101-110`)明确写: "深度防御,与 RequireRole 在 group 层互补,不可互相替代"。语义是:

- ADMIN: 直接放行(可以管理任何人的资源)
- 非 ADMIN: 只有当 `ownerID == lu.UserID` 时才放行,否则 403

### 4.2 调用范式

```go
// handler 层典型用法
existing, err := h.svc.GetByID(ctx, id)
if err != nil {
    return response.Error(c, err)
}
if err := middleware.AssertOwnership(c, existing.AuthorID); err != nil {
    return err  // helper 已写入 403 响应
}
// 通过后才执行实际 CUD
```

### 4.3 Permission Handler 的 VULN-038 修复

修复前: 任何登录的 ADMIN 都能给任何 folder 授任何权限 —— 因为 group 层只检查 role,没检查 folder ownership。
修复后(`permission_handler.go:62-74`):

```go
folderOwner, err := h.folderSvc.GetOwnerID(ctx, folderID)
if err != nil { return response.Error(c, err) }
if folderOwner == nil {
    return response.FailWith(c, response.NotFound, "文件夹不存在")
}
if err := middleware.AssertOwnership(c, folderOwner); err != nil {
    return err
}
```

后果: 即便 ADMIN A 想给自己授 ADMIN B 的私有文件夹的 ADMIN 权限(提权链),`AssertOwnership` 在 ADMIN 角色下虽然放行,但其他非 admin user 想钻空子时会被拦截。结合"`ADMIN` 直接放行"语义,这条防御主要保护 **AUTHOR / USER 在未来被允许进 admin 路由后**,不让他们 "授权自己访问别人的文件夹"。

> **隐含含义**: 当前 `/v1/admin/*` 强制 `RequireRole("admin")`,所以理论上 USER 永远不会到 `permission_handler.go:Grant`。但 PermissionHandler 仍然做 ownership 检查,是为未来"AUTHOR 也能进部分 admin 路由"留好闸门 —— 取消 group 级 RequireRole 的瞬间,深度防御就立刻起作用。

---

## 5. `folder_permissions` ABAC 模型

### 5.1 表结构(migration 000011)

```sql
CREATE TABLE folder_permissions (
    id               BIGSERIAL PRIMARY KEY,
    folder_id        BIGINT REFERENCES media_folders(id) ON DELETE CASCADE,
    user_id          BIGINT REFERENCES users(id)         ON DELETE CASCADE,
    permission_level VARCHAR(20) NOT NULL,
    granted_by       BIGINT REFERENCES users(id),
    granted_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at       TIMESTAMP,

    CONSTRAINT chk_permission_level
        CHECK (permission_level IN ('VIEW','UPLOAD','EDIT','DELETE','ADMIN')),
    CONSTRAINT uq_folder_user_permission UNIQUE (folder_id, user_id)
);

CREATE INDEX idx_folder_permissions_folder ON folder_permissions(folder_id);
CREATE INDEX idx_folder_permissions_user   ON folder_permissions(user_id);
```

**关键不变量**: `(folder_id, user_id)` 联合唯一 —— 一个用户在一个文件夹只有一条权限记录。要"提升权限"是通过 Update 而不是 Insert。

### 5.2 五级权限语义

| 级别 | 含义(参 PermissionRepo.HasWriteAccess) |
| --- | --- |
| `VIEW` | 能看到文件夹 / 文件元数据,**不**能写 |
| `UPLOAD` | 能上传新文件,但不能改 / 删 已有文件 |
| `EDIT` | 能修改已有文件元数据 / 内容 |
| `DELETE` | 能软删除文件 |
| `ADMIN` | 在该 folder 内拥有全部权限,包括重新授权他人 |

### 5.3 写权限判定(媒体上传链路)

`PermissionRepo.HasWriteAccess`(`permission_repo.go:81-95`):

```sql
SELECT EXISTS (
    SELECT 1 FROM folder_permissions
    WHERE folder_id=$1 AND user_id=$2
      AND permission_level IN ('UPLOAD','EDIT','DELETE','ADMIN')
      AND (expires_at IS NULL OR expires_at > NOW())
);
```

> **注释强调**: PR #647 修过一次 P1 —— 之前 IN 子句写成 `('write','admin')`,与 DB CHECK 约束不匹配,所有显式授权都失效。当前枚举与 DB 严格对齐,是 PR 的关键修复。

> **限制**: 此 Repo 方法**只查表本身**;owner / 系统文件夹的"无显式记录也放行"逻辑由 `service.MediaService` 的上层叠加判断(详见模块 `03-backend-media-storage`)。

### 5.4 权限过期

`expires_at IS NULL` 视作永久;否则严格 `> NOW()` 才视作有效。Update 端点支持把 expires_at 改成 NULL(`permission_repo.go:54-63`),但**没有定时清理过期记录的 worker** —— 过期权限继续占着唯一约束(`(folder_id,user_id)`),要重新授权必须先 Update 或 Delete。

---

## 6. 数据流

### 6.1 Grant 流程

```
Admin POST /v1/admin/media/folders/:folderId/permissions
      Body: {userId, permissionLevel: "EDIT", expiresAt?: "2026-12-31T..."}
    │
    v
[group middleware] JWTAuthWithStore → RequirePasswordRotated → RequireRole("admin")
    │
    v
PermissionHandler.Grant (permission_handler.go:56)
    ├─ ParseInt(folderId)
    ├─ folderSvc.GetOwnerID(folderID)
    │       └─ folderRepo.FindByID → owner_id
    ├─ if folderOwner == nil → 404
    ├─ middleware.AssertOwnership(c, folderOwner)
    │       (ADMIN 自动放行;非 ADMIN 仅当 owner == self 才放行)
    ├─ bindAndValidate(GrantPermissionRequest)
    │       └─ permissionLevel: oneof=VIEW UPLOAD EDIT DELETE ADMIN
    └─ PermissionService.Grant(folderID, req, grantedBy=loginUser.UserID)
            └─ permissionRepo.Create
                    └─ INSERT INTO folder_permissions (...) RETURNING id, granted_at
```

### 6.2 Update 流程

```
PUT /v1/admin/media/permissions/:permissionId
    Body: {permissionLevel, expiresAt?}
    │
    v
PermissionHandler.Update (permission_handler.go:95)
    ├─ ParseInt(permissionId)
    ├─ svc.GetFolderID(permissionId)            // 把 permissionID → folderID
    ├─ if !found → 404
    ├─ folderSvc.GetOwnerID(folderID)
    ├─ middleware.AssertOwnership(c, folderOwner)
    ├─ bindAndValidate(UpdatePermissionRequest)
    └─ PermissionService.Update
            ├─ permissionRepo.Update
            │       └─ UPDATE folder_permissions SET permission_level=?, expires_at=? WHERE id=?
            └─ permissionRepo.FindByID → 返回最新视图
```

### 6.3 Revoke 流程

类似 Update,但末尾是 `permissionRepo.Delete(id)`(`permission_handler.go:131-159`)。

### 6.4 媒体上传时的权限校验(从外部模块视角)

```
Media upload flow (in media_service.go,见模块 03-backend-media-storage)
    │
    ├─ if folder is system or owner == loginUser.UserID → 直接放行
    └─ else permissionRepo.HasWriteAccess(folderID, loginUser.UserID)
              └─ 命中显式授权(UPLOAD/EDIT/DELETE/ADMIN 且未过期) → 放行
              否则 → 403
```

---

## 7. 涉及的 DB 表与字段

### 7.1 `users.role`

枚举 + CHECK 约束见 §3.1;前端 / 后端 / DB 三层都按大写存。

### 7.2 `folder_permissions`

完整 schema 见 §5.1。本模块**写**这张表的入口只有 PermissionService 三个方法;**读**入口除了 PermissionService.GetByFolderID,还有 MediaService 下游的 `HasWriteAccess`。

### 7.3 没有"角色 → 权限"映射表

RBAC 是**硬编码**在 middleware 层(`RequireRole("admin")`),不像传统企业系统有 `roles / permissions / role_permissions` 三表。这是博客场景常见的简化,但限制了未来动态调整角色权限的能力 —— 想加新权限就要改代码 + 部署。

---

## 8. 配置 / 环境变量

本子模块**没有专属配置项**。所有阈值要么是 DB CHECK 硬编码,要么是 middleware 函数参数硬编码。

---

## 9. 已知限制与待改进

### 9.1 P1: AUTHOR 角色完全无效

当前没有任何 `RequireRole(..., "author")` 调用。如果未来要给"作者"开放部分管理路由,需要规划:
- 哪些 admin 路由应允许 AUTHOR(写文章 / 上传媒体到自己 folder)
- 哪些必须 ADMIN(改全站设置 / 管理用户 / 看审计)
- 同时检查 `AssertOwnership` 是否覆盖到所有 IDOR 风险路径

### 9.2 P1: `folder_permissions.permission_level` 的注释 vs 实际枚举

- DB CHECK: `VIEW / UPLOAD / EDIT / DELETE / ADMIN`
- DTO validator: 同上(`media.go:182`)
- **`model/folder_permission.go:11` 注释**: `"read"、"write"、"admin"` —— **错误**,是 PR #647 之前的旧文案残留

修补成本极小但容易踩坑(已经踩过一次)。

### 9.3 P2: 没有"用户在哪些 folder 有权限"反查

当前 PermissionService 只提供"folder → 权限列表"。如果要实现"用户登录后看到自己能访问的 folder 列表",需要新增 `PermissionRepo.FindByUserID(userID) []FolderPermission`。

### 9.4 P2: 过期权限不会被清理

`expires_at < NOW()` 的记录仍占着 `uq_folder_user_permission` 唯一约束。重新授权时必须先 Update / Delete。建议加定时 worker 清理 + 在 `Grant` 时检测同 (folder_id, user_id) 的过期记录并自动覆盖。

### 9.5 P2: 角色变更没有立即下线机制

参 §3.3。降权后 access token 仍有效到 TTL 结束。短期可以接受(24h),但安全敏感场景(开除员工)需要补:
- 调 `session.RevokeAllUserSessions(userID)` 撤销 refresh
- 更激进的方案: JWT 加 `iat`(issued-at)claim,用户表加 `tokens_invalidated_at` 字段,middleware 拒绝 `iat < tokens_invalidated_at` 的 token。代价是每次请求都要查 DB。

### 9.6 P3: `model/folder_permission.go` 的字段命名 `permission_level` 在 dto/media.go 用 `PermissionLevel` 而 dto 文件名是 `media.go`

`FolderPermissionVO` / `GrantPermissionRequest` / `UpdatePermissionRequest` 都定义在 `dto/media.go:166-190` 而不是独立的 `dto/permission.go`。语义上权限 / 媒体共享同一套 dto 文件是因为它们都属于"媒体子系统的协作面",但维护时容易找不到。建议拆出来。

### 9.7 P3: `granted_by` 没有被 UI 显示利用

VO 已经返回 `grantedBy *int64`,但前端 admin 应该展示成"由 admin (李明) 授予",当前代码没有 N+1 查 user.nickname。这是 admin 端界面优化点。

---

## 10. 测试覆盖说明

### 10.1 中间件层

`middleware/jwt_test.go`(参模块 01) 只覆盖 `RequirePasswordRotated`,**没有** `RequireRole` / `AssertOwnership` 的单元测试。这是显著的回归保护缺口 —— 角色比较的 case-insensitive 行为、admin 自动放行 ownership 检查等关键不变量,目前完全靠手工测试 / 集成测试(也没有)。

### 10.2 Permission 层

- 没有 `permission_handler_test.go`
- 没有 `permission_service_test.go`
- 没有 `permission_repo_test.go`

整个 `folder_permissions` CRUD 的回归保护,目前来自媒体上传 / 共享端到端测试(在模块 03)。建议至少补充:
- `RequireRole` 三态测试(未登录 / role 大小写 / role 不在白名单)
- `AssertOwnership` 四态测试(未登录 / admin 放行 / owner 放行 / 非 owner 拒绝)
- `PermissionRepo.HasWriteAccess` 的枚举值匹配测试(防止 PR #647 的 P1 再发生)
