'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { sanitizeImageUrl } from '../lib/sanitizeUrl';

// 多层阴影：外部投影 + 内部高光 → 3D 气泡质感
const BUBBLE_SHADOW = [
  '0 2px 8px rgba(0,0,0,0.12)',
  '0 6px 20px rgba(0,0,0,0.08)',
  'inset 0 1px 1px rgba(255,255,255,0.15)',
].join(', ');

interface FriendIconBubbleProps {
  name: string;
  url: string;
  avatar: string;
  description?: string;
  themeColor?: string;
  index?: number;
  isMobile: boolean;
  /** 图标直径 (px) */
  size: number;
}

const FriendIconBubbleBase: React.FC<FriendIconBubbleProps> = ({
  name,
  url,
  avatar,
  description,
  themeColor = '#6366f1',
  index = 0,
  isMobile,
  size,
}) => {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const safeAvatar = sanitizeImageUrl(avatar, '');
  const safeUrl = sanitizeImageUrl(url, '#');
  const hasValidAvatar = safeAvatar !== '' && safeAvatar.trim() !== '';
  const showFallback = !hasValidAvatar || imageError;

  // 图片加载超时
  useEffect(() => {
    if (!hasValidAvatar) return;
    const timeout = setTimeout(() => {
      if (!imageLoaded) setImageError(true);
    }, 5000);
    return () => clearTimeout(timeout);
  }, [hasValidAvatar, imageLoaded]);

  const handleImageLoad = useCallback(() => setImageLoaded(true), []);
  const handleImageError = useCallback(() => setImageError(true), []);

  // 桌面端悬浮 tooltip
  const handleMouseEnter = useCallback(() => {
    if (isMobile) return;
    tooltipTimerRef.current = setTimeout(() => setShowTooltip(true), 200);
  }, [isMobile]);

  const handleMouseLeave = useCallback(() => {
    setShowTooltip(false);
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
  }, []);

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    };
  }, []);

  return (
    <motion.div
      className="relative flex flex-col items-center"
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        duration: isMobile ? 0.3 : 0.45,
        delay: isMobile ? Math.min(index * 0.02, 0.3) : index * 0.04,
        type: 'spring',
        stiffness: 300,
        damping: 22,
      }}
    >
      <a
        href={safeUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`访问 ${name} 的网站`}
        className="group relative flex flex-col items-center outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleMouseEnter}
        onBlur={handleMouseLeave}
      >
        {/* 图标容器 + 悬浮动画 */}
        <motion.div
          className="relative"
          whileHover={isMobile ? undefined : { scale: 1.15, y: -3 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 500, damping: 25 }}
        >
          {/* 主题色光晕 - 仅桌面端 */}
          {!isMobile && (
            <div
              className="absolute -inset-3 rounded-full opacity-0 group-hover:opacity-40 transition-opacity duration-500 blur-xl"
              style={{ backgroundColor: themeColor }}
            />
          )}

          {/* 圆形图标主体 */}
          <div
            className="relative rounded-full overflow-hidden flex items-center justify-center transition-shadow duration-300"
            style={{
              width: size,
              height: size,
              boxShadow: BUBBLE_SHADOW,
            }}
          >
            {/* 背景底色 */}
            <div
              className="absolute inset-0"
              style={{
                background: showFallback
                  ? `linear-gradient(145deg, ${themeColor}, ${themeColor}cc)`
                  : 'var(--bg-secondary)',
              }}
            />

            {/* 玻璃高光弧 - Apple 风格的球面反射 */}
            <div
              className="absolute inset-0 pointer-events-none z-[2]"
              style={{
                background:
                  'radial-gradient(ellipse 70% 40% at 50% 12%, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.05) 50%, transparent 70%)',
              }}
            />

            {!showFallback ? (
              <Image
                src={safeAvatar}
                alt=""
                aria-hidden="true"
                width={size}
                height={size}
                onLoad={handleImageLoad}
                onError={handleImageError}
                className={`relative z-[1] w-full h-full object-cover transition-opacity duration-200 ${
                  imageLoaded ? 'opacity-100' : 'opacity-0'
                }`}
                /* 友链头像来自任意外部域名,关闭 next/image 域名白名单校验
                   小头像不需要 srcset 优化,已经有 handleImageError fallback */
                unoptimized
              />
            ) : (
              <span
                className="relative z-[1] text-white font-semibold select-none"
                style={{ fontSize: Math.round(size * 0.36) }}
              >
                {name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        </motion.div>

        {/* 名称标签 - 精致小号字体 */}
        <span
          className="mt-1.5 text-[10px] md:text-[11px] text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors duration-200 truncate text-center leading-tight select-none font-medium"
          style={{ maxWidth: size + 12 }}
        >
          {name}
        </span>

        {/* 桌面端悬浮提示框 */}
        {!isMobile && (
          <AnimatePresence>
            {showTooltip && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.95 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
              >
                <div className="relative bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 shadow-xl backdrop-blur-xl min-w-[100px] max-w-[180px]">
                  <div className="absolute -bottom-[5px] left-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 bg-[var(--bg-card)] border-r border-b border-[var(--border-subtle)]" />
                  <p className="text-[11px] font-semibold text-[var(--text-primary)] truncate mb-0.5">
                    {name}
                  </p>
                  {description && (
                    <p className="text-[10px] text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                      {description}
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </a>
    </motion.div>
  );
};

export const FriendIconBubble = React.memo(FriendIconBubbleBase);
FriendIconBubble.displayName = 'FriendIconBubble';
export default FriendIconBubble;
