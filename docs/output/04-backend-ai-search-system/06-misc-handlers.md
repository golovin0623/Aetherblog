# 06 · 杂项 Handler (友链 / 设置 / 站点 / 访客 / 迁移 / 版本 / 日志级别)

> 本文档收录功能上属于「站点配置 / 数据治理」边界,但不归类到 AI / 搜索 / 统计 / 监控的 7 个 handler。

## 1. friend_link_handler — 友情链接

### 1.1 责任

提供博客侧 Blogroll 的 admin CRUD + 公开列表。8 个 admin 端点 + 1 个公开端点。

### 1.2 关键代码入口

| file:line | 端点 | 描述 |
| --- | --- | --- |
| `apps/server-go/internal/handler/friend_link_handler.go:35-46` | `MountAdmin` | 注册 admin 端点 |
| `friend_link_handler.go:49-51` | `MountPublic` | `GET /v1/public/friend-links` |
| `friend_link_handler.go:55-61` | `GET /v1/admin/friend-links` | 全量(含隐藏) |
| `friend_link_handler.go:65-71` | `GET /v1/public/friend-links` | 仅可见 |
| `friend_link_handler.go:75-82` | `GET /v1/admin/friend-links/page` | 分页 |
| `friend_link_handler.go:86-99` | `GET /v1/admin/friend-links/:id` | 单条 |
| `friend_link_handler.go:103-117` | `POST /v1/admin/friend-links` | 创建 |
| `friend_link_handler.go:121-135` | `PUT /v1/admin/friend-links/:id` | 更新 |
| `friend_link_handler.go:139-152` | `DELETE /v1/admin/friend-links/:id` | 删除 |
| `friend_link_handler.go:156-165` | `DELETE /v1/admin/friend-links/batch` | 批删 |
| `friend_link_handler.go:169-179` | `PATCH /v1/admin/friend-links/:id/toggle-visible` | 切换可见性 |
| `friend_link_handler.go:183-192` | `PATCH /v1/admin/friend-links/reorder` | 重排序 |

### 1.3 路由注册顺序坑

`friend_link_handler.go:30-46` 注释强调:

> 字面量 path (`/batch`, `/reorder`, `/page`) 必须在参数化 path (`/:id`) 之前注册。Echo 底层 trie 匹配时按注册顺序取第一条命中,若 `/batch` 登记在 `/:id` 之后,会被当作 id=="batch" 走到 Get/Delete/Update。

### 1.4 数据模型

`apps/server-go/internal/model/friend_link.go`:

```go
type FriendLink struct {
    ID          int64
    Name        string
    URL         string
    Logo        *string
    Description *string
    Email       *string
    RSSUrl      *string
    ThemeColor  *string  // 默认 "#6366f1" (Aether 品牌色)
    IsOnline    bool     // 健康状态(后台 ping 检测,功能尚未实装)
    LastCheckAt *time.Time
    SortOrder   int
    Visible     bool
    CreatedAt   time.Time
    UpdatedAt   time.Time
}
```

### 1.5 审计

`Create` 和 `Delete` 写 `event_type=friend.create / friend.delete`,`event_category=friend`。`Update` 不写审计(可能后续补)。

---

## 2. site_setting_handler — 站点设置

### 2.1 责任

键值对配置存储。所有 admin 可调的「软设置」(站点名、Logo、SEO、AI 开关、储存类型...)。**严格 key 白名单**,不允许任意写。

### 2.2 关键代码入口

| file:line | 端点 |
| --- | --- |
| `apps/server-go/internal/handler/site_setting_handler.go:60-67` | `Mount` |
| `site_setting_handler.go:71-77` | `GET /v1/admin/settings` |
| `site_setting_handler.go:99-110` | `GET /v1/admin/settings/group/:group` |
| `site_setting_handler.go:114-125` | `GET /v1/admin/settings/:key` |
| `site_setting_handler.go:131-163` | `PUT /v1/admin/settings/:key` |
| `site_setting_handler.go:166-186` | `PATCH /v1/admin/settings/batch` |

### 2.3 白名单

`allowedSettingKeys` (`site_setting_handler.go:18-47`) ~50 个 key,分组:`general / author / comment / storage / ai / appearance / seo / social / advanced`。

`allowedSettingGroups` (`site_setting_handler.go:81-94`) 12 个分组:`site / ui / author / seo / ai / search / comment / welcome / social / storage / analytics / font`。

> ⚠️ **白名单不一致**:`allowedSettingKeys` 里包含 `seo_robots / enable_sitemap / google_analytics_id` 但分组键叫 `seo`;`storage_type` 在 keys 但分组叫 `storage`。这是历史遗留,部分 key 是单独按 key 操作,部分按 group 操作。新增配置项需要同时在 keys + groups 加。

### 2.4 兼容多种 PUT 请求体

```
PUT /v1/admin/settings/site_name  Body: "MyBlog"           // 纯 JSON 字符串
PUT /v1/admin/settings/site_name  Body: {"value": "MyBlog"} // JSON 对象
```

`UpdateByKey`(`site_setting_handler.go:131-163`)先尝试 `json.Unmarshal(&val)`,失败再尝试 `map[string]string`,取 `obj["value"]`。

### 2.5 审计

所有写操作都写 `event_type=system.setting_update`,`event_category=system`。

---

## 3. site_handler — 公开站点信息

### 3.1 责任

3 个公开端点,服务于 blog 前端首页 / 关于页。

### 3.2 关键代码入口

| file:line | 端点 |
| --- | --- |
| `apps/server-go/internal/handler/site_handler.go:34-38` | `Mount` |
| `site_handler.go:43-61` | `GET /v1/public/site/info` |
| `site_handler.go:66-79` | `GET /v1/public/site/stats` |
| `site_handler.go:83-96` | `GET /v1/public/site/author` |

### 3.3 特殊点

- `Info` 把管理员 (`username='admin'`) 的 `nickname / avatar / bio` 注入到响应,作为「作者信息」(`site_handler.go:50-54`)。这是因为系统不是多作者博客,默认只有 admin 一个用户。
- `prefixLocal`(`site_handler.go:109-114`)把 `/uploads/...` 开头的本地路径加 `/api` 前缀,以便前端走统一 API 网关访问。
- `Stats` 的 `comments` / `views` 暂时硬编码为 0(代码注释「待实现」)。

---

## 4. visitor_handler — 访问记录

参见 04-analytics-and-stats.md §3.5。

| file:line | 端点 |
| --- | --- |
| `apps/server-go/internal/handler/visitor_handler.go:19-22` | `Mount` |
| `visitor_handler.go:39-71` | `POST /v1/public/visit` |
| `visitor_handler.go:75-81` | `GET /v1/public/visit/today` |

兼容 Java 风格 `path / postId` + 扩展 `pageUrl / pageTitle / referer`。`path` 优先,缺失时降级 `pageUrl`。

「即发即忘」+ 60/min IP 限流 + URL 长度上限 2048 + Title 截 256。

---

## 5. migration_handler — VanBlog 数据迁移

### 5.1 责任

VanBlog 是另一个开源博客系统。本模块提供从 VanBlog backup JSON 一键导入到 AetherBlog 的能力。3 个端点:

| file:line | 端点 | 描述 |
| --- | --- | --- |
| `apps/server-go/internal/handler/migration_handler.go:46-61` | `POST /v1/admin/migrations/vanblog/analyze` | dry-run, 返回 AnalysisReport |
| `migration_handler.go:65-136` | `POST /v1/admin/migrations/vanblog/import/stream` | 真正执行 + NDJSON SSE 进度 |
| `migration_handler.go:139-169` | `POST /v1/admin/migrations/vanblog/import?mode=` | legacy 兼容(非 SSE) |

### 5.2 数据流

```
Admin 上传 VanBlog backup JSON (multipart, max 500MB)
       │
       ▼
Analyze 阶段:
  parseVanBlogUpload (流式 json.NewDecoder + io.LimitReader 防 OOM)
  → MigrationService.Analyze
       │ 批量预查询:LoadCategoryMap / LoadTagMap / LoadSourceKeyMap / LoadPostSlugSet
       │ 对每篇 article + draft:
       │   classifyArticle → action ∈ {create, overwrite, rename, skip_*, invalid}
       │   resolveSlug → 冲突时 base-2 base-3 递增
       │ 返回 AnalysisReport: 计划 + 摘要 + 警告
  ↓
前端展示预览:N 篇要建,M 篇要覆盖,K 篇要跳过 ...
  ↓
管理员确认 → ImportStream
  4 阶段 + SSE 进度推送:
    1. categories: BatchInsertCategories (UNIQUE on slug,ON CONFLICT DO NOTHING)
    2. tags:       BatchInsertTags 同上
    3. articles:   bcrypt 密码预算 → 单事务 BatchInsertPosts + UpdatePostBySourceKey
    4. post_tags:  ClearPostTagsBatch (overwrite) + BatchInsertPostTags
    5. recomputeCounts: 刷新 post_count 缓存
  
  每阶段 emit ProgressEvent:
    {"type":"phase","phase":"articles","total":74}
    {"type":"item","kind":"article","sourceId":"42","title":"...","action":"create","postId":42}
  
  最后: {"type":"summary","summary":{...}}
```

### 5.3 关键设计

#### 幂等 source_key

每篇 VanBlog 文章生成 `source_key`:
- 有 id → `vanblog:<id>`(本次实测 74/74)
- 无 id → `vanblog:title-sha1:<10 hex chars>`

第二次跑同一备份 → 全部命中 `existingSourceKeyMap` → 按 `ConflictStrategy ∈ {skip, overwrite, rename}` 处理,默认 skip。

历史 source_key 兼容:老 handler 写过 `vanblog:<title>` 格式,Analyze 时双读检测,Execute 时把列值升级到新格式。

#### bcrypt 在事务外

`precomputePasswordHashes`(`migration_service.go:763-795`)把所有需要密码哈希的文章先在事务外串行算完(每篇 ~100ms × 16 篇 = 1.6s)。如果在事务里算,1.6s 内 DB 连接被占用、可能与其他 tx 产生锁冲突。

#### 流式 JSON 解码

`parseVanBlogUpload`(`migration_handler.go:177-233`)用 `json.NewDecoder(io.LimitReader(f, maxBytes+1))` 流式解析,避免 500MB 文件 2× 峰值内存。`countingReader` 累计已读字节,解析失败时区分「文件超限」和「JSON 本身坏」。

故意**不**使用 `dec.DisallowUnknownFields()` —— VanBlog 不同版本会新增顶层 / 文章字段,严格模式会让能用的备份直接 400。

#### SSE 心跳 + writerMu

`ImportStream`(`migration_handler.go:65-136`):

```go
var writerMu sync.Mutex   // res.Writer 非并发安全
// 主 emit goroutine + 15s 心跳 goroutine 都写 res.Writer
go func() {
    for { select {
        case <-ctx.Done(): return
        case <-t.C:
            writerMu.Lock()
            res.Writer.Write([]byte(": heartbeat\n\n"))   // SSE comment 行
            flush()
            writerMu.Unlock()
        }
    }
}()
```

15s 心跳防止 nginx/浏览器误判连接空闲断开。

### 5.4 已知限制

- rename 策略下 `post_tags` 关联未处理(`migration_service.go:881-885` TODO)。
- `ON CONFLICT DO NOTHING` 让 BatchInsertPosts 静默吞掉重复 source_key,只能在结果 map 里看到「没返回 id」推断 skip。
- Migration 完成后没有机制「反向回滚」—— 一旦 import,要回到 import 前状态需要手动 DELETE。

详见 `apps/server-go/internal/service/migration_service.go` (970 行) 和 `migration_repo.go` (457 行)。

---

## 6. version_handler — 媒体文件版本管理

### 6.1 责任

媒体文件覆盖前自动留快照,允许回滚到任一历史版本。3 个端点。

### 6.2 关键代码入口

| file:line | 端点 |
| --- | --- |
| `apps/server-go/internal/handler/version_handler.go:28-32` | `Mount` |
| `version_handler.go:37-48` | `GET /v1/admin/media/files/:fileId/versions` |
| `version_handler.go:53-79` | `POST /v1/admin/media/files/:fileId/versions/:versionNumber/restore` |
| `version_handler.go:84-112` | `DELETE /v1/admin/media/versions/:versionId` |

### 6.3 Ownership 校验(VULN-042)

`Restore` 和 `Delete` 都先调 `mediaSvc.GetUploaderID(fileID)`,再 `middleware.AssertOwnership(c, uploaderID)` 确认调用者是 uploader 或 admin。`version_handler.go:59-69, 90-107`。

### 6.4 Restore 逻辑

`apps/server-go/internal/service/version_service.go:38-81`:

1. 查目标历史版本(`FindByFileAndVersion`)。
2. 查文件当前状态(`mediaRepo.FindByID`)。
3. 把当前状态保存为新版本快照(`maxVer + 1`,description 形如「恢复前自动保存 (vN)」)。
4. 把文件覆写成目标版本的 path/url/size,版本号 `maxVer + 2`。

「先备份再覆写」保证 Restore 是可逆的。

---

## 7. log_level_handler — 运行时日志级别

参见 05-system-monitor.md §3.7 详细描述。

| file:line | 端点 |
| --- | --- |
| `apps/server-go/internal/handler/log_level_handler.go:42-45` | `MountAdmin` |
| `log_level_handler.go:65-77` | `GET /v1/admin/system/log-level` |
| `log_level_handler.go:80-126` | `PUT /v1/admin/system/log-level` |

---

## 8. archive 端点

`apps/server-go/internal/handler/archive_handler.go`(本任务范围外的文件)提供 `GET /v1/public/archives` 公开归档页。本模块的 `analytics_service.go:599-616` `GetArchiveStats` 提供按月分组的文章数,被 stats_handler 与 archive_handler 共用。

---

## 9. 配置 / 环境变量(本节合集)

| Env / 字段 | 影响范围 | 默认 |
| --- | --- | --- |
| `AETHERBLOG_UPLOAD_PATH` | site_handler.prefixLocal、media_handler、disk metrics | `./uploads` |
| `AETHERBLOG_LOG_PATH` | log_viewer 读取目录 | `./logs` |
| migration body limit | `migration_handler.maxVanBlogUploadBytes` | 500 MB(硬编码) |
| `cfg.Database.Host/Port` `cfg.Redis.Host/Port` | container_monitor.LinkedTarget、network_test | env 注入 |

## 10. 与其他模块耦合

| 调用 | 形式 |
| --- | --- |
| `friend_link_handler → activity_service` | 写 `friend.*` 审计 |
| `site_setting_handler → activity_service` | 写 `system.setting_update` 审计 |
| `site_handler → SiteSettingService / userRepo / catRepo / tagRepo / postRepo` | 综合查询作者 + 站点统计 |
| `visitor_handler → AnalyticsService` | 异步 INSERT visit_records |
| `migration_handler → MigrationService → MigrationRepo` | 4 阶段批量写 + recompute |
| `version_handler → MediaService.GetUploaderID + VersionService` | ownership 校验 + 版本 CRUD |
| `log_level_handler → ai_client` | 跨服务推 log level |

## 11. 已知限制 / 待改进(集中)

### 11.1 friend_link Update 不写审计

`Update` 方法只更新 DB 不写 activity_events,与 Create/Delete 不一致。

### 11.2 site_setting 白名单不一致

`allowedSettingKeys` 与 `allowedSettingGroups` 是两套独立白名单,新增配置容易漏掉一边。建议建立统一定义。

### 11.3 site_handler.Stats 硬编码 comments=0 views=0

应改成实际查询,与 analytics 复用。

### 11.4 migration_handler 不能回滚

参见 §5.4。建议增加 `migration_session` 表记录每次 import 的 IDs,失败时一键 rollback。

### 11.5 version restore 双写非事务

`Restore` 内 `Create(snapshot) → UpdateFileContent` 不在同一事务。如果第二步失败,新建的 snapshot 已经存在,但文件还是旧版,版本号也乱了。

### 11.6 log_level_handler partial update

参见 05-system-monitor.md §7.7。

## 12. 测试覆盖

| 文件 | 覆盖内容 |
| --- | --- |
| `apps/server-go/internal/service/migration_service_test.go` (387 行) | 解析 / classify / resolveSlug / sourceKey / precomputePasswordHashes 全覆盖 |
| 没有 `friend_link_*_test.go` | CRUD / reorder 路径仅靠 admin SPA e2e |
| 没有 `site_setting_*_test.go` | 白名单 / 多种 PUT 请求体兼容 / batch update 仅靠 e2e |
| 没有 `site_handler_test.go` | author 注入 / prefixLocal 无单测 |
| 没有 `visitor_handler_test.go` | 异步 RecordVisit 无验证 |
| 没有 `version_*_test.go` | restore 双写非事务也无验证 |
| 没有 `log_level_handler_test.go` | partial update 行为无验证 |
