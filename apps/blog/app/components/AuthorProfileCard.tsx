'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { animate, motion, AnimatePresence, useMotionValue } from 'framer-motion';
import { Globe, Github, Twitter, Mail, ExternalLink, ChevronLeft, ChevronRight, Music2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getSiteSettings, getSiteStats } from '../lib/services';
import { sanitizeImageUrl, sanitizeUrl } from '../lib/sanitizeUrl';
import { useSpotlightEffect } from '../hooks/useSpotlightEffect';
import { useSiteSettings } from './SiteSettingsProvider';
import { CachedAvatarImage } from './CachedAvatarImage';
import { ProfileMusicPlayer } from './ProfileMusicPlayer';

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
      // mailto: 视为可信协议，绕过 sanitizeUrl（其会拒绝非 http 协议）。
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
  const [activeIndex, setActiveIndex] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const trackX = useMotionValue(0);
  const swipeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTrackX: number;
    lastX: number;
    lastTime: number;
    velocityX: number;
    horizontal: boolean;
  } | null>(null);

  // 布局已在 SSR 阶段 fetch 好 settings 并经 context 下发；用它做 initialData，
  // 让头像 URL 首帧即可用，消除「客户端再 fetch 一次 settings」的瀑布与
  // 「先 Gravatar 占位 → 切真头像」的二次加载闪烁。
  const { settings: ssrSettings } = useSiteSettings();
  const { data: settings } = useQuery({
    queryKey: ['siteSettings'],
    queryFn: getSiteSettings,
    enabled: !profile,
    staleTime: 10 * 60 * 1000, // 10 分钟
    initialData: !profile && ssrSettings && Object.keys(ssrSettings).length > 0 ? ssrSettings : undefined,
    // 视 SSR 注水数据为已过期：首帧即用（保住"无瀑布"），但客户端仍后台
    // revalidate。这样当 SSR 因后端不可达回落到 DEFAULT_SITE_SETTINGS 时，
    // 浏览器（/api 代理可达）能纠正回真实头像/作者名，而非被钉在默认值 10 分钟。
    initialDataUpdatedAt: 0,
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
  const stackCards = useMemo(() => [
    { key: 'profile' as const, label: '资料' },
    { key: 'music' as const, label: '音乐' },
  ], []);
  const activeStackCard = stackCards[activeIndex] ?? stackCards[0];
  const activeCard = activeStackCard.key;
  const stackSlots = useMemo(() => {
    const total = stackCards.length;
    const previousIndex = (activeIndex - 1 + total) % total;
    const nextIndex = (activeIndex + 1) % total;
    return [
      { position: 'previous' as const, card: stackCards[previousIndex] },
      { position: 'current' as const, card: stackCards[activeIndex] ?? stackCards[0] },
      { position: 'next' as const, card: stackCards[nextIndex] },
    ];
  }, [activeIndex, stackCards]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;

    const syncWidth = () => {
      const width = node.getBoundingClientRect().width;
      setStageWidth(width);
      trackX.set(-width);
    };
    syncWidth();

    const observer = new ResizeObserver(syncWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [trackX]);

  const commitStackSwitch = useCallback((step: 1 | -1) => {
    setActiveIndex((index) => (index + step + stackCards.length) % stackCards.length);
  }, [stackCards.length]);

  const snapTrackToCenter = useCallback(() => {
    animate(trackX, -stageWidth, {
      type: 'spring',
      stiffness: 560,
      damping: 42,
      mass: 0.62,
    });
  }, [stageWidth, trackX]);

  const animateStackSwitch = useCallback((step: 1 | -1) => {
    if (stageWidth <= 0) return;
    const controls = animate(trackX, step === 1 ? -stageWidth * 2 : 0, {
      type: 'spring',
      stiffness: 520,
      damping: 44,
      mass: 0.7,
    });
    controls.then(() => {
      commitStackSwitch(step);
      trackX.set(-stageWidth);
    });
  }, [commitStackSwitch, stageWidth, trackX]);

  const handleStackPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (stageWidth <= 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('a,button,input,textarea,select,[role="slider"],[data-no-card-swipe]')) return;
    const now = performance.now();
    swipeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTrackX: trackX.get(),
      lastX: event.clientX,
      lastTime: now,
      velocityX: 0,
      horizontal: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some synthetic browser sessions do not support capture for every pointer.
    }
  }, [stageWidth, trackX]);

  const handleStackPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - swipe.startX;
    const deltaY = event.clientY - swipe.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const now = performance.now();
    const elapsed = Math.max(1, now - swipe.lastTime);
    swipe.velocityX = (event.clientX - swipe.lastX) / elapsed;
    swipe.lastX = event.clientX;
    swipe.lastTime = now;

    if (!swipe.horizontal) {
      if (absX < 5 && absY < 5) return;
      if (absY > absX * 1.18) {
        swipeRef.current = null;
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // Ignore capture release failures in older browser engines.
        }
        snapTrackToCenter();
        return;
      }
      swipe.horizontal = true;
    }

    event.preventDefault();
    const limit = Math.max(120, stageWidth * 0.92);
    const resistedX = Math.max(-limit, Math.min(limit, deltaX));
    trackX.set(swipe.startTrackX + resistedX);
  }, [snapTrackToCenter, stageWidth, trackX]);

  const handleStackPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current;
    swipeRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore capture release failures in older browser engines.
    }
    if (!swipe || !swipe.horizontal) {
      snapTrackToCenter();
      return;
    }

    const offset = trackX.get() + stageWidth;
    const swipeDistance = Math.max(58, stageWidth * 0.18);
    const swipeVelocity = 0.68;
    if (offset <= -swipeDistance || swipe.velocityX <= -swipeVelocity) {
      animateStackSwitch(1);
      return;
    }
    if (offset >= swipeDistance || swipe.velocityX >= swipeVelocity) {
      animateStackSwitch(-1);
      return;
    }
    snapTrackToCenter();
  }, [animateStackSwitch, snapTrackToCenter, stageWidth, trackX]);

  const handleStackKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      animateStackSwitch(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      animateStackSwitch(1);
    }
  }, [animateStackSwitch]);

  const renderStackPanel = (
    card: (typeof stackCards)[number],
    position: 'previous' | 'current' | 'next'
  ) => {
    const isCurrent = position === 'current';

    if (card.key === 'profile') {
      return (
        <section
          role={isCurrent ? 'tabpanel' : undefined}
          data-card-panel="profile"
          aria-hidden={!isCurrent}
          inert={!isCurrent}
          className="profile-card-stack-panel flex h-full flex-col items-center overflow-hidden rounded-[1.75rem] border p-4 text-center [backdrop-filter:blur(22px)_saturate(145%)]"
        >
          {/* 头像：仅阴影层次，无光圈/边环 */}
          <div
            className="relative mb-3 h-[4.8rem] w-[4.8rem] select-none outline-none"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <div className="profile-avatar-frame relative h-full w-full overflow-hidden rounded-full shadow-[0_10px_30px_-12px_rgba(15,23,42,0.25),0_4px_12px_-4px_rgba(15,23,42,0.12)] outline-none transition-all duration-300 focus:outline-none dark:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6),0_4px_14px_-4px_rgba(0,0,0,0.4)]">
              <CachedAvatarImage
                src={avatar}
                alt=""
                className="h-full w-full select-none object-cover outline-none"
                fetchPriority="high"
                draggable={false}
                aria-hidden
              />
            </div>
          </div>

          <h2 className="mb-1 w-full truncate px-4 text-lg font-bold tracking-tight text-[var(--text-primary)] antialiased" title={name}>
            {name}
          </h2>
          <p className="mb-3 line-clamp-2 max-w-[240px] px-2 text-sm font-medium leading-normal text-[var(--text-muted)]" title={bio}>
            {bio}
          </p>

          <div className="w-full">
            <div className="grid grid-cols-3 gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/20 p-3">
              <Link href="/timeline" className="group/stat flex cursor-pointer flex-col items-center focus-visible:rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`查看时间线，共 ${stats?.posts || 0} 篇文章`}>
                <span className="text-lg font-bold text-[var(--text-primary)] antialiased transition-colors duration-200 group-hover/stat:text-primary">
                  {stats?.posts || 0}
                </span>
                <span className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] antialiased">文章</span>
              </Link>
              <Link href="/archives#categories" className="group/stat flex cursor-pointer flex-col items-center border-x border-[var(--border-subtle)] focus-visible:rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`查看分类，共 ${stats?.categories || 0} 个分类`}>
                <span className="text-lg font-bold text-[var(--text-primary)] antialiased transition-colors duration-200 group-hover/stat:text-primary">
                  {stats?.categories || 0}
                </span>
                <span className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] antialiased">分类</span>
              </Link>
              <Link href="/archives#tags" className="group/stat flex cursor-pointer flex-col items-center focus-visible:rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`查看标签，共 ${stats?.tags || 0} 个标签`}>
                <span className="text-lg font-bold text-[var(--text-primary)] antialiased transition-colors duration-200 group-hover/stat:text-primary">
                  {stats?.tags || 0}
                </span>
                <span className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] antialiased">标签</span>
              </Link>
            </div>
          </div>

          <div className="mt-auto w-full pt-3">
            {isCurrent ? <SocialLinksCarousel socialLinks={socialLinks} /> : null}
          </div>
        </section>
      );
    }

    return (
      <section
        role={isCurrent ? 'tabpanel' : undefined}
        data-card-panel="music"
        aria-hidden={!isCurrent}
        inert={!isCurrent}
        className="profile-card-stack-panel h-full rounded-[1.75rem] border p-1 [backdrop-filter:blur(22px)_saturate(145%)]"
      >
        <ProfileMusicPlayer
          variant="stack"
          className="h-full"
          emptyState={
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Music2 className="h-8 w-8 text-[var(--aurora-1)]" />
              <p className="mt-3 text-sm font-bold text-[var(--ink-primary)]">音乐卡片未启用</p>
              <p className="mt-1 max-w-[12rem] text-xs leading-5 text-[var(--ink-muted)]">
                后台启用公开播放器后，这里会显示播放控件。
              </p>
            </div>
          }
        />
      </section>
    );
  };

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

      <div className="profile-card-stack-shell relative z-10 flex h-full min-h-[350px] flex-col p-4 lg:min-h-0">
        <div
          ref={stageRef}
          className="profile-card-stack-stage relative min-h-0 flex-1 outline-none [touch-action:pan-y]"
          role="region"
          aria-roledescription="carousel"
          aria-label={`个人卡片，当前为${activeStackCard.label}`}
          tabIndex={0}
          onKeyDown={handleStackKeyDown}
          onPointerDown={handleStackPointerDown}
          onPointerMove={handleStackPointerMove}
          onPointerUp={handleStackPointerEnd}
          onPointerCancel={handleStackPointerEnd}
        >
          <div className="profile-stack-dots" aria-hidden="true">
            {stackCards.map((item, index) => (
              <span
                key={item.key}
                data-active={index === activeIndex ? 'true' : 'false'}
                className="profile-stack-dot"
              />
            ))}
          </div>

          <motion.div
            className="profile-card-stack-track absolute inset-y-0 left-0"
            style={stageWidth > 0 ? { x: trackX } : undefined}
          >
            {stackSlots.map((slot) => (
              <div
                key={`${slot.position}-${slot.card.key}`}
                className="profile-card-stack-slot"
                data-position={slot.position}
              >
                {renderStackPanel(slot.card, slot.position)}
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </div>
  );

};

// ⚡ Bolt: 添加 React.memo() 以防止父级布局组件更新时昂贵的 O(n) 重渲染。
// 避免重新计算复杂的径向渐变背景和社交链接提取逻辑。
export const AuthorProfileCard = React.memo(AuthorProfileCardBase);
export default AuthorProfileCard;
