# 01 · 上传链路

> 输入:multipart/form-data (`file` / `files[]` 字段) + 可选 `folderId` + 当前登录用户。
> 输出:`MediaFileVO`(含 cdn_url / storageProviderId / sync_status 等字段)。
> 关键文件:`internal/handler/media_handler.go:102` · `internal/service/media_service.go:296` · `internal/pkg/storage/`。

---

## 1. 责任范围

把 admin / Agent 上传的 multipart 文件,按以下步骤落到正确的存储后端 + 写入 `media_files` catalog:

1. 接收 multipart 文件 + 限制 100 MB;
2. 解析 / 写入 `folderId`,跨用户写入须通过 `folder_permissions` 校验;
3. **三层 SVG 防御** + MIME 白名单 + 内容嗅探 + 扩展名兜底;
4. 解析当前 default `storage_provider`(LOCAL / S3 / OSS / COS / MINIO / R2);
5. 生成 key (`{年}/{月}/{毫秒时间戳}_{安全文件名}`);
6. 上传(LOCAL 走 `os.Create`,远程走 SDK 单 PUT 或 multipart);
7. 解析尺寸 + 异步生成缩略图(LOCAL 落盘 / 远程上传到同 provider 的 `thumbnails/{key}`);
8. INSERT `media_files`(含 `cdn_url`, `storage_provider_id`,后续可用 `MediaTagHandler` 打标);
9. handler 写 `activity_event` `media.upload`(失败只 log)。

---

## 2. 关键代码入口

| 入口 | 文件 / 函数 | 行 | 备注 |
| --- | --- | ---: | --- |
| 单文件 | `media_handler.go:102` `MediaHandler.Upload` | 102 | `POST /api/v1/admin/media/upload?folderId=N` |
| 批量(混合结果) | `media_handler.go:140` `MediaHandler.UploadBatch` | 140 | `POST /api/v1/admin/media/upload/batch`,失败的文件以 `{error, filename}` 返回,不中断整批 |
| 内容覆盖(图片编辑器保存) | `media_handler.go:510` `MediaHandler.UploadContent` | 510 | `POST /:id/content`;先写版本快照,再走 `MediaService.UpdateContent` |
| 上传业务实现 | `media_service.go:296` `MediaService.Upload` | 296 | folder 校验 + SVG 拒收 + MIME 白名单 + Provider 解析 + 异步缩略图 + Catalog 写入 |
| 内容覆盖业务实现 | `media_service.go:449` `MediaService.UpdateContent` | 449 | 复用同 provider 写新 key,`?v={version}` 让 CDN 失效 |
| Provider 解析 | `media_service.go:226` `MediaService.resolveStore` | 226 | `nil` 走 default;非 nil 走具体 ID;LOCAL → `localStore`,其它走 cache |
| MIME 白名单 | `media_service.go:41` `allowedMimeTypes` | 41 | 含 image/video/audio/Office/zip/font 但**故意不含 image/svg+xml** |
| SVG 防御 | `media_service.go:891` `rejectSVGByFilename` + `media_service.go:926` `resolveMimeWithFallback` | 891/926 | 文件名层 + MIME 嗅探 + 扩展名兜底 三层 |
| 文件名安全化 | `media_service.go:1068` `sanitizeFilename` | 1068 | 移除 NUL/RTL override,非 `[a-zA-Z0-9._-]` 替换为 `_` |

---

## 3. 数据流(以单文件 LOCAL provider 为例)

```
1. POST /api/v1/admin/media/upload?folderId=12
   form data: file=@photo.jpg
   ┌──────────────────────────────────────────────────────────────┐
   │ MediaHandler.Upload (media_handler.go:102)                   │
   │   • c.FormFile("file") → fh                                  │
   │   • size <= 100 MB ?                                         │
   │   • lu := middleware.GetLoginUser(c) → uploaderID            │
   │   • parse query "folderId" → *int64                          │
   │   • call svc.Upload(ctx, fh, uploaderID, folderID)          │
   └──────────────────────────────────────────────────────────────┘

2. MediaService.Upload (media_service.go:296)
   ┌──────────────────────────────────────────────────────────────┐
   │ a. assertFolderWritable(ctx, folderID, uploaderID)            │
   │     - folderID nil → 放行                                    │
   │     - 否则查 media_folders → 校验 owner_id 或 perm  (§02)    │
   │     - 拒绝时抛 ErrFolderForbidden / ErrFolderNotFound          │
   │                                                              │
   │ b. fh.Open() → multipart.File                                │
   │                                                              │
   │ c. 文件名层 SVG 拒收                                          │
   │     rejectSVGByFilename("photo.jpg") → nil                   │
   │     (.svg/.svgz 直接抛 "不允许上传该文件类型: image/svg+xml") │
   │                                                              │
   │ d. 嗅探前 512 字节 → http.DetectContentType → "image/jpeg"   │
   │     seeker.Seek(0, 0)  // 重置到文件头                       │
   │                                                              │
   │ e. resolveMimeWithFallback(detected, filename)               │
   │     - detected ∈ {octet-stream, zip, text/plain*} → 用扩展名 │
   │     - 否则透传 detected                                      │
   │     - 关键防御:.svg/.svgz 走任何分支都映射回 image/svg+xml   │
   │                                                              │
   │ f. !allowedMimeTypes[mime] → "不允许上传该文件类型: image/svg+xml" │
   │                                                              │
   │ g. fileType = classifyFileType(mime) → "IMAGE"               │
   │                                                              │
   │ h. resolveStore(ctx, nil) → (LocalStorage, *provider, nil)   │
   │                                                              │
   │ i. key = "2026/05/1715190000000_photo.jpg"                   │
   │                                                              │
   │ j. 远程 provider 才走 imgBuf 缓存(<= 20 MB)→ 复用算尺寸     │
   │     LOCAL 直接 store.Upload(ctx, key, f, size, mime)         │
   │                                                              │
   │ k. publicURL = LocalStorage.GetURL(key) = "/api/uploads/..."  │
   │                                                              │
   │ l. 构造 model.MediaFile {                                    │
   │       Filename = sanitized,                                  │
   │       OriginalName = "photo.jpg",                            │
   │       FilePath = key,    // = file_url                       │
   │       FileURL = key,     // 相对路径,切 provider 仍能用      │
   │       FileSize, MimeType, FileType,                          │
   │       StorageType = "LOCAL",                                 │
   │       StorageProviderID = &p.ID,                             │
   │       CdnURL = &publicURL,    // 前端永远读这个              │
   │       Width/Height = imgproc.GetDimensions(absPath),         │
   │     }                                                        │
   │                                                              │
   │ m. LOCAL 异步缩略图:                                         │
   │     go imgproc.GenerateThumbnail(localPath, "thumbnails/"+key,│
   │                                  300)                        │
   │     远程缩略图:                                              │
   │     uploadRemoteThumbnailAsync(store, key, mime, imgBuf, p)  │
   │       └─ 在 goroutine 内 imgproc.GenerateThumbnailFromReader │
   │       └─ store.Upload(ctx, "thumbnails/"+key, ...)           │
   │       └─ media_repo.UpsertVariant 写 media_variants 表       │
   │                                                              │
   │ n. mediaRepo.Create(ctx, &m)  ← INSERT 完整行                │
   │                                                              │
   │ o. return toMediaFileVO(m)                                   │
   └──────────────────────────────────────────────────────────────┘

3. MediaHandler.Upload (回到 handler)
   • 写 activity_event {event_type:"media.upload", category:"media",
                        title:"上传文件: photo.jpg", status:"SUCCESS"}
   • response.OK(c, vo)  → JSON {code:200, data: MediaFileVO{...}}
```

---

## 4. MIME 校验链(防伪造扩展名)

`MediaService.Upload`(`media_service.go:316-336`)的 4 步校验链:

| 步 | 检查 | 拒绝条件 | 关键代码 |
| --- | --- | --- | --- |
| 1 | 文件名硬拒 | `guessMimeType(name) == "image/svg+xml"` | `media_service.go:311` `rejectSVGByFilename` |
| 2 | 嗅探前 512 字节 | `http.DetectContentType` 返回值不在白名单且扩展名兜底也不在 | `media_service.go:317-321` |
| 3 | MIME 解析回退 | `octet-stream` / `zip` / `text/plain*` 退化时优先用扩展名 | `media_service.go:926` `resolveMimeWithFallback` |
| 4 | 白名单二次校验 | `!allowedMimeTypes[mime]` | `media_service.go:334` |

**SVG 三层防御对应表**(任一层移除都会重新打开存储型 same-origin XSS):

| 攻击载荷 | 嗅探结果 | 拦截层 | 失败时拦不住的原因 |
| --- | --- | --- | --- |
| `.svg` 带 `<?xml ?>` 前缀 | `text/xml; charset=utf-8`(在白名单) | 第 1 层(文件名硬拒) | 白名单必须保留 text/xml 给 OOXML / 订阅源 |
| `.svgz`(gzip 压缩) | gzip magic → `application/octet-stream` | 第 1 层 + 第 2 层(扩展名兜底映射回 image/svg+xml) | 嗅探伪装为 octet-stream 时只能靠扩展名 |
| `.svg` 简单内容 | `text/plain; charset=utf-8` | 第 3 层(text/plain 前缀回退) | 早期实现是精确匹配 `text/plain`,带 charset 时绕过 |

测试覆盖在 `media_service_test.go:189-291`(`TestSVGExtensionMapping` / `TestOctetStreamFallbackForSVG` / `TestTextPlainFallbackForSVG` / `TestXMLSniffedSVGStillBlocked`)。

---

## 5. 路径生成与去重

**Key 格式:** `{年}/{月}/{Unix 毫秒时间戳}_{sanitizedFilename}` (`media_service.go:347-349`)

```go
now := time.Now()
safeName := sanitizeFilename(fh.Filename)
key := fmt.Sprintf("%d/%02d/%d_%s", now.Year(), now.Month(), now.UnixMilli(), safeName)
```

实例:`2026/05/1715190000000_photo.jpg` —— 月份零填充,时间戳避免同名冲突。

**没有去重逻辑:**
- 上传两个相同字节内容的文件会产生两份独立存储 + 两条 catalog;前端不会感知。
- 如要做内容寻址(content-hashing),需要在 service 层加 `sha256` 计算 + `media_files.content_hash` 列。**目前没实现**。

`sanitizeFilename`(`media_service.go:1068`)规则:
1. 取 `filepath.Base` 去除路径前缀;
2. 删除 NUL(`\x00`)/ RTL override(`‮`)/ RLM(`‏`)/ LRM(`‎`)防文件名欺骗;
3. 替换 `[^a-zA-Z0-9._-]` 为 `_`;
4. 空 / `.` / `..` 兜底为 `"file"`。

---

## 6. 存储后端选择(resolveStore)

```go
// media_service.go:226
func (s *MediaService) resolveStore(ctx context.Context, providerID *int64) (storage.Storage, *model.StorageProvider, error)
```

| 场景 | 走向 | 缓存 |
| --- | --- | --- |
| `providerID == nil` 且 `default IS LOCAL` | `s.localStore`(server.go 启动时构造) | 进程级单例 |
| `providerID == nil` 且 `default IS S3/OSS/...` | `storage.NewFromConfig` 创建 → `storeCache[p.ID]` | 由 provider ID 索引,Update/Delete 后由 `MediaService.InvalidateProvider` 清掉 |
| `providerID != nil` 且记录存在 | 同上分支 | 同上 |
| `providerID != nil` 但记录已被删 | log warning + 回退 `s.localStore`("文件孤儿") | 不缓存 |

**重要约束:** 远程 provider 的 client 由 `storeCache` 持有,Update provider 时 service.Update 会调用 `mediaSvc.InvalidateProvider(id)`(`storage_provider_service.go:99`)。**没有这一步**就会出现"改了 secret 但客户端还用旧凭据"。

---

## 7. 大文件上传策略

| 文件大小 | LOCAL 路径 | 远程路径(S3/OSS/...) |
| --- | --- | --- |
| 任何 | `io.Copy` 写到磁盘 | <16 MB:单次 PutObject + ContentLength 透传 |
| | | ≥16 MB:`manager.NewUploader` 自动分片(8 MB/片,4 并发,失败清理) |

`internal/pkg/storage/s3.go:380` `S3Storage.Upload` 实现路径切换:

```go
if size > 0 && size < multipartThreshold { // 16 MB
    s.client.PutObject(ctx, &s3.PutObjectInput{...ContentLength: aws.Int64(size)...})
} else {
    uploader := manager.NewUploader(s.client, func(u *manager.Uploader) {
        u.PartSize = multipartPartSize       // 8 MB
        u.Concurrency = multipartConcurrency // 4
    })
    uploader.Upload(ctx, &s3.PutObjectInput{...})
}
```

handler 层硬限制 100 MB(`media_handler.go:107` `maxUploadSize`),admin UI 上传更大文件需要先调整这个常量 + 调整 nginx `client_max_body_size`。

---

## 8. UpdateContent(图片编辑器保存)

不是新增上传,而是**用编辑后的内容覆盖既有 `media_files.id`**,行为有几个微妙之处:

1. 重新校验文件名 SVG(防止把 `evil.svg` 当作 PNG 编辑后的产物覆盖);
2. **沿用旧 record 的 `storage_provider_id` 解析 store** —— 不切 default,即使 default 已经换了云;
3. 写新 key `{年}/{月}/{ms}_edited{ext}`,**旧 key 不立即删** —— 留给 `media_versions` 历史快照恢复;
4. 更新 `cdn_url` 时追加 `?v={current_version}`(`media_service.go:498-503`),让 CDN 缓存自动失效;
5. 缩略图**不重新生成**(`media_service.go:447` 注释明确说明这是已知缺陷)。

---

## 9. 数据库表 + 字段 + 索引

**`media_files`**(主表,定义见 `migrations/000001_init_schema.up.sql` + 后续 alter):

| 字段 | 类型 | 来源 migration | 说明 |
| --- | --- | --- | --- |
| `id` | BIGSERIAL PK | 000001 | |
| `filename` / `original_name` | VARCHAR | 000001 | 安全化后存储名 + 原始名 |
| `file_path` / `file_url` | VARCHAR | 000001 | LOCAL=key;远程=key,切 provider 仍能用 |
| `file_size` | BIGINT | 000001 | 字节 |
| `mime_type` / `file_type` / `storage_type` | VARCHAR | 000001 + **000042**(R2) | storage_type 受 CHECK 约束 |
| `width` / `height` / `alt_text` | INT/TEXT NULL | 000001 | imgproc 提取 |
| `uploader_id` | BIGINT FK users | 000001 | nil = 匿名 |
| `folder_id` | BIGINT FK media_folders | 000007 | ON DELETE SET NULL |
| `storage_provider_id` | BIGINT FK storage_providers | 000009 | ON DELETE SET NULL → 孤儿风险 |
| `cdn_url` | VARCHAR(500) | 000009 | 前端永远读这个 |
| `blurhash` / `exif_data` / `ai_labels` | VARCHAR / JSONB | 000010 | exif/labels 目前未填充 |
| `current_version` | INT default 1 | 000011 | UpdateContent +1 |
| `is_archived` / `archived_at` / `archived_by` | BOOL/TS/BIGINT | 000011 | 归档不删,目前无 UI |
| `deleted` / `deleted_at` | BOOL/TS | 000012 | 回收站标志 |
| `sync_status` | VARCHAR(16) NOT NULL DEFAULT 'NONE' | **000043** | NONE/PENDING/SYNCING/SYNCED/FAILED |
| `backup_provider_id` / `backup_url` / `backup_at` / `backup_error` | BIGINT/VARCHAR/TS/TEXT | 000043 | 备份完成后填 |

**索引:**
- `idx_media_files_folder` (folder_id)
- `idx_media_files_storage_provider` (storage_provider_id)
- `idx_media_files_deleted` (deleted)
- `idx_media_files_archived` (is_archived)
- `idx_media_files_sync_status` (sync_status WHERE sync_status != 'NONE') — 部分索引避免 NONE 占空间
- `idx_media_files_ai_labels` GIN(ai_labels)

**`media_variants`** (000010 + 000042):
- 关键字段:`media_file_id` / `variant_type` / `file_path` / `file_url` / `file_size` / `width` / `height` / `format` / `quality` / `storage_provider_id`(042 加列)
- `UNIQUE (media_file_id, variant_type)` —— 一个主图每种 variant 只能有一行
- 当前只用 `THUMBNAIL` 一种,SMALL/MEDIUM/LARGE/WEBP/AVIF/ORIGINAL 在 schema 里但代码不写

---

## 10. 配置 / 环境变量

| 变量 / 配置 | 默认 | 影响 |
| --- | --- | --- |
| `aetherblog.upload.path` (`config.yaml`) | `./uploads` | LOCAL 存储根目录 |
| `aetherblog.upload.url_prefix` | `/uploads` | LOCAL URL 前缀(实际 server 用 hardcoded `/api/uploads`,见 `server.go:282`) |
| `aetherblog.media.trash_cleanup_days` | `120` | 配置存在但**当前代码没用** |
| `AI_CREDENTIAL_ENCRYPTION_KEYS`(env) | 空 | 控制 `cryptkey.Keystore`,影响 provider config 加密(详见 §03) |
| `multipartThreshold` 常量 | 16 MB | `s3.go:22`,小于此走 PutObject;大于走 multipart |
| `maxThumbnailMemorySize` 常量 | 20 MB | `media_service.go:31`,远程模式超过此体积只读 header,跳过缩略图 |
| handler 层 `maxUploadSize` | 100 MB | `media_handler.go:107` 与 `:524`,两处 hardcoded |

---

## 11. 与其他模块耦合

| 模块 | 关系 | 关键交叉点 |
| --- | --- | --- |
| **Folder + Permission**(§02) | Upload 入口走 `assertFolderWritable` | `media_service.go:299` |
| **Storage Provider**(§03) | Upload 解析当前 default;Update Provider 后清缓存 | `media_service.go:341` `resolveStore(nil)` |
| **Activity Events** | Upload/Delete 异步写 `activity_event.media.*` | `media_handler.go:478` `recordMediaActivity` |
| **Version**(§06.1 草稿) | UploadContent 写版本快照 | `media_handler.go:533-549` |
| **post 模块** | post 引用 `cdn_url` 字符串,不双向同步 | post_repo.go cover_image 字段 |

---

## 12. 已知限制

1. **没有去重 / 内容寻址。** 同字节文件多次上传都新增独立 key + catalog 行。
2. **缩略图大小不可配置。** `300px` hardcoded(`media_service.go:403, 519`)。
3. **没有 antivirus / 内容审核。** 上传完成立即可访问。
4. **缩略图失败不会重试。** 异步 goroutine 内的 `imgproc.GenerateThumbnail` 出错只打 warn log。
5. **handler 层 100 MB 上限不可配置。** 改大需要 nginx + Go 同步。
6. **多线程上传至同一 provider 会同时读 storeCache,但 cache miss 时多个请求同时 `NewFromConfig` 各创建一份 client(`media_service.go:267`)** ——读锁释放后写锁竞争,会有"瞬时多 client"。低概率,无功能影响。

---

## 13. 测试覆盖说明

`internal/service/media_service_test.go` 共 380 行,覆盖:

| 测试 | 目标 | 数量 |
| --- | --- | --- |
| `TestAssertFolderWritable` | folder 权限 7 步短路 | 10 个表驱动子用例 |
| `TestAssertFolderWritable_BackwardCompat` | 依赖未注入时不拦上传 | 1 |
| `TestAssertFolderWritable_SentinelErrors` | `errors.Is(err, ErrFolderForbidden/NotFound)` | 1 |
| `TestSVGExtensionMapping` | guessMimeType 把 .svg/.svgz 映射回 svg+xml | 4 文件名 |
| `TestOctetStreamFallbackForSVG` | octet-stream 嗅探时扩展名兜底 | 2 |
| `TestTextPlainFallbackForSVG` | text/plain* 嗅探时扩展名兜底 | 4 |
| `TestXMLSniffedSVGStillBlocked` | text/xml 嗅探时文件名硬拒 | 1 |
| `TestResolveMimeWithFallbackPreservesAllowedDetected` | 已知白名单类型不被覆盖 | 5 |
| `TestUploadRejectsSVGByFilename` | 集成测试 multipart Upload 入口 | 3 |
| `TestUpdateContentRejectsSVGByFilename` | UpdateContent 入口同样硬拒 | 3 |

**未覆盖:**
- `Upload` 完整链路(需 mock store / repo)
- `UpdateContent` cdn_url `?v=` 拼接逻辑
- 远程 provider 缩略图异步 goroutine
- 100 MB 限制 / 0 字节 / 极大文件
