export interface SiteBrandingSettings {
  site_favicon?: unknown;
  authorAvatar?: unknown;
  author_avatar?: unknown;
  site_logo?: unknown;
}

export function resolveSiteAssetUrl(value: unknown): string {
  if (typeof value !== 'string') return '';

  const url = value.trim();
  if (!url) return '';

  if (url.startsWith('/uploads')) {
    return `/api${url}`;
  }

  return url;
}

export function getPreferredSiteIconUrl(settings?: SiteBrandingSettings | null): string {
  if (!settings) return '';

  return (
    resolveSiteAssetUrl(settings.site_favicon) ||
    resolveSiteAssetUrl(settings.authorAvatar) ||
    resolveSiteAssetUrl(settings.author_avatar) ||
    resolveSiteAssetUrl(settings.site_logo)
  );
}

export function getSiteIconMimeType(iconUrl: string): string | undefined {
  const dataUriMime = iconUrl.match(/^data:([^;,]+)[;,]/i)?.[1];
  if (dataUriMime) return dataUriMime;

  const pathname = iconUrl.split(/[?#]/, 1)[0].toLowerCase();

  if (pathname.endsWith('.svg')) return 'image/svg+xml';
  if (pathname.endsWith('.ico')) return 'image/x-icon';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.webp')) return 'image/webp';

  return undefined;
}
