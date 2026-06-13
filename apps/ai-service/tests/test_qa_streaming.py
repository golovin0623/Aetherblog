"""QA RAG 端点 (`GET /api/v1/search/qa`) 的流式协议测试。

历史上该端点只发 `delta` + 自定义 `sources` + `done` 三种事件,导致通用流式
消费者 (`useStreamResponse` 等) 无法拿到结构化结果。本测试锁定升级后的契约：
在 `done` 之前必须额外下发标准 `result` 事件,payload 形态为
`{type:"result", data:{answer, sources}}`。`sources` 自定义事件继续保留以
兼容 blog SearchPanel 旧消费者。
"""

import json

from fastapi.testclient import TestClient

from app.api.deps import (
    get_llm_router,
    get_pg_pool,
    get_vector_store,
    require_admin_or_internal,
)
from app.core.jwt import UserClaims
from app.main import app
from tests.support import FakeConn, FakePool

client = TestClient(app)


class FakeVectorStore:
    def __init__(self, results):
        self.results = results
        self.calls = 0
        self.active_profile = object()
        self.last_profile = None

    async def get_active_profile(self):
        return self.active_profile

    async def semantic_search(self, q, limit, profile=None):  # noqa: ARG002 — 与真实签名对齐
        self.calls += 1
        self.last_profile = profile
        return self.results


class FailingVectorStore:
    def __init__(self, error: Exception) -> None:
        self.error = error
        self.calls = 0
        self.active_profile = object()

    async def get_active_profile(self):
        return self.active_profile

    async def semantic_search(self, q, limit, profile=None):  # noqa: ARG002
        self.calls += 1
        raise self.error


class FakeLlmRouter:
    def __init__(self, chunks):
        self.chunks = chunks
        self.last_call = None

    async def stream_chat(self, *, prompt_variables, model_alias):
        self.last_call = {"prompt_variables": prompt_variables, "model_alias": model_alias}
        for chunk in self.chunks:
            yield chunk

    async def has_task_routing(self, task_type, user_id=None):  # noqa: ARG002 — 与真实签名对齐
        return True


def _parse_sse_payloads(body: bytes) -> list[dict]:
    events: list[dict] = []
    for raw in body.decode("utf-8").split("\n\n"):
        line = raw.strip()
        if not line.startswith("data:"):
            continue
        try:
            events.append(json.loads(line[len("data:"):].strip()))
        except json.JSONDecodeError:
            pass
    return events


async def _mock_admin():
    return UserClaims(user_id="1", role="admin", scopes=None)


async def _mock_empty_pool():
    return FakePool(FakeConn())


def test_qa_emits_result_event_with_sources_before_done():
    sources_results = [
        {
            "post": {"title": "FastAPI 流式回应", "slug": "fastapi-streaming"},
            "highlight": "FastAPI 通过 StreamingResponse 支持 SSE",
        },
        {
            "post": {"title": "RAG 实践", "slug": "rag-best-practices"},
            "highlight": "RAG 把检索结果塞回 prompt 的相关段落",
        },
    ]
    chunks = ["RAG", " 把检索", "结果"]
    vector_store = FakeVectorStore(sources_results)

    async def mock_get_vector_store():
        return vector_store

    async def mock_get_llm_router():
        return FakeLlmRouter(chunks)

    app.dependency_overrides[require_admin_or_internal] = _mock_admin
    app.dependency_overrides[get_vector_store] = mock_get_vector_store
    app.dependency_overrides[get_llm_router] = mock_get_llm_router
    app.dependency_overrides[get_pg_pool] = _mock_empty_pool

    try:
        response = client.get("/api/v1/search/qa", params={"q": "什么是 RAG"})
    finally:
        app.dependency_overrides = {}

    assert response.status_code == 200
    events = _parse_sse_payloads(response.content)
    types = [e.get("type") for e in events]

    # 四种事件必须齐全, 且每种至少出现一次
    assert types.count("delta") == len(chunks)
    assert "sources" in types
    assert "result" in types
    assert "done" in types

    last_delta_idx = max(i for i, t in enumerate(types) if t == "delta")
    sources_idx = types.index("sources")
    result_idx = types.index("result")
    done_idx = types.index("done")

    # 顺序契约: delta* → sources → result → done
    assert last_delta_idx < sources_idx
    assert sources_idx < result_idx
    assert result_idx < done_idx

    # result payload 必须包含累积 answer + 与 sources 事件一致的来源列表
    expected_sources = [
        {"title": "FastAPI 流式回应", "slug": "fastapi-streaming"},
        {"title": "RAG 实践", "slug": "rag-best-practices"},
    ]
    result_event = events[result_idx]
    data = result_event["data"]
    assert data["answer"] == "".join(chunks)
    assert data["sources"] == expected_sources

    # 向后兼容: sources 自定义事件载荷与 result.data.sources 一致
    sources_event = events[sources_idx]
    assert sources_event["sources"] == expected_sources
    assert vector_store.last_profile is vector_store.active_profile


def test_qa_falls_back_to_public_blog_overview_when_semantic_has_no_hits():
    """空语义结果不能让 QA 直接回答“没找到”，应注入公开内容概览。"""

    def fetch(sql: str, _args):
        if "p.title ILIKE" in sql:
            return []
        if "FROM categories c" in sql:
            return [
                {"name": "系统架构", "post_count": 4},
                {"name": "AI 工程", "post_count": 3},
            ]
        if "FROM tags t" in sql:
            return [
                {"name": "RAG", "post_count": 2},
                {"name": "PostgreSQL", "post_count": 2},
            ]
        return [
            {
                "id": 9,
                "title": "知识库召回实践",
                "slug": "kb-rag-practice",
                "summary": "介绍博客内的 RAG、知识库和搜索实践。",
                "excerpt": "AetherBlog 使用公开文章、标签和搜索索引构建问答上下文。",
                "category": "AI 工程",
            }
        ]

    llm = FakeLlmRouter(["这个博客主要覆盖 AI 工程和系统架构。"])
    pool = FakePool(FakeConn(fetch=fetch))

    async def mock_get_vector_store():
        return FakeVectorStore([])

    async def mock_get_llm_router():
        return llm

    async def mock_get_pool():
        return pool

    app.dependency_overrides[require_admin_or_internal] = _mock_admin
    app.dependency_overrides[get_vector_store] = mock_get_vector_store
    app.dependency_overrides[get_llm_router] = mock_get_llm_router
    app.dependency_overrides[get_pg_pool] = mock_get_pool

    try:
        response = client.get("/api/v1/search/qa", params={"q": "博客里面有什么领域的知识"})
    finally:
        app.dependency_overrides = {}

    assert response.status_code == 200
    context = llm.last_call["prompt_variables"]["context"]
    assert "公开文章概览回退" in context
    assert "系统架构" in context
    assert "AI 工程" in context
    assert "知识库召回实践" in context

    events = _parse_sse_payloads(response.content)
    sources = next(e["sources"] for e in events if e.get("type") == "sources")
    assert sources == [{"title": "知识库召回实践", "slug": "kb-rag-practice"}]


def test_qa_falls_back_to_keyword_context_when_semantic_search_fails():
    """embedding/profile 故障时仍应使用公开关键词上下文，而不是中断问答。"""

    def fetch(sql: str, _args):
        if "p.title ILIKE" in sql:
            return [
                {
                    "id": 11,
                    "title": "PostgreSQL 向量检索",
                    "slug": "postgres-vector-search",
                    "summary": "pgvector 与全文检索混合搜索。",
                    "excerpt": "当语义检索暂不可用时，关键词检索仍可作为公开问答上下文。",
                    "category": "数据库",
                }
            ]
        return []

    llm = FakeLlmRouter(["可以参考 PostgreSQL 向量检索。"])

    async def mock_get_vector_store():
        return FailingVectorStore(RuntimeError("embedding timeout"))

    async def mock_get_llm_router():
        return llm

    async def mock_get_pool():
        return FakePool(FakeConn(fetch=fetch))

    app.dependency_overrides[require_admin_or_internal] = _mock_admin
    app.dependency_overrides[get_vector_store] = mock_get_vector_store
    app.dependency_overrides[get_llm_router] = mock_get_llm_router
    app.dependency_overrides[get_pg_pool] = mock_get_pool

    try:
        response = client.get("/api/v1/search/qa", params={"q": "PostgreSQL 向量"})
    finally:
        app.dependency_overrides = {}

    assert response.status_code == 200
    context = llm.last_call["prompt_variables"]["context"]
    assert "关键词回退命中的公开文章" in context
    assert "PostgreSQL 向量检索" in context


def test_qa_emits_auth_hint_when_no_public_context_available():
    """公开上下文完全为空时，应提示登录授权读取登录态内容，不再空跑 LLM。"""

    llm = FakeLlmRouter(["should not be used"])

    async def mock_get_vector_store():
        return FakeVectorStore([])

    async def mock_get_llm_router():
        return llm

    async def mock_get_pool():
        return FakePool(FakeConn())

    app.dependency_overrides[require_admin_or_internal] = _mock_admin
    app.dependency_overrides[get_vector_store] = mock_get_vector_store
    app.dependency_overrides[get_llm_router] = mock_get_llm_router
    app.dependency_overrides[get_pg_pool] = mock_get_pool

    try:
        response = client.get("/api/v1/search/qa", params={"q": "内部共享文章有什么"})
    finally:
        app.dependency_overrides = {}

    assert response.status_code == 200
    assert llm.last_call is None

    events = _parse_sse_payloads(response.content)
    types = [e.get("type") for e in events]
    assert types == ["delta", "auth_hint", "sources", "result", "done"]

    assert "登录" in events[0]["content"]
    assert events[1]["loginUrl"] == "/agent/login?next=/agent/workspace"
    assert events[1]["workspaceUrl"] == "/agent/workspace"
    assert events[2]["sources"] == []
    assert events[3]["data"]["authHint"]["label"] == "登录授权"


def test_qa_emits_error_event_on_llm_failure():
    """LLM 异常时必须发 error 事件并附带 code/message, 不能裸抛或留空。"""

    class BoomLlmRouter:
        async def has_task_routing(self, task_type, user_id=None):  # noqa: ARG002
            return True

        async def stream_chat(self, **_kwargs):
            yield "first chunk"
            raise RuntimeError("upstream timeout")

    async def mock_get_vector_store():
        return FakeVectorStore([
            {
                "post": {"title": "故障测试文章", "slug": "failure-case"},
                "highlight": "有上下文时才应进入 LLM 流式生成分支。",
            }
        ])

    async def mock_get_llm_router():
        return BoomLlmRouter()

    app.dependency_overrides[require_admin_or_internal] = _mock_admin
    app.dependency_overrides[get_vector_store] = mock_get_vector_store
    app.dependency_overrides[get_llm_router] = mock_get_llm_router
    app.dependency_overrides[get_pg_pool] = _mock_empty_pool

    try:
        response = client.get("/api/v1/search/qa", params={"q": "无关紧要"})
    finally:
        app.dependency_overrides = {}

    assert response.status_code == 200
    events = _parse_sse_payloads(response.content)
    types = [e.get("type") for e in events]

    assert "error" in types
    error_event = next(e for e in events if e.get("type") == "error")
    assert error_event.get("code") == "qa_error"
    assert "upstream timeout" in error_event.get("message", "")


def test_qa_emits_config_error_when_routing_missing():
    """QA 未配置对话模型路由时不能把 alias='qa' 交给 LiteLLM。"""

    class MissingRoutingLlmRouter:
        async def has_task_routing(self, task_type, user_id=None):  # noqa: ARG002
            return False

        async def stream_chat(self, **_kwargs):  # pragma: no cover - 若调用即说明前置 gate 失效
            raise AssertionError("stream_chat must not run without qa routing")

    vector_store = FakeVectorStore([])

    async def mock_get_vector_store():
        return vector_store

    async def mock_get_llm_router():
        return MissingRoutingLlmRouter()

    app.dependency_overrides[require_admin_or_internal] = _mock_admin
    app.dependency_overrides[get_vector_store] = mock_get_vector_store
    app.dependency_overrides[get_llm_router] = mock_get_llm_router
    app.dependency_overrides[get_pg_pool] = _mock_empty_pool

    try:
        response = client.get("/api/v1/search/qa", params={"q": "系统架构师需要什么能力"})
    finally:
        app.dependency_overrides = {}

    assert response.status_code == 200
    assert vector_store.calls == 0
    events = _parse_sse_payloads(response.content)
    assert events
    assert events[0].get("type") == "error"
    assert events[0].get("code") == "qa_routing_missing"
    assert "搜索配置" in events[0].get("message", "")
