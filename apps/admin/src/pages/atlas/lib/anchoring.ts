// Atlas P1-07 — 坚固的锚固
//
// 把已保存的 W3C 选择器在新版本载体文本里重新定位。四档回退：
//   1. TextPositionSelector 精确位置（直接 substring 比对）
//   2. TextQuoteSelector.exact 在 prefix 邻域里搜
//   3. TextQuoteSelector.exact 全文滑窗 + 编辑距离最优匹配
//   4. 向量回退（Phase 3 接入；Phase 1 仅返回 orphan）
//
// 落地手册: docs/plan/task-aether-knowledge-system.md §3 Phase 1 task-knowledge-P1-07
// 决策依据: docs/plan/task-knowledge-decisions.md §Spike-1
//
// 注：本模块**不**依赖 npm 上的 `diff-match-patch`，使用自包含的 Levenshtein + 滑窗实现，
// 与 P0 spike 同一基线。Phase 1 末复测 A1-4 时若 < 90% 再切真 d-m-p。

import type {
  AtlasAnchorState,
  AtlasSelector,
  TextPositionSelector,
  TextQuoteSelector,
} from '@aetherblog/types';

export interface AnchorOutcome {
  state: AtlasAnchorState;
  score: number;
  start: number;
  end: number;
}

const SOFT_THRESHOLD = 0.85;
const HARD_THRESHOLD = 0.5;

const ORPHAN: AnchorOutcome = { state: 'orphan', score: 0, start: -1, end: -1 };

/**
 * 主入口：在 newText 中重新定位 selectors。
 * 假设 selectors 至少含 TextQuoteSelector + TextPositionSelector（W3C 红线 C1-1）。
 */
export function anchor(newText: string, selectors: AtlasSelector[]): AnchorOutcome {
  const quote = pick<TextQuoteSelector>(selectors, 'TextQuoteSelector');
  const position = pick<TextPositionSelector>(selectors, 'TextPositionSelector');
  if (!quote) return ORPHAN;

  // 档1：position 精确命中
  if (position) {
    const candidate = newText.slice(position.start, position.end);
    if (candidate === quote.exact) {
      return { state: 'anchored', score: 1.0, start: position.start, end: position.end };
    }
  }

  // 档2：prefix 邻域 + 长度匹配
  if (quote.prefix && quote.prefix.length >= 5) {
    const prefixIdx = newText.indexOf(quote.prefix);
    if (prefixIdx !== -1) {
      const candStart = prefixIdx + quote.prefix.length;
      const candEnd = candStart + quote.exact.length;
      const sim = similarity(newText.slice(candStart, candEnd), quote.exact);
      if (sim >= 1.0) return { state: 'anchored', score: sim, start: candStart, end: candEnd };
      if (sim >= SOFT_THRESHOLD)
        return { state: 'soft_anchored', score: sim, start: candStart, end: candEnd };
    }
  }

  // 档3：全文 exact substring（处理小幅文本删动情况）
  const exactIdx = newText.indexOf(quote.exact);
  if (exactIdx !== -1) {
    return {
      state: 'anchored',
      score: 1.0,
      start: exactIdx,
      end: exactIdx + quote.exact.length,
    };
  }

  // 档4：滑窗 + 编辑距离
  const best = slideWindow(newText, quote.exact);
  if (best.sim >= SOFT_THRESHOLD)
    return { state: 'soft_anchored', score: best.sim, start: best.pos, end: best.pos + quote.exact.length };
  if (best.sim >= HARD_THRESHOLD)
    return { state: 'orphan', score: best.sim, start: best.pos, end: best.pos + quote.exact.length };

  return ORPHAN;
}

function pick<T extends AtlasSelector>(arr: AtlasSelector[], type: T['type']): T | null {
  for (const s of arr) if (s.type === type) return s as T;
  return null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - dist / maxLen;
}

function slideWindow(text: string, target: string): { sim: number; pos: number } {
  const winLen = target.length;
  if (winLen === 0 || text.length < winLen) return { sim: 0, pos: -1 };
  const step = Math.max(1, Math.floor(winLen / 8));
  let bestSim = 0;
  let bestPos = -1;
  for (let i = 0; i + winLen <= text.length; i += step) {
    const slice = text.slice(i, i + winLen);
    const sim = similarity(slice, target);
    if (sim > bestSim) {
      bestSim = sim;
      bestPos = i;
    }
  }
  return { sim: bestSim, pos: bestPos };
}
