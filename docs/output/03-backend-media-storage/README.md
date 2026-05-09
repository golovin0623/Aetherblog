# 后端 · 媒体与存储模块总览

> 版本基线:2026-05-08(`CHANGELOG.md` 顶部「云储存全面优化 · 批次 2」段;migrations 已落到 000046,本模块涉及 7/8/9/10/11/12/42/43)。
> 子文档:[01-上传链路](./01-upload-pipeline.md) · [02-文件夹与权限](./02-folders-and-permissions.md) · [03-存储 Provider](./03-storage-providers.md) · [04-标签检索](./04-media-tags-and-search.md) · [05-同步队列](./05-sync-jobs.md) · [06-分享链接](./06-media-share.md)。

---

## 1. 模块定位

「媒体与存储」是 AetherBlog 后端 26 个 handler 中体量最大的子模块,沉淀了 5 张核心业务表 + 4 张关联表 + 1 张工作队列表,把以下能力收敛到一处:

| 能力 | 落地实现 | 入口路由前缀 |
| --- | --- | --- |
| 上传 / 列表 / 元数据 / 回收站 / 永久删除 / 内容覆盖 | `MediaService` + `media_files` 表 | `/api/v1/admin/media` |
| 文件夹树 + 物化路径 + 命名空间 owner | `FolderService` + `media_folders` 表 | `/api/v1/admin/media/folders` |
| 跨用户共享文件夹的细粒度权限授权 | `PermissionService` + `folder_permissions` 表 | `/api/v1/admin/media/folders/:id/permissions` |
| 多 Provider 抽象(LOCAL / S3 / OSS / COS / MINIO / R2) | `StorageProviderService` + `storage_providers` 表 | `/api/v1/admin/storage/providers` |
| 反向导入孤儿对象 / 列举 bucket | `StorageProviderService.ListObjects` / `ImportObjects` | `/api/v1/admin/storage/providers/:id/objects` |
| 本地→云 镜像备份 worker | `SyncService` + `media_sync_jobs` 表 | `/api/v1/admin/storage/sync` + `/api/v1/admin/media/:id/sync` |
| 媒体标签 + 文件标签关联 | `MediaTagService` + `media_tags` / `media_file_tags` 表 | `/api/v1/admin/media/tags` + `/api/v1/admin/media/files/:id/tags` |
| 文件 / 文件夹的可分享链接 | `ShareService` + `media_shares` 表 | `/api/v1/admin/media/shares` |
| 媒体内容历史版本(图片编辑器回滚) | `VersionService` + `media_versions` 表 | `/api/v1/admin/media/files/:id/versions` |

**关键定位:** 与 Admin UI 的 `MediaPage` 100% 对齐,且承担了 post 封面、AI 图像生成产物、Agent 上传附件三种"业务消费方"的统一存储底座。post / AI / Agent 都不直接写云存储 SDK,只走 `media_files` catalog。

---

## 2. 架构图

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            Admin UI (MediaPage / Settings)                    │
└────────┬───────────────────────────────────────┬────────────────────────────┘
         │ POST /upload  (multipart/form-data)   │ GET /storage/providers
         │ POST /shares /tags ...                │ POST /storage/sync/start
         ▼                                        ▼
┌────────────────────┐                     ┌────────────────────────┐
│  Echo router       │                     │  Echo router           │
│  /api/v1/admin/... │   middleware:       │  /api/v1/admin/storage │
│                    │   authMW + admin    │                        │
└────────┬───────────┘                     └────────┬───────────────┘
         │                                           │
   ┌─────┼─────┬─────────────┬────────────┬──────────┼────────────┐
   ▼     ▼     ▼             ▼            ▼          ▼            ▼
 Media  Folder Permission   Tag          Share    Version    StorageProvider
 Hndlr  Hndlr  Hndlr        Hndlr        Hndlr    Hndlr      + Sync Hndlr
   │     │      │            │            │         │            │
   ▼     ▼      ▼            ▼            ▼         ▼            ▼
 ┌─────────────────── service layer ──────────────────────────┐
 │ MediaService — Upload/Move/Delete/UpdateContent + folder 校验│
 │ FolderService / PermissionService                          │
 │ MediaTagService / ShareService / VersionService             │
 │ StorageProviderService — provider CRUD + secret 脱敏 + 深合并│
 │ SyncService — 后台 worker (errgroup + rate-limit + retry)   │
 └────────┬────────────────────────────────────────────────────┘
          │
          ▼
   ┌─────────────────── repo layer ────────────┐
   │ MediaRepo / FolderRepo / PermissionRepo   │
   │ StorageProviderRepo (集成 cryptkey)       │
   │ MediaTagRepo / ShareRepo / VersionRepo    │
   │ MediaSyncRepo                             │
   └────────┬──────────────────────────────────┘
            │ sqlx
            ▼
   ┌──────────────── PostgreSQL 17 ────────────┐
   │ media_files / media_folders / media_tags  │
   │ media_file_tags / media_variants          │
   │ media_versions / media_shares             │
   │ folder_permissions / storage_providers    │
   │ media_sync_jobs (Phase 4)                 │
   └───────────────────────────────────────────┘

   ┌──────────── storage backends (pluggable) ─────────────────┐
   │ storage.Storage (interface) — Upload/Get/Delete/GetURL    │
   │   ├─ LocalStorage      (basePath + URL prefix)            │
   │   └─ S3Storage         (S3/MINIO/COS/OSS/R2 共用)          │
   │       └─ Lister + HeadObject 扩展接口                     │
   └─────────────────────────────────────────────────────────-─┘
```

---

## 3. 子模块清单

| 文件 | 行数 | 职责一句话 |
| --- | ---: | --- |
| `internal/handler/media_handler.go` | 574 | 上传/列表/移动/回收站/永久删除/版本快照入口 |
| `internal/handler/folder_handler.go` | 170 | 文件夹 CRUD + 树形 + 移动 + Owner 校验 |
| `internal/handler/storage_provider_handler.go` | 236 | Provider CRUD + 测试连通 + 反向导入 + 云端浏览 |
| `internal/handler/sync_handler.go` | 152 | 同步 worker 启停 + 状态 + 失败重试 + per-media |
| `internal/handler/media_tag_handler.go` | 192 | 标签 CRUD + 文件打标 + 批量打标 |
| `internal/handler/share_handler.go` | 176 | 文件/文件夹分享链接 CRUD(密码 + 过期) |
| `internal/handler/permission_handler.go` | 159 | 文件夹细粒度授权(VIEW/UPLOAD/EDIT/DELETE/ADMIN) |
| `internal/handler/version_handler.go` | 112 | 版本恢复 / 删除(VULN-042 owner 校验) |
| `internal/service/media_service.go` | 1084 | 全模块最大,上传链路 + folder 权限校验 + provider 反查 + 缩略图 |
| `internal/service/folder_service.go` | 162 | 树形构造 + Visibility 默认值 |
| `internal/service/storage_provider_service.go` | 576 | 配置 redact / mergeProviderConfigJSON 深合并 / 反向导入 |
| `internal/service/sync_service.go` | 363 | atomic.Bool worker + errgroup + rate-limit + DB 状态机 |
| `internal/service/media_tag_service.go` | 201 | 标签 slug + usage_count 维护 |
| `internal/service/share_service.go` | 239 | bcrypt 密码 + RFC3339 过期 + 32B 随机 token |
| `internal/repository/media_repo.go` | 368 | 媒体 CRUD + variants + sync_status + 批量 |
| `internal/repository/folder_repo.go` | 148 | 物化路径计算 + slugifySimple |
| `internal/repository/storage_provider_repo.go` | 319 | cryptkey 加密 + lookup_catalog + 反向导入 INSERT |
| `internal/repository/media_sync_repo.go` | 256 | FOR UPDATE SKIP LOCKED 拣表 + 失败回退/上限 |
| `internal/repository/permission_repo.go` | 95 | 单条 EXISTS 查询 HasWriteAccess |
| `internal/repository/media_tag_repo.go` | 112 | 标签 + 关联表 + INCR/DECR usage |
| `internal/repository/share_repo.go` | 67 | 分享链接 4 操作 |
| `internal/pkg/storage/storage.go` | 49 | Storage 接口 + Lister 扩展 |
| `internal/pkg/storage/local.go` | 203 | LocalStorage(含 path traversal 防御) |
| `internal/pkg/storage/s3.go` | 650 | S3 多 provider + SSRF 防御 + multipart 上传 |
| `internal/pkg/storage/factory.go` | 30 | NewFromConfig 路由到 LOCAL/S3 |

---

## 4. 横向依赖

| 上游消费方 | 怎么用 | 关键交叉文件 |
| --- | --- | --- |
| **post 模块** | `posts.cover_image` 字段直接保存 `media_files.cdn_url` 或 `file_url` 字符串(冗余存,删除 post 不级联清 media)。 | `internal/repository/post_repo.go:85`(INSERT cover_image) · `internal/repository/post_repo.go:121`(白名单字段) |
| **AI 模块(图像生成)** | AI handler 输出 base64 → 走 `MediaService.Upload` 入 catalog,再返回 URL 到前端。AI service 自己**不**持有 storage client。 | `internal/handler/ai_handler.go`(上传到 default provider) |
| **AI 模块(用户头像 / 草稿附件)** | Agent chat 也通过 `/api/v1/admin/media/upload` 同一接口落库。 | 无独立 handler,共享路由 |
| **admin UI MediaPage** | 唯一全功能 UI 消费方:支持上传 / 折叠浏览 / 标签筛选 / 移动 / 同步触发 / 反向导入。 | `apps/admin/src/pages/MediaPage.tsx`(批次 1 改造) · `apps/admin/src/services/mediaService.ts`(`UploadOptions`/`uploadWithRetry`) |
| **blog 前端** | 仅消费图片 URL,不直接调 admin API;通过 `cover_image` / `markdown` 中嵌入的 URL。 | 无 |
| **AI service Python** | 仅作为 OCR / 图片打标的"调用方",通过 admin API 写回 `media_tags.category=AI_DETECTED`。 | `apps/ai-service/...` |

---

## 5. 关键决策与折衷

### 5.1 Provider 抽象层(深度 = 1)

**决策:** 不引入 Vendor SDK 抽象层,直接在 `internal/pkg/storage/factory.go:16` 用 `switch providerType` 把 5 个 S3 兼容厂商(S3/MINIO/COS/OSS/R2)合并到 **同一份 `S3Storage` 实现**(`internal/pkg/storage/s3.go:117`),通过 `applyProviderDefaults`(`s3.go:165`)在配置层补齐 region / endpoint。LOCAL 单独实现 `LocalStorage`。

**折衷:**
- ✅ 维护成本极低:腾讯 COS / 阿里 OSS / Cloudflare R2 都通过 AWS SDK v2 兼容,只差 endpoint + region 默认值。
- ✅ 安全统一:SSRF 防御(`s3.go:32` `validateEndpoint`)、key 校验(`s3.go:351` `validateS3Key`)对所有云厂商生效。
- ❌ 厂商专属能力(七牛预签 URL / OSS 内网加速等)无法表达,目前没需求。
- ❌ 不区分 PutObject 的厂商兼容性差异(R2 不支持 ChecksumAlgorithm 头等),靠"出问题再改"。

### 5.2 Folder 权限模型(双层 + 短路)

**决策:** `media_folders.owner_id + visibility` 是命名空间宿主关系;`folder_permissions` 是细粒度共享授权。**两层串联**走 `MediaService.assertFolderWritable`(`media_service.go:178`)的 7 步短路:

1. `folderID == nil` → 根目录,放行;
2. 依赖未注入(`folderLookup/permLookup == nil`) → 向后兼容,放行;
3. `folder` 不存在 → `ErrFolderNotFound`(404→handler 映射 400);
4. `folder.OwnerID == nil`(系统文件夹) → 放行;
5. `uploaderID == OwnerID` → 放行;
6. `folder_permissions` 中有 `UPLOAD/EDIT/DELETE/ADMIN` 任一级别且未过期 → 放行;
7. 其它 → `ErrFolderForbidden`(403)。

**折衷:**
- ✅ 入口护栏(Upload/Move)在 service 层硬拒,不依赖 handler 层 ownership 散落判断。
- ✅ Sentinel error 让 handler 层 `errors.Is` 精确分流 403/400/500(PR #647 P2 修复)。
- ❌ 校验在每次 `Upload` 都查一次 DB(2 个查询),没做 cache。低频管理操作,可接受。
- ❌ visibility=PUBLIC 的文件夹仍走第 6 步,语义是"公开可读 ≠ 任何人可写"——文档化,但 UI 没说清。

### 5.3 Sync Worker 队列(DB-only,不引入 Redis Queue)

**决策:** `media_sync_jobs` 表 + `FOR UPDATE SKIP LOCKED` 拣表(`media_sync_repo.go:71`)直接当队列。worker 用 `atomic.Bool` 单点 + `errgroup.SetLimit` 并发 + `time.Tick` 限速(`sync_service.go:170-198`)。

**折衷:**
- ✅ 零外部依赖,Redis 已经存在但本模块不强制依赖它。重启时把 RUNNING 重置为 PENDING(`media_sync_repo.go:178` `ResetRunningOnStartup`)防"幽灵任务"。
- ✅ MaxAttempt 计数器在 DB 持久化,跨进程重启不丢。
- ❌ 多 worker 节点抢同一行靠 SKIP LOCKED 而非真正的分布式锁,**目前 server 只起一个进程**所以无问题;水平扩容时需要重审。
- ❌ 状态变迁靠在 service 层手写事务(`media_sync_repo.go:124` `MarkJobSucceeded`),没有状态机库,容易 drift。

### 5.4 Provider 配置加密 + 脱敏 + 深合并(三层防御)

| 层 | 文件 / 函数 | 防什么 |
| --- | --- | --- |
| 落库加密 | `storage_provider_repo.go:43` `encryptConfig` 走 `cryptkey.Keystore`,前缀 `enc:v1:` | 防 DB dump 直接拿到 secret |
| 列表脱敏 | `storage_provider_service.go:436` `redactProviderConfigJSON` 把 secret 字段截成 `AB****CD12` | 防 admin JWT 滥用拉取明文 secret |
| 深合并 | `storage_provider_service.go:485` `mergeProviderConfigJSON` 在 PUT 时把脱敏占位 / null / 缺失字段从旧值继承 | 防 partial PUT(前端只改 bucket)把 region/endpoint/secret 抹掉 |

**折衷:**
- ✅ admin 编辑 provider 时前端展示的是脱敏值,提交不带新明文 → 系统知道"保留"而不是"清空"——这条没解决会导致 admin 改个 bucket 就把 OSS 凭据擦掉(批次 2 修复事故)。
- ✅ `cryptkey.Keystore` 未配置时透传,dev 环境零成本。
- ❌ legacy 明文行靠 `MigrateLegacyToEncrypted`(`storage_provider_repo.go:219`)启动时一次性迁移,失败只 log,不阻塞启动。
- ❌ 加密粒度是整段 JSON,**部分字段加密 / 部分明文** 不支持。

### 5.5 缩略图策略(LOCAL 异步落盘 vs 远程内存生成)

**决策:** `MediaService.Upload`(`media_service.go:393-418`)按 storage type 分支:
- LOCAL → `go imgproc.GenerateThumbnail` 异步读磁盘 + 落盘到 `thumbnails/{key}`;
- 远程 → 主上传时把图片 buffer 缓存内存(<= 20 MB),再 `uploadRemoteThumbnailAsync`(`media_service.go:516`)异步生成缩略图回写 provider + 写 `media_variants`。

**折衷:**
- ✅ LOCAL 不读多一遍磁盘;远程不再 GetObject 拉回来。
- ❌ 大图(>20 MB)缩略图直接跳过,只读 header 算尺寸 —— 在 admin 看到"无缩略图但能预览"。
- ❌ `UpdateContent` 路径(图片编辑器保存)缩略图根本不重新生成(`media_service.go:447`),next time 用户访问时主图与缩略图脱节,目前没自动刷新机制。

---

## 6. 数据库表关系

```
storage_providers ──┐  (config_json 加密 + redact + merge)
                    │ 1:N (storage_provider_id, backup_provider_id)
media_files ────────┴──── 1:N ──── media_variants  (THUMBNAIL/SMALL/...)
   │   │                            │
   │   │                            └─ storage_provider_id (042 加列)
   │   ├─── 1:N ──── media_versions  (current_version 编辑回滚)
   │   ├─── M:N ──── media_tags via media_file_tags (含 source: MANUAL/AI_AUTO)
   │   ├─── 1:N ──── media_shares    (FILE 类)
   │   ├─── 1:N ──── media_sync_jobs (043, FOR UPDATE SKIP LOCKED)
   │   └─── N:1 ──── media_folders ──── 1:N ──── folder_permissions (5 级)
   │                       │                          │
   │                       └─── 1:N ──── media_shares (FOLDER 类)
   ▼
posts.cover_image (字符串引用,弱关联,无 FK)
```

完整字段定义见 `internal/model/media.go`(主表+folder+provider) / `media_share.go` / `media_tag.go` / `media_version.go` / `folder_permission.go`。

---

## 7. 关键 Migration 演进

| Migration | 描述 | 关键改动 |
| --- | --- | --- |
| 000007 | 创建 `media_folders` 物化路径 + 给 `media_files` 加 `folder_id` | 默认根文件夹(id=1, "Root") |
| 000008 | `media_tags` + `media_file_tags` + `media_metadata`(目前 metadata 表未使用) | 种 4 个 SYSTEM 标签(重要/草稿/已发布/存档) |
| 000009 | `storage_providers` + `media_files.storage_provider_id` + `cdn_url` | 默认 LOCAL provider |
| 000010 | `media_variants`(THUMBNAIL/SMALL/MEDIUM/LARGE/WEBP/AVIF/ORIGINAL) + 给 media 加 `blurhash`/`exif_data`/`ai_labels` | 但目前只用 THUMBNAIL |
| 000011 | `folder_permissions`(VIEW/UPLOAD/EDIT/DELETE/ADMIN) + `media_shares` + `media_versions` + `media_files.current_version`/`is_archived` | 5 级权限上线 |
| 000012 | 修补 `media_files.deleted` / `deleted_at` 列(早期遗漏) | 让回收站机制生效 |
| **000042** | **provider_type CHECK 加 R2** + `media_files.storage_type` 同步加 R2 + `media_variants.storage_provider_id` 加列 | factory.go 一直接受 R2,但 DB CHECK 拒之门外的事故修复 |
| **000043** | 加 `media_files.sync_status`/`backup_provider_id`/`backup_url`/`backup_at`/`backup_error` + 创建 `media_sync_jobs` 表 + 在 `site_settings` 种入 `storage.sync.auto_enabled=false` | Phase 4 同步备份 |

---

## 8. 已知问题 / 限制

1. **Folder `file_count` / `total_size` 缓存不刷新。** `media_folders` 这两个字段从未被写入 — Upload/Delete 都不维护;list/树视图永远显示 0。属于已知坑。
2. **缩略图与主图脱节。** UpdateContent 不再生成新缩略图,新 key 与 `thumbnails/{old_key}` 永远脱钩。
3. **Sync Worker 单进程假设。** 多副本部署会重复处理 — 虽然 SKIP LOCKED 防抢但 `running atomic.Bool` 是进程内标志,看不见其它实例。
4. **Provider 删除会孤儿 catalog。** `storage_providers ON DELETE SET NULL` 让 `media_files.storage_provider_id` 变 NULL,但文件 key 还在云上 — 没有清理工具,只能手动。
5. **share_token 不可枚举但可暴力。** 32 字节随机已经足够,但目前没限速;未登录访问 `/share/:token` 端点(看代码只到 admin 创建,匿名访问端点不在本模块范围内)。
6. **测试覆盖盲区:** 只覆盖 `assertFolderWritable` / `mergeProviderConfigJSON` / SVG 防御。`SyncService.processBatch` / `StorageProviderService.ImportObjects` 没有单元测试。
7. **post.cover_image 是字符串冗余。** 删除媒体文件不会清空对应 post 的 cover_image,UI 上会显示 broken image。

---

## 9. 扩展点

| 扩展场景 | 切入文件 | 提示 |
| --- | --- | --- |
| 新增 Provider 类型(七牛 / 又拍) | `internal/pkg/storage/factory.go:16` + `s3.go:165` `applyProviderDefaults` | 七牛只支持自家 SDK,需要新增独立实现而非复用 S3Storage |
| 新增同步策略(双向同步 / 跨云迁移) | `internal/service/sync_service.go:201` `processJob` | 当前是单向(本地→云),反向需要 catalog 一致性策略 |
| 加 IP 限速 / 容量配额 | `internal/handler/media_handler.go:102` `Upload` 入口 | 目前只硬编码 100 MB 单文件上限 |
| Folder ACL 进一步细分(只读 list 但不读文件) | `permission_repo.go:81` `HasWriteAccess` + 新增 `HasReadAccess` | 当前 VIEW 级别只在前端 hide,后端没拦下载 |
| Background 清理孤儿 variant / 长期未访问文件 | 新增 cron 调用 `MediaRepo.ListVariants` + `Storage.Delete` | 没有现成入口 |
| 反病毒扫描(ClamAV) | `internal/service/media_service.go:296` `Upload` 在 `store.Upload` 之前插入扫描 | 需要 ClamAV daemon 或第三方 API |

---

## 10. 引用清单

- `apps/server-go/internal/server/server.go:281-328`(媒体系统 wire 段)
- `apps/server-go/internal/handler/media_handler.go`
- `apps/server-go/internal/service/media_service.go`
- `apps/server-go/internal/service/storage_provider_service.go`
- `apps/server-go/internal/service/sync_service.go`
- `apps/server-go/migrations/000007 / 000008 / 000009 / 000010 / 000011 / 000012 / 000042 / 000043`
- `CHANGELOG.md`「云储存全面优化 · 批次 2」(line 12-55)
