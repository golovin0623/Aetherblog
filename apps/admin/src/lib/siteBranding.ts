import { resolveSiteAssetUrl } from '@aetherblog/utils';

export const DEFAULT_SITE_NAME = 'AetherBlog';

export interface SiteBrandingSource {
  site_name?: unknown;
  siteName?: unknown;
  siteTitle?: unknown;
  site_description?: unknown;
  siteDescription?: unknown;
  site_logo?: unknown;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveSiteName(siteInfo?: SiteBrandingSource | null): string {
  return (
    cleanString(siteInfo?.site_name) ||
    cleanString(siteInfo?.siteName) ||
    cleanString(siteInfo?.siteTitle) ||
    DEFAULT_SITE_NAME
  );
}

export function resolveSiteDescription(siteInfo?: SiteBrandingSource | null): string {
  return (
    cleanString(siteInfo?.site_description) ||
    cleanString(siteInfo?.siteDescription)
  );
}

export function resolveSiteLogo(siteInfo?: SiteBrandingSource | null): string {
  const logo = siteInfo?.site_logo;
  return typeof logo === 'string' && logo.trim() ? resolveSiteAssetUrl(logo) : '';
}
