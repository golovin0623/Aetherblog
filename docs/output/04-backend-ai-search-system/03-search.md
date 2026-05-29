# 03 · 搜索 (search_handler / search_service / search_profiles)

## 1. 责任范围

模块四的搜索能力构建在 **关键词全文检索 (PostgreSQL tsvector)** 与 **语义向量检索 (pgvector,实际向量与 reindex 由 ai-service 持有)** 之上,通过 RRF (Reciprocal Rank Fusion) 融合两路结果。

`search_handler` / `search_service` 的边界:

- `search_service` 持有「双路并行 + RRF 合并 + 优雅降级」的核心编排逻辑。
- `search_handler` 持有「长任务并发锁 + cancel + lastBatch 缓存 + SSE profile reindex」的状态机。
- 实际的 `embedding 写入` `相似度 SELECT` `prompt 渲染` 全在 ai-service。Go 这边只发起 HTTP 调用并把结果聚合。

## 2. 关键代码入口

### Handler 方法

| file:line | 方法 | 端点 |
| --- | --- | --- |
| `apps/server-go/internal/handler/search_handler.go:105-134` | `Search` | `GET /v1/public/search` |
| `search_handler.go:137-186` | `QA` | `GET /v1/public/search/qa` SSE |
| `search_handler.go:189-196` | `Features` | `GET /v1/public/search/features` |
| `search_handler.go:199-202` | `GetConfig` | `GET /v1/admin/search/config` |
| `search_handler.go:212-233` | `UpdateConfig` | `PATCH /v1/admin/search/config` |
| `search_handler.go:207-209` | `Diagnostics` | `GET /v1/admin/search/diagnostics` |
| `search_handler.go:236-256` | `ListPostsEmbedding` | `GET /v1/admin/search/posts` |
| `search_handler.go:265-321` | `IndexBatch` | `POST /v1/admin/search/index-batch` |
| `search_handler.go:337-344` | `GetStats` | `GET /v1/admin/search/stats` |
| `search_handler.go:348-383` | `Reindex` | `POST /v1/admin/search/reindex` |
| `search_handler.go:386-416` | `RetryFailed` | `POST /v1/admin/search/retry-failed` |
| `search_handler.go:419-441` | `Cancel` | `POST /v1/admin/search/cancel` |
| `search_handler.go:444-457` | `LastBatch` | `GET /v1/admin/search/last-batch` |
| `search_handler.go:460-467` | `EmbeddingStatus` | `GET /v1/admin/search/embedding-status` |
| `search_handler.go:480-530` | `ProxyProfiles` | `Any /v1/admin/search/profiles[/*]` |
| `search_handler.go:541-682` | `proxyProfileStream` | profile SSE reindex 内部 |

### Service 方法

| file:line | 方法 | 用途 |
| --- | --- | --- |
| `apps/server-go/internal/service/search_service.go:52-103` | `GetSearchConfig` | 读 site_settings 的 search.* |
| `search_service.go:160-220` | `GetDiagnostics` | 一屏综合诊断 |
| `search_service.go:238-356` | `IndexBatchPosts` | 单批最多 100 篇,逐篇调 ai-service |
| `search_service.go:416-491` | `Search` | 关键词 + 语义并行 + RRF |
| `search_service.go:494-519` | `keywordSearch` | 委托 `postRepo.SearchPublished` |
| `search_service.go:539-573` | `semanticSearch` | HTTP 调 `/api/v1/search/semantic/internal` |
| `search_service.go:578-640` | `fusionRRF` | 倒数排名融合 |
| `search_service.go:646-687` | `ProxyQA` / `ProxySearchStats` / `ProxyReindex` / `ProxyRetryFailed` / `ProxyEmbeddingStatus` | ai-service 透传 |
| `search_service.go:691-708` | `ProxyProfileSync` / `ProxyProfileStream` | profile CRUD + SSE |

### 路由挂载

`apps/server-go/internal/server/server.go:269-279, 372-389`:

```go
// 公开
searchPublic := public.Group("/search")
searchPublic.GET("",         h.Search,   middleware.RateLimitByIP(rdb, "rate:search",          30, time.Minute))
searchPublic.GET("/features", h.Features, middleware.RateLimitByIP(rdb, "rate:search:features", 60, time.Minute))
searchPublic.GET("/qa",      h.QA,       middleware.RateLimitByIP(rdb, "rate:qa",              5,  time.Minute))

// 管理
searchAdmin := admin.Group("/search")
searchAdmin.GET("/config",            h.GetConfig)
searchAdmin.PATCH("/config",          h.UpdateConfig)
searchAdmin.GET("/diagnostics",       h.Diagnostics)
searchAdmin.GET("/stats",             h.GetStats)
searchAdmin.POST("/reindex",          h.Reindex)
searchAdmin.POST("/retry-failed",     h.RetryFailed)
searchAdmin.POST("/cancel",           h.Cancel)
searchAdmin.GET("/embedding-status",  h.EmbeddingStatus)
searchAdmin.GET("/posts",             h.ListPostsEmbedding)
searchAdmin.POST("/index-batch",      h.IndexBatch)
searchAdmin.GET("/last-batch",        h.LastBatch)
searchAdmin.Any("/profiles",          h.ProxyProfiles)
searchAdmin.Any("/profiles/*",        h.ProxyProfiles)
```

## 3. 数据流

### 3.1 双通路混合搜索(GET /v1/public/search)

```
Browser
  GET /api/v1/public/search?q=向量数据库&mode=hybrid&limit=10
       │
       ▼
RateLimitByIP(rate:search, 30/min)
       ▼
Search handler (search_handler.go:105)
  ├── q empty → 400
  ├── len(q) > 500 → 400 (VULN-053 长度封顶)
  ├── strconv.Atoi(limit) → 钳位 [1, 50] (VULN-046/050 严格解析)
  └── svc.Search(ctx, q, mode, limit)
        │
        ▼
SearchService.Search (search_service.go:416)
  cfg = GetSearchConfig(ctx)
  ┌─────────────── 并发 ───────────────┐
  │ goroutine 1                        │
  │   if cfg.KeywordEnabled:           │
  │     keywordSearch(ctx, q, limit)   │
  │       └── postRepo.SearchPublished │
  │            (本地 SQL ts_rank)       │
  │                                    │
  │ goroutine 2                        │
  │   if cfg.SemanticEnabled            │
  │      && aiClient != nil:           │
  │     semCtx, cancel = WithTimeout(  │
  │       ctx, SemanticTimeoutMs)      │
  │     semanticSearch(semCtx, q, limit)│
  │       └── aiClient.DoSync(GET,     │
  │            /api/v1/search/semantic/internal,
  │            X-Internal-Service)     │
  └─────────────── wg.Wait ──────────────┘

  semErr != nil → log.Warn + 降级到 keyword-only

  根据有无结果选 actualMode:
    kw + sem 都有  → "hybrid"  → fusionRRF(kw, sem, 60, limit)
    只有 sem      → "semantic"
    只有 kw       → "keyword"
    都没有        → mode 不变,空数组
```

### 3.2 keyword 路径

`keywordSearch` 委托 `postRepo.SearchPublished`。当前已经不是简单 `ts_rank + ILIKE` 兜底:repo 会做 CJK/ASCII/符号分词、中文问句派生词、LIKE 转义,并在标题、摘要、正文、分类、标签多字段召回后加权排序。000055 后 fulltext 派生文档还会 `left(..., 200000)`,避免超长 Markdown 触发 PG `SQLSTATE 54000`。

`SearchPublished` 已经过滤了 `deleted=false AND status='PUBLISHED' AND is_hidden=false`,但**没过滤** `password IS NOT NULL`。这是 agent_handler 必须二次过滤的原因(参见 02-agent-and-jobs.md §3)。public 搜索接口由于结果只返回 title/slug 而不返回 content,被部分认为可接受;但严格来说密码保护文章被列出来仍是信息泄露,应在后续 PR 修。

### 3.3 semantic 路径

`semanticSearch` (`search_service.go:539-573`) 调 ai-service 的 `/api/v1/search/semantic/internal?q=...&limit=N`,带 `X-Internal-Service` token。ai-service 内部:

1. 用当前 active profile 取 `model_id`、chunker 与维度。
2. 调 LiteLLM embed `q`,并以 `strict_embedding_model_id=True` 固定使用 profile 模型。
3. 按维度选择 `vector(D)` 或 `halfvec(3072)` cast,命中 partial HNSW。
4. 查询 active `post_embeddings`,过滤已删除、未发布、隐藏和密码保护文章。
5. 返回 `{post:{id,title,slug}, similarity, highlight}`。

这条 strict 约束很重要:模型禁用、凭据缺失或 routing 不可用时,ai-service 不会静默落到默认 embedding 模型。Go hybrid 搜索会把语义错误降级为 keyword-only 并记录 warn,但 Admin 诊断/重建文档必须按 profile 模型失败来排障。

Go 这边解析后映射成 `dto.SearchResultItem{Source:"semantic"}`。

### 3.4 RRF 融合

`fusionRRF(kwResults, semResults, k=60, limit)` (`search_service.go:578-640`):

```
score(post) = Σ 1/(k + rank_in_each_list + 1)
            kw 命中 + 1/(60 + kw_rank + 1)
            sem 命中 + 1/(60 + sem_rank + 1)

按 score desc 排,取前 limit。

Source badge:
  inKw && inSem  → "hybrid"
  仅 inSem       → "semantic"
  仅 inKw        → "keyword"
```

`k=60` 是 RRF 经典超参,平衡 list 长度差异。Highlight 优先取关键词的 (因为关键词 highlight 命中字面量),关键词为空时回退到语义返回的 highlight。

### 3.5 search profile 蓝绿切换

参见 migration `000041` 与 `000044`:

```
profile A (active)  ───────────┐
                              │  reindex 读取
post_embeddings (profile_id=A)─┘

新建 profile B (status=shadow)
  ↓ POST /v1/admin/search/profiles/B/reindex/stream  (SSE)
  ai-service 按 B 的 chunker_kind / size / overlap 切片
  对每篇文章嵌入,写入 post_embeddings (profile_id=B, status=shadow)
  000056 后可按 chunk_hash/chunk_count 复用已有 shadow/deprecated chunk

完成后管理员点「激活」:
  PATCH /v1/admin/search/profiles/B/activate
  事务内:
    UPDATE search_profiles SET status='deprecated' WHERE status='active'
    UPDATE search_profiles SET status='active' WHERE id=B
    UPDATE site_settings SET setting_value='B' WHERE setting_key='search.active_profile_code'
    UPDATE site_settings SET setting_value=<B.model_id> WHERE setting_key='search.active_embedding_model'

  现在新搜索请求看到 active_profile_code=B,自动用 profile B 的向量

故障场景:
  发现 B 召回质量不好 → 反向激活 A,删除 profile B 与对应 embeddings
```

`search_handler.proxyProfileStream` 处理这个 SSE 流(详见 02-agent-and-jobs.md §7.5)。当前 SSE 不只有 `start/progress/result/done/error`,还包含 `heartbeat` 与 `chunk_progress`,Admin `useReindexStream` 会展示 in-flight chunk 进度并支持失败后按 profileCode retry。

## 4. DB 表 / 索引

### search_profiles (migration 000041)

```sql
CREATE TABLE search_profiles (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    model_id VARCHAR(120) NOT NULL,
    chunker_kind VARCHAR(32) NOT NULL
        CHECK (chunker_kind IN ('recursive', 'fixed', 'markdown', 'qa', 'parent_child')),
    chunk_size_tokens INT NOT NULL DEFAULT 512
        CHECK (chunk_size_tokens > 0 AND chunk_size_tokens <= 8192),
    chunk_overlap_tokens INT NOT NULL DEFAULT 64
        CHECK (chunk_overlap_tokens >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'shadow'
        CHECK (status IN ('active', 'shadow', 'deprecated')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (chunk_overlap_tokens < chunk_size_tokens)
);

CREATE INDEX idx_search_profiles_status ON search_profiles (status);
CREATE UNIQUE INDEX uq_search_profiles_one_active
    ON search_profiles ((1)) WHERE status = 'active';   -- partial unique:同一时刻只能一行 active
```

### post_embeddings 演进

migration `000034` 引入版本化向量(蓝绿模型切换),`000041` 把维度从 `model_id` 推广到 `profile_id` 整组,`000044` 加 `parent_text` 列。当前形状:

```sql
ALTER TABLE post_embeddings
    ADD COLUMN profile_id BIGINT REFERENCES search_profiles(id) ON DELETE CASCADE,
    ADD COLUMN chunk_index INT NOT NULL DEFAULT 0,
    ADD COLUMN chunk_text TEXT,
    ADD COLUMN parent_text TEXT;   -- 仅 parent_child chunker 有值

ALTER TABLE post_embeddings DROP CONSTRAINT post_embeddings_post_id_model_id_key;
ALTER TABLE post_embeddings ADD CONSTRAINT post_embeddings_unique
    UNIQUE (post_id, profile_id, chunk_index);

CREATE INDEX idx_post_emb_profile_status ON post_embeddings (profile_id, status);
```

存量行被 backfill 到 `default` profile (`chunk_index=0`, `chunk_text=NULL`),admin UI 显示提示「建议 reindex 以应用新切片策略」。

### site_settings 搜索相关 key

| key | 默认 | 类型 | migration |
| --- | --- | --- | --- |
| `search.keyword_enabled` | `true` | bool | 早期 |
| `search.semantic_enabled` | `false` | bool | 早期 |
| `search.ai_qa_enabled` | `false` | bool | 早期 |
| `search.anon_search_rate_per_min` | `10` | int | 早期(未生效见 §8.1) |
| `search.anon_qa_rate_per_min` | `3` | int | 早期(未生效见 §8.1) |
| `search.auto_index_on_publish` | `true` | bool | 早期 |
| `search.index_post_timeout_sec` | `180` | int | `000032_search_index_timeout` |
| `search.semantic_timeout_ms` | `3000` | int | 后续 |
| `search.active_embedding_model` | (空) | string | `000034` 引入,`000037` 修复指针 |
| `search.active_profile_code` | `default` | string | `000041` |

## 5. 配置 / 环境变量

| 来源 | key | 含义 |
| --- | --- | --- |
| Env | `AETHERBLOG_AI_BASE_URL` | semantic / qa / reindex 都打这里 |
| Env | `AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN` | semantic / qa / profile 通配代理都用 |
| site_settings | `search.semantic_timeout_ms` | hybrid 模式下语义路径单独超时,默认 3000ms |
| site_settings | `search.index_post_timeout_sec` | 单篇 index 超时,默认 180s |
| 硬编码 | `rate:search 30/min IP` | server.go:277 |
| 硬编码 | `rate:qa 5/min IP` | server.go:279 |
| 硬编码 | `IndexBatch limit 100` | search_handler.go:273 |
| 硬编码 | `30 minute timeout` | search_handler.go:292 等 |

## 6. 与其他模块耦合

| 耦合 | 形式 |
| --- | --- |
| `search_service → postRepo` | 关键词查 / FindByIDs / Mark*(failed/pending) |
| `search_service → siteSettingService` | 实时读 search.* 配置 |
| `search_service → aiClient` | semantic / qa / index / profile reindex 全部经此 |
| `search_handler ↔ ai_handler.validateSSELine` | SSE 白名单 + sseEvent 类型共用 |
| `search_handler.reindexing 锁` ↔ profile reindex | 同一 atomic.Bool,profile reindex 也走这把锁 |
| 限流 redis key `rate:search` `rate:qa` `rate:search:features` | 不与其他模块冲突 |

## 7. 已知限制 / 待改进

### 7.1 限流值无法从 site_settings 实时生效

`server.go:273-279` 注释:

> 此处的限流值(搜索 30/min、问答 5/min)目前是硬编码,因为限流中间件在启动阶段就要注册,而那时数据库里的配置还未读出。考虑改为请求时动态读取 search 配置(`search.anon_search_rate_per_min`、`search.anon_qa_rate_per_min`)实现可调限流。

结果:`site_settings.search.anon_search_rate_per_min` 等配置项**完全无效**。前端面板可以改但实际不变。

### 7.2 keyword search 没过滤密码保护文章

`postRepo.SearchPublished` 不过滤 `password IS NOT NULL`。结果集里 title/slug 仍会暴露密码保护文章的存在。应在 SQL WHERE 里加 `password IS NULL`,或在 `keywordSearch` 后做二次过滤(类似 agent_handler 的 `filterPublicArticleIDs`)。

### 7.3 semantic 静默降级,用户无感知

如果 ai-service 挂了 / `aiClient==nil` / `active_embedding_model` 未设,`Search` 自动降级到 keyword-only,用户在 UI 上看不到任何提示。`Diagnostics` 端点能解释,但前端没有强制展示。建议在 `dto.SearchResponse` 里加 `degraded bool` + `degradedReason string`,前端检测到时显示一条 banner。

### 7.4 IndexBatch 100 篇上限是硬编码

`search_handler.go:273-275`:`if len(req.PostIDs) > 100 { return 400 }`。批量重建 1000 篇文章时管理员必须分 10 次点 batch + 等 30 分钟。建议从 `site_settings` 读上限,或允许更大批次。

### 7.5 profile reindex SSE 没有 keepalive

参考 migration_handler 那边每 15s 写一行 `: heartbeat`,但 search profile reindex 没有。如果 ai-service 切片很慢(几分钟单批),nginx 默认 60s 空闲就会断 → SSE 卡住。当前依赖 ai-service 自己定期 emit `progress` 事件,但这不是强制约定。

### 7.6 Stats 接口完全代理给 ai-service

`GetStats` (`search_handler.go:337-344`) 透传 `/api/v1/admin/search/stats`,Go 这边只在 ai-service 不可用时给一句 `"AI 服务不可用"`。如果 ai-service 已经返回数据但其中某些字段(总文档数 / 索引中数)与 Go DB 实际行数不一致(因为 ai-service 自己也读 PG),管理员看不出来到底哪一边在说谎。

### 7.7 AI Pricing CTE SQL 复杂

`apps/server-go/internal/repository/ai_pricing_repo.go` 的 `buildPricedLogsCTE`(参见 04-analytics-and-stats.md)和搜索看似无关,但它共享同一个 ai-service 用量统计基础。SQL 350 行长,任何字段或单价含义变化都很容易引发回归。建议加 SQL 单元测试 / 物化视图。

## 8. 测试覆盖

| 文件 | 覆盖内容 |
| --- | --- |
| `apps/server-go/internal/handler/search_handler_test.go` (98 行) | PATCH `/api/v1/admin/search/config` 路由能注册;`PATCH settings/batch` 能 bind `map[string]string` |
| 没有 `search_service_test.go` | RRF 融合 / hybrid 降级 / Diagnostics 计算逻辑都没有单元测试 |
| 没有长任务 unit test | `reindexing` 互斥锁、cancel 流程、lastBatch 仅 in-memory 验证 |
| ai-service 自己有 `tests/test_search.py` `tests/test_search_profiles.py` | semantic 召回正确性、profile 蓝绿切换的端到端 |

`apps/server-go/internal/repository/ai_pricing_repo_test.go` (43 行) 主要是 `splitCSVFields` 这种纯函数测试,SQL CTE 没有 SQL-level 测试。
