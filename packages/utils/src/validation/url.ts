/**
 * URL 校验
 */

const URL_REGEX = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/;

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
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
