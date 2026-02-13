import { logger } from './logger';

type AdminLinkStatus = 'ready' | 'missing' | 'invalid';

interface AdminLinkConfig {
  status: AdminLinkStatus;
  baseUrl: string | null;
  reason: string;
}

function normalizePathname(pathname: string): string {
  const normalized = `/${pathname.replace(/^\/+/, '')}`.replace(/\/+$/, '');
  return normalized || '/';
}

function normalizeBaseUrl(rawValue: string): string | null {
  if (rawValue.startsWith('/')) {
    return normalizePathname(rawValue);
  }

  try {
    const parsed = new URL(rawValue);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    parsed.search = '';
    parsed.hash = '';
    parsed.pathname = normalizePathname(parsed.pathname);
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveAdminLinkConfig(): AdminLinkConfig {
  const rawValue = process.env.NEXT_PUBLIC_ADMIN_URL?.trim() ?? '';
  if (!rawValue) {
    return {
      status: 'missing',
      baseUrl: null,
      reason: 'NEXT_PUBLIC_ADMIN_URL 未配置，已隐藏管理后台入口。',
    };
  }

  const normalized = normalizeBaseUrl(rawValue);
  if (!normalized) {
    return {
      status: 'invalid',
      baseUrl: null,
      reason: `NEXT_PUBLIC_ADMIN_URL 非法，仅允许 http(s) 或 /admin 路径：${rawValue}`,
    };
  }

  return {
    status: 'ready',
    baseUrl: normalized,
    reason: '',
  };
}

function appendPath(baseUrl: string, path: string): string {
  const targetPath = path.startsWith('/') ? path : `/${path}`;

  if (baseUrl.startsWith('/')) {
    const normalizedBase = baseUrl === '/' ? '' : baseUrl.replace(/\/+$/, '');
    return `${normalizedBase}${targetPath}` || '/';
  }

  const parsed = new URL(baseUrl);
  const normalizedBasePath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = `${normalizedBasePath}${targetPath}` || '/';
  return parsed.toString();
}

const adminLinkConfig = resolveAdminLinkConfig();
let issueReported = false;

export function getAdminLinkConfig(): AdminLinkConfig {
  return adminLinkConfig;
}

export function buildAdminUrl(path = '/'): string | null {
  if (adminLinkConfig.status !== 'ready' || !adminLinkConfig.baseUrl) {
    return null;
  }

  return appendPath(adminLinkConfig.baseUrl, path);
}

export function buildAdminPostEditUrl(postId: number | string): string | null {
  const normalizedId = String(postId).trim();
  if (!normalizedId) {
    return null;
  }

  return buildAdminUrl(`/posts/${encodeURIComponent(normalizedId)}/edit`);
}

export function reportAdminLinkIssueOnce(): void {
  if (issueReported || adminLinkConfig.status === 'ready') {
    return;
  }

  issueReported = true;
  logger.warn(`[admin-link] ${adminLinkConfig.reason}`);
}
