'use client';

/**
 * SiteFooter —— 博客前台统一页脚（Aether Codex 设计层）
 *
 * 之前 layout.tsx 没有挂任何 footer 组件，后台 "系统设置" 里维护的 footer_text /
 * footer_signature / icp_number / social_links 等字段在前端被完全丢弃。
 *
 * 视觉规范严格对齐 /design 页面（apps/blog/app/design/DesignClient.tsx 里
 * 使用的 section 模式）：
 *  - section 直接铺 `bg-[var(--bg-substrate)]`，**不套 `.surface-leaf` 玻璃层**。
 *    原因：`surface-leaf` 的 backdrop-filter + 6% ink-primary（#F4EFE6 暖色
 *    cream）边框会把 footer 染上暖棕色尾迹，与 hero 区域的冷黑（bg-void）
 *    形成不协调的色相断层。flat bg-substrate 与 hero 的 bg-void 之间靠一
 *    条顶部渐变细线做 section 分隔即可，这是 /design 八节交替的标准做法。
 *  - wordmark 用 `font-display`（Fraunces），签名行用 `font-editorial`（Instrument
 *    Serif italic），版权 / ICP 用 `font-mono` + uppercase + wide tracking；
 *  - § 前缀与 hover 侧边条用 `var(--aurora-1)` 以匹配用户的主题色，
 *    同时 fallback 到 `var(--aurora-1)` 作为 Codex 默认；
 *  - 移动端堆叠居中，`pb-[max(1rem,env(safe-area-inset-bottom))]` 适配 iOS 安全区。
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { Github, Twitter, Mail, Globe, ExternalLink, MessageCircle, Rss } from 'lucide-react';
import { useSiteSettings } from './SiteSettingsProvider';
import { sanitizeUrl } from '../lib/sanitizeUrl';

// SECURITY (VULN-098): 与 AuthorProfileCard 保持一致的 social_links 体量硬限制。
const MAX_SOCIAL_LINKS_JSON_LEN = 65_536;
const MAX_SOCIAL_LINKS = 64;

type SocialItem = {
  platform: string;
  name: string;
  url: string;
  icon: React.ElementType;
};

function pickIcon(platform: string): React.ElementType {
  const p = platform.toLowerCase();
  if (p.includes('github')) return Github;
  if (p.includes('twitter') || p === 'x') return Twitter;
  if (p.includes('mail') || p.includes('email')) return Mail;
  if (p.includes('qq') || p.includes('wechat') || p.includes('weixin')) return MessageCircle;
  if (p.includes('rss') || p.includes('feed')) return Rss;
  if (p.includes('blog') || p.includes('web') || p.includes('site')) return Globe;
  return ExternalLink;
}

// 合法化 URL：
//  - http(s) / 相对路径走 sanitizeUrl
//  - `mailto:` 白名单放行，但要求邮箱格式合法
//  - 纯数字（QQ 号）包一层 tencent://message/?uin=
//  - 其它 scheme（javascript:、data:）一律丢弃
function resolveSocialHref(platform: string, rawUrl: string): string | null {
  if (typeof rawUrl !== 'string') return null;
  const v = rawUrl.trim();
  if (!v) return null;

  const p = platform.toLowerCase();
  // 纯数字 QQ 号兼容
  if (p.includes('qq') && /^\d{5,12}$/.test(v)) {
    return `tencent://message/?uin=${v}`;
  }
  // email 场景
  if (p.includes('mail') || p.includes('email')) {
    if (/^mailto:/i.test(v)) return v;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
    return null;
  }
  // 常规 URL
  const safe = sanitizeUrl(v, '');
  return safe && safe !== '#' ? safe : null;
}

function extractSocialLinks(raw: unknown): SocialItem[] {
  if (!raw) return [];
  try {
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      if (raw.length > MAX_SOCIAL_LINKS_JSON_LEN) return [];
      parsed = JSON.parse(raw);
    }
    if (!Array.isArray(parsed)) return [];

    const out: SocialItem[] = [];
    for (const item of (parsed as Array<Record<string, unknown>>).slice(0, MAX_SOCIAL_LINKS)) {
      const platform = String(item?.platform ?? item?.name ?? '').trim();
      const name = String(item?.name ?? item?.platform ?? '').trim() || platform;
      const url = resolveSocialHref(platform, String(item?.url ?? ''));
      if (!platform || !url) continue;
      out.push({ platform, name, url, icon: pickIcon(platform) });
    }
    return out;
  } catch {
    return [];
  }
}

// 导航链接（与 BlogHeader 对齐，但作为文字链呈现）
const FOOTER_NAV: { label: string; href: string }[] = [
  { label: '首页', href: '/' },
  { label: '时间线', href: '/timeline' },
  { label: '归档', href: '/archives' },
  { label: '友链', href: '/friends' },
  { label: '关于', href: '/about' },
  { label: '设计', href: '/design' },
];

export default function SiteFooter() {
  const { settings } = useSiteSettings();

  const siteName = (settings.site_name as string) || settings.siteTitle || 'AetherBlog';
  const footerText = (settings.footer_text as string) || '';
  const footerSignature = (settings.footer_signature as string) || (settings.welcome_subtitle as string) || '';
  // 后台字段叫 `icp_number`，前端 SiteSettings 还兜了一个旧的 `icp` 别名。
  const icp = ((settings.icp_number as string) || (settings.icp as string) || '').trim();
  const startYear = Number((settings.startYear as string) || settings.start_year || '');
  const currentYear = new Date().getFullYear();
  const yearRange =
    startYear && startYear !== currentYear ? `${startYear}–${currentYear}` : `${currentYear}`;

  const socialLinks = useMemo(() => extractSocialLinks(settings.social_links), [settings.social_links]);

  return (
    <footer
      className="relative mt-16 print:hidden"
      role="contentinfo"
      aria-label="站点页脚"
    >
      {/* 顶部 aurora 细线：标记内容结束、footer 开始。不做 section-mark，因为 footer
          是站点级 chrome 而非文章内部章节。*/}
      <div
        aria-hidden="true"
        className="h-px w-full"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, color-mix(in oklch, var(--aurora-1) 40%, transparent) 35%, color-mix(in oklch, var(--aurora-2) 35%, transparent) 65%, transparent 100%)',
        }}
      />

      {/* 底色：
          - 暗主题走 /design §section 同款的 `--bg-substrate` (#0B0D14 冷深蓝黑)；
          - 亮主题故意 *不* 用 `--bg-substrate` (#F4F2EC 暖米白) ——那个是
            Codex "牛皮纸 / 羊皮卷" 色，跟用户在其它 light 场景实际用的冷
            中性卡片底 (页面 body + 文章卡片均为近冷白) 对不上，会被视觉
            解读成"发黄"。亮主题改用 Apple 系统级中性灰 #F5F5F7，与页面
            卡片色温一致。*/}
      <div className="bg-[#F5F5F7] dark:bg-[var(--bg-substrate,#0B0D14)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* 主区：wordmark + nav + social。
              mobile: 单列居中堆叠；md+: 3 列网格。*/}
          <div className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr_1fr] gap-8 md:gap-10 py-8 md:py-14 text-center md:text-left">
            {/* Brand · wordmark + signature */}
            <div className="space-y-3 md:space-y-4">
              <Link
                href="/"
                className="inline-block font-display text-[clamp(1.75rem,3.5vw,2.25rem)] leading-none text-[var(--ink-primary)] tracking-[-0.015em] transition-colors hover:text-[var(--aurora-1)]"
              >
                {siteName}
              </Link>
              {footerSignature && (
                <p className="font-editorial italic text-base md:text-lg text-[var(--ink-secondary)] leading-relaxed max-w-sm mx-auto md:mx-0">
                  {footerSignature}
                </p>
              )}
            </div>

            {/* Navigate */}
            <nav aria-label="页脚导航" className="space-y-3 md:space-y-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[color-mix(in_oklch,var(--aurora-1)_85%,transparent)]">
                § Navigate
              </div>
              {/* mobile: flex-wrap 紧凑行；md+: 2-col grid */}
              <ul className="flex flex-wrap justify-center md:grid md:grid-cols-2 md:justify-start gap-x-4 gap-y-2">
                {FOOTER_NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="group/fl inline-flex items-center gap-2 font-mono text-[11px] md:text-[12px] uppercase tracking-[0.18em] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] transition-colors"
                    >
                      <span
                        aria-hidden="true"
                        className="hidden md:inline-block h-px w-3 bg-[color-mix(in_oklch,var(--ink-muted)_40%,transparent)] transition-all duration-300 group-hover/fl:w-6 group-hover/fl:bg-[var(--aurora-1)]"
                      />
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            {/* Connect · social */}
            <div className="space-y-3 md:space-y-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[color-mix(in_oklch,var(--aurora-1)_85%,transparent)]">
                § Connect
              </div>
              {socialLinks.length > 0 ? (
                <ul className="flex flex-wrap justify-center md:justify-start items-center gap-3">
                  {socialLinks.map((link) => {
                    const Icon = link.icon;
                    const isExternal = /^https?:\/\//i.test(link.url);
                    return (
                      <li key={`${link.platform}:${link.url}`}>
                        <a
                          href={link.url}
                          title={link.name || link.platform}
                          aria-label={link.name || link.platform}
                          {...(isExternal
                            ? { target: '_blank', rel: 'noopener noreferrer' }
                            : {})}
                          data-interactive
                          className="surface-raised !rounded-full flex items-center justify-center w-11 h-11 text-[var(--ink-secondary)] hover:text-[var(--aurora-1)] transition-colors"
                        >
                          <Icon className="w-[18px] h-[18px]" strokeWidth={1.5} />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  No social channels configured
                </p>
              )}
            </div>
          </div>

          {/* 底部细线 divider */}
          <div
            aria-hidden="true"
            className="h-px w-full"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, color-mix(in oklch, var(--ink-muted) 28%, transparent) 50%, transparent 100%)',
            }}
          />

          {/* Legal bar —— mobile: 居中堆叠三行；md+: 左右两列 */}
          <div className="flex flex-col items-center gap-2 md:flex-row md:items-center md:justify-between md:gap-4 py-5 md:py-6 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {/* 左 · 版权 + ICP。用 ink-secondary 而非 ink-muted：
                后者在亮主题 (#7A7468) 下对 #F5F5F7 对比度不足（≈3.2:1,
                低于 WCAG 4.5:1 文本下限），ink-secondary #4A463E 下直接提
                到 ≈ 8:1，小字 mono 也能清楚读到。 */}
            <div className="flex flex-col md:flex-row md:flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-secondary)] text-center md:text-left">
              {footerText ? (
                <span>{footerText.replace(/\b\d{4}\b/, yearRange)}</span>
              ) : (
                <span>© {yearRange} {siteName} · All rights reserved</span>
              )}
              {icp && (
                <a
                  href="https://beian.miit.gov.cn/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[var(--aurora-1)] transition-colors"
                  title="工信部 ICP 备案查询"
                >
                  {icp}
                </a>
              )}
            </div>
            {/* 右 · Codex 尾声标记（呼应 /design §8）。比左侧略淡以表
                从属关系，但仍用 ink-secondary 保证可读。 */}
            <div className="font-mono text-[9.5px] md:text-[10px] uppercase tracking-[0.3em] text-[color-mix(in_oklch,var(--ink-secondary)_70%,transparent)]">
              Aether Codex · v1 · {currentYear}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
