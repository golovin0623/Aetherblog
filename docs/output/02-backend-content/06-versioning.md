# 06 · Versioning（文章版本与媒体版本对照）

> **核心声明（必读）：** 当前代码库中**没有"文章版本快照"实现**。`version_handler.go` / `version_service.go` / `version_repo.go` / `media_versions` 表全部针对**媒体文件**，与 posts 表无关联。本文档把它们记录为对照参考，便于将来扩展到文章侧。
>
> 文章侧的"版本"目前只有 Redis 草稿（`AutoSave`），TTL 7 天，单线程，覆盖式存储。详 `01-posts.md` §5.4。

---

## 1. 责任范围（媒体版本，仅备查）

- 媒体文件版本历史（覆盖前自动快照）。
- 版本回滚（Restore）。
- 版本删除（PermanentDelete）。

> 文章版本不在范围内。

---

## 2. 关键代码入口（媒体）

### Handler 层
- `apps/server-go/internal/handler/version_handler.go:14-112` — VersionHandler 全部端点。
- `apps/server-go/internal/handler/version_handler.go:53-79` — `Restore`（含 VULN-042 ownership 校验）。

### Service 层
- `apps/server-go/internal/service/version_service.go:38-81` — `Restore`（双步快照）。
- `apps/server-go/internal/service/version_service.go:104-120` — `CreateVersionFromFile`（媒体 upload 覆写前自动调）。

### Repository 层
- `apps/server-go/internal/repository/version_repo.go:21-25` — `FindByFileID`（按 version_number DESC）。
- `apps/server-go/internal/repository/version_repo.go:76-80` — `GetMaxVersionNumber`（COALESCE(MAX, 0)）。

---

## 3. 路由表（媒体）

| 方法 | 路径 | Handler | 鉴权 |
| --- | --- | --- | --- |
| GET | `/admin/media/files/:fileId/versions` | `GetHistory` | JWT + admin |
| POST | `/admin/media/files/:fileId/versions/:versionNumber/restore` | `Restore` | JWT + admin + ownership |
| DELETE | `/admin/media/versions/:versionId` | `Delete` | JWT + admin + ownership |

---

## 4. 数据流（Restore，仅备查）

```
POST /admin/media/files/:fileId/versions/:vN/restore
   |
   v
version_handler.go:53 Restore
   ├─ 解析 fileID
   ├─ mediaSvc.GetUploaderID(fileID) → uploaderID
   ├─ middleware.AssertOwnership(c, uploaderID)  ← VULN-042
   ├─ 解析 versionNumber
   |
   v
version_service.go:38 Restore(fileID, versionNumber)
   ├─ FindByFileAndVersion(fileID, vN) → targetVersion
   ├─ mediaRepo.FindByID(fileID) → currentFile
   ├─ GetMaxVersionNumber(fileID) → maxVer
   ├─ 第 1 步：把 currentFile 现状保存为 v(maxVer+1)
   |    └─ Create({ FilePath: file.FilePath, FileURL, FileSize,
   |                ChangeDescription: "恢复前自动保存 (v{file.CurrentVersion})" })
   ├─ 第 2 步：把 file.* 字段覆写为 targetVersion 的 (FilePath, FileURL, FileSize)，
   |          version 标 maxVer+2
   |    └─ mediaRepo.UpdateFileContent(fileID, targetVersion.FilePath, ..., maxVer+2)
   |
   v
return nil
```

> **怪味（非显然）：** 第 1 步快照用 `maxVer+1`，第 2 步把文件指向 `maxVer+2`，**但第 2 步不写新版本行**——只是更新 `media_files.current_version` 为 `maxVer+2`。这意味着 `media_versions` 表里永远会有"保存自当前内容"的快照（v=maxVer+1），但回滚目标内容没有以新 version 行单独入库。下次 GetHistory 看到的是：原始 v1, v2, ..., v=maxVer, v=maxVer+1（自动快照），media_files.current_version=maxVer+2。**这导致 v=maxVer+2 在 media_versions 表里查不到内容**。如果再次 Restore，会以 v=maxVer+3 快照"当前"（其实是回滚到的旧内容），v=maxVer+4 指向新选择的版本。每次 Restore 创造一行不是"独立内容"的孤儿版本号，version_number 单调递增但不连续。
>
> 这不是 bug（因为内容已经在历史快照里了），但 UI 显示"v=maxVer+2"时找不到实体行会困惑。建议设计师在前端 hide 这种 phantom 版本号，或者在 Restore 第 2 步多写一行"指向旧版本"的 alias 行。

---

## 5. DB 表（媒体，仅备查）

### media_versions（`migration 000011:47-65`）

| 字段 | 类型 |
| --- | --- |
| id | BIGSERIAL |
| media_file_id | BIGINT FK CASCADE |
| version_number | INT |
| file_path | VARCHAR(500) |
| file_url | VARCHAR(500) |
| file_size | BIGINT |
| change_description | TEXT |
| created_by | BIGINT FK |
| created_at | TIMESTAMP |

约束：`UNIQUE(media_file_id, version_number)`。索引：`idx_media_versions_file` / `idx_media_versions_created`。

---

## 6. 文章版本：当前实现

### 6.1 唯一的"版本"机制 = Redis 草稿
- key：`post:draft:<postID>`
- value：`CreatePostRequest` JSON
- TTL：7 天（`post_service.go:27`）
- 触发写入：`POST /admin/posts/:id/auto-save`
- 触发清除：`PUT /admin/posts/:id`（Update 后自动 deleteDraft）
- 单线程：每个 postID 只有一份最新草稿，**没有版本链**。

### 6.2 没有的功能（与媒体侧对比）
| 功能 | 媒体 | 文章 |
| --- | --- | --- |
| 历史快照表 | media_versions | **无** |
| 版本号 | version_number | 无 |
| 回滚到版本 N | Restore | **无** |
| 删除单个版本 | Delete | 无 |
| 修改前自动快照 | UploadContent → CreateVersionFromFile | **无** |
| 比较两个版本 diff | 无（媒体也没有） | 无 |

### 6.3 业务推断（为什么文章没做？）
- 文章 Markdown 体积可控（KB 级），但 admin 编辑频次低（每天几次 vs 媒体批量上传）。
- AutoSave Redis 草稿覆盖 90% 误删场景：编辑器崩了 → reopen → 草稿弹出。
- 真正需要 git-like 版本控制的场景（多人协作、blame、merge）当前博客一人维护，过度设计。
- 但**搜索 embedding 是版本化的**（migration 000034：`post_embeddings(post_id, model_id)` UNIQUE，每个模型一行），AI 侧已经具备版本概念。

### 6.4 如要补全文章版本

最小可用实现：
```sql
CREATE TABLE post_versions (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    title VARCHAR(200) NOT NULL,
    slug VARCHAR(200) NOT NULL,
    content_markdown TEXT,
    summary VARCHAR(2000),
    cover_image VARCHAR(500),
    category_id BIGINT,
    tag_ids INT[],
    change_description TEXT,
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(post_id, version_number)
);
```
然后在 `PostService.Update` / `Publish` 之前调用 `CreateVersionFromPost`，与 media 同款。

要做更复杂的（git-like）需要：
- 版本间 diff（Go 调 `github.com/sergi/go-diff` 或前端 monaco diff editor）。
- 分支 / merge 概念 → 已经超出博客范畴，进入 CMS 领域。

---

## 7. 配置 / 环境变量

无（无论媒体还是文章版本，都没有专属配置）。

---

## 8. 与其他模块耦合

媒体 versioning：
| 方向 | 模块 | 接触面 |
| --- | --- | --- |
| 依赖 | MediaService | 检查 uploader 做 ownership 校验 |
| 被依赖 | MediaHandler.UploadContent | 覆写文件前自动 CreateVersionFromFile |

文章 versioning：
| 方向 | 模块 | 接触面 |
| --- | --- | --- |
| 部分代偿 | Redis（PostService.AutoSave） | 唯一的"草稿"语义 |
| AI 侧具备版本概念 | post_embeddings | 不是文章本体的版本，是嵌入向量的版本 |

---

## 9. 已知限制（媒体侧，仅备查）

1. **Restore 第 2 步生成 phantom 版本号**（详 §4 怪味）。
2. **GetHistory 不分页**：媒体如果版本很多（图片反复编辑），全量返回；通常一个文件不会太多版本，可接受。
3. **Delete 单版本不防删 v1**：可以把第一版删了，导致 GetHistory 列表"不连续"。前端要不要保护需要权衡。
4. **VULN-042 校验依赖 mediaSvc.GetUploaderID**：如果该方法返回错误的 uploaderID（mediaRepo 损坏），ownership 校验会误放行。

---

## 10. 已知限制（文章侧）

1. **没有版本历史**（详 §6.2）。
2. **Redis 草稿无并发保护**：两个 admin 同时编辑同一篇会互相覆盖（最后写赢）。
3. **草稿无审计**：删了就没了，没人知道谁删过。

---

## 11. 测试覆盖

媒体 Version：无 `version_*_test.go`。
文章 Version：N/A（无实现）。
