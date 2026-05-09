# 04 · SSE 流式输出 / Tool calling / 错误处理

## 范围

- SSE 帧契约与 `_stream_with_think_detection` 通用包装器
- think-block(reasoning trace)透明剥离
- 流首字节失败的透明重试与中途失败的硬切错误
- `result` 事件:把流式出口收敛回非流式 schema
- agent 多轮对话与 RAG QA 的事件序列
- profile reindex 的 SSE 进度协议
- 错误归一化与上游分类(LiteLLM ↔ HTTP 状态)
- Tool calling 现状(暂未启用)

---

## 1. SSE 帧契约

ai-service 全部 SSE 端点使用同一种最小帧:

```
data: {"type": "<type>", ...payload}\n\n
```

不发 `event:` / `id:` 行(都靠 `type` 字段在 payload 里区分)。`StreamingResponse` 加固定三个响应头(`apps/ai-service/app/api/routes/ai.py:790-796`):

```
X-Accel-Buffering: no    # 关键:让 nginx 不缓冲
Cache-Control: no-cache
Connection: keep-alive
```

> nginx 默认 8KB buffer 会让 admin UI 的进度条出现「卡住—瀑布」现象,`X-Accel-Buffering: no` 是必须的。

### 1.1 事件类型矩阵

| type | 出现位置 | payload 字段 |
|---|---|---|
| `delta` | 所有流式 task | `content: str`, `isThink?: bool`(默认 false) |
| `result` | 所有流式 task(在 `done` 之前) | `data: <对应非流式 *Data schema>` |
| `done` | 所有流式 task 末尾 | (无额外字段) |
| `error` | 任意环节失败 | `code: str`, `message: str` |
| `sources` | 仅 `/api/v1/search/qa`(向后兼容,blog SearchPanel 旧消费者) | `sources: [{title, slug}]` |
| `start` | 仅 `/api/v1/admin/search/profiles/{code}/reindex/stream` | `total: int`, `profile: str` |
| `progress` | 仅 reindex 流 | `postId, index, chunks, status, error?, elapsedMs` |

**关键不变量**:`done` 总是最后一帧;`result` 永远在 `done` 之前;`error` 出现后流即终止。

---

## 2. 通用流式包装器:`_stream_with_think_detection`

入口:`apps/ai-service/app/api/routes/ai.py:1390-1549`,被 5 个流式 task 共用(summary/tags/titles/polish/outline/translate stream)。

### 2.1 三大职责

1. **透传** llm_router 抛出的 `delta` / `done` / `error` 事件
2. **累积**非 think 文本(用 `list[str] + "".join` 而不是 `+=`,避免 CPython O(n²) 字符串拼接 — PR #435 review C6)
3. **首字节前的透明重试** — 600ms backoff 重试一次,覆盖冷启动 LiteLLM / provider TLS 抖动 / DB pool 第一次取连接的瞬时失败

### 2.2 重试边界

```python
max_attempts = 2
last_exc = None

try:
    for attempt in range(1, max_attempts + 1):
        try:
            async for event in llm.stream_chat_with_think_detection(...):
                ...  # delta / done / 透传

            # 流正常结束 -> 跳出重试循环
            last_exc = None
            break
        except Exception as exc:
            last_exc = exc
            # 已经 yield 过 delta -> 中途失败,不重试,让前端走 SSE error
            if delta_emitted:
                raise
            if attempt < max_attempts:
                await asyncio.sleep(0.6)
                continue
            raise
```

**铁律**:`delta_emitted=True` 之后**永不**重试 — 中途切到 fallback 会让前端看到两段拼接错乱的内容。

### 2.3 result 事件构造

`_build_stream_result_payload`(`ai.py:396-478`)按 task_type 调对应非流式 schema 序列化:

```python
if task_type == "summary":
    return SummaryData(summary=text, characterCount=len(text), model=model).model_dump()
elif task_type == "tags":
    matches, suggestions = _parse_tags_structured(text, existing_lookup)
    matches, suggestions = _truncate_tag_payload(matches, suggestions, max_tags)
    return TagsData(
        tags=[m.name for m in matches] + list(suggestions),
        matches=matches,
        suggestions=suggestions,
        model=model,
    ).model_dump()
elif task_type == "titles":
    return TitlesData(titles=_parse_titles(text)[:max_titles], model=model).model_dump()
elif task_type == "polish":
    return PolishData(polishedContent=text, model=model).model_dump()
elif task_type == "outline":
    return OutlineData(outline=text, characterCount=len(text), model=model).model_dump()
elif task_type == "translate":
    source_raw = prompt_variables.get("source_language")
    source = source_raw if source_raw and source_raw != "自动检测" else None
    return TranslateData(
        translatedContent=text,
        sourceLanguage=source,
        targetLanguage=str(prompt_variables.get("target_language") or extras.get("target_language") or "en"),
        model=model,
    ).model_dump()
```

> 这是流式与非流式的「契约对齐」机制:前端 `useStreamResponse` 不需要分辨流 / 同步,收到 `result` 事件后直接当成非流式响应处理。

### 2.4 兼容 provider 不发 done

某些 provider 关闭流时不发显式 done(`ai.py:1486-1491`):

```python
if not result_emitted:
    result_line = await _maybe_emit_result()
    if result_line is not None:
        yield result_line
    yield _make_sse({"type": "done"})
```

ai-service 主动补一个 `done`,让前端的"流结束"判据稳定。

---

## 3. think-block 处理:`stream_chat_with_think_detection`

入口:`app/services/llm_router.py:1127-1197`。

### 3.1 标签集合

```python
_THINK_OPEN_RE = re.compile(r"<\s*(think|thinking|reasoning)\s*>", re.IGNORECASE)
_THINK_CLOSE_RE = re.compile(r"<\s*/\s*(think|thinking|reasoning)\s*>", re.IGNORECASE)
```

容忍标签内空白与大小写变体(`<Think>` / `<THINK>` / `<think >` 全识别)。

### 3.2 Buffer-guard 算法

核心问题:think 标签可能横跨两次 chunk 边界(`<thi` 在 chunk N,`nking>` 在 chunk N+1)。如果对每个 chunk 直接做 regex search,会漏识别。

解决:维护 `guard = len("</reasoning >") + 4` 字节的尾部窗口,只对 `buffer[:-guard]` 做 search。

```python
in_think = False
buffer = ""
guard = self._THINK_TAG_GUARD

async for chunk in self.stream_chat(...):
    buffer += chunk

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
            # 把除尾部 guard 区以外的内容全部 yield
            safe_len = len(buffer) - guard
            if safe_len > 0:
                yield {"type": "delta", "content": buffer[:safe_len], "isThink": in_think}
                buffer = buffer[safe_len:]
        break

# 最终冲刷:同样跑标签检测,直到 buffer 为空
while buffer:
    pattern = self._THINK_CLOSE_RE if in_think else self._THINK_OPEN_RE
    match = pattern.search(buffer)
    if match is None:
        yield {"type": "delta", "content": buffer, "isThink": in_think}
        break
    ...

yield {"type": "done"}
```

**最终冲刷的修复**(gemini-code-assist review #517 提的边界):仅"原样 yield 剩余 buffer"会泄漏整个 `<think>` 起始标签到流末尾。改成持续迭代,直到没有更多标签或 buffer 为空,确保 `<think>x</think>y` 这类多标签残段也能被正确处理。

### 3.3 isThink 的语义

- `isThink=True`:这段内容是 chain-of-thought,前端应渲染到独立的"思考过程"折叠区
- `isThink=False`:正文,直接渲染

`_stream_with_think_detection` 的累积器**只累积 isThink=False 的内容**(`ai.py:1469-1470`)— 最终的 `result` payload 不包含推理轨迹,与非流式端点对齐(非流式调用没 think 概念,只看最终 message.content)。

---

## 4. 错误处理与归一化

### 4.1 LiteLLM 异常 → HTTP 状态

`_normalize_generation_error`(`app/api/routes/ai.py:497-513`)按错误消息子串匹配:

| 关键字 | HTTP code | 用户消息 |
|---|---|---|
| `rate limit / too many requests / 429` | 429 | "AI provider rate limit exceeded" |
| `timeout / timed out / deadline exceeded` | 504 | "AI provider request timed out" |
| `unauthorized / authentication / invalid api key / api key / 401 / 403` | 502 | "AI provider authentication failed" |
| `context length / max tokens / prompt is too long / invalid request / unsupported parameter / model_not_found` | 400 | `f"AI request rejected: {message}"`(原始消息回显) |
| 其它 | 502 | `f"AI generation failed: {message}"` |

**截断规则**:`_truncate_error_message(value, limit=200)` — 200 字符截断 + 折叠多余空白。原因:LiteLLM 异常的 `str()` 经常带 traceback 风格的 ServiceUnavailableError 文本,直接 raise 会把整段堆栈塞进 ApiResponse。

### 4.2 流式错误的特殊处理

`_stream_with_think_detection`(`ai.py:1525-1530`):

```python
except Exception as exc:
    _status_code, detail = _normalize_generation_error(exc)
    error_code = detail
    yield _make_sse({"type": "error", "code": "AI_STREAM_ERROR", "message": detail})
```

**只发 error 帧不抛 HTTP 错** — StreamingResponse 一旦开始 200 OK,中途没法改 status code。前端 useStreamResponse 看到 `type=error` 就 fallback 到错误状态。

### 4.3 search/index 端点的精细分类

`apps/ai-service/app/api/routes/search.py:282-329`(index_post):

```python
if "ServiceUnavailableError" in exc_name or "503" in error_msg:
    http_code = 503
    user_msg = "Embedding 提供商不可用(503),请检查 oneapi/中转的 channel 配置或稍后重试"
elif "RateLimitError" in exc_name or "429" in error_msg:
    http_code = 429
    user_msg = "Embedding 提供商触发限流(429)"
elif "AuthenticationError" in exc_name or "401" in error_msg or "403" in error_msg:
    http_code = 401
    user_msg = "Embedding 提供商认证失败,请检查 API Key"
elif "Timeout" in exc_name or "TimeoutError" in error_msg:
    http_code = 504
    user_msg = "Embedding 请求超时,可在搜索配置中增大单篇超时"
elif "NotFoundError" in exc_name or "model_not_found" in error_msg or "404" in error_msg:
    http_code = 404
    user_msg = "Embedding 模型不存在或中转未配置该 channel"
elif "DataError" in exc_name or ("dimensions" in error_msg.lower()) or ...:
    http_code = 422
    user_msg = "向量维度与存储不匹配 ..."
else:
    http_code = 502
    user_msg = "Embedding 调用失败"
```

设计理由:Go backend 的批处理 indexer 期望"干净的非 200 状态 + 简短错误消息",而不是 unhandled_exception 满屏 traceback。每个分类的 `user_msg` 是**给运维**的可立即操作提示。

---

## 5. Agent 多轮对话(`/api/v1/agent/chat`)

入口:`apps/ai-service/app/api/routes/agent.py:521-605`。

### 5.1 帧序列

```
data: {"type": "delta", "content": "..."}
...
data: {"type": "done"}
```

或失败:

```
data: {"type": "error", "code": "agent_stream_error", "message": "..."}
```

> Agent **不发 `result` 事件**(payload 形态由前端控制,后端不知道结构)。

### 5.2 与业务流式端点的区别

| 维度 | 业务端点(summary/...) | agent_chat |
|---|---|---|
| prompt 来源 | `ai_task_types.prompt_template`(系统约束) | `_MODE_SYSTEM_PROMPTS["chat"\|"cowork"\|"code"]`(三种 mode 内嵌的 system) |
| 模型解析 | `LlmRouter._resolve_route` 四层优先级 | `_resolve_for_agent`(任务别名 fallback `agent → qa → summary` → 任意启用 chat 模型) |
| modelId/providerCode 信任 | 信任(`allow_override=True`) | **DEPRECATED** 静默忽略(VULN-614) |
| think 检测 | 是 | **否**(直接透传 LiteLLM delta,客户端自己处理) |
| 重试 | 首字节前 1 次 | 无 |
| body 限制 | `max_input_chars=120000` | `_enforce_message_limits`:单条 ≤ 8000、合计 ≤ 32000 |

### 5.3 Picker 上下文注入

`_build_picker_context`(`agent.py:160-254`)把 `articleIds[]` / `tagSlugs[]` 转成 system 消息:

```
下面是用户在 Agent 工作台显式引用的素材, 请优先基于这些内容作答; 引用具体段落时附上文章 URL。

# 用户引用的文章原文
## <title>
URL: /posts/<slug>
Summary: <summary>
<content_markdown,前 1800 字符>

## ...

# 用户引用的标签下的文章
## #<tagName>
- <recent_title_1>
- <recent_title_2>
- ...
```

SQL 强约束(`agent.py:191-201`):

```sql
SELECT p.id, p.title, p.slug, p.summary, p.content_markdown
FROM posts p
WHERE p.id = ANY($1::bigint[])
  AND p.deleted = FALSE
  AND p.status = 'PUBLISHED'
  AND p.is_hidden = FALSE
  AND p.password IS NULL
```

即使前端 picker 已经在 Go 那边过滤,这里仍显式过滤 — 「内容一旦离开服务端进入 LLM context,再多前端门禁都没用」。

---

## 6. RAG QA(`/api/v1/search/qa`)

入口:`apps/ai-service/app/api/routes/search.py:388-450`。

### 6.1 帧序列

```
data: {"type": "delta", "content": "..."}
...
data: {"type": "sources", "sources": [{"title": "...", "slug": "..."}]}      ← 自定义事件,旧消费者
data: {"type": "result", "data": {"answer": "...", "sources": [...]}}        ← 标准事件,通用消费者
data: {"type": "done"}
```

### 6.2 实现细节

```python
async def generate():
    accumulated_answer = ""
    try:
        async for chunk in llm_router.stream_chat(
            prompt_variables={"context": context_text, "query": q},
            model_alias="qa",
        ):
            accumulated_answer += chunk
            data = _json.dumps({"type": "delta", "content": chunk}, ensure_ascii=False)
            yield f"data: {data}\n\n"

        sources_data = _json.dumps({"type": "sources", "sources": sources}, ensure_ascii=False)
        yield f"data: {sources_data}\n\n"

        result_data = _json.dumps(
            {"type": "result", "data": {"answer": accumulated_answer, "sources": sources}},
            ensure_ascii=False,
        )
        yield f"data: {result_data}\n\n"

        yield 'data: {"type": "done"}\n\n'
    except Exception as exc:
        error_data = _json.dumps(
            {"type": "error", "code": "qa_error", "message": str(exc)},
            ensure_ascii=False,
        )
        yield f"data: {error_data}\n\n"
```

**注意**:这里**直接调** `llm_router.stream_chat` 而不是 `stream_chat_with_think_detection`。QA 任务通常没 reasoning 包装(中转模型一般不开 reasoning),如果未来需要可以替换。

> `accumulated_answer` 累积所有 chunk(O(n²) 字符串拼接) — 风险点:超长 RAG 输出(几千字)会有性能损耗,但 QA 通常输出 < 1000 字,实际不显著。如果要修,改成 `list + "".join` 模式,与业务流式端点对齐。

---

## 7. Profile reindex 流(`/api/v1/admin/search/profiles/{code}/reindex/stream`)

入口:`apps/ai-service/app/api/routes/profiles.py:394-526`。

### 7.1 帧序列

```
data: {"type": "start", "total": 1234, "profile": "<code>"}
data: {"type": "progress", "postId": 42, "index": 1, "chunks": 8, "status": "ok", "elapsedMs": 1234.5}
data: {"type": "progress", "postId": 43, "index": 2, "chunks": 0, "status": "failed", "error": "<200 chars>", "elapsedMs": 56.7}
...
data: {"type": "result", "data": {"profile": "<code>", "indexed": 1230, "failed": 4, "target_status": "shadow"}}
data: {"type": "done"}
```

或致命错误(DB 连接挂等):

```
data: {"type": "error", "message": "<200 chars>"}
```

### 7.2 内存优化

```python
# 内存优化:不要一次把所有 PUBLISHED 文章的 content_markdown 拉进内存
# (数万篇 × 平均 20KB 正文 = 数百 MB,会让 ai-service OOM)
async with pool.acquire() as conn:
    id_rows = await conn.fetch(
        "SELECT id FROM posts WHERE deleted = FALSE AND status = 'PUBLISHED' "
        "ORDER BY id ASC"
    )
total = len(id_rows)
yield _sse_pack({"type": "start", "total": total, "profile": code})

for i, id_row in enumerate(id_rows, 1):
    post_id = id_row["id"]
    # 单独 SELECT 一行 content_markdown
    async with pool.acquire() as conn:
        post = await conn.fetchrow(
            "SELECT id, title, slug, content_markdown FROM posts "
            "WHERE id = $1 AND deleted = FALSE AND status = 'PUBLISHED'",
            post_id,
        )
    ...
```

1 万篇博客的 id 列表只占 ~80KB 内存。每篇处理时单独 SELECT 一行 — asyncpg 内部会复用 prepared statement,开销可控。

### 7.3 per-post 失败不中断

`try/except` 在 per-post 维度,失败仍 yield `progress(status=failed)`。中途文章被删 / 改状态 → fetchrow None,跳过并标 failed,避免 KeyError 让流崩盘。

---

## 8. 流式 result extras(`tags` 流的特殊路径)

`/api/v1/ai/tags/stream` 需要把 `existing_lookup` 字典传给 result 构造,让流式终稿和非流式 `/tags` 走同一套结构化分桶逻辑(`ai.py:1581-1583`):

```python
result_extras = {"existing_lookup": _build_existing_lookup(req.existingTags)}
return StreamingResponse(
    _stream_with_think_detection(..., result_extras=result_extras),
    ...
)
```

`_build_stream_result_payload` 在处理 `task_type == "tags"` 时会从 `extras.get("existing_lookup")` 取出此字典,调 `_parse_tags_structured` 完整复用非流式分桶。

---

## 9. Tool calling 现状

> **当前未启用**。

LiteLLM 的 `acompletion(model=..., tools=[...], tool_choice=...)` 在依赖 (`litellm==1.83.0`) 里完全可用,但 ai-service 没有任何路径传入 `tools`。原因:

- 业务 task(summary/tags/translate)用文本输出 + 后处理解析(`_parse_tags_structured` 等)就够,引入 tool calling 会增加客户端契约变更
- agent 工作台目前只做对话,没接函数调用编排
- search 索引/检索是 ai-service 自己控制的流水线,不需要让 LLM 来调

接入路径(供未来参考):

1. 在 `LlmRouter.chat()` / `stream_chat()` 加 `tools: list[dict] | None` 参数,直接透传给 `acompletion`
2. 在 `_log_chat_request` 中把 tool_calls 也落审计日志
3. 流式响应中处理 `delta.tool_calls`(LiteLLM 已经标准化为 OpenAI tool_call 形态)
4. 路由层(`routes/agent.py` 或新 `routes/tools.py`)负责 dispatch tool 函数 + 拼回 tool 消息再次调 `chat()`

---

## 10. 前端契约一致性

前端 `apps/admin/src/hooks/useStreamResponse.ts`(本文档不展开,见模块 06)消费这套 SSE 协议时:

- `delta` → 累积到富文本 / Markdown 渲染区
- `result` → 落定最终结构(替代之前的 delta 累积)
- `done` → 关闭流,触发 onComplete 回调
- `error` → 切到错误 state,展示 `message`

**任何对 SSE 协议的破坏性修改都需要前后端同步发布**。当前 `result` 事件 payload 的 schema 已锁定为 `{type:"result", data:<*Data>}`(详见 `ai.py:_build_stream_result_payload`)。

---

## 11. 已知限制与可改进项

1. **think 检测的正则集合静态**:新模型 / provider 用 `<chain-of-thought>` / `<inner_monologue>` 等其它包裹符号会被串到正文。需要可配置正则(从 `search_profiles` / `ai_models.capabilities` 读)。
2. **首字节前重试只有 1 次**:某些超慢 provider(中转 first-token > 5s)失败概率会高。若加重试 N 次,要把 600ms backoff 改成指数退避,且记 metrics 防滥用。
3. **agent 流没 result 事件**:前端要自己 fallback 到 delta 累积。统一形态需要在 schema 层定义 AgentResult,但 admin UI 现在不需要。
4. **流式不写 cache**:cache 在非流式同步路径写入(`_safe_cache_set_json`)。流式调用相同输入会重新调 LLM。这是有意为之 — 流式输出经常是用户在迭代调试,缓存它会让 UX 变差。代价:同一篇文章流式生成两次摘要,API 费用×2。
5. **没有 `event:` SSE field**:全部用 `data:` 单行 + payload 内 `type` 字段。简化前端解析,但偏离 SSE 标准。EventSource 客户端能处理(它把无 event 字段的帧当 'message' 事件),但严格符合 RFC 6202 的客户端可能需要适配。
