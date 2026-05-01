import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 合并 Tailwind CSS 类名
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 格式化数字（千分位）
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('zh-CN').format(num);
}

/**
 * 格式化日期
 */
export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('zh-CN');
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 文章摘要 textarea 的统一 placeholder 文案。
 *
 * 真实链路：
 *   - DB `posts.summary` VARCHAR(2000) → 后端 DTO `max=2000`
 *     → admin textarea `maxLength=2000`（统一上限）
 *   - 前台 `ArticleCard.tsx` 把 summary 截断到 140 字符显示（卡片宽度有限）
 *   - 前台 `FeaturedPost.tsx` 在 summary 为空时回退到 `contentPreview.slice(0, 500)`
 *
 * 文案要让用户同时知道"建议长度 / 最大上限 / 卡片实际展示长度"，避免
 * 多处 placeholder 重复且数字漂移。修改请联动检查 ArticleCard/FeaturedPost。
 */
export const POST_SUMMARY_PLACEHOLDER =
  '建议 200 字以内，最多 2000 字。卡片列表展示约 140 字，留空则在卡片中不显示摘要。';

/**
 * 防抖函数
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}
