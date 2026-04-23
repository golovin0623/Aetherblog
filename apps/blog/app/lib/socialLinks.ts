import { Mail, MousePointer2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// 社交平台图标映射 (与 Admin 后台一一对应)
// 浅色主题 / 默认使用的 icon URL —— 多数品牌色 logo 在浅暗两种背景下都有
// 足够对比度，因此共用同一个 URL；个别单色 logo（github / snapchat 等）
// 的浅色版本会被 PLATFORM_ICON_URLS_DARK 在暗色主题下覆写为亮色变体，
// 避免"黑图标打在黑背景上直接隐身"。
export const PLATFORM_ICON_URLS: Record<string, string> = {
  // 国内主流
  wechat: 'https://api.iconify.design/logos:wechat.svg',
  qq: 'https://api.iconify.design/simple-icons:tencentqq.svg?color=%23EB1923',
  weibo: 'https://api.iconify.design/simple-icons:sinaweibo.svg?color=%23E6162D',
  bilibili: 'https://api.iconify.design/simple-icons:bilibili.svg?color=%2300A1D6',
  zhihu: 'https://api.iconify.design/simple-icons:zhihu.svg?color=%230084FF',
  douyin: 'https://api.iconify.design/logos:tiktok-icon.svg',
  xiaohongshu: 'https://api.iconify.design/simple-icons:xiaohongshu.svg?color=%23FE2C55',
  douban: 'https://api.iconify.design/simple-icons:douban.svg?color=%23007722',
  gitee: 'https://api.iconify.design/simple-icons:gitee.svg?color=%23C71D23',
  juejin: 'https://api.iconify.design/simple-icons:juejin.svg?color=%231E80FF',
  csdn: 'https://api.iconify.design/simple-icons:csdn.svg?color=%23FC5531',

  // 国际主流
  // GitHub brand 本身就是黑/白双色 —— 浅色下用官方深色 #181717，暗色下在下面
  // PLATFORM_ICON_URLS_DARK 覆盖为白色；避免 logos:github-icon.svg 硬编码黑色
  // 在暗黑主题下完全看不见。
  github: 'https://api.iconify.design/simple-icons:github.svg?color=%23181717',
  twitter: 'https://api.iconify.design/logos:twitter.svg',
  facebook: 'https://api.iconify.design/logos:facebook.svg',
  instagram: 'https://api.iconify.design/logos:instagram-icon.svg',
  linkedin: 'https://api.iconify.design/logos:linkedin-icon.svg',
  youtube: 'https://api.iconify.design/logos:youtube-icon.svg',
  discord: 'https://api.iconify.design/logos:discord-icon.svg',
  telegram: 'https://api.iconify.design/logos:telegram.svg',
  reddit: 'https://api.iconify.design/logos:reddit-icon.svg',
  twitch: 'https://api.iconify.design/logos:twitch.svg',
  tiktok: 'https://api.iconify.design/logos:tiktok-icon.svg',
  spotify: 'https://api.iconify.design/logos:spotify-icon.svg',
  stackoverflow: 'https://api.iconify.design/logos:stackoverflow-icon.svg',
  whatsapp: 'https://api.iconify.design/logos:whatsapp-icon.svg',
  // Snapchat 的真实品牌色是亮黄 #FFFC00；之前硬编码 color=black 在暗色下
  // 完全消失，在浅色下虽可见但与官方 VI 不符。改用品牌黄后两种主题下对比
  // 度都足够。
  snapchat: 'https://api.iconify.design/simple-icons:snapchat.svg?color=%23FFFC00',

  // 其他
  email: 'https://api.iconify.design/noto:envelope.svg',
  rss: 'https://api.iconify.design/simple-icons:rss.svg?color=%23FFA500',
  website: 'https://api.iconify.design/logos:chrome.svg',
};

// 暗色主题专用覆盖：只有在浅色 URL 本身对比度不足（例如 GitHub 纯黑 logo）
// 时才需要登记；其余留空即可继承 PLATFORM_ICON_URLS。
export const PLATFORM_ICON_URLS_DARK: Record<string, string> = {
  github: 'https://api.iconify.design/simple-icons:github.svg?color=%23ffffff',
};

const RELATIVE_URL_PREFIXES = ['/', './', '../'];
const SAFE_ICON_PROTOCOLS = new Set(['http:', 'https:']);
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hasRelativePrefix(url: string): boolean {
  return RELATIVE_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function sanitizeIconUrl(rawUrl: unknown): string | undefined {
  if (typeof rawUrl !== 'string') return undefined;

  const url = rawUrl.trim();
  if (!url) return undefined;

  if (hasRelativePrefix(url)) {
    return url;
  }

  try {
    const parsed = new URL(url);
    return SAFE_ICON_PROTOCOLS.has(parsed.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeSocialHref(rawUrl: unknown): { href: string; isExternal: boolean } | null {
  if (typeof rawUrl !== 'string') return null;

  const url = rawUrl.trim();
  if (!url) return null;

  if (url.startsWith('mailto:')) {
    const email = url.slice('mailto:'.length).trim();
    if (!EMAIL_PATTERN.test(email)) {
      return null;
    }
    return { href: `mailto:${email}`, isExternal: false };
  }

  if (hasRelativePrefix(url)) {
    return { href: url, isExternal: false };
  }

  try {
    const parsed = new URL(url);
    if (!SAFE_LINK_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    return {
      href: parsed.toString(),
      isExternal: true,
    };
  } catch {
    return null;
  }
}

function sanitizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;

  const normalizedEmail = email.trim();
  if (!normalizedEmail) return null;

  return EMAIL_PATTERN.test(normalizedEmail) ? normalizedEmail : null;
}

export interface SocialLinkItem {
  id: string;
  href: string;
  label: string;
  icon?: LucideIcon;
  /** 浅色主题 / 默认 icon URL。消费者若无主题感知直接用这个。 */
  iconUrl?: string;
  /** 暗色主题专用 icon URL；未定义时消费者应回落到 iconUrl。 */
  iconUrlDark?: string;
  isExternal: boolean;
}

export function extractSocialLinks(settings?: Record<string, unknown>): SocialLinkItem[] {
  if (!settings) return [];

  const links: SocialLinkItem[] = [];

  if (settings.social_links) {
    let parsedLinks: unknown[] = [];
    if (Array.isArray(settings.social_links)) {
      parsedLinks = settings.social_links;
    } else if (typeof settings.social_links === 'string') {
      try {
        parsedLinks = JSON.parse(settings.social_links) as unknown[];
      } catch {
        parsedLinks = [];
      }
    }

    if (Array.isArray(parsedLinks)) {
      parsedLinks.forEach((rawLink, index) => {
        if (!rawLink || typeof rawLink !== 'object') return;

        const link = rawLink as Record<string, unknown>;
        const name = typeof link.name === 'string' ? link.name.trim() : '';
        const safeLink = sanitizeSocialHref(link.url);

        if (!name || !safeLink) return;

        const rawPlatform =
          (typeof link.platform === 'string' && link.platform.trim()) ||
          (typeof link.id === 'string' && link.id.trim()) ||
          `social_${index}`;

        const mappedIconUrl = sanitizeIconUrl(
          PLATFORM_ICON_URLS[rawPlatform] ?? link.icon
        );
        const mappedIconUrlDark = sanitizeIconUrl(PLATFORM_ICON_URLS_DARK[rawPlatform]);

        links.push({
          id: rawPlatform,
          href: safeLink.href,
          label: name,
          iconUrl: mappedIconUrl,
          iconUrlDark: mappedIconUrlDark,
          isExternal: safeLink.isExternal,
        });
      });
    }
  }

  if (links.length === 0) {
    Object.entries(settings).forEach(([key, value]) => {
      if (key.startsWith('social_') && key !== 'social_links' && typeof value === 'string' && value.trim()) {
        const platform = key.replace('social_', '');
        const safeLink = sanitizeSocialHref(value);
        if (!safeLink) return;

        const mappedIconUrl = sanitizeIconUrl(PLATFORM_ICON_URLS[platform]);
        const mappedIconUrlDark = sanitizeIconUrl(PLATFORM_ICON_URLS_DARK[platform]);
        const label = platform.charAt(0).toUpperCase() + platform.slice(1);

        links.push({
          id: platform,
          href: safeLink.href,
          label,
          icon: MousePointer2,
          iconUrl: mappedIconUrl,
          iconUrlDark: mappedIconUrlDark,
          isExternal: safeLink.isExternal,
        });
      }
    });
  }

  const hasEmail = links.some((link) => link.id === 'email' || link.href.startsWith('mailto:'));
  const email = settings.site_email ?? settings.author_email;
  const safeEmail = sanitizeEmail(email);

  if (!hasEmail && safeEmail) {
    links.push({
      id: 'email',
      href: `mailto:${safeEmail}`,
      label: 'Email',
      icon: Mail,
      iconUrl: PLATFORM_ICON_URLS.email,
      iconUrlDark: PLATFORM_ICON_URLS_DARK.email,
      isExternal: false,
    });
  }

  return links;
}
