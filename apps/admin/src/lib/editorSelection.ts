/**
 * 编辑器选区落笔的纯函数工具(与 React / CodeMirror 解耦,便于单测)。
 *
 * 背景:AI 选区工具是「先请求、后落笔」的异步流程,请求期间用户可能继续编辑
 * (撤销、插入 AI 回复、手输),原始 `{from,to}` 偏移可能已失效。落笔前必须
 * 重新定位,且**不能**退回 `indexOf` 首个匹配 —— 那正是本 PR 要修的老 bug。
 */

export interface DocRange {
  from: number;
  to: number;
}

export type RelocateResult =
  | { kind: 'ok'; range: DocRange }
  | { kind: 'not-found' }
  /** 多处等距匹配,无法判定用户当初选的是哪一处 —— 拒绝落笔好过改错地方。 */
  | { kind: 'ambiguous' };

/**
 * 在最新文档中重新定位一段原文。
 *
 * 规则:
 * 1. 原偏移仍精确命中 → 直接用(绝大多数情况,零歧义)。
 * 2. 否则枚举全部匹配,取**距离原选区最近**的一处 —— 文档只是前后有增删时,
 *    最近匹配就是用户当初选的那段。
 * 3. 若最近距离出现并列(前后等距各一处) → 判定歧义,拒绝落笔。
 */
export function relocateOriginal(doc: string, original: string, hint: DocRange): RelocateResult {
  if (!original) return { kind: 'not-found' };

  if (doc.slice(hint.from, hint.to) === original) {
    return { kind: 'ok', range: { from: hint.from, to: hint.to } };
  }

  const matches: number[] = [];
  for (let index = doc.indexOf(original); index !== -1; index = doc.indexOf(original, index + 1)) {
    matches.push(index);
    if (matches.length > 512) break; // 病态输入(如单字符原文)的护栏
  }
  if (matches.length === 0) return { kind: 'not-found' };
  if (matches.length === 1) {
    return { kind: 'ok', range: { from: matches[0], to: matches[0] + original.length } };
  }

  let best = matches[0];
  let bestDistance = Math.abs(best - hint.from);
  let tied = false;
  for (const candidate of matches.slice(1)) {
    const distance = Math.abs(candidate - hint.from);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance) {
      tied = true;
    }
  }
  if (tied) return { kind: 'ambiguous' };

  return { kind: 'ok', range: { from: best, to: best + original.length } };
}

/**
 * 计算把一段块级 Markdown 插入到 `at` 位置所需的前后分隔符。
 *
 * AI 回复几乎总是块级内容(标题 / 列表 / 引用)。在段落中间裸插会让 `## ` `- `
 * `> ` 这类行级语法因不在行首而失效,并与原段落粘连。
 */
export function padBlockInsert(doc: string, at: number, text: string): string {
  const before = doc.slice(0, at);
  const after = doc.slice(at);

  // 文首、或前面已是空行 → 无需补前置分隔
  const trailingBreaks = /(\n[ \t]*)*$/.exec(before)?.[0] ?? '';
  const beforeNewlines = before.length === 0 ? 2 : (trailingBreaks.match(/\n/g) ?? []).length;
  const leading = '\n'.repeat(Math.max(0, 2 - beforeNewlines));

  const leadingBreaks = /^([ \t]*\n)*/.exec(after)?.[0] ?? '';
  const afterNewlines = after.length === 0 ? 2 : (leadingBreaks.match(/\n/g) ?? []).length;
  const trailing = '\n'.repeat(Math.max(0, 2 - afterNewlines));

  return `${leading}${text}${trailing}`;
}
