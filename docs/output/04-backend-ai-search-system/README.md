# 模块四 · 后端 AI 网关 / 搜索 / 系统监控 / 杂项

> 适用版本基线：migrations 000001–000046（含 041 search profiles / 044 parent_text / 046 activity_event_category_security），Go backend 26 个 handler 中的 AI 网关 / 搜索 / 监控 / 杂项部分。
>
> 本目录下的子文档按能力切分：
>
> | 子文档 | 能力 |
> | --- | --- |
> | `01-ai-gateway.md` | AI 同步 / SSE 代理、prompt CRUD、provider 通配代理 |
> | `02-agent-and-jobs.md` | Agent 工作台 chat / picker、长任务并发锁 |
> | `03-search.md` | 关键词 + 语义 + RRF + search profile 蓝绿切换 |
> | `04-analytics-and-stats.md` | 仪表盘聚合、AI 用量统计、归档、活动审计 |
> | `05-system-monitor.md` | 系统指标、容器监控、日志查看、告警 |
> | `06-misc-handlers.md` | 友链 / 设置 / 站点 / 访客 / 迁移 / 版本 / 日志级别 |
> | `07-middleware.md` | CORS / 限流 / Recovery / Trace 中间件链 |
> | `08-agent-workflows.md` | 智能体编排 authoring/runtime/published API、迁移与 trace |

---

## 1. 模块在系统中的定位

AetherBlog 的「应用大脑」由 Go backend (server-go) 承担:

```
浏览器 / Admin SPA
        ↓ HTTPS
    Nginx (7899)
   /api/* /api/v1/ai/*  
        ↓
┌─────────────────────────────────────────────────┐
│      Go backend (Echo, 26 handlers)              │
│  · 鉴权 / 业务路由 / 限流                         │
│  · AI 端点全部代理转发到 Python ai-service        │
│  · 搜索关键词 + Pinecone 风格 RRF 融合           │
│  · 活动审计 / 系统监控 / VanBlog 迁移            │
└──────┬───────────────────────────────────────┬──┘
       │ HTTP (X-Internal-Service token)       │
       ↓                                       ↓
  Python ai-service                       PostgreSQL 17
  (FastAPI + LiteLLM)                    (pgvector / tsvector)
```

**核心分工原则:**

- **Go 不直接调用 LLM。** 所有 LLM 实际调用、prompt 模板渲染、provider/model 路由、价格计算、SSE 拼帧都在 Python 侧。Go 这边只负责:鉴权、限流、SSE 行级透传、审计落库、错误码归一化。
- **Go 拥有数据库的真相。** 文章 / 用户 / 标签 / 分类 / activity_events / visit_records / site_settings / search_profiles 写入仍由 Go 把控,ai-service 想写也是经 internal-service token 反向调 Go(目前没有,只有读)。
- **「内部服务」鉴权三段式:** 浏览器 JWT → Go 校验 JWT → Go 注入 `X-Internal-Service: <token>` → ai-service 信任 token 通行。这条链路在 `apps/server-go/internal/handler/ai_handler.go:649-661` 的 `proxyHeaders` 与 `agent_handler.go:124` 显式注入处可见。

## 2. 子能力清单

| 子能力 | 入口路由 | 关键文件 |
| --- | --- | --- |
| AI 同步生成 (summary/tags/titles/polish/outline/translate) | `POST /api/v1/admin/ai/<task>` | `ai_handler.go:283-311` |
| AI 流式摘要 (POST + GET 两种形态) | `POST/GET /api/v1/admin/ai/summary/stream` | `ai_handler.go:317-456` |
| AI 提示词 / 任务 CRUD | `/api/v1/admin/ai/prompts/*` `/tasks/*` | `ai_handler.go:482-541` |
| AI 提供商通配代理 | `/api/v1/admin/providers/*` | `ai_handler.go:96-173` |
| Agent 工作台对话 (普通用户级) | `POST /api/v1/agent/chat` SSE | `agent_handler.go:105-184` |
| Agent picker (文章 / 标签) | `GET /api/v1/agent/articles\|tags` | `agent_handler.go:258-403` |
| Agent Workflow authoring | `/api/v1/admin/agent-workflows/*` | `agent_workflow_handler.go` |
| Agent Workflow catalog | `/api/v1/admin/agent-tools\|agent-definitions\|agent-schedules` | `agent_workflow_handler.go` |
| Agent Workflow runtime | `POST /api/v1/agent/workflows/:id/runs` `/api/v1/agent/published/*` | `agent_workflow_handler.go`, `agent_workflow_service.go` |
| 公开搜索 | `GET /api/v1/public/search?mode=keyword\|semantic\|hybrid` | `search_handler.go:105-134`, `search_service.go:416-491` |
| 公开搜索 QA | `GET /api/v1/public/search/qa` SSE | `search_handler.go:137-186` |
| 搜索功能开关 | `GET /api/v1/public/search/features` | `search_handler.go:189-196` |
| 搜索管理 (config / diagnostics / reindex / cancel / profile CRUD) | `/api/v1/admin/search/*` | `search_handler.go:198-682` |
| 仪表盘统计 | `GET /api/v1/admin/stats/*` | `stats_handler.go` |
| AI 用量与费用归档 | `/api/v1/admin/stats/ai-dashboard \| ai-pricing-gaps \| ai-cost-archive` | `stats_handler.go:198-249` |
| 活动审计 | `GET /api/v1/admin/activities/*` | `activity_handler.go` |
| 公开访问记录 | `POST /api/v1/public/visit` | `visitor_handler.go` |
| 系统监控 (15 个端点) | `/api/v1/admin/system/*` | `system_monitor_handler.go:65-81` |
| 服务器时间 | `GET /api/v1/admin/system/time` | `system_handler.go` |
| 日志级别热改 | `/api/v1/admin/system/log-level` | `log_level_handler.go` |
| 友情链接 CRUD | `/api/v1/admin/friend-links/*` `/api/v1/public/friend-links` | `friend_link_handler.go` |
| 站点设置白名单 CRUD | `/api/v1/admin/settings/*` | `site_setting_handler.go` |
| 站点公开信息 | `/api/v1/public/site/*` | `site_handler.go` |
| VanBlog 数据迁移 | `/api/v1/admin/migrations/vanblog/*` | `migration_handler.go`, `migration_service.go` |
| 媒体版本管理 | `/api/v1/admin/media/files/:id/versions/*` | `version_handler.go` |

端点集中在 `apps/server-go/internal/server/server.go` 的 `setupRoutes` 内一次性挂载；新增 Agent Workflow 后，AI/Agent 相关端点不再只包含 Chat 与传统 AI 工具。

## 3. 架构图 (网关 / 限流 / 监控)

### 3.1 请求流(以 `POST /api/v1/admin/ai/summary` 为例)

```
浏览器
  │  Authorization: Bearer <JWT>
  ↓
Nginx (7899)  proxy_pass http://backend:7898
  ↓
Echo router
  ├── middleware.Recovery()         (server.go:150)
  ├── middleware.Trace()            (server.go:151) — 注入 X-Request-ID
  ├── middleware.CORS(...)          (server.go:152)
  ↓
admin group (server.go:208)
  ├── middleware.JWTAuthWithStore   (双 key 校验 — current + previous)
  ├── middleware.RequirePasswordRotated()
  ├── middleware.RequireRole("admin")
  ↓
ai_handler.runGeneration(c, "summary", "/api/v1/ai/summary")
  ├── proxySyncPost(c, path)
  │     ├── DoSync(ctx, POST, baseURL+path, body, proxyHeaders(c))
  │     └── stashUpstreamStatus(c, statusCode)   — 真实上游状态
  └── recordAIEvent("ai.generation.summary", upstreamStatus)
        └── activitySvc.Create()  → activity_events 表
```

### 3.2 限流棋盘

| 端点 | 维度 | 配额 | 实现位置 |
| --- | --- | --- | --- |
| `POST /v1/auth/login` | IP | 10/min | `server.go:194` |
| `POST /v1/auth/register` | IP | 5/min | `server.go:195` |
| `POST /v1/auth/change-password` | User | 5/min | `server.go:199` |
| `POST /v1/public/visit` | IP | 60/min | `server.go:337-338` |
| `GET /v1/public/search` | IP | 30/min | `server.go:277` |
| `GET /v1/public/search/features` | IP | 60/min | `server.go:278` |
| `GET /v1/public/search/qa` | IP | 5/min | `server.go:279` |
| `POST /v1/public/comments/post/:postId` | IP | 5/min | `server.go:267` |
| `POST /v1/public/posts/:slug/verify-password` | IP | 10/min | `server.go:259` |
| `POST /v1/agent/chat` | User | 30/min | `server.go:364` |
| `GET /v1/agent/articles\|tags\|models` | User | 120/min | `server.go:365` |

> **注意:** AI 模块本身没有 backend 侧限流。`/api/v1/admin/ai/*` 不挂限流中间件。理由:这些端点都要求 `role=admin`,管理员故意刷 LLM 不算 DoS;真实成本控制在 ai-service 自己的 `_enforce_content_limit` 与 LiteLLM 路由层。

### 3.3 监控环

`MetricsHistoryService.Start()` (`metrics_history.go:124-142`) 启动单 goroutine 每 30 秒采集一次系统指标,保留 24 小时,在内存里存最多 ~2880 个快照。CPU/Mem/Disk 连续 5 次超阈值触发 warning/critical 告警(`metrics_history.go:172-206`),告警最多保留 100 条、5 分钟内同指标去重。

`ContainerMonitorService` (`container_monitor.go`) 走 Docker Engine API,默认 `/var/run/docker.sock`,可改为 `tecnativa/docker-socket-proxy` URL(`AETHERBLOG_MONITOR_DOCKER_ENDPOINT`)。3 秒 cache + singleflight 防缓存击穿。

## 4. 横向依赖

| 依赖 | 用途 | 失败行为 |
| --- | --- | --- |
| Python ai-service (`AETHERBLOG_AI_BASE_URL`) | LLM 实际调用 / 检索 / qa | DoSync 报 502, handler 映射成 R{code:500, msg:"AI 服务不可用"} |
| PostgreSQL 17 + pgvector | 文章 / 嵌入 / 活动 / 访问统计 | `Server.healthHandler` 标 DOWN, 但服务进程不退出 |
| Redis 7 | 限流计数 / 会话 / Lua 脚本 | 限流静默放行 (`ratelimit.go:81-83`); 会话功能短暂失效 |
| Docker socket (可选) | 容器监控 | `ContainerOverview.DockerAvailable=false`, UI 显示「Docker 不可达」 |
| 上传文件目录 (`AETHERBLOG_UPLOAD_PATH`) | 媒体服务、disk 监控 | 监控显示 0 字节,媒体上传失败 |

## 5. 关键设计决策

### 5.1 用「上游真实状态」而非 c.Response().Status 做审计

`response.Fail(...)` 把所有错误统一包装成 R{code,message} HTTP 200 信封返回客户端。如果审计代码读 `c.Response().Status`,所有失败都被记成 SUCCESS。`stashUpstreamStatus` / `readUpstreamStatus` (`ai_handler.go:619-634`) 在每次代理调用后把上游真实 HTTP 状态存到 echo.Context,审计才能区分 SUCCESS / WARNING / ERROR。这是 codex review 数次提出的 P1 修正。

### 5.2 SSE 事件白名单

所有 SSE 透传(AI 流式摘要 / Agent chat / Search profile reindex)都走 `validateSSELine` (`ai_handler.go:564-602`),只放行 `delta / result / done / error / start / progress / think / sources` 类型。未知 type 直接丢,JSON 解析失败也丢。这一来防止 ai-service 自己出 bug 透传敏感字段,二来锁死前端解析路径。

### 5.3 异步索引 + cancel + last-batch

`SearchHandler` 的 `IndexBatch` / `Reindex` / `RetryFailed` 全部是「立即 200 + goroutine 跑 30 分钟」,前端轮询 `stats` / `posts` 接口看进度。同一时间只允许一个任务跑(`atomic.Bool reindexing`),Cancel 端点通过 `context.CancelFunc` 同时打断本地循环和已发出的 ai-service HTTP 请求(`search_handler.go:35-80`)。批次结束写一份 `lastBatch` 到内存,前端拿这个作为 toast「失败原因 + 失败 id 列表」(`search_handler.go:82-101, 449-457`)。

### 5.4 search profile 蓝绿切换

`migration 000041` 把检索配置从「单 model_id」升级成 `(model + chunker + chunk_size + overlap)` 的整组,允许同一时刻多套并存,只有一个 status='active'(partial unique 索引保证)。切换流程:新建 shadow profile → 全站 reindex 写 shadow 行 → 一条事务里 shadow→active + 旧 active→deprecated + `site_settings.search.active_profile_code` 翻转 → 旧行保留作回滚。`044` 又给 `parent_child` chunker 加了 `parent_text` 列,父段命中后回显完整上下文给 RAG。

### 5.5 不持久化日志级别

`log_level_handler.Update` 只调 `zerolog.SetGlobalLevel` 在线生效(`log_level_handler.go:96`)。**不写 DB,不写 .env**。重启后回到 `LogConfig.Level`。这是一个故意设计 —— 临时排查 / 急救场景下用,长期变更必须改环境变量后重启,避免线上日志级别和运维认知漂移。

### 5.6 activity_events 是统一审计层

所有非读操作(文章 CRUD / AI 调用 / 友链 / 设置 / agent 对话)都通过 `activitySvc.Create` 落 `activity_events` 表。事件分类(category)字段在 migration 000046 才允许了 `security`,8 类:`post / comment / user / system / friend / media / ai / security`。这就是为什么 `auth_handler` 写「JWT 密钥轮换」事件直到 000046 之前都被 CHECK 静默拒绝。

## 6. 已知问题 / 待改进

### 6.1 限流值硬编码

`server.go:273-279` 注释明确:搜索限流 30/min、问答 5/min 是写死的,而 site_settings 里有 `search.anon_search_rate_per_min` 和 `search.anon_qa_rate_per_min`,前者根本没生效。原因是 `RateLimitByIP` 中间件在启动阶段注册,那时 DB 还没读出来。修法:把限流改成「每次请求时查 site_settings + 缓存」或直接写一个动态包装。

### 6.2 ai_client 错误处理薄弱

`service/ai_client.go:79-114` 里 `do` 方法对错误的归一化只有三档:`ctx.Canceled→499`、`Timeout→504`、`其他→502`。但 ai-service 真实失败模式更多 —— 比如 LiteLLM 返回 401(供应商 key 失效)、429(供应商限流)。这些会在 `parseAndRespond` 里被 `mapStatusToError` 映射,但 client 层没区分「TLS 握手失败」「连接拒绝」「上下文取消」「读响应中断」,日志只有一行 "AI 服务不可用",事故复盘时只能去翻 ai-service 日志。建议增加 `error_kind` 字段或 wrap 原 err。

### 6.3 search 真实可用度依赖 ai-service

`SearchService.Search` 的「hybrid」策略下两路并行:关键词 keywordSearch (本地 SQL `ts_rank`) + 语义 semanticSearch (HTTP 调 ai-service)。如果 ai-service 不可用 / `aiClient==nil` / `active_embedding_model` 未设,直接静默降级到关键词。**用户感知不到「我的语义搜索失效了」**。`Diagnostics` 端点 (`search_service.go:160-220`) 用人话解释了当前 effectiveMode,但前端没有强制展示。

### 6.4 容器监控 endpoint 安全

`container_monitor.go:91-119` 接受 `dockerEndpoint` 参数。如果是 unix socket,backend 进程必须有 socket 文件读权限(生产环境通常 `docker` 组),意味着 backend container 实际是「root inside docker socket」—— 任何 RCE 都能逃逸到宿主机。生产推荐方案是 `tecnativa/docker-socket-proxy` HTTP 代理 + 限制只读端点,这一点 `container_monitor.go` 注释里有写,但没强制。

### 6.5 visit_records 表无清理

`visitor_handler` 每次调用插入一行 visit_records。60/min/IP 限流后单 IP 一天最多 86,400 条;100 个攻击 IP 一天 8M 条。表无 partition、无 TTL。配合 30 天的 `GetVisitorTrend` 查询,后期会越来越慢。需要补一个 `DELETE FROM visit_records WHERE created_at < NOW() - INTERVAL '90 days'` 的定期清理。

### 6.6 metrics_history 24h 只在内存

每 30s 一个快照保留 24h ≈ 2880 条 ≈ 173 KB,内存压力极小。但**进程重启即丢**。如果 AB 测试想看「上次重启前 12 小时的 CPU 飙升」就没辙。考虑落到 PG 或 Redis time-series。

## 7. 扩展点

| 期望扩展 | 落地路径 |
| --- | --- |
| 新增 AI 任务类型 | 1) 在 ai-service 写 prompt → 2) `INSERT INTO ai_task_types` 一条记录 → 3) `ai_handler.go:67-73` 加路由 + `generationTaskLabels` 加中文标签。无需改 ai_client。 |
| 新增 chunker 策略 | 1) 改 `migration 000041` 的 `chunker_kind CHECK`(新 migration ALTER) → 2) ai-service `chunker.py` 加实现 → 3) admin UI profile 新增模板。Go backend 透明。 |
| 新增搜索 effectiveMode | 改 `search_service.go:185-211` 的 switch-case,增加新维度;`Diagnostics` 自动反映。 |
| 容器监控接入第三方 metrics(Prometheus/Grafana) | `system_monitor.go` 已经把所有指标拍平到 `flattenMetrics`,加一个 `/metrics` Prometheus exporter 路由就可以。 |
| 限流策略动态化 | 写一个 `DynamicRateLimit(redis, key, settingsSvc)` 包装,每秒读 site_settings,替换 `server.go:277-279` 的硬编码。 |
| 审计事件分类扩展 | 改 `migration 000046` (新建 047) ALTER chk_activity_event_category。注意所有写审计的 handler 必须同步 EventCategory 字段。 |

## 8. 参考阅读

- `docs/architecture.md` —— 全景架构图与各模块端点表
- `.claude/docs/api-handlers.md` —— 26 个 handler 索引
- `.claude/docs/database-migrations.md` —— migrations 000001-000046 全索引
- `docs/AI_MODULE_PLAN_V2.md` / `docs/AI_MODULE_REPORT_V2_PHASE1.md` —— ai-service 与 backend 对接的设计史
- `docs/SEARCH_PROFILES_FOLLOWUP_PLAN.md` —— search profile 蓝绿切换的产品视角
- `docs/output/07-ai-service-python/` —— 与本模块互补的 Python 侧实现
