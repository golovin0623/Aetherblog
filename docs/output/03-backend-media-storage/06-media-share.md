# 06 · 媒体分享链接

> 描述:`media_shares` 表 + `ShareService` 提供"32 字节随机 token + 可选 bcrypt 密码 + 可选过期时间 + 可选访问次数上限"的可分享链接。
> 关键文件:`internal/handler/share_handler.go` · `internal/service/share_service.go` · `internal/repository/share_repo.go` · `internal/model/media_share.go` · `migrations/000011_add_permissions_and_sharing.up.sql:21-45`。
> 路由前缀:`/api/v1/admin/media/shares`。

---

## 1. 责任范围

| 子能力 | 状态 |
| --- | --- |
| 文件级分享创建(`/shares/file/:fileId`) | ✅ 完整 |
| 文件夹级分享创建(`/shares/folder/:folderId`) | ✅ 完整 |
| 列出某文件的所有分享(`GET /shares/file/:fileId`) | ✅ 完整 |
| 修改分享配置(`PUT /shares/:shareId`) | ✅ 完整(VULN-037 owner 校验) |
| 删除分享(`DELETE /shares/:shareId`) | ✅ 完整(VULN-037 owner 校验) |
| **匿名访问端点 `/share/:token`** | ❌ **本仓库代码未实现** — 仅 admin 创建/管理分享,公共访问端点不在本模块 |
| **access_count / max_access_count 维护** | ❌ schema 字段就位,但**当前没有任何写入路径**,永远是 0 |
| **expires_at 自动检查** | ❌ schema 就位,但创建分享只 INSERT,无周期清理 |

---

## 2. 关键代码入口

| 入口 | 文件 / 行 | 备注 |
| --- | --- | --- |
| Mount | `share_handler.go:29-36` | 5 个 endpoint |
| CreateFileShare | `share_handler.go:41` → `service.CreateFileShare:30` | 32B 随机 token |
| CreateFolderShare | `share_handler.go:67` → `service.CreateFolderShare:71` | 同上路径 |
| GetSharesByFile | `share_handler.go:93` → `service.GetSharesByFile:111` | **VULN-044 owner 校验** |
| Update | `share_handler.go:120` → `service.Update:126` | **VULN-037 owner 校验** + 三选一字段更新 |
| Delete | `share_handler.go:155` → `service.Delete:184` | **VULN-037 owner 校验** |
| GetCreatedBy | `service.go:191` | handler 层 ownership 校验前置 |
| token 生成 | `service.go:205` `generateShareToken` | `crypto/rand.Read(32)` → hex(64 字符) |
| 密码加密 | `service.go:53-60`(及 91-100, 159-164) | `bcrypt.GenerateFromPassword` 默认 cost(10) |
| 过期解析 | `service.go:46-51`(及 86-92, 142-145) | `time.Parse(time.RFC3339, *req.ExpiresAt)`,失败时**忽略字段** |
| repo Create | `share_repo.go:44` | INSERT RETURNING id, created_at |
| repo Update | `share_repo.go:55` | 改 access_type / expires_at / max_access_count / password_hash |

---

## 3. 数据流(创建文件分享 + 密码 + 1 周后过期 + 5 次上限)

```
POST /api/v1/admin/media/shares/file/42
{
  "accessType": "DOWNLOAD",
  "password": "secret123",
  "expiresAt": "2026-05-15T00:00:00Z",
  "maxAccessCount": 5
}

┌────────────────────────────────────────────────────────────┐
│ ShareHandler.CreateFileShare (share_handler.go:41)         │
│   • fileID = 42                                            │
│   • bind req → CreateShareRequest                          │
│   • lu := middleware.GetLoginUser(c) → createdBy           │
│   • call svc.CreateFileShare(ctx, 42, req, &lu.UserID)     │
└────────────────────────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────────────────────┐
│ ShareService.CreateFileShare (service.go:30)               │
│   token = generateShareToken()                             │
│     → 32 字节 → hex 64 字符 = `a3f8...`                    │
│                                                            │
│   share := &MediaShare{                                    │
│     ShareToken:     token,                                 │
│     MediaFileID:    &42,                                   │
│     ShareType:      "FILE",                                │
│     AccessType:     "DOWNLOAD",                            │
│     CreatedBy:      &createdBy,                            │
│     MaxAccessCount: &5,                                    │
│   }                                                        │
│                                                            │
│   if req.ExpiresAt != nil:                                  │
│     t, err := time.Parse(RFC3339, *req.ExpiresAt)          │
│     if err == nil: share.ExpiresAt = &t                    │
│     // 注意:解析失败被静默忽略!                             │
│                                                            │
│   if req.Password != nil && *req.Password != "":            │
│     hash, _ := bcrypt.GenerateFromPassword(                 │
│                  []byte("secret123"),                      │
│                  bcrypt.DefaultCost  // = 10              │
│                )                                           │
│     share.PasswordHash = &string(hash)                     │
│                                                            │
│   repo.Create(ctx, share)                                  │
│     INSERT INTO media_shares (share_token, media_file_id, │
│       folder_id, share_type, access_type, created_by,      │
│       expires_at, max_access_count, password_hash)         │
│     VALUES (...) RETURNING id, created_at                  │
│                                                            │
│   return toShareVO(*share)                                 │
└────────────────────────────────────────────────────────────┘
        │
        ▼
JSON {
  code: 200,
  data: {
    id: 7,
    shareToken: "a3f8b2c4...64chars",
    shareUrl: "/share/a3f8b2c4...",
    mediaFileId: 42,
    shareType: "FILE",
    accessType: "DOWNLOAD",
    createdBy: 1,
    createdAt: "2026-05-08T...",
    expiresAt: "2026-05-15T00:00:00Z",
    accessCount: 0,
    maxAccessCount: 5
    // password 不暴露
  }
}
```

**注意:** `shareUrl` 字段是 `"/share/" + token` —— 但仓库**没有 `/share/:token` 端点**,需要前端 / nginx 路由层提供。

---

## 4. 安全检查清单

### 4.1 Token 生成

`generateShareToken`(`service.go:205`):

```go
b := make([]byte, 32)
rand.Read(b)   // crypto/rand
return hex.EncodeToString(b), nil
```

- 32 bytes = 256 bit 熵
- hex 编码 → 64 字符
- 完全密码学安全;无可枚举性

### 4.2 密码哈希

`bcrypt.GenerateFromPassword(..., bcrypt.DefaultCost)`(`service.go:54`):

- DefaultCost = 10 → ~10ms / 哈希(单 CPU)
- 哈希以 `$2a$10$...` 形式存 `password_hash` 列
- VO 返回时**不暴露** password 字段(`MediaShareVO`(`internal/dto/media.go:195`)无 password)
- 修改 password 时:
  - `*req.Password == ""` → 清密码保护
  - 否则重新 bcrypt 加密

### 4.3 ownership 校验(VULN-037 / VULN-044)

| 端点 | 校验 |
| --- | --- |
| `GET /shares/file/:fileId` | **(VULN-044)** 校验调用者拥有底层 file —— `mediaSvc.GetUploaderID` + `AssertOwnership` |
| `PUT /shares/:shareId` | **(VULN-037)** 校验调用者是分享 createdBy 或 admin |
| `DELETE /shares/:shareId` | 同上 |
| `POST /shares/file/:fileId` | **没有底层 file ownership 校验** —— admin 创建分享前不查 fileID 是不是自己的;实际上由 `middleware.RequireRole("admin")` 兜底,但这意味着 admin 可以为任何用户的文件创建分享链接 |

`GetCreatedBy`(`service.go:191`)单独存在以便 handler 在 Update/Delete 之前查询:

```go
found, ownerID, err := h.svc.GetCreatedBy(ctx, shareID)
// found=false → 404
// 否则 middleware.AssertOwnership(c, ownerID)
//   - admin 放行
//   - createdBy == lu.UserID 放行
//   - 否则 403
```

---

## 5. 数据库表 + 字段 + 索引

### 5.1 `media_shares`(migration 000011)

| 字段 | 类型 | 备注 |
| --- | --- | --- |
| `id` | BIGSERIAL PK | |
| `share_token` | VARCHAR(64) NOT NULL UNIQUE | hex(32B) — 64 字符 |
| `media_file_id` | BIGINT FK media_files | ON DELETE CASCADE |
| `folder_id` | BIGINT FK media_folders | ON DELETE CASCADE |
| `share_type` | VARCHAR(20) NOT NULL | CHECK ∈ {FILE, FOLDER} |
| `access_type` | VARCHAR(20) NOT NULL DEFAULT 'VIEW' | CHECK ∈ {VIEW, DOWNLOAD} |
| `created_by` | BIGINT FK users | nil 表示匿名分享(目前没人匿名创建) |
| `created_at` | TIMESTAMP DEFAULT now | |
| `expires_at` | TIMESTAMP | nil = 永不过期 |
| `access_count` | INT NOT NULL DEFAULT 0 | **当前不维护**,永远是 0 |
| `max_access_count` | INT | nil = 不限 |
| `password_hash` | VARCHAR(255) | bcrypt 哈希;nil 无密码 |
| **CHECK** `chk_share_target` | | `(media_file_id IS NOT NULL AND folder_id IS NULL) OR (media_file_id IS NULL AND folder_id IS NOT NULL)` |

**索引:**
- `idx_media_shares_token` (share_token) — 公共访问端点查 token 用
- `idx_media_shares_file` (media_file_id)
- `idx_media_shares_folder` (folder_id)

---

## 6. 配置 / 环境变量

无独立 env / config 项。依赖:
- `golang.org/x/crypto/bcrypt`(go.mod 已有);
- `crypto/rand`(标准库)。

---

## 7. 与其他模块耦合

| 模块 | 关系 |
| --- | --- |
| **MediaService**(§01) | `share_handler.go:21` 持有 `mediaSvc` 引用做 VULN-044 ownership 校验 |
| **FolderService**(§02) | 不直接耦合,但分享 type=FOLDER 时绑定 folder_id |
| **VersionService** | 无关联 |
| **PermissionService**(§02) | 无关联 — 分享是 owner 主动 create,不走 folder_permissions |
| **Admin UI** | MediaPage 单文件详情面板可创建/查看分享 |

---

## 8. 已知限制 / 缺口

1. **匿名访问端点缺失。** `MediaShareVO.ShareURL = "/share/" + token` 显式承诺前端可分享,但仓库**没有任何 handler 注册到 `/share/:token`**。前端会得到 404。需要在 server.go 的 `public` group 加一个 handler 调 `repo.FindByToken`(目前**也没有 FindByToken 方法**)。
2. **`access_count` 永不增加。** schema 字段就位,但没人 INCR — 因为没匿名访问端点。
3. **`max_access_count` 永不生效。** 同上,没访问就没拒绝。
4. **`expires_at` 不自动失效。** 当前完全靠匿名访问端点(目前不存在)在 SELECT 时检查 `expires_at > now()`。
5. **`expires_at` 解析失败被静默忽略。** `service.go:46-51`(以及 86-92, 142-145):RFC3339 解析失败不报错,直接忽略 —— 用户传 `"无效时间字符串"` 会创建一个**永不过期**的分享而不报错。
6. **Update 接口的 `expires_at` 字段语义模糊。** `service.go:141-145`:`if req.ExpiresAt != nil: expiresAt = req.ExpiresAt` —— 但传入 `*string("")` 或 `*string("invalid")` 都会被原样写到 DB,**不做格式校验**;repo.Update 的 SQL 直接 `expires_at=$2`,PostgreSQL 会拒绝非法时间格式 → 5xx 错误。
7. **CreateFileShare 不校验 fileID 存在。** 用户传不存在的 fileID 仍会插入分享行(因为 INSERT 没用 FK 约束验证 — 实际上 `media_files` 有 FK,所以**会失败**,但失败信息透出 DB 错误而非友好 400)。
8. **没有 GetSharesByFolder。** 列表端点只有 `GET /shares/file/:fileId`,文件夹分享创建后查不到。
9. **没有 token 重置 / regenerate。** 需要重新创建。
10. **CreateFolderShare 不校验 folder ownership。** 任意 admin 可以为他人 folder 创建分享 —— 同 VULN-037 的等价问题在 Create 路径上未补,只在 Update/Delete 上补。

---

## 9. 测试覆盖说明

**`share_service.go` / `share_repo.go` 都没有单元测试。**

潜在测试点(未实现):
- `generateShareToken` 长度 / 唯一性 / 字符集
- bcrypt 密码加密 / 验证
- `expires_at` RFC3339 解析失败 silently 忽略的行为(需要测以记录是预期还是 bug)
- VULN-037 / VULN-044 ownership 校验链
- `chk_share_target` CHECK 约束(media_file_id 与 folder_id 互斥)
- Update password 三态:nil(不变) / `""`(清除) / 非空(重新 hash)

---

## 10. 修复优先级建议(本文档作为输出供后续修复参考)

| 缺陷 | 优先级 | 修复要点 |
| --- | --- | --- |
| 匿名 `/share/:token` 端点不存在 | P0 — 整个分享功能不可用 | 加 public handler + ShareRepo.FindByToken;校验 expires_at + max_access_count;INCR access_count |
| `expires_at` 解析失败被静默忽略 | P1 | `time.Parse` 失败应返回 400 |
| CreateFolderShare / CreateFileShare 不校验底层资源 ownership | P1 | 同 VULN-037 的对称修复 |
| max_access_count 不生效 | P0(同 #1) | 在 access 端点判 `if access_count >= max_access_count: 410 Gone` |
| share_handler 没 GetSharesByFolder | P3 | 加 endpoint |
