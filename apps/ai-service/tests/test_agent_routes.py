from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.api.routes import agent as agent_module
from app.api.routes.agent import AgentChatMessage, AgentChatRequest
from app.services.llm_router import LlmRouter


def _resolved_route(*, override: bool = True) -> LlmRouter._ResolvedRoute:
    return LlmRouter._ResolvedRoute(
        model="openai/gemini-3.1-pro-preview",
        provider_code="google-proxy",
        model_id="gemini-3.1-pro-preview",
        input_cost_per_1m=None,
        output_cost_per_1m=None,
        cached_input_cost_per_1m=None,
        api_key="sk-test",
        api_base=None,
        temperature=0.7,
        max_tokens=None,
        prompt_template=None,
        override=override,
    )


class FakeAgentRouter:
    def __init__(self, *, override_result: Any = None, override_error: Exception | None = None) -> None:
        self.model_router = SimpleNamespace(resolve_routing=None)
        self.override_result = override_result
        self.override_error = override_error
        self.override_calls: list[dict[str, Any]] = []

    async def _resolve_override(self, **kwargs: Any) -> Any:
        self.override_calls.append(kwargs)
        if self.override_error:
            raise self.override_error
        return self.override_result

    async def _guard_api_base(self, _api_base: str | None) -> None:
        return None


@pytest.mark.asyncio
async def test_resolve_for_agent_honors_model_picker_override() -> None:
    router = FakeAgentRouter(override_result=_resolved_route())

    resolved = await agent_module._resolve_for_agent(
        router,
        user_id=7,
        model_id="gemini-3.1-pro-preview",
        provider_code="google-proxy",
    )

    assert resolved.override is True
    assert resolved.model_id == "gemini-3.1-pro-preview"
    assert router.override_calls == [
        {
            "model_id": "gemini-3.1-pro-preview",
            "provider_code": "google-proxy",
            "user_id": 7,
            "model_alias": "agent",
            "allow_override": True,
        }
    ]


@pytest.mark.asyncio
async def test_resolve_for_agent_rejects_invalid_override() -> None:
    router = FakeAgentRouter(override_error=ValueError("Requested model not found"))

    with pytest.raises(HTTPException) as exc:
        await agent_module._resolve_for_agent(
            router,
            user_id=7,
            model_id="missing-model",
            provider_code="google-proxy",
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == "Requested model not found"


@pytest.mark.asyncio
async def test_agent_chat_passes_payload_model_to_resolver(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_resolve_for_agent(llm_router: Any, **kwargs: Any) -> LlmRouter._ResolvedRoute:
        captured["llm_router"] = llm_router
        captured.update(kwargs)
        return _resolved_route()

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    router = FakeAgentRouter()
    payload = AgentChatRequest(
        sessionId="s1",
        mode="chat",
        messages=[AgentChatMessage(role="user", content="ping")],
        modelId="gemini-3.1-pro-preview",
        providerCode="google-proxy",
    )

    response = await agent_module.agent_chat(
        request=None,
        payload=payload,
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=router,
        pool=object(),
    )

    assert response.status_code == 200
    assert captured == {
        "llm_router": router,
        "user_id": 7,
        "model_id": "gemini-3.1-pro-preview",
        "provider_code": "google-proxy",
    }
