'use client';

import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { spring, transition } from '@aetherblog/ui';
import {
  markCachedImageFailed,
  markCachedImageLoaded,
  useCachedImage,
} from '@aetherblog/hooks';
import { sanitizeImageUrl } from '../lib/sanitizeUrl';

interface FriendCardProps {
  name: string;
  url: string;
  avatar: string;
  description?: string;
  themeColor?: string;
  /** 入场延迟(秒) — 由父级按索引编排,形成 iOS 通知逐条落入的节奏 */
  enterDelay?: number;
}

/** 从 URL 提取展示用域名 —— 充当 iOS 通知右上角"时间戳"的位置 */
function displayDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const FriendCardBase: React.FC<FriendCardProps> = ({
  name,
  url,
  avatar,
  description,
  themeColor = '#6366f1',
  enterDelay = 0,
}) => {
  // 智能检测图片宽高比:正方形填满,非正方形留白适配
  const [isSquareImage, setIsSquareImage] = useState<boolean | null>(null);

  // themeColor 兜底:DB 里可能存空字符串,默认参数只拦 undefined ——
  // 空串会让 linear-gradient 失效,头像加载失败时渲染成"黑洞球"(产线旧 bug)。
  const brandColor = themeColor.trim() !== '' ? themeColor : '#6366f1';

  // 安全验证: 防止 XSS 注入 (#136)
  const safeAvatar = sanitizeImageUrl(avatar, '');
  const safeUrl = sanitizeImageUrl(url, '#');

  const hasValidAvatar = safeAvatar !== '' && safeAvatar.trim() !== '';
  const cachedAvatar = useCachedImage(hasValidAvatar ? safeAvatar : '', {
    enabled: hasValidAvatar,
    timeoutMs: 5000,
  });

  const handleImageLoad = (img: HTMLImageElement) => {
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    setIsSquareImage(aspectRatio >= 0.7 && aspectRatio <= 1.4);
    markCachedImageLoaded(safeAvatar, img.naturalWidth || undefined, img.naturalHeight || undefined);
  };

  const imageClass = !cachedAvatar.isLoaded || isSquareImage === null
    ? 'h-full w-full object-contain p-1 opacity-0'
    : isSquareImage
      ? 'h-full w-full object-cover opacity-100 transition-opacity duration-[var(--dur-quick)] ease-[var(--ease-out)]'
      : 'h-full w-full object-contain p-1 opacity-100 transition-opacity duration-[var(--dur-quick)] ease-[var(--ease-out)]';

  const showFallback = !hasValidAvatar || cachedAvatar.isError;
  const domain = displayDomain(safeUrl);

  // iOS 通知落入:自下方 24px 带 3% 缩放,soft 弹簧回正;
  // 退场用于「收起通知组」时的快速消散。
  const cardVariants = useMemo(
    () => ({
      initial: { opacity: 0, y: 24, scale: 0.97 },
      animate: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { ...spring.soft, delay: enterDelay },
      },
      exit: { opacity: 0, y: -6, scale: 0.98, transition: { ...transition.quick } },
    }),
    [enterDelay],
  );

  return (
    <motion.a
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      whileTap={{ scale: 0.98, transition: { ...spring.precise } }}
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`访问 ${name} 的网站`}
      data-interactive
      className="group surface-leaf relative block overflow-hidden rounded-2xl px-4 py-3.5 antialiased focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-void)] md:px-5 md:py-4"
      // 用友链品牌色本地覆盖 --aurora-1:hover 光带 / 边框辉光跟随各站品牌,
      // 既保留 surface 系统交互一致性,又让每封"信笺"带上寄信人的色彩。
      style={{ ['--aurora-1' as string]: brandColor }}
    >
      <div className="relative flex items-start gap-3.5 md:gap-4">
        {/* 头像 —— iOS 应用图标式 squircle */}
        <div className="relative flex-shrink-0">
          {/* 品牌色底晕:hover 时从图标后方透出 */}
          <div
            className="absolute -inset-1.5 rounded-[var(--radius-md)] opacity-0 blur-md transition-opacity duration-[var(--dur-quick)] ease-[var(--ease-out)] group-hover:opacity-35"
            style={{ backgroundColor: brandColor }}
            aria-hidden="true"
          />
          <div className="relative h-11 w-11 overflow-hidden rounded-[var(--radius-md)] bg-[var(--bg-raised)] ring-1 ring-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] md:h-12 md:w-12">
            {!showFallback ? (
              <Image
                src={safeAvatar}
                alt={name}
                fill
                sizes="48px"
                onLoadingComplete={handleImageLoad}
                onError={() => markCachedImageFailed(safeAvatar)}
                className={imageClass}
                aria-hidden="true"
                /* 友链头像来自任意外部域名,无法穷举白名单 —
                   关闭 next/image 域名校验,48px 小图无需 srcset 优化 */
                unoptimized
              />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center"
                style={{ background: `linear-gradient(145deg, ${brandColor}, ${brandColor}cc)` }}
              >
                <span className="text-body font-semibold text-white">
                  {name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            {/* 顶部球面高光弧 —— Apple 图标的玻璃质感 */}
            <div
              className="pointer-events-none absolute inset-0 z-[2]"
              style={{
                background:
                  'radial-gradient(ellipse 75% 45% at 50% 10%, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.04) 55%, transparent 75%)',
              }}
              aria-hidden="true"
            />
          </div>
        </div>

        {/* 信息区 —— iOS 通知的「标题 + 正文」,右上角域名充当时间戳位 */}
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="truncate text-body font-semibold tracking-tight text-[var(--ink-primary)]">
              {name}
            </h3>
            {domain && (
              <span className="flex max-w-[45%] flex-shrink-0 items-center gap-1 font-mono text-micro text-[var(--ink-muted)] transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)] group-hover:text-[var(--ink-secondary)]">
                <span className="truncate">{domain}</span>
                <ArrowUpRight
                  className="h-3 w-3 flex-shrink-0 -translate-x-0.5 translate-y-0.5 opacity-0 transition-all duration-[var(--dur-quick)] ease-[var(--ease-out)] group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100"
                  aria-hidden="true"
                />
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-caption leading-relaxed text-[var(--ink-secondary)]">
            {description || '这位朋友很低调，还没有留下自我介绍。'}
          </p>
        </div>
      </div>
    </motion.a>
  );
};

// React.memo:父级展开/收起通知组时避免已挂载卡片的 O(n) 重渲染
export const FriendCard = React.memo(FriendCardBase);
FriendCard.displayName = 'FriendCard';
export default FriendCard;
