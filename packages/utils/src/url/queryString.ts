/**
 * 查询字符串处理
 */

export function parseQueryString(qs: string): Record<string, string> {
  if (!qs || qs === '?') return {};
  
  const query = qs.startsWith('?') ? qs.slice(1) : qs;
  const result: Record<string, string> = {};
  
  query.split('&').forEach((pair) => {
    const [key, value] = pair.split('=');
    if (key) {
      result[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }
  });
  
  return result;
}

export function stringifyQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const pairs: string[] = [];
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  });
  
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

export function updateQueryString(
  url: string,
  updates: Record<string, string | number | boolean | undefined>
): string {
  const [base, qs] = url.split('?');
  const params = parseQueryString(qs || '');
  Object.assign(params, updates);
  
  // Remove undefined values
  Object.keys(params).forEach((key) => {
    if (params[key] === undefined || params[key] === '') {
      delete params[key];
    }
  });
  
  return base + stringifyQueryString(params);
}
