"""Markdown-aware 递归切片器。

支持的策略（chunker_kind）：
  - ``recursive``  默认。先按 H1/H2/H3 → 段落（双换行）→ 句子 切；
                   超过 chunk_size_tokens 回退到 token 级硬切。
                   相邻 chunk 之间保留 ``chunk_overlap_tokens`` token 重叠。
  - ``fixed``      纯定长。按 token 数硬切，加 overlap。
  - ``markdown``   暂等同 ``recursive``（保留接口位，未来差异化时拆分）。
  - ``qa``         待实现：从问答对中分别 embed 问题与答案。
  - ``parent_child`` 待实现：父段做粗召回、子段做精排。

返回 list[Chunk]，``Chunk.index`` 从 0 开始连续分配，``Chunk.text``
是 chunk 的原文片段（写入 ``post_embeddings.chunk_text`` 用于召回 snippet）。

设计原则：
  - **chunker 是纯函数**：不接 DB / LLM / 网络，只做文本切分。便于单测。
  - **token 而非字符**：chunk_size 用 token 计量，与 OpenAI 8192 上限对齐。
  - **降级路径**：tiktoken 不可用时退化到字符级估算（保守 1:1）；
    不会因为缺数据文件就让整个索引流程崩溃。
"""
from __future__ import annotations

import re
from dataclasses import dataclass

try:  # 可选依赖：tiktoken 是 litellm 的传递依赖，正常部署一定存在
    import tiktoken as _tiktoken
except Exception:  # pragma: no cover - 容错环境无 tiktoken
    _tiktoken = None


@dataclass
class Chunk:
    """切分结果。

    Attributes:
        index: 在文档内的连续序号（从 0 开始）。写入 ``chunk_index`` 列。
        text: chunk 的原文片段。写入 ``chunk_text`` 列，召回时用作 snippet。
        tokens: chunk 估算的 token 数（仅供日志 / debug，不入库）。
    """

    index: int
    text: str
    tokens: int


def _get_encoding():
    """惰性加载 cl100k_base 编码器，失败返回 None（caller 走 fallback）。"""
    if _tiktoken is None:
        return None
    try:
        return _tiktoken.get_encoding("cl100k_base")
    except Exception:  # pragma: no cover - 缺数据文件时退化
        return None


def _token_len(text: str, encoding) -> int:
    """返回 text 的 token 数。无 tiktoken 时按 1:1 估算（最悲观）。"""
    if not text:
        return 0
    if encoding is None:
        return len(text)
    return len(encoding.encode(text))


def _slice_by_tokens(text: str, max_tokens: int, encoding) -> list[str]:
    """把单段长文本按 token 硬切成多片，返回片段列表。

    fallback 路径（无 tiktoken）按 1:1 字符切，保证不超限。
    """
    if max_tokens <= 0 or not text:
        return [text] if text else []
    if encoding is None:
        return [text[i : i + max_tokens] for i in range(0, len(text), max_tokens)]
    ids = encoding.encode(text)
    pieces: list[str] = []
    for i in range(0, len(ids), max_tokens):
        pieces.append(encoding.decode(ids[i : i + max_tokens]))
    return pieces


# 段落分隔（双换行 / 三换行）。Markdown 主流写法用空行隔段。
_PARA_SPLIT = re.compile(r"\n{2,}")
# 句子分隔。中英文句号 / 问号 / 感叹号都识别；保留分隔符不丢。
_SENTENCE_SPLIT = re.compile(r"(?<=[。！？.!?])\s+")
# 标题行（H1-H3）。把整段切成 [pre, '## title', body, '## title', body, ...]。
_HEADING_SPLIT = re.compile(r"(?m)^(#{1,3} .+)$")


def _split_recursive(
    text: str,
    chunk_size_tokens: int,
    encoding,
) -> list[str]:
    """递归切分。返回 chunk 文本列表（暂未应用 overlap）。

    顺序：H1/H2/H3 标题 → 双换行段落 → 句子 → token 硬切。
    """
    if not text or not text.strip():
        return []

    # ---- Step 1: 按标题切，每个 section = "## title\n...body..."
    parts = _HEADING_SPLIT.split(text)
    sections: list[str] = []
    if len(parts) > 1:
        # split 出来：['', '## title1', 'body1', '## title2', 'body2', ...]
        # 第一项可能是 pre-heading 段落（也作为独立 section）
        pre = parts[0].strip()
        if pre:
            sections.append(pre)
        for i in range(1, len(parts), 2):
            heading = parts[i]
            body = parts[i + 1] if i + 1 < len(parts) else ""
            sections.append(f"{heading}\n{body}".strip())
    else:
        sections.append(text.strip())

    # ---- Step 2: 对每个 section 按段落、句子递归细分
    chunks: list[str] = []
    buf = ""  # 当前累积的 chunk

    def flush() -> None:
        nonlocal buf
        s = buf.strip()
        if s:
            chunks.append(s)
        buf = ""

    def append_unit(unit: str) -> None:
        """把一个单元（段落/句子/硬切片段）尝试塞入当前 chunk，超限则 flush 后另起。"""
        nonlocal buf
        if not unit.strip():
            return
        candidate = f"{buf}\n\n{unit}".strip() if buf else unit.strip()
        if _token_len(candidate, encoding) <= chunk_size_tokens:
            buf = candidate
            return
        # 单元自身超限 → 需要进一步拆
        if _token_len(unit, encoding) > chunk_size_tokens:
            flush()
            # 先按句子切
            sentences = [s for s in _SENTENCE_SPLIT.split(unit) if s.strip()]
            if len(sentences) > 1:
                for sent in sentences:
                    append_unit(sent)
            else:
                # 句子级仍超限 → token 硬切
                for piece in _slice_by_tokens(unit, chunk_size_tokens, encoding):
                    flush()
                    chunks.append(piece.strip())
            return
        # 单元能装下但加上 buf 会超 → flush 后用单元起新 chunk
        flush()
        buf = unit.strip()

    for section in sections:
        for paragraph in _PARA_SPLIT.split(section):
            append_unit(paragraph)
    flush()
    return chunks


def _apply_overlap(
    chunks: list[str],
    overlap_tokens: int,
    encoding,
) -> list[str]:
    """在相邻 chunk 之间附加重叠尾部，避免边界丢失上下文。

    第 i 个 chunk 的开头插入第 i-1 个 chunk 的最后 ``overlap_tokens`` token。
    第 0 个 chunk 不变。
    """
    if overlap_tokens <= 0 or len(chunks) <= 1:
        return chunks
    out = [chunks[0]]
    for i in range(1, len(chunks)):
        prev = chunks[i - 1]
        if encoding is None:
            tail = prev[-overlap_tokens:] if len(prev) > overlap_tokens else prev
        else:
            ids = encoding.encode(prev)
            tail_ids = ids[-overlap_tokens:] if len(ids) > overlap_tokens else ids
            tail = encoding.decode(tail_ids)
        out.append(f"{tail.strip()}\n\n{chunks[i].strip()}".strip())
    return out


def split(
    text: str,
    *,
    chunker_kind: str,
    chunk_size_tokens: int,
    chunk_overlap_tokens: int,
) -> list[Chunk]:
    """对外切分入口。返回 ``[Chunk(index, text, tokens), ...]``。

    空文本 / 纯空白 → 返回空 list（caller 应跳过 embed，并标 INDEXED 而非 FAILED）。
    """
    if not text or not text.strip():
        return []

    encoding = _get_encoding()
    kind = (chunker_kind or "recursive").lower()

    if kind == "fixed":
        raw_chunks = _slice_by_tokens(text, chunk_size_tokens, encoding)
    elif kind in ("recursive", "markdown"):
        raw_chunks = _split_recursive(text, chunk_size_tokens, encoding)
    elif kind in ("qa", "parent_child"):
        # 占位：未实现高级策略，先按 recursive 处理避免阻塞数据迁移；
        # 后续 PR 实现真正的 QA / 父子段切分。
        raw_chunks = _split_recursive(text, chunk_size_tokens, encoding)
    else:
        # 未知策略：保守按 recursive 处理，但日志层会有 warning。
        raw_chunks = _split_recursive(text, chunk_size_tokens, encoding)

    if not raw_chunks:
        return []

    overlapped = _apply_overlap(raw_chunks, chunk_overlap_tokens, encoding)

    return [
        Chunk(index=i, text=t, tokens=_token_len(t, encoding))
        for i, t in enumerate(overlapped)
    ]
