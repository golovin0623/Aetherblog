import type { SiteSettings } from './services';

function resolveSiteIconUrl(value: unknown): string {
  if (typeof value !== 'string') return '';

  const url = value.trim();
  if (!url) return '';

  if (url.startsWith('/uploads')) {
    return `/api${url}`;
  }

  return url;
}

export function getPreferredSiteIconUrl(settings: SiteSettings): string {
  return (
    resolveSiteIconUrl(settings.site_favicon) ||
    resolveSiteIconUrl(settings.authorAvatar) ||
    resolveSiteIconUrl(settings.author_avatar) ||
    resolveSiteIconUrl(settings.site_logo)
  );
}

export function getSiteIconMimeType(iconUrl: string): string {
  const pathname = iconUrl.split(/[?#]/, 1)[0].toLowerCase();

  if (pathname.endsWith('.svg') || iconUrl.startsWith('data:image/svg+xml')) return 'image/svg+xml';
  if (pathname.endsWith('.ico')) return 'image/x-icon';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.webp')) return 'image/webp';

  return 'image/png';
}
