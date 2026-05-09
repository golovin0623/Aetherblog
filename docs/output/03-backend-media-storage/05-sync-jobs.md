# 05 · 同步备份任务

> 描述:Phase 4 的"本地→云"单向镜像备份机制,DB 状态机驱动的后台 worker。
> 关键文件:`internal/handler/sync_handler.go` · `internal/service/sync_service.go` · `internal/repository/media_sync_repo.go` · `internal/model/media.go:46-56` (`MediaSyncJob`) · `migrations/000043_add_media_sync.up.sql`。
> 路由前缀:`/api/v1/admin/storage/sync` + `/api/v1/admin/media/:id/sync`。

---

## 1. 责任范围

把 `media_files`(主文件落在 LOCAL 或某 provider A)单向镜像到 `target_provider_id`(必须非 LOCAL),让管理员能在不停机的情况下把整个媒体库迁到云端,并保留本地原件作为回退。

**典型场景:**
- 上线初期 LOCAL provider 默认,后期切到 OSS;批量备份历史文件到 OSS;
- 单文件级"立即同步该文件"按钮(`POST /admin/media/:id/sync`)。

**关键设计:**
- DB 表 `media_sync_jobs` 当队列;
- 单进程 worker(`atomic.Bool running`)+ `errgroup.SetLimit` 并发 + `time.Tick` rate-limit;
- 重启自动把 `RUNNING` 重置为 `PENDING` 防"幽灵任务";
- `media_files.sync_status` 实时反映给前端(NONE/PENDING/SYNCING/SYNCED/FAILED)。

---

## 2. 关键代码入口

| 入口 | 文件 / 行 | 备注 |
| --- | --- | --- |
| Handler 路由 | `sync_handler.go:25-34` | 7 个组级路由 + 1 个 per-media 路由 |
| Start | `sync_handler.go:52` → `service.EnqueueAll:267` | 入队 + 启动 worker |
| Cancel | `sync_handler.go:63` → `service.Stop:143` | 优雅退出 |
| Status | `sync_handler.go:69` → `service.GetStatus:305` | 实时摘要 (Pending/Running/Succeeded/Failed) |
| ListFailed | `sync_handler.go:78` → `service.ListFailed:318` | 默认 50 条 |
| Retry | `sync_handler.go:98` → `service.RetryFailed:326` | jobIDs 重置为 PENDING |
| GetAutoEnabled / SetAutoEnabled | `sync_handler.go:132/143` | 写入 site_settings + 启停 |
| **per-media SyncOne** | `sync_handler.go:118` → `service.EnqueueOne:281` | `POST /admin/media/:id/sync` |
| 服务构造 | `service.NewSyncService:51` | 注入 mediaRepo / syncRepo / providerRepo / settingRepo / mediaSvc + cfg |
| 主循环 | `service.loop:150` | tick + processBatch |
| 处理批次 | `service.processBatch:170` | 拣 PENDING → errgroup 并发 + rate-limit → processJob |
| 处理单 job | `service.processJob:201` | 读源 store → 写目标 store → 标 SUCCEEDED/FAILED |
| 拣 PENDING | `repo.FindPendingBatch:58` | 单事务 `FOR UPDATE SKIP LOCKED` + 标 RUNNING |
| 标成功 | `repo.MarkJobSucceeded:124` | 事务 + 写 backup_provider_id/backup_url/backup_at |
| 标失败 | `repo.MarkJobFailed:145` | attempt+1;<MaxAttempt 回 PENDING,否则 FAILED |
| 启动重置 | `repo.ResetRunningOnStartup:178` | RUNNING → PENDING 防幽灵 |
| Status 聚合 | `repo.CountByStatus:196` | FILTER COUNT 一次拿全 |

---

## 3. 数据流(EnqueueAll → 后台处理 → 完成)

```
Step 0: admin 在 UI 点"备份所有未同步文件到 OSS"
        POST /api/v1/admin/storage/sync/start
        body: {"targetProviderId": 5}     // 5 = 某 OSS provider

┌─────────────────────────────────────────────────────────────────┐
│ SyncHandler.Start (sync_handler.go:52)                          │
│   • bind req.TargetProviderID=5                                 │
│   • call svc.EnqueueAll(ctx, &5)                                │
└─────────────────────────────────────────────────────────────────┘

Step 1: SyncService.EnqueueAll (service.go:267)
        ┌──────────────────────────────────────────────────────────┐
        │ resolveTargetProvider(ctx, &5):                           │
        │   • providerRepo.FindByID(5) → provider                  │
        │   • provider.ProviderType == "LOCAL" → 拒绝              │
        │   • else return p.ID                                     │
        │                                                          │
        │ syncRepo.EnqueueAllUnsynced(ctx, 5):                     │
        │   INSERT INTO media_sync_jobs                            │
        │     (media_id, target_provider_id, status, attempt)      │
        │   SELECT id, 5, 'PENDING', 0 FROM media_files            │
        │   WHERE deleted=false                                    │
        │     AND (storage_provider_id IS NULL                     │
        │          OR storage_provider_id != 5)                    │
        │     AND sync_status NOT IN ('SYNCING','SYNCED')          │
        │     AND id NOT IN (                                      │
        │       SELECT media_id FROM media_sync_jobs               │
        │       WHERE target_provider_id=5                         │
        │         AND status IN ('PENDING','RUNNING')              │
        │     )                                                    │
        │   → 入队 23 行                                            │
        │                                                          │
        │ s.Start(ctx)  // idempotent CompareAndSwap               │
        └──────────────────────────────────────────────────────────┘

Step 2: worker loop 启动(SyncService.Start:124)
        • running.CompareAndSwap(false, true)
        • ResetRunningOnStartup(ctx)  // 防上次崩溃残留 RUNNING
        • workerCtx = context.WithCancel(context.Background())
        • go loop(workerCtx)

Step 3: processBatch(service.go:170)
        ┌──────────────────────────────────────────────────────────┐
        │ jobs = syncRepo.FindPendingBatch(ctx, 50)                 │
        │   单事务:                                                 │
        │     SELECT ... FROM media_sync_jobs                      │
        │     WHERE status='PENDING' ORDER BY created_at ASC       │
        │     LIMIT 50 FOR UPDATE SKIP LOCKED                      │
        │   UPDATE media_sync_jobs SET status='RUNNING', started_at │
        │     WHERE id IN (jobs.id)                                │
        │   UPDATE media_files SET sync_status='SYNCING'            │
        │     WHERE id IN (jobs.media_id)                          │
        │   COMMIT                                                  │
        │                                                          │
        │ rateTick = time.NewTicker(time.Second / RatePerSecond)    │
        │     默认每 200ms 一个 token                              │
        │ g, gctx = errgroup.WithContext(ctx)                       │
        │ g.SetLimit(Concurrency)  // 默认 3                        │
        │ for job in jobs:                                          │
        │   <-rateTick.C    // 限速门                              │
        │   g.Go(func() { processJob(gctx, job); return nil })     │
        └──────────────────────────────────────────────────────────┘

Step 4: processJob(service.go:201) — 单个 job
        ┌──────────────────────────────────────────────────────────┐
        │ media = mediaRepo.FindByID(job.MediaID)                   │
        │   - nil → failJob "media not found"                       │
        │   - deleted → failJob "media is in trash"                 │
        │                                                          │
        │ srcStore, _, _ = mediaSvc.resolveStoreForMedia(media)     │
        │ dstStore, _, _ = mediaSvc.resolveStore(&job.TargetProviderID)│
        │                                                          │
        │ rc, size, mime, _ = srcStore.Get(ctx, media.FilePath)    │
        │ defer rc.Close()                                          │
        │                                                          │
        │ if size <= 0: size = media.FileSize                       │
        │ if mime == "" && media.MimeType: mime = *media.MimeType   │
        │                                                          │
        │ backupURL, _ = dstStore.Upload(ctx, media.FilePath,       │
        │                  io.LimitReader(rc, size), size, mime)    │
        │   ← 用相同 key,方便排查                                  │
        │                                                          │
        │ syncRepo.MarkJobSucceeded(jobID, mediaID, target, url)    │
        │   事务:                                                   │
        │     UPDATE media_sync_jobs SET status='SUCCEEDED' ...     │
        │     UPDATE media_files SET                                │
        │       sync_status='SYNCED',                               │
        │       backup_provider_id=5, backup_url=$2,                │
        │       backup_at=NOW(), backup_error=NULL                  │
        └──────────────────────────────────────────────────────────┘

Step 5: tick 周期重复(默认 PollIntervalSec=10s),空批退出
        for {
            processBatch(ctx)
            select {
            case <-ctx.Done(): return
            case <-tick.C:
            }
        }
```

**Cancel 路径:** `Stop()` 调 `s.cancel()` —— `workerCtx.Done()` 立即触发,但当前批次的 `processBatch` 会跑完(因为 errgroup 是 `WithContext(ctx)`,gctx 也会 Done,新 goroutine 不再启动,**已启动的 goroutine 会读 Done 并退出**)。

---

## 4. 状态机

### 4.1 `media_sync_jobs.status`(work queue 自身)

```
                                (worker 拣到)
              ┌──────────────────────────────┐
              │                              │
              │                              ▼
       ┌──────────┐                    ┌──────────┐
       │ PENDING  │ ◄─────────────┐    │ RUNNING  │
       └──────────┘               │    └──────────┘
            ▲                     │         │
            │ Retry / 失败回退    │ 成功   │
            │ (attempt < max)     │         │
            │                     ▼         │
            └────────  ┌──────────┐         │
                       │  FAILED  │         │
                       └──────────┘         │
                                            ▼
                                       ┌──────────┐
                                       │SUCCEEDED │
                                       └──────────┘
```

### 4.2 `media_files.sync_status`(主文件视角)

| 状态 | 含义 |
| --- | --- |
| `NONE` | 主文件已在 default provider,无需备份(默认值) |
| `PENDING` | 已加入备份队列 |
| `SYNCING` | 当前批次正在传输 |
| `SYNCED` | 备份完成 + `backup_url` 可访问 |
| `FAILED` | 重试达上限,需要人工干预 |

---

## 5. 配置 / 环境变量

`config.SyncConfig`(`internal/config/config.go:142-153`)所有字段都有默认值,`SyncService.NewSyncService` 在零值时填入(`sync_service.go:52-66`):

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `auto_enabled` | `false` | 启动时是否自动启;**优先级被 `site_settings.storage.sync.auto_enabled` 覆盖** |
| `concurrency` | `3` | errgroup 单批并发上限 |
| `batch_size` | `50` | 每次拣 PENDING 的最大数 |
| `rate_per_second` | `5` | 每秒 token bucket(`time.Second / 5 = 200ms` 一个) |
| `max_attempt` | `3` | 单 job 最大重试次数 |
| `poll_interval_sec` | `10` | tick 周期(秒) |

**优先级链**(`SyncService.AutoEnabled:81`):
1. `site_settings` 表 `storage.sync.auto_enabled` 行 → 优先;
2. config.SyncConfig.AutoEnabled → fallback。

admin 在 UI 上(StorageProviderSettings 自动同步开关)切换 site_settings 后,后端立即启停 worker —— 不需要重启进程。

`migrations/000043:51-53` 启动时种入默认值:

```sql
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
  ('storage.sync.auto_enabled', 'false', 'BOOLEAN', 'storage', '是否启用自动后台备份(关闭时仅响应手动 API 触发)')
ON CONFLICT (setting_key) DO NOTHING;
```

---

## 6. 队列保证

### 6.1 重启不丢任务

`ResetRunningOnStartup`(`media_sync_repo.go:178`)在 worker `Start` 时调用一次:

```sql
UPDATE media_sync_jobs SET status='PENDING' WHERE status='RUNNING'
```

如果上一次进程崩溃留下 RUNNING 行,**这次启动后立即重新拣** —— 不会卡死。

### 6.2 不重复入队同一对(media_id, target_provider_id)

`EnqueueAllUnsynced`(`media_sync_repo.go:38`)WHERE 子句:

```sql
AND id NOT IN (
  SELECT media_id FROM media_sync_jobs
  WHERE target_provider_id = $1 AND status IN ('PENDING', 'RUNNING')
)
```

**注意:** 这只防"同一目标 provider 的 PENDING/RUNNING";如果 admin 切目标 provider 再 EnqueueAll,会**重复传一份到新目标**(预期行为)。

### 6.3 多进程不抢同一行

`FOR UPDATE SKIP LOCKED`(`media_sync_repo.go:71`)让多进程拣表时各自跳过对方锁住的行 —— 但 `running atomic.Bool` 是**进程内**标志,看不见其它 instance,所以**生产实际单进程部署**。多副本想正确并行需要重审。

### 6.4 Retry 流程

`RetryFailed`(`media_sync_repo.go:228`)事务:

```sql
UPDATE media_sync_jobs SET status='PENDING', attempt=0, last_error=NULL,
                            finished_at=NULL
WHERE id IN (...) AND status='FAILED';

UPDATE media_files SET sync_status='PENDING', backup_error=NULL
WHERE id IN (SELECT media_id FROM media_sync_jobs WHERE id IN (...));
```

Retry 后 `s.Start(ctx)` 立即启 worker,不等下一次 tick。

### 6.5 失败回退(自动)

`MarkJobFailed`(`media_sync_repo.go:145`):

```
attempt = attempt + 1
if attempt < MaxAttempt:
    job.status = PENDING
    media.sync_status = PENDING
else:
    job.status = FAILED
    media.sync_status = FAILED
    media.backup_error = errMsg
```

每次 `processJob` 失败都触发 `failJob`,worker 下次 tick 会再拣一次 —— **不立即重试,等周期** 这是 token bucket + tick 模式的取舍。

---

## 7. SyncOne(per-media)

`POST /api/v1/admin/media/:id/sync`,body 可选 `{"targetProviderId": N}`:

```go
// service.go:281
func (s *SyncService) EnqueueOne(ctx context.Context, mediaID int64, targetProviderID *int64) error {
    target, _ := s.resolveTargetProvider(ctx, targetProviderID)
    s.syncRepo.EnqueueOne(ctx, mediaID, target)
    s.mediaRepo.SetSyncStatus(ctx, mediaID, "PENDING", "")  // 前端立即可见
    s.Start(ctx)
    return nil
}
```

特点:
- 不去重 —— 重复点击会插多条 PENDING(代码注释明确说:`允许重试,但会复用最近一行 PENDING 的 attempt 计数`);
- 先把 `media_files.sync_status='PENDING'` 写好,前端 polling Status 接口能立即看到;
- 启动 worker,1 秒内开始处理。

---

## 8. 数据库表 + 字段 + 索引

### 8.1 `media_sync_jobs`(migration 000043)

| 字段 | 类型 | 备注 |
| --- | --- | --- |
| `id` | BIGSERIAL PK | |
| `media_id` | BIGINT NOT NULL FK media_files | ON DELETE CASCADE — 主文件删了 job 也消失 |
| `target_provider_id` | BIGINT NOT NULL FK storage_providers | ON DELETE CASCADE |
| `status` | VARCHAR(16) NOT NULL DEFAULT 'PENDING' | CHECK ∈ {PENDING, RUNNING, SUCCEEDED, FAILED} |
| `attempt` | INT NOT NULL DEFAULT 0 | 失败计数 |
| `last_error` | TEXT | 最后一次失败原因 |
| `created_at` | TIMESTAMP NOT NULL DEFAULT now | |
| `started_at` / `finished_at` | TIMESTAMP NULL | RUNNING 时填 started,SUCCEEDED/FAILED 时填 finished |

**索引:**
- `idx_media_sync_jobs_status_created` (status, created_at) — 让 worker 拣表 O(log N)
- `idx_media_sync_jobs_media_id` (media_id)

### 8.2 `media_files` 备份相关字段(migration 000043)

| 字段 | 类型 | 备注 |
| --- | --- | --- |
| `sync_status` | VARCHAR(16) NOT NULL DEFAULT 'NONE' | CHECK ∈ {NONE, PENDING, SYNCING, SYNCED, FAILED} |
| `backup_provider_id` | BIGINT FK storage_providers | ON DELETE SET NULL |
| `backup_url` | VARCHAR(500) | 备份后的完整 URL |
| `backup_at` | TIMESTAMP | 最近备份成功时间 |
| `backup_error` | TEXT | 最近失败原因 |

**索引:**
- `idx_media_files_sync_status` (sync_status WHERE sync_status != 'NONE') — 部分索引,减小占用

---

## 9. 与其他模块耦合

| 模块 | 关系 |
| --- | --- |
| **MediaService**(§01) | `mediaSvc.resolveStoreForMedia` / `resolveStore` 复用 storage cache;成功后 SetSyncStatus 写主表 |
| **StorageProviderRepo**(§03) | `resolveTargetProvider` 校验目标存在 + 非 LOCAL |
| **SiteSettingRepo** | `storage.sync.auto_enabled` 开关持久化到 site_settings |
| **Admin UI**(StorageProviderSettings) | 切换"自动后台备份"开关 PUT auto-enabled;失败重试列表 |
| **VersionService / TagService** | 无直接耦合 |

---

## 10. 已知限制

1. **单进程假设。** `running atomic.Bool` 是进程内标志,多副本部署会重复处理 —— 虽然 SKIP LOCKED 防抢但是 worker 启动节奏会乱(各 instance 自己起)。
2. **`processJob` 用相同 key 上传到目标。** 如果目标 provider 已存在同名对象会被**覆盖** —— 没做 If-None-Match 校验。设计上可接受(同名意味着同内容),但攻击场景下危险。
3. **大文件备份不显示进度。** SyncStatus 接口只看到 SYNCING/SYNCED,中途无 percent 反馈。
4. **没有"双向同步"**(云→本地)— 只有 Phase 5 反向导入 (`ImportObjects`),那是把 catalog 补齐,不是真正双向同步。
5. **目标 provider 切换后旧 backup_url 不失效。** `media_files.backup_url` 永远是上一次成功备份的 URL —— 切目标后用户看到的是旧目标的链接,直到下一次备份完成。
6. **rate-limit 是简化 token bucket。** `time.NewTicker(Second / RatePerSecond)` 在 `RatePerSecond > 1000` 时精度退化;但默认 5 没问题。
7. **失败重试间隔 = poll interval(10s)。** 不是指数退避 —— 网络抖动时 3 次很快用完,attempt=3 就 FAILED。需要人工 Retry。
8. **target_provider_id 在入队时就锁定**(批次 2 后撤销的 follow-up 项)。如果 admin 在 worker 处理途中切换 default provider,**正在跑的 batch 会按入队时的 target 跑完**,与文档预期一致。**这是预期行为,不是 bug**(批次 2 调研后撤销了"切默认 provider 时锁定 in-flight target"的改造,因为字段已经在入队时落定)。

---

## 11. 测试覆盖说明

**`sync_service.go` / `media_sync_repo.go` 都没有单元测试。**

潜在测试点(未实现):

- `processJob` 上"源文件不存在 / 已删 / Get 失败 / Upload 失败" 4 种失败分支
- `MarkJobFailed` attempt + 1 后回 PENDING vs FAILED 的边界
- `EnqueueAllUnsynced` SKIP existing PENDING/RUNNING
- `FindPendingBatch` 多 worker 抢锁(SKIP LOCKED 行为)
- `ResetRunningOnStartup` 启动重置
- `AutoEnabled` 优先级链(site_settings vs config)

需要 sqlmock 或 docker-compose 的 PostgreSQL fixture。
