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
 * Pre-compute heading IDs for an entire markdown document.
 * Returns a Map from 1-based source line number → stable deduplicated id.
 *
 * Using line numbers as keys allows each heading <hN> component to look up
 * its own ID via node.position.start.line — NO shared mutable counter needed,
 * making IDs fully deterministic even under concurrent React renders.
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

    // Strip inline markdown (same as cleanMarkdownHeading)
    const rawText = headingMatch[2]
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[~*_]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (rawText) {
      // line numbers are 1-based in the AST
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
