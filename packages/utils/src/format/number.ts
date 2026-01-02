/**
 * 数字格式化工具
 */

/**
 * 格式化数字（千分位）
 */
export function formatNumber(num: number, locale = 'zh-CN'): string {
  return new Intl.NumberFormat(locale).format(num);
}

/**
 * 格式化货币
 */
export function formatCurrency(
  amount: number,
  currency = 'CNY',
  locale = 'zh-CN'
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount);
}

/**
 * 格式化百分比
 */
export function formatPercent(value: number, decimals = 2): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * 简化大数字（如: 1.2K, 3.5M）
 */
export function formatCompact(num: number): string {
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

/**
 * 补零
 */
export function padZero(num: number, length = 2): string {
  return String(num).padStart(length, '0');
}

/**
 * 限制数字范围
 */
export function clamp(num: number, min: number, max: number): number {
  return Math.min(Math.max(num, min), max);
}
