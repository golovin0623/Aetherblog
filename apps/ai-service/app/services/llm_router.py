# ref: §2.4.2.5 - 支持动态配置的 LLM 路由器（LLM Router with Dynamic Configuration）
"""
支持动态模型路由的 LLM Router 服务。

这是增强版，支持：
- 来自数据库的动态模型路由
- 多 provider（OpenAI、DeepSeek、Qwen 等）
- Fallback 模型
- 按用户维度的配置
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from dataclasses import dataclass
from typing import Any, AsyncGenerator, TYPE_CHECKING

from fastapi import HTTPException
from litellm import acompletion, aembedding

from app.core.config import get_settings
from app.utils.url_validator import validate_external_url_async

if TYPE_CHECKING:
    from app.services.model_router import ModelRouter, RoutingConfig

logger = logging.getLogger("ai-service")

# 已知的"非 chat"模型类型集合 —— agent override / ModelPicker / fallback
# 三处 (llm_router._resolve_override / agent.py:agent fallback loop /
# agent.py:list_agent_models SQL) 必须共享同一份口径, 否则用户能从某条
# 路径绕过, 选到 ModelPicker 故意藏起来的 embedding / TTS 等模型。
#
# 设计选择: 用 denylist 而非 allowlist —— DB 中 model_type 历史值还包含
# 'text' / 'all' / NULL 这些被视作 chat-capable 的 legacy 值, allowlist
# 会把它们一并误剔。新增非 chat 模型类型时, 只需扩这一处。
NON_CHAT_MODEL_TYPES: frozenset[str] = frozenset(
    {"embedding", "audio", "image", "tts", "stt", "text2video", "video"}
)

# 当 DB 路由配置与 task type 的 ``default_max_tokens`` 均缺失（仅依赖
# 环境变量回退路径）时的 max_tokens 兜底上限。没有这一层兜底，LiteLLM
# 会把 ``None`` 直接转发给上游 provider，模型会一直生成直至填满上下文
# 窗口 —— 这是“summary 返回千字问答”这类问题的根因。这里的数值大致
# 对齐 migrations/000019_seed_ai_task_types.up.sql 中的种子默认值，
# 确保即便 routing 表为空，行为也与全新安装一致。
_TASK_DEFAULT_MAX_TOKENS: dict[str, int] = {
    "summary": 600,
    "tags": 200,
    "titles": 300,
    "polish": 4000,
    "outline": 2000,
    "translate": 2000,
    "qa": 2000,
}

# 当 ``ai_task_routing`` / ``ai_task_types`` 都查不到 prompt_template 时
# 使用的最后一道 system prompt 防线。覆盖以下故障场景：
#   1. 用户在 admin UI 选了 modelId（命中 _resolve_override 路径）
#      但任务路由表里没显式 routing；
#   2. ai_task_types 表为空（迁移未应用 / 行被手动删除）；
#   3. 任意能让 prompt_template = None 的回退路径。
# 没有这一层，模型会收到 *只有用户文章* 的单条 user 消息，把它当聊天
# 问句作答 —— 这是“493 字正文 → 1494 字带 ### 小标题的扩写”一类怪
# 输出的真正根因。文案故意写得简短保守，宁可让模型产出朴素结果，
# 也绝不允许它跑偏成多段问答。
_TASK_FALLBACK_SYSTEM_PROMPT: dict[str, str] = {
    "summary": (
        "你是一名严谨的中文摘要助手。请阅读用户提供的文章, "
        "用一段连贯的中文段落总结核心要点, 字数严格控制在 200 字以内, "
        "不得分点, 不得加任何小标题, 不得使用问答形式, "
        "不得复述原文标题或加 '本文'/'摘要:' 之类前缀。"
    ),
    "tags": (
        "你是标签生成助手。读取用户文章, 仅输出一个 JSON 对象, 包含两个字段: "
        "'matches' (从【现有标签库】中精准命中的标签数组,每项 {name, reason?}), "
        "'suggestions' (现有库未覆盖时才补充的全新短标签字符串数组)。"
        "如果调用方没有提供现有标签库, 让 matches 为空数组, 全部输出在 suggestions 中。"
        "不要任何其它文字、解释或代码块标记。"
    ),
    "titles": (
        "你是标题建议助手。读取用户文章, 仅输出一个 JSON 数组, "
        "包含 3-5 条候选中文标题, 每条不超过 30 字, "
        "不要任何其它文字、解释或代码块标记。"
    ),
    "polish": (
        "你是中文润色助手。请只调整用户文章的表达流畅度、错别字与语序, "
        "禁止改动原文事实、删减段落或新增内容, 直接输出润色后的全文。"
    ),
    "outline": (
        "你是大纲生成助手。读取用户文章, 输出一个层次清晰的中文 Markdown 大纲, "
        "使用 ## / ### 标记, 不要写正文段落。"
    ),
    "translate": (
        "你是翻译助手。请把用户提供的内容忠实翻译为目标语言, "
        "保留原始 Markdown 结构与专有名词, 不要新增解释或评论。"
    ),
    "qa": (
        "你是问答助手, 只能基于用户提供的参考内容作答。"
        "若参考内容不足以作答, 直接说明'参考内容中未提供该信息', 不要编造。"
    ),
}


def _normalize_model_parts(model: str | None) -> tuple[str | None, str | None]:
    if not model:
        return None, None
    if "/" not in model:
        return None, model
    provider_code, model_id = model.split("/", 1)
    return provider_code, model_id


def _is_chat_capable_model(model: Any) -> bool:
    model_type = (getattr(model, "model_type", None) or "chat").lower()
    capabilities = getattr(model, "capabilities", {}) or {}
    if not isinstance(capabilities, dict):
        capabilities = {}
    return model_type not in NON_CHAT_MODEL_TYPES and capabilities.get("chat") is not False


# OpenAI 的 reasoning 系列 (gpt-5 全家 / o1 / o3 / o4-mini) 在 Chat Completions
# 接口上 **拒绝任何非 1 的 temperature**，发出去会被 LiteLLM 直接 raise
# ``UnsupportedParamsError: ... Only temperature=1 is supported.``。线上事故：
# 任务路由配的 summary 模型是 gpt-5-codex，但 ``ai_task_routing.config`` 缺省
# 会回退到 0.7 (见 _resolve_route)，于是每次"生成"都炸。
#
# 这里采用 denylist + 前缀匹配——一次 list 匹配所有变体 (gpt-5 / gpt-5-mini /
# gpt-5-nano / gpt-5-codex / gpt-5.1 / o1 / o1-mini / o3 / o3-mini / o4-mini)，
# 命中即把 temperature 整个剔掉，让上游用各自默认值；不强行写 1.0 是为了
# 兼容 gpt-5.1 在 reasoning_effort='none' 下能接受任意 temperature 的特例。
_TEMPERATURE_LOCKED_MODEL_PREFIXES: tuple[str, ...] = (
    "gpt-5",
    "o1",
    "o3",
    "o4-mini",
)


def _model_locks_temperature(model: str | None) -> bool:
    """判定给定 ``model`` 是否属于 ``temperature`` 强制锁定家族。

    ``model`` 是已经过 ``_prefix_model_for_litellm`` 处理后的 LiteLLM 形态，
    可能含 ``openai/`` / ``azure/`` 前缀，也可能是裸模型名。
    """
    if not model:
        return False
    _, model_id = _normalize_model_parts(model)
    bare = (model_id or "").lower()
    return any(bare.startswith(p) for p in _TEMPERATURE_LOCKED_MODEL_PREFIXES)


def _completion_kwargs(
    *,
    model: str,
    temperature: float | None,
    max_tokens: int | None,
) -> dict[str, Any]:
    """构造 ``acompletion`` 的可选 kwargs，按模型家族剔除不兼容参数。

    单一职责：所有 ``acompletion(...)`` 调用前都从这里拿参数字典，避免把
    model-specific 兼容判断散落在各 call site。``aembedding`` 不传 temperature，
    与本函数无关，需要类似裁剪时另开。
    """
    kwargs: dict[str, Any] = {}
    if temperature is not None and not _model_locks_temperature(model):
        kwargs["temperature"] = temperature
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    return kwargs


class LlmRouter:
    """
    支持动态配置的 LLM Router。

    当数据库路由不可用时，会回退到环境变量配置。
    """

    def __init__(self, model_router: "ModelRouter | None" = None) -> None:
        self.settings = get_settings()
        self.model_router = model_router

    def resolve_model(self, alias: str) -> str:
        """将模型别名解析为模型名（基于环境变量的回退）。"""
        mapping = {
            "summary": self.settings.model_summary,
            "tags": self.settings.model_tags,
            "titles": self.settings.model_titles,
            "polish": self.settings.model_polish,
            "outline": self.settings.model_outline,
            "translate": self.settings.model_translate,
            "embedding": self.settings.model_embedding,
        }
        return mapping.get(alias, alias)

    @staticmethod
    def _prefix_model_for_litellm(model_id: str, api_type: str | None) -> str:
        """
        为模型名添加 provider 前缀，确保 LiteLLM 路由正确。

        LiteLLM 会按模型名前缀自动识别 provider：
        - gemini-* → Vertex AI（需要 Google Cloud SDK）
        - claude-* → Anthropic API
        - gpt-* → OpenAI API

        对于自定义 API 端点，必须显式加前缀以强制走正确的路由：
        - openai_compat/custom：加 'openai/' 前缀，强制走 OpenAI 兼容协议
        - azure：加 'azure/' 前缀走 Azure OpenAI Service
        - anthropic：无需前缀（LiteLLM 原生支持 Anthropic API）
        - google：使用 API key 认证时无需前缀；走 Vertex AI 则需要凭证
        """
        if not api_type:
            return model_id

        # openai_compat 与 custom：强制走 OpenAI 兼容路由
        if api_type in ("openai_compat", "custom"):
            if not model_id.startswith("openai/"):
                return f"openai/{model_id}"

        # Azure OpenAI：加 azure/ 前缀
        elif api_type == "azure":
            if not model_id.startswith("azure/"):
                return f"azure/{model_id}"

        # anthropic：LiteLLM 原生处理 claude-* 模型
        # google：LiteLLM 原生处理 gemini-* 模型（使用 api_key）
        # 这两类无需前缀，靠 api_key + api_base 即可工作

        return model_id

    @dataclass
    class _ResolvedRoute:
        model: str
        provider_code: str | None
        model_id: str | None
        input_cost_per_1m: float | None
        output_cost_per_1m: float | None
        cached_input_cost_per_1m: float | None
        api_key: str | None
        api_base: str | None
        temperature: float
        max_tokens: int | None
        prompt_template: str | None
        override: bool

    async def _get_routing(self, task_type: str, user_id: int | None = None) -> "RoutingConfig | None":
        """如可用则从 model router 获取路由配置。"""
        if self.model_router:
            try:
                return await self.model_router.resolve_routing(task_type, user_id)
            except Exception as e:
                logger.warning(f"Failed to get routing from DB, using env config: {e}")
        return None

    async def has_task_routing(self, task_type: str, user_id: int | None = None) -> bool:
        """Return whether a chat task has a fully resolvable DB route.

        This intentionally checks the same resolved route used at runtime,
        including credential availability and chat model compatibility. Search
        QA depends on this to avoid falling through to the generic env fallback
        with ``model="qa"``.
        """
        routing = await self._get_routing(task_type, user_id)
        return bool(routing and _is_chat_capable_model(routing.model))

    async def _load_task_type_prompt(self, task_alias: str | None) -> str | None:
        """从 ``ai_task_types`` 单独取 prompt_template, 给 override / 回退路径使用。

        SUMMARY-LONGER-THAN-SOURCE BUGFIX:
        ``_resolve_override`` 与 ``_resolve_route`` 的环境变量回退分支历史
        上把 ``prompt_template`` 写死成 ``None``。一旦命中 (例如管理员在
        UI 选了一个自定义模型, 携带 ``modelId``), ``_build_messages``
        就会拿到 ``None`` 模板, 把整篇文章作为单条 user 消息裸发出去,
        模型把它当聊天问句回答 -- 真实事故里 493 字正文产出 1494 字带
        ``### 1.`` ``### 2.`` 小标题的扩写, 完全不像摘要。

        修复策略: 只要任务别名在已知业务任务列表里, 就额外查一次
        ``ai_task_types.prompt_template`` (migration 000019 创建, 000038
        重写) 作为这条路径的 system 指令。仍然失败时让 ``_build_messages``
        走 ``_TASK_FALLBACK_SYSTEM_PROMPT`` 的最终防线。
        """
        if not task_alias:
            return None
        if not self.model_router or not getattr(self.model_router, "pool", None):
            return None
        try:
            async with self.model_router.pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT prompt_template FROM ai_task_types WHERE code = $1",
                    task_alias,
                )
        except Exception as exc:
            logger.warning(
                "llm_router.task_type_prompt_lookup_failed",
                extra={"data": {"task_alias": task_alias, "error": str(exc)}},
            )
            return None
        if not row:
            return None
        template = row["prompt_template"]
        if isinstance(template, str) and template.strip():
            return template
        return None

    async def _resolve_override(
        self,
        model_id: str | None,
        provider_code: str | None,
        user_id: int | None,
        model_alias: str | None = None,
        allow_override: bool = False,
    ) -> "LlmRouter._ResolvedRoute | None":
        if not model_id or not allow_override:
            return None
        if not self.model_router:
            raise ValueError("Model override is not available")

        model = await self.model_router.provider_registry.get_model(model_id, provider_code)
        if not model:
            raise ValueError("Requested model not found")

        # is_enabled 校验有意保留: provider_registry 的 _model_cache 不会因为
        # disable 操作主动失效, 这道闸是 stale-cache 命中后的最后兜底。
        if not model.is_enabled or not _is_chat_capable_model(model):
            raise ValueError("Requested model is not available for agent chat")

        credential = await self.model_router.credential_resolver.get_credential(
            model.provider_code,
            user_id=user_id,
        )
        if not credential:
            raise ValueError("Credential not found for requested provider")

        # 加 provider 前缀，确保 LiteLLM 路由正确
        prefixed_model = self._prefix_model_for_litellm(model.model_id, credential.api_type)

        # SUMMARY-LONGER-THAN-SOURCE BUGFIX: 用户手动选模型时, 必须
        # 继承任务自带的 system prompt, 否则文章会裸发给模型当聊天问句。
        override_prompt_template = await self._load_task_type_prompt(model_alias)

        return LlmRouter._ResolvedRoute(
            model=prefixed_model,
            provider_code=model.provider_code,
            model_id=model.model_id,
            input_cost_per_1m=model.input_cost_per_1m,
            output_cost_per_1m=model.output_cost_per_1m,
            cached_input_cost_per_1m=model.cached_input_cost_per_1m,
            api_key=credential.api_key,
            api_base=credential.base_url,
            temperature=0.7,
            # 用户手动指定的模型仍需继承任务的硬上限，避免管理员点
            # “测试该模型”时不慎触发无上限的 8K-token 生成。
            max_tokens=_TASK_DEFAULT_MAX_TOKENS.get(model_alias or ""),
            prompt_template=override_prompt_template,
            override=True,
        )

    async def _resolve_route(
        self,
        model_alias: str,
        user_id: int | None = None,
        model_id: str | None = None,
        provider_code: str | None = None,
        allow_override: bool = False,
    ) -> "LlmRouter._ResolvedRoute":
        override = await self._resolve_override(
            model_id,
            provider_code,
            user_id,
            model_alias=model_alias,
            allow_override=allow_override,
        )
        if override:
            return override

        routing = await self._get_routing(model_alias, user_id)
        if routing:
            if not _is_chat_capable_model(routing.model):
                raise ValueError(
                    f"Configured model for task '{model_alias}' is not available for chat"
                )
            # 加 provider 前缀，确保 LiteLLM 路由正确
            prefixed_model = self._prefix_model_for_litellm(
                routing.model.model_id, routing.credential.api_type
            )
            return LlmRouter._ResolvedRoute(
                model=prefixed_model,
                provider_code=routing.model.provider_code,
                model_id=routing.model.model_id,
                input_cost_per_1m=routing.model.input_cost_per_1m,
                output_cost_per_1m=routing.model.output_cost_per_1m,
                cached_input_cost_per_1m=routing.model.cached_input_cost_per_1m,
                api_key=routing.credential.api_key,
                api_base=routing.credential.base_url,
                temperature=routing.config.get("temperature", 0.7),
                max_tokens=routing.config.get("max_tokens"),
                prompt_template=routing.prompt_template,
                override=False,
            )

        provider_code, model_id = _normalize_model_parts(self.resolve_model(model_alias))
        # 同样地: 即便 routing 表为空, 也要从 ai_task_types 取 prompt 兜底,
        # 避免环境变量回退路径退化成"裸发文章"。
        fallback_prompt_template = await self._load_task_type_prompt(model_alias)
        return LlmRouter._ResolvedRoute(
            model=self.resolve_model(model_alias),
            provider_code=provider_code,
            model_id=model_id,
            input_cost_per_1m=None,
            output_cost_per_1m=None,
            cached_input_cost_per_1m=None,
            api_key=self.settings.openai_api_key,
            api_base=self.settings.openai_base_url,
            temperature=0.7,
            max_tokens=_TASK_DEFAULT_MAX_TOKENS.get(model_alias),
            prompt_template=fallback_prompt_template,
            override=False,
        )

    async def resolve_usage_context(
        self,
        model_alias: str,
        user_id: int | None = None,
        model_id: str | None = None,
        provider_code: str | None = None,
        allow_override: bool = True,
    ) -> dict[str, str | float | None]:
        resolved = await self._resolve_route(
            model_alias=model_alias,
            user_id=user_id,
            model_id=model_id,
            provider_code=provider_code,
            allow_override=allow_override,
        )
        normalized_provider, normalized_model_id = _normalize_model_parts(resolved.model)
        effective_provider = resolved.provider_code or normalized_provider
        effective_model_id = resolved.model_id or normalized_model_id or resolved.model
        return {
            "model": resolved.model,
            "provider_code": effective_provider,
            "model_id": effective_model_id,
            "input_cost_per_1m": resolved.input_cost_per_1m,
            "output_cost_per_1m": resolved.output_cost_per_1m,
            "cached_input_cost_per_1m": resolved.cached_input_cost_per_1m,
        }

    async def resolve_effective_model(
        self,
        model_alias: str,
        user_id: int | None = None,
        model_id: str | None = None,
        provider_code: str | None = None,
        allow_override: bool = True,
    ) -> str:
        resolved = await self._resolve_route(
            model_alias=model_alias,
            user_id=user_id,
            model_id=model_id,
            provider_code=provider_code,
            allow_override=allow_override,
        )
        return resolved.model

    def _render_prompt(self, template: str | None, default_template: str, **kwargs) -> str:
        """用给定变量渲染 prompt 模板。

        旧实现直接调用 :pymeth:`str.format`，非常脆弱：用户内容里任何字面
        ``{`` / ``}``（代码片段、JSON、LaTeX 等）都会抛出 ``KeyError`` /
        ``IndexError``，让调用退化到有损的拼接回退。此处的安全渲染器只
        替换已知的占位符 key，其它所有花括号原样保留，使用户内容能逐字
        通过。
        """
        tpl = template or default_template
        try:
            return self._safe_format(tpl, kwargs)
        except Exception as exc:  # pragma: no cover - 防御性
            logger.error(
                "llm_router.prompt_render_failed",
                extra={"data": {"error": str(exc), "error_type": type(exc).__name__, "template": tpl[:120] if tpl else ""}},
            )
            return f"{tpl}\n\nContext: {kwargs}"

    @staticmethod
    def _mask_secret(value: str | None) -> str:
        """对凭证 / API key 做尾部 4 位保留的脱敏, 满足审计可定位但不泄露明文。"""
        if not value:
            return ""
        if len(value) <= 4:
            return "****"
        return f"****{value[-4:]}"

    @staticmethod
    def _summarize_messages(messages: list[dict[str, str]], snippet_chars: int = 800) -> list[dict[str, Any]]:
        """缩略 messages 数组用于日志, 截断每条 content 防止日志爆炸。

        默认保留每条消息前 ``snippet_chars`` 个字符 (含 system 指令完整上限,
        约 800 字足以放下任意 task 的 system prompt; user 文章则会被截断,
        附 char_total 用于核对)。
        """
        out: list[dict[str, Any]] = []
        for m in messages:
            content = m.get("content", "") or ""
            char_total = len(content)
            snippet = content[:snippet_chars]
            entry: dict[str, Any] = {
                "role": m.get("role", ""),
                "char_total": char_total,
                "content_snippet": snippet,
            }
            if char_total > snippet_chars:
                entry["truncated"] = True
            out.append(entry)
        return out

    def _log_chat_request(
        self,
        *,
        task_alias: str,
        resolved: "LlmRouter._ResolvedRoute",
        messages: list[dict[str, str]],
        prompt_template_used: str | None,
        custom_prompt: str | None,
        stream: bool,
    ) -> None:
        """以 INFO 级别打印完整 LLM 调用报文, 便于线上"实际发了什么"的审计。

        SUMMARY-LONGER-THAN-SOURCE 排查需求: 用户从手机点"生成摘要"后,
        以前没法知道实际发到模型的 system / user 报文是什么、有没有 prompt、
        max_tokens 几何 -- 整条链路全靠猜。这里把关键参数 + messages 缩略
        (脱敏 api_key) 打到 docker logs。运维要详查时可在 admin 系统设置
        把 ai-service 的 root logger 调到 DEBUG 拿到 full payload。

        敏感字段处理:
          * api_key 调用 _mask_secret 仅保留尾 4 位
          * messages 每条 content 截断至 800 字符 (system prompt 通常 <500 字),
            并标 truncated=True / char_total
        """
        try:
            logger.info(
                "llm_router.chat_request",
                extra={
                    "data": {
                        "task_alias": task_alias,
                        "model": resolved.model,
                        "provider_code": resolved.provider_code,
                        "model_id": resolved.model_id,
                        "api_base": resolved.api_base or "",
                        "api_key_masked": self._mask_secret(resolved.api_key),
                        "temperature": resolved.temperature,
                        "max_tokens": resolved.max_tokens,
                        "stream": stream,
                        "override": resolved.override,
                        "prompt_source": (
                            "custom" if custom_prompt else (
                                "resolved" if prompt_template_used else "fallback_or_none"
                            )
                        ),
                        "prompt_template_chars": len(prompt_template_used or ""),
                        "messages": self._summarize_messages(messages),
                    }
                },
            )
        except Exception as exc:  # pragma: no cover - 防御性: 日志失败不能影响主流程
            logger.warning("llm_router.chat_request_log_failed", extra={"data": {"error": str(exc)}})

    @staticmethod
    def _safe_format(template: str, variables: dict[str, Any]) -> str:
        """基于 token 的模板替换。

        只替换 ``{name}`` 形式的 token，且 ``name`` 必须是 ``variables`` 中
        的已知 key。其它所有花括号（包括包含 ``{}`` 的代码块、f-string
        样式字面量、JSON 负载等）都保持原样。
        """
        if not template:
            return ""
        if not variables:
            return template

        result: list[str] = []
        i = 0
        length = len(template)
        while i < length:
            ch = template[i]
            if ch == "{":
                # 找到配对的右花括号，找不到则保留余下原文退出
                end = template.find("}", i + 1)
                if end == -1:
                    result.append(template[i:])
                    break
                token = template[i + 1 : end]
                # 只替换我们已知的单 identifier token。其它内容（format
                # 描述符、嵌套字典、恰好包含花括号的字面文本）一律保持原样。
                if token and token.isidentifier() and token in variables:
                    value = variables.get(token)
                    result.append("" if value is None else str(value))
                    i = end + 1
                    continue
                # 未知 token —— 字面保留原文
                result.append(template[i : end + 1])
                i = end + 1
            else:
                result.append(ch)
                i += 1
        return "".join(result)

    def _normalize_prompt_variables(self, prompt_variables: dict[str, Any] | str) -> dict[str, Any]:
        if isinstance(prompt_variables, str):
            return {"content": prompt_variables}
        return prompt_variables

    def _build_messages(
        self,
        prompt_template: str | None,
        normalized_variables: dict[str, Any],
        task_alias: str | None = None,
    ) -> list[dict[str, str]]:
        """根据 prompt 模板构造 (system, user) 双消息对。

        旧实现把 *整段* 模板都渲染进 system 角色，并把 ``content`` 从变量
        字典中剔除。结果：模板里的字面 ``{content}`` 占位符会在 system
        消息中被原样保留，模型实际收到的是
        ``"...for the article below: {content}"`` 加一条空 user 消息 ——
        它会解读为“请围绕 ``{content}`` 写点什么”，从而生成数千字“问答
        体”输出，正是用户反馈的典型症状。

        重构后的版本以 ``{content}`` 为分割点：标记之前的内容（已渲染
        其它占位符）作为 system 指令，真正的内容则放进 user 消息。
        ``{content}`` 之后的尾部模板文本（结尾指令、输出 schema 提示等）
        会追加到 system 指令中，确保模型仍能看到。

        ``task_alias`` 用于在 ``prompt_template`` 缺失时按 task 取出
        ``_TASK_FALLBACK_SYSTEM_PROMPT`` 中预置的最小约束 system prompt,
        避免静默回退到“裸发文章”行为。
        """
        # 完全没有模板 —— 不再静默退化为单条 user 消息 (会让模型把文章当聊天问句作答)。
        # 先尝试用 task 兜底 prompt; 若仍无 (例如 admin/未知 task), 才退到旧逻辑,
        # 但记 ERROR 让运维能在 docker logs 里看到问题。
        if not prompt_template:
            fallback_prompt = _TASK_FALLBACK_SYSTEM_PROMPT.get(task_alias or "")
            if fallback_prompt:
                logger.error(
                    "llm_router.prompt_template_missing_using_fallback",
                    extra={
                        "data": {
                            "task_alias": task_alias,
                            "reason": "ai_task_routing/ai_task_types lookup returned empty; using built-in fallback system prompt",
                        }
                    },
                )
                user_text = str(normalized_variables.get("content", ""))
                return [
                    {"role": "system", "content": fallback_prompt},
                    {"role": "user", "content": user_text},
                ]
            logger.error(
                "llm_router.prompt_template_missing_no_fallback",
                extra={"data": {"task_alias": task_alias}},
            )
            user_text = str(normalized_variables.get("content", ""))
            return [{"role": "user", "content": user_text}]

        # 模板不包含 ``{content}``：把整段模板当作自包含的 system 指令，
        # 把真正的 content 放到独立的 user 消息中。没有这个分支，管理员
        # 写的形如“你是专业摘要助手，请直接输出摘要”（不带占位符）的
        # 自定义 prompt 会静默丢弃 ``normalized_variables['content']``，
        # 模型就没有可以总结的素材 —— gemini-code-assist 在 #517 初稿
        # 中点出了这个问题。
        if "content" not in normalized_variables or "{content}" not in prompt_template:
            rendered_system = self._safe_format(prompt_template, normalized_variables).strip()
            user_text = str(normalized_variables.get("content", ""))
            messages: list[dict[str, str]] = []
            if rendered_system:
                messages.append({"role": "system", "content": rendered_system})
            messages.append({"role": "user", "content": user_text})
            return messages

        head, _, tail = prompt_template.partition("{content}")
        system_vars = {k: v for k, v in normalized_variables.items() if k != "content"}
        rendered_head = self._safe_format(head, system_vars).rstrip()
        rendered_tail = self._safe_format(tail, system_vars).strip()
        if rendered_tail:
            system_text = f"{rendered_head}\n\n{rendered_tail}".strip()
        else:
            system_text = rendered_head
        return [
            {"role": "system", "content": system_text},
            {"role": "user", "content": str(normalized_variables.get("content", ""))},
        ]

    async def _guard_api_base(self, api_base: str | None) -> None:
        """拦截通过管理员可控的 ``api_base`` 发起的 SSRF。

        SECURITY (VULN-057)：每次 LiteLLM ``acompletion`` / ``aembedding``
        调用进入网络前都必须跑这层守卫。一旦管理员账号被攻破或被胁迫，
        否则可以把 ``base_url`` 指向 AWS IMDS 或内部服务，借助响应正文
        / 错误时延等侧信道实施信息外泄。

        空 / None 视为允许（意味着使用 LiteLLM 内置默认值，这本身就是
        公网端点）。
        """
        if not api_base:
            return
        if not await validate_external_url_async(api_base):
            raise HTTPException(
                status_code=502,
                detail="Provider base_url resolves to an internal or private network",
            )

    async def chat(
        self,
        prompt_variables: dict[str, Any] | str,
        model_alias: str,
        user_id: int | None = None,
        custom_prompt: str | None = None,
        model_id: str | None = None,
        provider_code: str | None = None,
        allow_override: bool = True,
    ) -> str:
        """发起一次 chat completion 调用，并根据需要渲染 prompt 模板。

        ``allow_override`` 历史默认是 False，意味着即便调用方传了 ``model_id``
        也会被静默忽略 —— 等价于 admin 后台 ModelPicker 是装饰品，挑了
        Claude Opus 仍然落到 ``ai_task_routing`` 配置的 gpt-5。该默认值是
        当年为收紧 agent.py 的 ``X-Internal-Service`` 鉴权路径设的；ai.py
        / search.py 这条管理员真实 JWT 链路并不需要这道闸 —— ``_resolve_override``
        本身已要求"模型在 provider_registry 启用 + user 持有该 provider 凭证"，
        足以构成访问控制。这里把默认翻成 True，让 ``model_id`` 一旦传入就被
        尊重；agent.py 另起 ``_resolve_for_agent`` 不走 chat()，不受影响。
        """
        resolved = await self._resolve_route(
            model_alias=model_alias,
            user_id=user_id,
            model_id=model_id,
            provider_code=provider_code,
            allow_override=allow_override,
        )

        prompt_template = custom_prompt or resolved.prompt_template
        normalized_variables = self._normalize_prompt_variables(prompt_variables)

        if self.settings.mock_mode and not resolved.override:
            return f"[mock:{resolved.model}]"

        messages = self._build_messages(prompt_template, normalized_variables, task_alias=model_alias)

        # SUMMARY-LONGER-THAN-SOURCE 排查需求: 调用前打印完整请求报文
        # (脱敏 api_key, 截断 message content), 让线上"实际发出去的是什么"
        # 可见, 不再是黑盒。
        self._log_chat_request(
            task_alias=model_alias,
            resolved=resolved,
            messages=messages,
            prompt_template_used=prompt_template,
            custom_prompt=custom_prompt,
            stream=False,
        )

        # SECURITY (VULN-057)：在管理员可控的 api_base 处拒止 SSRF。
        await self._guard_api_base(resolved.api_base)
        try:
            response = await acompletion(
                model=resolved.model,
                messages=messages,
                api_key=resolved.api_key,
                api_base=resolved.api_base,
                **_completion_kwargs(
                    model=resolved.model,
                    temperature=resolved.temperature,
                    max_tokens=resolved.max_tokens,
                ),
            )
            content = response.choices[0].message.content
            logger.info(
                "llm_router.chat_response",
                extra={
                    "data": {
                        "task_alias": model_alias,
                        "model": resolved.model,
                        "response_chars": len(content or ""),
                        "response_snippet": (content or "")[:400],
                        "max_tokens": resolved.max_tokens,
                    }
                },
            )
            return content or ""
        except Exception as primary_exc:
            # 尝试 fallback 模型（若已配置）。override 路径 (用户在 UI 显式
            # 选了 modelId) 不走 fallback —— 那时管理员是在故意压测特定模型,
            # 静默切换会破坏"测试该模型"的意图。
            routing = None
            if self.model_router and not resolved.override:
                routing = await self._get_routing(model_alias, user_id)
            if routing and routing.fallback_model:
                fallback_routing = await self._prepare_fallback_routing(
                    routing,
                    task_alias=model_alias,
                    primary_model=resolved.model,
                    primary_exc=primary_exc,
                )
                if fallback_routing:
                    fallback_model = self._prefix_model_for_litellm(
                        fallback_routing.model.model_id,
                        fallback_routing.credential.api_type,
                    )
                    logger.warning(
                        "llm_router.chat_primary_failed_using_fallback",
                        extra={
                            "data": {
                                "task_alias": model_alias,
                                "primary_model": resolved.model,
                                "fallback_model": fallback_model,
                                "error": f"{type(primary_exc).__name__}: {primary_exc}",
                            }
                        },
                    )
                    response = await acompletion(
                        model=fallback_model,
                        messages=messages,
                        api_key=fallback_routing.credential.api_key,
                        api_base=fallback_routing.credential.base_url,
                        **_completion_kwargs(
                            model=fallback_model,
                            temperature=resolved.temperature,
                            max_tokens=resolved.max_tokens,
                        ),
                    )
                    return response.choices[0].message.content or ""
            raise

    async def _prepare_fallback_routing(
        self,
        original: "RoutingConfig",
        *,
        task_alias: str,
        primary_model: str,
        primary_exc: Exception,
    ) -> "RoutingConfig | None":
        """Resolve and validate fallback routing without masking the primary failure."""
        try:
            fallback_routing = await self._get_routing_for_fallback(original)
            if not fallback_routing:
                return None
            # SECURITY (VULN-057)：fallback 的 api_base 同样要经过守卫。
            await self._guard_api_base(fallback_routing.credential.base_url)
            return fallback_routing
        except Exception as fallback_exc:
            fallback_model = getattr(getattr(original, "fallback_model", None), "model_id", None)
            logger.warning(
                "llm_router.fallback_prepare_failed",
                extra={
                    "data": {
                        "task_alias": task_alias,
                        "primary_model": primary_model,
                        "fallback_model": fallback_model,
                        "primary_error": f"{type(primary_exc).__name__}: {primary_exc}",
                        "fallback_error": f"{type(fallback_exc).__name__}: {fallback_exc}",
                    }
                },
            )
            return None

    async def _get_routing_for_fallback(self, original: "RoutingConfig") -> "RoutingConfig | None":
        """获取 fallback 模型对应的凭证。"""
        if not original.fallback_model or not self.model_router:
            return None


        # 取 fallback provider 的凭证
        cred = await self.model_router.credential_resolver.get_credential(
            original.fallback_model.provider_code
        )
        if not cred:
            return None
        
        from app.services.model_router import RoutingConfig
        return RoutingConfig(
            task_type=original.task_type,
            model=original.fallback_model,
            credential=cred,
            config=original.config,
        )

    async def stream_chat(
        self,
        prompt_variables: dict[str, Any] | str,
        model_alias: str,
        user_id: int | None = None,
        custom_prompt: str | None = None,
        model_id: str | None = None,
        provider_code: str | None = None,
        allow_override: bool = True,
    ) -> AsyncGenerator[str, None]:
        """流式返回 chat completion 响应，支持动态 prompt 渲染。

        与 ``chat`` 对齐的 fallback 语义：若 primary provider 在 **第一个 token
        到达之前** 就失败（典型场景：provider 5xx、TLS 握手抖动、key 失效、
        冷启动 LiteLLM 客户端），且任务在 ``ai_task_routing`` 中配置了
        ``fallback_model``，则透明切到 fallback 重试一次。一旦已经 yield 过
        chunk，再切换会产出半截破损的 SSE 流，因此 mid-stream 失败 **不重试**，
        直接抛给上层做 SSE error。
        """
        resolved = await self._resolve_route(
            model_alias=model_alias,
            user_id=user_id,
            model_id=model_id,
            provider_code=provider_code,
            allow_override=allow_override,
        )

        prompt_template = custom_prompt or resolved.prompt_template
        normalized_variables = self._normalize_prompt_variables(prompt_variables)
        messages = self._build_messages(prompt_template, normalized_variables, task_alias=model_alias)

        if self.settings.mock_mode and not resolved.override:
            for chunk in ["[", "mock", f":{resolved.model}", "]"]:
                yield chunk
                await asyncio.sleep(0)
            return

        # 流式路径同样落审计日志, 与同步分支保持一致。
        self._log_chat_request(
            task_alias=model_alias,
            resolved=resolved,
            messages=messages,
            prompt_template_used=prompt_template,
            custom_prompt=custom_prompt,
            stream=True,
        )

        # SECURITY (VULN-057)：流式路径同样需要校验 base_url。
        await self._guard_api_base(resolved.api_base)

        first_chunk_emitted = False
        try:
            stream = await acompletion(
                model=resolved.model,
                messages=messages,
                api_key=resolved.api_key,
                api_base=resolved.api_base,
                stream=True,
                **_completion_kwargs(
                    model=resolved.model,
                    temperature=resolved.temperature,
                    max_tokens=resolved.max_tokens,
                ),
            )
            async for part in stream:
                delta = part.choices[0].delta
                content = getattr(delta, "content", None)
                if content:
                    first_chunk_emitted = True
                    yield content
            return
        except Exception as primary_exc:
            # 已经 yield 过 chunk → 切换会破坏前端已经渲染的部分，直接抛给
            # 上层；上层会发 SSE error 终止流。
            if first_chunk_emitted:
                raise

            # 从 ai_task_routing 取 primary 的原始 routing，看看有没有配置
            # fallback_model；override（用户级模型覆盖）路径上 routing 可能
            # 为 None，那时跳过 fallback。
            routing = None
            if self.model_router and not resolved.override:
                routing = await self._get_routing(model_alias, user_id)

            if not routing or not routing.fallback_model:
                raise

            fallback_routing = await self._prepare_fallback_routing(
                routing,
                task_alias=model_alias,
                primary_model=resolved.model,
                primary_exc=primary_exc,
            )
            if not fallback_routing:
                raise

            fallback_model = self._prefix_model_for_litellm(
                fallback_routing.model.model_id,
                fallback_routing.credential.api_type,
            )
            logger.warning(
                "llm_router.stream_primary_failed_using_fallback",
                extra={
                    "data": {
                        "task_alias": model_alias,
                        "primary_model": resolved.model,
                        "fallback_model": fallback_model,
                        "error": f"{type(primary_exc).__name__}: {primary_exc}",
                    }
                },
            )
            fallback_stream = await acompletion(
                model=fallback_model,
                messages=messages,
                api_key=fallback_routing.credential.api_key,
                api_base=fallback_routing.credential.base_url,
                stream=True,
                **_completion_kwargs(
                    model=fallback_model,
                    temperature=resolved.temperature,
                    max_tokens=resolved.max_tokens,
                ),
            )
            async for part in fallback_stream:
                delta = part.choices[0].delta
                content = getattr(delta, "content", None)
                if content:
                    yield content

    async def resolve_embedding_model_id(self, user_id: int | None = None) -> str:
        """返回 ``embed()`` 实际会使用的纯 ``model_id``。

        被需要 **持久化** 或 **记录** 真实路由模型名的调用方使用（例如
        vector_store、search 路由）—— 比如写入 ``post_embeddings.model_id``、
        以及 ``reindex()`` 的“模型变更 → 弃用旧行”判断。这些位置过去硬
        编码 ``settings.model_embedding``（环境默认值），一旦管理员在
        Search Config UI 改了 embedding 路由就会与真实模型悄悄背离。
        """
        routing = await self._get_routing("embedding", user_id)
        if routing and routing.model and routing.model.model_id:
            return routing.model.model_id
        _, fallback_model_id = _normalize_model_parts(self.resolve_model("embedding"))
        return fallback_model_id or self.resolve_model("embedding")

    async def embed(
        self,
        text: str,
        user_id: int | None = None,
        timeout_sec: int | None = None,
    ) -> list[float]:
        """为文本生成 embedding 向量。"""
        routing = await self._get_routing("embedding", user_id)

        if routing:
            # 加 provider 前缀，确保 LiteLLM 路由正确（与 chat/stream_chat 一致）
            model = self._prefix_model_for_litellm(
                routing.model.model_id, routing.credential.api_type
            )
            api_key = routing.credential.api_key
            api_base = routing.credential.base_url
            source = "routing"
            provider_code = getattr(routing.credential, "provider_code", None) or \
                getattr(getattr(routing, "model", None), "provider_code", None)
        else:
            model = self.resolve_model("embedding")
            api_key = self.settings.openai_api_key
            api_base = self.settings.openai_base_url
            source = "env_fallback"
            provider_code = "env_openai"

        # 观测点：记录这次 embed 调用实际指向哪个 model / api_base / 路由来源。
        # 路由来源为 env_fallback 时直接 WARNING —— 说明 ai_task_routing 表里没有
        # 配置 embedding 激活路由，这是生产环境索引卡死的首号嫌疑。
        # 注意：项目 JSONFormatter 只识别 extra={"data": {...}}，裸字段会被丢弃。
        log_ctx = {
            "source": source,
            "model": model,
            "provider": provider_code,
            "api_base": api_base,
            "text_len": len(text or ""),
            "has_api_key": bool(api_key),
            "user_id": user_id,
        }
        if source == "env_fallback":
            logger.warning("embed.start_env_fallback", extra={"data": log_ctx})
        else:
            logger.info("embed.start", extra={"data": log_ctx})

        if self.settings.mock_mode:
            digest = hashlib.sha256(text.encode("utf-8")).digest()
            seed = [b / 255 for b in digest]
            dim = self.settings.vector_dim
            repeats = dim // len(seed) + 1
            return (seed * repeats)[:dim]

        # SECURITY (VULN-057)：embedding 调用也必须校验 api_base。
        await self._guard_api_base(api_base)
        start = time.perf_counter()
        try:
            # 显式超时兜底：LiteLLM 默认不给 embedding 设 timeout。
            # 使用调用方传入的 timeout_sec（通常来自 search.index_post_timeout_sec
            # 搜索配置，默认 180s），保证和 Go backend 的 per-post context 对齐。
            # num_retries=0：避免 LiteLLM 自己多次重试导致总耗时成倍放大。
            #
            # 注意：调用方（``vector_store.upsert_post_embedding``）已经按 search
            # profile 配置把内容切分成 ≤ chunk_size_tokens 的 chunks。embed() 不
            # 再做截断 —— provider 上限保护交由 chunker 上游处理，避免双层裁剪
            # 让单篇文章的尾部内容静默丢失。
            effective_timeout = timeout_sec if (timeout_sec and timeout_sec > 0) else 180
            response = await aembedding(
                model=model,
                input=[text],
                api_key=api_key,
                api_base=api_base,
                timeout=effective_timeout,
                num_retries=0,
            )
        except Exception as exc:
            elapsed_ms = (time.perf_counter() - start) * 1000
            logger.error(
                "embed.failed",
                extra={"data": {
                    **log_ctx,
                    "elapsed_ms": round(elapsed_ms, 2),
                    "error": f"{type(exc).__name__}: {exc}",
                }},
            )
            raise

        elapsed_ms = (time.perf_counter() - start) * 1000
        embedding = response.data[0]["embedding"]
        logger.info(
            "embed.ok",
            extra={"data": {
                **log_ctx,
                "elapsed_ms": round(elapsed_ms, 2),
                "vector_dim": len(embedding) if embedding else 0,
            }},
        )
        return embedding

    # 推理轨迹（reasoning trace）标签识别。
    #
    # 不同 provider / 模型用不同标签包裹其 chain-of-thought。旧检测器
    # 只识别 ``<think>``；Qwen / R1 变体发出 ``<thinking>``、或自定义
    # prompt 下的 ``<reasoning>`` 段落都能绕过过滤器，把推理轨迹当作
    # 答案输出（流式端点上典型的“千字问答”症状）。
    #
    # 这里有意保持精简的标签集合 —— 它们是当前公开模型中标准的推理
    # 包裹标签。容忍标签内空白与大小写变体（``<Think>``、``<THINK>``）。
    _THINK_OPEN_RE = re.compile(r"<\s*(think|thinking|reasoning)\s*>", re.IGNORECASE)
    _THINK_CLOSE_RE = re.compile(r"<\s*/\s*(think|thinking|reasoning)\s*>", re.IGNORECASE)
    # 最长可能的关闭标签（``</thinking>`` / ``</reasoning>`` 再加上
    # 标签内空白）。我们在 buffer 末尾保留这么多字符，避免单个标签
    # 被切断在两次 yield 之间。
    _THINK_TAG_GUARD = len("</reasoning >") + 4

    async def stream_chat_with_think_detection(
        self,
        prompt_variables: dict[str, Any] | str,
        model_alias: str,
        user_id: int | None = None,
        custom_prompt: str | None = None,
        model_id: str | None = None,
        provider_code: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """流式 chat completion，附带推理轨迹（reasoning-trace）标签检测。

        Yields 事件格式：
        - {"type": "delta", "content": "...", "isThink": False}
        - {"type": "delta", "content": "...", "isThink": True}
        - {"type": "done"}
        """
        in_think = False
        buffer = ""
        guard = self._THINK_TAG_GUARD

        async for chunk in self.stream_chat(
            prompt_variables=prompt_variables,
            model_alias=model_alias,
            user_id=user_id,
            custom_prompt=custom_prompt,
            model_id=model_id,
            provider_code=provider_code,
        ):
            buffer += chunk

            # 增量处理 buffer，在末尾保留 ``guard`` 个字符，以防某个
            # 标签恰好横跨两次流块边界被切断。
            while len(buffer) > guard:
                pattern = self._THINK_CLOSE_RE if in_think else self._THINK_OPEN_RE
                match = pattern.search(buffer)
                if match and match.end() <= len(buffer) - guard:
                    head = buffer[: match.start()]
                    if head:
                        yield {"type": "delta", "content": head, "isThink": in_think}
                    buffer = buffer[match.end():]
                    in_think = not in_think
                    continue
                if match is None:
                    # 暂无标签 —— 把除尾部 guard 区以外的内容全部 yield，
                    # 让下一个 chunk 中可能出现的标签仍有机会被捕获。
                    safe_len = len(buffer) - guard
                    if safe_len > 0:
                        yield {"type": "delta", "content": buffer[:safe_len], "isThink": in_think}
                        buffer = buffer[safe_len:]
                # 要么没匹配到，要么匹配位置离末尾太近；等待更多数据。
                break

        # 最终冲刷：让落在尾部 ``guard`` 窗口内的内容也走一遍与主循环
        # 相同的标签检测逻辑。仅仅“原样 yield 剩余 buffer”会泄漏恰好
        # 落在最后 ``guard`` 区里的完整标签（例如流末尾的整个 ``<think>``
        # 起始标签）—— gemini-code-assist 在 #517 中点出了这一点。
        # 这里持续迭代，直到没有更多标签或 buffer 为空，确保
        # ``"<think>x</think>y"`` 这类多标签残段也能被正确处理。
        while buffer:
            pattern = self._THINK_CLOSE_RE if in_think else self._THINK_OPEN_RE
            match = pattern.search(buffer)
            if match is None:
                yield {"type": "delta", "content": buffer, "isThink": in_think}
                break
            head = buffer[: match.start()]
            if head:
                yield {"type": "delta", "content": head, "isThink": in_think}
            buffer = buffer[match.end():]
            in_think = not in_think

        yield {"type": "done"}
