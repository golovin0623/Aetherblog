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
  // 允许 http 与 https 协议
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  // 安全性（VULN-079）：禁止协议相对 URL（`//evil.com`）。它们会
  // 继承当前页面的协议并悄悄跳转到任意主机 —— 实际上等于
  // 一个 open-redirect，视觉上又跟"相对链接"无异。如果调用方
  // 确实需要 `//cdn.example.com`，必须显式写出协议
  // （`https://cdn.example.com`）。
  if (trimmed.startsWith('//')) {
    return fallback;
  }
  // 允许同源相对路径（`/foo`）—— 它们无法越过 origin。
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }
  // 规范化裸域名（例如 "example.com"）—— 自动加上 https://，
  // 同时拦截 javascript:、data:、vbscript: 等危险协议
  if (/^[a-zA-Z0-9]/.test(trimmed) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(trimmed)) {
    return 'https://' + trimmed;
  }
  return fallback;
}
