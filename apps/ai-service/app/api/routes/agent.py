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
  data: {"type":"done"}\\n\\n
  data: {"type":"error","code":"…","message":"…"}\\n\\n
"""

from __future__ import annotations

import json
import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from litellm import acompletion

from app.api.deps import (
    get_llm_router,
    get_pg_pool,
    require_admin_or_internal,
)
from app.core.config import get_settings
from app.schemas.common import ApiResponse
from app.services.llm_router import NON_CHAT_MODEL_TYPES, LlmRouter

logger = logging.getLogger(__name__)

router = APIRouter(tags=["agent"])
settings = get_settings()


# ============================================================================
# 请求 / 响应 schema
# ============================================================================

class AgentChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"] = Field(..., description="角色")
    content: str = Field(..., description="内容")


class AgentChatRequest(BaseModel):
    sessionId: str = Field(..., min_length=1, max_length=128)
    mode: Literal["chat", "cowork", "code"] = "chat"
    messages: list[AgentChatMessage] = Field(..., min_length=1, max_length=64)
    # 用户级模型覆盖；前端 ModelPicker 选好后由 Go 后端透传过来。
    modelId: str | None = None
    providerCode: str | None = None
    # @ picker 选中的文章 ID 列表 —— 后端会查 posts 表取标题 + 摘要 + 正文片段，
    # 拼成 system 段注入给 LLM，让 Agent 能"看到"用户引用的文章原文。
    articleIds: list[int] | None = Field(default=None, max_length=10)
    # # picker 选中的标签 slug 列表 —— 注入对应标签下最近 5 篇文章标题，给 Agent
    # 一个"该话题下站点写过哪些文章"的概览。
    tagSlugs: list[str] | None = Field(default=None, max_length=8)


class AgentModelItem(BaseModel):
    """ModelPicker 下拉的一行。"""
    providerCode: str
    providerName: str | None = None
    modelId: str
    displayName: str | None = None
    contextWindow: int | None = None
    isDefault: bool = False
    # scope 标记: "user" 表示该 provider 在当前用户名下有专属凭证；
    # "system" 表示用的是系统级（user_id IS NULL）凭证。前端可据此显示徽标。
    scope: str = "system"


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


# 单篇正文截断阈值。MVP 期间整本博文塞进 prompt 不现实——按字符数硬截断让
# 大多数模型都能一次容下。后续可换成按 tokens 计数 + 智能 chunk。
_ARTICLE_EXCERPT_MAX_CHARS = 1800
_TAG_POST_LIMIT = 5


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
    model_id: str | None,
    provider_code: str | None,
) -> Any:
    """解析 Agent 调用的最终路由 ——

    1. 用户显式选了 model（前端 ModelPicker）→ 走 _resolve_override 路径；
    2. 否则按 _FALLBACK_TASK_ALIASES 顺序找第一个有 routing 的任务别名；
    3. 全部找不到 → 抛 503，前端会渲染清晰的错误气泡。

    这层包装没复用 ``llm_router._resolve_route(...)`` 的全部逻辑，
    因为它在 routing 缺失时会进入 env-var 分支返回未带 provider 前缀的
    模型名（比如 ``"agent"`` 字面），而 LiteLLM 会因为辨认不出 provider
    抛 BadRequestError —— 那是这次 bug 的根因。
    """
    # 1) override 路径（用户选了具体模型）
    #
    # SECURITY (PR #591 follow-up)：``_resolve_override`` 默认 ``allow_override=False``，
    # 用于堵住 ``rate_limit`` (require_user) 级别的公共 AI 端点上的 modelId
    # 越权路由。Agent 工作台入口 ``/api/v1/agent/chat`` 由
    # ``require_admin_or_internal`` 守门，是经过授权的合法 override 调用方
    # （admin 在 ModelPicker 显式选模型），因此显式传 ``allow_override=True``。
    if model_id:
        try:
            route = await llm_router._resolve_override(  # noqa: SLF001 — 受控调用
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
        if route is not None:
            return route

    # 2) 任务别名 fallback —— 从 model_router 拿 RoutingConfig
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

    # 3) 最后兜底：ai_task_routing 表整张空也别让聊天框无法用。
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
        SELECT m.id, m.provider_id, p.code AS provider_code, p.display_name AS provider_name,
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
        items.append(
            AgentModelItem(
                providerCode=row["provider_code"],
                providerName=row["provider_name"],
                modelId=row["model_id"],
                displayName=row["display_name"] or row["model_id"],
                contextWindow=row["context_window"],
                isDefault=False,
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
    request: Request,  # noqa: ARG001
    payload: AgentChatRequest,
    user=Depends(require_admin_or_internal),
    forwarded_user_id: str | None = Header(default=None, alias="X-Forwarded-User-ID"),
    llm_router: LlmRouter = Depends(get_llm_router),
    pool=Depends(get_pg_pool),
):
    """多轮对话流式响应 —— 由 Go 后端在用户登录态下代理调用。"""
    _enforce_message_limits(payload)

    # X-Forwarded-User-ID 是 Go agent_handler 透传的真实登录用户 id；
    # require_admin_or_internal 在内部 token 路径下只能给出 "system"，
    # 我们更信任前者，否则 _resolve_override / resolve_routing 都会做错的
    # user-level 路由匹配。
    user_id = _resolve_forwarded_user_id(user, forwarded_user_id)

    resolved = await _resolve_for_agent(
        llm_router,
        user_id=user_id,
        model_id=payload.modelId,
        provider_code=payload.providerCode,
    )

    # 把 @ / # picker 引用的文章 / 标签拼成上下文段（system 消息），让 Agent
    # 真正"看到"用户引用的素材，而不是只看到一句 "@xxx"。
    context_block = await _build_picker_context(
        pool,
        article_ids=payload.articleIds,
        tag_slugs=payload.tagSlugs,
    )
    chat_messages = _build_chat_messages(payload, context_block=context_block)

    # SSRF 守卫
    await llm_router._guard_api_base(resolved.api_base)  # noqa: SLF001

    async def generate():
        if settings.mock_mode and not resolved.override:
            for chunk in [
                "[mock:", resolved.model, "] ", "你好,",
                "我已收到 ", str(len(payload.messages)), " 条消息。"
            ]:
                yield f'data: {json.dumps({"type": "delta", "content": chunk}, ensure_ascii=False)}\n\n'
            yield 'data: {"type": "done"}\n\n'
            return

        try:
            stream = await acompletion(
                model=resolved.model,
                messages=chat_messages,
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
                    data = json.dumps({"type": "delta", "content": content}, ensure_ascii=False)
                    yield f"data: {data}\n\n"
            yield 'data: {"type": "done"}\n\n'
        except Exception as exc:
            logger.warning("agent.stream_failed", extra={"data": {"error": str(exc)}})
            err = json.dumps(
                {"type": "error", "code": "agent_stream_error", "message": str(exc)[:300]},
                ensure_ascii=False,
            )
            yield f"data: {err}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
