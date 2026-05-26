// Atlas P1-05 — W3C 多选择器构建器
//
// 从 DOM Range / 文档文本 / 字符偏移生成 W3C WADM 选择器组合。
// 落地手册: docs/plan/task-aether-knowledge-system.md §3 Phase 1 task-knowledge-P1-05
//
// 红线 C1-1: 任何调用方持久化标注前，必须保证 selectors 至少 3 个（TextQuote +
// TextPosition + 载体专属一个）。本模块的 buildSelectorsFromTextRange 默认返回
// 3 个；buildSelectorsFromDomRange 默认返回 3-4 个（含 CssSelector）。

import type {
  AtlasSelector,
  CssSelector,
  TextPositionSelector,
  TextQuoteSelector,
} from '@aetherblog/types';

const DEFAULT_CTX = 30;

/**
 * 从纯文本 + 字符偏移构建 W3C 多选择器（适合 Markdown 阅读视图）。
 * 始终返回 TextQuote + TextPosition 两个（满足 C1-1 的最小骨架），
 * 调用方负责再拼 1 个载体专属 selector（CssSelector / PageRect / FragmentSelector）。
 */
export function buildSelectorsFromTextRange(
  fullText: string,
  start: number,
  end: number,
  ctxSize: number = DEFAULT_CTX
): {
  exact: string;
  selectors: [TextQuoteSelector, TextPositionSelector];
} {
  const safeStart = Math.max(0, Math.min(start, fullText.length));
  const safeEnd = Math.max(safeStart, Math.min(end, fullText.length));

  const exact = fullText.slice(safeStart, safeEnd);
  const prefix = fullText.slice(Math.max(0, safeStart - ctxSize), safeStart);
  const suffix = fullText.slice(safeEnd, Math.min(fullText.length, safeEnd + ctxSize));

  return {
    exact,
    selectors: [
      { type: 'TextQuoteSelector', exact, prefix, suffix },
      { type: 'TextPositionSelector', start: safeStart, end: safeEnd },
    ],
  };
}

/**
 * 从 DOM Range 构建多选择器。
 * 默认输出 3 个: TextQuote + TextPosition + CssSelector。
 *
 * containerSelector 用来在 W3C 选择器之外保留"在哪个 DOM 节点选区"的信息——
 * 它是相对于阅读视图根元素的路径，用作锚定回退时的结构性提示。
 */
export function buildSelectorsFromDomRange(
  range: Range,
  rootText: string,
  rootElement: HTMLElement
): {
  exact: string;
  selectors: AtlasSelector[];
} | null {
  if (range.collapsed) return null;
  const text = range.toString();
  if (!text) return null;

  const startOffset = absoluteCharOffset(rootElement, range.startContainer, range.startOffset);
  const endOffset = startOffset + text.length;

  // 校验：在 rootText 中能否还原同一段文本
  if (rootText.slice(startOffset, endOffset) !== text) {
    // DOM 中的文本与提供的 rootText 已不一致——拒绝构造（手册红线: 不允许返回单选择器）。
    return null;
  }

  const base = buildSelectorsFromTextRange(rootText, startOffset, endOffset);

  const containerCss = buildCssSelectorPath(range.startContainer.parentElement, rootElement);
  const cssSel: CssSelector | null = containerCss
    ? { type: 'CssSelector', value: containerCss }
    : null;

  const selectors: AtlasSelector[] = [...base.selectors];
  if (cssSel) selectors.push(cssSel);

  return { exact: base.exact, selectors };
}

/**
 * 计算 DOM 节点边界（node, offsetInNode）在 root 内的累计字符偏移。
 *
 * PR #724 review fix (Gemini medium): 过去只处理 Node.TEXT_NODE，遇到 Element 容器
 *   （Range 边界落在元素边界或空元素时）直接返回 0，导致定位错位。
 *
 * 这里改用 DOM Range API：构造一个从 (root,0) 到 (node, offsetInNode) 的临时 Range，
 * 其 .toString().length 即是 root 起点到该边界的字符数（Range.toString() 自动剔除
 * Element/Comment 节点，仅累加 Text 内容），同时正确处理：
 *   - Text 节点（offsetInNode = 字符位置）
 *   - Element 节点（offsetInNode = 子节点索引；Range 自动汇总到该子节点之前的所有 Text）
 *
 * 失败 fallback 为 0（原行为）。
 */
function absoluteCharOffset(root: HTMLElement, node: Node, offsetInNode: number): number {
  if (!root.contains(node) && node !== root) return 0;
  try {
    const r = document.createRange();
    r.setStart(root, 0);
    r.setEnd(node, offsetInNode);
    const text = r.toString();
    r.detach?.(); // detach 是历史 API，部分浏览器无害忽略
    return text.length;
  } catch {
    // 罕见：node 是从外部克隆的节点 / root 与 node 不在同一文档
    return 0;
  }
}

/**
 * 构造 element → root 的最短 CSS 路径（nth-of-type）。
 * 不强追求唯一性，命中 DOM 重排是常态——只是给锚定回退多一个提示。
 */
function buildCssSelectorPath(el: Element | null, root: HTMLElement): string | null {
  if (!el || !root.contains(el)) return null;
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== root) {
    const tag = cur.tagName.toLowerCase();
    const parentEl: HTMLElement | null = cur.parentElement;
    if (!parentEl) break;
    let idx = 1;
    let sibling = cur.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === cur.tagName) idx += 1;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${tag}:nth-of-type(${idx})`);
    cur = parentEl;
  }
  return parts.length ? parts.join(' > ') : null;
}

/**
 * 红线 C1-1 校验：selectors 数组至少 3 项且类型分布合理。
 * 服务端也会做同样校验（JSONB array_length ≥ 1 + service 层 ≥ 3）。
 */
export function validateSelectors(selectors: AtlasSelector[]): {
  ok: boolean;
  reason?: string;
} {
  if (!Array.isArray(selectors) || selectors.length < 3) {
    return { ok: false, reason: '至少需要 3 个 selector (W3C 红线 C1-1)' };
  }
  const kinds = new Set(selectors.map((s) => s.type));
  if (!kinds.has('TextQuoteSelector') || !kinds.has('TextPositionSelector')) {
    return { ok: false, reason: 'TextQuote + TextPosition 双选择器为最低要求' };
  }
  return { ok: true };
}
