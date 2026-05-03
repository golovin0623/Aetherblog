"""Markdown-aware 递归切片器。

支持的策略（chunker_kind）：
  - ``recursive``  默认。先按 H1/H2/H3 → 段落（双换行）→ 句子 切；
                   超过 chunk_size_tokens 回退到 token 级硬切。
                   相邻 chunk 之间保留 ``chunk_overlap_tokens`` token 重叠。
  - ``fixed``      纯定长。按 token 数硬切，加 overlap。
  - ``markdown``   暂等同 ``recursive``（保留接口位，未来差异化时拆分）。
  - ``qa``         检测 ``问：/答：`` ``Q:/A:`` ``## 问题/## 回答`` 等模式，
                   每对作为一个 chunk embed。FAQ / 技术问答博文最优。
                   未识别到至少 2 对 Q/A 时退化到 ``recursive``。
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
        parent_text: 仅 ``parent_child`` 策略下非 None；child 命中后用 parent_text
            提供完整上下文，写入 ``post_embeddings.parent_text`` 列。其他策略下为
            None，存储层会写入 SQL NULL。
    """

    index: int
    text: str
    tokens: int
    parent_text: str | None = None


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

# ---- QA chunker：识别问答对标记 ----
# 顺序按"显式标记 → 弱信号"排，先匹配的优先。匹配后用 split 取边界。
# 设计取舍：要求 ``re.MULTILINE`` 让 ^ 锚定行首（block-scanned）。中文
# 全角冒号兼容。粗体 ``**Q.**`` 等 Markdown 写法也覆盖。
_QA_QUESTION_RE = re.compile(
    r"^(?:"
    r"问[:：]\s*"            # 中文：问： / 问:
    r"|Q[:.]\s*"            # 英文：Q: / Q.
    r"|##[ \t]+(?:问题(?:[:：]|[ \t]|$)|Q(?:[:.]|[ \t]|$))[ \t]*"
    # Markdown 二级标题：## 问题 / ## Q；避免误判 ## Quick Start / ## Query
    r"|\*\*Q\.?\*\*\s*"     # 粗体 Markdown：**Q.** / **Q**
    r")",
    re.MULTILINE,
)
_QA_ANSWER_RE = re.compile(
    r"^(?:"
    r"答[:：]\s*"
    r"|A[:.]\s*"
    r"|##[ \t]+(?:回答(?:[:：]|[ \t]|$)|A(?:[:.]|[ \t]|$))[ \t]*"
    r"|\*\*A\.?\*\*\s*"
    r")",
    re.MULTILINE,
)


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


def _split_qa(
    text: str,
    chunk_size_tokens: int,
    encoding,
) -> list[str]:
    """识别 Q/A 标记，每对作为一个 chunk。

    算法：
      1. 收集所有 question/answer 标记的 (kind, start) 偏移
      2. 按 start 升序排列；连续的 Q→A 才被视为一对，丢弃孤立 Q / 孤立 A
      3. question 文本 = Q 标记前缀长度后到下一个 marker 起点
         answer 文本   = A 标记前缀长度后到下一个 marker 起点 / EOF
      4. 拼接 ``f"{question}\\n\\n{answer}"`` 作为一个 chunk
      5. 单对超过 chunk_size_tokens → 按 token 硬切，保证 question 完整
         出现在每个切片（这样所有切片都能被问题语义匹配）
      6. 至少识别到 2 对才走 QA 路径；不足时返回空列表，让 caller 退化

    返回 chunk 文本列表（不应用 overlap，因为每对 Q+A 是独立语义单元）。
    """
    if not text or not text.strip():
        return []

    # 收集所有 marker：(kind, span_start, span_end)
    markers: list[tuple[str, int, int]] = []
    for m in _QA_QUESTION_RE.finditer(text):
        markers.append(("Q", m.start(), m.end()))
    for m in _QA_ANSWER_RE.finditer(text):
        markers.append(("A", m.start(), m.end()))
    markers.sort(key=lambda x: x[1])

    # 配对：连续的 Q→A 才有效
    pairs: list[tuple[int, int, int, int]] = []  # (q_text_start, q_text_end, a_text_start, a_text_end)
    i = 0
    while i < len(markers) - 1:
        kind_q, _, q_end = markers[i]
        kind_a, a_start, a_end = markers[i + 1]
        if kind_q == "Q" and kind_a == "A":
            # question 文本范围：q_end → a_start
            # answer 文本范围：  a_end → 下一个 marker / EOF
            next_start = markers[i + 2][1] if i + 2 < len(markers) else len(text)
            pairs.append((q_end, a_start, a_end, next_start))
            i += 2
        else:
            i += 1

    # 至少 2 对才走 QA 路径，否则交给 caller 退化（避免误识别普通文章）
    if len(pairs) < 2:
        return []

    chunks: list[str] = []
    for q_s, q_e, a_s, a_e in pairs:
        question = text[q_s:q_e].strip()
        answer = text[a_s:a_e].strip()
        if not question or not answer:
            continue
        combined = f"{question}\n\n{answer}"
        if _token_len(combined, encoding) <= chunk_size_tokens:
            chunks.append(combined)
            continue
        # 单对超限：按 token 切 answer，保留 question 在每片头部
        # 关键不变量：每片 chunk 的 token 数 <= chunk_size_tokens（防 embedding API 拒）
        # 边界：question 自己已经接近或超过 chunk_size_tokens —— 没法把
        # question 完整放进每片。这种情况退化到对 combined 整体硬切（接受
        # question 被切碎；后续召回时仍能用文档级 max 聚合命中）。
        q_tokens = _token_len(question, encoding)
        # 预留 2 tokens 给两个换行符。budget 严格小于 chunk_size_tokens - q_tokens
        # 才能保证 question + budget + 换行 <= chunk_size_tokens。
        budget = chunk_size_tokens - q_tokens - 2
        if budget < 16:
            # question 自身太长（占了几乎所有预算或更多）—— 没法保留 question 在
            # 每片头部，回退到整体硬切，让 _slice_by_tokens 严格按 token 切。
            for piece in _slice_by_tokens(combined, chunk_size_tokens, encoding):
                chunks.append(piece.strip())
            continue
        for piece in _slice_by_tokens(answer, budget, encoding):
            chunks.append(f"{question}\n\n{piece.strip()}")
    return chunks


def _split_parent_child(
    text: str,
    child_size_tokens: int,
    encoding,
    parent_size_multiplier: int = 4,
) -> list[Chunk]:
    """父子段切片。

    算法：
      1. 用 _split_recursive 切出 parent chunks，size = child × multiplier
         （默认 4 → 256 child / 1024 parent）
      2. 对每个 parent，再用 _split_recursive 切出 child chunks（size = child）
      3. 每个 child 记录其所属 parent_text；最终返回 [Chunk(parent_text=...)]

    返回 ``list[Chunk]``（直接构造好 dataclass，不再走 caller 的统一构造路径，
    因为只有这条策略需要写 parent_text 字段）。caller 的 _apply_overlap 不
    适用于 parent_child（child 跨 parent 时 overlap 语义混乱）。

    边界：
      - 空文本 → 返回空列表
      - 短文档（< parent_size）→ 1 个 parent，N 个 children 共享 parent_text
      - parent 与 child 之间不应用 overlap（child 承担精排，没必要再 overlap）
    """
    if not text or not text.strip():
        return []

    parent_size = max(child_size_tokens * parent_size_multiplier, child_size_tokens + 1)

    parent_chunks = _split_recursive(text, parent_size, encoding)
    if not parent_chunks:
        return []

    children: list[Chunk] = []
    chunk_index = 0
    for parent_text in parent_chunks:
        child_chunks = _split_recursive(parent_text, child_size_tokens, encoding)
        if not child_chunks:
            # parent 本身已经够小（递归切片不再细分）→ 直接当 child
            child_chunks = [parent_text]
        for child_text in child_chunks:
            children.append(
                Chunk(
                    index=chunk_index,
                    text=child_text,
                    tokens=_token_len(child_text, encoding),
                    parent_text=parent_text,
                )
            )
            chunk_index += 1
    return children


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
        overlapped = _apply_overlap(raw_chunks, chunk_overlap_tokens, encoding)
    elif kind in ("recursive", "markdown"):
        raw_chunks = _split_recursive(text, chunk_size_tokens, encoding)
        overlapped = _apply_overlap(raw_chunks, chunk_overlap_tokens, encoding)
    elif kind == "qa":
        # QA 模式：每对问答一个 chunk，独立语义单元不需要 overlap
        raw_chunks = _split_qa(text, chunk_size_tokens, encoding)
        if not raw_chunks:
            # 未识别到至少 2 对 Q/A → 退化到 recursive，避免普通文章被误切
            raw_chunks = _split_recursive(text, chunk_size_tokens, encoding)
            overlapped = _apply_overlap(raw_chunks, chunk_overlap_tokens, encoding)
        else:
            overlapped = raw_chunks
    elif kind == "parent_child":
        # parent_child 直接返回 list[Chunk]（包含 parent_text 字段），
        # 走独立路径，不经过 _apply_overlap / 统一构造。
        # chunk_size_tokens 在此策略下解释为 child 大小；parent = child × 4
        # （硬编码 multiplier，未来如要参数化再加 search_profiles 列）。
        return _split_parent_child(text, chunk_size_tokens, encoding)
    else:
        # 未知策略：保守按 recursive 处理，但日志层会有 warning。
        raw_chunks = _split_recursive(text, chunk_size_tokens, encoding)
        overlapped = _apply_overlap(raw_chunks, chunk_overlap_tokens, encoding)

    if not overlapped:
        return []

    return [
        Chunk(index=i, text=t, tokens=_token_len(t, encoding))
        for i, t in enumerate(overlapped)
    ]
