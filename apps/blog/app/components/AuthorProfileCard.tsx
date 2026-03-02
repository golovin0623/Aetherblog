'use client';

import React, { useState, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, User, Globe, Github, Twitter, Mail, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@aetherblog/hooks';
import { getSiteSettings, getSiteStats } from '../lib/services';
import { sanitizeImageUrl } from '../lib/sanitizeUrl';

// 社交链接提取工具
const extractSocialLinks = (settings: any) => {
  if (!settings) return [];

  const links = [];

  // 处理社交链接 JSON
  if (settings.social_links) {
    try {
      const parsed = typeof settings.social_links === 'string'
        ? JSON.parse(settings.social_links)
        : settings.social_links;
      if (Array.isArray(parsed)) {
        links.push(...parsed.map((item: any) => ({
          platform: item.platform || item.name,
          url: item.url,
          icon: getPlatformIcon(item.platform || item.name)
        })));
      }
    } catch (e) {
      console.warn('Failed to parse social links:', e);
    }
  }

  // 回退到老字段
  if (links.length === 0) {
    if (settings.github_url) links.push({ platform: 'GitHub', url: settings.github_url, icon: Github });
    if (settings.twitter_url) links.push({ platform: 'Twitter', url: settings.twitter_url, icon: Twitter });
    if (settings.author_email) links.push({ platform: 'Email', url: `mailto:${settings.author_email}`, icon: Mail });
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
const SocialLinksCarousel: React.FC<{ socialLinks: any[] }> = ({ socialLinks }) => {
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
            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            className="p-1 rounded-full hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-[var(--text-muted)]"
            aria-label="Previous page"
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
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-primary hover:text-white hover:border-primary hover:-translate-y-1 transition-all duration-300 shadow-sm"
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
            onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage === totalPages - 1}
            className="p-1 rounded-full hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-[var(--text-muted)]"
            aria-label="Next page"
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
              onClick={() => setCurrentPage(index)}
              className={`transition-all duration-300 rounded-full ${index === currentPage
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
  const [mounted, setMounted] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const spotlightRef = React.useRef<HTMLDivElement>(null);
  const frameRef = React.useRef<number>(0);
  const { isDark } = useTheme();

  React.useEffect(() => {
    setMounted(true);
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  // 监听鼠标移动，使用 useRef 和 requestAnimationFrame 优化重排性能
  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!spotlightRef.current) return;

    const { clientX, clientY } = e;
    const target = e.currentTarget;

    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
    }

    frameRef.current = requestAnimationFrame(() => {
      if (!spotlightRef.current) {
        frameRef.current = 0;
        return;
      }
      const rect = target.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      spotlightRef.current.style.background = `radial-gradient(600px circle at ${x}px ${y}px, var(--spotlight-color), transparent 40%)`;
      frameRef.current = 0;
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
      className={`relative group rounded-3xl border border-[var(--border-default)] overflow-hidden transition-all duration-300 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 ${className}`}
      style={{
        background: !mounted || isDark
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
        ref={spotlightRef}
        className="absolute inset-0 pointer-events-none transition-opacity duration-300 z-0"
        style={{
          opacity: isHovering ? 'var(--spotlight-opacity)' : 0,
        }}
      />

      <div className="relative p-6 flex flex-col items-center text-center">
        {/* 头像 */}
        <div className="relative w-24 h-24 mb-3 group/avatar cursor-pointer">
          <div className="absolute -inset-2 bg-white rounded-full blur-sm opacity-60 group-hover/avatar:opacity-80 transition-opacity duration-300" />
          <div className="absolute inset-0 bg-gradient-to-tr from-primary/40 via-purple-500/40 to-primary/40 rounded-full blur-2xl opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-700" />
          <div className="relative w-full h-full rounded-full overflow-hidden ring-4 ring-white group-hover/avatar:ring-primary/40 transition-all duration-300 shadow-lg bg-slate-100">
            <Image
              src={avatar}
              alt={name}
              fill
              sizes="96px"
              className="object-cover group-hover/avatar:scale-105 transition-transform duration-500"
              priority
              unoptimized={avatar.startsWith('/api/uploads') || avatar.startsWith('/uploads')}
            />
          </div>
          <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center shadow-lg shadow-primary/30">
            <Sparkles className="w-3 h-3 text-white" />
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
            <Link href="/timeline" className="flex flex-col items-center group/stat cursor-pointer" aria-label={`View timeline with ${stats?.posts || 0} posts`}>
              <span className="text-lg font-bold text-[var(--text-primary)] group-hover/stat:text-primary transition-colors duration-200 antialiased">
                {stats?.posts || 0}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-0.5 antialiased">文章</span>
            </Link>
            <div className="flex flex-col items-center border-x border-[var(--border-subtle)]">
              <span className="text-lg font-bold text-[var(--text-primary)] transition-colors duration-200 antialiased">
                {stats?.categories || 0}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-0.5 antialiased">分类</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-lg font-bold text-[var(--text-primary)] transition-colors duration-200 antialiased">
                {stats?.tags || 0}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-0.5 antialiased">标签</span>
            </div>
          </div>
        </div>

        <SocialLinksCarousel socialLinks={socialLinks} />
      </div>
    </div>
  );

};

export default AuthorProfileCard;
