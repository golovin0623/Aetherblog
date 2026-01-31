# AI 模块计划 v2（独立 AI 服务）

状态：拟定  
负责人：AetherBlog 团队  
更新时间：2026-01-28  

## 目标
- AI 作为独立服务，负责模型调用、RAG、Prompt 管理与流式输出。
- 主后端不引入 Spring AI。
- 尽量保持与设计文档一致的对外 API 契约。
- 可快速切换/扩展模型供应商，不影响主后端。

## 非目标
- 重写现有博客业务服务。
- 替换现有认证与授权逻辑。

## 关键约束
- AI 服务必须独立于 Spring Boot。
- 主后端不得引入 Spring AI。
- API 路径需与设计文档对齐。
- 流式接口需支持鉴权，不依赖 EventSource 头部能力。

## 容量与水平扩展目标（v2）
- 目标并发：2000
- 峰值吞吐：5000 请求/分钟（≈ 83 RPS）
- 平均耗时：非流式 9s / 流式 1.5s
- 单实例规格：8 核 / 16G
- 实例估算（保守）：
  - 非流式并发预算：250–350 / 实例
  - 流式并发预算：300–450 / 实例
  - 按 2000 并发 → 6–8 实例，预留 30% 冗余 → 8–10 实例
- 扩展策略：
  - AI 服务无状态多副本 + Nginx/LB 分流
  - Redis 全局限流（用户级/全局级）与缓存
  - 供应商并发与速率限制，防止 429 雪崩
  - 以 CPU、活跃连接数、P95 时延作为自动扩缩容指标

## 水平扩展实施（落地）
- Docker Compose（生产环境）支持多副本：
  - `docker-compose -f docker-compose.prod.yml up -d --scale ai-service=8`
- Nginx 通过 Docker DNS 解析多实例（已配置 resolver + resolve）
- 指标驱动扩缩容（后续可接入 HPA / KEDA）

## 本地启动与调试（包含 AI 服务）
- 一键启动（默认不启动中间件）：
  - `./start.sh` 或 `./start.sh --gateway`
- 如需同时启动中间件（PostgreSQL/Redis/ES）：
  - `./start.sh --with-middleware`
- 一键停止（包含 AI 服务）：
  - `./stop.sh`（仅停止应用服务）
  - `./stop.sh --all`（含中间件）
- AI 服务默认端口：`8000`
- AI 服务日志：`logs/ai-service.log`

## 架构概览

```
浏览器（Admin UI）
  |
  |  /api/v1/ai/* (JWT)
  |  /api/v1/search/semantic
  v
网关（Nginx）
  |            \
  |             \--> AI 服务（FastAPI + LiteLLM）
  |
  \--> Spring Boot（blog-service）

网关路由（Nginx）：
- `/api/v1/ai/*`、`/api/v1/search/semantic`、`/api/v1/admin/search/*` -> AI 服务

AI 服务
  - LiteLLM 路由模型供应商
  - RAG + pgvector
  - Prompt 管理
  - Redis 缓存与限流
```

## 实践计划（提交审阅版）

Phase 0：工程骨架与运行形态  
- 创建 `apps/ai-service` 骨架（FastAPI + Uvicorn + LiteLLM）  
- 配置体系（env/secret/配置分层）  
- 基础健康检查：`/health`、`/ready`  

Phase 1：核心架构层  
- API 层 + Service 层 + Provider 适配层  
- 鉴权中间件（JWT HMAC/JWKS）  
- Redis 缓存与限流  
- 统一错误处理与结构化日志  

Phase 2：核心业务接口  
- `/api/v1/ai/summary|tags|titles|polish|outline`  
- `/api/v1/ai/summary/stream`（NDJSON）  
- Prompt 版本兼容参数  

Phase 3：语义检索  
- 向量表迁移（pgvector）  
- 索引构建（异步队列）  
- `/api/v1/search/semantic`  

Phase 4：可观测性与稳定性  
- 基础指标：QPS/延迟/错误率/供应商失败率  
- 请求链路 requestId  
- 熔断 + 降级策略  

Phase 5：生产级容量与韧性  
- 多实例扩展策略（8–10 实例起步）  
- 供应商并发控制与自动切换  
- 成本治理（缓存/配额/输入截断）  

## 后端对接接口层（简要）

Spring Boot 新增 `AiServiceClient`（接口）+ `AiServiceHttpClient`（实现），统一封装 AI 服务调用。  
接口层契约保持与 AI 服务一致，DTO 与错误码统一定义。

- 鉴权：前端携带 Spring Boot 签发的 JWT 直连 AI 服务  
- 业务调用：后端 WebClient 调用 AI 服务 API  
- 错误码：`AI_RATE_LIMITED` / `AI_PROVIDER_UNAVAILABLE` / `AI_TIMEOUT` / `AI_VALIDATION_FAILED`  
- 流式：`application/x-ndjson`，事件 `delta/done/error`  
- 索引触发：`POST /api/v1/admin/search/index`（主动）/ `POST /api/v1/admin/search/reindex`（被动）  

## 当前进度
- Phase 0：已完成（`apps/ai-service` 骨架、健康检查、配置与运行形态）  
- Phase 1：已完成（JWT 鉴权、限流、缓存、日志中间件）  
- Phase 2：已完成（核心 AI API + NDJSON 流式接口）  
- Phase 3：已完成（pgvector 向量表 + 语义检索 API + 索引触发接口）  
- Phase 4：已完成（使用统计 + 成本控制 + 管理指标接口）  
- Phase 5：已完成（水平扩展策略落地与网关支持）  

## 技术选型
- 语言：Python 3.12
- Web 框架：FastAPI + Uvicorn
- 模型路由：LiteLLM（OpenAI/Claude/Gemini/兼容供应商）
- RAG 组件：LlamaIndex（仅 RAG 场景引入）
- 向量数据库：PostgreSQL 17 + pgvector
- 缓存/限流：Redis 7
- 可观测性：OpenTelemetry（可选）

说明：Python 生态 AI 工具最成熟，迭代效率高，供应商支持最广。

## 首批供应商与模型清单（已确认）

### 1) OpenAI / Anthropic / Google (2026 主力)
- **GPT 套件**  
  - `gpt-5.2`：核心写作、精细润色  
- **Claude 套件**  
  - `claude-sonnet-4-5-thinking`：深度思维、逻辑推理  
  - `claude-haiku-4-5-20251001`：智能标签、快速反应  
- **Gemini 套件**  
  - `gemini-3-flash-preview`：海量上下文摘要、极速检索  
  - `gemini-3-pro-preview`：大纲生成、结构化布局

### 2) OpenAI 协议兼容供应商（可插拔）
- 通过 LiteLLM 统一接入，作为成本或容灾通道。
- 默认不作为主力模型，仅用于非关键任务或 A/B。

### 3) Claude（建议用途）
- 建议用于：内容润色、长文改写、标题优化等高质量文本任务。
- 推荐模型：`claude-3.5-sonnet`（质量）、`claude-3.5-haiku`（速度/成本）
- Embedding 暂不由 Claude 承担。

### 4) Gemini（建议用途）
- 建议用于：长文大纲、长文摘要、翻译等长上下文任务。
- 推荐模型：`gemini-1.5-pro`、`gemini-1.5-flash`
- Embedding 预留 `text-embedding-004` 作为备选，但首批不启用。

### 推荐路由（示例）
- `ai.summary.fast` -> gemini-3-flash-preview  
- `ai.summary.quality` -> claude-sonnet-4-5-thinking  
- `ai.tags` -> claude-haiku-4-5-20251001  
- `ai.polish` -> gpt-5.2  
- `ai.outline` -> gemini-3-pro-preview  
- `ai.embedding` -> text-embedding-3-small（OpenAI）

## 服务边界
AI 服务负责：
- Prompt 模板与版本管理
- Agent 编排
- Embedding 生成
- 向量索引构建与检索
- 流式响应

Spring Boot 负责：
- JWT 认证来源与权限
- 博客业务逻辑
- 管理后台与数据管理

## API 设计（与设计文档对齐）

AI 内容接口（需鉴权）：
- POST /api/v1/ai/summary
- POST /api/v1/ai/tags
- POST /api/v1/ai/titles
- POST /api/v1/ai/polish
- POST /api/v1/ai/outline

流式接口（需鉴权）：
- POST /api/v1/ai/summary/stream  
  - Accept: text/event-stream 或 application/x-ndjson  
  - Body: JSON（内容不放 query）

语义搜索：
- GET /api/v1/search/semantic?q=&limit=
- POST /api/v1/admin/search/index（管理员，主动索引）
- POST /api/v1/admin/search/reindex（管理员，被动全量重建）

使用统计：
- GET /api/v1/admin/metrics/ai（管理员）

## 认证方案
- AI 服务验证 Spring Boot 签发的 JWT。
- 方案：
  - 共享 HMAC 密钥（短期）
  - JWKS/公钥验证（长期推荐）
- 管理员接口校验 role/claim。

## 流式策略（规避 EventSource 限制）
- 前端使用 `fetch` + `ReadableStream` 解析。
- 返回 chunk 文本或 NDJSON。
- 不使用 EventSource（无法携带 Authorization）。

## 数据模型与迁移

向量表（必须显式迁移）：

```
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE post_vectors (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
  embedding vector(1536),
  model VARCHAR(50) DEFAULT 'text-embedding-3-small',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_post_vectors_embedding
  ON post_vectors USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

向量搜索函数（最佳实践版本）：
```
CREATE OR REPLACE FUNCTION search_similar_posts(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.6,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    post_id BIGINT,
    title VARCHAR,
    slug VARCHAR,
    content TEXT,
    similarity float
)
LANGUAGE sql STABLE AS $$
    SELECT
        pv.post_id,
        p.title,
        p.slug,
        COALESCE(p.content_markdown, '') AS content,
        1 - (pv.embedding <=> query_embedding) AS similarity
    FROM post_vectors pv
    JOIN posts p ON p.id = pv.post_id
    WHERE p.deleted = FALSE
      AND p.status = 'PUBLISHED'
      AND pv.embedding IS NOT NULL
      AND 1 - (pv.embedding <=> query_embedding) >= match_threshold
    ORDER BY pv.embedding <=> query_embedding
    LIMIT match_count;
$$;
```

Prompt 模板表：
- prompt_templates：name/category/version/template/is_system

使用日志（可选）：
- ai_usage_logs：user_id/endpoint/model/tokens/latency/success/cached/error_code/request_id
```
CREATE TABLE ai_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  endpoint VARCHAR(128) NOT NULL,
  model VARCHAR(64) NOT NULL,
  request_chars INT NOT NULL DEFAULT 0,
  response_chars INT NOT NULL DEFAULT 0,
  tokens_in INT NOT NULL DEFAULT 0,
  tokens_out INT NOT NULL DEFAULT 0,
  latency_ms INT NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  cached BOOLEAN NOT NULL DEFAULT FALSE,
  error_code VARCHAR(64),
  request_id VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

## 使用统计与成本控制（Phase 4）
- 记录维度：endpoint、model、tokens_in/out、latency_ms、success、cached、error_code、request_id
- 统计接口：`GET /api/v1/admin/metrics/ai`（管理员）
- 输入保护：`AI_MAX_INPUT_CHARS` 统一限制请求内容长度（默认 20000）
- 缓存命中优先：命中时不触发模型调用，降低成本

## 缓存与限流

缓存键必须包含模型与 Prompt 版本：
```
ai:summary:{sha256(content)}:{model}:{promptVersion}:{maxLength}
```

TTL 建议：
- summary/tags：24h
- titles：1h

限流策略：
- 用户级：10 次/分钟/操作
- 全局：100 次/分钟

## 语义索引策略
- 仅索引已发布文章。
- 触发方式：
  - 主动：发布/更新/删除 -> 调用 AI 服务索引接口
  - 被动：管理员手动重建索引
- 重建索引支持批处理与分批重建。

## 前端集成（Admin）
- aiService 调用 `/api/v1/ai/*`。
- 流式输出使用 `fetch` + 流式解析。
- 编辑器 AI 助手保留，仅替换 API 路径。

## 分阶段实施计划

Phase 0：基础设施
- 创建 `apps/ai-service` 骨架
- 网关路由配置
- Redis + pgvector 接入

Phase 1：核心 API
- 摘要/标签/标题/润色/大纲
- Prompt CRUD
- 缓存与限流

Phase 2：语义搜索
- 向量表迁移
- 索引构建与查询
- 搜索 API

Phase 3：前端集成
- Admin AI 工具页接入
- 流式输出
- 编辑器 AI 助手

Phase 4：优化
- 使用统计与成本控制
- Prompt 版本管理流程

## 部署与构建（本地）
- 本地构建 AI 服务镜像（不推送）：
  - `./docker-build.sh --only ai-service`
- 生产部署（已在 docker-compose.prod.yml 集成 ai-service）

## 风险与应对
- 供应商不可用 -> LiteLLM 备用路由
- 向量维度变更 -> 记录 dimension/model
- 成本飙升 -> 缓存 + 配额 + 输入截断
- 认证漂移 -> 统一 JWT 校验库

## 开放问题
- 首批兼容供应商名单（待确认）
- JWT 校验方式（共享密钥 vs JWKS）
- 流式格式（SSE vs NDJSON）
- 索引触发方式（Webhook vs 事件总线）

## 与设计文档差异说明
- 设计文档已同步为独立 AI 服务，旧内嵌方案标记为历史/弃用。
- 该调整用于提升 AI 生态适配与长期可维护性。
