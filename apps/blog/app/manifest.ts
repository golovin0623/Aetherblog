import { MetadataRoute } from 'next';
import { getSiteSettings } from './lib/services';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await getSiteSettings();
  const avatarUrl = settings.authorAvatar || settings.author_avatar;

  return {
    name: settings.siteTitle || 'AetherBlog',
    short_name: settings.siteTitle || 'Blog',
    description: settings.siteDescription || 'AetherBlog - 智能博客系统',
    start_url: '/',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#09090b',
    icons: avatarUrl
      ? [
          {
            src: avatarUrl,
            sizes: 'any',
            type: 'image/png',
          },
        ]
      : [],
  };
}
