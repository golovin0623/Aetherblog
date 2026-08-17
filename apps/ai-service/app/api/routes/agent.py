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

  data: {"type":"retrieval","version":1,"status":"matched",...}\\n\\n
  data: {"type":"think","content":"…"}\\n\\n
  data: {"type":"delta","content":"…"}\\n\\n
  data: {"type":"tool_call","id":"…","name":"…","arguments":"{…}"}\\n\\n
  data: {"type":"tool_result","id":"…","name":"…","result":"…","isError":false}\\n\\n
  data: {"type":"usage","promptTokens":0,"completionTokens":0,"totalTokens":0,"estimated":false}\\n\\n
  data: {"type":"done"}\\n\\n
  data: {"type":"error","code":"…","message":"…"}\\n\\n

``usage`` 只在成功路径的 ``done`` 之前下发一次：provider 经
``stream_options.include_usage`` 返回 prompt / completion 两侧真值时
``estimated`` 为 false；任一侧缺失则该侧用本地 ``estimate_tokens`` 补齐并
整条标 true；error / 客户端取消不发。

工具调用（``enableTools: true`` 显式开启 + 模型 ``abilities.functionCall``）：
模型请求工具时先发 ``tool_call``（arguments 为分片拼装完成的 JSON 字符串），
服务端执行白名单工具（单工具 10s 超时）后发 ``tool_result``（result 截断
≤2000 字符，``isError`` 标记失败），随后把 assistant(tool_calls)+tool 消息
追加进上下文再次调用继续流式；最多 4 轮工具循环，超限注入 system 提示令
模型直接作答。``usage`` 与计费聚合覆盖全部轮次（累加；provider 缺真值时
prompt 侧按「每轮调用前的完整上下文」逐轮估算累加）。防护硬限：单个调用
的 arguments 累加超过 8KB 即标记 oversized —— 事件与回填用截断版、不执行
并回 isError 回执；单轮超出 8 个的调用合并为一条 isError 回执，不逐个下发。
"""

from __future__ import annotations

import base64
import json
import logging
import asyncio
import math
import re
import time
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator, model_validator
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
from app.services.agent_tools import (
    AgentToolSpec,
    build_agent_tools,
    run_agent_tool,
)
from app.services.llm_router import (
    NON_CHAT_MODEL_TYPES,
    LlmRouter,
    _completion_kwargs,
    resolve_disabled_sampling_params,
)
from app.services.metrics import MetricsStore
from app.services.usage_logger import UsageLogger, estimate_tokens

logger = logging.getLogger(__name__)

router = APIRouter(tags=["agent"])
settings = get_settings()


# ============================================================================
# 请求 / 响应 schema
# ============================================================================

# ---- 图片输入（vision）硬限制 ----
# 只接受 data URL 内联 base64，禁止 http(s) 远端地址 —— 服务端替客户端拉取
# 任意 URL 等于把 SSRF 面直接开在 LLM 入口上。
_IMAGE_DATA_URL_RE = re.compile(r"^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$")
_IMAGE_MAX_DECODED_BYTES = 5 * 1024 * 1024
_MAX_IMAGES_PER_MESSAGE = 4
_MAX_IMAGES_PER_REQUEST = 8
# 单条消息 content-parts 数组的片段总数上限（文本 + 图片合计）。正常前端一条
# 消息只会拼出「若干文本 + ≤4 图」的个位数片段；16 已经留足余量。
_MAX_CONTENT_PARTS_PER_MESSAGE = 16


class AgentTextPart(BaseModel):
    """OpenAI content-parts 的文本片段，LiteLLM 原样透传。"""

    type: Literal["text"]
    text: str


class AgentImageUrlPayload(BaseModel):
    """图片引用体。仅接受内联 base64 data URL（防 SSRF），并做体积硬封顶。"""

    url: str

    @field_validator("url")
    @classmethod
    def validate_image_data_url(cls, value: str) -> str:
        if not _IMAGE_DATA_URL_RE.match(value):
            raise ValueError(
                "图片必须是 data:image/(png|jpeg|webp|gif);base64 形式的内联 Data URL"
            )
        encoded = value.split(",", 1)[1]
        # 先按 base64 长度粗算解码体积，明显超限直接拒绝，
        # 避免对几十 MB 的畸形字符串做无谓解码。
        if len(encoded) * 3 // 4 > _IMAGE_MAX_DECODED_BYTES + 4:
            raise ValueError("单张图片解码后不能超过 5MB")
        try:
            decoded = base64.b64decode(encoded, validate=True)
        except ValueError as exc:  # binascii.Error 是 ValueError 子类
            raise ValueError("图片 base64 内容无效") from exc
        if len(decoded) > _IMAGE_MAX_DECODED_BYTES:
            raise ValueError("单张图片解码后不能超过 5MB")
        return value


class AgentImagePart(BaseModel):
    """OpenAI content-parts 的图片片段（image_url + data URL）。"""

    type: Literal["image_url"]
    image_url: AgentImageUrlPayload


AgentContentPart = AgentTextPart | AgentImagePart


class AgentChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"] = Field(..., description="角色")
    # 纯文本，或 OpenAI content-parts 数组（文本 + 内联图片）。
    # 数组形式由 LiteLLM 原样透传给 provider（vision 通道）。
    content: str | list[AgentContentPart] = Field(..., description="内容")

    @field_validator("content", mode="before")
    @classmethod
    def limit_content_part_count(cls, value: Any) -> Any:
        """片段数硬封顶 —— 必须在逐片段解析之前执行（``mode="before"``）。

        语义等价于 ``Annotated[list[...], Field(max_length=16)]``，但先于
        pydantic 的 per-part 校验短路并给出中文文案。为什么必须前置：文本
        长度硬限在 ``_enforce_message_limits``，晚于 schema 解析——没有这道
        闸，攻击者用 24MB 请求体塞几十万个微型 text part，单 worker 事件循环
        会在 schema 解析上烧数秒 CPU（DoS）。
        """
        if isinstance(value, (list, tuple)) and len(value) > _MAX_CONTENT_PARTS_PER_MESSAGE:
            raise ValueError(
                f"消息内容片段过多（单条消息最多 {_MAX_CONTENT_PARTS_PER_MESSAGE} 个片段）"
            )
        return value

    @field_validator("content")
    @classmethod
    def validate_content_parts(cls, value: str | list[AgentContentPart]) -> str | list[AgentContentPart]:
        if isinstance(value, str):
            return value
        if not value:
            raise ValueError("content 数组不能为空，至少需要一个文本或图片片段")
        images = sum(1 for part in value if isinstance(part, AgentImagePart))
        if images > _MAX_IMAGES_PER_MESSAGE:
            raise ValueError(f"单条消息最多包含 {_MAX_IMAGES_PER_MESSAGE} 张图片")
        return value


def _message_text(message: AgentChatMessage) -> str:
    """统一提取消息文本：str 原样返回；content-parts 拼接全部文本片段。

    所有"把消息当文本用"的路径（长度硬限、检索 query 提取、token 估算）都
    必须走这里，避免把 base64 图片串当作文本计数或塞进检索。
    """
    if isinstance(message.content, str):
        return message.content
    return "".join(part.text for part in message.content if isinstance(part, AgentTextPart))


def _message_image_count(message: AgentChatMessage) -> int:
    if isinstance(message.content, str):
        return 0
    return sum(1 for part in message.content if isinstance(part, AgentImagePart))


class AgentAtlasScope(BaseModel):
    kpIds: list[int] | None = Field(default=None, max_length=12)
    carrierIds: list[int] | None = Field(default=None, max_length=6)
    neighborhoodDepth: int = Field(default=1, ge=0, le=2)
    includeEvidence: bool = True
    semanticRecall: bool = True
    semanticLimit: int = Field(default=8, ge=0, le=12)


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
    # Trusted three-state execution contract. Optional at the schema boundary
    # only for rolling compatibility; the after-validator always resolves it
    # to auto / selected / none before the route runs.
    knowledgeContextMode: Literal["auto", "selected", "none"] | None = None
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
    # 显式开启工具调用（function calling）。工具清单为服务端白名单
    # （search_knowledge_base / search_posts），不接受客户端自定义工具；
    # 模型 abilities.functionCall 非 true 时静默降级为无工具普通对话（不报错）。
    enableTools: bool = False

    @model_validator(mode="after")
    def enforce_request_image_budget(self) -> "AgentChatRequest":
        # 单条消息的 4 张上限在 AgentChatMessage 校验；这里封顶整个请求，
        # 防止 64 条消息各带 4 图把 provider 请求撑爆。
        total_images = sum(_message_image_count(m) for m in self.messages)
        if total_images > _MAX_IMAGES_PER_REQUEST:
            raise ValueError(f"整个请求最多包含 {_MAX_IMAGES_PER_REQUEST} 张图片")
        return self

    @model_validator(mode="after")
    def normalize_knowledge_context_contract(self) -> "AgentChatRequest":
        fields_set = self.model_fields_set
        mode_was_explicit = "knowledgeContextMode" in fields_set
        if mode_was_explicit and self.knowledgeContextMode is None:
            raise ValueError("knowledgeContextMode cannot be null")

        kb_ids = self.kbIds or []
        atlas_scope = self.atlasScope
        kp_ids = (atlas_scope.kpIds or []) if atlas_scope else []
        carrier_ids = (atlas_scope.carrierIds or []) if atlas_scope else []
        all_ids = [*kb_ids, *kp_ids, *carrier_ids]
        if any(value <= 0 for value in all_ids):
            raise ValueError("knowledge context IDs must be positive")
        has_kb_refs = bool(kb_ids)
        has_atlas_refs = bool(kp_ids or carrier_ids)

        mode = self.knowledgeContextMode
        if mode is None:
            # Legacy AetherHub wire shapes are intentionally inferred in the
            # least-privilege direction. Non-empty IDs are explicit selection;
            # an explicit null/empty opt-out is none; an empty semantic Atlas
            # scope is automatic discovery; fully omitted context is auto.
            kb_was_sent = "kbIds" in fields_set
            atlas_was_sent = "atlasScope" in fields_set
            atlas_explicitly_requests_semantic_recall = bool(
                atlas_scope is not None
                and atlas_scope.semanticRecall
                and "semanticRecall" in atlas_scope.model_fields_set
            )
            if has_kb_refs or has_atlas_refs:
                mode = "selected"
            elif kb_was_sent and not kb_ids:
                mode = "none"
            elif atlas_was_sent and not atlas_explicitly_requests_semantic_recall:
                mode = "none"
            else:
                mode = "auto"
            self.knowledgeContextMode = mode

        if mode == "none":
            if has_kb_refs or has_atlas_refs:
                raise ValueError("none mode cannot carry private source context")
            self.kbIds = None
            self.atlasScope = None
        elif mode == "selected":
            if not has_kb_refs and not has_atlas_refs:
                raise ValueError("selected mode requires explicit source IDs")
            if any(message.role == "system" for message in self.messages):
                raise ValueError("selected mode does not accept client system messages")
            # A selected KP/carrier must neither expand its graph neighborhood
            # nor trigger global semantic discovery. If only KBs were selected,
            # remove an empty Atlas scope entirely to prevent fallback.
            if atlas_scope is not None:
                if has_atlas_refs:
                    atlas_scope.semanticRecall = False
                    atlas_scope.neighborhoodDepth = 0
                else:
                    self.atlasScope = None
        return self


@dataclass
class _AgentRetrievalPart:
    """One requested retrieval scope and the context actually injected for it."""

    requested: bool = False
    outcome: Literal["matched", "empty", "unavailable"] | None = None
    context: str | None = None
    hits: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[dict[str, str]] = field(default_factory=list)


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
    # 定价（美元 / 1M tokens）。数据来源与 provider_registry._build_model_info
    # 同一优先级：ai_models 的 per_1k 列 ×1000，缺失时回退 capabilities.pricing。
    inputCostPer1M: float | None = None
    outputCostPer1M: float | None = None
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


def _resolve_agent_model_cost_per_1m(row: Any, caps: dict[str, Any], kind: str) -> float | None:
    """模型定价（美元 / 1M tokens）；``kind`` 取 ``input`` / ``output``。

    与 ``provider_registry._build_model_info`` 同源：优先 ai_models 的 per_1k
    列 ×1000（表里没有 per_1m 列），缺失时回退 capabilities.pricing 的
    直接键或 units 数组。任一来源为 None 时向下传播 None。
    """
    per_1k = row[f"{kind}_cost_per_1k"]
    if per_1k is not None:
        try:
            return float(per_1k) * 1000
        except (TypeError, ValueError):
            pass
    if not isinstance(caps, dict):
        return None
    pricing = caps.get("pricing")
    if not isinstance(pricing, dict):
        return None
    from app.services.provider_registry import _extract_pricing_rate

    return _extract_pricing_rate(pricing, kind)


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

_SELECTED_CONTEXT_POLICY = (
    "# 所选来源约束\n"
    "只能依据本轮已注入的所选来源作答。不得用常识、记忆或未提供的站点资料补齐事实；"
    "所选来源没有覆盖的内容必须明确说明缺少依据。回答中的事实与结论应能回到这些来源。"
)
_SELECTED_CONTEXT_NOT_GROUNDED_CODE = "selected_context_not_grounded"
_SELECTED_CONTEXT_NOT_GROUNDED_MESSAGE = (
    "未能从所选来源找到足够依据。请调整问题或重新选择来源后再试。"
)

# 当 'agent' 任务未配置 routing 时，按这个顺序回退到已有任务的路由。
# qa / summary 在生产环境通常都有配置，能保证开箱可用；任一命中即停止。
_FALLBACK_TASK_ALIASES = ("agent", "qa", "summary")

# 工具调用执行循环的硬上限：最多 4 轮「模型请求工具 → 服务端执行 → 回喂」；
# 超限后撤下 tools 参数并注入 system 提示，强制模型直接作答收敛。
_MAX_TOOL_ROUNDS = 4
# 单轮最多执行的工具调用数 —— 防止 provider 一次吐几十个并行调用拖垮事件循环；
# 超出部分不逐个下发 / 回填（每个多余调用要占两条 SSE 事件 + 两条上下文消息），
# 而是合并为一条 isError 回执：协议上保留第一个超限调用挂载回执，其余全部忽略。
_MAX_TOOL_CALLS_PER_ROUND = 8
# 单个工具调用 arguments 分片累加的硬上限（字节，UTF-8）。异常 / 恶意 provider
# 可无限续传 arguments 分片 —— 不设上限时一条 SSE tool_call 行能被撑到数百 KB，
# 直接超过 Go 侧 SSE scanner 的行缓冲上限（整条流被掐断）。超限即标记
# oversized：停止累加、不执行该工具，事件与上下文回填一律用截断版。
_TOOL_ARGUMENTS_MAX_BYTES = 8192
_TOOL_ARGUMENTS_TRUNCATED_SUFFIX = "…（参数超长已截断）"
_TOOL_ARGUMENTS_OVERSIZED_RESULT = "工具参数超长，已拒绝执行"
_TOOL_ROUND_LIMIT_PROMPT = (
    "工具调用轮次已达上限，禁止再请求任何工具；请直接基于已获得的信息作答。"
)
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
    """对单次请求体做硬封顶，防止 admin token 被滥用做 OOM/费用 DoS。

    字符计数只统计文本部分 —— 图片有独立的张数 / 解码体积上限
    （schema 层 fail-closed），base64 串不挤占文本预算。
    """
    total = 0
    for m in req.messages:
        text_len = len(_message_text(m))
        if text_len > 8000:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"单条消息超过 8000 字符 (实际 {text_len})",
            )
        total += text_len
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
        content: Any = m.content
        if not isinstance(content, str):
            # content-parts 数组按 OpenAI wire 格式原样透传给 LiteLLM（vision）。
            content = [part.model_dump() for part in content]
        messages.append({"role": m.role, "content": content})
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
    disabled_params: tuple[str, ...] = (),
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
        disabled_params=disabled_params,
    )
    if not _model_omits_sampling(model):
        if override_top_p is not None and "top_p" not in disabled_params:
            kwargs["top_p"] = override_top_p
        if override_presence_penalty is not None and "presence_penalty" not in disabled_params:
            kwargs["presence_penalty"] = override_presence_penalty
        if override_frequency_penalty is not None and "frequency_penalty" not in disabled_params:
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


def _looks_like_stream_options_rejection(exc: Exception) -> bool:
    """判断 provider 报错是否针对 ``stream_options`` 参数。

    不同网关对该参数名的报错写法不一：``stream_options`` / ``streamOptions`` /
    ``stream-options`` / ``stream options``。只匹配下划线字面会漏掉变体、错失
    降级重试，用户直接拿到 error 而不是无 usage 的正常回答。归一化策略：
    小写后去掉 ``-`` / ``_`` / 空格再做包含判断；原字面匹配保留为快捷路径。
    """
    text = str(exc).lower()
    if "stream_options" in text:
        return True
    return "streamoptions" in re.sub(r"[-_ ]", "", text)


async def _start_agent_stream(
    *,
    resolved: Any,
    chat_messages: list[dict],
    completion_kwargs: dict[str, Any],
):
    """发起 LiteLLM 流式调用；可选参数被 provider 拒绝时按序降级重试。

    降级顺序（各至多一次）：
      1. ``stream_options``（真实 usage 下发）被拒 → 去掉后重试，usage 走本地估算；
      2. thinking 相关参数被拒 → 与既有 Gemini 特判一致，剥离后重试。
    其余异常原样抛出，交由外层 SSE error 路径处理。
    """
    kwargs = dict(completion_kwargs)
    for _ in range(3):
        try:
            return await acompletion(
                model=resolved.model,
                messages=chat_messages,
                api_key=resolved.api_key,
                api_base=resolved.api_base,
                stream=True,
                **kwargs,
            )
        except Exception as exc:
            if "stream_options" in kwargs and _looks_like_stream_options_rejection(exc):
                logger.warning(
                    "agent.stream_options_rejected",
                    extra={
                        "data": {
                            "provider_code": resolved.provider_code,
                            "model_id": resolved.model_id,
                            "error": str(exc)[:300],
                        }
                    },
                )
                kwargs.pop("stream_options", None)
                continue
            has_thinking_kwargs = any(
                key in kwargs for key in ("reasoning_effort", "extra_body", "allowed_openai_params")
            )
            if has_thinking_kwargs and _looks_like_thinking_param_rejection(exc):
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
                kwargs = _without_agent_thinking_kwargs(kwargs)
                continue
            raise
    raise RuntimeError("agent stream start retries exhausted")  # pragma: no cover - 防御性兜底


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
        is_think = value.get("thought") is True or block_type in {
            "thinking",
            "thought",
            "reasoning",
            "reasoning_content",
            "reasoning_text",
        }
        return [{
            "type": "think" if is_think else "delta",
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
    for reasoning_field in (
        "reasoning_content",
        "reasoning",
        "thinking",
        "thought",
        "thinking_blocks",
        "reasoning_items",
    ):
        text = _coerce_delta_text(_get_delta_field(delta, reasoning_field))
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


def _truncate_utf8(text: str, max_bytes: int) -> str:
    """按 UTF-8 字节数截断，丢弃截断点上的不完整多字节序列。"""
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return text
    return encoded[:max_bytes].decode("utf-8", errors="ignore")


def _tool_call_wire_arguments(call: dict[str, Any]) -> str:
    """SSE tool_call 事件与上下文回填共用的 arguments 文本。

    oversized 调用统一用「截断到 8KB 的参数 + 提示后缀」——SSE 行长度与
    下一轮 prompt 上下文都必须被硬限约束，绝不把完整超长参数透传出去。
    """
    arguments = str(call.get("arguments") or "")
    if call.get("oversized"):
        return arguments + _TOOL_ARGUMENTS_TRUNCATED_SUFFIX
    return arguments


class _ToolCallAssembler:
    """把 OpenAI 流式 delta 里的 tool_calls 分片拼装成完整调用。

    OpenAI wire 格式下，一次工具调用会被拆成多个 delta 分片：首片带
    ``index``/``id``/``function.name``，后续分片按同一 ``index`` 续传
    ``function.arguments`` 的 JSON 字符串片段。这里按 index 归并、字符串
    直接连接，流结束后一次性产出。兼容 dict / pydantic 对象两种分片形态。

    单个调用的 arguments 累加超过 ``_TOOL_ARGUMENTS_MAX_BYTES`` 即标记
    ``oversized`` 并停止累加（截断到硬限）——上限之外的分片直接丢弃，
    保证内存与下游 SSE 行长度都被封顶。
    """

    def __init__(self) -> None:
        self._calls: dict[int, dict[str, Any]] = {}

    def feed(self, fragments: Any) -> None:
        if fragments is None:
            return
        if not isinstance(fragments, (list, tuple)):
            fragments = [fragments]
        for fragment in fragments:
            raw_index = _get_delta_field(fragment, "index")
            try:
                index = int(raw_index)
            except (TypeError, ValueError):
                index = 0
            entry = self._calls.setdefault(
                index, {"id": "", "name": "", "arguments": "", "oversized": False}
            )
            call_id = _get_delta_field(fragment, "id")
            if call_id and not entry["id"]:
                entry["id"] = str(call_id)
            function = _get_delta_field(fragment, "function")
            if function is None:
                continue
            name = _get_delta_field(function, "name")
            if name:
                entry["name"] += str(name)
            arguments = _get_delta_field(function, "arguments")
            if arguments and not entry["oversized"]:
                combined = entry["arguments"] + str(arguments)
                if len(combined.encode("utf-8")) > _TOOL_ARGUMENTS_MAX_BYTES:
                    entry["oversized"] = True
                    entry["arguments"] = _truncate_utf8(combined, _TOOL_ARGUMENTS_MAX_BYTES)
                else:
                    entry["arguments"] = combined

    def result(self) -> list[dict[str, Any]]:
        calls: list[dict[str, Any]] = []
        for index in sorted(self._calls):
            entry = self._calls[index]
            name = entry["name"].strip()
            if not name:
                continue
            calls.append(
                {
                    "id": entry["id"] or f"call_{index}",
                    "name": name,
                    "arguments": entry["arguments"] or "{}",
                    "oversized": bool(entry["oversized"]),
                }
            )
        return calls


def _usage_token_count(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _extract_stream_usage(chunk: Any) -> dict[str, int | None] | None:
    """从流式 chunk 里提取 provider 返回的真实 token 用量。

    开启 ``stream_options.include_usage`` 后，OpenAI 兼容 provider 会在流末尾
    追加一条 choices 为空、usage 非空的收尾 chunk；部分 provider 也会把 usage
    挂在最后一条正常 chunk 上，两种形态都在这里兼容。

    单侧缺失时保留 ``None``，绝不填 0：0 会被下游当成真值直接下发 / 落库，
    计费口径静默降为半价。缺失侧由 ``_agent_usage_event`` /
    ``_record_agent_usage`` 逐项回退本地估算并标 ``estimated``。
    """
    usage = getattr(chunk, "usage", None)
    if usage is None and isinstance(chunk, dict):
        usage = chunk.get("usage")
    if usage is None:
        return None

    def read(name: str) -> int | None:
        if isinstance(usage, dict):
            return _usage_token_count(usage.get(name))
        return _usage_token_count(getattr(usage, name, None))

    prompt = read("prompt_tokens")
    completion = read("completion_tokens")
    if prompt is None and completion is None:
        return None
    total = read("total_tokens")
    if total is None and prompt is not None and completion is not None:
        # 只有两侧都是真值才敢代 provider 补 total；任一侧缺失时保持 None，
        # 交给下游用「真值 + 估算」重算，避免半真半零的 total。
        total = prompt + completion
    return {
        "promptTokens": prompt,
        "completionTokens": completion,
        "totalTokens": total,
    }


def _agent_usage_event(
    provider_usage: dict[str, int | None] | None,
    *,
    request_text: str,
    output_text: str,
    estimated_prompt_tokens: int | None = None,
) -> dict[str, Any]:
    """构造 done 前下发的 ``usage`` 事件。

    真值优先、缺失侧逐项回退本地估算：部分网关只回单侧 usage（例如只有
    completion_tokens），此时缺失侧用 ``estimate_tokens`` 补齐。只要任一字段
    是估算值，整条事件就必须标 ``estimated=true`` —— 前端据此加 "~" 前缀，
    不能把估算冒充成 provider 真值。两侧都是真值才 ``estimated=false``。

    ``estimated_prompt_tokens`` 是工具循环逐轮累加的 prompt 估算合计
    （``_AgentUsageAggregator.estimated_prompt_tokens``）；提供时 prompt 缺
    真值优先用它，只按最终 ``request_text`` 估一次会低估多轮消耗（P2-H）。
    """
    prompt = provider_usage.get("promptTokens") if provider_usage else None
    completion = provider_usage.get("completionTokens") if provider_usage else None
    estimated = prompt is None or completion is None
    if prompt is not None:
        prompt_tokens = prompt
    elif estimated_prompt_tokens is not None:
        prompt_tokens = estimated_prompt_tokens
    else:
        prompt_tokens = estimate_tokens(request_text)
    completion_tokens = completion if completion is not None else estimate_tokens(output_text)
    total = provider_usage.get("totalTokens") if provider_usage else None
    if estimated or total is None:
        # provider total 只有在两侧都为真值时才可信（可能含 reasoning 等附加
        # 计数）；任一侧走了估算就用「真值 + 估算」重新求和。
        total = prompt_tokens + completion_tokens
    return {
        "type": "usage",
        "promptTokens": prompt_tokens,
        "completionTokens": completion_tokens,
        "totalTokens": total,
        "estimated": estimated,
    }


class _AgentUsageAggregator:
    """跨工具调用轮次累加 provider 真实用量。

    工具循环里每次 LLM 调用都是独立计费的一轮；usage 事件与落库必须覆盖
    全部轮次（累加）。任一轮某一侧缺失真值时，该侧整体退化为 ``None`` ——
    下游 ``_agent_usage_event`` / ``_record_agent_usage`` 对 ``None`` 侧回退
    本地估算并标 ``estimated``，绝不把「部分轮次真值」冒充成全程真值。
    单轮（无工具）场景下与直接透传该轮 usage 完全等价。

    prompt 侧的估算回退同样必须逐轮累加：多轮循环里每轮都会重新发送完整
    上下文，只按最终 request_text 估一次会漏掉前几轮的 prompt 消耗（低估
    计费）。调用方在每轮 LLM 调用前用该轮 loop_messages 的估算调用
    ``add_prompt_estimate``；真值缺失时下游以 ``estimated_prompt_tokens``
    为准。
    """

    def __init__(self) -> None:
        self._rounds = 0
        self._prompt: int | None = 0
        self._completion: int | None = 0
        self._total: int | None = 0
        self._estimated_prompt = 0

    @staticmethod
    def _accumulate(current: int | None, value: Any) -> int | None:
        if current is None:
            return None
        parsed = _usage_token_count(value)
        if parsed is None:
            return None
        return current + parsed

    def add(self, round_usage: dict[str, int | None] | None) -> None:
        self._rounds += 1
        usage = round_usage or {}
        self._prompt = self._accumulate(self._prompt, usage.get("promptTokens"))
        self._completion = self._accumulate(self._completion, usage.get("completionTokens"))
        self._total = self._accumulate(self._total, usage.get("totalTokens"))

    def add_prompt_estimate(self, tokens: int) -> None:
        """累加一轮 LLM 调用发起前的本地 prompt 估算（P2-H）。"""
        if isinstance(tokens, int) and tokens > 0:
            self._estimated_prompt += tokens

    @property
    def estimated_prompt_tokens(self) -> int:
        """全部已发起轮次的 prompt 估算合计（真值缺失时的回退口径）。"""
        return self._estimated_prompt

    def result(self) -> dict[str, int | None] | None:
        if self._rounds == 0:
            return None
        if self._prompt is None and self._completion is None and self._total is None:
            return None
        return {
            "promptTokens": self._prompt,
            "completionTokens": self._completion,
            "totalTokens": self._total,
        }


async def _stream_litellm_agent_events(stream):
    """把 LiteLLM streaming chunk 转成 Agent SSE 事件。

    - provider 显式返回 ``reasoning_content`` 等字段时，直接映射为 ``think``；
    - provider 把推理轨迹混在正文 ``<think>...</think>`` 中时，拆分为 ``think``；
    - 普通正文继续作为 ``delta``；
    - delta 里的 tool_calls 分片持续拼装，流结束后（若有）产出一条**内部**
      ``tool_calls`` 事件（``{"type":"tool_calls","toolCalls":[...]}``）——
      由 agent_chat 的执行循环消费并转译为对外的 ``tool_call``/``tool_result``
      SSE，绝不直接下发给客户端；
    - 流末尾拿到的真实 token 用量在所有正文事件之后映射为一条 ``usage``。
    """
    splitter = _ThinkTagSplitter()
    tool_call_assembler = _ToolCallAssembler()
    usage_payload: dict[str, int] | None = None
    async for part in stream:
        extracted_usage = _extract_stream_usage(part)
        if extracted_usage is not None:
            usage_payload = extracted_usage
        choices = getattr(part, "choices", None) or []
        if not choices:
            # include_usage 的收尾 chunk 只带 usage，没有 delta。
            continue
        delta = choices[0].delta

        tool_call_assembler.feed(_get_delta_field(delta, "tool_calls"))

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
    assembled_tool_calls = tool_call_assembler.result()
    if assembled_tool_calls:
        yield {"type": "tool_calls", "toolCalls": assembled_tool_calls}
    if usage_payload is not None:
        yield {"type": "usage", **usage_payload}


# 单篇正文截断阈值。MVP 期间整本博文塞进 prompt 不现实——按字符数硬截断让
# 大多数模型都能一次容下。后续可换成按 tokens 计数 + 智能 chunk。
_ARTICLE_EXCERPT_MAX_CHARS = 1800
_TAG_POST_LIMIT = 5


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


_RETRIEVAL_SNIPPET_MAX_CHARS = 800
_RETRIEVAL_TITLE_MAX_CHARS = 240


def _last_user_query(messages: list[AgentChatMessage] | None) -> str:
    for message in reversed(messages or []):
        if message.role == "user":
            # 只取文本部分做检索 query —— 图片 base64 不可进入语义召回。
            return _message_text(message).strip()
    return ""


def _receipt_value(row: Any, name: str, default: Any = None) -> Any:
    if isinstance(row, dict):
        return row.get(name, default)
    return getattr(row, name, default)


def _receipt_text(value: Any, max_chars: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


def _receipt_score(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        score = float(value)
    except (TypeError, ValueError):
        return None
    return score if math.isfinite(score) else None


def _receipt_href(value: Any) -> str | None:
    href = _receipt_text(value, 1000)
    if not href:
        return None
    if href == "/admin" or href.startswith("/admin/"):
        return href
    if href.startswith("/") and not href.startswith("//"):
        return f"/admin{href}"
    return None


def _receipt_int(value: Any, *, allow_zero: bool = False) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0 or (parsed == 0 and not allow_zero):
        return None
    return parsed


def _add_optional_hit_field(hit: dict[str, Any], name: str, value: Any) -> None:
    if value is not None and value != "":
        hit[name] = value


def _kb_hits_to_receipt_hits(hits: list[Any]) -> list[dict[str, Any]]:
    receipt_hits: list[dict[str, Any]] = []
    for raw in hits:
        kb_id = _receipt_int(_receipt_value(raw, "kb_id"))
        file_id = _receipt_int(_receipt_value(raw, "kb_file_id"))
        chunk_index = _receipt_int(_receipt_value(raw, "chunk_index"), allow_zero=True)
        if kb_id is None or file_id is None or chunk_index is None:
            continue

        kb_name = _receipt_text(_receipt_value(raw, "kb_name"), _RETRIEVAL_TITLE_MAX_CHARS)
        file_title = _receipt_text(_receipt_value(raw, "file_title"), _RETRIEVAL_TITLE_MAX_CHARS)
        hit: dict[str, Any] = {
            "key": f"kb:{kb_id}:file:{file_id}:chunk:{chunk_index}",
            "kind": "knowledge_base_chunk",
            "title": file_title or kb_name or f"知识库片段 #{chunk_index}",
        }
        _add_optional_hit_field(hit, "sourceTitle", kb_name)
        _add_optional_hit_field(
            hit,
            "snippet",
            _receipt_text(_receipt_value(raw, "snippet"), _RETRIEVAL_SNIPPET_MAX_CHARS),
        )
        _add_optional_hit_field(hit, "score", _receipt_score(_receipt_value(raw, "similarity")))
        slug = _receipt_text(_receipt_value(raw, "kb_slug"), _RETRIEVAL_TITLE_MAX_CHARS)
        if slug:
            hit["href"] = f"/admin/intelligence/knowledge/{quote(slug, safe='')}"
        receipt_hits.append(hit)
    return receipt_hits


def _atlas_context_to_receipt_hits(context: Any) -> list[dict[str, Any]]:
    receipt_hits: list[dict[str, Any]] = []
    kp_titles: dict[int, str] = {}

    for raw in _receipt_value(context, "knowledge_points", []) or []:
        kp_id = _receipt_int(_receipt_value(raw, "id"))
        if kp_id is None:
            continue
        title = _receipt_text(_receipt_value(raw, "title"), _RETRIEVAL_TITLE_MAX_CHARS) or f"知识点 #{kp_id}"
        kp_titles[kp_id] = title
        hit: dict[str, Any] = {
            "key": f"atlas:kp:{kp_id}",
            "kind": "atlas_knowledge_point",
            "title": title,
            "href": f"/admin/atlas/kp/{kp_id}",
        }
        _add_optional_hit_field(
            hit,
            "snippet",
            _receipt_text(_receipt_value(raw, "body_markdown"), _RETRIEVAL_SNIPPET_MAX_CHARS),
        )
        _add_optional_hit_field(hit, "score", _receipt_score(_receipt_value(raw, "similarity")))
        receipt_hits.append(hit)

    for raw in _receipt_value(context, "note_hits", []) or []:
        note_id = _receipt_int(_receipt_value(raw, "note_id"))
        chunk_index = _receipt_int(_receipt_value(raw, "chunk_index"), allow_zero=True)
        if note_id is None or chunk_index is None:
            continue
        title = _receipt_text(_receipt_value(raw, "title"), _RETRIEVAL_TITLE_MAX_CHARS) or f"笔记 #{note_id}"
        hit = {
            "key": f"atlas:note:{note_id}:chunk:{chunk_index}",
            "kind": "atlas_note",
            "title": title,
        }
        _add_optional_hit_field(
            hit,
            "snippet",
            _receipt_text(_receipt_value(raw, "chunk_text"), _RETRIEVAL_SNIPPET_MAX_CHARS),
        )
        _add_optional_hit_field(hit, "score", _receipt_score(_receipt_value(raw, "similarity")))
        _add_optional_hit_field(hit, "href", _receipt_href(_receipt_value(raw, "source_uri")))
        receipt_hits.append(hit)

    for raw in _receipt_value(context, "evidence", []) or []:
        annotation_id = _receipt_int(_receipt_value(raw, "annotation_id"))
        if annotation_id is None:
            continue
        kp_id = _receipt_int(_receipt_value(raw, "kp_id"))
        carrier_title = _receipt_text(
            _receipt_value(raw, "carrier_title"),
            _RETRIEVAL_TITLE_MAX_CHARS,
        )
        hit = {
            "key": f"atlas:evidence:{annotation_id}",
            "kind": "atlas_evidence",
            "title": carrier_title or f"证据 #{annotation_id}",
        }
        if kp_id is not None:
            _add_optional_hit_field(hit, "sourceTitle", kp_titles.get(kp_id) or f"知识点 #{kp_id}")
        _add_optional_hit_field(
            hit,
            "snippet",
            _receipt_text(_receipt_value(raw, "body_text"), _RETRIEVAL_SNIPPET_MAX_CHARS),
        )
        _add_optional_hit_field(hit, "href", _receipt_href(_receipt_value(raw, "source_uri")))
        receipt_hits.append(hit)

    return receipt_hits


def _rank_retrieval_hits(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in hits:
        key = str(raw.get("key") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        ranked.append({**raw, "rank": len(ranked) + 1})
    return ranked


def _retrieval_warning(scope: str, message: str, code: str = "retrieval_unavailable") -> dict[str, str]:
    return {"scope": scope, "code": code, "message": message}


async def _build_kb_retrieval_for_chat(
    pool,
    llm_router,
    *,
    kb_ids: list[int] | None,
    messages: list[AgentChatMessage],
    strict: bool = False,
) -> _AgentRetrievalPart:
    ids = _dedupe_positive_ints(kb_ids, 10)
    if not ids:
        return _AgentRetrievalPart()

    part = _AgentRetrievalPart(requested=True)
    query = _last_user_query(messages)
    if not query:
        part.outcome = "unavailable"
        part.warnings.append(
            _retrieval_warning(
                "knowledge_base",
                "缺少可用于知识库检索的问题，本次回答未使用所选资料。",
                "query_unavailable",
            )
        )
        return part

    try:
        # 局部导入避免顶部循环依赖。
        from app.services.kb_recall import recall_kbs, render_kb_context

        hits = await recall_kbs(
            pool,
            llm_router,
            kb_ids=ids,
            query=query,
            top_k_total=12,
            strict=strict,
        )
        part.context = render_kb_context(hits)
        part.hits = _kb_hits_to_receipt_hits(hits)
        part.outcome = "matched" if part.hits else "empty"
    except Exception:
        logger.warning("agent.kb_recall_failed", extra={"data": {"kb_ids": ids}})
        part.outcome = "unavailable"
        part.warnings.append(
            _retrieval_warning(
                "knowledge_base",
                "知识库检索暂不可用，本次回答可能未使用所选资料。",
            )
        )
    return part


async def _build_kb_context_for_chat(
    pool,
    llm_router,
    *,
    kb_ids: list[int] | None,
    messages: list[AgentChatMessage],
) -> str | None:
    """Backward-compatible context-only facade for focused callers/tests."""
    return (
        await _build_kb_retrieval_for_chat(
            pool,
            llm_router,
            kb_ids=kb_ids,
            messages=messages,
        )
    ).context


async def _build_atlas_retrieval_for_chat(
    pool,
    *,
    atlas_scope: AgentAtlasScope | None,
    user_id: int | None,
    llm_router=None,
    messages: list[AgentChatMessage] | None = None,
    strict: bool = False,
) -> _AgentRetrievalPart:
    if atlas_scope is None:
        return _AgentRetrievalPart()

    kp_ids = _dedupe_positive_ints(atlas_scope.kpIds, 12)
    carrier_ids = _dedupe_positive_ints(atlas_scope.carrierIds, 6)
    query = _last_user_query(messages)
    if not kp_ids and not carrier_ids and (not atlas_scope.semanticRecall or not query):
        return _AgentRetrievalPart()

    part = _AgentRetrievalPart(requested=True)
    if user_id is None:
        part.outcome = "unavailable"
        part.warnings.append(
            _retrieval_warning(
                "atlas",
                "Atlas 检索暂不可用，本次回答可能未使用所选知识。",
            )
        )
        return part

    try:
        from app.services.atlas_recall import (
            recall_atlas_context,
            render_atlas_context,
            selected_atlas_sources_snapshot,
        )

        selected_snapshot = None
        if strict:
            selected_snapshot = await selected_atlas_sources_snapshot(
                pool,
                llm=llm_router,
                user_id=user_id,
                kp_ids=kp_ids,
                carrier_ids=carrier_ids,
            )
        if strict and selected_snapshot is None:
            part.outcome = "unavailable"
            part.warnings.append(
                _retrieval_warning(
                    "atlas",
                    "部分所选 Atlas 来源不存在、无权访问或尚未准备完成，本次回答未使用所选知识。",
                    "selected_source_unavailable",
                )
            )
            return part

        context = await recall_atlas_context(
            pool,
            llm_router,
            user_id=user_id,
            query=query,
            kp_ids=kp_ids,
            carrier_ids=carrier_ids,
            semantic_limit=atlas_scope.semanticLimit if atlas_scope.semanticRecall else 0,
            neighborhood_depth=atlas_scope.neighborhoodDepth,
            include_evidence=atlas_scope.includeEvidence,
            strict=strict,
        )
        post_snapshot = None
        if strict:
            post_snapshot = await selected_atlas_sources_snapshot(
                pool,
                llm=llm_router,
                user_id=user_id,
                kp_ids=kp_ids,
                carrier_ids=carrier_ids,
            )
        if strict and (
            post_snapshot is None
            or post_snapshot != selected_snapshot
            or context.selected_note_revisions != selected_snapshot.note_revisions
        ):
            part.outcome = "unavailable"
            part.warnings.append(
                _retrieval_warning(
                    "atlas",
                    "部分所选 Atlas 来源不存在、无权访问或尚未准备完成，本次回答未使用所选知识。",
                    "selected_source_unavailable",
                )
            )
            return part
        part.context = render_atlas_context(context)
        part.hits = _atlas_context_to_receipt_hits(context)
        part.outcome = "matched" if part.hits else "empty"
    except Exception:
        logger.warning("agent.atlas_context_failed", extra={"data": {"kp_ids": kp_ids}})
        part.outcome = "unavailable"
        part.warnings.append(
            _retrieval_warning(
                "atlas",
                "Atlas 检索暂不可用，本次回答可能未使用所选知识。",
            )
        )
    return part


async def _build_atlas_context_for_chat(
    pool,
    *,
    atlas_scope: AgentAtlasScope | None,
    user_id: int | None,
    llm_router=None,
    messages: list[AgentChatMessage] | None = None,
) -> str | None:
    """Backward-compatible context-only facade for focused callers/tests."""
    return (
        await _build_atlas_retrieval_for_chat(
            pool,
            atlas_scope=atlas_scope,
            user_id=user_id,
            llm_router=llm_router,
            messages=messages,
        )
    ).context


def _build_retrieval_event(
    payload: AgentChatRequest,
    kb_part: _AgentRetrievalPart,
    atlas_part: _AgentRetrievalPart,
) -> dict[str, Any] | None:
    parts = [part for part in (kb_part, atlas_part) if part.requested]
    if not parts:
        return None

    atlas_scope = payload.atlasScope
    hits = _rank_retrieval_hits([hit for part in parts for hit in part.hits])
    outcomes = [part.outcome for part in parts]
    if hits:
        retrieval_status = "matched" if all(outcome == "matched" for outcome in outcomes) else "partial"
    elif any(outcome == "unavailable" for outcome in outcomes):
        retrieval_status = "unavailable"
    else:
        retrieval_status = "empty"

    return {
        "type": "retrieval",
        "version": 1,
        "status": retrieval_status,
        "requested": {
            "knowledgeBaseIds": _dedupe_positive_ints(payload.kbIds, 10),
            "atlasKnowledgePointIds": _dedupe_positive_ints(
                atlas_scope.kpIds if atlas_scope else None,
                12,
            ),
            "atlasCarrierIds": _dedupe_positive_ints(
                atlas_scope.carrierIds if atlas_scope else None,
                6,
            ),
        },
        "hits": hits,
        "warnings": [warning for part in parts for warning in part.warnings],
    }


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
            disabled_params=resolve_disabled_sampling_params(routing.model.capabilities),
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
            disabled_params=resolve_disabled_sampling_params(m.capabilities),
        )

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="尚未配置任何可用的 AI 模型 (admin → AI 配置 → 供应商/模型)。",
    )


_VISION_NOT_SUPPORTED_MESSAGE = "所选模型不支持图片输入，请更换支持视觉能力的模型"


async def _fetch_model_capabilities(pool, resolved: Any) -> dict[str, Any]:
    """按最终 (provider_code, model_id) 反查 ai_models 的 capabilities。

    路由解析（``_resolve_for_agent``）只关心凭证与启用状态，不携带
    capabilities。模型行缺失、capabilities 非法或查询失败一律返回空 dict ——
    调用方按「能力缺失」处理（vision 门禁 400 / tools 静默降级）。
    """
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT m.capabilities
                FROM ai_models m
                JOIN ai_providers p ON m.provider_id = p.id
                WHERE m.model_id = $1 AND p.code = $2
                ORDER BY m.is_enabled DESC, m.id ASC
                LIMIT 1
                """,
                resolved.model_id,
                resolved.provider_code,
            )
        if row is not None:
            raw = row["capabilities"]
            parsed = json.loads(raw) if isinstance(raw, str) else raw
            if isinstance(parsed, dict):
                return parsed
    except Exception:
        logger.warning(
            "agent.model_capability_lookup_failed",
            extra={
                "data": {
                    "provider_code": resolved.provider_code,
                    "model_id": resolved.model_id,
                }
            },
        )
    return {}


async def _ensure_vision_capability(pool, resolved: Any, payload: AgentChatRequest) -> None:
    """请求携带图片时校验最终解析出的模型具备视觉能力（fail-closed）。

    模型行缺失、capabilities 缺失或查询失败一律按"不支持"拒绝 ——
    宁可 400 也不把图片喂给纯文本模型。必须在真正调用 provider 之前执行。
    """
    if sum(_message_image_count(m) for m in payload.messages) == 0:
        return
    caps = await _fetch_model_capabilities(pool, resolved)
    if not _resolve_agent_model_abilities(caps).get("vision"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_VISION_NOT_SUPPORTED_MESSAGE,
        )


def _agent_usage_request_text(messages: list[dict[str, Any]]) -> str:
    """把实际发给 LLM 的多轮消息压成稳定文本，用于 token 估算。

    content-parts 数组只取文本片段；图片以占位符计入 —— 把 base64 当文本
    会让估算凭空多出数万 token。
    """
    parts: list[str] = []
    for message in messages:
        role = str(message.get("role") or "unknown")
        content = message.get("content")
        if content is None:
            # assistant(tool_calls) 消息的 content 允许为 None —— 不计入文本估算。
            text = ""
        elif isinstance(content, str):
            text = content
        elif isinstance(content, list):
            fragments: list[str] = []
            for item in content:
                if not isinstance(item, dict):
                    fragments.append(str(item))
                elif item.get("type") == "text":
                    fragments.append(str(item.get("text") or ""))
                elif item.get("type") == "image_url":
                    fragments.append("[image]")
            text = "\n".join(fragments)
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
    usage_tokens_in: int | None = None,
    usage_tokens_out: int | None = None,
) -> None:
    """把灵境问答写入 ai_usage_logs，供后台数据分析统计。

    provider 通过 ``stream_options.include_usage`` 返回了真实 usage 时优先
    落真实值（``usage_tokens_in/out``）；两侧独立判断——任一侧为 None 只
    回退该侧的本地估算，另一侧真值照常入库（与 SSE usage 事件同口径）。
    """
    endpoint = getattr(getattr(request, "url", None), "path", None) or "/api/v1/agent/chat"
    duration_ms = (time.perf_counter() - start_time) * 1000
    tokens_in = usage_tokens_in if usage_tokens_in is not None else estimate_tokens(request_text)
    tokens_out = usage_tokens_out if usage_tokens_out is not None else estimate_tokens(response_text)
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
                inputCostPer1M=_resolve_agent_model_cost_per_1m(row, caps, "input"),
                outputCostPer1M=_resolve_agent_model_cost_per_1m(row, caps, "output"),
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

    # 请求含图片时的视觉能力闸门 —— fail-closed，必须先于任何 provider 调用。
    await _ensure_vision_capability(pool, resolved, payload)

    # 把 @ / # picker 引用的文章 / 标签拼成上下文段（system 消息），让 Agent
    # 真正"看到"用户引用的素材，而不是只看到一句 "@xxx"。
    context_block = await _build_picker_context(
        pool,
        article_ids=payload.articleIds,
        tag_slugs=payload.tagSlugs,
    )
    # KB picker 选中后，按最后一条 user 消息做语义召回并拼一段 system 提示。
    # 与 picker_context 各占独立 system message，便于 prompt 调试 + 不互相覆盖。
    knowledge_context_mode = payload.knowledgeContextMode or "auto"
    if knowledge_context_mode == "none":
        # Defense in depth: the schema and Go proxy both normalize none to null
        # sentinels, but the route still avoids invoking either private recall
        # implementation based on the mode itself.
        kb_retrieval = _AgentRetrievalPart()
        atlas_retrieval = _AgentRetrievalPart()
    else:
        kb_retrieval = await _build_kb_retrieval_for_chat(
            pool, llm_router,
            kb_ids=payload.kbIds,
            messages=payload.messages,
            strict=knowledge_context_mode == "selected",
        )
        atlas_retrieval = await _build_atlas_retrieval_for_chat(
            pool,
            atlas_scope=payload.atlasScope,
            user_id=user_id,
            llm_router=llm_router,
            messages=payload.messages,
            strict=knowledge_context_mode == "selected",
        )
    kb_context = kb_retrieval.context
    atlas_context = atlas_retrieval.context
    retrieval_event = _build_retrieval_event(payload, kb_retrieval, atlas_retrieval)
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
    selected_context_blocked = (
        knowledge_context_mode == "selected"
        and (
            retrieval_event is None
            or any(
                part.requested and part.outcome == "unavailable"
                for part in (kb_retrieval, atlas_retrieval)
            )
            or not retrieval_event.get("hits")
            or not (kb_context or atlas_context)
        )
    )
    if knowledge_context_mode == "selected" and not selected_context_blocked:
        context_block = (
            _SELECTED_CONTEXT_POLICY
            if not context_block
            else _SELECTED_CONTEXT_POLICY + "\n\n---\n\n" + context_block
        )
    chat_messages = _build_chat_messages(payload, context_block=context_block)

    # A blocked selected-context turn never contacts the model endpoint, so it
    # must not depend on provider DNS/SSRF validation to return its recoverable
    # receipt. Every path that can call the provider still runs the guard.
    if not selected_context_blocked:
        await llm_router._guard_api_base(resolved.api_base)  # noqa: SLF001

    # 工具调用门禁：显式 enableTools 且模型 abilities.functionCall 为 true 才
    # 注册服务端白名单工具；能力缺失 / capabilities 查询失败一律静默降级为
    # 无工具普通对话（不报错）。mock 短路路径不查能力（无 DB 依赖），由
    # generate() 直接产出固定的 tool_call → tool_result → delta 联调序列。
    # kbIds 已经过 Go 端权限过滤/注入 —— search_knowledge_base 只在该范围内
    # 检索；kbIds 为空时该工具不注册。
    agent_tools: list[AgentToolSpec] = []
    if (
        payload.enableTools
        and not selected_context_blocked
        and not (settings.mock_mode and not resolved.override)
    ):
        caps = await _fetch_model_capabilities(pool, resolved)
        if _resolve_agent_model_abilities(caps).get("functionCall"):
            agent_tools = build_agent_tools(pool, llm_router, kb_ids=payload.kbIds)

    async def generate():
        start_time = time.perf_counter()
        request_text = _agent_usage_request_text(chat_messages)
        response_parts: list[str] = []
        think_parts: list[str] = []
        error_code: str | None = None
        # provider 返回的真实 token 用量（stream_options.include_usage）。
        # 单侧可能为 None（部分网关只回一侧）；成功路径在 done 前下发一条
        # usage 事件，缺失侧回退估算并标 estimated。
        provider_usage: dict[str, int | None] | None = None
        # The receipt is emitted before provider output in both real and mock
        # modes, so clients can render grounding state before any answer text.
        if retrieval_event is not None:
            data = json.dumps(retrieval_event, ensure_ascii=False)
            yield f"data: {data}\n\n"
        if selected_context_blocked:
            error_event = {
                "type": "error",
                "code": _SELECTED_CONTEXT_NOT_GROUNDED_CODE,
                "message": _SELECTED_CONTEXT_NOT_GROUNDED_MESSAGE,
                "retryable": True,
            }
            yield f"data: {json.dumps(error_event, ensure_ascii=False)}\n\n"
            await _record_agent_usage(
                request=request,
                metrics=metrics,
                usage_logger=usage_logger,
                user_id=user_id,
                resolved=resolved,
                request_text=request_text,
                response_text="",
                start_time=start_time,
                success=False,
                error_code=_SELECTED_CONTEXT_NOT_GROUNDED_CODE,
            )
            return
        if settings.mock_mode and not resolved.override:
            if payload.enableTools:
                # 固定的工具调用联调序列 —— 让前端在 mock 模式下就能开发
                # tool_call / tool_result 的 UI，无需真实 provider 与工具执行。
                mock_call = {
                    "type": "tool_call",
                    "id": "call_mock_1",
                    "name": "search_posts",
                    "arguments": json.dumps({"query": "mock", "limit": 5}, ensure_ascii=False),
                }
                yield f"data: {json.dumps(mock_call, ensure_ascii=False)}\n\n"
                mock_result = {
                    "type": "tool_result",
                    "id": "call_mock_1",
                    "name": "search_posts",
                    "result": json.dumps(
                        [{"id": 1, "title": "Mock 文章", "summary": "mock 摘要"}],
                        ensure_ascii=False,
                    ),
                    "isError": False,
                }
                yield f"data: {json.dumps(mock_result, ensure_ascii=False)}\n\n"
            for chunk in [
                "[mock:", resolved.model, "] ", "你好,",
                "我已收到 ", str(len(payload.messages)), " 条消息。"
            ]:
                response_parts.append(chunk)
                yield f'data: {json.dumps({"type": "delta", "content": chunk}, ensure_ascii=False)}\n\n'
            mock_usage = _agent_usage_event(
                None,
                request_text=request_text,
                output_text="".join(response_parts),
            )
            yield f"data: {json.dumps(mock_usage, ensure_ascii=False)}\n\n"
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
        # 跨轮次 usage 聚合器必须在 try 之外创建：finally 的落库路径依赖
        # 它的 prompt 估算合计（异常发生在首轮调用前时为 0，回退旧口径）。
        usage_aggregator = _AgentUsageAggregator()
        try:
            base_completion_kwargs = _agent_completion_kwargs(
                model=resolved.model,
                temperature=resolved.temperature,
                max_tokens=resolved.max_tokens,
                model_params=payload.modelParams,
                disabled_params=resolved.disabled_params,
            )
            # 让支持的 provider 在流末尾追加真实 token 用量 chunk；
            # 被拒时 _start_agent_stream 会自动去掉该参数降级重试。
            base_completion_kwargs["stream_options"] = {"include_usage": True}

            # ---- 工具调用执行循环 ----
            # 无工具时恰好跑一轮，与历史单次流式行为等价。
            tool_schemas = [spec.openai_schema() for spec in agent_tools]
            tools_by_name = {spec.name: spec for spec in agent_tools}
            loop_messages = list(chat_messages)
            offer_tools = bool(tool_schemas)
            tool_rounds = 0
            while True:
                # P2-H：每轮 LLM 调用发起前，用该轮完整上下文累加本地 prompt
                # 估算 —— provider 不回真实 usage 时按此合计计费，而不是只按
                # 最终 request_text 估一次（多轮循环会严重低估）。此处
                # request_text 恰等于 _agent_usage_request_text(loop_messages)
                # （首轮在 try 前初始化，后续轮在上一轮末尾同步刷新）。
                usage_aggregator.add_prompt_estimate(estimate_tokens(request_text))
                completion_kwargs = dict(base_completion_kwargs)
                if offer_tools:
                    completion_kwargs["tools"] = tool_schemas
                stream = await _start_agent_stream(
                    resolved=resolved,
                    chat_messages=loop_messages,
                    completion_kwargs=completion_kwargs,
                )
                round_usage: dict[str, int | None] | None = None
                round_tool_calls: list[dict[str, str]] | None = None
                round_text_parts: list[str] = []
                async for event in _stream_litellm_agent_events(stream):
                    if event.get("type") == "usage":
                        # 真实用量不立刻透传 —— 各轮累加后统一在 done 前按
                        # 协议格式下发。保留单侧 None 语义（不要用 0 兜底）：
                        # 缺失侧由 _agent_usage_event / _record_agent_usage
                        # 逐项回退估算。
                        round_usage = {
                            "promptTokens": event.get("promptTokens"),
                            "completionTokens": event.get("completionTokens"),
                            "totalTokens": event.get("totalTokens"),
                        }
                        continue
                    if event.get("type") == "tool_calls":
                        # 内部拼装完成事件，不直接下发；由下方执行段转译。
                        round_tool_calls = event.get("toolCalls") or None
                        continue
                    content = event.get("content", "") or ""
                    if event.get("type") == "think":
                        think_chars += len(content)
                        think_parts.append(content)
                    else:
                        response_chars += len(content)
                        response_parts.append(content)
                        round_text_parts.append(content)
                    data = json.dumps(event, ensure_ascii=False)
                    yield f"data: {data}\n\n"
                usage_aggregator.add(round_usage)
                provider_usage = usage_aggregator.result()

                # 未注册工具（或已因轮次超限撤下）时忽略任何 tool_calls 残片，
                # 该轮即最终回答。
                if not offer_tools or not round_tool_calls:
                    break

                tool_rounds += 1
                # 单轮执行数硬上限：第 9 个起既不执行也不逐个下发 / 回填
                # （每个多余调用要占两条 SSE 事件 + 两条上下文消息），合并为
                # 一条 isError 回执。协议上保留第一个超限调用进 assistant
                # tool_calls 作为回执挂载点（tool 消息的 tool_call_id 必须能
                # 对上），其余超限调用彻底忽略。
                executed_calls = round_tool_calls[:_MAX_TOOL_CALLS_PER_ROUND]
                overflow_calls = round_tool_calls[_MAX_TOOL_CALLS_PER_ROUND:]
                backfill_calls = executed_calls + overflow_calls[:1]
                # OpenAI 协议：assistant(tool_calls) + 每个调用一条 tool 消息，
                # 缺一不可，否则下一轮请求会被 provider 拒绝。oversized 调用
                # 回填截断版 arguments，保证上下文不被超长参数撑爆。
                loop_messages.append(
                    {
                        "role": "assistant",
                        "content": "".join(round_text_parts) or None,
                        "tool_calls": [
                            {
                                "id": call["id"],
                                "type": "function",
                                "function": {
                                    "name": call["name"],
                                    "arguments": _tool_call_wire_arguments(call),
                                },
                            }
                            for call in backfill_calls
                        ],
                    }
                )
                for call in executed_calls:
                    call_event = {
                        "type": "tool_call",
                        "id": call["id"],
                        "name": call["name"],
                        "arguments": _tool_call_wire_arguments(call),
                    }
                    yield f"data: {json.dumps(call_event, ensure_ascii=False)}\n\n"
                    spec = tools_by_name.get(call["name"])
                    if call.get("oversized"):
                        # arguments 累加超过 8KB 硬限：不执行，直接拒绝。
                        result_text, is_error = _TOOL_ARGUMENTS_OVERSIZED_RESULT, True
                    elif spec is None:
                        # 白名单外的工具名（provider 幻觉）：不执行，回错误结果。
                        result_text, is_error = "未知工具：仅支持服务端白名单工具", True
                    else:
                        result_text, is_error = await run_agent_tool(spec, call["arguments"])
                    result_event = {
                        "type": "tool_result",
                        "id": call["id"],
                        "name": call["name"],
                        "result": result_text,
                        "isError": is_error,
                    }
                    yield f"data: {json.dumps(result_event, ensure_ascii=False)}\n\n"
                    loop_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call["id"],
                            "content": result_text,
                        }
                    )
                if overflow_calls:
                    merged = overflow_calls[0]
                    merged_text = f"本轮工具调用超过上限，已忽略 {len(overflow_calls)} 个"
                    merged_event = {
                        "type": "tool_result",
                        "id": merged["id"],
                        "name": merged["name"],
                        "result": merged_text,
                        "isError": True,
                    }
                    yield f"data: {json.dumps(merged_event, ensure_ascii=False)}\n\n"
                    loop_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": merged["id"],
                            "content": merged_text,
                        }
                    )
                if tool_rounds >= _MAX_TOOL_ROUNDS:
                    # 超限强制收敛：撤下 tools 参数 + 注入 system 提示，
                    # 下一轮模型只能直接作答。
                    offer_tools = False
                    loop_messages.append(
                        {"role": "system", "content": _TOOL_ROUND_LIMIT_PROMPT}
                    )
                # 计费估算口径覆盖全部轮次：工具结果与 assistant(tool_calls)
                # 都进入了下一轮 prompt，request_text 同步扩展。
                request_text = _agent_usage_request_text(loop_messages)
            logger.info(
                "agent.stream_done",
                extra={
                    "data": {
                        "provider_code": resolved.provider_code,
                        "model_id": resolved.model_id,
                        "response_chars": response_chars,
                        "think_chars": think_chars,
                        "tool_rounds": tool_rounds,
                        "provider_usage": provider_usage,
                    }
                },
            )
            usage_event = _agent_usage_event(
                provider_usage,
                request_text=request_text,
                output_text="".join(think_parts) + "".join(response_parts),
                # prompt 侧真值缺失时用逐轮累加的估算合计（P2-H），与 finally
                # 的 _record_agent_usage 落库同口径。
                estimated_prompt_tokens=usage_aggregator.estimated_prompt_tokens or None,
            )
            yield f"data: {json.dumps(usage_event, ensure_ascii=False)}\n\n"
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
            # prompt 侧真值缺失时落库逐轮累加的估算合计（P2-H）——与 SSE usage
            # 事件同口径；一轮都没发起（估算合计为 0）时保持 None，让
            # _record_agent_usage 沿用旧的 request_text 单次估算兜底。
            usage_tokens_in = (provider_usage or {}).get("promptTokens")
            if usage_tokens_in is None and usage_aggregator.estimated_prompt_tokens > 0:
                usage_tokens_in = usage_aggregator.estimated_prompt_tokens
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
                    usage_tokens_in=usage_tokens_in,
                    usage_tokens_out=(provider_usage or {}).get("completionTokens"),
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
