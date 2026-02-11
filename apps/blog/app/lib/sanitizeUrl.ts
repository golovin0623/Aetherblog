/**
 * @file sanitizeUrl.ts
 * @description URL 安全验证工具 - 防止 XSS 攻击
 * @ref Issue #131
 * @author AI Assistant
 * @created 2026-02-12
 */

/**
 * 验证并清理图片 URL，仅允许安全协议
 * 防止通过 javascript: 等协议注入恶意代码
 *
 * @param url 待验证的 URL
 * @param fallback 验证失败时的回退 URL
 * @returns 安全的 URL 或 fallback
 */
export function sanitizeImageUrl(url: string | undefined | null, fallback: string): string {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return fallback;
  }

  try {
    const parsed = new URL(url);
    if (['http:', 'https:', 'data:'].includes(parsed.protocol)) {
      return url;
    }
  } catch {
    // 相对路径也是安全的 (如 /uploads/xxx.png)
    if (url.startsWith('/')) {
      return url;
    }
  }

  return fallback;
}
