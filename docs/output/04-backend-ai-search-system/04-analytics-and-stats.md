# 04 · 数据统计 / 活动审计 / AI 用量

## 1. 责任范围

模块四的「事后观测」层包含三个相对独立的子能力,通过 `AnalyticsService` / `ActivityService` 联动:

1. **仪表盘统计** —— 文章 / 评论 / 浏览量 / 访客 / 设备分布 / 月度环比。覆盖 admin 首页综合 KPI。
2. **AI 用量统计 + 费用归档** —— 按任务类型、模型、时间范围聚合 ai_usage_logs。展示 token / cost / 成功率,并支持「按当前价格表归档」让历史费用快照固化。
3. **活动审计** —— `activity_events` 表是系统所有「写操作」的统一审计层。任何 admin 改文章 / 改设置 / 调 LLM / 改 JWT 密钥都落一行,前端 `/activities` 页提供分类筛选。

`visitor_handler` (见 06-misc-handlers.md) 是数据进表的入口;本模块负责出口。

## 2. 关键代码入口

### Stats handler

| file:line | 端点 | 描述 |
| --- | --- | --- |
| `apps/server-go/internal/handler/stats_handler.go:74-158` | `GET /v1/admin/stats/dashboard` | 一屏全量(stats + topPosts + visitorTrend + archiveStats + deviceStats + trends),失败降级到零值 |
| `stats_handler.go:162-168` | `GET /v1/admin/stats/top-posts` | 浏览量 top 10 |
| `stats_handler.go:173-186` | `GET /v1/admin/stats/visitor-trend?days=30` | PV/UV 每日趋势 |
| `stats_handler.go:190-196` | `GET /v1/admin/stats/archives` | 按月归档计数 |
| `stats_handler.go:202-211` | `GET /v1/admin/stats/ai-dashboard` | AI 用量综合(7 维过滤) |
| `stats_handler.go:215-222` | `GET /v1/admin/stats/ai-pricing-gaps` | 缺价格配置的模型 |
| `stats_handler.go:226-249` | `POST /v1/admin/stats/ai-cost-archive` | 按当前价格冻结历史费用 |

### Activity handler

| file:line | 端点 | 描述 |
| --- | --- | --- |
| `activity_handler.go:33-39` | `GET /v1/admin/activities/recent` | 最近 10 条 |
| `activity_handler.go:49-89` | `GET /v1/admin/activities` | 分页 + 7 维过滤(category/eventType/status/search/userId/start/end) |
| `activity_handler.go:93-104` | `GET /v1/admin/activities/user/:userId` | 指定用户的活动 |

### Visitor handler

| file:line | 端点 | 描述 |
| --- | --- | --- |
| `visitor_handler.go:39-71` | `POST /v1/public/visit` | 异步记录 + 60/min IP 限流 |
| `visitor_handler.go:75-81` | `GET /v1/public/visit/today` | 今日访问总数 |

### Service / Repo

| file | 行数 | 责任 |
| --- | --- | --- |
| `apps/server-go/internal/service/analytics_service.go` | 616 | DTO 映射 + GetDashboard / GetTrends / GetDeviceStats / GetAIDashboard / RecordVisit |
| `apps/server-go/internal/service/activity_service.go` | 151 | GetRecent / GetForAdmin / GetByUser / Create + 批量回填 user 引用 |
| `apps/server-go/internal/repository/analytics_repo.go` | 535 | 站点统计 + AI 仪表盘 + AI 费用归档 SQL |
| `apps/server-go/internal/repository/activity_repo.go` | 150 | activity_events CRUD + ActivityFilter WHERE 构建 |
| `apps/server-go/internal/repository/ai_pricing_repo.go` | 355 | AIPricingGap + ArchiveAICosts CTE SQL |

### 路由挂载

`server.go:330-339`:

```go
analyticsRepo := repository.NewAnalyticsRepo(s.DB)
analyticsSvc := service.NewAnalyticsService(analyticsRepo)
handler.NewStatsHandler(analyticsSvc).Mount(admin.Group("/stats"))
handler.NewActivityHandler(activitySvc).Mount(admin.Group("/activities"))
handler.NewVisitorHandler(analyticsSvc).Mount(
    public.Group("/visit", middleware.RateLimitByIP(s.Redis, "rate:visit", 60, time.Minute)),
)
```

## 3. 数据流

### 3.1 仪表盘聚合

`Dashboard` (`stats_handler.go:74`):

```
GET /api/v1/admin/stats/dashboard
       │
       ▼
1) GetDashboard(ctx)
     SELECT COUNT/SUM 跑 10 条独立 SQL,聚合到 DashboardData
     失败 → return 500

2) GetTopPosts(ctx)            失败 → topPosts = []
3) GetVisitorTrend(ctx, 7)     失败 → visitorTrend = []
4) GetArchiveStats(ctx)        失败 → archiveStats = []
5) GetAIDashboard(ctx)         失败 → aiTokens=0, aiCost=0  (非阻塞)
6) GetTrends(ctx)              失败 → trendsMap = 全 0
7) GetDeviceStats(ctx)         失败 → deviceStats = []

返回综合 JSON:
{
  "stats": { posts, categories, tags, comments, views, visitors,
             totalWords, aiTokens, aiCost },
  "topPosts": [...],
  "visitorTrend": [...],
  "archiveStats": [...],
  "deviceStats": [...],
  "trends": { posts, categories, views, visitors, comments, words, postsThisMonth }
}
```

「软失败」是刻意设计:Dashboard 是首页,任一子查询失败不应让整页崩。但**只有 1) 是硬失败**(没有文章数 = 仪表盘没意义)。

### 3.2 AI 用量统计

`AIDashboard` (`stats_handler.go:202`):

支持 7 维过滤:`days / pageNum / pageSize / taskType / modelId / success / keyword`。

核心 SQL 在 `repository.GetAIDashboardFiltered` → `buildPricedLogsCTE`(`ai_pricing_repo.go:103-265`)。CTE 结构:

```sql
WITH priced_logs AS (
  SELECT
    l.id, l.task_type, l.provider_code, l.model_id, l.tokens_in, l.tokens_out,
    l.created_at,
    matched.model_db_id, matched.display_name,
    pricing.missing_fields,
    -- cost 表达式优先级:
    --   1) cost_archive_status = 'archived' → 用 cost_archive_amount (历史快照)
    --   2) pricing_missing → NULL
    --   3) 否则按 ai_models.capabilities->'pricing' 实时算
    cost_expr AS cost,
    cost_status_expr AS cost_status,        -- 'archived' / 'realtime' / 'missing'
    pricing.pricing_missing,
    archive_error_expr AS archive_error
  FROM ai_usage_logs l
  LEFT JOIN LATERAL (...)  matched   -- 关联 ai_models / ai_providers
    ON TRUE
  CROSS JOIN LATERAL (...)  pricing  -- 计算 missing_fields(textInput / textOutput / cachedInput)
  WHERE <过滤条件>
)
```

LATERAL 的优势是「按 model_id + provider_code 精确匹配」 + 「找不到时降级到 model_id 兼容匹配」,优先级排序 `ORDER BY CASE WHEN p.code = l.provider_code THEN 0 ELSE 1 END`。

### 3.3 AI 费用归档

`ArchiveAICosts` (`ai_pricing_repo.go:318-355`) 跑一次「按当前价格表 UPDATE 历史日志」:

```sql
WITH priced_logs AS (...)
, updated AS (
  UPDATE ai_usage_logs target
  SET cost_archive_status = CASE WHEN priced_logs.pricing_missing THEN 'failed' ELSE 'archived' END,
      cost_archive_amount = CASE WHEN priced_logs.pricing_missing THEN NULL ELSE priced_logs.cost END,
      cost_archived_at    = CASE WHEN priced_logs.pricing_missing THEN NULL ELSE NOW() END,
      cost_archive_error  = CASE WHEN priced_logs.pricing_missing THEN priced_logs.missing_fields ELSE NULL END
  FROM priced_logs
  WHERE target.id = priced_logs.id
  RETURNING ...
)
SELECT COUNT(*), COUNT(... archived), COUNT(... failed) FROM updated
```

`hasAICostArchiveColumns` 在执行前检查 schema 里有没有 `cost_archive_*` 4 列(它们由后续 migration 加,不在 000001 创表时就有)。缺则 return `ErrAICostArchiveSchemaMissing`,handler 翻译成「请先执行迁移」。

### 3.4 活动审计

每条记录:

```go
ActivityEvent{
    ID:            <自增>,
    EventType:     "ai.generation.summary" | "post.create" | "system.setting_update" | ...,
    EventCategory: "ai" | "post" | "comment" | "user" | "system" | "friend" | "media" | "security",
    Title:         "AI 生成 - 摘要",
    Description:   "POST /api/v1/ai/summary · 请求体 240 B · 上游 HTTP 200",
    UserID:        <写入触发用户 id>,
    IP:            <c.RealIP()>,
    Status:        "INFO" | "SUCCESS" | "WARNING" | "ERROR",
    CreatedAt:     NOW(),
}
```

写入由各 handler 自己显式调用 `activitySvc.Create(ctx, evt)`,故意不放 middleware 自动写。原因:不同业务对「写不写、写什么 EventType / Description」需求差异巨大,middleware 没法兼顾。

读取走 `ActivityFilter`(`activity_repo.go:21-36`)+ `buildActivityWhere` 动态拼 WHERE,支持 `category / eventType / status / search(title/description ILIKE) / userId / startTime / endTime / pagination`。

`enrichUserRefs`(`activity_service.go:91-125`)做批量 user 回填:先去重 userId,再逐个 `userRepo.FindByID`,组装 `User: {id, username, nickname, avatar}` 嵌入到每个 VO。

> ⚠️ N+1 隐患:`enrichUserRefs` 是「逐个 FindByID」,不是 `WHERE id = ANY($1)`。activities 列表 20 条不同用户就是 20 次 SQL。可改成 batch SELECT。

### 3.5 访问记录

`POST /v1/public/visit`:

```go
RecordVisit(ctx, pageURL, pageTitle, ip, ua, referer)
  go func() {
    hash := SHA-256(ip + ua)             // 访客指纹
    deviceType, browser, osName := parseUserAgent(ua)
    repo.RecordVisit(context.Background(), v)   // 用 Background context 防请求 ctx 取消
  }()
```

刻意「即发即忘 + 独立 Background context」。请求 handler 立即 200,不等 INSERT 完成。

## 4. DB 表 / 索引

### activity_events

```sql
-- migration 000022
CREATE TABLE activity_events (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  event_category VARCHAR(32),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  user_id BIGINT REFERENCES users(id),
  ip VARCHAR(64),
  status VARCHAR(16),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_activity_events_created_at ON activity_events (created_at DESC);
CREATE INDEX idx_activity_events_user_id ON activity_events (user_id);
CREATE INDEX idx_activity_events_event_type ON activity_events (event_type);

-- migration 000046:
ALTER TABLE activity_events DROP CONSTRAINT chk_activity_event_category;
ALTER TABLE activity_events ADD CONSTRAINT chk_activity_event_category
    CHECK (event_category IN ('post','comment','user','system','friend','media','ai','security'));
```

`status` 列也有 CHECK,允许值 `INFO/SUCCESS/WARNING/ERROR`。**早期实现错把 `FAILED` 写进去会被 CHECK 静默拒绝、审计行直接丢**(参见 ai_handler.go:175-189 的注释教训)。

### visit_records

```sql
-- migration 000005 / 000006 演进
CREATE TABLE visit_records (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT,
  page_url VARCHAR(2048) NOT NULL,
  page_title VARCHAR(256),
  visitor_hash VARCHAR(64) NOT NULL,
  ip VARCHAR(64),
  user_agent TEXT,
  device_type VARCHAR(16),
  browser VARCHAR(32),
  os VARCHAR(32),
  referer VARCHAR(2048),
  session_id VARCHAR(64),
  duration INT,
  is_bot BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_visit_records_created_at ON visit_records (created_at);
CREATE INDEX idx_visit_records_visitor_hash ON visit_records (visitor_hash);
```

⚠️ 表无 partition 无 TTL。详见 README §6.5。

### ai_usage_logs (AI 用量基础表)

由更早的 migration 创建 + 多个 `add ai_pricing` migration 增量加列。当前形状(关键列):

```sql
CREATE TABLE ai_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  task_type VARCHAR(32),
  provider_code VARCHAR(32),
  model VARCHAR(120),
  model_id VARCHAR(120),
  tokens_in INT,
  tokens_out INT,
  total_tokens INT,
  latency_ms INT,
  success BOOLEAN,
  cached BOOLEAN,
  error_code VARCHAR(64),
  -- 后续 migration 加(归档支持):
  cost_archive_status VARCHAR(16),     -- 'pending' / 'archived' / 'failed'
  cost_archive_amount NUMERIC(12,8),
  cost_archived_at TIMESTAMPTZ,
  cost_archive_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

实际写入由 ai-service 自己负责 (LiteLLM 完成响应回调里 INSERT)。Go backend 不写,只读。

## 5. 配置 / 环境变量

无统计模块专用配置。Dashboard 数据全是实时 SELECT,不缓存。activity_events 写入由各 handler 控制是否传 `activitySvc`(server.go 一律传)。

## 6. 与其他模块耦合

| 调用方 | 写入 EventType |
| --- | --- |
| `ai_handler` | `ai.generation.<task>` `ai.task_create/update/delete` `ai.prompt_update` `ai.provider_proxy_write` |
| `agent_handler` | `ai.agent_chat` |
| `auth_handler` | `user.login` `user.logout` `user.password_change` `security.jwt_secret_rotate` |
| `post_handler` | `post.create/update/delete/publish` |
| `comment_handler` | `comment.create/approve/spam` |
| `media_handler` | `media.upload/delete/folder_create` |
| `friend_link_handler` | `friend.create/delete` |
| `site_setting_handler` | `system.setting_update` |
| `migration_handler` | `system.migration_executed`(由 service 内部 LogMigrationSummary) |

`AnalyticsService.RecordVisit` 是单向反向:visitor_handler 写,stats_handler 读。

## 7. 已知限制 / 待改进

### 7.1 enrichUserRefs N+1

参见 §3.4 末尾。20 条 activity 来自 20 个不同用户 = 20 次 SQL。改 batch SELECT。

### 7.2 visit_records 无 TTL

参见 README §6.5。需要定期清理或转 partition。

### 7.3 metadata JSONB 列未利用

`activity_events.metadata` JSONB 列在 schema 里存在,但所有 handler 都不写(代码注释「当前 ActivityRepo / 前端没有展示 metadata,多写了也只是字节占用」)。结果是「post 改了什么字段」之类细粒度 diff 完全丢了。

### 7.4 AI Pricing CTE 维护成本

`buildPricedLogsCTE` 是 350 行 SQL 字符串,有两个版本(`supportsCostArchive` true/false)分支。任何价格字段 schema 变化都要同时改两份。建议物化为 PG view,Go 这边只 SELECT view。

### 7.5 GetTrends 月度环比的「上个月」定义模糊

`pctChange(current, previous)` 直接除前值,没有日历对齐。如果 5月8日 跑 trends,「本月」是 5/1-5/8 共 8 天,「上月」如果是「30 天前到本月初」就是 29 天。两段时间窗口不等长,环比数字会失真。建议改成「日历上月完整 N 天 vs 本月已过 N 天」。

### 7.6 parseUserAgent 是纯字符串匹配

`analytics_service.go:434-483` 没用 ua-parser 库,手撸的 switch-case 检测 `chrome/firefox/edge/safari` + `windows/macos/linux/android/ios`。新版 Brave / Vivaldi / Yandex 全部归到 "Other"。这影响 deviceStats 的真实度。

### 7.7 ArchiveAICosts 不可重做

一旦把 `cost_archive_status` 设成 `archived`,后续无论价格表怎么改,这条记录的费用都是冻结的。如果管理员发现归档时价格表有误想重算,需要先 `UPDATE ai_usage_logs SET cost_archive_status='pending', cost_archive_amount=NULL`。没有 UI 提供「反归档」。

## 8. 测试覆盖

| 文件 | 覆盖内容 |
| --- | --- |
| `apps/server-go/internal/handler/stats_handler_test.go` (430 行) | Dashboard 各分支、AIDashboard 过滤、AICostArchive 请求体解析、parseAIDashboardFilter |
| `apps/server-go/internal/repository/ai_pricing_repo_test.go` (43 行) | `splitCSVFields` 纯函数测试 |
| 没有 `analytics_repo_test.go` | 10+ SQL 查询无 SQL-level 单测,依赖端到端 |
| 没有 `activity_repo_test.go` / `activity_service_test.go` | enrichUserRefs / WHERE 拼装无 unit test |
| 没有 `visitor_handler_test.go` | RecordVisit 异步逻辑无验证 |
