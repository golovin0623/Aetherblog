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
