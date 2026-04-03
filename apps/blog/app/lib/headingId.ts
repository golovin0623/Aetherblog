export interface ParsedHeading {
  id: string;
  text: string;
  level: number;
  line: number;
}

export function normalizeHeadingText(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .trim()
    .replace(/[\u2000-\u206F\u2E00-\u2E7F'"!@#$%^&*()+=[\]{}|\\;:,.<>/?`~]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || 'section';
}

export function createHeadingIdFactory() {
  const usedHeadingIds = new Map<string, number>();

  return (rawText: string): string => {
    const baseId = normalizeHeadingText(rawText);
    const previousCount = usedHeadingIds.get(baseId) ?? 0;
    const nextCount = previousCount + 1;
    usedHeadingIds.set(baseId, nextCount);
    return nextCount === 1 ? baseId : `${baseId}-${nextCount}`;
  };
}

/**
 * 预计算整个 Markdown 文档的标题 ID。
 * 返回一个 Map，键为从 1 开始的源码行号，值为稳定且去重后的 ID。
 *
 * 以行号为键，使每个标题 <hN> 组件可通过 node.position.start.line 查找自身 ID，
 * 无需共享可变计数器，从而在并发 React 渲染下 ID 也完全确定。
 */
export function buildHeadingIdMap(content: string): Map<number, string> {
  const getHeadingId = createHeadingIdFactory();
  const map = new Map<number, string>();

  const lines = content.split('\n');
  let fenceChar: string | null = null;
  let fenceLength = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const matchedChar = fenceMatch[1][0];
      const matchedLength = fenceMatch[1].length;
      if (fenceChar === null) {
        fenceChar = matchedChar;
        fenceLength = matchedLength;
      } else if (matchedChar === fenceChar && matchedLength >= fenceLength) {
        fenceChar = null;
        fenceLength = 0;
      }
      continue;
    }
    if (fenceChar !== null) continue;

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (!headingMatch) continue;

    // 去除内联 Markdown 标记（与 cleanMarkdownHeading 逻辑相同）
    const rawText = headingMatch[2]
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[~*_]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (rawText) {
      // AST 中的行号从 1 开始
      map.set(i + 1, getHeadingId(rawText));
    }
  }

  return map;
}

function cleanMarkdownHeading(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[~*_]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractHeadingsFromMarkdown(content: string): ParsedHeading[] {
  const getHeadingId = createHeadingIdFactory();
  const lines = content.split('\n');
  const headings: ParsedHeading[] = [];

  let fenceChar: string | null = null;
  let fenceLength = 0;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);

    if (fenceMatch) {
      const matchedChar = fenceMatch[1][0];
      const matchedLength = fenceMatch[1].length;

      if (fenceChar === null) {
        fenceChar = matchedChar;
        fenceLength = matchedLength;
      } else if (matchedChar === fenceChar && matchedLength >= fenceLength) {
        fenceChar = null;
        fenceLength = 0;
      }

      return;
    }

    if (fenceChar !== null) {
      return;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (!headingMatch) {
      return;
    }

    const level = headingMatch[1].length;
    const text = cleanMarkdownHeading(headingMatch[2]);
    if (!text) {
      return;
    }

    headings.push({
      id: getHeadingId(text),
      text,
      level,
      line: index + 1,
    });
  });

  return headings;
}
