'use client';

import React, { useState } from 'react';
import { Github, Mail, MessageCircle, MonitorPlay, MousePointer2, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { getSiteSettings, getSiteStats } from '../lib/services';
import { useTheme } from '@aetherblog/hooks';
import { motion, AnimatePresence } from 'framer-motion';

// 社交链接数据
const socialLinks = [
  { id: 'github', href: 'https://github.com', label: 'Github', icon: Github, isExternal: true },
  { id: 'email', href: 'mailto:example@email.com', label: 'Email', icon: Mail, isExternal: false },
  { id: 'wechat', href: '#', label: 'Wechat', icon: MessageCircle, isExternal: false },
  { id: 'bilibili', href: 'https://bilibili.com', label: 'Bilibili', icon: MonitorPlay, isExternal: true },
  { id: 'gitee', href: 'https://gitee.com', label: 'Gitee', icon: MousePointer2, isExternal: true },
];

// 社交链接分页轮播组件
const SocialLinksCarousel: React.FC = () => {
  const [currentPage, setCurrentPage] = useState(0);
  const linksPerPage = 4;
  const totalPages = Math.ceil(socialLinks.length / linksPerPage);
  
  // 分页数据
  const paginatedLinks = [];
  for (let i = 0; i < socialLinks.length; i += linksPerPage) {
    const page = socialLinks.slice(i, i + linksPerPage);
    paginatedLinks.push(page);
  }

  const handlePrev = () => {
    setCurrentPage((prev) => (prev > 0 ? prev - 1 : totalPages - 1));
  };

  const handleNext = () => {
    setCurrentPage((prev) => (prev < totalPages - 1 ? prev + 1 : 0));
  };

  const linkClass = "group/link flex items-center justify-center gap-2 text-sm text-[var(--text-muted)] hover:text-primary transition-all duration-200 rounded-xl bg-[var(--bg-secondary)]/40 hover:bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-primary/30 antialiased w-full h-[42px]";

  return (
    <div className="w-full mt-2 relative pb-4">
      {/* 轮播容器 - 固定高度避免跳动 (42px * 2行 + 8px gap = 92px) */}
      <div className="relative h-[92px] w-full">
        
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
                    <IconComponent className="w-4 h-4 group-hover/link:scale-110 group-hover/link:text-primary transition-all duration-300" />
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
                  <div key={link.id} className={`${linkClass} cursor-pointer`}>
                    {content}
                  </div>
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
    staleTime: 10 * 60 * 1000 // 10 mins
  });

  const { data: siteStats } = useQuery({
    queryKey: ['siteStats'],
    queryFn: getSiteStats,
    enabled: !profile,
    staleTime: 10 * 60 * 1000
  });

  // Merge profile data: Props > Fetched > Default
  const name = profile?.name || settings?.authorName || 'Golovin';
  const avatar = profile?.avatar || settings?.authorAvatar;
  const bio = profile?.bio || settings?.authorBio || '一只小凉凉';
  const stats = profile?.stats || siteStats || { posts: 70, categories: 11, tags: 13 };

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
      {/* Top Decoration Bar */}
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

      {/* Marble Vein Texture - Very Subtle Irregular Cracks (Light theme only) */}
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

          {/* Fine Crack Details - Extremely Subtle */}
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

      {/* Subtle Background Gradient Glow */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          background: 'radial-gradient(circle at 50% 0%, rgba(99, 102, 241, 0.08), transparent 60%)',
        }}
      />

      <div className="relative p-6 flex flex-col items-center text-center">
        {/* Avatar with Enhanced Background and Glow */}
        <div className="relative w-24 h-24 mb-4 group/avatar cursor-pointer">
          {/* White Background Circle for Contrast */}
          <div className="absolute -inset-2 bg-white rounded-full blur-sm opacity-60 group-hover/avatar:opacity-80 transition-opacity duration-300" />

          {/* Colorful Glow */}
          <div className="absolute inset-0 bg-gradient-to-tr from-primary/40 via-purple-500/40 to-primary/40 rounded-full blur-2xl opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-700" />

          {/* Avatar Container with Enhanced Ring */}
          <div className="relative w-full h-full rounded-full overflow-hidden ring-4 ring-white group-hover/avatar:ring-primary/40 transition-all duration-300 shadow-lg">
            <img
              src={avatar || "https://github.com/shadcn.png"}
              alt={name}
              className="w-full h-full object-cover group-hover/avatar:scale-105 transition-transform duration-500"
            />
          </div>

          {/* Sparkle Badge */}
          <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center shadow-lg shadow-primary/30">
            <Sparkles className="w-3 h-3 text-white" />
          </div>
        </div>

        {/* Name & Bio with Better Typography */}
        <h2 className="text-lg font-bold text-[var(--text-primary)] mb-5 tracking-tight antialiased">
          {bio}
        </h2>

        {/* Stats with Cleaner Design */}
        <div className="w-full mb-6">
          <div className="grid grid-cols-3 gap-4 p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/20">
            <div className="flex flex-col items-center group/stat cursor-pointer">
              <span className="text-2xl font-bold text-[var(--text-primary)] group-hover/stat:text-primary transition-colors duration-200 antialiased">
                {stats?.posts || 0}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1 antialiased">文章</span>
            </div>
            <div className="flex flex-col items-center group/stat cursor-pointer border-x border-[var(--border-subtle)]">
              <span className="text-2xl font-bold text-[var(--text-primary)] group-hover/stat:text-primary transition-colors duration-200 antialiased">
                {stats?.categories || 0}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1 antialiased">分类</span>
            </div>
            <div className="flex flex-col items-center group/stat cursor-pointer">
              <span className="text-2xl font-bold text-[var(--text-primary)] group-hover/stat:text-primary transition-colors duration-200 antialiased">
                {stats?.tags || 0}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1 antialiased">标签</span>
            </div>
          </div>
        </div>

        {/* Social Links with Paginated Carousel */}
        <SocialLinksCarousel />
      </div>
    </div>
  );
};

export default AuthorProfileCard;
