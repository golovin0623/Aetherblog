"""Agent 对话与模型选择端点 —— 给 /agent/workspace 使用。

设计要点
========

* **多轮原生**：与现有 ``ai/summary``、``search/qa`` 不同，本端点直接接受
  ``messages: [{role, content}, ...]`` 数组，不走 prompt template 渲染。
* **路由复用**：通过 ``LlmRouter._resolve_route(...)`` 拿到底层 provider/model/
  credential，再直接调用 ``litellm.acompletion`` 流式响应，仍然受统一 SSRF
  守卫、记账、fallback 配置约束。
* **鉴权**：``require_admin_or_internal`` —— Go 后端用 ``X-Internal-Service``
  token 做服务间转发，最终调用方是任意已登录用户。
* **任务别名 fallback**：默认 ``agent``。若数据库未配置该 task type，按顺序
  退到 ``qa`` → ``summary`` —— 这两个 task type 在生产环境都会有 routing 行
  （搜索 QA 与 admin 摘要必经路径），保证 Agent 工作台开箱即可用。

事件流格式（与 search.qa / ai.summary_stream 对齐）：

::

  data: {"type":"delta","content":"…"}\\n\\n
  data: {"type":"think","content":"…"}\\n\\n
  data: {"type":"done"}\\n\\n
  data: {"type":"error","code":"…","message":"…"}\\n\\n
"""

from __future__ import annotations

import json
import logging
import asyncio
import time
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from litellm import acompletion

from app.api.deps import (
    get_llm_router,
    get_metrics,
    get_pg_pool,
    get_usage_logger,
    require_admin_or_internal,
)
from app.core.config import get_settings
from app.schemas.common import ApiResponse
from app.services.llm_router import NON_CHAT_MODEL_TYPES, LlmRouter, _completion_kwargs
from app.services.metrics import MetricsStore
from app.services.usage_logger import UsageLogger, estimate_tokens

logger = logging.getLogger(__name__)

router = APIRouter(tags=["agent"])
settings = get_settings()


# ============================================================================
# 请求 / 响应 schema
# ============================================================================

class AgentChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"] = Field(..., description="角色")
    content: str = Field(..., description="内容")


class AgentAtlasScope(BaseModel):
    kpIds: list[int] | None = Field(default=None, max_length=12)
    carrierIds: list[int] | None = Field(default=None, max_length=6)
    neighborhoodDepth: int = Field(default=1, ge=0, le=2)
    includeEvidence: bool = True


class AgentChatRequest(BaseModel):
    sessionId: str = Field(..., min_length=1, max_length=128)
    mode: Literal["chat", "cowork", "code"] = "chat"
    messages: list[AgentChatMessage] = Field(..., min_length=1, max_length=64)
    # 前端 ModelPicker 显式选择的模型。服务端仍会重新校验：模型必须启用、
    # 类型必须可用于 chat，且当前用户必须能拿到该 provider 的凭证。
    modelId: str | None = None
    providerCode: str | None = None
    # @ picker 选中的文章 ID 列表 —— 后端会查 posts 表取标题 + 摘要 + 正文片段，
    # 拼成 system 段注入给 LLM，让 Agent 能"看到"用户引用的文章原文。
    articleIds: list[int] | None = Field(default=None, max_length=10)
    # # picker 选中的标签 slug 列表 —— 注入对应标签下最近 5 篇文章标题，给 Agent
    # 一个"该话题下站点写过哪些文章"的概览。
    tagSlugs: list[str] | None = Field(default=None, max_length=8)
    # KB picker 选中的知识库 ID 列表。后端会用最后一条 user 消息当 query，
    # 在选中的 KB 内做语义召回（每 KB 的 active profile 决定 model + top_k + threshold），
    # 把命中的 chunk 拼成额外 system 段注入给 LLM。
    kbIds: list[int] | None = Field(default=None, max_length=10)
    # Atlas picker 选中的 KnowledgePoint scope。读取时仍会按 X-Forwarded-User-ID
    # 约束 author，避免客户端手工拼接其他用户的 KP。
    atlasScope: AgentAtlasScope | None = None
    # 前端侧栏按模型 capabilities.parameters / settings.extendParams 生成的
    # 本轮模型参数覆盖。只允许少量兼容字段进入 LiteLLM 请求，避免把任意 JSON
    # 直接透传给上游。
    modelParams: dict[str, Any] | None = None


class AgentModelItem(BaseModel):
    """ModelPicker 下拉的一行。"""
    providerCode: str
    providerName: str | None = None
    providerIcon: str | None = None
    modelId: str
    displayName: str | None = None
    contextWindow: int | None = None
    maxOutputTokens: int | None = None
    isDefault: bool = False
    abilities: dict[str, bool] = Field(default_factory=dict)
    extendParams: list[str] = Field(default_factory=list)
    settings: dict[str, Any] = Field(default_factory=dict)
    parameters: dict[str, Any] = Field(default_factory=dict)
    disabledParams: list[str] = Field(default_factory=list)
    source: str | None = None
    releasedAt: str | None = None
    description: str | None = None
    # scope 标记: "user" 表示该 provider 在当前用户名下有专属凭证；
    # "system" 表示用的是系统级（user_id IS NULL）凭证。前端可据此显示徽标。
    scope: str = "system"


def _parse_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, float) and value.is_integer():
        parsed = int(value)
        return parsed if parsed > 0 else None
    if isinstance(value, str):
        try:
            parsed = int(value)
        except ValueError:
            return None
        return parsed if parsed > 0 else None
    return None


def _normalize_flags(value: Any) -> set[str]:
    if isinstance(value, list):
        raw_items = value
    elif isinstance(value, str):
        raw_items = value.replace("|", ",").replace(" ", ",").split(",")
    else:
        raw_items = []
    return {str(item).strip().lower() for item in raw_items if str(item).strip()}


def _resolve_agent_model_abilities(caps: dict[str, Any]) -> dict[str, bool]:
    nested = caps.get("abilities") if isinstance(caps.get("abilities"), dict) else {}
    flags = _normalize_flags(caps.get("ability") or caps.get("abilities"))

    def has_flag(*names: str) -> bool:
        return any(name.lower() in flags for name in names)

    return {
        "functionCall": bool(
            nested.get("functionCall")
            or caps.get("function_calling")
            or caps.get("function_call")
            or has_flag("functioncall", "function_call", "fc", "tool", "tools")
        ),
        "vision": bool(nested.get("vision") or caps.get("vision") or has_flag("vision", "image_input")),
        "reasoning": bool(nested.get("reasoning") or caps.get("reasoning") or has_flag("reasoning", "think")),
        "search": bool(nested.get("search") or caps.get("web_search") or has_flag("search", "web_search")),
        "imageOutput": bool(
            nested.get("imageOutput")
            or caps.get("image_generation")
            or has_flag("imageoutput", "image_output", "image_generation")
        ),
        "video": bool(nested.get("video") or caps.get("video") or has_flag("video")),
        "files": bool(nested.get("files") or caps.get("files") or has_flag("file", "files")),
        "structuredOutput": bool(
            nested.get("structuredOutput")
            or caps.get("structured_output")
            or has_flag("structuredoutput", "structured_output", "json_schema")
        ),
    }


def _resolve_agent_model_settings(caps: dict[str, Any]) -> dict[str, Any]:
    settings = caps.get("settings")
    return settings if isinstance(settings, dict) else {}


def _resolve_agent_extend_params(settings: dict[str, Any]) -> list[str]:
    raw = settings.get("extendParams")
    if not isinstance(raw, list):
        return []
    params: list[str] = []
    for item in raw:
        value = str(item).strip()
        if value and value not in params:
            params.append(value)
    return params


def _resolve_agent_disabled_params(settings: dict[str, Any]) -> list[str]:
    raw = settings.get("disabledParams")
    if not isinstance(raw, list):
        return []
    params: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        value = item.strip()
        if value and value not in params:
            params.append(value)
    return params


def _resolve_agent_model_parameters(caps: dict[str, Any]) -> dict[str, Any]:
    parameters = caps.get("parameters")
    return parameters if isinstance(parameters, dict) else {}


def _resolve_agent_context_window(row: Any, caps: dict[str, Any]) -> int | None:
    return (
        _parse_int(row["context_window"])
        or _parse_int(caps.get("contextWindowTokens"))
        or _parse_int(caps.get("contextWindow"))
        or _parse_int(caps.get("context_window"))
        or _parse_int(caps.get("maxToken"))
        or _parse_int(caps.get("max_token"))
    )


def _resolve_agent_max_output_tokens(row: Any, caps: dict[str, Any]) -> int | None:
    return (
        _parse_int(row["max_output_tokens"])
        or _parse_int(caps.get("maxOutputTokens"))
        or _parse_int(caps.get("maxOutput"))
        or _parse_int(caps.get("max_output_tokens"))
        or _parse_int(caps.get("max_output"))
    )


# 三种 mode 对应的 system prompt。
_MODE_SYSTEM_PROMPTS = {
    "chat": (
        "你是 AetherBlog 站点内嵌的 Agent。基于站点已有的文章、标签、设置回答用户的问题。"
        "回答简洁、直接、有结构；引用必备出处。无明确依据时坦率说明。"
    ),
    "cowork": (
        "你是 AetherBlog 的协作 Agent。把整个站点视为工作空间："
        "理解文章关系、可建议归类与重写。给出清单时分行编号；"
        "需要用户确认的操作前要明确告知风险与可逆性。"
    ),
    "code": (
        "你是 AetherBlog 的代码 Agent。"
        "面向具体文件和段落工作：先复述你的理解，再给出最小变更。"
        "代码块用三重反引号且声明语言。修改前后差异要点用 — 列出。"
    ),
}

# 当 'agent' 任务未配置 routing 时，按这个顺序回退到已有任务的路由。
# qa / summary 在生产环境通常都有配置，能保证开箱可用；任一命中即停止。
_FALLBACK_TASK_ALIASES = ("agent", "qa", "summary")
_GEMINI_THINKING_ALLOWED_OPENAI_PARAMS = ["reasoning_effort", "extra_body"]
_GEMINI_THINKING_EXTRA_BODY = {
    # LiteLLM 将 ``extra_body`` 传递给底层的 OpenAI Python 客户端作为
    # 客户端的逃生舱。为了让兼容 OpenAI 的网关接收
    # 一个名为 ``extra_body`` 的 JSON body 字段（这是 Gemini 兼容层所使用的），
    # 这里必须嵌套更深一层。
    "extra_body": {"google": {"thinking_config": {"include_thoughts": True}}},
}
_AGENT_REASONING_EFFORTS = {"none", "minimal", "low", "medium", "high", "xhigh", "max"}


# ============================================================================
# 共用工具
# ============================================================================

def _enforce_message_limits(req: AgentChatRequest) -> None:
    """对单次请求体做硬封顶，防止 admin token 被滥用做 OOM/费用 DoS。"""
    total = 0
    for m in req.messages:
        if len(m.content) > 8000:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"单条消息超过 8000 字符 (实际 {len(m.content)})",
            )
        total += len(m.content)
    if total > 32000:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"对话总长超过 32000 字符 (实际 {total})",
        )


def _build_chat_messages(req: AgentChatRequest, context_block: str | None = None) -> list[dict]:
    """把请求里的 messages 数组转成 LiteLLM 的 OpenAI-style 消息格式。

    最前面注入：
      1. mode 对应的 system prompt（用户没显式带 system 时）；
      2. context_block（来自 @文章 / #标签 picker 的引用素材，可空）。
    """
    messages: list[dict] = []
    has_user_system = any(m.role == "system" for m in req.messages)
    if not has_user_system:
        sys_prompt = _MODE_SYSTEM_PROMPTS.get(req.mode, _MODE_SYSTEM_PROMPTS["chat"])
        messages.append({"role": "system", "content": sys_prompt})
    if context_block:
        messages.append({"role": "system", "content": context_block})
    for m in req.messages:
        messages.append({"role": m.role, "content": m.content})
    return messages


def _bare_model_id(model: str | None) -> str:
    if not model:
        return ""
    return model.split("/", 1)[1] if "/" in model else model


def _is_gemini_model(model: str | None) -> bool:
    return _bare_model_id(model).lower().startswith("gemini-")


def _coerce_float_param(
    params: dict[str, Any] | None,
    key: str,
    *,
    minimum: float,
    maximum: float,
) -> float | None:
    if not params or key not in params:
        return None
    value = params.get(key)
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not (minimum <= parsed <= maximum):
        return None
    return parsed


def _coerce_int_param(
    params: dict[str, Any] | None,
    key: str,
    *,
    minimum: int,
    maximum: int,
) -> int | None:
    if not params or key not in params:
        return None
    value = params.get(key)
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not (minimum <= parsed <= maximum):
        return None
    return parsed


def _coerce_reasoning_effort(params: dict[str, Any] | None) -> str | None:
    if not params or "reasoning_effort" not in params:
        return None
    value = str(params.get("reasoning_effort") or "").strip().lower()
    return value if value in _AGENT_REASONING_EFFORTS else None


def _model_omits_sampling(model: str) -> bool:
    # Reuse the central LiteLLM compatibility helper without importing another
    # private symbol: locked sampling models will drop temperature from kwargs.
    return "temperature" not in _completion_kwargs(
        model=model,
        temperature=0.7,
        max_tokens=None,
    )


def _agent_completion_kwargs(
    *,
    model: str,
    temperature: float | None,
    max_tokens: int | None,
    model_params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    override_temperature = _coerce_float_param(
        model_params,
        "temperature",
        minimum=0,
        maximum=2,
    )
    override_max_tokens = _coerce_int_param(
        model_params,
        "max_tokens",
        minimum=1,
        maximum=131_072,
    )
    override_top_p = _coerce_float_param(
        model_params,
        "top_p",
        minimum=0,
        maximum=1,
    )
    override_presence_penalty = _coerce_float_param(
        model_params,
        "presence_penalty",
        minimum=-2,
        maximum=2,
    )
    override_frequency_penalty = _coerce_float_param(
        model_params,
        "frequency_penalty",
        minimum=-2,
        maximum=2,
    )
    override_reasoning_effort = _coerce_reasoning_effort(model_params)

    kwargs = _completion_kwargs(
        model=model,
        temperature=override_temperature if override_temperature is not None else temperature,
        max_tokens=override_max_tokens if override_max_tokens is not None else max_tokens,
    )
    if not _model_omits_sampling(model):
        if override_top_p is not None:
            kwargs["top_p"] = override_top_p
        if override_presence_penalty is not None:
            kwargs["presence_penalty"] = override_presence_penalty
        if override_frequency_penalty is not None:
            kwargs["frequency_penalty"] = override_frequency_penalty
    if override_reasoning_effort:
        kwargs["reasoning_effort"] = override_reasoning_effort
    if _is_gemini_model(model):
        # Google 兼容 OpenAI 的 API 要求 include_thoughts=True 来返回
        # 可见的思维摘要；reasoning_effort 仅控制预算/级别。
        kwargs.setdefault("reasoning_effort", "low")
        kwargs["extra_body"] = _GEMINI_THINKING_EXTRA_BODY
        # LiteLLM 在转发兼容 OpenAI 的请求前验证参数。
        # Gemini 的兼容层支持这些字段，即使 LiteLLM 通过
        # 通用的 "openai/" 提供商前缀路由。
        kwargs["allowed_openai_params"] = _GEMINI_THINKING_ALLOWED_OPENAI_PARAMS
    return kwargs


def _without_agent_thinking_kwargs(kwargs: dict[str, Any]) -> dict[str, Any]:
    fallback = dict(kwargs)
    for key in ("reasoning_effort", "extra_body", "allowed_openai_params"):
        fallback.pop(key, None)
    return fallback


def _looks_like_thinking_param_rejection(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(
        marker in text
        for marker in (
            "reasoning_effort",
            "thinking_config",
            "include_thoughts",
            "extra_body",
        )
    )


def _coerce_delta_text(value: Any) -> str:
    """从 LiteLLM/OpenAI-style delta 字段中提取可展示文本。"""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        block_type = str(value.get("type") or "").lower()
        if block_type.startswith("redacted"):
            return ""
        for key in (
            "content",
            "text",
            "summary",
            "reasoning_content",
            "reasoning",
            "thinking",
            "thought",
        ):
            text = _coerce_delta_text(value.get(key))
            if text:
                return text
        return ""
    if isinstance(value, list):
        return "".join(_coerce_delta_text(item) for item in value)
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        try:
            dumped = model_dump()
        except Exception:  # pragma: no cover - 防御性兼容第三方对象
            return ""
        return _coerce_delta_text(dumped)
    data = getattr(value, "__dict__", None)
    if isinstance(data, dict):
        return _coerce_delta_text(data)
    return ""


def _get_delta_field(delta: Any, field: str) -> Any:
    if isinstance(delta, dict):
        return delta.get(field)
    value = getattr(delta, field, None)
    if value is not None:
        return value
    model_dump = getattr(delta, "model_dump", None)
    if callable(model_dump):
        try:
            dumped = model_dump()
        except Exception:  # pragma: no cover - 防御性兼容第三方对象
            return None
        if isinstance(dumped, dict):
            return dumped.get(field)
    return None


def _extract_delta_content(delta: Any) -> str:
    return _coerce_delta_text(_get_delta_field(delta, "content"))


def _extract_delta_content_events(delta: Any) -> list[dict[str, str]]:
    return _coerce_content_events(_get_delta_field(delta, "content"))


def _coerce_content_events(value: Any) -> list[dict[str, str]]:
    if value is None:
        return []
    if isinstance(value, str):
        return [{"type": "delta", "content": value}] if value else []
    if isinstance(value, list):
        events: list[dict[str, str]] = []
        for item in value:
            events.extend(_coerce_content_events(item))
        return events
    if isinstance(value, dict):
        block_type = str(value.get("type") or "").lower()
        if block_type.startswith("redacted"):
            return []
        text = _coerce_delta_text(value)
        if not text:
            return []
        return [{
            "type": "think" if value.get("thought") is True else "delta",
            "content": text,
        }]
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        try:
            dumped = model_dump()
        except Exception:  # pragma: no cover - 防御性兼容第三方对象
            return []
        return _coerce_content_events(dumped)
    data = getattr(value, "__dict__", None)
    if isinstance(data, dict):
        return _coerce_content_events(data)
    text = _coerce_delta_text(value)
    return [{"type": "delta", "content": text}] if text else []


def _extract_reasoning_content(delta: Any) -> str:
    # 不同 OpenAI-compatible provider / LiteLLM 版本对 reasoning 增量字段命名
    # 不完全一致。只抽取显式文本，不把结构化 usage / token 计数误当思考正文。
    for field in (
        "reasoning_content",
        "reasoning",
        "thinking",
        "thought",
        "thinking_blocks",
        "reasoning_items",
    ):
        text = _coerce_delta_text(_get_delta_field(delta, field))
        if text:
            return text
    provider_specific = _get_delta_field(delta, "provider_specific_fields")
    text = _coerce_delta_text(provider_specific)
    if text:
        return text
    return ""


class _ThinkTagSplitter:
    """把正文中的 <think>/<thinking>/<reasoning> 段拆成 SSE think 事件。"""

    def __init__(self) -> None:
        self._in_think = False
        self._buffer = ""
        self._guard = LlmRouter._THINK_TAG_GUARD  # noqa: SLF001

    def feed(self, content: str):
        if not content:
            return
        self._buffer += content
        yield from self._drain(final=False)

    def flush(self):
        yield from self._drain(final=True)

    def _drain(self, *, final: bool):
        while self._buffer:
            if final:
                boundary = len(self._buffer)
            else:
                # 仅在末尾可能包含未闭合 think 标签时保留 guard 长度，避免流式输出恒定滞后。
                last_lt = self._buffer.rfind("<")
                boundary = (
                    last_lt
                    if last_lt != -1 and len(self._buffer) - last_lt < self._guard
                    else len(self._buffer)
                )
            if boundary <= 0:
                return

            pattern = (
                LlmRouter._THINK_CLOSE_RE  # noqa: SLF001
                if self._in_think
                else LlmRouter._THINK_OPEN_RE  # noqa: SLF001
            )
            match = pattern.search(self._buffer)

            if match and match.end() <= boundary:
                head = self._buffer[: match.start()]
                if head:
                    yield {
                        "type": "think" if self._in_think else "delta",
                        "content": head,
                    }
                self._buffer = self._buffer[match.end():]
                self._in_think = not self._in_think
                continue

            if match is None or match.start() >= boundary:
                chunk = self._buffer[:boundary]
                self._buffer = self._buffer[boundary:]
                if chunk:
                    yield {
                        "type": "think" if self._in_think else "delta",
                        "content": chunk,
                    }
                continue

            return


async def _stream_litellm_agent_events(stream):
    """把 LiteLLM streaming chunk 转成 Agent SSE 事件。

    - provider 显式返回 ``reasoning_content`` 等字段时，直接映射为 ``think``；
    - provider 把推理轨迹混在正文 ``<think>...</think>`` 中时，拆分为 ``think``；
    - 普通正文继续作为 ``delta``。
    """
    splitter = _ThinkTagSplitter()
    async for part in stream:
        delta = part.choices[0].delta

        reasoning = _extract_reasoning_content(delta)
        if reasoning:
            yield {"type": "think", "content": reasoning}

        for content_event in _extract_delta_content_events(delta):
            content = content_event.get("content", "")
            if not content:
                continue
            if content_event.get("type") == "think":
                yield content_event
                continue
            for event in splitter.feed(content):
                yield event

    for event in splitter.flush():
        yield event


# 单篇正文截断阈值。MVP 期间整本博文塞进 prompt 不现实——按字符数硬截断让
# 大多数模型都能一次容下。后续可换成按 tokens 计数 + 智能 chunk。
_ARTICLE_EXCERPT_MAX_CHARS = 1800
_TAG_POST_LIMIT = 5


async def _build_kb_context_for_chat(
    pool,
    llm_router,
    *,
    kb_ids: list[int] | None,
    messages: list[AgentChatMessage],
) -> str | None:
    """对灵境对话注入 KB 召回上下文。

    步骤：
      1. 取最后一条 user 消息当 query（多轮时这通常是最新提问）。
      2. 调 kb_recall.recall_kbs 在 kb_ids 内做语义召回。
      3. 渲染为 system message 文本，外层负责与 picker_context 拼接。

    任一步骤失败都 swallow exception（不让对话失败），但会 warn 日志便于排查。
    """
    if not kb_ids:
        return None
    # 取最后一条 user 消息
    query = ""
    for m in reversed(messages):
        if m.role == "user":
            query = (m.content or "").strip()
            break
    if not query:
        return None
    try:
        # 局部导入避免顶部循环依赖
        from app.services.kb_recall import recall_kbs, render_kb_context
        hits = await recall_kbs(pool, llm_router, kb_ids=kb_ids, query=query, top_k_total=12)
    except Exception:
        logger.warning("agent.kb_recall_failed", extra={"data": {"kb_ids": kb_ids}})
        return None
    return render_kb_context(hits)


def _dedupe_positive_ints(values: list[int] | None, limit: int) -> list[int]:
    out: list[int] = []
    seen: set[int] = set()
    for value in values or []:
        if isinstance(value, bool):
            continue
        try:
            item = int(value)
        except (TypeError, ValueError):
            continue
        if item <= 0 or item in seen:
            continue
        seen.add(item)
        out.append(item)
        if len(out) >= limit:
            break
    return out


async def _build_atlas_context_for_chat(
    pool,
    *,
    atlas_scope: AgentAtlasScope | None,
    user_id: int | None,
) -> str | None:
    """Build an Aether Atlas context block for Agent chat.

    This is the first AetherHub integration layer: it reads selected KPs, one-hop
    relations, and evidence quotes. It deliberately scopes all reads by the
    forwarded user id and does not perform embedding/GraphRAG recall yet.
    """
    if atlas_scope is None or user_id is None:
        return None
    kp_ids = _dedupe_positive_ints(atlas_scope.kpIds, 12)
    carrier_ids = _dedupe_positive_ints(atlas_scope.carrierIds, 6)
    if not kp_ids and not carrier_ids:
        return None

    try:
        async with pool.acquire() as conn:
            if carrier_ids:
                carrier_kp_rows = await conn.fetch(
                    """
                    SELECT DISTINCT l.kp_id
                    FROM atlas_annotation_kp_links l
                    JOIN atlas_annotations a ON a.id = l.annotation_id
                    JOIN atlas_carriers c ON c.id = a.carrier_id
                    WHERE a.deleted = FALSE
                      AND c.deleted = FALSE
                      AND a.carrier_id = ANY($1::bigint[])
                      AND (a.author_id = $2 OR a.author_id IS NULL)
                      AND (c.owner_id = $2 OR c.owner_id IS NULL)
                    LIMIT 12
                    """,
                    carrier_ids,
                    user_id,
                )
                kp_ids = _dedupe_positive_ints(
                    [*kp_ids, *[int(r["kp_id"]) for r in carrier_kp_rows]],
                    12,
                )
            if not kp_ids:
                return None

            kp_rows = await conn.fetch(
                """
                SELECT id, title, body_markdown, type, status, confidence, provenance
                FROM atlas_knowledge_points
                WHERE deleted = FALSE
                  AND id = ANY($1::bigint[])
                  AND (author_id = $2 OR author_id IS NULL)
                ORDER BY updated_at DESC
                LIMIT 12
                """,
                kp_ids,
                user_id,
            )
            live_kp_ids = [int(r["id"]) for r in kp_rows]
            if not live_kp_ids:
                return None

            relation_rows = []
            if atlas_scope.neighborhoodDepth > 0:
                relation_rows = await conn.fetch(
                    """
                    SELECT id, from_kp_id, to_kp_id, type, strength, body_markdown
                    FROM atlas_typed_relations
                    WHERE deleted = FALSE
                      AND (from_kp_id = ANY($1::bigint[]) OR to_kp_id = ANY($1::bigint[]))
                      AND (author_id = $2 OR author_id IS NULL)
                    ORDER BY strength DESC, updated_at DESC
                    LIMIT 32
                    """,
                    live_kp_ids,
                    user_id,
                )

            evidence_rows = []
            if atlas_scope.includeEvidence:
                evidence_rows = await conn.fetch(
                    """
                    SELECT l.kp_id, l.role, a.id AS annotation_id, a.body_text, a.anchor_state,
                           c.title AS carrier_title, c.source_uri
                    FROM atlas_annotation_kp_links l
                    JOIN atlas_annotations a ON a.id = l.annotation_id
                    LEFT JOIN atlas_carriers c ON c.id = a.carrier_id
                    WHERE l.kp_id = ANY($1::bigint[])
                      AND a.deleted = FALSE
                      AND (a.author_id = $2 OR a.author_id IS NULL)
                    ORDER BY a.updated_at DESC
                    LIMIT 24
                    """,
                    live_kp_ids,
                    user_id,
                )
    except Exception:
        logger.warning("agent.atlas_context_failed", extra={"data": {"kp_ids": kp_ids}})
        return None

    parts: list[str] = [
        "# Aether Atlas Context",
        (
            "Use this Atlas context as grounded knowledge. When citing it, include "
            "citations like [KP #id] and [Evidence #annotation_id]. If the answer "
            "depends on evidence, mention the evidence citation."
        ),
        "## Knowledge Points",
    ]
    for r in kp_rows:
        body = (r["body_markdown"] or "").strip()
        if len(body) > 900:
            body = body[:900] + "…"
        parts.append(
            f"- [KP #{r['id']}] {r['title']} "
            f"(type={r['type']}, status={r['status']}, confidence={float(r['confidence']):.2f}, provenance={r['provenance']})"
        )
        if body:
            parts.append(f"  Body: {body}")

    if relation_rows:
        parts.append("## Relations")
        for r in relation_rows:
            rationale = (r["body_markdown"] or "").strip()
            if len(rationale) > 360:
                rationale = rationale[:360] + "…"
            line = (
                f"- [Relation #{r['id']}] KP #{r['from_kp_id']} --{r['type']} "
                f"({float(r['strength']):.2f})--> KP #{r['to_kp_id']}"
            )
            if rationale:
                line += f"; rationale: {rationale}"
            parts.append(line)

    if evidence_rows:
        parts.append("## Evidence")
        for r in evidence_rows:
            quote = (r["body_text"] or "").strip()
            if len(quote) > 500:
                quote = quote[:500] + "…"
            source = r["carrier_title"] or r["source_uri"] or "unknown source"
            parts.append(
                f"- [Evidence #{r['annotation_id']}] for [KP #{r['kp_id']}] "
                f"role={r['role']} anchor={r['anchor_state']} source={source}: {quote}"
            )

    return "\n".join(parts)


async def _build_picker_context(
    pool,
    *,
    article_ids: list[int] | None,
    tag_slugs: list[str] | None,
) -> str | None:
    """根据 @ / # picker 选中的引用对象拼一段供 LLM 阅读的上下文。

    返回值是一段纯文本 system 消息内容；若没有任何引用，返回 None。

    设计要点：
      - 每篇文章包括 [Title]（## H2 风格）+ Summary + Content excerpt（前 1800 字符）；
      - 每个 tag 给出一条 H3 + 该 tag 下最近 5 篇文章标题，让 Agent 知道
        "该话题下站点已写过什么"，便于后续追问 / 推荐；
      - URL 字段一并下发（``/posts/<slug>``），让 Agent 在回答里能给出可点链接。
    """
    article_ids = list(dict.fromkeys(article_ids or []))[:10]
    tag_slugs = list(dict.fromkeys((tag_slugs or [])))[:8]
    if not article_ids and not tag_slugs:
        return None

    parts: list[str] = []

    if article_ids:
        # SECURITY (深防): 即使前端 picker 已经在 Go 那边过滤掉密码保护文章，
        # 这里仍然显式 `password IS NULL` 一遍。理由：
        #   1. 前端可任意构造 articleIds[]，不在 picker 出现的 id 也能塞进来；
        #   2. 一旦本端点把 content_markdown 注入 prompt，再多的客户端门禁
        #      都没用 —— 内容已经离开服务端进入了 LLM context。
        # 也排除 deleted / 草稿 / hidden，与 Go 端行为对齐。
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT p.id, p.title, p.slug, p.summary, p.content_markdown
                FROM posts p
                WHERE p.id = ANY($1::bigint[])
                  AND p.deleted = FALSE
                  AND p.status = 'PUBLISHED'
                  AND p.is_hidden = FALSE
                  AND p.password IS NULL
                """,
                article_ids,
            )
        if rows:
            parts.append("# 用户引用的文章原文")
            for r in rows:
                title = r["title"] or "(untitled)"
                slug = r["slug"] or ""
                summary = (r["summary"] or "").strip()
                content = (r["content_markdown"] or "").strip()
                if len(content) > _ARTICLE_EXCERPT_MAX_CHARS:
                    content = content[:_ARTICLE_EXCERPT_MAX_CHARS] + "…"
                parts.append(f"## {title}")
                parts.append(f"URL: /posts/{slug}")
                if summary:
                    parts.append(f"Summary: {summary}")
                if content:
                    parts.append(content)

    if tag_slugs:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT t.id, t.name, t.slug,
                       array_agg(p.title ORDER BY p.published_at DESC NULLS LAST)
                         FILTER (WHERE p.id IS NOT NULL) AS recent_titles
                FROM tags t
                LEFT JOIN post_tags pt ON pt.tag_id = t.id
                LEFT JOIN posts p ON pt.post_id = p.id
                  AND p.deleted = FALSE
                  AND p.status = 'PUBLISHED'
                  AND p.is_hidden = FALSE
                  AND p.password IS NULL
                WHERE t.slug = ANY($1::text[])
                GROUP BY t.id, t.name, t.slug
                """,
                tag_slugs,
            )
        if rows:
            if parts:
                parts.append("")
            parts.append("# 用户引用的标签下的文章")
            for r in rows:
                titles = (r["recent_titles"] or [])[:_TAG_POST_LIMIT]
                parts.append(f"## #{r['name']}")
                if titles:
                    for t in titles:
                        parts.append(f"- {t}")
                else:
                    parts.append("(尚无已发布文章)")

    if not parts:
        return None
    parts.insert(0, "下面是用户在 Agent 工作台显式引用的素材，请优先基于这些内容作答；"
                   "引用具体段落时附上文章 URL。")
    return "\n".join(parts)


async def _resolve_for_agent(
    llm_router: LlmRouter,
    *,
    user_id: int | None,
    model_id: str | None = None,
    provider_code: str | None = None,
) -> Any:
    """解析 Agent 调用的最终路由 ——

    1. 若用户在 ModelPicker 选择了具体模型，先按 user/provider credential
       重新校验并尊重该 override；
    2. 未指定模型时，按 _FALLBACK_TASK_ALIASES 顺序找第一个有 routing 的任务别名；
    3. 全部找不到 → 抛 503，前端会渲染清晰的错误气泡。

    这层包装没复用 ``llm_router._resolve_route(...)`` 的全部逻辑，
    因为它在 routing 缺失时会进入 env-var 分支返回未带 provider 前缀的
    模型名（比如 ``"agent"`` 字面），而 LiteLLM 会因为辨认不出 provider
    抛 BadRequestError —— 那是这次 bug 的根因。

    SECURITY：Go 端 ``agent_handler`` 对所有已登录用户注入内部服务 token，
    所以这里不能信任客户端声称的权限或模型可用性。override 只能通过
    ``LlmRouter._resolve_override`` 生效：它会按真实 ``user_id`` 查询模型、
    provider 凭证、模型类型与启用状态；未通过校验时直接失败，避免静默落回
    默认 Claude/OpenAI 路由造成"UI 选中但实际没生效"。
    """
    if model_id:
        try:
            override = await llm_router._resolve_override(  # noqa: SLF001
                model_id=model_id,
                provider_code=provider_code,
                user_id=user_id,
                model_alias="agent",
                allow_override=True,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc
        if override:
            return override

    # 任务别名 fallback —— 从 model_router 拿 RoutingConfig
    if llm_router.model_router is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI 路由模块未初始化",
        )

    for alias in _FALLBACK_TASK_ALIASES:
        routing = await llm_router.model_router.resolve_routing(alias, user_id)
        if not routing:
            continue
        prefixed_model = LlmRouter._prefix_model_for_litellm(  # noqa: SLF001
            routing.model.model_id, routing.credential.api_type
        )
        # 直接构造 _ResolvedRoute，避免再次走 _resolve_route 的 env-var 回退分支
        return LlmRouter._ResolvedRoute(  # noqa: SLF001
            model=prefixed_model,
            provider_code=routing.model.provider_code,
            model_id=routing.model.model_id,
            input_cost_per_1m=routing.model.input_cost_per_1m,
            output_cost_per_1m=routing.model.output_cost_per_1m,
            cached_input_cost_per_1m=routing.model.cached_input_cost_per_1m,
            api_key=routing.credential.api_key,
            api_base=routing.credential.base_url,
            temperature=float(routing.config.get("temperature", 0.7) or 0.7),
            max_tokens=routing.config.get("max_tokens"),
            # Agent 不复用 qa/summary 的 prompt template，自己注入 system prompt。
            prompt_template=None,
            override=False,
        )

    # 最后兜底：ai_task_routing 表整张空也别让聊天框无法用。
    # 直接拿任意已启用的 chat 模型 + 对应 provider 的凭证。这等同于
    # ``_resolve_override`` 的逻辑，但模型由我们自动挑（按 provider_registry
    # 默认排序的第一项），不要求用户进 ModelPicker。
    enabled_models = await llm_router.model_router.provider_registry.list_models(
        enabled_only=True,
    )
    for m in enabled_models:
        mtype = (m.model_type or "").lower()
        if mtype in NON_CHAT_MODEL_TYPES:
            continue
        caps = m.capabilities or {}
        if isinstance(caps, dict) and caps.get("chat") is False:
            continue
        cred = await llm_router.model_router.credential_resolver.get_credential(
            m.provider_code, user_id=user_id,
        )
        if not cred:
            continue
        prefixed = LlmRouter._prefix_model_for_litellm(m.model_id, cred.api_type)  # noqa: SLF001
        logger.info(
            "agent.fallback_to_first_enabled_model",
            extra={"data": {"provider": m.provider_code, "model": m.model_id}},
        )
        return LlmRouter._ResolvedRoute(  # noqa: SLF001
            model=prefixed,
            provider_code=m.provider_code,
            model_id=m.model_id,
            input_cost_per_1m=m.input_cost_per_1m,
            output_cost_per_1m=m.output_cost_per_1m,
            cached_input_cost_per_1m=m.cached_input_cost_per_1m,
            api_key=cred.api_key,
            api_base=cred.base_url,
            temperature=0.7,
            max_tokens=None,
            prompt_template=None,
            override=False,
        )

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="尚未配置任何可用的 AI 模型 (admin → AI 配置 → 供应商/模型)。",
    )


def _agent_usage_request_text(messages: list[dict[str, Any]]) -> str:
    """把实际发给 LLM 的多轮消息压成稳定文本，用于 token 估算。"""
    parts: list[str] = []
    for message in messages:
        role = str(message.get("role") or "unknown")
        content = message.get("content")
        if isinstance(content, str):
            text = content
        else:
            text = json.dumps(content, ensure_ascii=False)
        parts.append(f"{role}: {text}")
    return "\n\n".join(parts)


async def _record_agent_usage(
    *,
    request: Request | None,
    metrics: MetricsStore,
    usage_logger: UsageLogger,
    user_id: int | None,
    resolved: Any,
    request_text: str,
    response_text: str,
    start_time: float,
    success: bool,
    error_code: str | None,
) -> None:
    """把灵境问答写入 ai_usage_logs，供后台数据分析统计。"""
    endpoint = getattr(getattr(request, "url", None), "path", None) or "/api/v1/agent/chat"
    duration_ms = (time.perf_counter() - start_time) * 1000
    tokens_in = estimate_tokens(request_text)
    tokens_out = estimate_tokens(response_text)
    metrics.record(
        endpoint=endpoint,
        duration_ms=duration_ms,
        success=success,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        model=resolved.model,
        cached=False,
    )
    await usage_logger.record(
        user_id=str(user_id or "system"),
        endpoint=endpoint,
        task_type="agent_chat",
        provider_code=resolved.provider_code,
        model_id=resolved.model_id,
        model=resolved.model,
        input_cost_per_1m=resolved.input_cost_per_1m,
        output_cost_per_1m=resolved.output_cost_per_1m,
        cached_input_cost_per_1m=resolved.cached_input_cost_per_1m,
        request_chars=len(request_text),
        response_chars=len(response_text),
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        latency_ms=int(duration_ms),
        success=success,
        cached=False,
        error_code=error_code,
        request_id=getattr(getattr(request, "state", None), "request_id", None),
    )


# ============================================================================
# /api/v1/agent/models
# ============================================================================

def _resolve_forwarded_user_id(
    user: Any,
    forwarded: str | None,
) -> int | None:
    """从已经过 ``require_admin_or_internal`` 鉴权的请求里解析最终 user_id。

    安全模型（这是这一处的核心，不要在没读完之前合并）：
      ── 入口分流 ──
      1. 调用方走 ``X-Internal-Service`` 内部 token（典型：Go 后端代理）
         → ``user`` 是 ``UserClaims(user_id="system", role="admin")``
         → 此时只信任 ``X-Forwarded-User-ID``，因为 Go 已经基于 JWT 设置过；
           不信任 ``user.user_id``（它就是字面 "system"，对 user-level 过滤无意义）。
      2. 调用方走 admin JWT（典型：admin 后台）
         → ``user`` 是 ``UserClaims(user_id="<真实 admin id>", ...)``
         → 此时 **完全忽略** 客户端塞的 ``X-Forwarded-User-ID`` —— 否则任意
           已登录管理员都能塞 "X-Forwarded-User-ID: 5" 假冒别的用户身份去拉
           别人的模型清单（IDOR cluster 风险，对应 VULN-052 同类问题）。
           只信 JWT 自己 sign 的 sub claim。

    总结：``X-Forwarded-User-ID`` 仅在 internal-token 路径下被采纳；
    JWT 路径下永远以 JWT 自己的 sub 为准。这两个判断分支不能合并。

    仍然要警惕的远端风险：
      · 任何能拿到 ``X-Internal-Service`` token 的人就能假冒任意 user_id ——
        这等同于服务器内部全权代理，token 必须以 ``.env``-only / docker-secrets
        的级别保护（已在 ``Settings._validate_token_strength`` 强制 ≥32 chars）。
      · 顺序整数 user_id 是 IDOR 风险被放大器，但风险不在 ID 形态，而在每个
        端点的 ownership check。我们这条路径的 ownership 由 SQL ``user_id = $1``
        强约束，并且 $1 永远来自服务端可信源，不接受客户端输入。
    """
    # 判别 internal-token 路径 vs JWT 路径：``require_admin_or_internal`` 在 internal
    # 分支构造 ``UserClaims(user_id="system", role="admin")``；其它情况 user.user_id
    # 是真实数字字符串（admin 自己登录后调本端点的场景）。
    raw_sub: Any = None
    if user is None:
        raw_sub = None
    elif isinstance(user, dict):
        raw_sub = user.get("sub") or user.get("user_id")
    else:
        raw_sub = getattr(user, "user_id", None)
    is_internal = (raw_sub == "system")

    # JWT 路径：忽略客户端任何 X-Forwarded-User-ID，只信 JWT。
    if not is_internal:
        if raw_sub is None:
            return None
        try:
            return int(raw_sub)
        except (TypeError, ValueError):
            return None

    # internal-token 路径：只这里采纳 X-Forwarded-User-ID。
    if forwarded:
        try:
            v = int(forwarded.strip())
            if v > 0:
                return v
        except (TypeError, ValueError):
            pass
    return None


@router.get("/api/v1/agent/models", response_model=ApiResponse[list[AgentModelItem]])
async def list_agent_models(
    request: Request,  # noqa: ARG001
    user=Depends(require_admin_or_internal),
    forwarded_user_id: str | None = Header(default=None, alias="X-Forwarded-User-ID"),
    pool=Depends(get_pg_pool),
):
    """返回 ModelPicker 可选的聊天模型清单。

    用户层隔离规则：仅当某个 provider 在当前用户维度下存在 ``ai_credentials``
    （user_id = $1）或系统级凭证（user_id IS NULL）时，该 provider 下的
    enabled chat 模型才会出现在结果里。

    举例：
      · admin 配过 OpenAI / Anthropic / Google → 这三家所有 enabled 模型都出现；
      · user X 只配过自己的 OpenAI → 仅 OpenAI 系列 + 任何系统级 provider；
      · 没登录用户上下文（理论不该发生）→ 仅系统级 provider。

    与 admin 的 ``GET /providers/models`` 区别：那个端点会回所有库存模型，
    不做用户级过滤；本端点专为 Agent 工作台对外暴露，要严格剔除用户没
    凭证的 provider，否则 ModelPicker 选了之后必然 401/403。
    """
    user_id = _resolve_forwarded_user_id(user, forwarded_user_id)

    # 单条 SQL 把模型 + provider + 用户/系统凭证 join 起来，按 provider
    # 优先级倒序、相同 provider 内按 capabilities.sort 排序。
    # 注意 model_type 兼容：DB 里既可能是 'chat' / 'text' / 'all'，也可能是
    # NULL；我们在 SQL 里用 COALESCE 把 NULL 当作 'chat'；非 chat 类型从
    # llm_router.NON_CHAT_MODEL_TYPES 注入, 与 _resolve_override / fallback
    # 保持同源, 避免某天扩 denylist 时漏改 SQL。
    query = """
        SELECT m.id, m.provider_id, p.code AS provider_code,
               COALESCE(p.display_name, p.name, p.code) AS provider_name,
               p.icon AS provider_icon,
               p.priority AS provider_priority,
               m.model_id, m.display_name, m.model_type, m.context_window,
               m.max_output_tokens, m.input_cost_per_1k, m.output_cost_per_1k,
               m.capabilities, m.is_enabled,
               EXISTS (
                   SELECT 1 FROM ai_credentials c
                   WHERE c.provider_id = m.provider_id
                     AND c.is_enabled = TRUE
                     AND c.user_id = $1
               ) AS has_user_cred
        FROM ai_models m
        JOIN ai_providers p ON m.provider_id = p.id
        WHERE m.is_enabled = TRUE
          AND p.is_enabled = TRUE
          AND COALESCE(m.model_type, 'chat') <> ALL($2::text[])
          AND EXISTS (
              SELECT 1 FROM ai_credentials c
              WHERE c.provider_id = m.provider_id
                AND c.is_enabled = TRUE
                AND (c.user_id = $1 OR c.user_id IS NULL)
          )
        ORDER BY
          EXISTS (
              SELECT 1 FROM ai_credentials c
              WHERE c.provider_id = m.provider_id
                AND c.is_enabled = TRUE
                AND c.user_id = $1
          ) DESC,
          p.priority DESC,
          COALESCE((m.capabilities->>'sort')::int, 999999) ASC,
          m.display_name ASC
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, user_id, list(NON_CHAT_MODEL_TYPES))

    items: list[AgentModelItem] = []
    for row in rows:
        caps_raw = row["capabilities"]
        try:
            caps = json.loads(caps_raw) if isinstance(caps_raw, str) else (caps_raw or {})
        except (TypeError, ValueError):
            caps = {}
        if isinstance(caps, dict) and caps.get("chat") is False:
            continue
        settings = _resolve_agent_model_settings(caps)
        items.append(
            AgentModelItem(
                providerCode=row["provider_code"],
                providerName=row["provider_name"],
                providerIcon=row["provider_icon"],
                modelId=row["model_id"],
                displayName=row["display_name"] or row["model_id"],
                contextWindow=_resolve_agent_context_window(row, caps),
                maxOutputTokens=_resolve_agent_max_output_tokens(row, caps),
                isDefault=False,
                abilities=_resolve_agent_model_abilities(caps),
                extendParams=_resolve_agent_extend_params(settings),
                settings=settings,
                parameters=_resolve_agent_model_parameters(caps),
                disabledParams=_resolve_agent_disabled_params(settings),
                source=caps.get("source") if isinstance(caps.get("source"), str) else None,
                releasedAt=(
                    caps.get("released_at")
                    if isinstance(caps.get("released_at"), str)
                    else caps.get("releasedAt")
                    if isinstance(caps.get("releasedAt"), str)
                    else None
                ),
                description=caps.get("description") if isinstance(caps.get("description"), str) else None,
                scope="user" if row["has_user_cred"] else "system",
            )
        )

    if items:
        items[0].isDefault = True

    return ApiResponse[list[AgentModelItem]](success=True, data=items)


# ============================================================================
# /api/v1/agent/chat
# ============================================================================

@router.post("/api/v1/agent/chat")
async def agent_chat(
    request: Request,
    payload: AgentChatRequest,
    user=Depends(require_admin_or_internal),
    forwarded_user_id: str | None = Header(default=None, alias="X-Forwarded-User-ID"),
    llm_router: LlmRouter = Depends(get_llm_router),
    pool=Depends(get_pg_pool),
    metrics: MetricsStore = Depends(get_metrics),
    usage_logger: UsageLogger = Depends(get_usage_logger),
):
    """多轮对话流式响应 —— 由 Go 后端在用户登录态下代理调用。"""
    _enforce_message_limits(payload)

    # X-Forwarded-User-ID 是 Go agent_handler 透传的真实登录用户 id；
    # require_admin_or_internal 在内部 token 路径下只能给出 "system"，
    # 我们更信任前者，否则 override / resolve_routing 都会做错 user-level
    # 凭证匹配。
    user_id = _resolve_forwarded_user_id(user, forwarded_user_id)

    resolved = await _resolve_for_agent(
        llm_router,
        user_id=user_id,
        model_id=payload.modelId,
        provider_code=payload.providerCode,
    )
    logger.info(
        "agent.route_resolved",
        extra={
            "data": {
                "requested_provider_code": payload.providerCode,
                "requested_model_id": payload.modelId,
                "provider_code": resolved.provider_code,
                "model_id": resolved.model_id,
                "model": resolved.model,
                "override": resolved.override,
            }
        },
    )

    # 把 @ / # picker 引用的文章 / 标签拼成上下文段（system 消息），让 Agent
    # 真正"看到"用户引用的素材，而不是只看到一句 "@xxx"。
    context_block = await _build_picker_context(
        pool,
        article_ids=payload.articleIds,
        tag_slugs=payload.tagSlugs,
    )
    # KB picker 选中后，按最后一条 user 消息做语义召回并拼一段 system 提示。
    # 与 picker_context 各占独立 system message，便于 prompt 调试 + 不互相覆盖。
    kb_context = await _build_kb_context_for_chat(
        pool, llm_router,
        kb_ids=payload.kbIds,
        messages=payload.messages,
    )
    atlas_context = await _build_atlas_context_for_chat(
        pool,
        atlas_scope=payload.atlasScope,
        user_id=user_id,
    )
    if kb_context:
        if context_block:
            context_block = context_block + "\n\n---\n\n" + kb_context
        else:
            context_block = kb_context
    if atlas_context:
        if context_block:
            context_block = context_block + "\n\n---\n\n" + atlas_context
        else:
            context_block = atlas_context
    chat_messages = _build_chat_messages(payload, context_block=context_block)

    # SSRF 守卫
    await llm_router._guard_api_base(resolved.api_base)  # noqa: SLF001

    async def generate():
        start_time = time.perf_counter()
        request_text = _agent_usage_request_text(chat_messages)
        response_parts: list[str] = []
        think_parts: list[str] = []
        error_code: str | None = None
        if settings.mock_mode and not resolved.override:
            for chunk in [
                "[mock:", resolved.model, "] ", "你好,",
                "我已收到 ", str(len(payload.messages)), " 条消息。"
            ]:
                response_parts.append(chunk)
                yield f'data: {json.dumps({"type": "delta", "content": chunk}, ensure_ascii=False)}\n\n'
            yield 'data: {"type": "done"}\n\n'
            await _record_agent_usage(
                request=request,
                metrics=metrics,
                usage_logger=usage_logger,
                user_id=user_id,
                resolved=resolved,
                request_text=request_text,
                response_text="".join(response_parts),
                start_time=start_time,
                success=True,
                error_code=None,
            )
            return

        response_chars = 0
        think_chars = 0
        try:
            completion_kwargs = _agent_completion_kwargs(
                model=resolved.model,
                temperature=resolved.temperature,
                max_tokens=resolved.max_tokens,
                model_params=payload.modelParams,
            )
            try:
                stream = await acompletion(
                    model=resolved.model,
                    messages=chat_messages,
                    api_key=resolved.api_key,
                    api_base=resolved.api_base,
                    stream=True,
                    **completion_kwargs,
                )
            except Exception as exc:
                if not _looks_like_thinking_param_rejection(exc):
                    raise
                logger.warning(
                    "agent.thinking_params_rejected",
                    extra={
                        "data": {
                            "provider_code": resolved.provider_code,
                            "model_id": resolved.model_id,
                            "error": str(exc)[:300],
                        }
                    },
                )
                stream = await acompletion(
                    model=resolved.model,
                    messages=chat_messages,
                    api_key=resolved.api_key,
                    api_base=resolved.api_base,
                    stream=True,
                    **_without_agent_thinking_kwargs(completion_kwargs),
                )
            async for event in _stream_litellm_agent_events(stream):
                content = event.get("content", "") or ""
                if event.get("type") == "think":
                    think_chars += len(content)
                    think_parts.append(content)
                else:
                    response_chars += len(content)
                    response_parts.append(content)
                data = json.dumps(event, ensure_ascii=False)
                yield f"data: {data}\n\n"
            logger.info(
                "agent.stream_done",
                extra={
                    "data": {
                        "provider_code": resolved.provider_code,
                        "model_id": resolved.model_id,
                        "response_chars": response_chars,
                        "think_chars": think_chars,
                    }
                },
            )
            yield 'data: {"type": "done"}\n\n'
        except asyncio.CancelledError:
            error_code = "client_cancelled"
            logger.info(
                "agent.stream_cancelled",
                extra={
                    "data": {
                        "provider_code": resolved.provider_code,
                        "model_id": resolved.model_id,
                        "response_chars": response_chars,
                        "think_chars": think_chars,
                    }
                },
            )
            raise
        except Exception as exc:
            error_code = "agent_stream_error"
            logger.warning(
                "agent.stream_failed",
                extra={
                    "data": {
                        "error": str(exc),
                        "provider_code": resolved.provider_code,
                        "model_id": resolved.model_id,
                        "response_chars": response_chars,
                        "think_chars": think_chars,
                    }
                },
            )
            err = json.dumps(
                {"type": "error", "code": error_code, "message": str(exc)[:300]},
                ensure_ascii=False,
            )
            yield f"data: {err}\n\n"
        finally:
            await asyncio.shield(
                _record_agent_usage(
                    request=request,
                    metrics=metrics,
                    usage_logger=usage_logger,
                    user_id=user_id,
                    resolved=resolved,
                    request_text=request_text,
                    # provider 暴露出来的 thinking/reasoning 也属于生成输出，费用估算应计入。
                    response_text="".join(think_parts) + "".join(response_parts),
                    start_time=start_time,
                    success=error_code is None,
                    error_code=error_code,
                )
            )

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
