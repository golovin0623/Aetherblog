import type { MetadataRoute } from 'next';
import { getSiteSettings } from './lib/services';

// 动态 robots.txt：在此文件之前后台「SEO → Robots.txt 内容 / 启用 Sitemap」是纯架子。
// 这里忠实遵循后台自定义的 seo_robots 文本（按 User-agent 分组的 Allow/Disallow/Crawl-delay），
// 并据 site_url 注入 host 与 sitemap 引用。
export const revalidate = 3600;

// 与 Next 的 MetadataRoute.Robots 单条规则结构兼容的本地类型（userAgent 必填，解析时总会赋值）。
type RobotRule = {
  userAgent: string | string[];
  allow?: string | string[];
  disallow?: string | string[];
  crawlDelay?: number;
};

function resolveBaseUrl(siteUrl: unknown): string {
  const raw = typeof siteUrl === 'string' ? siteUrl.trim() : '';
  const fallback = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return (raw || fallback).replace(/\/+$/, '');
}

// 将后台「Robots.txt 内容」自定义文本解析为结构化规则，按 User-agent 分组，
// 忠实保留管理员配置的 Allow / Disallow / Crawl-delay。解析不出有效分组时返回 null（回落默认）。
function parseRobotsText(text: string): RobotRule[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const groups: Array<{ ua: string[]; allow: string[]; disallow: string[]; crawlDelay?: number; hasDirective: boolean }> = [];
  let cur: (typeof groups)[number] | null = null;

  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      // 连续多个 User-agent 行归到同一组；遇到已有指令的组则开新组
      if (!cur || cur.hasDirective) {
        cur = { ua: [], allow: [], disallow: [], hasDirective: false };
        groups.push(cur);
      }
      if (val) cur.ua.push(val);
    } else if (key === 'allow' && cur) {
      if (val) cur.allow.push(val);
      cur.hasDirective = true;
    } else if (key === 'disallow' && cur) {
      // 空 Disallow 表示「全部允许」，按 robots 规范保留为允许（不加入 disallow 列表）
      if (val) cur.disallow.push(val);
      cur.hasDirective = true;
    } else if (key === 'crawl-delay' && cur) {
      const n = Number(val);
      if (!Number.isNaN(n)) cur.crawlDelay = n;
      cur.hasDirective = true;
    }
    // Sitemap / Host 行由下方统一注入，不在分组规则里处理
  }

  const rules: RobotRule[] = [];
  for (const g of groups) {
    if (!g.ua.length) continue;
    const rule: RobotRule = { userAgent: g.ua.length === 1 ? g.ua[0] : g.ua };
    if (g.allow.length) rule.allow = g.allow.length === 1 ? g.allow[0] : g.allow;
    if (g.disallow.length) rule.disallow = g.disallow.length === 1 ? g.disallow[0] : g.disallow;
    if (g.crawlDelay !== undefined) rule.crawlDelay = g.crawlDelay;
    rules.push(rule);
  }
  return rules.length ? rules : null;
}

export default async function robots(): Promise<MetadataRoute.Robots> {
  const settings = await getSiteSettings();
  const base = resolveBaseUrl(settings.siteUrl);
  const sitemapEnabled = settings.enable_sitemap !== 'false' && settings.enable_sitemap !== false;
  const seoRobots = typeof settings.seo_robots === 'string' ? settings.seo_robots : '';

  // 优先忠实遵循后台自定义 robots.txt 内容；解析不出有效规则时回落到默认 allow-all（屏蔽 /agent 工作台）。
  const parsed = seoRobots.trim() ? parseRobotsText(seoRobots) : null;
  const sitemap = sitemapEnabled ? `${base}/sitemap.xml` : undefined;

  if (parsed && parsed.length > 0) {
    return { rules: parsed, sitemap, host: base };
  }
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/agent/', '/agent'] },
    sitemap,
    host: base,
  };
}
