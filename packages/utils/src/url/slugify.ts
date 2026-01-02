/**
 * Slug 生成
 */

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')     // 空格转换为连字符
    .replace(/[^\w\u4e00-\u9fa5-]/g, '') // 移除非字母、数字、中文、连字符
    .replace(/--+/g, '-')     // 多个连字符合并
    .replace(/^-+|-+$/g, ''); // 移除首尾连字符
}

export function generateSlug(title: string, suffix?: string): string {
  const base = slugify(title);
  return suffix ? `${base}-${suffix}` : base;
}
