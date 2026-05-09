# 02 · Agent 工作台与长任务

## 1. 责任范围

`agent_handler` 暴露 `/api/v1/agent/*`,服务于前台 `/agent/workspace` 多轮对话工作台。它与 `/api/v1/admin/ai/*` 的关键差异:

- **鉴权放宽到「已登录用户」**,不再强制 `role=admin`。普通注册用户也能用 Agent。
- **必须注入 `X-Internal-Service` token**。原因:ai-service 的 `/api/v1/agent/chat` 走 `require_admin_or_internal`,普通用户的 JWT 直接打过去会被拒;backend 这里把它代理成「内部服务身份」,确保任意用户都能用。
- **走流式 SSE 长连接**,使用 `streamClient`(读超时 5min)而不是同步 client(同样 5min,但 transport 是 clone 的,SSE 连接不会和同步生成抢连接池)。
- **用户级限流**,30/min/user(chat)+ 120/min/user(picker)。

本模块同时承担「长任务并发锁」的角色 —— 它和 `search_handler` 共用同一个 `atomic.Bool reindexing` 互斥锁(参见 03-search.md)。但 `agent_handler` 自己只做 SSE 同步阻塞流,没有后台 goroutine。「长任务」一节集中讨论 search 那边的几个 30 分钟级别后台索引任务。

## 2. 关键代码入口

### Agent 端点

| file:line | 端点 | 类型 |
| --- | --- | --- |
| `apps/server-go/internal/handler/agent_handler.go:105-184` | `POST /api/v1/agent/chat` | SSE 流 |
| `agent_handler.go:191-221` | `GET /api/v1/agent/models` | 同步代理 |
| `agent_handler.go:258-344` | `GET /api/v1/agent/articles?q=&limit=` | 本地 DB 查询 |
| `agent_handler.go:384-403` | `GET /api/v1/agent/tags` | 本地 DB 查询 |

### 路由 + 限流挂载

`apps/server-go/internal/server/server.go:360-366`:

```go
agentHandler := handler.NewAgentHandler(s.Config, postRepo, tagRepo, activitySvc)
agentGroup := api.Group("/v1/agent", authMW, pwdRotated)   // 不挂 RequireRole("admin")
agentHandler.Mount(
    agentGroup,
    middleware.RateLimitByUser(s.Redis, "rate:agent:chat", 30, time.Minute),
    middleware.RateLimitByUser(s.Redis, "rate:agent:picker", 120, time.Minute),
)
```

`Mount` 自身:

```go
// agent_handler.go:83-88
func (h *AgentHandler) Mount(g *echo.Group, chatLimit, pickerLimit echo.MiddlewareFunc) {
    g.POST("/chat", h.Chat, chatLimit)
    g.GET("/models", h.Models, pickerLimit)
    g.GET("/articles", h.Articles, pickerLimit)
    g.GET("/tags", h.Tags, pickerLimit)
}
```

两种限流分开传入是刻意为之 —— 如果挂在 group 上会让 picker 端点和 chat 共享一个桶,「@」 picker 一边输入一边搜会先把桶用光,用户还没发出第一条 chat 消息就 429。

### AgentHandler 结构

```go
// agent_handler.go:49-55
type AgentHandler struct {
    client        *service.AIClient
    internalToken string
    postRepo      *repository.PostRepo
    tagRepo       *repository.TagRepo
    activitySvc   activityRecorder
}
```

`postRepo` 与 `tagRepo` 是因为 picker 端点直接查本地 DB(那些只是名录类只读查询,没必要再 round-trip 到 ai-service)。

## 3. 数据流

### Chat (SSE)

```
浏览器 POST /api/v1/agent/chat
  Body: {"message":"...", "history":[...], "articleIds":[42,103], "tagSlugs":["go","ai"]}
       │
       ▼
authMW + pwdRotated         (任意已登录用户均可)
       ▼
RateLimitByUser("rate:agent:chat", 30/min/user)
       ▼
Chat handler  agent_handler.go:105
  ├── lu := middleware.GetLoginUser(c)  → 必须非 nil
  ├── h.internalToken == "" → return 500 (启动期校验已保证 ≥32 字符)
  ├── http.MaxBytesReader(c.Response(), c.Request().Body, 96*1024)  ← 96KB body limit
  ├── headers = {
  │     X-Internal-Service: <internalToken>,
  │     X-Request-ID:       ctxutil.TraceID(c),
  │     X-Forwarded-User-ID: <lu.UserID>,
  │   }
  ├── client.DoStream(ctx, POST, "/api/v1/agent/chat", body, headers)
  │     ↓
  │   ai-service: /api/v1/agent/chat 流式响应
  │   data: {"type":"think","content":"我先查一下 ..."}
  │   data: {"type":"sources","items":[...]}
  │   data: {"type":"delta","content":"..."}
  │   data: {"type":"done"}
  │
  ├── recordChatActivity("流式开始") → activity_events
  │
  ├── Set SSE headers (Content-Type / Cache-Control / X-Accel-Buffering: no)
  └── for scanner.Scan(): if validateSSELine(line): write to client + Flush()
```

`recordChatActivity` (`agent_handler.go:413-437`) 在 `event_type=ai.agent_chat`、`event_category=ai`、description 形如 `POST /agent/chat · 请求体 N B · → HTTP 200 (流式开始)` 落库。**故意只在「流式开始」时写一条**,不在每个 SSE chunk 写,避免 activity_events 灌爆。

### picker (本地 DB)

`Articles` (`agent_handler.go:258-344`) 三个分支:

| 分支 | 行为 |
| --- | --- |
| `q=""`(默认) | `postRepo.FindPublished(ctx, 1, limit*2)` → 过滤 `Password != nil` → 取前 limit 条 |
| `q="..."` | `postRepo.SearchPublished(ctx, q, limit*2, 0)` 取候选 → `filterPublicArticleIDs` 二次过滤 password 保护 → 取前 limit 条 |
| `len(q) > 200` | 直接 400 拒绝(避免 LLM 风险无关的过长输入打 SQL ts_rank) |

**安全要点(代码注释 §5.7 节):** `FindPublished` / `SearchPublished` 已经过滤了 deleted / status / is_hidden,**但没过滤 password**。如果 picker 让用户选一篇密码保护文章,后端 RAG context builder 会读它的 `content_markdown` 注入 prompt,等同于绕过密码门把正文送给 LLM 并可能在回答里复述。所以本端点必须显式做一次 password 过滤,ai-service 那边 `_build_picker_context` 还有第二道防御。

### models(透传)

`Models` (`agent_handler.go:191-221`) 走同步 `DoSync`,完整透传 ai-service 响应给前端 `Blob(statusCode, "application/json", body)`。这里**不**做 R{} 信封包装,因为 ai-service 自己的 `/agent/models` 已经是 R{} 格式。

## 4. DB 表 / 索引

Agent 自身不引入新表。它读 `posts` / `tags`,写 `activity_events`。

依赖 migration:
- `000022_activity_events`(基表)
- `000046_activity_event_category_security`(`event_category='ai'` 仍是合法值)

## 5. 配置 / 环境变量

| Env | 含义 |
| --- | --- |
| `AETHERBLOG_AI_BASE_URL` | 指向 ai-service |
| `AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN` | ≥32 字符,Agent 必须用,缺失启动 fatal |
| `AETHERBLOG_AI_STREAM_READ_TIMEOUT` | SSE 整体超时,默认 5min |

无 Agent 专用配置项;Chat 限流是硬编码 30/min,picker 是 120/min(`server.go:364-365`)。

## 6. 与其他模块耦合

| 耦合 | 形式 |
| --- | --- |
| `agent_handler ↔ ai_handler` | 共享 `service.NewAIClient(s.Config.AI)`,共享 `validateSSELine` 白名单(`agent_handler.go:173`) |
| `agent_handler → postRepo / tagRepo` | picker 端点的本地 DB 查询 |
| `agent_handler → activitySvc` | 写 `ai.agent_chat` 审计 |
| `validateSSELine` 跨 ai_handler / agent_handler / search_handler | 三处共用,新增类型必须在 `ai_handler.go:548-553` 加 |
| 限流 redis key prefix `rate:agent:chat` / `rate:agent:picker` | 不与其他模块冲突 |

## 7. 长任务并发模型(跨 search_handler)

虽然 agent 自己没有长任务,但模块四的「长任务三件套」全部在 `search_handler` 里,且共享一个互斥锁。在此集中描述以便整体理解:

### 7.1 哪些是「长任务」

| 端点 | kind | 触发动作 |
| --- | --- | --- |
| `POST /v1/admin/search/index-batch` | `"batch"` | 批量索引指定 N 篇文章(N ≤ 100) |
| `POST /v1/admin/search/reindex` | `"full"` | 全量重建所有已发布文章的 embedding |
| `POST /v1/admin/search/retry-failed` | `"retry"` | 只重试上次失败的文章 |
| `POST /v1/admin/search/profiles/:code/reindex/stream` | `"profile-reindex"` | 按新 search profile 重新切片 + 嵌入 |

前三个走「立即返回 200 + 后台 goroutine」模型,第四个是「同步阻塞 SSE」模型。

### 7.2 互斥锁(reindexing)

`apps/server-go/internal/handler/search_handler.go:35-101`:

```go
type SearchHandler struct {
    svc          *service.SearchService
    reindexing   atomic.Bool         // 「正在跑长任务」原子标志
    activeMu     sync.Mutex
    activeCancel context.CancelFunc  // 当前活跃任务的 cancel
    activeKind   string              // "batch" | "full" | "retry" | "profile-reindex"
    lastBatchMu  sync.RWMutex
    lastBatch    *dto.LastBatchSummary
}
```

每个长任务启动:

```go
if !h.reindexing.CompareAndSwap(false, true) {
    return response.Fail(c, "索引任务正在进行中,请等待完成")
}

go func() {
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
    h.setActiveJob("batch", cancel)
    defer func() {
        cancel()
        h.clearActiveJob()
        h.reindexing.Store(false)
    }()
    // ... 实际工作 ...
}()
```

### 7.3 取消端点

`POST /v1/admin/search/cancel` (`search_handler.go:427-441`):

```go
kind := h.cancelActiveJob()    // 触发 activeCancel(),清空 activeKind
if kind == "" {
    return response.OK(c, {"status":"idle"})
}
return response.OK(c, {"status":"canceling", "kind":kind})
```

`context.CancelFunc` 同时触发:
1. 本地循环里的 `for _, post := range posts: select case <-ctx.Done(): return` —— 立刻退出。
2. 已发出去的 `aiClient.DoStream(ctx, ...)` HTTP 请求 —— Go HTTP 客户端感知 ctx,会立刻关掉连接,让 ai-service 那边的 SELECT/embed 也尽早释放。

### 7.4 lastBatch 缓存

`search_handler.go:82-101`:

每次 batch 索引完成时把 `IndexBatchResult{Total, Indexed, Failed, Reason, FailedIDs}` 存到内存 `h.lastBatch`。前端进度面板结束时 GET `/v1/admin/search/last-batch` 拉取,根据 `finishedAt > job.startTime` 判断是不是这次任务的结果,把失败原因 + failedIds 拼成 toast。

**仅 in-memory,restart 后丢失**。这是 PR #577 codex review 修复:之前管理员看到「失败 N 篇」却必须翻 docker 日志才知道为什么。

### 7.5 Profile reindex 走同步 SSE

`search_handler.go:541-682` `proxyProfileStream`:

不像前三个长任务,这个是「同步阻塞 + 流式输出」。原因(代码注释 §3.4 节):

- `axios !res.ok` 是 useReindexStream 唯一判定错误的信号。`response.Fail()` 返回 HTTP 200 + 信封 → 让 SSE 消费者继续读 body 当帧解析,导致 ProfileActivationFlow 卡死。所以这个端点**故意不用** `response.Fail`,而是 `c.JSON(http.StatusConflict, response.R{...})` 让 SSE consumer 走 error 分支。
- 不加 30 分钟硬超时(那是「异步 goroutine」的 circuit breaker 兜底,不适合 SSE 同步)。timeout 触发会让 scanner 静默 EOF,handler 返回 nil,前端永远卡在 reindexing。
- 当 cancel 端点中断或 scanner 遇错时,如果上游没自己 emit 终态帧(`done` / `result` / `error`),由 Go 替它 emit 一个 `data: {"type":"error","code":"cancelled"}` 兜底,让前端状态机能转移。

## 8. 已知限制 / 待改进

### 8.1 internalToken 起手缺失即 fatal,运维体验差

ai-service 自己也读 `INTERNAL_SERVICE_TOKEN`,如果两侧不一致,Chat 端点会拿到 403,但 Go backend 不会启动失败 —— 它只检查「是否非空 + 长度 ≥32」。建议增加启动期 ai-service health 探测:启动时调一次 `/health` 顺便用一个伪请求验证 token。

### 8.2 picker password 过滤的 limit*2 不够

如果有人故意把 30+ 篇文章设密码,`limit*2 = 60` 候选可能不够保留 30 条 public。前端会显示空列表 / 不足。代码注释承认「绝大多数站点密码保护文章占比 < 5%,足够」,但站点级配置应该是可调的。

### 8.3 chat 审计粒度

只在「流式开始」写一条。如果 admin 想看「该用户上周用了多少次 token」,这条审计帮不上 —— `description` 里只有请求体大小,没有真实 token 计数。建议补一条「流式结束」审计,或把 token 计数从 ai-service 反向回推。

### 8.4 长任务断电/重启不可恢复

reindexing 锁是 in-memory `atomic.Bool`,重启即清。`lastBatch` 也丢。后台 goroutine 如果在重启时被 `Server.Shutdown` 截断(`server.go:444-446` cancel bgCtx),还在跑的 batch 会留下半成品 PENDING 文章。下次启动时这些 PENDING 不会自动重试,需要管理员手动点 "RetryFailed"。

### 8.5 30 分钟硬超时后没有错误信号

`context.WithTimeout(..., 30*time.Minute)` 触发后,`IndexBatchPosts` 返回 `context.DeadlineExceeded`,goroutine `log.Error("async index-batch failed")` 但**不写审计**(异步 goroutine 没有 echo.Context 写不了)。前端轮询 stats 看到「indexed N + failed M」没有增长就只能怀疑卡住。

## 9. 测试覆盖

- `apps/server-go/internal/handler/ai_handler_test.go` 覆盖 `validateSSELine`(白名单匹配),Agent 复用同一逻辑。
- `apps/server-go/internal/handler/search_handler_test.go`(98 行)只覆盖 PATCH `/api/v1/admin/search/config` 路由能注册成功,**没有**长任务并发锁的单元测试。
- `apps/server-go/internal/service/migration_service_test.go`(387 行)覆盖 VanBlog 迁移的解析 / classify / slug 冲突等,但与本模块的 search/agent 无关。
- 没有 Agent 专门的 unit 测试。Chat / picker 的端到端验证靠 admin SPA 的 e2e。
