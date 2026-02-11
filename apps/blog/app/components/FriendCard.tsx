'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { ExternalLink } from 'lucide-react';

interface FriendCardProps {
  name: string;
  url: string;
  avatar: string;
  description?: string;
  themeColor?: string;
  tags?: string[];
  email?: string;
  rss?: string;
  index?: number;
}

export const FriendCard: React.FC<FriendCardProps> = ({
  name,
  url,
  avatar,
  description,
  themeColor = '#6366f1',
  tags = [],
  email,
  rss,
  index = 0,
}) => {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  // 智能检测图片宽高比
  const [isSquareImage, setIsSquareImage] = useState<boolean | null>(null);

  // 检测是否有有效的头像 URL
  const hasValidAvatar = avatar && avatar.trim() !== '';

  // 图片加载超时处理
  useEffect(() => {
    if (!hasValidAvatar) return;
    
    const timeout = setTimeout(() => {
      if (!imageLoaded) {
        setImageError(true);
      }
    }, 5000); // 5秒超时

    return () => clearTimeout(timeout);
  }, [hasValidAvatar, imageLoaded]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    // 宽高比在 0.7~1.4 之间视为"接近正方形"，使用填充模式
    setIsSquareImage(aspectRatio >= 0.7 && aspectRatio <= 1.4);
    setImageLoaded(true);
  };

  // 根据图片比例动态决定样式
  // - 正方形图片: 填满圆形 (object-cover)
  // - 非正方形: 缩放适配 + 内边距 (object-contain + padding)
  const imageClass = isSquareImage === null
    ? "h-full w-full object-contain p-1.5 opacity-0" // 加载中先隐藏，避免闪烁
    : isSquareImage
      ? "h-full w-full object-cover opacity-100 transition-opacity duration-200"
      : "h-full w-full object-contain p-1.5 opacity-100 transition-opacity duration-200";
  
  // 是否显示回退的首字母头像
  const showFallback = !hasValidAvatar || imageError;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block overflow-hidden rounded-2xl border border-[var(--border-subtle)] shadow-lg transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl antialiased"
      style={{ 
        animationDelay: `${index * 100}ms`,
        background: `linear-gradient(145deg, ${themeColor}15, var(--bg-card))`,
      }}
    >
      {/* 悬浮时的强光晕背景 */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ 
          background: `linear-gradient(145deg, ${themeColor}25, var(--bg-card-hover))`,
        }}
      />

      {/* 顶部渐变融合光效 */}
      <div
        className="absolute top-0 left-0 right-0 h-20 opacity-20 transition-all duration-300 group-hover:opacity-30"
        style={{ 
          background: `linear-gradient(to bottom, ${themeColor}, transparent)`,
        }}
      />
      
      {/* 顶部微弱高亮边线 (替代原来的粗线条) */}
      <div 
        className="absolute top-0 left-0 right-0 h-[1px] opacity-40"
        style={{ 
          background: `linear-gradient(90deg, transparent, ${themeColor}, transparent)` 
        }} 
      />

      {/* 卡片内容 */}
      <div className="relative p-5">
        <div className="flex items-start gap-4">
          {/* 头像 */}
          <div className="relative flex-shrink-0">
            {/* 头像背后的光晕 */}
            <div
              className="absolute -inset-2 rounded-full opacity-30 blur-md transition-opacity group-hover:opacity-50"
              style={{ backgroundColor: themeColor }}
            />
            <div className="relative h-14 w-14 rounded-full overflow-hidden ring-2 ring-[var(--border-subtle)] group-hover:ring-[var(--border-hover)] transition-all bg-[var(--bg-secondary)]">
              {!showFallback ? (
                <Image
                  src={avatar}
                  alt={name}
                  fill
                  sizes="56px"
                  onLoad={handleImageLoad}
                  onError={() => setImageError(true)}
                  className={imageClass}
                />
              ) : (
                <div
                  className="h-full w-full flex items-center justify-center text-white text-lg font-bold"
                  style={{ backgroundColor: themeColor }}
                >
                  {name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          </div>

          {/* 信息区域 */}
          <div className="flex-1 min-w-0 pt-1">
            <h3 className="flex items-center gap-2 font-bold text-[var(--text-primary)] text-lg truncate tracking-wide">
              {name}
              <ExternalLink className="h-4 w-4 text-[var(--text-muted)] opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
            </h3>
            <p className="mt-1.5 text-sm text-[var(--text-secondary)] line-clamp-2 leading-relaxed font-medium">
              {description || '这个人很懒，什么都没写~'}
            </p>
          </div>
        </div>
      </div>

      {/* 悬浮边框高亮 */}
      <div
        className="absolute inset-0 rounded-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ boxShadow: `inset 0 0 0 1px ${themeColor}60` }}
      />
    </a>
  );
};

export default FriendCard;
