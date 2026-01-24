'use client';

import React, { useState, useMemo } from 'react';
import { Github, Mail, MessageCircle, MonitorPlay, MousePointer2, Sparkles, Twitter, Linkedin, LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { getSiteSettings, getSiteStats } from '../lib/services';
import { useTheme } from '@aetherblog/hooks';
import { motion, AnimatePresence } from 'framer-motion';

// 社交平台图标映射 (根据 admin 设置的 key 映射到 Lucide 图标)
// 社交平台图标映射 (One-to-One mapping with Admin)
const PLATFORM_ICONS: Record<string, string> = {
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

// 从 settings 对象中提取社交链接
interface SocialLinkItem {
  id: string;
  href: string;
  label: string;
  icon?: LucideIcon;
  iconUrl?: string;
  isExternal: boolean;
}

function extractSocialLinks(settings: Record<string, any> | undefined): SocialLinkItem[] {
  if (!settings) return [];
  
  const links: SocialLinkItem[] = [];

  // 1. 尝试解析新的 JSON 格式配置 (social_links)
  if (settings.social_links) {
    let parsedLinks: any[] = [];
    if (Array.isArray(settings.social_links)) {
      parsedLinks = settings.social_links;
    } else if (typeof settings.social_links === 'string') {
      try {
        parsedLinks = JSON.parse(settings.social_links);
      } catch (e) {
        console.error('Failed to parse social_links:', e);
      }
    }

    if (Array.isArray(parsedLinks)) {
        parsedLinks.forEach((link: any) => {
          if (link.url && link.name) {
             const platformId = link.platform || link.id;
             // 优先使用本地映射的图标 (Two sets of styles: Blog style via mapping), 
             // 如果没有映射则回退到 Admin 提供的 icon URL (兼容自定义 link)
             const mappedIconUrl = PLATFORM_ICONS[platformId] || link.icon;
             
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
  
  // 2. 如果没有新的配置，回退到遍历旧的 social_ 开头的 key (兼容旧数据)
  if (links.length === 0) {
    Object.entries(settings).forEach(([key, value]) => {
      if (key.startsWith('social_') && key !== 'social_links' && value && typeof value === 'string' && value.trim()) {
        const platform = key.replace('social_', '');
        const mappedIconUrl = PLATFORM_ICONS[platform];
        const Icon = MousePointer2; // Default Fallback Lucide Icon
        const label = platform.charAt(0).toUpperCase() + platform.slice(1);
        
        links.push({
          id: platform,
          href: value.trim(),
          label,
          icon: Icon,
          iconUrl: mappedIconUrl,
          isExternal: !value.startsWith('mailto:') && value.startsWith('http'),
        });
      }
    });
  }
  
  // 3. 特殊处理邮箱 (site_email -> email link)
  // 如果 links 中尚未包含 email，且有 site_email 或 author_email 配置，则添加
  const hasEmail = links.some(l => l.id === 'email' || l.href.startsWith('mailto:'));
  const email = settings.site_email || settings.author_email;
  
  if (!hasEmail && email && typeof email === 'string' && email.trim()) {
    links.push({
      id: 'email',
      href: `mailto:${email.trim()}`,
      label: 'Email',
      icon: Mail,
      iconUrl: PLATFORM_ICONS['email'], // 使用统一映射
      isExternal: false,
    });
  }
  
  return links;
}

// 社交链接分页轮播组件
interface SocialLinksCarouselProps {
  socialLinks: SocialLinkItem[];
}

const SocialLinksCarousel: React.FC<SocialLinksCarouselProps> = ({ socialLinks }) => {
  const [currentPage, setCurrentPage] = useState(0);
  const linksPerPage = 4;
  const totalPages = Math.ceil(socialLinks.length / linksPerPage);
  
  // 分页数据
  const paginatedLinks = useMemo(() => {
    const pages: SocialLinkItem[][] = [];
    for (let i = 0; i < socialLinks.length; i += linksPerPage) {
      pages.push(socialLinks.slice(i, i + linksPerPage));
    }
    return pages;
  }, [socialLinks]);

  const handlePrev = () => {
    setCurrentPage((prev) => (prev > 0 ? prev - 1 : totalPages - 1));
  };

  const handleNext = () => {
    setCurrentPage((prev) => (prev < totalPages - 1 ? prev + 1 : 0));
  };

  const linkClass = "group/link flex items-center justify-center gap-2 text-sm text-[var(--text-muted)] hover:text-primary transition-all duration-200 rounded-xl bg-[var(--bg-secondary)]/40 hover:bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-primary/30 antialiased w-full h-[42px]";

  // 如果没有社交链接，显示占位提示
  if (socialLinks.length === 0) {
    return (
      <div className="w-full mt-2 text-center text-sm text-[var(--text-muted)] py-4">
        暂无社交链接，请在后台设置中配置
      </div>
    );
  }

  return (
    <div className="w-full mt-2 relative pb-6">
      {/* 轮播容器 - 增加高度防止底部遮挡 (42px * 2 + gap + buffer) */}
      <div className="relative h-[104px] w-full">
        
        {/* 左箭头 - 绝对定位靠左，极淡透明，大角度 */}
        {totalPages > 1 && (
          <div className="absolute left-0 top-0 bottom-0 flex items-center justify-start z-10 w-6">
            <button
              onClick={handlePrev}
              className="p-1 opacity-[0.08] hover:opacity-[0.25] transition-opacity cursor-pointer active:scale-95"
              aria-label="上一页"
            >
              <svg className="w-5 h-5 text-black dark:text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 4L6 12L14 20" />
              </svg>
            </button>
          </div>
        )}

        {/* 内容显示窗口 - 左右留出空间给箭头 */}
        <div className="h-full px-7 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPage}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="grid grid-cols-2 gap-2"
            >
              {paginatedLinks[currentPage]?.map((link) => {
                const IconComponent = link.icon;
                const content = (
                  <>
                    {link.iconUrl ? (
                      <img 
                        src={link.iconUrl} 
                        alt={link.label} 
                        className="w-4 h-4 object-contain group-hover/link:scale-110 transition-transform duration-300" 
                      />
                    ) : (
                      IconComponent && <IconComponent className="w-4 h-4 group-hover/link:scale-110 group-hover/link:text-primary transition-all duration-300" />
                    )}
                    <span className="font-medium text-xs truncate max-w-[80px]">{link.label}</span>
                  </>
                );

                if (link.isExternal) {
                  return (
                    <Link key={link.id} href={link.href} target="_blank" className={linkClass}>
                      {content}
                    </Link>
                  );
                }

                return (
                  <a key={link.id} href={link.href} className={`${linkClass} cursor-pointer`}>
                    {content}
                  </a>
                );
              })}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* 右箭头 - 绝对定位靠右，极淡透明，大角度 */}
        {totalPages > 1 && (
          <div className="absolute right-0 top-0 bottom-0 flex items-center justify-end z-10 w-6">
            <button
              onClick={handleNext}
              className="p-1 opacity-[0.08] hover:opacity-[0.25] transition-opacity cursor-pointer active:scale-95"
              aria-label="下一页"
            >
              <svg className="w-5 h-5 text-black dark:text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 4L18 12L10 20" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* 分页指示器 - 绝对定位在底部，不占用流空间 */}
      {totalPages > 1 && (
        <div className="absolute bottom-[-2px] left-0 right-0 flex items-center justify-center gap-1.5 h-2">
          {Array.from({ length: totalPages }).map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentPage(index)}
              className={`transition-all duration-300 rounded-full ${
                index === currentPage
                  ? 'bg-primary w-3 h-1'
                  : 'bg-[var(--text-muted)]/10 hover:bg-[var(--text-muted)]/30 w-1 h-1'
              }`}
              aria-label={`Go to page ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};


export interface AuthorProfile {
  name: string;
  avatar?: string;
  bio?: string;
  stats?: {
    posts: number;
    categories: number;
    tags: number;
  };
}

interface AuthorProfileCardProps {
  className?: string;
  profile?: AuthorProfile;
}

export const AuthorProfileCard: React.FC<AuthorProfileCardProps> = ({ className, profile }) => {
  const [isHovering, setIsHovering] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const { isDark } = useTheme();

  // 监听鼠标移动，更新光束位置
  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePosition({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const { data: settings } = useQuery({
    queryKey: ['siteSettings'],
    queryFn: getSiteSettings,
    enabled: !profile,
    staleTime: 10 * 60 * 1000 // 10 分钟
  });

  const { data: siteStats } = useQuery({
    queryKey: ['siteStats'],
    queryFn: getSiteStats,
    enabled: !profile,
    staleTime: 10 * 60 * 1000
  });

  // Merge profile data: Props > Fetched (snake_case prioritized) > Fetched (legacy) > Default
  const name = profile?.name || settings?.author_name || settings?.authorName || 'Golovin';
  const avatar = profile?.avatar || settings?.author_avatar || settings?.authorAvatar;
  const bio = profile?.bio || settings?.author_bio || settings?.authorBio || '一只小凉凉';
  const stats = profile?.stats || siteStats || { posts: 70, categories: 11, tags: 13 };

  // Extract social links from settings
  const socialLinks = useMemo(() => extractSocialLinks(settings), [settings]);

  return (
    <div
      className={`relative group rounded-3xl border border-[var(--border-default)] overflow-hidden transition-all duration-300 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 ${className}`}
      style={{
        background: isDark
          ? 'var(--bg-card)'
          : `
            radial-gradient(ellipse 1200px 400px at 12% 18%, rgba(241, 245, 249, 0.4) 0%, transparent 50%),
            radial-gradient(ellipse 350px 900px at 88% 65%, rgba(226, 232, 240, 0.35) 0%, transparent 52%),
            radial-gradient(ellipse 600px 280px at 35% 92%, rgba(248, 250, 252, 0.3) 0%, transparent 48%),
            radial-gradient(ellipse 280px 650px at 68% 8%, rgba(226, 232, 240, 0.38) 0%, transparent 45%),
            radial-gradient(ellipse 450px 320px at 25% 55%, rgba(248, 250, 252, 0.25) 0%, transparent 42%),
            radial-gradient(ellipse 320px 580px at 75% 82%, rgba(203, 213, 225, 0.32) 0%, transparent 46%),
            radial-gradient(ellipse 180px 420px at 48% 28%, rgba(241, 245, 249, 0.28) 0%, transparent 40%),
            #ffffff
          `,
        backdropFilter: 'blur(20px)',
      }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* 顶部装饰条 */}
      <div className="absolute top-0 left-0 right-0 h-[var(--decoration-bar-height)] bg-[var(--decoration-gradient)] z-30" />

      {/* 聚光灯效果层 */}
      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-300 z-0"
        style={{
          background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, var(--spotlight-color), transparent 40%)`,
          opacity: isHovering ? 'var(--spotlight-opacity)' : 0,
        }}
      />

      {/* 顶部高亮线条 */}
      <div
        className="absolute top-0 left-0 right-0 h-px z-10"
        style={{
          background: `linear-gradient(to right, transparent, var(--highlight-line), transparent)`
        }}
      />

      {/* 大理石纹理 - 非常微妙的不规则裂纹 (仅亮色模式) */}
      {!isDark && (
        <>
          <div
            className="absolute inset-0 opacity-12 pointer-events-none mix-blend-multiply"
            style={{
              background: `
                radial-gradient(ellipse 180px 520px at 8% 22%, rgba(148, 163, 184, 0.08) 0%, transparent 60%),
                radial-gradient(ellipse 420px 140px at 92% 58%, rgba(148, 163, 184, 0.06) 0%, transparent 58%),
                radial-gradient(ellipse 95px 380px at 38% 88%, rgba(148, 163, 184, 0.05) 0%, transparent 55%),
                radial-gradient(ellipse 280px 95px at 72% 12%, rgba(148, 163, 184, 0.07) 0%, transparent 57%),
                radial-gradient(ellipse 140px 320px at 18% 68%, rgba(148, 163, 184, 0.04) 0%, transparent 52%),
                radial-gradient(ellipse 320px 180px at 85% 78%, rgba(148, 163, 184, 0.06) 0%, transparent 54%),
                radial-gradient(ellipse 220px 85px at 55% 35%, rgba(148, 163, 184, 0.05) 0%, transparent 50%)
              `,
            }}
          />

          {/* 细微的裂纹细节 - 极度微妙 */}
          <div
            className="absolute inset-0 opacity-8 pointer-events-none mix-blend-overlay"
            style={{
              background: `
                radial-gradient(ellipse 60px 280px at 15% 45%, rgba(100, 116, 139, 0.06) 0%, transparent 65%),
                radial-gradient(ellipse 240px 70px at 78% 25%, rgba(100, 116, 139, 0.04) 0%, transparent 62%),
                radial-gradient(ellipse 85px 190px at 42% 72%, rgba(100, 116, 139, 0.05) 0%, transparent 60%),
                radial-gradient(ellipse 150px 55px at 65% 88%, rgba(100, 116, 139, 0.07) 0%, transparent 68%)
              `,
            }}
          />
        </>
      )}

      {/* 微妙的背景渐变光晕 */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          background: 'radial-gradient(circle at 50% 0%, rgba(99, 102, 241, 0.08), transparent 60%)',
        }}
      />

      <div className="relative p-6 flex flex-col items-center text-center">
        {/* Avatar with Enhanced Background and Glow */}
        <div className="relative w-24 h-24 mb-3 group/avatar cursor-pointer">
          {/* White Background Circle for Contrast */}
          <div className="absolute -inset-2 bg-white rounded-full blur-sm opacity-60 group-hover/avatar:opacity-80 transition-opacity duration-300" />

          {/* 多彩光晕 */}
          <div className="absolute inset-0 bg-gradient-to-tr from-primary/40 via-purple-500/40 to-primary/40 rounded-full blur-2xl opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-700" />

          {/* 头像容器 - 带有增强的圆环 */}
          <div className="relative w-full h-full rounded-full overflow-hidden ring-4 ring-white group-hover/avatar:ring-primary/40 transition-all duration-300 shadow-lg">
            <img
              src={avatar || "https://github.com/shadcn.png"}
              alt={name}
              className="w-full h-full object-cover group-hover/avatar:scale-105 transition-transform duration-500"
            />
          </div>

          {/* 闪光徽章 */}
          <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center shadow-lg shadow-primary/30">
            <Sparkles className="w-3 h-3 text-white" />
          </div>
        </div>

        {/* Name & Bio with Better Typography */}
        <h2 className="text-lg font-bold text-[var(--text-primary)] mb-1 tracking-tight antialiased truncate w-full px-4" title={name}>
          {name}
        </h2>
        <p className="text-sm text-[var(--text-muted)] mb-3 font-medium max-w-[240px] leading-normal line-clamp-2 px-2" title={bio}>
          {bio}
        </p>

        {/* Stats with Cleaner Design - Compressed */}
        <div className="w-full mb-3">
          <div className="grid grid-cols-3 gap-2 p-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/20">
            <div className="flex flex-col items-center group/stat cursor-pointer">
              <span className="text-lg font-bold text-[var(--text-primary)] group-hover/stat:text-primary transition-colors duration-200 antialiased">
                {stats?.posts || 0}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-0.5 antialiased">文章</span>
            </div>
            <div className="flex flex-col items-center group/stat cursor-pointer border-x border-[var(--border-subtle)]">
              <span className="text-lg font-bold text-[var(--text-primary)] group-hover/stat:text-primary transition-colors duration-200 antialiased">
                {stats?.categories || 0}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-0.5 antialiased">分类</span>
            </div>
            <div className="flex flex-col items-center group/stat cursor-pointer">
              <span className="text-lg font-bold text-[var(--text-primary)] group-hover/stat:text-primary transition-colors duration-200 antialiased">
                {stats?.tags || 0}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-0.5 antialiased">标签</span>
            </div>
          </div>
        </div>

        {/* Social Links with Paginated Carousel */}
        <SocialLinksCarousel socialLinks={socialLinks} />
      </div>
    </div>
  );

};

export default AuthorProfileCard;
