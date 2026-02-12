from fastapi.testclient import TestClient
from app.main import app
from app.api.deps import rate_limit, get_vector_store, get_metrics, get_usage_logger
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

        response = client.get(f"/api/v1/search/semantic", params={"q": large_q})

        assert response.status_code == 413
    finally:
        app.dependency_overrides = {}
