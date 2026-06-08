import type { MetadataRoute } from 'next';
import { getSiteSettings } from './lib/services';

// 动态 robots.txt：在此文件之前后台「SEO → Robots.txt 内容 / 启用 Sitemap」是纯架子。
// 这里据 site_url 生成 host 与 sitemap 引用；并尊重 seo_robots 中的「全站禁止抓取」意图。
export const revalidate = 3600;

function resolveBaseUrl(siteUrl: unknown): string {
  const raw = typeof siteUrl === 'string' ? siteUrl.trim() : '';
  const fallback = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return (raw || fallback).replace(/\/+$/, '');
}

export default async function robots(): Promise<MetadataRoute.Robots> {
  const settings = await getSiteSettings();
  const base = resolveBaseUrl(settings.siteUrl);
  const sitemapEnabled = settings.enable_sitemap !== 'false' && settings.enable_sitemap !== false;

  // 轻量尊重 seo_robots：若自定义内容声明了全站 Disallow: / 且未声明 Allow:/，按禁止全站处理
  // （常见于预发布/未上线场景）。完整 robots 语法不在此解析。
  const seoRobots = typeof settings.seo_robots === 'string' ? settings.seo_robots : '';
  const blockAll = /disallow:\s*\/\s*(\n|$)/i.test(seoRobots) && !/allow:\s*\//i.test(seoRobots);

  return {
    rules: blockAll
      ? { userAgent: '*', disallow: '/' }
      : { userAgent: '*', allow: '/', disallow: ['/agent/', '/agent'] },
    sitemap: sitemapEnabled ? `${base}/sitemap.xml` : undefined,
    host: base,
  };
}
