# 07 · AI 服务 (Python FastAPI + LiteLLM) 总体设计

> 模块根:`apps/ai-service/`
> 主要语言/技术:Python 3.11+ · FastAPI 0.128 · LiteLLM 1.83 · asyncpg 0.31 · pgvector 0.4 · Redis 7
> 横向依赖:server-go (`internal/service/ai_client.go`) · PostgreSQL (`ai_*` / `search_profiles` / `post_embeddings` / `jwt_secrets` 等表) · Redis (rate-limit / 缓存)

本文档是 AI 服务的入口索引,详细的分层 / 流程 / 端点请进入对应的子文档。版本基线:2026-05-04(migrations 000045 / migration 000038 + 000040 prompt 变更已应用)。

---

## 1. 模块定位

**AetherBlog AI Service** 是一个独立的 Python FastAPI 进程,承担「与 LLM 供应商通信」的所有职责:

- **能力面向**:博客生产线的全部 AI 工具 — `summary` / `tags` / `titles` / `polish` / `outline` / `translate`,以及搜索栈所需的 `embedding` / `qa` / RAG。
- **架构定位**:Go backend (server-go) 不直接接触任何 LLM SDK。所有 LLM 调用都由 Go 通过内部 HTTP 客户端 (`AIClient`) 转发到 ai-service,后者再交给 LiteLLM 统一与 OpenAI / Anthropic / Google / Azure / 各家 OpenAI-compatible 中转网关通信。
- **数据所有权**:`ai_providers` / `ai_models` / `ai_credentials` / `ai_task_routing` / `ai_task_types` / `ai_usage_logs` 这些表的写入入口都在 ai-service;Go 仅做透明代理。
- **状态**:无独立持久状态。一切热数据都来自 PG (路由 / 凭证) 或 Redis (限流 / 缓存),进程可水平扩展。

---

## 2. 与 server-go 的协议契约

### 2.1 部署拓扑

```
           ┌─────────────┐          ┌──────────────┐
浏览器 ──▶ │ nginx :7899 │──/api/──▶│ server-go    │── HTTP ──▶ ai-service:8000
           └─────────────┘          │ :7898        │
                                    │ (Go + Echo)  │
                                    └──────────────┘
                                            │
                                            ▼
                                     PostgreSQL (共享)
                                     Redis        (共享)
```

- 用户从不直接访问 ai-service。`docker-compose.prod.yml` 把 ai-service 的 8000 端口仅 `expose` 到内部网络 (不映射到宿主机),只有 `aetherblog-network` 上的容器能访问。
- nginx 路径上 `/api/v1/ai/*` 与 `/api/v1/admin/providers/*` 全部由 server-go 终结后再向 ai-service 转发(详见 `apps/server-go/internal/handler/ai_handler.go`)。

### 2.2 鉴权双轨

| 调用来源 | 头部 | 校验链 |
|---|---|---|
| 管理员浏览器(直登 admin) | `Authorization: Bearer <jwt>` 或 `Cookie: ab_access_token=<jwt>` | `app/api/deps.py:require_user → require_admin` |
| server-go 内部代理 | `X-Internal-Service: <token>` (≥ 32 chars) + 可选 `X-Forwarded-User-ID: <real_uid>` | `require_admin_or_internal`,内部 token 用 `hmac.compare_digest` 比对 `AI_INTERNAL_SERVICE_TOKEN` |

> 安全锚点(`apps/ai-service/app/api/deps.py:160-206`):双轨校验是核心防线,任何新端点都必须挂 `require_user` / `require_admin` / `require_admin_or_internal` 之一,**不能裸跑**。

### 2.3 对端 Go HTTP 客户端

`apps/server-go/internal/service/ai_client.go:17-114`:

- `syncClient` 用 `cfg.AI.ReadTimeout` (默认 5min);
- `streamClient` 用 `cfg.AI.StreamReadTimeout` (默认 5min) — 共享底层 `Transport`,连接池复用;
- 错误分类:`AIClientError{StatusCode}` 把 ctx canceled → 499、ctx deadline / netErr.Timeout() → 504、其它网络错误 → 502。
- 轴心方法:`DoSync` / `DoStream`,前者用于 ApiResponse JSON 端点,后者用于 SSE。

### 2.4 主要端点

| 路径前缀 | 类型 | 用途 |
|---|---|---|
| `GET /health` · `GET /ready` | 健康 | docker healthcheck;Liveness 不入访问日志 |
| `POST /api/v1/ai/{summary,tags,titles,polish,outline,translate}` | 同步 | 业务 AI 工具(管理员/JWT) |
| `POST /api/v1/ai/{...}/stream` | SSE | 同上的流式版本(SSE 帧 `delta` / `result` / `done` / `error`) |
| `GET /api/v1/agent/models` · `POST /api/v1/agent/chat` | 多轮 | Agent 工作台,Go 后端代理时携带 `X-Forwarded-User-ID` |
| `POST /api/v1/agent/workflows/execute` | 工作流 | Agent Workflow deterministic runner,Go runtime run 代理调用 |
| `GET /api/v1/search/semantic` · `GET /api/v1/search/qa` | 搜索 | 公开语义搜索 / RAG 流式问答 |
| `POST /api/v1/admin/search/{index,reindex,retry-failed}` | 写索引 | server-go 批处理调用,支持单篇 / 全量 / shadow profile 模式 |
| `/api/v1/admin/search/profiles/*` | Profile 管理 | 蓝绿切换 search profile (migration 000041) |
| `/api/v1/admin/providers/**` | Provider/Model/Credential/Routing CRUD | 单管理员 admin UI 直管 |
| `/api/v1/admin/ai/{prompts,tasks}` | Prompt/Task CRUD | 同上 |
| `/api/v1/admin/metrics/ai` · `/api/v1/admin/log-level` | 运维 | 内存指标 + 运行时日志级别 |

完整端点 → `01-architecture.md` §3。

---

## 3. 进程拓扑与生命周期

启动入口:`apps/ai-service/app/main.py`(uvicorn 命令 `uvicorn app.main:app`)

`lifespan()` 同步执行:

1. **JWT key 同步任务启动** — `start_jwt_key_refresher(pool)`(`app/core/jwt_keys.py:71-101`)从 `jwt_secrets` 表拉 `current` + `previous` 两把 HS256 key 进内存缓存,后台每 60s 重拉。失败则后台异步重试,不阻塞启动。
2. **Redis preflight ping** — `_redis_preflight()`(`main.py:61-96`)在 3s 超时内 ping Redis,失败按 `auth/timeout/connection/response/unknown` 分类落 `error` 日志。**非致命**:Redis 不可达时服务仍能起;运行时 rate-limiter 默认 fail-closed (`AI_RATE_LIMIT_FAIL_OPEN=false`)。
3. **核心服务预热** — `_prewarm_core_services()`(`main.py:159-186`)依次 build `provider_registry / credential_resolver / model_router / llm_router / usage_logger`。这是为了消除「第一次点 AI 工具失败、第二次成功」的冷启动抖动 — `deps.py` 里全部是惰性单例。

进程关闭时 cancel 所有后台 task、关闭 Redis 与 PG 连接池。

---

## 4. 配置加载

`app/core/config.py` 用 pydantic-settings 加载;`_find_env_file()` 智能在「项目根 `.env`」和「容器内仅环境变量」之间切换。

**红线必填**(失败 → 启动崩):

- `JWT_SECRET` — 与 server-go 共享,签名/验签 HS256
- `AI_INTERNAL_SERVICE_TOKEN` — 必须 ≥ 32 字符 (`Settings._validate_token_strength`)
- `AI_CREDENTIAL_ENCRYPTION_KEYS` — 逗号分隔的 Fernet 列表,**必须**独立于 JWT_SECRET (VULN-056);末尾缺 `=` padding 会被自动补齐 (`Settings._pad_b64url`)
- `POSTGRES_DSN` — 自动剥除 `postgresql+asyncpg://` 前缀(`_normalize_postgres_dsn`)

**关键运行时**:

- `AI_RATE_LIMIT_FAIL_OPEN=false`(默认)— Redis 故障时拒服务,避免被刷爆账单(VULN-070)
- `AI_MOCK_MODE=false`(prod) / `true`(本地默认) — true 时 `chat()` 直接返回 `[mock:<model>]`,不调 LLM
- `AI_MAX_INPUT_CHARS=120000`(默认)— 单请求字数硬上限
- `AI_DEFAULT_PROVIDER` / `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_COMPAT_*` — 当数据库 routing 表完全空时的 env fallback

**三段式 Redis**:`REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` 与完整 URL `REDIS_URL` 共存,优先级见 `_build_redis_url_from_parts` 与 `_merge_redis_password`(`config.py:156-220`)。Go backend 与 ai-service 共用同一套配置,避免「backend 连得上 / ai-service 连不上」的运维漂移。

详细 → `06-deployment-and-config.md`。

---

## 5. 横向依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| FastAPI | 0.128.8 | HTTP 框架 |
| uvicorn[standard] | 0.39.0 | ASGI server (容器内 `--host 0.0.0.0 --port 8000`) |
| LiteLLM | 1.83.0 | **核心**:统一抽象 OpenAI / Anthropic / Google / Azure / OpenAI-compatible 中转 |
| asyncpg | 0.31.0 | PG 异步驱动(只走 asyncpg,不走 SQLAlchemy 的执行路径) |
| pgvector | 0.4.2 | `register_vector` 在 `init` 钩子注入连接,让 asyncpg 能 bind list[float] |
| sqlalchemy | 2.0.49 | **仅**用作 `app/models/` 里的 ORM 类型描述(声明式),运行时不实例化 session |
| cryptography | 46.0.7 | Fernet / MultiFernet 凭证加解密 |
| PyJWT | 2.12.1 | JWT 验签 |
| redis | 7.0.1 | rate-limit + cache |
| eval-type-backport | 0.3.1 | 修补 Python 3.10/3.11 的 `X | Y` PEP 604 评估;**项目自带一份带 AST 白名单的安全实现** `apps/ai-service/eval_type_backport.py` |

依赖锁定理由(`requirements.txt:1-7`):VULN-074 — 浮动 `>=` 让供应链投毒(typo-squat、误发布)悄悄落地;Dependabot/Renovate 才是受信的升级源,build 机不应该。

---

## 6. 关键决策

### 6.1 为什么独立 Python 进程

- **LLM SDK 生态**:LiteLLM / OpenAI / Anthropic 的 SDK 都是 Python 优先,Go 端长期落后;独立进程让我们能直接吃 SDK 红利 (新模型、新参数、新协议透明 cover)。
- **运维隔离**:LiteLLM 偶发 TLS 握手抖动 / 慢 import / 内存膨胀,不能拖累 server-go 的请求线程。`docker-compose.prod.yml:362-381` 给 ai-service 单独 768M memory limit,挂掉时只影响 AI 路径。
- **并发模型**:async + uvicorn 单进程下 `asyncpg.Pool(min=1, max=5)` 已经够用,不需要预先按 Go goroutine 那种规模化部署。

### 6.2 为什么 LiteLLM 而不直接 SDK

- **多 provider 一份代码**:`acompletion(model="claude-3-5-sonnet-...")` / `acompletion(model="openai/gpt-5-mini")` / `acompletion(model="azure/...")` — 通过模型名前缀路由(`LlmRouter._prefix_model_for_litellm`,`app/services/llm_router.py:192-225`),`api_key` / `api_base` 直接传入,不用维护 N 套客户端。
- **OpenAI-compatible 中转**:国内大量用户用 oneapi / new-api / LiteLLM proxy 把 Anthropic / Gemini / 通义 / 智谱 / DeepSeek / 月之暗面统一暴露成 OpenAI 接口。给这些 provider 配 `api_type="openai_compat"`,模型名加 `openai/` 前缀,所有 chat / embedding 走完全一样的代码路径。
- **自然支持 fallback**:`LlmRouter._prepare_fallback_routing` 在 primary 失败时直接换 model + credential 重发,无需手写 SDK 切换逻辑。

### 6.3 prompt 演进策略

**migration 000019** 是 seed 的 prompt(过于宽泛,模型把 max_length 当软建议,输出几千字问答体)。`llm_router._build_messages` 里加了 `_TASK_FALLBACK_SYSTEM_PROMPT`(`app/services/llm_router.py:70-105`)硬编码兜底,但只对环境完全空的部署生效。

**migration 000038** 重写了 summary/tags/titles/polish/outline/translate 的 `prompt_template`:

- 显式禁止问答 / 分点 / `摘要:` 前缀
- 字数 / 数量约束改强语气 (「不超过」「必须」)
- 输出格式 hint(JSON 数组 / 单段落 / Markdown 大纲)

**migration 000040** 给 `tags` 加 `{existing_tags}` 占位符,让 prompt 接收前端传入的现有标签库,模型输出结构化 `{matches: [...], suggestions: [...]}`。`_parse_tags_structured`(`app/api/routes/ai.py:196-326`)做四层降级:严格 JSON → fenced JSON → 最外层 `{...}` 子串 → 旧扁平数组,确保不严格遵守 schema 的模型也能落地。

详细 → `03-prompts-and-workflows.md`。

---

## 7. 已知问题与边界

1. **Mock 模式陷阱**:`AI_MOCK_MODE=true` 在本地默认开启;管理员从 admin UI 选了真实 modelId 时(`override` 路径)mock 模式会被绕过让真实 LLM 调用发出去。这是有意为之 — 让管理员能在本地"测一下这个模型",但不要在生产把全局 mock 打开。
2. **Reasoning 模型 temperature 锁**:GPT-5 系列 / o1 / o3 / o4-mini 拒绝任何 temperature ≠ 1;`_TEMPERATURE_LOCKED_MODEL_PREFIXES`(`llm_router.py:127-145`)在调用前剥离 `temperature` kwarg,让上游用默认值。新增同类模型时需要扩此列表。
3. **fallback 与 override 互斥**:管理员手动选 model_id (override 路径) 时**不**走 fallback (`llm_router.chat:776-815`)— "用户显式压测此模型,失败就要看到失败"。
4. **embedding env_fallback 是嫌疑信号**:当 `ai_task_routing` 表里 `embedding` 这条没配置时,`embed()` 会落到 `env_fallback` 并 WARNING(`llm_router.py:1043-1054`)。生产环境出现这条 WARN 通常意味着索引正在用环境变量里的 OpenAI 默认模型,而不是管理员在 SearchConfig 里点的那个。
5. **think block 检测器**:`stream_chat_with_think_detection` 只识别 `<think>` / `<thinking>` / `<reasoning>` 三类标签(`llm_router.py:1120-1126`)。Qwen / R1 等模型用这些把 chain-of-thought 包起来;新 provider 用其它包裹符号会让推理轨迹串到正文里。

---

## 8. 扩展点

| 想做的事 | 改这里 |
|---|---|
| 加新 task type(比如 `social_post`) | DB seed 新行到 `ai_task_types` + 在 `_TASK_DEFAULT_MAX_TOKENS` / `_TASK_FALLBACK_SYSTEM_PROMPT`(`llm_router.py`)加默认值;不需要改路由代码 |
| 加新 provider(比如 Mistral 直连) | 走两条路径:① `ai_providers` 表加行,api_type 选 `openai_compat` 配中转;② 真直连需扩 `LlmRouter._prefix_model_for_litellm` 加新前缀 + `RemoteModelFetcher.fetch_models` 加新分支 |
| 加新 chunker 策略 | `app/services/chunker.py:split` 增分支 + `profiles.py` `allowed_chunkers` 集合扩展;DB CHECK 在 search_profiles 表已硬定枚举,需要同步迁移 |
| 加新 SSE 事件类型 | `_stream_with_think_detection` 与 `_build_stream_result_payload` 是承接点;前端 useStreamResponse 必须同步认这种事件 |
| 加 batch 推理 | LiteLLM 的 `batch_completion` 现状未接入;需要在 `LlmRouter` 上加平行 API + 新 task 路径 |

子文档:
- [01-architecture.md](./01-architecture.md) 目录分层 / 启动入口 / 中间件
- [02-litellm-and-providers.md](./02-litellm-and-providers.md) LiteLLM 抽象 / provider 矩阵 / 模型路由
- [03-prompts-and-workflows.md](./03-prompts-and-workflows.md) prompt 模板 / 任务流水线 / DB ↔ 代码契约
- [04-streaming-and-tools.md](./04-streaming-and-tools.md) SSE 实现 / 重试 / 错误归一化
- [05-tests-and-quality.md](./05-tests-and-quality.md) 测试矩阵 / 80% 覆盖门
- [06-deployment-and-config.md](./06-deployment-and-config.md) Dockerfile / docker-compose / env 矩阵
- [07-workflow-runner.md](./07-workflow-runner.md) Agent Workflow 执行器 / trace / 安全边界
