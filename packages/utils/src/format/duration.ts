/**
 * 时长格式化工具
 */

/**
 * 格式化毫秒为可读时长
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}天 ${hours % 24}小时`;
  }
  if (hours > 0) {
    return `${hours}小时 ${minutes % 60}分钟`;
  }
  if (minutes > 0) {
    return `${minutes}分钟 ${seconds % 60}秒`;
  }
  return `${seconds}秒`;
}

/**
 * 格式化秒数为时:分:秒
 */
export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 估算阅读时间
 */
export function estimateReadingTime(text: string, wordsPerMinute = 200): number {
  // 中文按字数计算，英文按词数
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = text.replace(/[\u4e00-\u9fa5]/g, '').split(/\s+/).filter(Boolean).length;
  
  // 中文阅读速度约400字/分钟，英文约200词/分钟
  const chineseMinutes = chineseChars / 400;
  const englishMinutes = englishWords / wordsPerMinute;
  
  return Math.ceil(chineseMinutes + englishMinutes) || 1;
}
