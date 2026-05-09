# 07 · 中间件 (CORS / RateLimit / Recovery / Trace)

> 本目录下涉及 4 个核心中间件 + 2 个鉴权中间件(`jwt.go` / `RequireRole` / `RequirePasswordRotated` / `AssertOwnership`,后者属模块一,仅参引)。

## 1. 责任范围

中间件层是请求的「全局漏斗」,在所有 handler 之前 / 之后做横切关注:

- **Recovery** —— panic 不让进程死,统一 R{} JSON 信封,带 traceId。
- **Trace** —— 注入 / 透传 `X-Request-ID`,记录访问日志(对探活路径降噪)。
- **CORS** —— 允许 admin SPA / blog 前端(不同 origin)调 backend。
- **RateLimitByIP / RateLimitByUser** —— 基于 Redis Lua 的 sliding-window 计数。
- **JWTAuthWithStore** + **RequireRole / RequirePasswordRotated**(模块一)—— 在 `/v1/admin/*` `/v1/agent/*` 上叠加鉴权。

中间件链整体:

```
Echo
 └── Recovery()                    全局
 └── Trace()                       全局
 └── CORS(allowedOrigins)          全局
 └── group "/api/v1/admin"
      └── JWTAuthWithStore(jwtStore)
      └── RequirePasswordRotated()
      └── RequireRole("admin")
      └── handler-level: BodyLimit / RateLimitByIP / RateLimitByUser ...
```

## 2. 关键代码入口

| file:line | 中间件 |
| --- | --- |
| `apps/server-go/internal/middleware/recovery.go:14-45` | `Recovery()` |
| `apps/server-go/internal/middleware/trace.go:23-95` | `Trace()` 主体 |
| `apps/server-go/internal/middleware/trace.go:23-32` | `isHealthProbePath` 判断 |
| `apps/server-go/internal/middleware/cors.go:15-23` | `CORS(allowedOrigins)` |
| `apps/server-go/internal/middleware/ratelimit.go:23-35` | `rateLimitScript` Lua 脚本 |
| `ratelimit.go:41-46` | `RateLimitByIP` |
| `ratelimit.go:52-61` | `RateLimitByUser` |
| `ratelimit.go:71-106` | `rateLimitMiddleware` 通用实现 |
| `apps/server-go/internal/server/server.go:149-153` | `setupMiddleware` 全局挂载 |

## 3. 数据流

### 3.1 全局链注册

`server.go:149-153`:

```go
func (s *Server) setupMiddleware() {
    s.Echo.Use(middleware.Recovery())
    s.Echo.Use(middleware.Trace())
    s.Echo.Use(middleware.CORS(s.Config.CORS.AllowedOrigins))
}
```

顺序重要:Recovery 必须最外层,Trace 次之(让 Recovery 输出能带 traceId),CORS 再次。Echo 的 `Use` 按注册顺序构成包装栈,执行顺序:**第一个 Use 最早进入、最晚返回**。

### 3.2 Recovery

```go
defer func() {
    if r := recover(); r != nil {
        log.Error().
            Interface("panic", r).
            Str("method", c.Request().Method).
            Str("path", c.Request().URL.Path).
            Msg("panic recovered")
        _ = c.JSON(http.StatusInternalServerError, response.R{
            Code:          500,
            Message:       "服务器内部错误",
            Timestamp:     time.Now().UnixMilli(),
            TraceID:       ctxutil.TraceID(c),
            ErrorCategory: "internal_error",
        })
    }
}()
return next(c)
```

故意**只打日志不打 stack trace** —— 业务大量使用 sql.Rows 等可能产生大堆栈的对象,生产环境完整堆栈会让日志爆炸。开发期需要 stack trace,可以在 `log.Error()` 后加 `.Stack()`。

输出固定 `Code:500`,`Message` 不暴露 panic 内容,只回中文给用户。`ErrorCategory:"internal_error"` 让前端 ErrorBoundary 能区分网络错 / 业务错 / 内部错。

### 3.3 Trace

```go
traceId := c.Request().Header.Get("X-Request-ID")
if traceId == "" {
    b := make([]byte, 16)
    _, _ = rand.Read(b)
    traceId = hex.EncodeToString(b)            // 32 位 hex
}
c.Set(ctxutil.TraceIDKey, traceId)              // 写入 context
c.Response().Header().Set("X-Request-ID", traceId)  // 回写响应头

start := time.Now()
err := next(c)
latency := time.Since(start)

// 健康探活路径 2xx 直接不落访问日志
if res.Status < 400 && isHealthProbePath(req.URL.Path) {
    return err
}

// 状态码决定日志级别
event := log.Info()
if res.Status >= 500 { event = log.Error() }
else if res.Status >= 400 { event = log.Warn() }

event.
    Str("traceId", traceId).
    Str("method", req.Method).
    Str("path", req.URL.Path).
    Int("status", res.Status).
    Int64("latency_ms", latency.Milliseconds()).
    Str("ip", c.RealIP()).
    Msg("request")
```

#### isHealthProbePath 降噪规则

`trace.go:23-32`:

```go
switch p {
case "/api/actuator/health",
     "/api/v1/admin/system/health",
     "/api/v1/admin/system/metrics":
    return true
}
return strings.HasSuffix(p, "/health") || strings.HasSuffix(p, "/ready")
```

历史实现是「降级到 Debug 级别」,但 docker healthcheck 每 3s 一次、SystemMonitor 每 30s 巡检一次。一旦运维 `export LOG_LEVEL=debug` 排查业务问题,访问日志就被探活淹没。改为「2xx 时不落记录」后,即使切到 Debug 也只看到业务相关 Debug 行;失败仍按状态码升级到 Warn/Error,告警链路不受影响。

#### X-Request-ID 透传到 ai-service

`ai_handler.proxyHeaders` (`ai_handler.go:649-661`) 把 `ctxutil.TraceID(c)` 注入到给 ai-service 的请求头,Python 侧用同名字段写入 `ai-service.log`。在前端报「summary 失败」时,traceId 能跨进程关联浏览器 → backend → ai-service 三段日志。

### 3.4 CORS

`cors.go:15-23`:

```go
echomw.CORSWithConfig(echomw.CORSConfig{
    AllowOrigins:     allowedOrigins,
    AllowMethods:     {GET, POST, PUT, PATCH, DELETE, OPTIONS},
    AllowHeaders:     {Origin, Content-Type, Accept, Authorization, X-Requested-With},
    AllowCredentials: true,
    MaxAge:           3600,
})
```

`AllowCredentials:true` 是关键 —— admin SPA 用 Cookie + Authorization 双轨认证(JWT 也存 HttpOnly cookie),没这个浏览器不会带 Cookie。

`MaxAge:3600` 让浏览器缓存预检 1 小时。

### 3.5 限流(Lua 脚本)

```lua
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl   = tonumber(ARGV[2])
local current = redis.call("INCR", key)
if current == 1 then
    redis.call("EXPIRE", key, ttl)
end
if current > limit then
    return redis.call("TTL", key) * -1   -- 负值表示已超限
end
return current
```

Lua 脚本在 Redis 服务端原子执行,不存在「INCR 后还没 EXPIRE 就崩」的窗口。返回正数(当前计数)表示放行;负数(剩余 TTL 取反)表示已超限。

`rateLimitMiddleware` (`ratelimit.go:71-106`):

```go
if rdb == nil {
    return next(c)                    // Redis 不可用 → 静默放行
}

key := keyPrefix + ":" + keyFn(c)     // e.g. "rate:agent:chat:u:42"
ctx, cancel := context.WithTimeout(c.Request().Context(), time.Second)
defer cancel()

result, err := rateLimitScript.Run(ctx, rdb, []string{key}, count, int(window.Seconds())).Int64()
if err != nil {
    return next(c)                    // Redis 执行失败 → 也放行(可用性优先)
}

if result < 0 {
    return response.FailWith(c, response.TooManyRequests, "请求过于频繁,请稍后再试")
}
return next(c)
```

#### 维度选择

| Helper | 维度 |
| --- | --- |
| `RateLimitByIP` | `c.RealIP()`,匿名 / 公开端点用 |
| `RateLimitByUser` | 已登录 → `"u:<userID>"`;未登录 → `c.RealIP()` 兜底 |

`RealIP()` 看 `X-Forwarded-For` / `X-Real-IP`,需要 nginx 正确设置(`docs/architecture.md` 节点),否则会拿到反向代理 IP 全站共享一个桶。

#### Redis 不可用时的策略

注释明确「Redis 不可用 → 跳过限流,可用性优先」。这意味着如果 Redis 挂了,**所有限流端点都变成无限流**。攻击者可以在 Redis 故障窗口里疯狂打 LLM。

详见 §6.2 已知限制。

## 4. DB 表 / 索引

无中间件专用表。

限流 key 全在 Redis(`<prefix>:<dimension>`),自带 TTL 自动清理。

## 5. 配置 / 环境变量

| Env | 默认 | 含义 |
| --- | --- | --- |
| `AETHERBLOG_CORS_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:5173` | 空格 / 逗号分隔的 origin 列表 |
| `AETHERBLOG_LOG_LEVEL` | `info` | zerolog 全局级别;Trace 中间件不读它,但被 isHealthProbePath 间接影响 |
| `AETHERBLOG_REDIS_HOST/PORT/...` | localhost:6379 | RateLimit 必依赖 |

## 6. 与其他模块耦合

| 中间件 | 耦合 |
| --- | --- |
| `Recovery` | `pkg/response.R` 信封、`pkg/ctxutil.TraceID(c)` |
| `Trace` | `pkg/ctxutil`、zerolog 全局实例;Trace 出口被 `log_level_handler` 间接影响(改 GlobalLevel 会立刻生效到访问日志) |
| `CORS` | `cfg.CORS.AllowedOrigins` |
| `RateLimit` | `*redis.Client`、`response.TooManyRequests`(429),依赖 `middleware.GetLoginUser` 取 userID |
| (鉴权) `JWTAuthWithStore` | `pkg/jwtkeys.Store` 双 key 校验 |
| (鉴权) `RequirePasswordRotated` | 阻止 default password 账号访问业务接口 |
| (鉴权) `RequireRole` | 强制 admin 角色 |
| (鉴权) `AssertOwnership` | media / version handler 的 uploader 校验 |

## 7. 限流棋盘(全栈一览)

| 端点 | 维度 | 配额 | redis key |
| --- | --- | --- | --- |
| `POST /v1/auth/login` | IP | 10/min | `rate:login:<ip>` |
| `POST /v1/auth/register` | IP | 5/min | `rate:register:<ip>` |
| `POST /v1/auth/change-password` | User | 5/min | `rate:changepwd:u:<id>` 或 `rate:changepwd:<ip>` |
| `POST /v1/public/visit` | IP | 60/min | `rate:visit:<ip>` |
| `POST /v1/public/comments/post/:postId` | IP | 5/min | `rate:comment:<ip>` |
| `POST /v1/public/posts/:slug/verify-password` | IP | 10/min | `rate:postpwd:<ip>` |
| `GET /v1/public/search` | IP | 30/min | `rate:search:<ip>` |
| `GET /v1/public/search/features` | IP | 60/min | `rate:search:features:<ip>` |
| `GET /v1/public/search/qa` | IP | 5/min | `rate:qa:<ip>` |
| `POST /v1/agent/chat` | User | 30/min | `rate:agent:chat:u:<id>` |
| `GET /v1/agent/articles\|tags\|models` | User | 120/min | `rate:agent:picker:u:<id>` |

> **AI / Search 管理端点没有限流**(`/v1/admin/ai/*` `/v1/admin/search/*` 等),靠 `RequireRole("admin")` 兜底。

## 8. 已知限制 / 待改进

### 8.1 RealIP 依赖 nginx 配置

如果反向代理没设置 `proxy_set_header X-Real-IP $remote_addr` + `X-Forwarded-For $proxy_add_x_forwarded_for`,backend 拿到的 RealIP 是 nginx 内网 IP,所有用户共享一个桶 → 整站轻松触发限流。`docs/architecture.md` 与 `.agent/rules/nginx-guide.md` 里有正确配置。

### 8.2 Redis 故障 = 限流失效

参见 §3.5 末尾。`rdb == nil` 或 `rateLimitScript.Run` 报错都直接 `next(c)` 放行。这是「可用性优先」的合理选择,但需要把限流故障作为 alert 上报到 ops。

### 8.3 限流粒度只有「秒级」

`window.Seconds()` 把窗口转成秒交给 Redis。如果想要「10 秒内 5 次」,window 必须 ≥ 1 秒。亚秒级限流(防 burst)需要用 redis-cell / sliding-window 方案。

### 8.4 限流值大量硬编码

`server.go` 里几乎所有 `RateLimit*` 调用都是 hardcoded `30`、`60`、`5`。只有部分端点可以从 `site_settings` 读(实际**未实装**,见 03-search.md §7.1)。建议:
- 把限流参数集中到 `cfg.RateLimit.<endpoint>`。
- 提供运行时刷新机制,不必重启。

### 8.5 Trace 没有 span 概念

只有 `traceId`,没有 `spanId` / `parentSpanId`。多次跨服务调用(backend → ai-service → 内部子 RAG)无法在日志里区分父子关系。OTEL 集成是后续工作。

### 8.6 Recovery 不输出 stack trace

参见 §3.2。开发期排错只能靠 IDE debug。生产期建议引入 `runtime/debug.Stack()` 但截断 + 清除敏感数据。

### 8.7 CORS AllowOrigins 没正则支持

`echomw.CORSWithConfig` 的 `AllowOrigins` 是字面量列表。`https://*.aetherblog.com` 通配符 + 子域名场景需要切换到 `AllowOriginFunc`。当前部署(单域名 `aetherblog.io`)够用,多租户 / 多域名场景需扩展。

### 8.8 isHealthProbePath 不可配置

加新探活路径(比如 GitOps 工具的特殊端点)必须改代码、重新构建、重启。建议读环境变量 / site_settings 维护白名单。

## 9. 测试覆盖

| 文件 | 覆盖内容 |
| --- | --- |
| `apps/server-go/internal/middleware/jwt_test.go` | JWT 认证(模块一覆盖) |
| 没有 `recovery_test.go` | panic 场景靠端到端 |
| 没有 `trace_test.go` | traceId 注入 / 探活降噪靠日志肉眼检查 |
| 没有 `cors_test.go` | 直接用 echo CORS 中间件,信任上游测试 |
| 没有 `ratelimit_test.go` | Lua 脚本 + Redis 客户端无 mock 测试 |

中间件层依赖两个外部资源(Redis + Echo 上下文),unit test 难写。建议引入 testcontainers 跑 redis,补限流的并发场景测试。

## 10. 链路示意

```
                   ┌─────────────────────┐
                   │  Echo Web Framework │
                   └─────────┬───────────┘
                             │
                  ┌──────────▼──────────┐
                  │     Recovery()      │  ← panic safety net
                  └──────────┬──────────┘
                             │
                  ┌──────────▼──────────┐
                  │       Trace()       │  ← X-Request-ID + access log
                  └──────────┬──────────┘
                             │
                  ┌──────────▼──────────┐
                  │  CORS(AllowOrigins) │  ← cross-origin gate
                  └──────────┬──────────┘
                             │
            ┌────────────────┴────────────────┐
            │                                 │
   ┌────────▼──────┐                ┌─────────▼─────────┐
   │ public group  │                │ /v1/admin group   │
   │ (no auth)     │                │ JWTAuthWithStore  │
   └───┬───────┬───┘                │ + PwdRotated      │
       │       │                    │ + RequireRole     │
       │       │                    └────────┬──────────┘
       │       │                             │
   ┌───▼───┐ ┌─▼──────────────┐    ┌─────────▼──────┐
   │search │ │RateLimitByIP   │    │ handler        │
   │/visit │ │(rate:search,   │    │ + body limit   │
   │       │ │ 30/min)        │    │ + handler-     │
   └───────┘ └────────────────┘    │   level mw     │
                                    └────────────────┘
```
