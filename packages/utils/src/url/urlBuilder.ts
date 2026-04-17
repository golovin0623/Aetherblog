/**
 * URL 构建器
 */

export class UrlBuilder {
  private baseUrl: string;
  private pathSegments: string[] = [];
  private queryParams: Record<string, string> = {};
  private hashFragment = '';

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  path(...segments: string[]): this {
    // SECURITY (VULN-089): 历史实现直接拼接未编码的 segment，允许 '..', '/',
    // 或任意字节触发 path traversal / SSRF-shaped payload。拒绝分段内含 '/'
    // 或 '..'，其余字符 encodeURIComponent 后再拼。
    segments.forEach((segment) => {
      const clean = segment.replace(/^\/|\/$/g, '');
      if (clean.includes('/') || clean === '..' || clean === '.') {
        throw new Error(`UrlBuilder.path: invalid segment ${JSON.stringify(segment)}`);
      }
      this.pathSegments.push(encodeURIComponent(clean));
    });
    return this;
  }

  query(key: string, value: string | number | boolean): this {
    this.queryParams[key] = String(value);
    return this;
  }

  queries(params: Record<string, string | number | boolean>): this {
    Object.entries(params).forEach(([key, value]) => {
      this.queryParams[key] = String(value);
    });
    return this;
  }

  hash(fragment: string): this {
    this.hashFragment = fragment.replace(/^#/, '');
    return this;
  }

  build(): string {
    let url = this.baseUrl;

    if (this.pathSegments.length > 0) {
      url += '/' + this.pathSegments.join('/');
    }

    const queryString = Object.entries(this.queryParams)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');

    if (queryString) {
      url += '?' + queryString;
    }

    if (this.hashFragment) {
      url += '#' + this.hashFragment;
    }

    return url;
  }

  toString(): string {
    return this.build();
  }
}

export function urlBuilder(baseUrl: string): UrlBuilder {
  return new UrlBuilder(baseUrl);
}
