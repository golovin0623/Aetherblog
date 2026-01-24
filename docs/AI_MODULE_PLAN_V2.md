# AI 模块计划 v2（独立 AI 服务）

状态：拟定  
负责人：AetherBlog 团队  
更新时间：2026-01-xx  

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

AI 服务
  - LiteLLM 路由模型供应商
  - RAG + pgvector
  - Prompt 管理
  - Redis 缓存与限流
```

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

### 1) OpenAI（首批主力，Embedding 由 OpenAI 承担）
- 生成类（摘要/标签/标题/润色/大纲）  
  - `gpt-4o-mini`：高频、低成本  
  - `gpt-4o`：高质量
- 向量（Embedding）  
  - `text-embedding-3-small`（默认）  
  - `text-embedding-3-large`（质量优先）

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
- `ai.summary.fast` -> gpt-4o-mini  
- `ai.summary.quality` -> gpt-4o / claude-3.5-sonnet  
- `ai.tags` -> gpt-4o-mini  
- `ai.polish` -> claude-3.5-sonnet  
- `ai.outline` -> gemini-1.5-pro  
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
- POST /api/v1/admin/search/reindex（管理员）

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
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE vector_store (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL,
  model VARCHAR(64) NOT NULL,
  dimension INT NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX vector_store_hnsw_idx
  ON vector_store USING hnsw (embedding vector_cosine_ops);
CREATE INDEX vector_store_metadata_gin
  ON vector_store USING gin (metadata);
```

Prompt 模板表：
- prompt_templates：name/category/version/template/is_system

使用日志（可选）：
- ai_usage_logs：tokens/latency/model/success

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
  - 发布/更新/删除 -> 调用 AI 服务 webhook
  - 管理员手动重建索引
- 重建索引使用异步队列。

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
