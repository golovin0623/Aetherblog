# Search Profiles Follow-up PR — 执行手册

> 状态：执行计划，待新 session 实施。
> 前置：PR #541（commit `349fe5c`）已合并，搜索索引已升级为 profile 化 chunking pipeline。
> 本 PR 目标：把后台 / chunker / 蓝绿切换的"操作面"补齐，把 profile 切换从"调 SQL / curl"提升为可视化 admin 流程。

## 0. 新 session 启动前必读

按顺序读完，再开始动手：

1. **`CLAUDE.md`** —— 项目总览、设计系统、命名约定、文档规范
2. **本文件** —— 锁定决策、文件清单、commit 顺序、验收标准
3. **PR #541 的 diff** —— `git show 349fe5c`，看清 chunking pipeline 的现有形态
4. **`apps/ai-service/app/services/chunker.py`** —— 要新增 `qa` / `parent_child` 策略
5. **`apps/ai-service/app/services/vector_store.py`** —— 要扩展 parent_text 召回
6. **`apps/ai-service/app/api/routes/profiles.py`** —— 要新增 `/reindex/stream` 端点
7. **`apps/ai-service/app/api/routes/search.py:retry_failed_indexes`** —— 要扩展 profileCode 参数
8. **`apps/admin/src/pages/SearchConfigPage.tsx`** —— UI 嵌入位置 + 现有模式参考
9. **`apps/admin/src/hooks/useStreamResponse.ts`** —— SSE 消费 hook，复用基础

---

## 1. 锁定的设计决策（不要再争论）

这些是上一轮已经和 owner 对齐的，**新 session 直接照执行，不要重新讨论**：

| 议题 | 决定 |
|---|---|
| 单 PR or 拆多 PR | **单 PR，commits 拆 10 个保持 review 友好** |
| `qa` chunker 语义 | 检测 Q/A 标记模式（`问：/答：`、`Q:/A:`、`## 问题/## 回答` 等），每对作为一个 chunk embed |
| `parent_child` chunker 语义 | child=256 token / parent=1024 token；child 用于精确召回，parent 用于上下文返回 |
| parent 存储方式 | `post_embeddings` 新增 `parent_text TEXT NULL` 列；其他策略下为 NULL（migration 000042） |
| SSE endpoint 设计 | 新建 `POST /api/v1/admin/search/reindex/stream`；旧 `/reindex` 保留向后兼容（admin UI 切换前不能砍） |
| Admin UI 嵌入位置 | `SearchConfigPage.tsx` Card 1（向量化状态）和 Card 2（搜索功能开关）之间，新 section "搜索配置文件管理"，**不开新路由** |
| Profile activation 模式 | 现有 strict-blocking（shadow 必须全覆盖才能 activate），UI 上以多步向导呈现：创建 → reindex stream → activate |
| `retry-failed` profile 化 | `?profileCode=<code>` 可选参数；不传按原逻辑（`embedding_status='FAILED'`），传则返回"该 profile 下没有 active/shadow 行的 post"集合 |
| chunker_kind 列约束 | migration 000041 已 CHECK `('recursive', 'fixed', 'markdown', 'qa', 'parent_child')`，**不需要改 schema check** |
| 文档同步 | PR 合并后 `/doc` 命令统一同步 CLAUDE.md / architecture.md，本 PR 内不写 |

---

## 2. Migration 000042 — `parent_text` 列

文件：`apps/server-go/migrations/000042_post_embedding_parent_text.up.sql`

```sql
-- ref: parent_child chunker（follow-up to 000041）
--
-- parent_child 策略：post 切成 child(小, 高精度) + parent(大, 高上下文)。
-- child 嵌入用于召回，parent 文本召回时回显给 RAG / UI 提供完整上下文。
-- 其他 chunker_kind（recursive/fixed/markdown/qa）下该列为 NULL。
--
-- 不破坏存量数据：纯加列，可空，无默认填充。

ALTER TABLE post_embeddings
    ADD COLUMN IF NOT EXISTS parent_text TEXT;

COMMENT ON COLUMN post_embeddings.parent_text IS
    'parent_child chunker 策略下的父段原文。child 命中后用 parent_text 提供完整上下文；'
    '其他策略 NULL。父段长度由 search_profiles.chunk_size_tokens × 4 经验值决定，'
    '在 chunker.py 的 ParentChildChunker 实现里固化。';
```

down 文件：`apps/server-go/migrations/000042_post_embedding_parent_text.down.sql`

```sql
ALTER TABLE post_embeddings DROP COLUMN IF EXISTS parent_text;
```

**注意：** migration 000041 的 chunker_kind CHECK 已经允许 `qa` 和 `parent_child`，本 migration 不需要再改约束。

---

## 3. 后端实施

### 3.1 chunker.py · 增加 `qa` 策略

文件：`apps/ai-service/app/services/chunker.py`

新增函数 `_split_qa(text, chunk_size_tokens, encoding)`：

**算法：**
1. 用正则识别 Q/A 标记，把文章切分为 `[(question, answer), ...]` 对
2. 支持的标记模式（按优先级）：
   - `^问[:：]` / `^答[:：]`（中文冒号兼容）
   - `^Q[:.]` / `^A[:.]`（英文）
   - `^## 问题` / `^## 回答` / `^## Q` / `^## A`
   - `^\*\*Q\.?\*\*` / `^\*\*A\.?\*\*`（粗体 Markdown）
   - 数字编号 FAQ：`^\d+\. .+\?` 一行 + 紧随的非 Q 段落作为 A
3. 每对 Q+A 拼接为一个 chunk（`f"{question}\n\n{answer}"`）
4. 单对超过 chunk_size_tokens → 按 token 硬切，但**保证 question 完整出现在每个切片**（这样所有切片都能被问题语义匹配）
5. 文档不含任何 Q/A 标记 → 退化到 `_split_recursive`（让 caller 仍能拿到 chunks）

**正则定义（写到模块级常量）：**
```python
_QA_QUESTION_RE = re.compile(
    r"^(?:问[:：]\s*|Q[:.]\s*|##\s+(?:问题|Q[:.]?)\s*|\*\*Q\.?\*\*\s*|\d+\.\s+(?=.+[?？]\s*$))",
    re.MULTILINE,
)
_QA_ANSWER_RE = re.compile(
    r"^(?:答[:：]\s*|A[:.]\s*|##\s+(?:回答|A[:.]?)\s*|\*\*A\.?\*\*\s*)",
    re.MULTILINE,
)
```

**测试用例（`tests/test_chunker_qa.py`，新文件）：**
- 中文 `问：/答：` 标记的 FAQ → 每对一个 chunk
- 英文 `Q:/A:` 标记 → 同上
- 混合 Markdown `## 问题` 标题 + 段落 → 同上
- 单 Q+A 对超过 chunk_size → 多 chunk，每个都包含 question
- 无 Q/A 标记的普通文章 → 退化到递归切片
- 空文档 → 空 list

### 3.2 chunker.py · 增加 `parent_child` 策略

数据结构升级：`Chunk` dataclass 增加可选字段 `parent_text: str | None = None`

新增函数 `_split_parent_child(text, child_size_tokens, parent_size_multiplier, encoding)`：

**算法：**
1. 先按 `_split_recursive` 切出 parent chunks，使用 `child_size_tokens × parent_size_multiplier`（默认 4，即 256×4=1024）作为 parent 大小
2. 对每个 parent chunk，再按 `child_size_tokens` 切出 children
3. 每个 child 记录其 parent_text
4. 返回 `[Chunk(index, text=child_text, tokens, parent_text=parent_text), ...]`

**signature：**
```python
def _split_parent_child(
    text: str,
    child_size_tokens: int,
    parent_size_multiplier: int = 4,
    encoding=None,
) -> list[Chunk]:
    ...
```

**对 `split()` 入口的影响：**
- `chunker_kind='parent_child'` 走新分支
- `chunk_size_tokens` 在此模式下解释为 child 大小
- overlap 仍生效在 child 之间（不在 parent 之间）

**测试用例（`tests/test_chunker_parent_child.py`，新文件）：**
- 短文档（< parent_size）→ 1 个 parent，N 个 children 都共享同一 parent_text
- 长文档 → 多 parent，children 跨 parent 时 parent_text 切换正确
- 验证每个 Chunk 的 `parent_text` 包含 `chunk_text`（child 是 parent 的子串）
- `chunk_text` 长度近似 child_size_tokens；`parent_text` 近似 child_size × multiplier

### 3.3 vector_store.py · parent_child 召回

修改 `upsert_post_embedding()`（第 ~140 行附近）：

INSERT 时多写一列 `parent_text`：

```python
rows_to_insert = [
    (
        post_id,
        profile.id,
        profile.model_id,
        first_dim,
        vec,
        target_status,
        c.index,
        c.text,
        c.parent_text,  # NEW
    )
    for c, vec in embed_results
]
await conn.executemany(
    """
    INSERT INTO post_embeddings
        (post_id, profile_id, model_id, dim, embedding, status,
         chunk_index, chunk_text, parent_text, indexed_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    """,
    rows_to_insert,
)
```

修改 `semantic_search()`（CTE 内的 candidate_chunks）：

```sql
WITH candidate_chunks AS (
    SELECT
        pe.post_id,
        pe.chunk_index,
        pe.chunk_text,
        pe.parent_text,           -- NEW
        1 - (pe.embedding::{cast_type}({dim}) <=> $1::{cast_type}({dim})) AS similarity
    FROM post_embeddings pe
    WHERE pe.profile_id = $2 AND pe.status = 'active' AND pe.dim = $3
    ORDER BY pe.embedding::{cast_type}({dim}) <=> $1::{cast_type}({dim})
    LIMIT $4
),
ranked AS (
    SELECT
        cc.post_id,
        MAX(cc.similarity) AS similarity,
        -- 优先返回 parent_text（提供更完整上下文），缺失时回退到 chunk_text
        (array_agg(COALESCE(cc.parent_text, cc.chunk_text) ORDER BY cc.similarity DESC NULLS LAST))[1] AS top_chunk_text
    FROM candidate_chunks cc
    GROUP BY cc.post_id
)
...
```

`COALESCE(parent_text, chunk_text)` 的好处：parent_child 模式下返回完整段落作为高亮；其他模式 parent_text 为 NULL 自然回退到原 chunk_text，零侵入。

### 3.4 search.py · profile-scoped retry-failed

文件：`apps/ai-service/app/api/routes/search.py:retry_failed_indexes`

签名扩展：

```python
@router.post("/api/v1/admin/search/retry-failed")
async def retry_failed_indexes(
    profileCode: str | None = Query(default=None),
    user=Depends(require_admin),
    vector_store=Depends(get_vector_store),
    pool=Depends(get_pg_pool),
) -> ApiResponse[dict]:
    ...
```

逻辑分支：

```python
if profileCode:
    # 指定 profile 模式：retry "该 profile 下没有 active/shadow 行的 post"
    profile = await vector_store._fetch_profile_by_code(profileCode)
    if not profile:
        raise HTTPException(404, f"Profile '{profileCode}' 不存在")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT p.id, p.title, p.slug, p.content_markdown
            FROM posts p
            WHERE p.deleted = FALSE
              AND p.status = 'PUBLISHED'
              AND NOT EXISTS (
                  SELECT 1 FROM post_embeddings pe
                  WHERE pe.post_id = p.id
                    AND pe.profile_id = $1
                    AND pe.status IN ('active', 'shadow')
              )
            ORDER BY p.id LIMIT 100
            """,
            profile.id,
        )
    target_status = "active" if profile.status == "active" else "shadow"
else:
    # 旧逻辑：embedding_status='FAILED'
    profile = await vector_store.get_active_profile()
    target_status = "active"
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, title, slug, content_markdown FROM posts "
            "WHERE deleted = FALSE AND status = 'PUBLISHED' AND embedding_status = 'FAILED' "
            "ORDER BY id LIMIT 100"
        )

# 后续 process_one 逻辑保持，传 profile + target_status
```

### 3.5 profiles.py · 新建 `/reindex/stream` SSE 端点

文件：`apps/ai-service/app/api/routes/profiles.py`（追加路由，不要改现有 CRUD）

**端点：** `POST /api/v1/admin/search/profiles/{code}/reindex/stream`

**为什么放 profiles.py 而不是 search.py：** 这条流式 reindex 强绑定特定 profile（蓝绿切换专用），URL 语义上属于 profile 命名空间。旧的非流式 `/v1/admin/search/reindex?profileCode=` 保留兼容老调用。

**SSE 协议（与 admin `useStreamResponse` 兼容）：**

```
data: {"type":"start","total":50,"profile":"new-v2"}\n\n
data: {"type":"progress","postId":11,"index":1,"chunks":17,"status":"ok","elapsedMs":2340}\n\n
data: {"type":"progress","postId":12,"index":2,"chunks":0,"status":"failed","error":"Embedding 503"}\n\n
...
data: {"type":"result","data":{"profile":"new-v2","indexed":48,"failed":2,"target_status":"shadow"}}\n\n
data: {"type":"done"}\n\n
```

注意 `useStreamResponse` 只识别 `delta` / `result` / `done` / `error`，不识别 `progress`。**两条路：**
- A) 在 frontend 包一个 `useReindexStream` 复用 fetch+ReadableStream 但不走 useStreamResponse（最干净）
- B) 把 progress 事件用 `delta` 重命名 + content 字段塞 JSON（hack）

**选 A**。frontend 部分（4.3）写专用 hook。

**实现要点：**

```python
from fastapi.responses import StreamingResponse
import json

@router.post("/{code}/reindex/stream")
async def reindex_profile_stream(
    code: str,
    user=Depends(require_admin),
    pool=Depends(get_pg_pool),
    vector_store=Depends(get_vector_store),
):
    profile = await vector_store._fetch_profile_by_code(code)
    if not profile:
        raise HTTPException(404, f"Profile '{code}' 不存在")
    if profile.status == "deprecated":
        raise HTTPException(400, f"Profile '{code}' 已弃用")

    target_status = "active" if profile.status == "active" else "shadow"

    async def gen():
        # 整个生成器包一层 try/except：StreamingResponse 一旦开始返回就是
        # 200 OK，期间任何未捕获异常会让 SSE 连接被截断，前端只能感知
        # "连接关闭"而不知道发生了什么。显式 yield 一个 error 事件让
        # useReindexStream 能优雅处理（写 error state、停 isRunning）。
        try:
            async with pool.acquire() as conn:
                posts = await conn.fetch(
                    "SELECT id, title, slug, content_markdown FROM posts "
                    "WHERE deleted = FALSE AND status = 'PUBLISHED' ORDER BY id ASC"
                )
            total = len(posts)
            yield _sse({"type": "start", "total": total, "profile": code})

            indexed = 0
            failed = 0
            for i, p in enumerate(posts, 1):
                t0 = time.perf_counter()
                try:
                    result = await vector_store.upsert_post_embedding(
                        post_id=p["id"],
                        title=p["title"], slug=p["slug"],
                        content=p["content_markdown"] or "",
                        metadata={"status": "PUBLISHED"},
                        profile=profile,
                        target_status=target_status,
                    )
                    indexed += 1
                    yield _sse({
                        "type": "progress",
                        "postId": p["id"],
                        "index": i,
                        "chunks": result.get("chunks", 0),
                        "status": "ok",
                        "elapsedMs": round((time.perf_counter() - t0) * 1000, 2),
                    })
                except Exception as exc:
                    failed += 1
                    yield _sse({
                        "type": "progress",
                        "postId": p["id"],
                        "index": i,
                        "chunks": 0,
                        "status": "failed",
                        "error": str(exc)[:200],
                        "elapsedMs": round((time.perf_counter() - t0) * 1000, 2),
                    })

            yield _sse({"type": "result", "data": {
                "profile": code,
                "indexed": indexed,
                "failed": failed,
                "target_status": target_status,
            }})
            yield _sse({"type": "done"})
        except Exception as exc:
            # DB 连接 / 池获取 / 任何 per-post try 之外的异常都落到这里。
            # message 截断 200 字符避免把堆栈泄露到前端 UI。
            yield _sse({"type": "error", "message": str(exc)[:200]})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no"},  # nginx 关掉 buffering
    )

def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"
```

**注意：** `X-Accel-Buffering: no` 必须显式发；nginx 的 `/api/v1/ai/` 路由已经配过，但 profiles 在 `/api/v1/admin/`，要确认 gateway 配置覆盖到这条路径（CLAUDE.md 提到 nginx `/api/` 是通用代理，应该也走 SSE 但保险起见检查 `nginx/nginx.conf` + `nginx/nginx.dev.conf`）。

### 3.6 后端测试

新文件：
- `tests/test_chunker_qa.py` — 6 个用例
- `tests/test_chunker_parent_child.py` — 5 个用例
- `tests/test_profile_reindex_stream.py` — 用 `httpx.AsyncClient` 调流式端点，验证 SSE 帧序列
- `tests/test_retry_failed_profile_scoped.py` — 验证 profileCode 参数下的 SQL 路径

---

## 4. 前端实施

所有路径相对 `apps/admin/src/`。

### 4.1 service · `services/searchProfileService.ts`（新文件）

```typescript
import { api } from './api';

export interface SearchProfile {
  id: number;
  code: string;
  name: string;
  description: string | null;
  modelId: string;
  chunkerKind: 'recursive' | 'fixed' | 'markdown' | 'qa' | 'parent_child';
  chunkSizeTokens: number;
  chunkOverlapTokens: number;
  status: 'active' | 'shadow' | 'deprecated';
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CreateProfileRequest {
  code: string;
  name: string;
  description?: string;
  modelId: string;
  chunkerKind: SearchProfile['chunkerKind'];
  chunkSizeTokens: number;
  chunkOverlapTokens: number;
}

export const searchProfileService = {
  list: () => api.get<{ data: SearchProfile[] }>('/v1/admin/search/profiles'),
  create: (req: CreateProfileRequest) =>
    api.post<{ data: SearchProfile }>('/v1/admin/search/profiles', req),
  activate: (code: string) =>
    api.post<{ data: { status: string; code: string; previousActive: string | null } }>(
      `/v1/admin/search/profiles/${encodeURIComponent(code)}/activate`,
    ),
  deprecate: (code: string) =>
    api.post(`/v1/admin/search/profiles/${encodeURIComponent(code)}/deprecate`),
  delete: (code: string) =>
    api.delete(`/v1/admin/search/profiles/${encodeURIComponent(code)}`),
};
```

### 4.2 hook · `hooks/useSearchProfiles.ts`（新文件）

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { searchProfileService, type CreateProfileRequest } from '../services/searchProfileService';

const KEY = ['search-profiles'] as const;

export function useSearchProfiles() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await searchProfileService.list()).data,
    staleTime: 30_000,
  });
}

export function useCreateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateProfileRequest) => searchProfileService.create(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useActivateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => searchProfileService.activate(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['search-diagnostics'] });
      qc.invalidateQueries({ queryKey: ['search-stats'] });
    },
  });
}

export function useDeprecateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => searchProfileService.deprecate(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => searchProfileService.delete(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
```

### 4.3 hook · `hooks/useReindexStream.ts`（新文件，专用 SSE 消费）

不复用 `useStreamResponse`（事件类型不匹配，强行套会模糊语义）。直接用 `fetch + ReadableStream`：

```typescript
import { useState, useRef, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';

export interface ReindexProgressEvent {
  postId: number;
  index: number;
  chunks: number;
  status: 'ok' | 'failed';
  error?: string;
  elapsedMs: number;
}

export interface ReindexResult {
  profile: string;
  indexed: number;
  failed: number;
  target_status: 'active' | 'shadow';
}

export function useReindexStream() {
  const [total, setTotal] = useState(0);
  const [progress, setProgress] = useState<ReindexProgressEvent[]>([]);
  const [result, setResult] = useState<ReindexResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (profileCode: string) => {
    setProgress([]); setResult(null); setError(null);
    setIsRunning(true); setTotal(0);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const token = useAuthStore.getState().token;

    try {
      const res = await fetch(
        `/api/v1/admin/search/profiles/${encodeURIComponent(profileCode)}/reindex/stream`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'text/event-stream' },
          signal: ctrl.signal,
        },
      );
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          // 单条 malformed 不能让整个 stream 处理跪掉。SSE 协议允许
          // keep-alive 注释行、空 data、上游缓冲拼帧等边界情况，对所有
          // JSON.parse 失败都只 console.error 然后继续读下一行。
          try {
            const data = line.slice(6);
            if (!data) continue;
            const obj = JSON.parse(data);
            if (obj.type === 'start') setTotal(obj.total);
            else if (obj.type === 'progress') setProgress((p) => [...p, obj]);
            else if (obj.type === 'result') setResult(obj.data);
            else if (obj.type === 'done') setIsRunning(false);
            else if (obj.type === 'error') { setError(obj.message); setIsRunning(false); }
          } catch (e) {
            console.error('Failed to parse SSE data:', e, line);
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setError(String(e));
    } finally {
      setIsRunning(false);
    }
  }, []);

  const abort = useCallback(() => abortRef.current?.abort(), []);

  return { total, progress, result, isRunning, error, start, abort };
}
```

### 4.4-4.10 组件清单

> **设计系统约束（CLAUDE.md）：** 新组件必须使用 Aether Codex 的 4 层 surface（leaf/raised/overlay/luminous）+ aurora token，不要 hand-rolled `bg-white/5`。文字按 `--ink-*` 取色。表单按现有 react-hook-form + zod 模板。

| # | 组件 | 路径 | 职责 |
|---|---|---|---|
| 4.4 | `ProfileManagementSection.tsx` | `pages/search-config/` | 容器：列表 + 工具栏（"创建 profile"按钮） |
| 4.5 | `ProfileListCard.tsx` | `pages/search-config/` | 单行 profile 卡：状态徽章、模型/chunker meta、操作下拉 |
| 4.6 | `CreateProfileModal.tsx` | `pages/search-config/` | 表单：code/name/desc/model/chunker/size/overlap |
| 4.7 | `ChunkerKindSelector.tsx` | `pages/search-config/` | Dropdown：5 种 chunker 带描述卡 |
| 4.8 | `ProfileActivationFlow.tsx` | `pages/search-config/` | 多步向导：confirm → reindex SSE 进度条 → activate → done |
| 4.9 | `ProfileDetailDrawer.tsx` | `pages/search-config/` | 右侧 drawer：完整元数据 + deprecate/delete 操作 |
| 4.10 | `SearchConfigPage.tsx` 修改 | `pages/` | 在 Card 1 和 Card 2 之间嵌入 `<ProfileManagementSection />` |

#### 4.6 CreateProfileModal 字段约束

| 字段 | 类型 | zod 校验 | UI |
|---|---|---|---|
| code | string | `/^[a-z0-9][a-z0-9_-]{0,63}$/` | text input，placeholder `"e.g. recursive-256-overlap-32"` |
| name | string | min 1 max 120 | text input |
| description | string optional | max 500 | textarea |
| modelId | string | min 1，从 `embedding-models` query 拉下拉 | Dropdown（复用现有 embedding model selector） |
| chunkerKind | enum | 5 种 | `<ChunkerKindSelector />` |
| chunkSizeTokens | int | 64-8192 | number input，默认按 chunkerKind 调（recursive=512, parent_child=256） |
| chunkOverlapTokens | int | 0-2048 且 < chunkSizeTokens | number input，默认 chunkSize/8 |

#### 4.7 ChunkerKindSelector 描述卡内容

```typescript
const CHUNKER_KINDS = [
  { value: 'recursive', label: '递归 Markdown 切片',
    desc: '按 H1/H2 → 段落 → 句子递归切分。Markdown 友好，通用首选。' },
  { value: 'fixed', label: '定长 Token 切片',
    desc: '纯按 token 硬切，不识别结构。对纯文本可用。' },
  { value: 'markdown', label: 'Markdown 标题切片',
    desc: '与 recursive 等价（保留扩展位）。' },
  { value: 'qa', label: 'Q&A 对切片',
    desc: '识别 "问：/答：" / "Q:/A:" 等模式，每对作为一个 chunk。FAQ/技术问答博文最优。' },
  { value: 'parent_child', label: '父子段切片',
    desc: 'Child(小, 高精度) + Parent(大, 高上下文)。RAG 检索召回更稳。' },
];
```

#### 4.8 ProfileActivationFlow 多步向导

```
[Step 1: Confirm]
  显示：source profile (current active) → target profile (new shadow)
  说明：将运行全量 reindex (~N 篇文章), 完成后自动翻转
  按钮：取消 / 开始

[Step 2: Reindexing]
  使用 useReindexStream 跑 /reindex/stream
  显示：进度条 (progress.length / total)
        最近 5 条事件 (滚动列表，ok 绿 / failed 红)
        当前耗时 / 平均每篇耗时
  按钮：中止

[Step 3: Activate]
  reindex 完成（result.failed === 0）后自动调 activate
  失败：显示 retry / abort 选项

[Step 4: Done]
  显示：旧 profile 已 deprecate，新 profile 已 active，搜索流量已切换
  Toast: 成功
```

### 4.10 SearchConfigPage.tsx 嵌入

在 line ~1180 现有 Card 2（搜索功能开关）**之前**插入：

```tsx
<motion.div className="lg:col-span-2">
  <ProfileManagementSection />
</motion.div>
```

不要改 Card 1 / Card 2 / Card 3 / Card 4 的 markup（review 时 diff 干净）。

### 4.11 前端测试

可选但建议：
- `searchProfileService.test.ts` — mock axios，验证 URL / 参数
- `useSearchProfiles.test.tsx` — 用 `@testing-library/react` + QueryClient mock
- `ChunkerKindSelector.test.tsx` — 渲染 + 选中 callback
- SSE hook 用 mock `fetch + ReadableStream` 测，可选

admin 当前测试覆盖度低，本 PR **不强求**前端测试，但 service / hook 层有 1-2 个 sanity test 是加分项。

---

## 5. Commit 顺序与 review 策略

按依赖顺序拆 10 个 commit，每个 commit 内部自洽（可单独 build / lint / test）：

| # | Commit | 文件数 | 可独立 review |
|---|---|---|---|
| 1 | `feat(search): migration 000042 add post_embeddings.parent_text column` | 2 | ✅ |
| 2 | `feat(search): chunker qa strategy + tests` | 2 | ✅ |
| 3 | `feat(search): chunker parent_child strategy + Chunk.parent_text + tests` | 2 | ✅ |
| 4 | `feat(search): vector_store writes/reads parent_text for parent_child profiles` | 1 | ✅ (依赖 #1, #3) |
| 5 | `feat(search): retry-failed accepts profileCode for shadow recovery` | 2 | ✅ |
| 6 | `feat(search): SSE-streaming reindex endpoint /profiles/{code}/reindex/stream` | 2 | ✅ (依赖 vector_store) |
| 7 | `feat(admin): searchProfileService + useSearchProfiles hooks` | 2 | ✅ |
| 8 | `feat(admin): useReindexStream SSE consumer hook` | 1 | ✅ (依赖 #6) |
| 9 | `feat(admin): ProfileManagementSection + ChunkerKindSelector + CreateProfileModal` | 4-5 | ✅ |
| 10 | `feat(admin): ProfileActivationFlow + ProfileDetailDrawer + SearchConfigPage wiring` | 3-4 | ✅ |

**Branch 命名：** `claude/search-profiles-admin-ui-XXXXX`（让 webhook hooks 能识别 follow-up）。

---

## 6. 验收清单

### 6.1 后端能力

- [ ] `python3 -m pytest tests/test_chunker.py tests/test_chunker_qa.py tests/test_chunker_parent_child.py -v` 全过
- [ ] `python3 -m pytest tests/test_profile_reindex_stream.py tests/test_retry_failed_profile_scoped.py -v` 全过
- [ ] `python3 -m pytest tests/ --no-cov --ignore=tests/e2e` 与 baseline 一致（13 个非相关失败可忽略）
- [ ] `go build ./...` 干净（无新警告）
- [ ] migration 000042 up/down 可双向跑（手动用 `migrate` CLI 验）

### 6.2 端到端流程

部署到 staging 后跑这套手动验收：

1. **创建 profile**：admin UI 点"创建 profile"，填 code=`test-recursive-256` / model 与默认相同 / chunker=recursive / size=256 / overlap=32 → 提交 → 列表出现新行，状态 `shadow`
2. **shadow reindex**：点新 profile 的"激活"按钮 → 弹出向导 → 进度条实时滚动（每篇 1 个事件） → reindex 完成 → 自动翻转
3. **指针翻转验证**：刷新页面，diagnostics 显示 active profile 切换；旧 profile 状态变 `deprecated`
4. **搜索可用性**：在博客前台搜一个出现在长文中后部的关键词，应能召回到对应文章
5. **profile-scoped retry-failed**：手动让某 post 的 shadow 写入失败（mock 上游 503），调 `POST /v1/admin/search/retry-failed?profileCode=<shadow>` → 仅该 post 重试，其他 INDEXED post 不受影响
6. **回滚验证**：deprecate 当前 active、activate 旧 deprecated profile（要求 admin UI 不允许激活 deprecated；这个交互写到 6.3）
7. **删除验证**：deprecate 一个 profile 后点"删除" → 若该 profile 还有 chunk 行 → 提示阻止；先 SQL `DELETE FROM post_embeddings WHERE profile_id=...` 后再删 → 成功

### 6.3 UI 行为约束

- [ ] active profile 不允许删除 / deprecate（按钮 disabled + tooltip 解释）
- [ ] deprecated profile 的"激活"按钮 disabled（PR #541 后端已防御，UI 同步禁用）
- [ ] reindex stream 中断时（用户点"中止"或网络断），UI 进度条停在最后一帧，profile 状态保持 shadow（可重试）
- [ ] 创建 profile 时 chunker_kind 切换会自动改默认 chunkSizeTokens（recursive=512 / parent_child=256 / fixed=512 / qa=512 / markdown=512）
- [ ] 移动端（≤768px）：profile 列表卡折叠，CreateProfileModal 走 bottom sheet（参考 CLAUDE.md 移动端约束）

---

## 7. PR 描述模板

```markdown
## 背景

PR #541 引入了 search profiles + chunking pipeline 的数据层与后端能力，但
profile 切换、shadow 进度可视化、高级 chunker 策略仍只能 SQL/curl 操作。
本 PR 把这些能力上提到 admin UI，并补齐 qa / parent_child 两个高级策略。

## 改动

### 后端
- migration 000042: post_embeddings 加 parent_text 列（parent_child 策略用）
- chunker.py: 新增 qa（Q/A 对识别）+ parent_child（child 256 / parent 1024）
- vector_store.py: parent_text 写入与 COALESCE 召回
- search.py: retry-failed 支持 profileCode 参数
- profiles.py: /reindex/stream SSE 端点（实时进度）

### 前端
- searchProfileService + 4 个 React Query hooks
- useReindexStream（专用 SSE 消费 hook）
- 7 个新组件：ProfileManagementSection / ProfileListCard / CreateProfileModal /
  ChunkerKindSelector / ProfileActivationFlow / ProfileDetailDrawer
- SearchConfigPage.tsx 集成（不改现有 Card 结构）

## 测试
- 11 个新单元测试（chunker qa / parent_child / SSE / profile-scoped retry）
- 验收清单见 docs/SEARCH_PROFILES_FOLLOWUP_PLAN.md §6

## 📄 文档影响
PR 合并后跑 /doc 同步 CLAUDE.md（chunker_kind 列表 + 新 endpoint）+
docs/architecture.md（搜索 section）。本 PR 不写文档，避免 cherry-pick 噪音。

https://claude.ai/code/session_<TBD>
```

---

## 8. 已知风险与对策

| 风险 | 对策 |
|---|---|
| SSE 通过 nginx 长连接超时 | profiles.py 端点显式 `X-Accel-Buffering: no`；如 60 篇文章 reindex 超过 nginx `proxy_read_timeout` 默认 60s，要把这条路径加到 600s 超时（与 `/api/v1/ai/` 一致）。检查 `nginx/nginx.conf` `/api/` location |
| parent_child 让向量数翻倍（每 child 一行） | 监控 `post_embeddings` 行数；存储成本可接受（halfvec 3072 × 2 字节 ≈ 6KB / 行，60 篇 × 5 children × 4 chunks ≈ 1200 行 ≈ 7MB） |
| qa chunker 误识别（普通文章被当成 FAQ） | `_split_qa` 严格要求至少匹配 2 对 Q/A 才走该分支，否则退回 `_split_recursive` |
| 旧 admin UI（PR 合并前的版本）调用了被改的端点 | 没改端点，全是新增；旧 `/v1/admin/search/reindex` 完全保留 |
| migration 000042 在已 chunk 数据上跑 | ALTER ADD COLUMN IF NOT EXISTS + DEFAULT NULL 是 instant DDL，无锁等待 |

---

## 9. 给新 session 的开工指引

> 进入新 session 后第一条 prompt 建议这样写：
>
> > 阅读 `docs/SEARCH_PROFILES_FOLLOWUP_PLAN.md` 与 `CLAUDE.md`，然后按手册的 commit 顺序（§5 表格）从 commit #1 开始实施。每个 commit 完成后跑对应的测试，全过再进入下一个。全部 10 个 commit 完成后开 draft PR，标题用手册 §7 模板。新 branch 命名：`claude/search-profiles-admin-ui-<5位随机>`。
>
> 这样新 session 不需要重新发现需求、争论设计。所有决策都已经在本手册里锁好。
