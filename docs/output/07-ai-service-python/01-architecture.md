# 01 · 目录分层 / 启动入口 / 中间件

## 范围

本文聚焦 ai-service 进程的「骨架」:目录约定、FastAPI app 的注册顺序、lifespan 钩子、中间件链、全局异常处理与依赖注入。

---

## 1. 目录分层

```
apps/ai-service/
├── Dockerfile                         # python:3.12-slim · 非 root user · /app/logs 共享卷
├── README.md                          # 本地启动 cheatsheet
├── pyproject.toml                     # name=aetherblog-ai-service · requires-python>=3.11 · pytest --cov-fail-under=80
├── requirements.txt                   # 所有运行时依赖锁版本(Dependabot 才动)
├── requirements-dev.txt               # pytest / pytest-cov / pytest-asyncio
├── eval_type_backport.py              # 自带的安全 PEP-604 求值器,带 AST 白名单
├── scripts/
│   └── rotate_credentials.py          # MultiFernet 凭证轮换 + 孤儿 routing 修复
├── tests/                             # 26 个 test_*.py · conftest 注入 secret 默认值
└── app/
    ├── main.py                        # FastAPI app · lifespan · 中间件 · 全局 handler
    ├── api/
    │   ├── router.py                  # 9 个子路由的统一聚合
    │   ├── deps.py                    # 全局依赖注入(redis / pg / 9 个 service)
    │   └── routes/
    │       ├── ai.py                  # POST /api/v1/ai/* (业务端点 · 同步 + 流式)
    │       ├── agent.py               # /api/v1/agent/* (多轮对话 · ModelPicker)
    │       ├── search.py              # /api/v1/search/* (semantic / qa / index / reindex)
    │       ├── profiles.py            # /api/v1/admin/search/profiles/* (蓝绿切换)
    │       ├── providers.py           # /api/v1/admin/providers/** (CRUD + remote fetch)
    │       ├── prompts.py             # /api/v1/admin/ai/prompts/{task_type}
    │       ├── tasks.py               # /api/v1/admin/ai/tasks/{code}
    │       ├── metrics.py             # /api/v1/admin/metrics/ai
    │       ├── log_level.py           # GET/PUT /api/v1/admin/log-level
    │       └── health.py              # /health · /ready
    ├── core/
    │   ├── config.py                  # pydantic Settings · _find_env_file · 三段式 Redis · Fernet 校验
    │   ├── jwt.py                     # decode_token (HMAC + JWKS 双轨) · UserClaims
    │   ├── jwt_keys.py                # 后台 60s 刷新 jwt_secrets 表的内存缓存
    │   └── logging.py                 # JSONFormatter · SecretRedactor · log_path fallback chain
    ├── services/                      # 业务核心(无 HTTP)
    │   ├── llm_router.py              # 唯一调 LiteLLM acompletion / aembedding 的地方
    │   ├── model_router.py            # ai_task_routing → RoutingConfig
    │   ├── provider_registry.py       # ai_providers / ai_models 的 CRUD + 缓存
    │   ├── credential_resolver.py     # MultiFernet 加解密 + 用户级凭证选择
    │   ├── remote_model_fetcher.py    # /v1/models 拉远端模型清单
    │   ├── vector_store.py            # 多 chunk · profile 化 · 蓝绿语义搜索
    │   ├── chunker.py                 # 5 种切分策略(纯函数,无 IO)
    │   ├── cache.py                   # Redis JSON cache + hash_content
    │   ├── rate_limiter.py            # Lua 脚本原子 incr·expire · fail-closed
    │   ├── usage_logger.py            # ai_usage_logs 落库 + tokens / cost 估算
    │   └── metrics.py                 # 内存 MetricsStore (单进程聚合)
    ├── schemas/                       # 全部 pydantic v2 BaseModel
    │   ├── common.py                  # ApiResponse[T] · 与 Java 端 AiResponse 对齐
    │   ├── ai.py                      # SummaryRequest / SummaryData / TagsData ... + ExistingTagHint / TagMatch
    │   ├── search.py                  # IndexRequest / ReindexRequest / SearchProfile DTO
    │   └── provider.py                # 21 个 schema(Provider/Model/Credential/Routing CRUD 全套)
    ├── models/                        # SQLAlchemy 声明式 (仅作类型 / 关系映射,运行时不实例化 Session)
    │   ├── provider.py                # AiProvider / AiModel / ApiType / ModelType
    │   ├── credential.py              # AiCredential
    │   └── routing.py                 # AiTaskType / AiTaskRouting
    └── utils/
        ├── ndjson.py                  # 8 行 · `data: ...\n`
        ├── provider_urls.py           # normalize_api_base · 自动 /v1 后缀逻辑
        └── url_validator.py           # SSRF 守卫 · 同步 + 异步 · 内网逃生开关
```

设计取舍:

- **services/ 不做 HTTP**。`llm_router.chat()` 接受字典,返回字符串 / async generator。HTTP 头、Pydantic、HTTPException 的事归 routes/。
- **models/ 是历史遗留**。最初想用 SQLAlchemy 异步 session 操作 PG,后来全面切到 asyncpg(无 ORM 开销),`models/` 现在只剩声明式类型表 + Enum,被 `tests/test_models_imports.py` 锁住"导入不报错"作为最低保险。
- **utils/ 是无依赖纯函数**。换言之,可以被 `scripts/` 与 `tests/` 安全 import,不会触发 settings 或 DB 连接。

---

## 2. 启动入口

容器内命令(Dockerfile 最后一行):

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

本地 venv 命令(README 推荐):

```bash
uvicorn app.main:app --reload
```

`app/main.py:189-197` 创建 FastAPI:

```python
_docs_url = "/docs" if settings.env == "dev" else None
app = FastAPI(
    title="AetherBlog AI Service",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=_docs_url,
    redoc_url=None,
    openapi_url="/openapi.json" if _docs_url else None,
)
```

> Prod 模式下 `/docs` / `/openapi.json` 全部关闭(`AI_ENV != "dev"`),避免 schema 泄露。

---

## 3. lifespan 钩子(`main.py:99-156`)

启动顺序(关键):

1. **JWT key refresher**:
    - 优先 `await deps_module.get_pg_pool()` 预热 PG 连接池;
    - 调 `start_jwt_key_refresher(pool)`(`app/core/jwt_keys.py:71-101`);
    - 该函数会先**同步**拉一次 `jwt_secrets` 表里 status IN ('current','previous') 的 key,失败则 raise 并不创建后台 task;
    - lifespan 捕获 raise,启动 `_retry_start_jwt_refresher` 后台任务每 10s 重试一次,直到 DB 就绪。
    - **设计意图**:Python 端验签必须同步(`jwt.decode` 不接 async),所以采用「后台 async 写、前台同步读」的最终一致性 + 模块级 list 无锁读。

2. **Redis preflight**(`main.py:61-96`):
    - 3s 超时 ping Redis;
    - 失败按 `auth/timeout/connection/response/unknown` 分类落 `error` 日志(`classify_redis_error`,`app/services/rate_limiter.py:20-40`);
    - **不抛错**:服务依然能起,但所有 `Depends(rate_limit)` 端点会因 Redis 不可达 fail-closed 503。这一步只是为了让 on-call 在启动 banner 里立刻看到「key 配错了」,而不是等用户报"AI 工具全挂"。

3. **核心服务预热**(`main.py:159-186`):
    - 顺序触发 `provider_registry / credential_resolver / model_router / llm_router / usage_logger` 的 lazy 创建;
    - 任一失败只 `warning` 不抛,保留 `deps.get_xxx()` 的 lazy 兜底;
    - **设计意图**:消除「冷启动后第一次点 AI 工具失败、第二次成功」的抖动。首请求会同步触发 DB 查询 + Fernet key 解析 + LiteLLM 客户端首次握手,这一连串放在请求线路里就是 200ms 抖动 + SSE 假报错。

关闭顺序(`main.py:148-156`):cancel `refresher_retry_task` → cancel `_TASK` (jwt refresher) → close redis → close pg pool。

---

## 4. 中间件链

按代码顺序(`main.py:207-223` + `:240-268`):

### 4.1 CORSMiddleware(`main.py:207-223`)

VULN-068 加固:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:7899",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-Id", "X-Trace-Id", "Accept"],
)
```

**故意不放 `X-Internal-Service` 进 allow_headers** — 即便将来 origin 列表扩大,浏览器 CORS 路径也无法触发 internal endpoint。

### 4.2 `request_context`(`main.py:240-268`)

每个请求:

- 读或生成 `X-Request-Id` (uuid4) 写到 `request.state.request_id`,响应也回写;
- 计 perf_counter,日志一行 JSON `request <method> <path> <status> <duration>ms`;
- **健康探针静音**(`_HEALTH_PROBE_PATHS = {"/health", "/ready"}`):2xx 不进访问日志,与 Go backend `internal/middleware/trace.go::isHealthProbePath` 行为对齐;
- 4xx → warning · 5xx → error。

### 4.3 不存在的 ASGI middlware

刻意没有 `GZipMiddleware`(SSE 路径会被拦坏)、没有 ProxyHeaders(让 server-go 处理) 、没有 SessionMiddleware(stateless)。

---

## 5. 全局异常处理(`main.py:271-324`)

三层兜底,确保**所有**响应都是 `ApiResponse` 形态(与 Go / Java 端对齐):

| Handler | 触发 | 行为 |
|---|---|---|
| `http_exception_handler(StarletteHTTPException)` | `raise HTTPException(...)` | `code=status_code, errorCode="HTTP_<code>"`,带原 detail |
| `validation_exception_handler(RequestValidationError)` | pydantic 校验失败 | 400 + `errorCode="VALIDATION_ERROR"`,展开 `errors[]` |
| `unhandled_exception_handler(Exception)` | 未捕获异常 | `logger.exception` 完整堆栈 → response 截断到 240 字符 + `errorCode="INTERNAL_<ExcName>"` |

**关键决策**(`main.py:308-322`):

```python
error_type = type(exc).__name__
raw_msg = str(exc).strip()
safe_msg = raw_msg[:240] + "…" if len(raw_msg) > 240 else raw_msg
detail = f"{error_type}: {safe_msg}" if safe_msg else error_type
```

不返回纯 "Internal server error" — admin 看到红色 toast 时能立刻分辨"是 LiteLLM 哪条 provider 错"还是"DB 连不上"。240 字符截断避免泄露完整堆栈。**截断不是脱敏** — `app/core/logging.py:14-31` 的 `SecretRedactor` 才是兜底。

---

## 6. 依赖注入(`app/api/deps.py`)

### 6.1 全局单例

`deps.py` 顶部 8 个模块级变量 `_redis / _router / _model_router / _provider_registry / _credential_resolver / _vector_store / _pg_pool / _usage_logger / _remote_model_fetcher`。每个 `get_*()` 都是「检查 + 创建 + 缓存」的 lazy 模式。

> **不要在 routes 里直接读这些变量**。永远走 `Depends(get_xxx)`,这样测试可以 `app.dependency_overrides[get_xxx] = lambda: fake`。

### 6.2 PG 连接池

```python
async def get_pg_pool() -> asyncpg.Pool:
    global _pg_pool
    if _pg_pool is None:
        settings = get_settings()
        _pg_pool = await asyncpg.create_pool(
            settings.postgres_dsn, min_size=1, max_size=5, init=register_vector
        )
    return _pg_pool
```

`min=1, max=5` 是按"async + 单进程 + 同时承载 reindex 写循环 + 几十路 admin AI 请求"的容量算的。`init=register_vector`(`pgvector.asyncpg`)让每个新连接自动注册 vector / halfvec 类型,后续 `embed = await conn.fetchrow("SELECT ... 1 - (pe.embedding <=> $1) ...", vec)` 可以直接 bind list[float] / numpy ndarray。

### 6.3 Redis 双轨密码

`_get_redis()`(`deps.py:41-59`)既允许 URL 内嵌 userinfo,也允许 `password` kwarg:

```python
url_has_userinfo = "@" in (urlparse(settings.redis_url).netloc or "")
if settings.redis_password and not url_has_userinfo:
    kwargs["password"] = settings.redis_password
```

理由:旧镜像可能没跑 `Settings._merge_redis_password`,显式 kwarg 兜底。但若 URL 已经带 userinfo (`redis://:xxx@host`) ,**不**再注入 password kwarg — 尊重运维方显式选择。

### 6.4 鉴权依赖

| Dep | 来源 | 用途 |
|---|---|---|
| `require_user` | JWT Authorization 或 `ab_access_token` cookie | 普通登录用户 |
| `require_admin` | 上+role ∈ {admin, super_admin} | 单管理员博客的所有 admin 写操作 |
| `require_admin_or_internal` | 上 OR `X-Internal-Service` token | server-go 内部代理 + admin |
| `rate_limit` | require_user → enforce_global_limit + enforce_user_limit | 业务 AI 端点 |
| `anonymous_rate_limit` | get_current_user → 按 IP / sub 限流 | 公开 search 端点 |

**核心铁律**(`deps.py:191-198`):内部 token 比对**必须先做 truthy 检查再 `hmac.compare_digest`** — `compare_digest(None, ...)` 在不同 CPython 版本行为不一致(3.12 抛 TypeError、旧版本静默 False)。VULN-162 已加这道闸,Settings 验证(≥32 chars)是第二道,不能合并。

---

## 7. 路由聚合(`app/api/router.py`)

```python
router.include_router(health.router)
router.include_router(ai.router)
router.include_router(agent.router)
router.include_router(search.router)
router.include_router(profiles.router)
router.include_router(metrics.router)
router.include_router(providers.router)
router.include_router(prompts.router)
router.include_router(tasks.router)
router.include_router(log_level.router)
```

注册顺序无副作用(没有重叠路径)。每个子路由器自己挂 `prefix` 和 `dependencies`(例如 `prompts.router` 默认 `Depends(require_admin)`,`profiles.router` 给每个端点单独挂)。

---

## 8. 关键端点全景图

> Routes 总数:在 19+ 个具体处理函数,这里只列出契约稳定的关键端点。完整请直接读 `app/api/routes/*.py`。

| Method | 路径 | 鉴权 | 输出形态 | 文件:行 |
|---|---|---|---|---|
| GET | `/health` · `/ready` | 无 | `{"status": "ok\|ready"}` | `routes/health.py:10-17` |
| POST | `/api/v1/ai/summary` | `rate_limit` | `ApiResponse[SummaryData]` | `routes/ai.py:613-753` |
| POST | `/api/v1/ai/summary/stream` | `rate_limit` | SSE | `routes/ai.py:756-796` |
| POST | `/api/v1/ai/tags` (+`/stream`) | `rate_limit` | `ApiResponse[TagsData]` / SSE | `routes/ai.py:799-917` / `:1552-1597` |
| POST | `/api/v1/ai/titles` (+`/stream`) | `rate_limit` | `ApiResponse[TitlesData]` | `:920-1023` / `:1600-1637` |
| POST | `/api/v1/ai/polish` (+`/stream`) | `rate_limit` | `ApiResponse[PolishData]` | `:1026-1133` / `:1640-1677` |
| POST | `/api/v1/ai/outline` (+`/stream`) | `rate_limit` | `ApiResponse[OutlineData]` | `:1136-1260` / `:1680-1732` |
| POST | `/api/v1/ai/translate` (+`/stream`) | `rate_limit` | `ApiResponse[TranslateData]` | `:1266-1382` / `:1735-1776` |
| GET | `/api/v1/agent/models` | `require_admin_or_internal` + `X-Forwarded-User-ID` | `ApiResponse[list[AgentModelItem]]` | `routes/agent.py:423-514` |
| POST | `/api/v1/agent/chat` | 同上 | SSE | `routes/agent.py:521-605` |
| GET | `/api/v1/search/semantic` | `rate_limit` | `ApiResponse[SemanticSearchData]` | `routes/search.py:84-119` |
| GET | `/api/v1/search/semantic/internal` | `require_admin_or_internal` | 同上 | `:346-385` |
| GET | `/api/v1/search/qa` | `require_admin_or_internal` | SSE(delta+sources+result+done) | `:388-450` |
| POST | `/api/v1/admin/search/index` | `require_admin_or_internal` | `ApiResponse[dict]` | `:219-343` |
| POST | `/api/v1/admin/search/reindex` | `require_admin_or_internal` | `ApiResponse[dict]` | `:122-216` |
| POST | `/api/v1/admin/search/retry-failed` | `require_admin` | `ApiResponse[dict]` | `:539-645` |
| GET | `/api/v1/admin/search/stats` | `require_admin` | `ApiResponse[dict]` | `:453-536` |
| GET / POST | `/api/v1/admin/search/profiles[...]` | `require_admin` | various | `routes/profiles.py` 全文 |
| `*` | `/api/v1/admin/providers/**` | `require_admin` | various(完整 CRUD) | `routes/providers.py` 全文 |
| GET / PUT | `/api/v1/admin/ai/prompts/{task_type}` | `require_admin` | `ApiResponse[PromptConfigResponse]` | `routes/prompts.py:54-117` |
| `*` | `/api/v1/admin/ai/tasks` (+`/{code}`) | `require_admin` | various | `routes/tasks.py` |
| GET | `/api/v1/admin/metrics/ai` | `require_admin` | `ApiResponse[dict]`(metrics.snapshot) | `routes/metrics.py:12-14` |
| GET / PUT | `/api/v1/admin/log-level` | `require_admin_or_internal` | `ApiResponse[LogLevelResponse]` | `routes/log_level.py:56-89` |

> **稳定性承诺**:`ApiResponse[T]` 形态不再变。SSE `result` 事件的 `data` 字段对齐对应非流式端点的 `*Data` schema(详见 `04-streaming-and-tools.md`)。

---

## 9. 日志架构(`app/core/logging.py`)

- **JSONFormatter**:`{timestamp, level, service:"ai-service", message, traceId?, data?}`。
- **SecretRedactor**(LogFilter):正则在序列化前清洗 `sk-...` 与 `Bearer ...`(VULN-165)— 防止 LiteLLM 异常 trace 把 provider key 落到共享 logs volume(VULN-146)。
- **Stdout + 文件双 sink**:`AI_LOG_PATH` 默认 `./logs`(本地)/`/app/logs`(容器);写不进去时 fallback 到 `/tmp/ai-service.log`,最终 fallback 仅 stdout。
- **抑噪**:`httpx / httpcore / uvicorn.access / watchfiles` 全部默认 WARNING — 否则 LiteLLM 内部 httpx 会让每次 LLM 调用打两条 INFO,直接淹没业务日志。

运行时调级:`PUT /api/v1/admin/log-level {"level": "debug"}`(`routes/log_level.py:67-89`)— 不持久化,容器重启回到 `AI_LOG_LEVEL`。

---

## 10. Pydantic 兼容补丁:`eval_type_backport.py`

项目根有一份 `apps/ai-service/eval_type_backport.py`(116 行),不是依赖 `eval-type-backport==0.3.1` 那个包,而是带 **AST 节点白名单** 的安全实现(白名单见 `_SAFE_AST_NODES`)。pydantic / FastAPI 在某些 Python 版本上为了 evaluate `X | Y` 这种 PEP-604 forward ref 会调外部包,后者 `eval()` 编译过的 AST 而无白名单,等于「攻击者控制的 type annotation 字符串能 eval 任意代码」。

`UnsafeTypeExpressionError` 是这个加固的核心,任何 `BinOp` 之外的节点(例如 `Call`、`Lambda`、`Attribute` 嵌套形态)都会被拒。

---

## 11. 已知架构限制

- **单进程指标**:`MetricsStore`(`services/metrics.py`)在内存里 hold 一个 dict,水平扩展时多副本不会聚合 — `/api/v1/admin/metrics/ai` 实际只看自己。需要全量统计请走 `ai_usage_logs` 表(usage_logger 落库)。
- **JWT key 缓存最终一致**:轮换时多副本的 lag 上限是 `REFRESH_INTERVAL_SECONDS = 60` 秒。在这 60s 窗口内,旧副本仍接受 `previous` key 签发的 token,新副本可能拒绝刚签的 token — 实践中没人感知,但混沌测试会撞到。
- **provider_registry 缓存不支持失效广播**:`_provider_cache / _model_cache` 是 dict,只在写入路径(`update_provider`、`delete_model` 等)主动 `clear_cache()`。多副本时另一个副本不会被通知,DB 改完前 60s 仍可能拿到 stale。`_resolve_override` 里的 `is_enabled` 二次校验是这道墙的兜底。
