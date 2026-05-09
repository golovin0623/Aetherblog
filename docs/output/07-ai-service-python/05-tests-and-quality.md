# 05 · 测试矩阵 / 质量门 / Coverage

## 范围

- 测试目录结构与 26 个 `test_*.py`
- 覆盖率门 80%(`pyproject.toml`)
- conftest 的 secret 默认值
- support.py 的 FakeConn / FakePool 抽象
- 测试策略:契约测试 + 单元测试 + 流协议测试
- 各 service 的 fake 模式
- 已知盲点与扩展点

---

## 1. 配置基线

`pyproject.toml`(`apps/ai-service/pyproject.toml:11-14`):

```toml
[tool.pytest.ini_options]
minversion = "7.0"
addopts = "--cov=app --cov-report=term-missing --cov-fail-under=80"
testpaths = ["tests"]
```

**80% 覆盖率是硬门**,低于即 CI 失败。开发依赖:

```
pytest>=7.4
pytest-cov>=4.1
pytest-asyncio>=0.23
PyJWT>=2.8
```

`requires-python = ">=3.11"` 的硬要求(`pyproject.toml:9`)— 否则 `pydantic-settings 2.x`、MultiFernet 轮换语法、基于 pattern 的 validator 会在 Python 3.9 / 3.10 上 import 阶段崩溃。

---

## 2. conftest.py 的 secret 默认值

`apps/ai-service/tests/conftest.py:12-29`:

```python
_DEFAULTS = {
    "JWT_SECRET": "test-secret",
    "AI_INTERNAL_SERVICE_TOKEN": "pytest-internal-service-token-minimum-32-chars",
    "AI_CREDENTIAL_ENCRYPTION_KEYS": "j2V7X9f8TMZLMTipxOmI1oDV4MherQCh_MN2gXszJyg=",
    "POSTGRES_DSN": "postgresql://test:test@localhost:5432/test_db",
}

for _key, _value in _DEFAULTS.items():
    os.environ.setdefault(_key, _value)  # ← 仅 setdefault,不覆盖 CI / dev shell 已有值
```

**为什么需要**:`Settings` 中 `JWT_SECRET` / `AI_INTERNAL_SERVICE_TOKEN` / `AI_CREDENTIAL_ENCRYPTION_KEYS` / `POSTGRES_DSN` 都是 `Field(...)` 必填。测试**收集期**就会 import `app.*` 模块,触发 `get_settings()`,缺任何一个就 ValidationError。

`AI_CREDENTIAL_ENCRYPTION_KEYS` 用真实有效的 Fernet key — `Settings._validate_encryption_keys` 启动期会校验,假 key(随机字符串)会让 ValidationError 仍然抛出。

---

## 3. support.py 的 fake 抽象

`apps/ai-service/tests/support.py`(76 行)— 替代 asyncpg.Pool 的可注入 fake:

```python
class FakeConn:
    def __init__(self, fetch=None, fetchrow=None, execute=None, executemany=None): ...
    async def fetch(self, query, *args): ...        # 记录 fetch_calls
    async def fetchrow(self, query, *args): ...     # 记录 fetchrow_calls
    async def execute(self, query, *args): ...      # 记录 execute_calls
    async def executemany(self, query, values): ... # 记录 executemany_calls
    def transaction(self): return FakeTransaction()  # 真 async ctxmgr 的 stub

class FakePool:
    def acquire(self): return FakeAcquire(self.conn)
```

模式:每个 service 测试 build 一个 `FakeConn(fetch=lambda q, a: [...])`,然后 `FakePool(conn)` 喂给 service 构造函数。被测代码完全不知道 PG 是 fake — 它只用 `async with pool.acquire() as conn: rows = await conn.fetch(...)`。

`fetchrow_calls`(等)记录每次调用的 `(query, args)`,断言"SQL 拼对了 / 参数对了"。

---

## 4. 测试矩阵

26 个 test 文件,按主题分:

| 文件 | 测试目标 | 关键意图 |
|---|---|---|
| `test_ai_routes.py` | `/api/v1/ai/*` 业务端点 | 非流式 ApiResponse 形态 + 流式 result 事件契约 |
| `test_api_base.py` | `app.utils.provider_urls` | `/v1` 后缀的 auto / append / strip 模式 |
| `test_chunker.py` | `app.services.chunker.split` 默认 recursive | H1/H2/H3 切分 + overlap + 边界 |
| `test_chunker_parent_child.py` | parent_child chunker | `Chunk.parent_text` 是 parent 子串 |
| `test_chunker_qa.py` | qa chunker | Q/A 标记识别 + 漏识别退化到 recursive |
| `test_credential_resolver_service.py` | CredentialResolver Fernet 加解密 + 轮换 + env fallback | 内部服务 user_id=None 不被 SQL 退化分支误过滤 |
| `test_deps.py` | `app.api.deps` 鉴权 | JWT decode + cookie / header 双轨 |
| `test_index_stats_fallback.py` | `/api/v1/admin/search/stats` migration 回归 | `post_embeddings` schema 缺失时 stats 仍能 200 |
| `test_llm_router_fallback.py` | LlmRouter primary 失败 → fallback | 审计 §1.3 P1.3 跟进,锁住 try/except 边界 |
| `test_metrics_routes.py` | `/api/v1/admin/metrics/ai` | metrics.snapshot 形态 |
| `test_model_router_service.py` | ModelRouter.resolve_routing | 用户级优先 + system 级兜底 |
| `test_models_imports.py` | SQLAlchemy 声明类型 | "导入不报错"最低保险 |
| `test_profile_reindex_stream.py` | SSE reindex 进度协议 | start → progress* → result → done 帧序列 |
| `test_prompt_routes.py` | `/api/v1/admin/ai/prompts/*` | 双写 routing.prompt_template + config_override |
| `test_provider_registry_service.py` | ProviderRegistry CRUD + cache | clear_cache 触发条件 |
| `test_provider_routes.py` | `/api/v1/admin/providers/**` | _model_info_to_response + credential_configured |
| `test_qa_streaming.py` | `/api/v1/search/qa` SSE 协议 | result 事件锁定(给通用消费者) |
| `test_redis_url_password.py` | Settings._merge_redis_password / _build_redis_url_from_parts | NOAUTH 503 回归 |
| `test_remote_fetch_errors.py` | format_remote_fetch_error | httpx.HTTPStatusError 形态归一化 |
| `test_remote_model_fetcher_service.py` | RemoteModelFetcher | OpenAI / Anthropic /v1/models 解析 |
| `test_retry_failed_profile_scoped.py` | retry-failed profile 模式 | 旧 SQL(embedding_status='FAILED')vs 新 SQL(NOT EXISTS profile 行) |
| `test_search_limit.py` | `/api/v1/search/semantic` rate limit | 用 TestClient + dependency_overrides 注入 fake |
| `test_usage_logger_metrics.py` | UsageLogger.record + MetricsStore | tokens 估算 + cost 估算 + 失败采样 |
| `e2e/test_model_fetch_flow.py` | 端到端 model fetch | provider/credentials/remote 一路打通(模拟 httpx) |

---

## 5. 测试策略剖面

### 5.1 契约测试(高密度)

`test_ai_routes.py` / `test_qa_streaming.py` / `test_profile_reindex_stream.py` 是**契约**层 — 不关心内部实现,只锁住前端契约:

> 「流式 tags 必须发 `result` 事件,payload 是 `{type:'result', data: {tags: [...], matches: [...], suggestions: [...]}}`」

这类测试是「不该被允许悄悄改动」的部分。任何修改 `_build_stream_result_payload` 的人都会被这套测试拦下来。

### 5.2 边界测试(chunker / fallback)

`test_chunker_qa.py` / `test_llm_router_fallback.py` 锁的是 known-bad 行为:

- 「QA chunker 漏识别 → 退化到 recursive,而不是切出乱码」
- 「primary 失败 + fallback 配置存在时,必须切到 fallback」

`llm_router_fallback` 的特别说明(`tests/test_llm_router_fallback.py:1-8`):

> 审计 §1.3 P1.3 跟进。schema (`ai_task_routing.fallback_model_id`) + 加载逻辑 (`model_router.resolve_routing`) + 运行时切换 (`LlmRouter.chat / stream_chat`) 全链路其实早就实现了, 但**零测试覆盖**, 唯一保证是 docker logs 里 grep `"primary_failed_using_fallback"` 字样, 任何对 try/except 边界的微调 (例如 PR 把 Exception 改成更窄的类型) 都可能让 fallback 变成"摆设"。

### 5.3 回归测试(migration / schema 变更)

`test_index_stats_fallback.py` / `test_redis_url_password.py` 是**回归**层 — 锁住已修过 bug 不复发:

- 「migration 000034 应用但 post_embeddings schema 仍是 000001 形态时,stats 仍 200」
- 「`REDIS_PASSWORD` 必须被合并进 `REDIS_URL` 的 userinfo 段」

---

## 6. 各 service 的 fake / mock 模式

### 6.1 LiteLLM 怎么 mock

测试不真调 OpenAI / Anthropic。两条路径:

**路径 A:`AI_MOCK_MODE=true`**(`app/services/llm_router.py:728-729`):

```python
if self.settings.mock_mode and not resolved.override:
    return f"[mock:{resolved.model}]"
```

`stream_chat`(`llm_router.py:901-905`)mock 输出 `["[", "mock", f":{resolved.model}", "]"]`。`embed`(`:1058-1063`)mock 输出 `sha256(text)` 重复填充到 `vector_dim`。

**路径 B:`monkeypatch.setattr(litellm, "acompletion", fake_acompletion)`**:在测试里直接打补丁。`test_llm_router_fallback.py` 用这个让 primary 抛异常、fallback 成功。

### 6.2 PG asyncpg 怎么 mock

`tests.support.FakePool / FakeConn` 见 §3。每个 service 测试用 lambda 注入 SQL 返回:

```python
def fake_fetchrow(query, args):
    if "SELECT id FROM ai_credentials" in query:
        return {"id": 1, "api_key_encrypted": "...", ...}
    return None

conn = FakeConn(fetchrow=fake_fetchrow)
pool = FakePool(conn)
resolver = CredentialResolver(pool)
```

### 6.3 Redis 怎么 mock

`test_search_limit.py` 用 `app.dependency_overrides` 直接旁路 rate_limit:

```python
client = TestClient(app)
app.dependency_overrides[rate_limit] = lambda: UserClaims(user_id="1", role="admin", scopes=None)
app.dependency_overrides[get_vector_store] = lambda: FakeVectorStore()
```

不直接 fake Redis 对象 — 测 rate-limit 行为时直接验证 503/429 状态即可。

### 6.4 httpx 怎么 mock(RemoteModelFetcher)

`test_remote_model_fetcher_service.py` 用 `pytest_httpx.HTTPXMock`(由 `httpx==0.28.1` 自带的 `respx` 兼容生态)模拟 `/v1/models` 响应 — OpenAI 形态 / Anthropic 形态分开测。

`test_remote_fetch_errors.py` 直接构造 `httpx.HTTPStatusError`,测 `format_remote_fetch_error` 的字符串化逻辑。

---

## 7. e2e 测试

`tests/e2e/test_model_fetch_flow.py` 是唯一的 e2e — 跑完整链路:

1. POST /providers 创建 provider
2. POST /providers/{code}/credentials 保存凭证(MultiFernet 加密走真路径)
3. POST /providers/{code}/models/remote 触发 RemoteModelFetcher(httpx mock)
4. GET /providers/{code}/models 验证模型已落库 + is_enabled=False

**特意保留 e2e**:provider/credentials/remote 三个 service 之间的 SQL 关系 + cache invalidation 容易出错,纯单元测试覆盖不到「整张图都对」的语义。

---

## 8. 已知盲点

### 8.1 _stream_with_think_detection 的边界

`test_ai_routes.py` 验证了"流式发 result 事件",但没单独覆盖:

- 首字节前重试 1 次成功 → 无 error 帧透传到客户端
- think 标签横跨 chunk 边界 → 标签不会泄露到正文

应该补:在 `tests/` 加 `test_stream_think_detection.py`,直接 patch `LlmRouter.stream_chat` 让它 yield 序列 `["<thi", "nk>foo</think>bar"]`,断言客户端收到 `[delta(foo, isThink=True), delta(bar, isThink=False)]`。

### 8.2 Vector Store 的并发 embed

`upsert_post_embedding` 的 `asyncio.Semaphore(self._chunk_concurrency=5)` 没单测 — 改成 1 / 100 都不会让现有测试失败。`test_profile_reindex_stream.py` 是间接测试(进度帧序列),但不验并发上限。

### 8.3 dim 校验

`upsert_post_embedding`(`vector_store.py:302-313`)校验"所有 chunk 的 embedding 维度一致"。这是防"模型返回 mixed-dim"的兜底,但**没测试**。要补:让 fake `embed()` 返回不一致的向量,断言 `_mark_post_failed` 被调 + raise ValueError。

### 8.4 Mock 模式与 override

`AI_MOCK_MODE=true and resolved.override=True` 时**不**返回 mock — 让管理员能在本地"测真实模型"。这条分支只在 `test_credential_resolver_service` / fixture 路径里被间接覆盖,没专门测。

---

## 9. 跑测试的本地命令

```bash
cd apps/ai-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
pytest                       # 默认走 cov,失败如 < 80%
pytest --no-cov              # 关 cov 跑得快
pytest tests/test_chunker.py # 单文件
pytest -k qa                 # 关键字过滤
pytest -x                    # 第一个失败就停
```

CI 配置(`.github/workflows/*.yml` 或 `start.sh`)按 `pytest -q` 运行;具体见模块 10(infrastructure-devops)。

---

## 10. 扩展点(测试侧)

### 10.1 加新 task type

在 `test_ai_routes.py` 加一组 fixtures:

```python
def test_new_task_returns_data_payload(app_with_mock):
    # POST /api/v1/ai/<new_task>
    # 断言 ApiResponse[NewTaskData]
```

并在 schema 层加对应的 `NewTaskRequest` / `NewTaskData`。`_build_stream_result_payload` 也要加 task_type 分支并加流式测试。

### 10.2 加新 chunker

`tests/test_chunker_<new>.py` 模板 — 锁住:

- 空文档返回空列表(让 caller 标 INDEXED 而不是 FAILED)
- 短文档不会爆出多个 chunk
- 长文档边界正确(parent_text / overlap)

### 10.3 加新 provider api_type

`tests/test_remote_model_fetcher_service.py` 新增分支测试 — 锁住:

- 对应 SDK 的 `/v1/models` 端点解析
- normalize_api_base 的处理
- model_id 的前缀映射

并在 `test_provider_routes.py` 测 ProviderCreate / ModelSyncRequest 通过新 api_type。

---

## 11. 质量信号(看哪里判断 ai-service 健康)

按优先级:

1. **Coverage 报告** — `pytest` 末尾输出。任何 PR 让覆盖率从 80%+ 跌就要看具体行
2. **Docker logs grep**(运行时):
    - `embed.start_env_fallback` → routing 表 embedding 任务没配
    - `rate_limit.redis_error_fail_closed` → Redis 不可达,所有 AI 端点 503
    - `jwt_keys.refresh_failed` → DB 抖动 / 表迁移没跑
    - `llm_router.chat_primary_failed_using_fallback` → primary provider 异常但 fallback 救场
    - `ai.summary_output_oversize_truncated` → 模型超字数被软上限截断
    - `ai_usage_log_failed.alert` → usage_logger 失败累计触发告警阈值
3. **`/api/v1/admin/metrics/ai` snapshot** — 单进程内存指标,看错误率与 latency
4. **`ai_usage_logs` 表** — 全量记录每次调用的 tokens / cost / success / latency,可用 SQL aggregate 拿真实趋势
