'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { sanitizeImageUrl } from '../lib/sanitizeUrl';

interface FriendIconBubbleProps {
  name: string;
  url: string;
  avatar: string;
  description?: string;
  themeColor?: string;
  index?: number;
  isMobile: boolean;
}

const FriendIconBubbleBase: React.FC<FriendIconBubbleProps> = ({
  name,
  url,
  avatar,
  description,
  themeColor = '#6366f1',
  index = 0,
  isMobile,
}) => {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

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

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
  }, []);

  const handleImageError = useCallback(() => {
    setImageError(true);
  }, []);

  // 桌面端悬浮 tooltip
  const handleMouseEnter = useCallback(() => {
    if (isMobile) return;
    setIsHovered(true);
    tooltipTimerRef.current = setTimeout(() => setShowTooltip(true), 200);
  }, [isMobile]);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    setShowTooltip(false);
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current);
      }
    };
  }, []);

  const iconSize = isMobile ? 56 : 72;

  return (
    <motion.div
      className="relative flex flex-col items-center"
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        duration: isMobile ? 0.3 : 0.5,
        delay: isMobile ? Math.min(index * 0.03, 0.3) : index * 0.05,
        type: 'spring',
        stiffness: 260,
        damping: 20,
      }}
    >
      <a
        href={safeUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`访问 ${name} 的网站`}
        className="group relative flex flex-col items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-2xl"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* 图标容器 */}
        <motion.div
          className="relative"
          whileHover={isMobile ? undefined : { scale: 1.15, y: -4 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        >
          {/* 背景光晕 - 仅桌面端 */}
          {!isMobile && (
            <div
              className="absolute -inset-3 rounded-full opacity-0 group-hover:opacity-40 transition-opacity duration-500 blur-xl"
              style={{ backgroundColor: themeColor }}
            />
          )}

          {/* 光环 */}
          <div
            className="absolute -inset-[3px] rounded-[22px] md:rounded-[26px] opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            style={{
              background: `linear-gradient(135deg, ${themeColor}80, ${themeColor}20, ${themeColor}60)`,
            }}
          />

          {/* 图标主体 */}
          <div
            className="relative overflow-hidden bg-[var(--bg-secondary)] transition-shadow duration-300 group-hover:shadow-lg flex items-center justify-center"
            style={{
              width: iconSize,
              height: iconSize,
              borderRadius: isMobile ? 16 : 20,
              boxShadow: isHovered
                ? `0 8px 32px ${themeColor}30, 0 2px 8px rgba(0,0,0,0.3)`
                : '0 2px 8px rgba(0,0,0,0.15)',
            }}
          >
            {/* 卡片内渐变 */}
            <div
              className="absolute inset-0 opacity-20 group-hover:opacity-30 transition-opacity"
              style={{
                background: `linear-gradient(135deg, ${themeColor}40, transparent 60%)`,
              }}
            />

            {/* 玻璃高光 */}
            <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/15 to-transparent rounded-t-[inherit] pointer-events-none" />

            {!showFallback ? (
              <Image
                src={safeAvatar}
                alt={name}
                width={iconSize}
                height={iconSize}
                onLoad={handleImageLoad}
                onError={handleImageError}
                className={`relative z-[1] w-full h-full object-cover transition-opacity duration-200 ${
                  imageLoaded ? 'opacity-100' : 'opacity-0'
                }`}
              />
            ) : (
              <div
                className="relative z-[1] w-full h-full flex items-center justify-center text-white font-bold"
                style={{
                  backgroundColor: themeColor,
                  fontSize: isMobile ? 20 : 26,
                }}
              >
                {name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
        </motion.div>

        {/* 名称标签 */}
        <span className="text-xs text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors duration-200 max-w-[72px] md:max-w-[88px] truncate text-center leading-tight">
          {name}
        </span>

        {/* 桌面端悬浮提示框 */}
        {!isMobile && (
          <AnimatePresence>
            {showTooltip && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.95 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
              >
                <div className="relative bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 shadow-xl backdrop-blur-xl max-w-[200px] min-w-[120px]">
                  {/* 箭头 */}
                  <div className="absolute -bottom-[5px] left-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 bg-[var(--bg-card)] border-r border-b border-[var(--border-subtle)]" />

                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate mb-0.5">
                    {name}
                  </p>
                  {description && (
                    <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">
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
