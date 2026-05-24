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

export function getPreferredFaviconUrl(settings?: SiteBrandingSettings | null): string {
  if (!settings) return '';

  return (
    resolveSiteAssetUrl(settings.site_favicon) ||
    resolveSiteAssetUrl(settings.authorAvatar) ||
    resolveSiteAssetUrl(settings.author_avatar) ||
    resolveSiteAssetUrl(settings.site_logo)
  );
}
