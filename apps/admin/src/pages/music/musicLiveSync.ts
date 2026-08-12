/**
 * 歌词实时打点校时辅助逻辑 (Tap-to-Sync & Timestamp Shifter)
 */

export function formatTimeTag(seconds: number): string {
  const totalHundredths = Math.round(seconds * 100);
  const mins = Math.floor(totalHundredths / 6000);
  const secs = Math.floor((totalHundredths % 6000) / 100);
  const hundredths = totalHundredths % 100;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const xx = String(hundredths).padStart(2, '0');
  return `[${mm}:${ss}.${xx}]`;
}

/**
 * 将某一行歌词打上指定时间戳（若已有时间戳则替换，若无则前置插入）
 */
export function syncLineWithTimestamp(line: string, currentSeconds: number): string {
  const trimmed = line.trim();
  const timeTag = formatTimeTag(currentSeconds);
  const withoutExistingTag = trimmed.replace(/^\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*/, '');
  return `${timeTag} ${withoutExistingTag}`;
}

/**
 * 提取歌词文本中所有非元数据、非空歌词行
 */
export function getCleanLyricLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\[(ar|ti|al|by|offset|re|ve):/i.test(l));
}
