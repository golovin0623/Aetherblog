# 后端运行时机制 — JWT / 存储 / AI / 日志 / 迁移

> **何时读：** 改 JWT 相关 / 调对象存储 provider / 增减 AI 任务 / 排查日志输出 / 处理 VanBlog 迁入。
>
> 这些是踩坑换来的实战机制说明，**不要凭印象改**。

---

## 1. JWT 密钥定时轮换（migration 000033 + VULN-152 跟进）

### 数据模型

`jwt_secrets` 表，三态：

| status | 含义 |
| --- | --- |
| `current` | 当前用于**签名**新 token；同时参与验签 |
| `previous` | 仅参与**验签**（在 `PreviousGrace` 窗口内），保护已签发 token 不立即失效 |
| `retired` | 历史归档，不参与任何操作 |

### Go 端运行时

- 启动用 `JWT_SECRET` 做 bootstrap seed —— 若表空则写入第一条 `current`。
- `internal/pkg/jwtkeys/Store` 把 `current + previous` 缓存进内存。
- `StartRotator` goroutine 按 `JWT.RotationInterval`（默认 7d）：
  1. 生成新 `current`；
  2. 把旧 `current` 降级为 `previous`；
  3. 超过 `PreviousGrace`（默认 48h）的 `previous` 标 `retired`。

### Python 端（ai-service）

`app/core/jwt_keys.py` 后台任务，每 60s 从同一张 `jwt_secrets` 表同步 keys（在 `app/main.py` lifespan 启动）。`_decode_with_hmac` 按顺序遍历多 key 验签 —— 与 Go 端共享同一密钥池，跨进程兼容。

### 手动应急轮换

`POST /v1/admin/auth/rotate-jwt-secret` —— 用于历史泄露的紧急响应（VULN-152 同类场景）。立即生成新 `current`，旧 key 进入 `previous` 走正常退役流程。

### 可调参数（`config.JWTConfig`，前缀 `AETHERBLOG_JWT_*`）

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `rotation_interval` | `7d` | 自动轮换周期；设 `0` 禁用（不推荐） |
| `previous_grace` | `48h` | 旧 key 验签宽限期 |
| `reload_interval` | `60s` | ai-service 同步 key 频率 |

---

## 2. 对象存储多 provider（2026-05 全链路打通）

### 配置入口

admin `/settings` → 「存储管理」tab：

- 支持 provider：**LOCAL / S3 / MinIO / OSS / COS / R2**
- 带 endpoint 预设按钮（腾讯云 / 阿里云 / Cloudflare R2 等区域），无需手填 endpoint URL
- `set-default` 后**新上传的文件自动入云**：`media_files.storage_provider_id` / `storage_type` / `cdn_url` 落库
- 前端 `getMediaUrl(item)` 优先读 `cdnUrl`（LOCAL 仍走 `/api/uploads/`）

### 存量文件入云：「备份到云」工作流

媒体页右上角云图标 → `SyncDialog`：

- 后端 `SyncService` worker 仿 `SearchService.IndexBatchPosts` 的 **`atomic.Bool` + DB 状态机**模式
- 按 `cfg.Sync.PollIntervalSec` 周期拣 `media_sync_jobs.status='PENDING'` 批次
- `errgroup` 并发 + 限速；失败 < `MaxAttempt` 自动重试，达上限标 `FAILED`
- 入口：`POST /v1/admin/storage/sync/start`（启 worker） / `cancel`（优雅停） / `status` / `failed` / `retry`；单文件 `POST /v1/admin/media/:id/sync`

### 反向管理云端：「云端浏览」

admin 侧栏「云端浏览」→ `CloudExplorerPage`：

- 调 `Storage.List`：S3/COS/OSS/MinIO/R2 走 `ListObjectsV2`、LOCAL 走 `filepath.WalkDir`
- 反查 catalog 后区分：
  - **IN_CATALOG** —— 数据库里有记录
  - **ORPHAN** —— 云端有、数据库没有
- ORPHAN 可一键导入 catalog **或**从云端删除
- IN_CATALOG 的 key **拒绝**在云端浏览器删除，必须走媒体管理删除路径（防 catalog 状态分裂）

### 永久删除新增 `deleteCloud` 选项（`DeleteMediaConfirmModal`）

- 默认勾选「删除存储后端」；取消时仅清 catalog
- `PermanentDeleteBatch` 在 service 层做 ownership 校验（**VULN 修复** —— 早期实现可越权删别人的文件）
- 按 `storage_provider_id` 分组**逐 provider 删后端**，孤儿文件不再产生

### 关键文件入口

| 层 | 文件 |
| --- | --- |
| Service | `apps/server-go/internal/service/{media_service,sync_service,storage_provider_service}.go` |
| Storage Adapter | `internal/pkg/storage/{storage,local,s3,factory}.go` |
| 加密 | `internal/pkg/cryptkey/{fernet,keystore}.go`（与 ai-service Python Fernet 二进制兼容） |
| Handler | `internal/handler/{media_handler,sync_handler,storage_provider_handler}.go` |
| Migrations | `000042`（R2 + `media_variants.storage_provider_id`） / `000043`（sync_status + media_sync_jobs） |

### Secret 加密机制

- `storage_providers.config_json` 在 Repo 层用 **Fernet（复用 `AI_CREDENTIAL_ENCRYPTION_KEYS`）** 加密
- 落库格式 `enc:v1:gAAAA...`
- 启动时自动迁移 legacy 明文行 (`MigrateLegacyToEncrypted`)
- Python ai-service 与 Go 端**二进制兼容**：MultiFernet 轮换语义、urlsafe-base64 padding 容错

### 大文件流式 multipart

`S3Storage.Upload` 自动选择策略：

- size ≥ 16 MB → `aws-sdk-go-v2/feature/s3/manager.Uploader`（**8 MB / 片，4 并发**）
- size < 16 MB → `PutObject`（一次性）

`SyncService` 全程不读到内存：reader 直接桥接源 → 目标。

### 客户端上传韧性（admin 媒体库 / 编辑器粘贴 / 头像 / 站点 logo）

| 能力 | 实现位置 |
| --- | --- |
| `AbortController.signal` 单文件取消 | `mediaService.upload(file, onProgress, { signal })` |
| 网络瞬时错误自动重试 | `uploadWithRetry`：默认 3 次，250ms / 500ms / 1000ms 指数退避 + ±20% 抖动 |
| 重试触发条件 | 无响应 / 5xx / 408 / 425 / 429。**4xx（其他）和 abort 不重试** |
| 阶段化进度 | `(percent, phase)` —— `'uploading'` 0-99% / `'processing'` 99% (字节发完等响应) → 100% (响应已返回) |
| UI 重试按钮 | 错误 / 中止状态行末出现 `RefreshCw` |
| 一键取消所有 | `UploadProgress` 头部 `Ban` 图标，仅活动文件存在时出现 |

调用方约定：

- **新签名：** `upload(file, (percent, phase) => {}, { folderId, signal, maxRetries, onAttempt })`
- **老签名仍兼容：** `upload(file, percent => {}, folderIdNumber)`（TS 协变接受第二参数缩减）
- **判定取消：** `import { isUploadAborted } from '@/services/mediaService'` —— 区别于 error 状态（不要给 abort 弹 toast）

文件入口：

- 服务：`apps/admin/src/services/mediaService.ts` (`UploadOptions` / `UploadAbortedError` / `isUploadAborted`)
- 媒体页：`apps/admin/src/pages/MediaPage.tsx` (`startUpload` / `handleCancelUpload` / `handleRetryUpload` / `handleCancelAll`)
- 浮窗：`apps/admin/src/pages/media/components/UploadProgress.tsx` (`status: queued | uploading | processing | success | error | aborted`)

### `UploadContent` 修复（历史 bug）

历史实现：handler 写死 `localStore` 且 `SetVersionDeps` 从未被调用 —— 在 S3 模式下完全不可用。
现走 `MediaService.UpdateContent`：自动按 `storage_provider_id` 解析后端，`cdn_url` 自动追加 `?v={version}` 让 CDN 缓存失效。

---

## 3. AI 服务架构（外置 FastAPI 模式）

```
Go backend → HTTP client → FastAPI ai-service → LiteLLM → LLM providers
                                ↓
                          rate limit / cache / metrics / vector store
```

### 服务结构

- `apps/ai-service/` —— Python FastAPI，含限流、缓存、指标、provider 注册表、向量存储
- `apps/server-go/` —— Go 后端持有 HTTP 客户端调外部 ai-service
- **测试覆盖率门槛：** 80%（在 `pyproject.toml` 配置）

### 支持的 provider 与 model 类型

- **Provider：** OpenAI / Anthropic / Google / Azure / LiteLLM / Custom
- **Model 类型：** `chat` / `embedding` / `image` / `audio` / `reasoning` / `tts` / `stt` / `realtime` / `text2video` / `text2music` / `code` / `completion`

### 业务端点

均支持 `/stream` SSE 变体：

| 端点 | 用途 |
| --- | --- |
| `POST /api/v1/ai/summary[/stream]` | 文章摘要 |
| `POST /api/v1/ai/tags[/stream]` | 自动标签生成 |
| `POST /api/v1/ai/titles[/stream]` | 标题建议 |
| `POST /api/v1/ai/polish[/stream]` | 文本润色 |
| `POST /api/v1/ai/outline[/stream]` | 大纲生成 |
| `POST /api/v1/ai/translate[/stream]` | 翻译 |

### `tags` 端点的「现有标签库」机制（migration 000040）

可选 `existingTags: [{name, postCount}]` —— 让 AI 在【现有标签库】中精确复用 + 仅对未覆盖主题新建。

响应分两段：
- `matches` —— 现有标签命中，含 `postCount` / 可选 `reason`
- `suggestions` —— 新建建议

路由层 `_parse_tags_structured` 四级解析降级：严格 JSON → 扁平数组兜底 → 幻觉 match 降级 → match 名字归一化到库内规范大小写。
缓存 key 加入 `existing_tags` 签名，防止标签库变更后命中陈旧分桶。

### SSE 流协议

每行 `data: <json>\n\n`，四种事件类型：

| type | 字段 | 含义 |
| --- | --- | --- |
| `delta` | `content`、`isThink?` | 增量文本；`isThink=true` 时在 `<think>` 块内 |
| `result` | `data: <TaskData>` | **结构化最终载荷**，emit 一次，紧挨 `done` 之前 |
| `done` | — | 终止标记 |
| `error` | `code`、`message` | 流中失败 |

`result.data` 形状与非流式 DTO 一致。`tags` 任务的 `data` 是 4 字段对象：
- `{tags: string[]}` —— 扁平合并视图（旧客户端兼容）
- `{matches: TagMatch[], suggestions: string[]}` —— 新分桶视图，`TagMatch = {name, postCount, reason?}`

### 前端消费

admin `useStreamResponse` hook 暴露 `{content, result, isDone, error, ...}`。
**前端不要自己写正则解析** —— 直接消费 `result` 字段。

AI 工具箱：`AIToolsPage` → `AIToolsWorkspace` → `ToolResultRenderer` 按工具分发渲染结构化结果，并提供「应用到文章」动作。
目标文章通过 `useAiToolTarget` hook 管理，支持 `?tool=<code>&postId=<id>` URL 深链。

### 配置端点

| 端点 | 处理方 |
| --- | --- |
| `GET/PUT /v1/admin/ai/prompts[/:taskType]` | Go AiHandler |
| `CRUD /v1/admin/ai/tasks[/:code]` | Go AiHandler |
| `ANY /v1/admin/providers/*` | Go 透传 → FastAPI |
| `GET /v1/admin/ai/health` | Go AiHandler |

### Nginx 路由

`/api/v1/ai/*` 代理到 FastAPI:8000：
- `proxy_read_timeout 600s`
- `X-Accel-Buffering: no`（禁缓冲，SSE 必需）

### 详细能力规划

完整路线图与待办：`docs/AI_MODULE_PLAN_V2.md`。

---

## 4. 运行时日志级别在线调整

入口：`PUT /v1/admin/system/log-level` `{backend, aiService}`

- 同时调整 Go `zerolog.SetGlobalLevel` 与 ai-service root `logger.setLevel`，**无需重启**
- INFO → DEBUG：`docker logs` 立即多出调试行
- INFO → WARN：业务 INFO 行连写都不写
- 运行时调整**不持久化**：进程重启回到 `AETHERBLOG_LOG_LEVEL` / `AI_LOG_LEVEL`

### 健康探活路径降噪

以下路径 2xx 时**不落访问日志**（之前是降级到 Debug，运维改 DEBUG 排错时仍刷屏）：

- `/api/actuator/health`
- `/api/v1/admin/system/health`
- `/api/v1/admin/system/metrics`
- 任何 `/health`、`/ready` 后缀

失败仍按状态码升级到 Warn / Error。

实现：`apps/server-go/internal/middleware/trace.go` 的 `isHealthProbePath()`。

### Admin 联动

仪表盘日志查看器右上角「运行时」下拉直接联动 backend / ai-service 两个 select。

---

## 5. VanBlog 迁移（migration_handler）

### 端点

- `POST /v1/admin/migrations/vanblog/analyze` —— dry-run，返回 `AnalysisReport`
- `POST /v1/admin/migrations/vanblog/import/stream` —— NDJSON / SSE 流式执行
- `POST /v1/admin/migrations/vanblog/import?mode=dry-run|execute` —— 兼容旧客户端

### 关键约束

- **500 MB 上传上限**
- `source_key = vanblog:<id>` + 双读兼容 `vanblog:<title>` 历史格式
- 冲突策略三选一：`skip` / `overwrite` / `rename`
- 分类 / 标签批量预加载 + 多行 `VALUES INSERT` —— 消灭 N+1
- `SET LOCAL app.preserve_updated_at=true` 让 VanBlog 原始 `createdAt` / `updatedAt` 落库（依赖 migration 000028 触发器）

### `posts` 表上的 VanBlog 兼容字段

- `is_hidden`
- `source_key`
- `legacy_author_name`
- `legacy_visited_count`
- `legacy_copyright`
