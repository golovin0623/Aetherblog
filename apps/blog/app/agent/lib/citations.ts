/**
 * 内联引用标记链接化 —— 把回答正文中的 `[1]` / `【2】` 数字标记转成指向
 * 检索回执命中条目的锚点链接（`#cite-{messageId}-{rank}`）。
 *
 * 只在该消息带 retrieval 回执且 rank 落在命中范围内时才转换；代码块与行内
 * 代码内的文本绝不改写（`arr[0]` 这类下标不是引用）。转换产物是纯 Markdown
 * 链接 —— 流式轻渲染（react-markdown）与完成态 MarkdownRenderer 都天然支持，
 * 样式由 `.agent-md a[href^="#cite-"]` 的 CSS 挂上上标胶囊形态。
 */

function transformOutsideCode(text: string, fn: (segment: string) => string): string {
  // 先按围栏代码块切分（奇数段是 ``` 围栏内部，原样保留；未闭合围栏一直到结尾）。
  const parts = text.split(/(```[\s\S]*?(?:```|$))/);
  return parts
    .map((part) => {
      if (part.startsWith('```')) return part;
      // 再保护行内代码 span。
      const sub = part.split(/(`[^`\n]*`)/);
      return sub.map((s) => (s.startsWith('`') ? s : fn(s))).join('');
    })
    .join('');
}

export function linkifyCitations(
  markdown: string,
  messageId: string,
  maxRank: number,
): string {
  if (!markdown || maxRank <= 0) return markdown;
  const replaceIn = (segment: string): string =>
    segment
      .replace(/\[(\d{1,2})\]/g, (match, numStr: string, offset: number, whole: string) => {
        if (whole[offset - 1] === '!') return match; // 图片语法 ![1](…)
        const after = whole[offset + match.length];
        if (after === '(' || after === ':' || after === '[') return match; // 真链接 / 定义 / 引用式
        const n = Number(numStr);
        if (n < 1 || n > maxRank) return match;
        return `[${n}](#cite-${messageId}-${n})`;
      })
      .replace(/【(\d{1,2})】/g, (match, numStr: string) => {
        const n = Number(numStr);
        if (n < 1 || n > maxRank) return match;
        return `[${n}](#cite-${messageId}-${n})`;
      });
  return transformOutsideCode(markdown, replaceIn);
}

/** 从 `#cite-{messageId}-{rank}` 锚点里取 rank；不合法返回 null。 */
export function parseCitationRank(href: string): number | null {
  const m = /^#cite-.+-(\d{1,2})$/.exec(href);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}
