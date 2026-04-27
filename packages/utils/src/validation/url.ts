/**
 * URL 校验
 */

const URL_REGEX = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/;

// 安全（VULN-090）：旧的 isValidUrl 接受任何 ``new URL()`` 能解析的
// 字符串 —— 包括 ``javascript:alert(1)``、``data:text/html,...``
// 和 ``vbscript:...``。调用方用此布尔值放行用户粘贴链接到 <a href>，
// 等同于 XSS 橡皮图章。限制为 http/https；其他协议退到旧正则路径，
// 后者仅匹配典型域名。
export function isValidUrl(url: string): boolean {
  if (typeof url !== 'string' || !url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return URL_REGEX.test(url);
  }
}

export function validateUrl(url: string): { valid: boolean; message: string } {
  if (!url) {
    return { valid: false, message: 'URL不能为空' };
  }
  if (!isValidUrl(url)) {
    return { valid: false, message: 'URL格式不正确' };
  }
  return { valid: true, message: '' };
}

export function isHttps(url: string): boolean {
  return url.startsWith('https://');
}

export function ensureHttps(url: string): string {
  if (url.startsWith('https://')) return url;
  if (url.startsWith('http://')) return url.replace('http://', 'https://');
  return `https://${url}`;
}
