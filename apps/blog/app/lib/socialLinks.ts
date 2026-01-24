import { Mail, MousePointer2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// 社交平台图标映射 (One-to-one mapping with Admin)
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
  github: 'https://api.iconify.design/logos:github-icon.svg',
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
  snapchat: 'https://api.iconify.design/simple-icons:snapchat.svg?color=black',
  
  // 其他
  email: 'https://api.iconify.design/noto:envelope.svg',
  rss: 'https://api.iconify.design/simple-icons:rss.svg?color=%23FFA500',
  website: 'https://api.iconify.design/logos:chrome.svg',
};

export interface SocialLinkItem {
  id: string;
  href: string;
  label: string;
  icon?: LucideIcon;
  iconUrl?: string;
  isExternal: boolean;
}

export function extractSocialLinks(settings?: Record<string, any>): SocialLinkItem[] {
  if (!settings) return [];
  
  const links: SocialLinkItem[] = [];

  // 1. 优先解析新的 JSON 格式配置 (social_links)
  if (settings.social_links) {
    let parsedLinks: any[] = [];
    if (Array.isArray(settings.social_links)) {
      parsedLinks = settings.social_links;
    } else if (typeof settings.social_links === 'string') {
      try {
        parsedLinks = JSON.parse(settings.social_links);
      } catch {
        parsedLinks = [];
      }
    }

    if (Array.isArray(parsedLinks)) {
      parsedLinks.forEach((link: any) => {
        if (link.url && link.name) {
          const platformId = link.platform || link.id;
          const mappedIconUrl = PLATFORM_ICON_URLS[platformId] || link.icon;
          
          links.push({
            id: platformId,
            href: link.url,
            label: link.name,
            iconUrl: mappedIconUrl,
            isExternal: !link.url.startsWith('mailto:'),
          });
        }
      });
    }
  }
  
  // 2. 兼容旧的 social_ 前缀配置
  if (links.length === 0) {
    Object.entries(settings).forEach(([key, value]) => {
      if (key.startsWith('social_') && key !== 'social_links' && value && typeof value === 'string' && value.trim()) {
        const platform = key.replace('social_', '');
        const mappedIconUrl = PLATFORM_ICON_URLS[platform];
        const label = platform.charAt(0).toUpperCase() + platform.slice(1);
        
        links.push({
          id: platform,
          href: value.trim(),
          label,
          icon: MousePointer2,
          iconUrl: mappedIconUrl,
          isExternal: !value.startsWith('mailto:') && value.startsWith('http'),
        });
      }
    });
  }
  
  // 3. 特殊处理邮箱 (site_email -> email link)
  const hasEmail = links.some((link) => link.id === 'email' || link.href.startsWith('mailto:'));
  const email = settings.site_email || settings.author_email;
  
  if (!hasEmail && email && typeof email === 'string' && email.trim()) {
    links.push({
      id: 'email',
      href: `mailto:${email.trim()}`,
      label: 'Email',
      icon: Mail,
      iconUrl: PLATFORM_ICON_URLS.email,
      isExternal: false,
    });
  }
  
  return links;
}
