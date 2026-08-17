"""Agent 工具调用（function calling）—— 服务端白名单工具的定义与执行。

安全边界（红线，改动前先读完）：
    * 工具清单**只有服务端硬编码**这一来源，不接受客户端自定义工具 ——
      客户端唯一能做的是 ``enableTools: true`` 开关；
    * ``search_knowledge_base`` 只在本次请求已授权的 kbIds 范围内检索
      （Go 端已做权限过滤/注入；kbIds 为空时该工具根本不注册）；
    * 参数经 pydantic 校验（query ≤500 字符），SQL 全参数化，ILIKE
      通配符显式转义 —— 模型给出的参数视同不可信输入；
    * 两个工具都是库内检索，**不产生任何出网请求**；
    * 单工具执行超时 10s；任何异常折叠为 ``isError`` 结果，不中断对话；
    * 工具结果在进入 SSE 与模型上下文之前统一截断（≤2000 字符），
      失败信息只回泛化文案，绝不把 DSN / traceback 透给模型或前端。
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger(__name__)

# 单工具执行超时（秒）。模块级常量便于测试 monkeypatch。
TOOL_TIMEOUT_SECONDS = 10.0
# 工具结果字符硬上限 —— SSE 下发与模型上下文共用同一截断值。
TOOL_RESULT_MAX_CHARS = 2000

_KB_TOOL_TOP_K = 6
_KB_SNIPPET_MAX_CHARS = 300
_POST_SUMMARY_MAX_CHARS = 200
_QUERY_MAX_CHARS = 500


class SearchKnowledgeBaseArgs(BaseModel):
    """``search_knowledge_base`` 的参数 —— 模型产出，按不可信输入校验。"""

    query: str = Field(..., min_length=1, max_length=_QUERY_MAX_CHARS)


class SearchPostsArgs(BaseModel):
    """``search_posts`` 的参数 —— 模型产出，按不可信输入校验。"""

    query: str = Field(..., min_length=1, max_length=_QUERY_MAX_CHARS)
    limit: int = Field(default=5, ge=1, le=10)


@dataclass(frozen=True)
class AgentToolSpec:
    """一个服务端白名单工具：OpenAI schema + pydantic 参数模型 + 执行体。"""

    name: str
    description: str
    parameters: dict[str, Any]
    args_model: type[BaseModel]
    handler: Callable[[Any], Awaitable[str]]

    def openai_schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


def truncate_tool_text(text: str, max_chars: int = TOOL_RESULT_MAX_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


def _escape_like(term: str) -> str:
    """转义 ILIKE 通配符 —— 模型给出的 query 不允许携带模式语义。"""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _dedupe_positive_kb_ids(values: list[int] | None, limit: int = 10) -> list[int]:
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


def build_agent_tools(pool, llm_router, *, kb_ids: list[int] | None) -> list[AgentToolSpec]:
    """构造本次请求可用的工具清单。

    * ``search_knowledge_base`` 仅在本次请求携带已授权 kbIds 时注册 ——
      检索范围被闭包捕获为服务端归一化后的 id 列表，模型无法扩权到
      未授权 KB（工具参数里没有 kb id 字段）；
    * ``search_posts`` 恒定注册（只读已发布、未删除、未隐藏、无密码文章）。
    """
    tools: list[AgentToolSpec] = []
    authorized_kb_ids = _dedupe_positive_kb_ids(kb_ids)

    if authorized_kb_ids:

        async def search_knowledge_base(args: SearchKnowledgeBaseArgs) -> str:
            # 局部导入与 agent 路由的 KB 注入路径同款，便于测试 monkeypatch
            # ``kb_recall.recall_kbs`` 且避免顶部循环依赖。
            from app.services.kb_recall import recall_kbs

            hits = await recall_kbs(
                pool,
                llm_router,
                kb_ids=list(authorized_kb_ids),
                query=args.query,
                top_k_total=_KB_TOOL_TOP_K,
            )
            return json.dumps(
                {
                    "hits": [
                        {
                            "title": hit.file_title or hit.kb_name,
                            "snippet": truncate_tool_text(hit.snippet, _KB_SNIPPET_MAX_CHARS),
                            "score": round(float(hit.similarity), 3),
                        }
                        for hit in hits
                    ]
                },
                ensure_ascii=False,
            )

        tools.append(
            AgentToolSpec(
                name="search_knowledge_base",
                description=(
                    "在用户为本次对话选择的知识库范围内做语义检索，"
                    "返回最相关片段的 title/snippet/score。"
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "检索问题或关键词",
                            "maxLength": _QUERY_MAX_CHARS,
                        },
                    },
                    "required": ["query"],
                },
                args_model=SearchKnowledgeBaseArgs,
                handler=search_knowledge_base,
            )
        )

    async def search_posts(args: SearchPostsArgs) -> str:
        pattern = f"%{_escape_like(args.query)}%"
        # SECURITY: 与 agent 路由的文章注入 SQL 同一可见性口径 ——
        # 只读已发布、未删除、未隐藏且无密码保护的文章；全参数化。
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT p.id, p.title, p.summary
                FROM posts p
                WHERE p.deleted = FALSE
                  AND p.status = 'PUBLISHED'
                  AND p.is_hidden = FALSE
                  AND p.password IS NULL
                  AND (p.title ILIKE $1 OR p.summary ILIKE $1)
                ORDER BY p.published_at DESC NULLS LAST, p.id DESC
                LIMIT $2
                """,
                pattern,
                args.limit,
            )
        return json.dumps(
            [
                {
                    "id": row["id"],
                    "title": row["title"] or "(untitled)",
                    "summary": truncate_tool_text(
                        (row["summary"] or "").strip(), _POST_SUMMARY_MAX_CHARS
                    ),
                }
                for row in rows
            ],
            ensure_ascii=False,
        )

    tools.append(
        AgentToolSpec(
            name="search_posts",
            description=(
                "按标题/摘要关键词检索站点已发布文章，返回 [{id,title,summary}]。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "标题或摘要关键词",
                        "maxLength": _QUERY_MAX_CHARS,
                    },
                    "limit": {
                        "type": "integer",
                        "description": "返回条数（1-10，默认 5）",
                        "minimum": 1,
                        "maximum": 10,
                        "default": 5,
                    },
                },
                "required": ["query"],
            },
            args_model=SearchPostsArgs,
            handler=search_posts,
        )
    )
    return tools


def _compact_validation_error(exc: ValidationError) -> str:
    details = "; ".join(
        f"{'.'.join(str(part) for part in error.get('loc', ()))}: {error.get('msg', 'invalid')}"
        for error in exc.errors()
    )
    return truncate_tool_text(f"工具参数校验失败: {details}", 300)


async def run_agent_tool(spec: AgentToolSpec, arguments_json: str) -> tuple[str, bool]:
    """执行单个工具调用，返回 ``(result_text, is_error)``。

    永不向上抛业务异常（客户端取消除外）：参数非法 / 超时 / 执行失败都
    折叠成 ``is_error=True`` 的泛化文案，让对话循环把结果回喂给模型继续
    作答，而不是让整条 SSE 流崩掉。
    """
    try:
        parsed = json.loads(arguments_json or "{}")
    except ValueError:
        return "工具参数不是合法 JSON", True
    if not isinstance(parsed, dict):
        return "工具参数必须是 JSON 对象", True
    try:
        args = spec.args_model.model_validate(parsed)
    except ValidationError as exc:
        return _compact_validation_error(exc), True
    try:
        result = await asyncio.wait_for(spec.handler(args), timeout=TOOL_TIMEOUT_SECONDS)
    except (TimeoutError, asyncio.TimeoutError):
        logger.warning(
            "agent_tool.timeout",
            extra={"data": {"tool": spec.name, "timeout_seconds": TOOL_TIMEOUT_SECONDS}},
        )
        return "工具执行超时", True
    except asyncio.CancelledError:
        # 客户端取消必须原样向上传播，保持 agent SSE 的取消语义。
        raise
    except Exception as exc:
        # 泛化文案：DB DSN / traceback 等内部细节不进模型上下文与前端。
        logger.warning(
            "agent_tool.execution_failed",
            extra={"data": {"tool": spec.name, "error": str(exc)[:200]}},
        )
        return "工具执行失败", True
    return truncate_tool_text(str(result)), False
