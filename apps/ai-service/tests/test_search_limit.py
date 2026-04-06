from fastapi.testclient import TestClient
from app.main import app
from app.api.deps import rate_limit, get_vector_store, get_metrics, get_usage_logger, get_cache, get_llm_router
from app.core.config import get_settings
from app.core.jwt import UserClaims

client = TestClient(app)

def test_semantic_search_content_limit():
    settings = get_settings()

    # Mock dependencies
    async def mock_rate_limit():
        return UserClaims(user_id="1", role="user", scopes=[])

    class MockVectorStore:
        async def semantic_search(self, q, limit):
            return []

    class MockMetrics:
        def record(self, **kwargs):
            pass

    class MockUsageLogger:
        async def record(self, **kwargs):
            pass

    async def mock_vector_store():
        return MockVectorStore()

    async def mock_metrics():
        return MockMetrics()

    async def mock_usage_logger():
        return MockUsageLogger()

    app.dependency_overrides[rate_limit] = mock_rate_limit
    app.dependency_overrides[get_vector_store] = mock_vector_store
    app.dependency_overrides[get_metrics] = mock_metrics
    app.dependency_overrides[get_usage_logger] = mock_usage_logger

    try:
        # Create a large payload
        # Ensure it's significantly larger than the limit
        large_q = "a" * (settings.max_input_chars + 100)

        response = client.get("/api/v1/search/semantic", params={"q": large_q})

        assert response.status_code == 413
    finally:
        app.dependency_overrides = {}


class MockMetrics:
    def __init__(self):
        self.calls = []

    def record(self, **kwargs):
        self.calls.append(kwargs)


class MockUsageLogger:
    def __init__(self):
        self.calls = []

    async def record(self, **kwargs):
        self.calls.append(kwargs)


class MockLLM:
    def __init__(self, response_text="摘要结果", chat_exc=None):
        self.response_text = response_text
        self.chat_exc = chat_exc
        self.chat_calls = []

    async def resolve_usage_context(self, *_args, **_kwargs):
        return {
            "model": "openai/gpt-5-mini",
            "provider_code": "openai",
            "model_id": "gpt-5-mini",
            "input_cost_per_1m": 1.0,
            "output_cost_per_1m": 2.0,
            "cached_input_cost_per_1m": 0.5,
        }

    async def chat(self, **_kwargs):
        self.chat_calls.append(_kwargs)
        if self.chat_exc is not None:
            raise self.chat_exc
        return self.response_text


class FailingCache:
    def __init__(self):
        self.writes = []

    async def get_json(self, _key):
        raise RuntimeError("redis unavailable")

    async def set_json(self, key, value, ttl_seconds):
        self.writes.append((key, value, ttl_seconds))


def _install_ai_overrides(*, cache, llm, metrics, usage_logger):
    async def mock_rate_limit():
        return UserClaims(user_id="1", role="user", scopes=[])

    def mock_cache():
        return cache

    async def mock_llm():
        return llm

    def mock_metrics():
        return metrics

    async def mock_usage_logger():
        return usage_logger

    app.dependency_overrides[rate_limit] = mock_rate_limit
    app.dependency_overrides[get_cache] = mock_cache
    app.dependency_overrides[get_llm_router] = mock_llm
    app.dependency_overrides[get_metrics] = mock_metrics
    app.dependency_overrides[get_usage_logger] = mock_usage_logger


def test_summary_ignores_cache_read_failures():
    cache = FailingCache()
    metrics = MockMetrics()
    usage_logger = MockUsageLogger()

    _install_ai_overrides(
        cache=cache,
        llm=MockLLM(response_text="缓存失败时仍然成功"),
        metrics=metrics,
        usage_logger=usage_logger,
    )

    try:
        response = client.post("/api/v1/ai/summary", json={"content": "这是要生成摘要的正文。", "maxLength": 120})

        assert response.status_code == 200
        payload = response.json()
        assert payload["success"] is True
        assert payload["data"]["summary"] == "缓存失败时仍然成功"
        assert cache.writes
    finally:
        app.dependency_overrides = {}


def test_summary_maps_provider_failures_to_bad_gateway():
    usage_logger = MockUsageLogger()

    _install_ai_overrides(
        cache=FailingCache(),
        llm=MockLLM(chat_exc=RuntimeError("Invalid API key provided")),
        metrics=MockMetrics(),
        usage_logger=usage_logger,
    )

    try:
        response = client.post("/api/v1/ai/summary", json={"content": "这是要生成摘要的正文。", "maxLength": 120})

        assert response.status_code == 502
        payload = response.json()
        assert payload["success"] is False
        assert payload["message"] == "AI provider authentication failed"
        assert usage_logger.calls[0]["success"] is False
        assert usage_logger.calls[0]["error_code"] == "AI provider authentication failed"
    finally:
        app.dependency_overrides = {}


def test_titles_accepts_legacy_count_alias():
    llm = MockLLM(response_text="标题一, 标题二, 标题三")

    _install_ai_overrides(
        cache=FailingCache(),
        llm=llm,
        metrics=MockMetrics(),
        usage_logger=MockUsageLogger(),
    )

    try:
        response = client.post("/api/v1/ai/titles", json={"content": "这是标题生成的正文。", "count": 3})

        assert response.status_code == 200
        payload = response.json()
        assert payload["success"] is True
        assert payload["data"]["titles"] == ["标题一", "标题二", "标题三"]
        assert llm.chat_calls[0]["prompt_variables"]["max_titles"] == 3
    finally:
        app.dependency_overrides = {}


def test_polish_accepts_legacy_style_fields():
    llm = MockLLM(response_text="这是润色后的正文。")

    _install_ai_overrides(
        cache=FailingCache(),
        llm=llm,
        metrics=MockMetrics(),
        usage_logger=MockUsageLogger(),
    )

    try:
        response = client.post(
            "/api/v1/ai/polish",
            json={
                "content": "这是待润色的正文。",
                "style": "professional",
                "polishType": "all",
            },
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["success"] is True
        assert payload["data"]["polishedContent"] == "这是润色后的正文。"
        assert llm.chat_calls[0]["prompt_variables"]["tone"] == "专业"
    finally:
        app.dependency_overrides = {}
