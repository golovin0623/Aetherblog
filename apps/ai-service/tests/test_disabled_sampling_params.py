"""disabledParams 服务端强制：管理端勾选的「调用时省略」采样参数须在请求路径生效。"""
from __future__ import annotations

from app.api.routes.agent import _agent_completion_kwargs
from app.services.llm_router import (
    SAMPLING_PARAMS,
    _completion_kwargs,
    resolve_disabled_sampling_params,
)


# ------------------------------------------------------------------
# resolve_disabled_sampling_params
# ------------------------------------------------------------------
def test_resolve_filters_to_sampling_whitelist():
    caps = {"settings": {"disabledParams": ["temperature", "top_p", "bogus", "reasoningEffort"]}}
    assert resolve_disabled_sampling_params(caps) == ("temperature", "top_p")


def test_resolve_dedupes_and_keeps_order():
    caps = {"settings": {"disabledParams": ["top_p", "top_p", "temperature"]}}
    assert resolve_disabled_sampling_params(caps) == ("top_p", "temperature")


def test_resolve_handles_missing_or_malformed():
    assert resolve_disabled_sampling_params(None) == ()
    assert resolve_disabled_sampling_params({}) == ()
    assert resolve_disabled_sampling_params({"settings": 1}) == ()
    assert resolve_disabled_sampling_params({"settings": {"disabledParams": "temperature"}}) == ()


def test_sampling_whitelist_is_the_four_standard_params():
    assert SAMPLING_PARAMS == {"temperature", "top_p", "frequency_penalty", "presence_penalty"}


# ------------------------------------------------------------------
# _completion_kwargs honors disabled temperature
# ------------------------------------------------------------------
def test_completion_kwargs_drops_disabled_temperature():
    kwargs = _completion_kwargs(
        model="custom/my-reasoner", temperature=0.7, max_tokens=100, disabled_params=("temperature",)
    )
    assert "temperature" not in kwargs
    assert kwargs["max_tokens"] == 100


def test_completion_kwargs_keeps_temperature_when_not_disabled():
    kwargs = _completion_kwargs(model="custom/my-model", temperature=0.7, max_tokens=100)
    assert kwargs["temperature"] == 0.7


# ------------------------------------------------------------------
# _agent_completion_kwargs honors disabled top_p / penalties
# ------------------------------------------------------------------
def test_agent_kwargs_drops_disabled_top_p_and_temperature():
    kwargs = _agent_completion_kwargs(
        model="custom/my-model",
        temperature=0.7,
        max_tokens=100,
        model_params={"top_p": 0.5, "temperature": 0.9, "presence_penalty": 1.0},
        disabled_params=("temperature", "top_p"),
    )
    assert "temperature" not in kwargs
    assert "top_p" not in kwargs
    # 未被屏蔽的 presence_penalty 仍生效
    assert kwargs.get("presence_penalty") == 1.0


def test_agent_kwargs_applies_top_p_when_not_disabled():
    kwargs = _agent_completion_kwargs(
        model="custom/my-model",
        temperature=0.7,
        max_tokens=100,
        model_params={"top_p": 0.5},
    )
    assert kwargs.get("top_p") == 0.5
