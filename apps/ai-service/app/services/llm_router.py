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


def _normalize_model_parts(model: str | None) -> tuple[str | None, str | None]:
    if not model:
        return None, None
    if "/" not in model:
        return None, model
    provider_code, model_id = model.split("/", 1)
    return provider_code, model_id


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

    async def _resolve_override(
        self,
        model_id: str | None,
        provider_code: str | None,
        user_id: int | None,
        model_alias: str | None = None,
    ) -> "LlmRouter._ResolvedRoute | None":
        if not model_id:
            return None
        if not self.model_router:
            raise ValueError("Model override is not available")

        model = await self.model_router.provider_registry.get_model(model_id, provider_code)
        if not model:
            raise ValueError("Requested model not found")

        credential = await self.model_router.credential_resolver.get_credential(
            model.provider_code,
            user_id=user_id,
        )
        if not credential:
            raise ValueError("Credential not found for requested provider")

        # 加 provider 前缀，确保 LiteLLM 路由正确
        prefixed_model = self._prefix_model_for_litellm(model.model_id, credential.api_type)

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
            prompt_template=None,
            override=True,
        )

    async def _resolve_route(
        self,
        model_alias: str,
        user_id: int | None = None,
        model_id: str | None = None,
        provider_code: str | None = None,
    ) -> "LlmRouter._ResolvedRoute":
        override = await self._resolve_override(model_id, provider_code, user_id, model_alias=model_alias)
        if override:
            return override

        routing = await self._get_routing(model_alias, user_id)
        if routing:
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
            prompt_template=None,
            override=False,
        )

    async def resolve_usage_context(
        self,
        model_alias: str,
        user_id: int | None = None,
        model_id: str | None = None,
        provider_code: str | None = None,
    ) -> dict[str, str | float | None]:
        resolved = await self._resolve_route(
            model_alias=model_alias,
            user_id=user_id,
            model_id=model_id,
            provider_code=provider_code,
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
    ) -> str:
        resolved = await self._resolve_route(
            model_alias=model_alias,
            user_id=user_id,
            model_id=model_id,
            provider_code=provider_code,
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
        """
        # 完全没有模板 —— 单条 user 消息，内容即用户文本。
        if not prompt_template:
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
    ) -> str:
        """发起一次 chat completion 调用，并根据需要渲染 prompt 模板。"""
        resolved = await self._resolve_route(
            model_alias=model_alias,
            user_id=user_id,
            model_id=model_id,
            provider_code=provider_code,
        )

        prompt_template = custom_prompt or resolved.prompt_template
        normalized_variables = self._normalize_prompt_variables(prompt_variables)

        if self.settings.mock_mode and not resolved.override:
            return f"[mock:{resolved.model}]"

        messages = self._build_messages(prompt_template, normalized_variables)

        # SECURITY (VULN-057)：在管理员可控的 api_base 处拒止 SSRF。
        await self._guard_api_base(resolved.api_base)
        try:
            response = await acompletion(
                model=resolved.model,
                messages=messages,
                api_key=resolved.api_key,
                api_base=resolved.api_base,
                temperature=resolved.temperature,
                max_tokens=resolved.max_tokens,
            )
            content = response.choices[0].message.content
            return content or ""
        except Exception as e:
            # 尝试 fallback 模型（若已配置）
            if self.model_router:
                routing = await self._get_routing(model_alias, user_id)
            else:
                routing = None
            if routing and routing.fallback_model:
                logger.warning(f"Primary model failed, trying fallback: {e}")
                fallback_routing = await self._get_routing_for_fallback(routing)
                if fallback_routing:
                    fallback_model = self._prefix_model_for_litellm(
                        fallback_routing.model.model_id,
                        fallback_routing.credential.api_type,
                    )
                    # SECURITY (VULN-057)：fallback 的 api_base 同样要经过守卫。
                    await self._guard_api_base(fallback_routing.credential.base_url)
                    response = await acompletion(
                        model=fallback_model,
                        messages=messages,
                        api_key=fallback_routing.credential.api_key,
                        api_base=fallback_routing.credential.base_url,
                        temperature=resolved.temperature,
                        max_tokens=resolved.max_tokens,
                    )
                    return response.choices[0].message.content or ""
            raise

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
    ) -> AsyncGenerator[str, None]:
        """流式返回 chat completion 响应，支持动态 prompt 渲染。"""
        resolved = await self._resolve_route(
            model_alias=model_alias,
            user_id=user_id,
            model_id=model_id,
            provider_code=provider_code,
        )

        prompt_template = custom_prompt or resolved.prompt_template
        normalized_variables = self._normalize_prompt_variables(prompt_variables)
        messages = self._build_messages(prompt_template, normalized_variables)

        if self.settings.mock_mode and not resolved.override:
            for chunk in ["[", "mock", f":{resolved.model}", "]"]:
                yield chunk
                await asyncio.sleep(0)
            return

        # SECURITY (VULN-057)：流式路径同样需要校验 base_url。
        await self._guard_api_base(resolved.api_base)
        stream = await acompletion(
            model=resolved.model,
            messages=messages,
            api_key=resolved.api_key,
            api_base=resolved.api_base,
            temperature=resolved.temperature,
            max_tokens=resolved.max_tokens,
            stream=True,
        )
        async for part in stream:
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
