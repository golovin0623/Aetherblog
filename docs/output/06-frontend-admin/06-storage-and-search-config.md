# 06 · 存储管理 / 云端浏览 / 搜索配置

> **范围**:`pages/storage/CloudExplorerPage.tsx`、`pages/settings/StorageProviderSettings.tsx`、`pages/SearchConfigPage.tsx`、`pages/search-config/*`、`services/{storageProviderService,storageSyncService,searchConfigService,searchProfileService}.ts`、`hooks/{useReindexStream,useSearchProfiles}.ts`。

---

## 1. 范围

两条平行的"基础设施配置"路径:

1. **存储管理**(对象存储 / 媒体后端)
   - `/storage/explorer` 页面级:云端 bucket 浏览
   - `/settings` 内嵌:storage tab 是 `StorageProviderSettings` 组件
2. **搜索配置**
   - `/search-config` 页面级:keyword + semantic + AI Q&A 开关 / 索引 / Profile 管理

---

## 2. 存储 provider 设置(嵌在 SettingsPage 内)

### 2.1 入口与结构

- 路径:`/settings`,`tab=storage`(`SettingsPage` 内的 lazy-imported 组件)
- 入口文件:`pages/settings/StorageProviderSettings.tsx`
- 同类:`migration` tab 嵌的是 `MigrationPage`,见 07 文档
- 二级模块:同文件内定义 `ProviderCard`、`AutoBackupToggle`(从 storageSyncService 拉)、`ProviderDialog`(创建 / 编辑表单)

### 2.2 视图

```
┌─ Header(标题 + 添加 CTA)
├─ AutoBackupToggle(自动后台备份开关 — Phase 4)
└─ ProviderCard 列表
     每行显示:类型图标 / 名称 / 类型徽章 / 默认徽章 / 启用状态 / 配置摘要 / 优先级
     操作:测试连接 / 编辑 / 设为默认 / 删除(默认不可删)
```

### 2.3 数据流

```
mount
  └─ useQuery(['storage-providers'], storageProviderService.getAll)
       → GET /v1/admin/storage/providers
       → R<StorageProvider[]>

mutations:
  ├─ deleteMutation        DELETE /v1/admin/storage/providers/{id}
  ├─ setDefaultMutation    POST   /v1/admin/storage/providers/{id}/set-default
  └─ testMutation          POST   /v1/admin/storage/providers/{id}/test
                            → R<{ success: boolean, message: string }>
```

### 2.4 创建 / 编辑(`ProviderDialog`)

- 6 种 provider 类型(`PROVIDER_TYPES`):LOCAL / S3 / MINIO / OSS / COS / R2
- LOCAL:basePath + urlPrefix
- S3-like(其他 5 种):bucket / region / endpoint / accessKeyId / secretAccessKey / path / customUrl / options / urlPrefix / allowPrivateEndpoint / forcePathStyle
- **endpoint 预设**(`ENDPOINT_PRESETS`):一键填入正确域名
  - COS:广州 / 上海 / 北京 / 香港 / 新加坡
  - OSS:杭州 / 上海 / 北京 / 深圳
  - R2:`https://<account-id>.r2.cloudflarestorage.com`(needsAccountId)
  - MINIO:本地默认 `http://localhost:9000`(allowPrivateEndpoint)
- **DEFAULT_REGIONS**:S3=us-east-1 / COS=ap-guangzhou / OSS=cn-hangzhou / R2=auto
- **secret 隐写**:编辑时回显的 `configJson` 已被后端脱敏(`a****b1234`),空白即保留旧值,显式重填明文才换密钥

### 2.5 调用 server-go 接口

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/v1/admin/storage/providers` | 列表 |
| GET | `/v1/admin/storage/providers/default` | 当前默认(部分组件) |
| GET | `/v1/admin/storage/providers/{id}` | 详情 |
| POST | `/v1/admin/storage/providers` | 创建 |
| PUT | `/v1/admin/storage/providers/{id}` | 更新(name/providerType/configJson 都 required) |
| DELETE | `/v1/admin/storage/providers/{id}` | 删除(默认 provider 不允许) |
| POST | `/v1/admin/storage/providers/{id}/set-default` | 设为默认 |
| POST | `/v1/admin/storage/providers/{id}/test` | 测试连通 |

### 2.6 同步 / 备份(`storageSyncService`)

`AutoBackupToggle` 与 `MediaPage` 的 SyncDialog 共享 service:

| Method | Path | 用途 |
| --- | --- | --- |
| POST | `/v1/admin/storage/sync/start` | 入队所有未同步文件,启动 worker |
| POST | `/v1/admin/storage/sync/cancel` | 优雅停止 worker |
| GET | `/v1/admin/storage/sync/status` | 实时统计(pending/running/succeeded/failed) |
| GET | `/v1/admin/storage/sync/failed?limit=` | 最近失败 job |
| POST | `/v1/admin/storage/sync/retry` | 重试 FAILED job |
| POST | `/v1/admin/media/{id}/sync` | 单文件入队 |
| GET | `/v1/admin/storage/sync/auto-enabled` | 自动备份开关 |
| PUT | `/v1/admin/storage/sync/auto-enabled` | 切换自动备份(立即启停 worker) |

### 2.7 设计系统应用点

- ProviderCard 表面:`surface-leaf surface-admin-item rounded-2xl` `data-interactive`(自动 hover stripe)
- 类型徽章:`bg-primary/15 text-primary` legacy
- 默认徽章:`bg-[color:color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--aurora-1)]` Codex
- 删除按钮悬停:`hover:text-status-danger hover:bg-status-danger/10`(legacy)
- 操作按钮 mobile 用 `p-2.5` + `touch-manipulation`,desktop 用 `p-2`

### 2.8 已知限制

1. ⚠ **删除用 `confirm()`**(`StorageProviderSettings.tsx:169`)。**违反 §3.5**。
2. ⚠ **`configJson` 是裸 JSON 字符串**:虽然 ProviderDialog 用了类型化表单字段,但仍要序列化成 JSON 字符串往后端传,parse 失败时静默 fallback 到 `EMPTY_S3_CONFIG`。
3. ⚠ **`ENDPOINT_PRESETS` 是硬编码**,新区域要前端跟着改。后端可以提供 `/v1/admin/storage/regions/{type}` 端点。

---

## 3. 云端浏览(`CloudExplorerPage.tsx`)

### 3.1 入口

- 路径:`/storage/explorer`
- 入口:`pages/storage/CloudExplorerPage.tsx`(在 sidebar `CONTENT` 组,标 "云端浏览")

### 3.2 定位

直接看到云端 bucket 上的对象,识别 catalog(后端 media 表)之外的孤儿。

```
1. 选 provider → 加载 ListObjects(prefix='') 第一页
2. 每行右侧显示状态徽章: ✓ 已入库(IN_CATALOG) / ⚠ 孤儿(ORPHAN)
3. 选中孤儿 → 批量"导入到媒体库"或"从云端删除"
4. 已入库行只能"在媒体库中查看" → 跳到 /media?highlight=ID
```

### 3.3 状态

```
providerId: number | undefined            // 当前选中 provider
prefix: string                            // 路径前缀过滤(支持 Enter 提交)
currentToken / tokenStack                 // 分页 token + 历史栈(支持上一页)
selectedKeys: Set<string>                 // 选中对象 key
```

### 3.4 数据流

```
useQuery(['storage-providers'], storageProviderService.getAll)
  → 默认选中第一个非 LOCAL 的 enabled provider

useQuery(['cloud-objects', providerId, prefix, currentToken], ...)
  → storageProviderService.listObjects(providerId, { prefix, token, limit:100 })
     → GET /v1/admin/storage/providers/{id}/objects
     → R<{ objects: ObjectListing[], nextToken? }>

importMutation:
  storageProviderService.importObjects(providerId, keys)
   → POST /v1/admin/storage/providers/{id}/import
   → R<{ imported, skippedKeys? }>

deleteMutation:
  storageProviderService.deleteObjects(providerId, keys)
   → DELETE /v1/admin/storage/providers/{id}/objects (body: keys)
   → R<{ deleted, refusedKeys? }> (refused = 在 catalog 中,被拒绝删除)
```

### 3.5 调用接口

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/v1/admin/storage/providers/{id}/objects?prefix=&token=&limit=` | 列对象 + catalog 状态 |
| POST | `/v1/admin/storage/providers/{id}/import` | 导入孤儿到 catalog |
| DELETE | `/v1/admin/storage/providers/{id}/objects` | 删除云端对象(拒绝 catalog 内的) |

### 3.6 视图 / 交互

- Provider select + Prefix 输入框(Enter 提交触发 `setCurrentToken('') + refetch`)
- 选中条 strip:显示选中数 + 孤儿数;按钮 "导入到媒体库" / "从云端删除"
- 表格:checkbox 全选孤儿 / Key / 大小 / 最后修改 / 状态徽章 / 操作
- 分页:`tokenStack` 实现"上一页",当前 token 出栈替换

### 3.7 设计系统应用点

- 主体 `surface-leaf` 容器
- 状态徽章:✓ `var(--signal-success)`,⚠ `var(--signal-warn)` Codex
- 删除按钮 confirm 用了 `confirm()` ⚠(同样违反 §3.5)
- 大量 legacy 颜色:`var(--bg-input)`、`var(--bg-secondary)/40`、`var(--bg-card-hover)`

### 3.8 已知限制

1. ⚠ **`confirm()` 删除**(`CloudExplorerPage.tsx:216`),违反共享 Modal 红线
2. ⚠ **裸 `<select>` 选 provider**,未用 `@aetherblog/ui Select`,视觉不统一
3. ⚠ **没有"全选当前页"快捷键 / 反选**(只有"全选孤儿")
4. ⚠ **prefix 输入只支持 Enter 提交**,失焦不触发,新手会困惑
5. ⚠ **大文件导入是同步阻塞**:imp 数量大时前端只能等;后端可改 SSE 流式

---

## 4. 搜索配置(`SearchConfigPage.tsx`,1542 行)

### 4.1 入口与结构

- 路径:`/search-config`
- 入口:`pages/SearchConfigPage.tsx`
- 子模块:`pages/search-config/`
  - `ChunkerKindSelector.tsx`:chunker 类型选择(recursive / fixed / markdown / qa / parent_child)
  - `CreateProfileModal.tsx`:创建 profile 表单
  - `ProfileActivationFlow.tsx`:激活向导(confirm → SSE reindex → activate)
  - `ProfileDetailDrawer.tsx`:右侧抽屉显示完整元数据
  - `ProfileListCard.tsx`:单条 profile 行
  - `ProfileManagementSection.tsx`:profile 区组合

### 4.2 视图组成(自上而下)

```
┌ Header(标题 + 重建索引 CTA)
├ 索引进度面板(执行中可见,IndexingProgressPanel)
├ Diagnostics strip(诊断:effectiveMode / keyword on/off / semantic on/off / 活跃 embedding / AI client / 待重建提示)
├ Card 1: 向量化状态(model 选择 + 当前 model 详情 + 凭证检查 + 索引统计 4 张 StatCard)
├ ProfileManagementSection(Search Profile 列表 + 创建 + 删除 + deprecate + 激活)
├ Card 2: 搜索功能开关(keyword / semantic / AI Q&A / autoIndexOnPublish / 单篇超时秒数)
├ Card 3: 速率限制(anonSearchRatePerMin / anonQaRatePerMin)
└ Card 4: 文章索引明细(分页 + 状态过滤 + 单篇 / 批量索引 / 重建)
```

### 4.3 关键状态

```
config: SearchConfig                      // 7 个开关字段
configDirty: boolean                      // 修改未保存
saving / savingError                      // 保存状态
indexStats: IndexStats                    // 5 个数字
indexingJob: IndexingJob | null           // 持久化到 localStorage,kind/jobTotal/baselineIndexed/...
canceling                                  // 正在取消
embeddingModels / currentRouting / currentEmbeddingModelId  // 模型路由
pendingEmbeddingModelId                   // 待确认切换
embeddingCredentialReady                  // 凭证检查
diagnostics                                // 后端诊断
posts / postsTotal / pagination           // 索引明细
filterStatus                              // pending / indexed / failed / 全部
```

### 4.4 IndexingJob 任务模型

`SearchConfigPage.tsx:113-160` 把"本次触发的任务"精确建模:

```ts
type IndexingJobKind = 'full' | 'retry' | 'batch' | 'single';
interface IndexingJob {
  kind, startTime, jobTotal, baselineIndexed, baselineFailed, label
}
```

进度按 `delta` 算:
- `full / retry`:done = `indexed_posts - baselineIndexed`(失败不算 done)
- `batch / single`:done = indexedDelta + failedDelta(失败也是"完成")

持久化到 `localStorage[INDEXING_JOB_STORAGE_KEY]`,2 小时过期兜底。即使刷新 / 切页面回来,进度面板还在跑。

### 4.5 调用 server-go 接口

`searchConfigService`:

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/v1/admin/search/config` | 7 个开关 |
| PATCH | `/v1/admin/search/config` | 更新(K/V map) |
| GET | `/v1/admin/search/stats` | IndexStats(total/indexed/failed/pending/vector_count) |
| POST | `/v1/admin/search/reindex` | 全量重建(后端启动异步 job) |
| POST | `/v1/admin/search/retry-failed` | 仅重试 FAILED |
| POST | `/v1/admin/search/cancel` | 取消进行中(返回 status: 'canceling' / 'idle') |
| GET | `/v1/admin/search/embedding-status` | embedding model 是否配置 |
| GET | `/v1/admin/search/diagnostics` | 完整诊断(config + activeEmbedding + aiClient + fallback) |
| GET | `/v1/admin/search/posts?embeddingStatus=&limit=&offset=` | 文章索引明细分页 |
| POST | `/v1/admin/search/index-batch` | 批量索引指定文章 |
| GET | `/v1/admin/search/last-batch` | 最近一次 batch / single 摘要(in-memory,reason / failedIds) |

`searchProfileService`:

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/v1/admin/search/profiles` | profile 列表 |
| POST | `/v1/admin/search/profiles` | 创建 |
| POST | `/v1/admin/search/profiles/{code}/activate` | 激活 |
| POST | `/v1/admin/search/profiles/{code}/deprecate` | 弃用 |
| DELETE | `/v1/admin/search/profiles/{code}` | 删除 |
| POST(SSE) | `/v1/admin/search/profiles/{code}/reindex/stream` | 重建索引(SSE 流) |

> Profile API 在 ai-service 实现(`app/api/routes/profiles.py`),Go backend 通过 `apps/server-go/internal/handler/search_handler.go::ProxyProfiles` 通配代理转发,SSE 端点逐行透传。

### 4.6 Profile reindex SSE(`hooks/useReindexStream.ts`)

事件类型(与 ai-service `profiles.py:_sse_pack` 对齐):
```
{type:'start',    total, profile}                   → setTotal
{type:'progress', postId, index, chunks, status, error?, elapsedMs} → 累加 counters + 推 ring buffer (16 槽)
{type:'result',   data:{...}}                        → setResult
{type:'done'}                                        → setIsRunning(false)
{type:'error',    message}                           → setError + setIsRunning(false)
```

性能优化:
- counters 是 4 个数字累加 O(1),不存全量 list
- recent ring buffer 固定 16 槽,UI 只渲染最近 5 条
- 数万篇文章 reindex 也不会让 React 重渲染节奏堆积

### 4.7 重要 UX 细节

- **Diagnostics strip**:一屏诊断 — 当前 effectiveMode / 关键词 on/off / 语义 on/off / 活跃 embedding model / AI 客户端 configured / 待重建提示
- **divergence 提示**:活跃 embedding ≠ routing primary_model 时,显示"待重建 → {next_model}",避免管理员误以为切换没生效
- **Pending model 切换**:用户改 embedding model → `setPendingEmbeddingModelId` → 弹 ConfirmModal → 确认后才写路由 + 触发 reindex(防误操作)
- **Profile 激活向导**:多步(confirm → SSE reindex → activate),`ProfileActivationFlow.tsx` 实现
- **Profile detail drawer**:右侧抽屉显示完整 metadata + 删除二次确认

### 4.8 设计系统应用点

- 主体卡片:`rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)]`(legacy)
- ProfileManagementSection:`surface-leaf surface-admin-panel`(Codex)
- 状态徽章:大量 legacy `bg-emerald-500/10 text-emerald-400 border-emerald-500/20`(`SearchConfigPage.tsx:91-93`)
- Skeleton:`bg-[var(--bg-card-hover)]` legacy
- Diagnostics strip:`bg-amber-500/5 border-amber-500/30`(legacy)/ Codex `--signal-warn` 混用
- IndexingProgressPanel:Codex `surface-leaf` + aurora 进度条(本文件未读到完整实现)

### 4.9 已知限制

1. ⚠ **大量 legacy `bg-emerald-* / amber-* / red-*` Tailwind 直写**,需要迁到 Codex `--signal-*` token
2. ⚠ **`SearchConfigPage.tsx` 1542 行**,包含 IndexingProgressPanel / StatCard / StatusBadge 等多个内部组件 — 可拆分到 `pages/search-config/` 子目录
3. ⚠ **诊断 strip 与 Card 重复信息**:embedding model 在 strip 和 Card 1 都显示
4. ⚠ **进度面板 fallback `2 小时过期`** 是硬编码常量,实际后端 reindex 可能更久(数万篇 + 慢模型)
5. ⚠ **批量 indexBatch 上限**:前端没限制 postIds 长度,大量勾选会让请求 body 过大
6. ⚠ **Profile activation 缺 progress 持久化**:刷新后激活向导从头开始

---

## 5. 跨切片依赖

- **MediaPage** 的 SyncDialog 依赖 storage settings 配好的 provider
- **CloudExplorerPage** 通过 `[?highlight=ID]` 跳到 `/media?highlight=...`(实际 MediaPage 是否消费 highlight 参数,要核实 — 当前未在 README 列出)
- **SearchConfigPage** 依赖 AI 配置中心配好的 embedding model;ProviderDetail / CredentialForm 是同源
- **AdminThemeColorProvider** 在所有页面之上读 site_settings 派生 `--color-primary`,影响所有 admin 视觉

---

## 6. 已知限制 / 待改进汇总

1. ⚠ 多处 `confirm()` 浏览器原生弹窗(StorageProviderSettings、CloudExplorerPage),违反 §3.5
2. ⚠ `CloudExplorerPage` 用裸 `<select>` 选 provider
3. ⚠ Profile reindex SSE 与 useStreamResponse 协议不一,无公共层
4. ⚠ Storage 设置的 `<input>` 类型化字段未抽 schema,各 provider 类型有 N+1 段表单
5. ⚠ 1500+ 行的 SearchConfigPage 该拆分
6. ⚠ legacy Tailwind 直写颜色应转 token
