import { format, formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export function formatDate(date: Date | string, pattern = 'yyyy-MM-dd'): string {
  return format(new Date(date), pattern, { locale: zhCN });
}

export function formatRelativeTime(date: Date | string): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: zhCN });
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat('zh-CN').format(num);
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
