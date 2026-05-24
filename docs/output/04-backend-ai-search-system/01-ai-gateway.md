# 01 · AI 网关 (ai_handler / ai_client)

## 1. 责任范围

`ai_handler` 是浏览器到 Python ai-service 之间的**透明应用层代理**。它做的事:

1. 把 admin 的 LLM 调用请求(摘要 / 标签 / 标题 / 润色 / 大纲 / 翻译)转发给 ai-service。
2. 把 SSE 流式响应行级透传给浏览器,带白名单过滤。
3. 把 AI provider/model/credential/route 管理 CRUD 通配代理给 ai-service(`/providers/*`)。
4. 把 AI prompt 模板和任务类型 CRUD 代理给 ai-service(`/prompts/*` / `/tasks/*`)。
5. 把每次 admin 调 LLM 的真实上游状态码 + 调用规模写入 `activity_events` 审计表。

**它明确不做的事:**

- 不直接调用 LiteLLM、不接入 OpenAI/Anthropic SDK。
- 不持久化任何 AI 调用结果。
- 不做请求体 Schema 校验(下放到 ai-service 的 Pydantic)。
- 不重写 prompt(透传 ai-service)。

## 2. 关键代码入口

### Handler 注册 / 挂载

| file:line | 函数 | 说明 |
| --- | --- | --- |
| `apps/server-go/internal/handler/ai_handler.go:65-89` | `(*AiHandler).Mount` | 注册 `/summary` `/tags` 等 13 个端点到 admin group |
| `apps/server-go/internal/handler/ai_handler.go:96-101` | `MountProviders` | 通配 `/providers/*` 代理 + 5MB body limit |
| `apps/server-go/internal/server/server.go:348-349` | server.go 入口 | `aiHandler.Mount(admin.Group("/ai"))` |
| `apps/server-go/internal/server/server.go:368-370` | server.go 入口 | `aiHandler.MountProviders(admin.Group("/providers", BodyLimit("10M")))` |

### 同步生成端点

| file:line | 端点 | 转发到 ai-service |
| --- | --- | --- |
| `ai_handler.go:284-285` | `POST /ai/summary` | `POST /api/v1/ai/summary` |
| `ai_handler.go:289-290` | `POST /ai/tags` | `POST /api/v1/ai/tags` |
| `ai_handler.go:294-295` | `POST /ai/titles` | `POST /api/v1/ai/titles` |
| `ai_handler.go:299-300` | `POST /ai/polish` | `POST /api/v1/ai/polish` |
| `ai_handler.go:304-305` | `POST /ai/outline` | `POST /api/v1/ai/outline` |
| `ai_handler.go:309-310` | `POST /ai/translate` | `POST /api/v1/ai/translate` |

六个端点共用骨架 `runGeneration` (`ai_handler.go:264-281`):
1. 读 `Content-Length` 记下请求体规模;
2. `proxySyncPost` → `proxySyncRequest` → `client.DoSync`;
3. `recordAIEvent("ai.generation.<task>", upstreamStatus)`。

### 流式端点

| file:line | 端点 | 描述 |
| --- | --- | --- |
| `ai_handler.go:317-378` | `POST /ai/summary/stream` | 转发请求体 + SSE 行级回写,白名单过滤 |
| `ai_handler.go:382-456` | `GET /ai/summary/stream` | 兼容浏览器 `EventSource`,把 query 拼成 JSON body |

### Provider 通配代理

`ai_handler.go:96-173` `(*AiHandler).ProxyProviders`:

```
/api/v1/admin/providers           → /api/v1/admin/providers
/api/v1/admin/providers/credentials/X → /api/v1/admin/providers/credentials/X
```

代理前缀从 `c.Path()` 动态解析(`strings.TrimSuffix(strings.TrimSuffix(c.Path(), "*"), "/")`),不是硬编码。子路径用 `c.Request().URL.EscapedPath()` 透传**已编码**的串以防 `%2F` `%23` 注入。多级解码探测 `..` 路径穿越,命中拒绝。

### AI client(底层 HTTP wrapper)

`apps/server-go/internal/service/ai_client.go`:

| file:line | 符号 | 说明 |
| --- | --- | --- |
| `ai_client.go:17-21` | `AIClient` 结构 | 持 baseURL + 同步 client + 流式 client(共享 transport) |
| `ai_client.go:26-47` | `NewAIClient` | TCP 连接超时 5s, 同步读 5min, 流式读 30min |
| `ai_client.go:50-58` | `AIClientError` | StatusCode + Message,被 `mapStatusToError` 解开 |
| `ai_client.go:64-66` | `DoSync` | 提供给 `proxySyncRequest` `proxyGet` |
| `ai_client.go:72-74` | `DoStream` | 提供给 SSE / index-batch / qa / reindex |
| `ai_client.go:79-114` | `do` (内部) | 注 Authorization / X-Request-ID, 包装 ctx 取消 / 超时 / 网络错 |

## 3. 数据流

### 同步生成(POST /ai/summary)

```
Browser
  POST /api/v1/admin/ai/summary
  Authorization: Bearer <JWT>
  Content-Type: application/json
  Body: {"content":"...","maxLength":120,"style":"natural"}
       │
       ▼
Echo middleware chain
  Recovery → Trace(X-Request-ID) → CORS → JWTAuthWithStore
  → RequirePasswordRotated → RequireRole("admin")
       │
       ▼
runGeneration("summary", "/api/v1/ai/summary")  ai_handler.go:264
  ├── contentLen = c.Request().ContentLength
  ├── proxySyncPost(c, path)  →  proxySyncRequest(c, POST, path)
  │     │
  │     ▼ ai_handler.go:674-701
  │     body = c.Request().Body
  │     headers = proxyHeaders(c)
  │       · Authorization: Bearer <JWT>
  │       · X-Request-ID: ctxutil.TraceID(c)
  │     respBody, statusCode, err = client.DoSync(ctx, POST, path, body, headers)
  │     stashUpstreamStatus(c, statusCode)   ← 关键:写入真实上游状态
  │     parseAndRespond(c, respBody, statusCode)
  │       ├── 解析 ai-service 标准信封 {"success", "data", ...}
  │       └── 返回 R{} 包装的数据(HTTP 200 + 业务 code)
  │
  └── upstreamStatus = readUpstreamStatus(c)
      recordAIEvent("ai.generation.summary", "AI 生成 - 摘要",
        "POST /api/v1/ai/summary · 请求体 N B · 上游 HTTP 200", upstreamStatus)
        └── activitySvc.Create() → INSERT INTO activity_events
```

### 流式摘要 SSE

```
Browser
  POST /api/v1/admin/ai/summary/stream  (或 GET 通过 EventSource)
       │
       ▼
SummaryStream  ai_handler.go:317-378
  ├── client.DoStream(ctx, POST, "/api/v1/ai/summary/stream", body, headers)
  │     ↓
  │   ai-service: stream_chat(...) yield {"type":"delta","content":"..."}
  │
  ├── 上游 200 → 写「流式开始」审计
  │
  ├── 设置 SSE 响应头
  │     Content-Type: text/event-stream
  │     Cache-Control: no-cache
  │     X-Accel-Buffering: no       ← 让 nginx 不要缓冲
  │
  └── bufio.Scanner 逐行读 ai-service 响应
        for scanner.Scan():
          line := scanner.Text()
          if !validateSSELine(line): continue   ← 白名单丢弃未知 type
          fmt.Fprintf(w, "%s\n", line)
          flusher.Flush()
```

`validateSSELine` 白名单(`ai_handler.go:548-553`):

```go
allowedSSETypes = {
  delta, result, done, error,    // 通用 LLM 流
  start, progress,               // search profile reindex 专用
  think, sources,                // agent 多轮对话
}
```

非 `data:` 前缀行(空行 / `event:` / `id:` / 注释)直接放行;`data:` 行解 JSON 后取 `type` 字段,不在白名单或解析失败的丢弃并 `log.Warn`。

### Provider 通配代理(SSRF 防护要点)

参见 `ai_handler.go:103-118` 的注释,5 条防御要点:

1. 用 `c.Request().URL.EscapedPath()` 而非 `c.Param("*")` —— 后者已被 Echo URL-decode,会让 `%23` 还原成 `#` 被下游误解析。
2. 多级解码循环只用于探测 `..`,decode 失败 break 不升级 400(避免误杀合法 `100%25`)。
3. 前缀从 `c.Path()` 动态提取(`/api/v1/admin/providers/*` → 前缀 `/api/v1/admin/providers`)。
4. 保留 subPath 前导斜杠原样拼接,`/providers/` 与 `/providers` 区分透传。
5. body limit 5MB(MountProviders 时挂的 BodyLimit)。

## 4. DB 表 / 索引

### activity_events(审计落库)

migration `000022` 创建,000046 扩展 CHECK 约束:

```sql
CREATE TABLE activity_events (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,         -- "ai.generation.summary" 等
  event_category VARCHAR(32),              -- 见下方 CHECK
  title VARCHAR(255) NOT NULL,
  description TEXT,
  user_id BIGINT,
  ip VARCHAR(64),
  status VARCHAR(16),                      -- INFO/SUCCESS/WARNING/ERROR
  metadata JSONB,                          -- handler 故意不写
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- migration 000046:
ALTER TABLE activity_events ADD CONSTRAINT chk_activity_event_category
  CHECK (event_category IN ('post','comment','user','system','friend','media','ai','security'));

-- 状态约束 (chk_activity_event_status):
-- INFO / SUCCESS / WARNING / ERROR (没有 FAILED, 早期实现错把 FAILED 写进去过)
```

AI 模块统一写 `event_category='ai'`,`event_type` 形如 `ai.generation.summary` / `ai.task_create` / `ai.prompt_update` / `ai.provider_proxy_write` / `ai.agent_chat`。

### ai_pricing(价格表) — 通过 ai_models.capabilities 承载

价格来源不在独立 ai_pricing 表,而是 `ai_models.capabilities` JSONB 列。`apps/server-go/internal/repository/ai_pricing_repo.go` 里 `buildPricedLogsCTE` 用 `LATERAL` 子查询从 `ai_models.capabilities->'pricing'->'units'` 取 textInput / textOutput / textInput_cacheRead 单价,fallback 到 `m.input_cost_per_1k` / `m.output_cost_per_1k`。计算公式:

```
cost = ROUND(
  (CASE WHEN cached THEN cached_input_cost_per_1m ELSE input_cost_per_1m END * tokens_in
   + output_cost_per_1m * tokens_out) / 1_000_000,
  8
)
```

migration 增量在 `028_ai_pricing` / `029_ai_pricing_archive` / `030_ai_pricing_compat` 系列(详见模块四 `04-analytics-and-stats.md`)。

## 5. 配置 / 环境变量

| Env | 默认 | 含义 |
| --- | --- | --- |
| `AETHERBLOG_AI_BASE_URL` | `http://localhost:8000` | ai-service 入口,容器内通常 `http://ai-service:8000` |
| `AETHERBLOG_AI_CONNECT_TIMEOUT` | `5s` | TCP 连接超时 |
| `AETHERBLOG_AI_READ_TIMEOUT` | `5m` | 同步 LLM 读超时(与 nginx `/api/v1/ai/` proxy_read_timeout=600s 协调) |
| `AETHERBLOG_AI_STREAM_READ_TIMEOUT` | `30m` | SSE 整流持续上限，覆盖 Search Profile reindex 长任务 |
| `AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN` | (必填) | ≥32 字符,backend ↔ ai-service 信任令牌。`config.go:253-258` 强制非空且长度 ≥32,缺失则启动 fatal |

代码:`apps/server-go/internal/config/config.go:165-171, 346-352`。`InternalServiceToken` 在 `Mount` AI 端点时不直接注入 admin 的 `/ai/*` 代理(它们用用户 JWT 透传),只在 Agent / Search / 内部循环里注入(`X-Internal-Service` header)。

### Provider body limit

`ai_handler.go:31` 定义 `providerProxyBodyLimit = "5M"`,在 `MountProviders` 内挂 `echomw.BodyLimit("5M")`。`server.go:369` 又定义了一个 `providerProxyBodyLimit = "10M"` 用作 admin 整组挂载 BodyLimit —— **两个值不一致**,实际生效的是 group 上的 10M(因为 Echo 把 group 中间件先于 handler 中间件运行,group level 不到 10M,handler level 5M 没机会触发 413)。这个不一致并未造成安全问题(10M 仍远低于 admin 滥用门槛),但应在后续 PR 里统一到 5M。

## 6. 与其他模块耦合

| 调用方向 | 含义 |
| --- | --- |
| `ai_handler → ai_client` | 唯一 LLM 出口 |
| `ai_handler → activity_service` | 每次写操作 / LLM 调用产出一条审计 |
| `ai_handler → middleware.GetLoginUser` | 取 LoginUser.UserID 写审计的 user_id |
| `agent_handler → ai_client` | 复用同一 client 实例;但额外注入 `X-Internal-Service` |
| `search_handler → search_service → ai_client` | 语义搜索 / qa / reindex 全部经此 |
| `log_level_handler → ai_client` | 给 ai-service 推 log level |

## 7. 已知限制 / 待改进

### 7.1 prompt CRUD 没有写审计 metadata

`UpdatePrompt` `CreateTask` `UpdateTask` `DeleteTask` 都写了一条审计行,但 `metadata` JSONB 列空着。代码注释说「当前 ActivityRepo / 前端没有展示 metadata,多写了也只是字节占用」,但这意味着「admin 把 prompt 改坏了」之后定位变更 diff 必须翻 ai-service 自己的 prompt_versions 表。建议接入。

### 7.2 流式 SSE 中途异常不补审计

`SummaryStream` 在「上游 200,准备开流」时写一条 SUCCESS 审计;后续 SSE 行级转发若中途异常,只 `log.Warn`,不补审计行(代码注释说「否则一次会话最多 2 条 ai 事件,列表噪声大」)。结果就是「LLM 在第 5 行 chunk 之后吐出 token but timeout」时,审计仍是 SUCCESS,前端 UI 显示已完成 —— 用户看着不对劲但管理员排查不到。可考虑在 scanner.Err 非 nil 时升级到 WARNING。

### 7.3 ai_client 错误归一化太粗

参见 README §6.2。`do` 方法的三档分类(canceled/timeout/其他)无法区分:供应商 401(key 失效)、429(供应商限流)、5xx + 上下文取消(client side disconnect)。所有非超时错误最终落 `502 + "AI 服务不可用"`。事故复盘只能去 ai-service 翻日志。

### 7.4 5MB / 10MB BodyLimit 不一致

参见 §5。

### 7.5 Health 端点降级粒度低

`Health` (`ai_handler.go:461-477`) 只看「能不能 200」,不看具体 component(LiteLLM / DB / pgvector)。ai-service 自己有更详细的 `/health` 响应,这里降级成 `{"status":"DOWN"}` 一字段就丢了。

## 8. 测试覆盖

| 文件 | 覆盖内容 |
| --- | --- |
| `apps/server-go/internal/handler/ai_handler_test.go` (375 行) | `mapStatusToError` 三档(502 保留消息 / 500 兜底中文 / 504 不变 429); `handleClientError` 504 不被误映射; provider proxy URL 编码; 审计 fakeRecorder 记录;路径穿越拒绝 |
| 集成测试 | 没有(ai-service 的 contract 测试在 Python 侧 `apps/ai-service/tests/`) |

代码覆盖率以单元测试为主,流式 SSE 路径靠 ai-service 与 admin UI 的 e2e 验证。`apps/server-go/internal/handler/testutil/setup.go` 提供 NewEcho / DoAuthRequest / ParseResponse 三个 helper,所有 handler 测试共用。
