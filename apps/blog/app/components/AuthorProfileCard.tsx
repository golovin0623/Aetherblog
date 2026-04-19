'use client';

import React, { useState, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, Github, Twitter, Mail, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getSiteSettings, getSiteStats } from '../lib/services';
import { sanitizeImageUrl, sanitizeUrl } from '../lib/sanitizeUrl';
import { useSpotlightEffect } from '../hooks/useSpotlightEffect';

// SECURITY (VULN-098): 限制 `social_links` JSON 解析的大小，避免恶意超大串在
// 受害者浏览器里递归解析消耗内存；外加成员数上限防御 DoS。
const MAX_SOCIAL_LINKS_JSON_LEN = 65_536;
const MAX_SOCIAL_LINKS = 64;

// 社交链接提取工具
const extractSocialLinks = (settings: any) => {
  if (!settings) return [];

  const links: { platform: string; url: string; icon: React.ElementType }[] = [];

  // SECURITY (VULN-080): admin 保存的 social_links URL 若未净化直接渲染为 <a href>
  // 会让 `javascript:` / `data:text/html` 等伪协议被点击触发。这里统一走
  // `sanitizeUrl`，非法/未知协议会回落到 '#'。
  const pushIfSafe = (platform: string, rawUrl: string) => {
    if (!platform || typeof rawUrl !== 'string') return;
    const safe = sanitizeUrl(rawUrl, '');
    if (!safe || safe === '#') return;
    links.push({ platform, url: safe, icon: getPlatformIcon(platform) });
  };

  // 处理社交链接 JSON
  if (settings.social_links) {
    try {
      const raw = settings.social_links;
      if (typeof raw === 'string' && raw.length > MAX_SOCIAL_LINKS_JSON_LEN) {
        return [];
      }
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) {
        for (const item of parsed.slice(0, MAX_SOCIAL_LINKS)) {
          pushIfSafe(item?.platform || item?.name || '', item?.url || '');
        }
      }
    } catch (e) {
      console.warn('Failed to parse social links:', e);
    }
  }

  // 回退到老字段
  if (links.length === 0) {
    if (settings.github_url) pushIfSafe('GitHub', settings.github_url);
    if (settings.twitter_url) pushIfSafe('Twitter', settings.twitter_url);
    if (settings.author_email) {
      // mailto: is trusted, bypass sanitizeUrl (which rejects non-http schemes).
      const email = String(settings.author_email).trim();
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        links.push({ platform: 'Email', url: `mailto:${email}`, icon: Mail });
      }
    }
  }

  return links;
};

const getPlatformIcon = (platform: string) => {
  const p = platform.toLowerCase();
  if (p.includes('github')) return Github;
  if (p.includes('twitter') || p.includes('x')) return Twitter;
  if (p.includes('mail') || p.includes('email')) return Mail;
  if (p.includes('blog') || p.includes('web')) return Globe;
  return ExternalLink;
};

// 社交链接轮播组件
const SocialLinksCarouselBase: React.FC<{ socialLinks: { platform: string; url: string; icon: React.ElementType }[] }> = ({ socialLinks }) => {
  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = 4;
  const totalPages = Math.ceil(socialLinks.length / itemsPerPage);

  const currentItems = socialLinks.slice(
    currentPage * itemsPerPage,
    (currentPage + 1) * itemsPerPage
  );

  if (socialLinks.length === 0) return null;

  return (
    <div className="relative w-full group/carousel px-1">
      <div className="flex items-center justify-center gap-3">
        {totalPages > 1 && (
          <button
            type="button"
            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            className="p-1 rounded-full hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-card)]"
            aria-label="上一页"
            title={currentPage === 0 ? '已经是第一页' : '上一页'}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}

        <div className="flex items-center gap-2 py-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPage}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex items-center gap-3"
            >
              {currentItems.map((link, i) => (
                <a
                  key={link.url + i}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-primary hover:text-white hover:border-primary hover:-translate-y-1 transition-all duration-300 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-card)]"
                  title={link.platform}
                  aria-label={link.platform}
                >
                  <link.icon className="w-4 h-4" />
                </a>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>

        {totalPages > 1 && (
          <button
            type="button"
            onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage === totalPages - 1}
            className="p-1 rounded-full hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-card)]"
            aria-label="下一页"
            title={currentPage === totalPages - 1 ? '已经是最后一页' : '下一页'}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 指示点 - 占用更少空间 */}
      {totalPages > 1 && (
        <div className="absolute bottom-[-2px] left-0 right-0 flex items-center justify-center gap-1.5 h-2">
          {Array.from({ length: totalPages }).map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setCurrentPage(index)}
              className={`transition-all duration-300 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-card)] ${index === currentPage
                ? 'bg-primary w-3 h-1'
                : 'bg-[var(--text-muted)]/10 hover:bg-[var(--text-muted)]/30 w-1 h-1'
                }`}
              aria-label={`前往第 ${index + 1} 页`}
              title={`前往第 ${index + 1} 页`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ⚡ Bolt: 添加 React.memo() 以防止父组件更新时轮播组件的不必要重渲染。
// socialLinks 数组在父组件中通过 useMemo 记忆化。
const SocialLinksCarousel = React.memo(SocialLinksCarouselBase);

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

const AuthorProfileCardBase: React.FC<AuthorProfileCardProps> = ({ className, profile }) => {
  const { spotlightRef, isHovering, handleMouseEnter, handleMouseLeave, handleMouseMove }
    = useSpotlightEffect({ radius: 600 });

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

  // 合并资料数据: Props > 已获取 (snake_case 优先) > 已获取 (旧版) > 默认
  // 注意：优先使用 settings?.authorAvatar，因为后端 SiteController 会注入并修正该路径（添加 /api 前缀）
  const name = profile?.name || settings?.author_name || settings?.authorName || 'Admin';
  const avatar = sanitizeImageUrl(
    profile?.avatar || settings?.authorAvatar || settings?.author_avatar || '',
    'https://cravatar.cn/avatar/00000000000000000000000000000000?d=mp&s=200'
  );
  const bio = profile?.bio || settings?.author_bio || settings?.authorBio || '分享技术与生活';
  const stats = profile?.stats || siteStats || { posts: 0, categories: 0, tags: 0 };

  // 从设置中提取社交链接
  const socialLinks = useMemo(() => extractSocialLinks(settings), [settings]);

  return (
    <div
      className={`surface-raised relative group !rounded-3xl overflow-hidden ${className || ''}`}
      data-interactive
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 聚光灯效果层 */}
      <div
        ref={spotlightRef}
        className="absolute inset-0 pointer-events-none transition-opacity duration-300 z-0 rounded-[inherit]"
        style={{
          opacity: isHovering ? 'var(--spotlight-opacity)' : 0,
        }}
      />

      <div className="relative p-6 flex flex-col items-center text-center">
        {/* 头像 */}
        <div
          className="relative w-24 h-24 mb-3 outline-none select-none"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <div className="absolute -inset-3 rounded-full blur-md opacity-30 bg-[var(--text-primary)]/8 dark:opacity-0 pointer-events-none transition-opacity duration-300" />
          <div className="absolute -inset-2 bg-[var(--bg-primary)] rounded-full blur-sm opacity-60 pointer-events-none transition-colors duration-300" />
          {/* 光晕渐变层：使用 CSS 变量直接设置 background，避免 Tailwind v3 对 CSS 变量颜色不支持 /opacity 修饰符的问题 */}
          <div
            className="absolute inset-0 rounded-full blur-2xl opacity-25 pointer-events-none"
            style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))' }}
          />
          <div className="relative w-full h-full rounded-full overflow-hidden ring-4 ring-[var(--border-default)] outline-none focus:outline-none shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-lg bg-[var(--bg-secondary)] transition-all duration-300">
            <Image
              src={avatar}
              alt={name}
              fill
              sizes="96px"
              className="object-cover outline-none select-none"
              priority
              draggable={false}
              unoptimized={avatar.startsWith('/api/uploads') || avatar.startsWith('/uploads')}
            />
          </div>
        </div>

        <h2 className="text-lg font-bold text-[var(--text-primary)] mb-1 tracking-tight antialiased truncate w-full px-4" title={name}>
          {name}
        </h2>
        <p className="text-sm text-[var(--text-muted)] mb-3 font-medium max-w-[240px] leading-normal line-clamp-2 px-2" title={bio}>
          {bio}
        </p>

        <div className="w-full mb-3">
          <div className="grid grid-cols-3 gap-2 p-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/20">
            <Link href="/timeline" className="flex flex-col items-center group/stat cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded-lg" aria-label={`查看时间线，共 ${stats?.posts || 0} 篇文章`}>
              <span className="text-lg font-bold text-[var(--text-primary)] group-hover/stat:text-primary transition-colors duration-200 antialiased">
                {stats?.posts || 0}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-0.5 antialiased">文章</span>
            </Link>
            <Link href="/archives#categories" className="flex flex-col items-center group/stat cursor-pointer border-x border-[var(--border-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded-lg" aria-label={`查看分类，共 ${stats?.categories || 0} 个分类`}>
              <span className="text-lg font-bold text-[var(--text-primary)] group-hover/stat:text-primary transition-colors duration-200 antialiased">
                {stats?.categories || 0}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-0.5 antialiased">分类</span>
            </Link>
            <Link href="/archives#tags" className="flex flex-col items-center group/stat cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded-lg" aria-label={`查看标签，共 ${stats?.tags || 0} 个标签`}>
              <span className="text-lg font-bold text-[var(--text-primary)] group-hover/stat:text-primary transition-colors duration-200 antialiased">
                {stats?.tags || 0}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-0.5 antialiased">标签</span>
            </Link>
          </div>
        </div>

        <SocialLinksCarousel socialLinks={socialLinks} />
      </div>
    </div>
  );

};

// ⚡ Bolt: 添加 React.memo() 以防止父级布局组件更新时昂贵的 O(n) 重渲染。
// 避免重新计算复杂的径向渐变背景和社交链接提取逻辑。
export const AuthorProfileCard = React.memo(AuthorProfileCardBase);
export default AuthorProfileCard;
