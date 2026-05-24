import { MetadataRoute } from 'next';
import { getSiteSettings } from './lib/services';
import { getPreferredSiteIconUrl, getSiteIconMimeType } from './lib/siteIcon';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await getSiteSettings();
  const iconUrl = getPreferredSiteIconUrl(settings);

  return {
    name: settings.siteTitle || 'AetherBlog',
    short_name: settings.siteTitle || 'Blog',
    description: settings.siteDescription || 'AetherBlog - 智能博客系统',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    scope: '/',
    background_color: '#09090b',
    theme_color: '#09090b',
    icons: iconUrl
      ? [
          {
            src: iconUrl,
            sizes: 'any',
            type: getSiteIconMimeType(iconUrl),
          },
        ]
      : [],
  };
}
