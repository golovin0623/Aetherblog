import type { MetadataRoute } from 'next';
import { getSiteSettings } from './lib/services';
import { API_ENDPOINTS } from './lib/api';
import { logger } from './lib/logger';

// 动态站点地图：在此文件之前后台「SEO → 启用 Sitemap」是纯架子（前后端都无 /sitemap.xml）。
// 这里依据 enable_sitemap 开关与 site_url（经 services 归一后的 siteUrl）生成真实 sitemap。
export const revalidate = 3600;

function resolveBaseUrl(siteUrl: unknown): string {
  const raw = typeof siteUrl === 'string' ? siteUrl.trim() : '';
  const fallback = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return (raw || fallback).replace(/\/+$/, '');
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const settings = await getSiteSettings();
  const base = resolveBaseUrl(settings.siteUrl);
  const enabled = settings.enable_sitemap !== 'false' && settings.enable_sitemap !== false;

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/posts`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/about`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/friends`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/timeline`, changeFrequency: 'weekly', priority: 0.5 },
  ];

  // 关闭 Sitemap 时仅暴露首页，不对外列举完整站点结构。
  if (!enabled) {
    return [staticRoutes[0]];
  }

  let posts: Array<{ slug?: string; publishedAt?: string }> = [];
  try {
    const res = await fetch(`${API_ENDPOINTS.posts}?pageNum=1&pageSize=1000`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = await res.json();
      posts = json.data?.list || [];
    }
  } catch (error) {
    // 拉取失败降级为仅静态路由，不阻断 sitemap 生成
    logger.warn('sitemap: failed to load posts, falling back to static routes', error);
  }

  const postRoutes: MetadataRoute.Sitemap = posts
    .filter((p): p is { slug: string; publishedAt?: string } => Boolean(p.slug))
    .map((p) => ({
      url: `${base}/posts/${p.slug}`,
      lastModified: p.publishedAt ? new Date(p.publishedAt) : undefined,
      changeFrequency: 'weekly',
      priority: 0.7,
    }));

  return [...staticRoutes, ...postRoutes];
}
