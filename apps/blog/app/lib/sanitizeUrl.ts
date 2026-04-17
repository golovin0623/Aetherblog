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

  // 处理可能的双重斜杠 (如 //example.com/image.png)
  if (url.startsWith('//')) {
    url = 'https:' + url;
  }

  try {
    const parsed = new URL(url);
    if (['http:', 'https:'].includes(parsed.protocol)) {
      return url;
    }
    if (parsed.protocol === 'data:' && url.startsWith('data:image/')) {
      return url;
    }
  } catch {
    // 相对路径也是安全的 (如 /uploads/xxx.png 或 /api/uploads/xxx.png)
    if (url.startsWith('/')) {
      return url;
    }
    // 处理上传路径（如果缺失前导斜杠）
    if (url.startsWith('uploads/')) {
      return '/' + url;
    }
  }

  return fallback;
}

/**
 * 验证并清理通用链接 URL，仅允许安全协议
 * 防止通过 javascript: 等协议注入 XSS 攻击
 *
 * @param url 待验证的 URL
 * @param fallback 验证失败时的回退 URL
 * @returns 安全的 URL 或 fallback
 */
export function sanitizeUrl(url: string, fallback: string = '#'): string {
  if (!url || typeof url !== 'string') return fallback;
  const trimmed = url.trim();
  if (!trimmed) return fallback;
  // Allow http and https protocols
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  // SECURITY (VULN-079): disallow protocol-relative URLs (`//evil.com`). They
  // inherit the current page's scheme and silently redirect to an arbitrary
  // host — effectively an open-redirect with the same visual weight as a
  // "relative" link. If the caller really wants `//cdn.example.com`, they
  // must spell the scheme out (``https://cdn.example.com``).
  if (trimmed.startsWith('//')) {
    return fallback;
  }
  // Allow same-origin relative paths (``/foo``) — they can't escape origin.
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }
  // Normalize bare domains (e.g. "example.com") — prepend https://
  // but block dangerous protocols like javascript:, data:, vbscript:
  if (/^[a-zA-Z0-9]/.test(trimmed) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(trimmed)) {
    return 'https://' + trimmed;
  }
  return fallback;
}
