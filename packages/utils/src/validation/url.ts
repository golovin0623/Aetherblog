/**
 * URL 校验
 */

const URL_REGEX = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/;

// SECURITY (VULN-090): previous isValidUrl accepted any string that ``new
// URL()`` could parse — including ``javascript:alert(1)``, ``data:text/html,...``
// and ``vbscript:...``. Callers used the boolean to gate user-pasted links
// into <a href>, amounting to an XSS rubber stamp. Restrict to http/https; all
// other schemes fall through to the legacy-regex path, which only matches
// typical domain names.
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
