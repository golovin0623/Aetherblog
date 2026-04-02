/**
 * @file MediaViewer.tsx
 * @description 媒体预览查看器组件 - 审美优化版 (Quick Look 风格)
 * @ref §3.2.4 - 媒体管理模块
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Download,
  Trash2,
  Maximize2,
  Minimize2,
  Image as ImageIcon,
  FileText,
  MoreHorizontal
} from 'lucide-react';
import { cn, formatFileSize } from '@/lib/utils';
import { MediaItem, getMediaUrl } from '@/services/mediaService';
import { useMediaQuery } from '@/hooks';

interface MediaViewerProps {
  items: MediaItem[];
  currentIndex: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSelectIndex: (index: number) => void;
  onDelete: (id: number) => void;
  onDownload: (url: string, filename: string) => void;
}

/** 渲染单个媒体幻灯片（移动端轮播与桌面端视图共用） */
const MediaSlide: React.FC<{
  item: MediaItem;
  rotation: number;
  isZoomed: boolean;
  onZoomToggle: () => void;
}> = ({ item, rotation, isZoomed, onZoomToggle }) => {
  const url = getMediaUrl(item.fileUrl);
  if (item.fileType === 'IMAGE') {
    return (
      <div
        className="relative w-full h-full flex items-center justify-center will-change-transform"
        style={{
          transform: `rotate(${rotation}deg) scale(${isZoomed ? 1.5 : 1})`,
          transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)'
        }}
      >
        <img
          src={url}
          alt={item.originalName}
          className={cn(
            "max-w-full max-h-full object-contain rounded-lg shadow-2xl transform-gpu select-none",
            isZoomed ? "cursor-zoom-out" : "cursor-zoom-in"
          )}
          onClick={onZoomToggle}
          draggable={false}
        />
      </div>
    );
  }
  if (item.fileType === 'VIDEO') {
    return (
      <video
        src={url}
        controls
        autoPlay
        className="max-w-full max-h-full rounded-xl shadow-2xl border border-white/10"
      />
    );
  }
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="w-32 h-32 rounded-[2rem] bg-white/5 border border-white/10 flex items-center justify-center shadow-inner">
        {item.fileType === 'DOCUMENT' ? (
          <FileText className="w-16 h-16 text-primary/80" />
        ) : (
          <RotateCw className="w-16 h-16 text-primary/80 animate-spin" />
        )}
      </div>
      <div className="text-center">
        <p className="text-white text-xl font-medium mb-1">{item.originalName}</p>
        <p className="text-white/40 text-sm">此文件类型暂不支持直接预览</p>
      </div>
    </div>
  );
};

export const MediaViewer: React.FC<MediaViewerProps> = ({
  items,
  currentIndex,
  onClose,
  onNext,
  onPrev,
  onSelectIndex,
  onDelete,
  onDownload,
}) => {
  const [rotation, setRotation] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const thumbnailStripRef = useRef<HTMLDivElement>(null);
  const thumbnailRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const currentItem = items[currentIndex];
  const isMobile = useMediaQuery('(max-width: 768px)');

  // ====== 移动端轮播滑动状态（仿 Apple Photos 风格）======
  const trackRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0); // px offset during drag
  const [isAnimating, setIsAnimating] = useState(false); // spring-snap in progress
  const directionLocked = useRef<'h' | 'v' | null>(null);

  useEffect(() => {
    setRotation(0);
    setIsZoomed(false);
    setMobileMenuOpen(false);
  }, [currentIndex]);

  // 自动滚动缩略图条，使当前激活的缩略图居中显示
  useEffect(() => {
    const timer = setTimeout(() => {
      const thumb = thumbnailRefs.current[currentIndex];
      if (thumb && thumbnailStripRef.current) {
        const container = thumbnailStripRef.current;
        const thumbLeft = thumb.offsetLeft;
        const thumbWidth = thumb.offsetWidth;
        const containerWidth = container.clientWidth;
        const scrollTarget = Math.max(0, Math.min(
          thumbLeft - containerWidth / 2 + thumbWidth / 2,
          container.scrollWidth - containerWidth
        ));
        container.scrollTo({ left: scrollTarget, behavior: 'smooth' });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [currentIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onNext();
      if (e.key === 'ArrowLeft') onPrev();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onNext, onPrev]);

  // 点击外部区域时关闭移动端菜单
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleTap = () => setMobileMenuOpen(false);
    const timer = setTimeout(() => {
      window.addEventListener('click', handleTap, { once: true });
    }, 100);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleTap);
    };
  }, [mobileMenuOpen]);

  const handleDownloadClick = useCallback(() => {
    if (currentItem) {
      onDownload(getMediaUrl(currentItem.fileUrl), currentItem.originalName);
    }
  }, [currentItem, onDownload]);

  // ====== 触摸事件处理：仿 Apple Photos 连续轮播 ======
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile || isZoomed || isAnimating) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    directionLocked.current = null;
    setSwipeOffset(0);
  }, [isMobile, isZoomed, isAnimating]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || !isMobile || isZoomed) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;

    // 移动超过 8px 后锁定滑动方向
    if (!directionLocked.current) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        directionLocked.current = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      }
      return;
    }

    if (directionLocked.current !== 'h') return;

    // 水平滑动时阻止页面纵向滚动
    e.preventDefault();

    // 到达边缘时的橡皮筋阻力效果（iOS 风格）
    const atStart = currentIndex === 0 && dx > 0;
    const atEnd = currentIndex === items.length - 1 && dx < 0;
    if (atStart || atEnd) {
      // 对数阻尼，模仿 iOS 边缘弹性
      const sign = dx > 0 ? 1 : -1;
      const dampened = sign * Math.log2(1 + Math.abs(dx) * 0.15) * 20;
      setSwipeOffset(dampened);
    } else {
      setSwipeOffset(dx);
    }
  }, [isMobile, isZoomed, currentIndex, items.length]);

  const handleTouchEnd = useCallback(() => {
    if (!touchStartRef.current || !isMobile || directionLocked.current !== 'h') {
      touchStartRef.current = null;
      directionLocked.current = null;
      return;
    }

    const dx = swipeOffset;
    const elapsed = Date.now() - touchStartRef.current.time;
    // 速度（px/ms）
    const velocity = Math.abs(dx) / Math.max(elapsed, 1);

    // 判断阈值：快速轻弹（高速度）或拖动超过容器宽度的 30%
    const containerWidth = trackRef.current?.parentElement?.clientWidth || 300;
    const isQuickFlick = velocity > 0.4 && Math.abs(dx) > 30;
    const isDraggedFar = Math.abs(dx) > containerWidth * 0.3;

    let targetIndex = currentIndex;
    if (isQuickFlick || isDraggedFar) {
      if (dx < 0 && currentIndex < items.length - 1) {
        targetIndex = currentIndex + 1;
      } else if (dx > 0 && currentIndex > 0) {
        targetIndex = currentIndex - 1;
      }
    }

    // Animate snap-back (spring physics via CSS transition)
    setIsAnimating(true);
    setSwipeOffset(0);

    if (targetIndex !== currentIndex) {
      onSelectIndex(targetIndex);
    }

    // Wait for spring animation to finish
    setTimeout(() => setIsAnimating(false), 350);

    touchStartRef.current = null;
    directionLocked.current = null;
  }, [isMobile, swipeOffset, currentIndex, items.length, onSelectIndex]);

  // Reset swipe offset when index changes externally (e.g. thumbnail tap)
  useEffect(() => {
    setSwipeOffset(0);
  }, [currentIndex]);

  if (!currentItem) return null;

  const fullUrl = getMediaUrl(currentItem.fileUrl);

  // Visible slides for mobile carousel: only render [prev, current, next] for performance
  const visibleIndices = isMobile
    ? [currentIndex - 1, currentIndex, currentIndex + 1].filter(i => i >= 0 && i < items.length)
    : [currentIndex];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 md:p-12">
      {/* 背景遮罩 - 移动端使用更柔和的深色而非纯黑 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className={cn(
          "absolute inset-0 backdrop-blur-2xl",
          isMobile
            ? "bg-[var(--bg-primary)]/95"
            : "bg-black/60"
        )}
      />

      {/* 模态框容器 */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className={cn(
          "relative z-10 w-full max-w-6xl h-full",
          "flex flex-col overflow-hidden shadow-[0_0_80px_rgba(0,0,0,0.5)]",
          isMobile
            ? "max-h-full rounded-2xl bg-[var(--bg-primary)]"
            : "max-h-[85vh] rounded-[2.5rem] bg-[var(--bg-primary)] border border-[var(--border-subtle)] shadow-2xl"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部工具栏 */}
        {isMobile ? (
          /* ===== 移动端工具栏：紧凑两行布局 ===== */
          <div className="px-4 pt-4 pb-3 border-b border-[var(--border-subtle)]">
            {/* 第一行：文件信息 + 操作按钮 */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                  <ImageIcon className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[var(--text-primary)] text-sm font-semibold truncate">
                    {currentItem.originalName}
                  </h3>
                  <p className="text-[var(--text-secondary)] text-[10px] tracking-wider">
                    {currentIndex + 1} OF {items.length} • {formatFileSize(currentItem.fileSize)}
                  </p>
                </div>
              </div>
              {/* 移动端精简按钮组 */}
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button
                  onClick={handleDownloadClick}
                  className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg transition-all"
                  title="下载"
                >
                  <Download className="w-4 h-4" />
                </button>
                {/* 更多操作 */}
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setMobileMenuOpen(!mobileMenuOpen); }}
                    className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg transition-all"
                    title="更多"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                  {/* 下拉菜单 */}
                  <AnimatePresence>
                    {mobileMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] shadow-xl overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {currentItem.fileType === 'IMAGE' && (
                          <>
                            <button
                              onClick={() => { setRotation(prev => (prev + 90) % 360); setMobileMenuOpen(false); }}
                              className="flex items-center gap-3 w-full px-4 py-3 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
                            >
                              <RotateCw className="w-4 h-4" />
                              旋转
                            </button>
                            <button
                              onClick={() => { setIsZoomed(!isZoomed); setMobileMenuOpen(false); }}
                              className="flex items-center gap-3 w-full px-4 py-3 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
                            >
                              {isZoomed ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                              {isZoomed ? '缩小' : '放大'}
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => { onDelete(currentItem.id); setMobileMenuOpen(false); }}
                          className="flex items-center gap-3 w-full px-4 py-3 text-sm text-status-danger hover:bg-status-danger-light transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                          删除
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* ===== 桌面端工具栏（保持原样）===== */
          <div className="flex items-center justify-between px-8 py-6 border-b border-[var(--border-subtle)]">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                 <ImageIcon className="w-5 h-5 text-primary" />
              </div>
              <div className="flex flex-col">
                <h3 className="text-[var(--text-primary)] text-base font-semibold truncate max-w-[300px]">
                  {currentItem.originalName}
                </h3>
                <p className="text-[var(--text-secondary)] text-[10px] tracking-wider">
                  {currentIndex + 1} OF {items.length} • {formatFileSize(currentItem.fileSize)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] shadow-sm">
              {currentItem.fileType === 'IMAGE' && (
                <>
                  <button
                    onClick={() => setRotation(prev => (prev + 90) % 360)}
                    className="p-2.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] rounded-xl transition-all"
                    title="旋转"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setIsZoomed(!isZoomed)}
                    className="p-2.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] rounded-xl transition-all"
                    title={isZoomed ? "缩小" : "放大"}
                  >
                    {isZoomed ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  </button>
                </>
              )}
              <button
                onClick={handleDownloadClick}
                className="p-2.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] rounded-xl transition-all"
                title="下载"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={() => onDelete(currentItem.id)}
                className="p-2.5 text-status-danger hover:text-status-danger hover:bg-status-danger-light rounded-xl transition-all"
                title="删除"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <div className="w-px h-4 bg-[var(--border-subtle)] mx-1" />
              <button
                onClick={onClose}
                className="p-2.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* 主展示区 */}
        <div
          className={cn(
            "flex-1 relative flex items-center justify-center overflow-hidden",
            isMobile ? "px-0 pb-0" : "px-8 pb-8"
          )}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {isMobile ? (
            /* ===== 移动端：Apple Photos 连续轮播 ===== */
            <div className="relative w-full h-full overflow-hidden">
              <div
                ref={trackRef}
                className="flex h-full will-change-transform"
                style={{
                  // Each slide is 100% width; translate by currentIndex + drag offset
                  transform: `translateX(calc(-${currentIndex * 100}% + ${swipeOffset}px))`,
                  transition: swipeOffset !== 0
                    ? 'none'  // Instant tracking while dragging
                    : 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)', // Spring-like snap
                }}
              >
                {items.map((item, index) => {
                  // Only render content for visible slides (perf optimization)
                  const isVisible = visibleIndices.includes(index);
                  return (
                    <div
                      key={item.id}
                      className="w-full h-full flex-shrink-0 flex items-center justify-center px-3"
                    >
                      {isVisible && (
                        <MediaSlide
                          item={item}
                          rotation={index === currentIndex ? rotation : 0}
                          isZoomed={index === currentIndex ? isZoomed : false}
                          onZoomToggle={() => {
                            if (index === currentIndex) setIsZoomed(!isZoomed);
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* ===== 桌面端：原始 AnimatePresence 过渡 ===== */
            <>
              <button
                onClick={onPrev}
                className={cn(
                  "absolute left-8 z-20 p-4 rounded-full transition-all border border-[var(--border-subtle)] shadow-lg",
                  "bg-[var(--bg-card)]/80 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] backdrop-blur-sm",
                  currentIndex === 0 && "invisible"
                )}
              >
                <ChevronLeft className="w-6 h-6" />
              </button>

              <div className="relative w-full h-full flex items-center justify-center">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentItem.id}
                    initial={{ opacity: 0, scale: 0.98, x: 10 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 1.02, x: -10 }}
                    transition={{ type: 'spring', damping: 30, stiffness: 200 }}
                    className="w-full h-full flex items-center justify-center"
                  >
                    <MediaSlide
                      item={currentItem}
                      rotation={rotation}
                      isZoomed={isZoomed}
                      onZoomToggle={() => setIsZoomed(!isZoomed)}
                    />
                  </motion.div>
                </AnimatePresence>
              </div>

              <button
                onClick={onNext}
                className={cn(
                  "absolute right-8 z-20 p-4 rounded-full transition-all border border-[var(--border-subtle)] shadow-lg",
                  "bg-[var(--bg-card)]/80 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] backdrop-blur-sm",
                  currentIndex === items.length - 1 && "invisible"
                )}
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </>
          )}
        </div>

        {/* 精致缩略图导航 - Filmstrip 风格 */}
        <div className={cn(
          "relative flex items-center justify-center border-t border-[var(--border-subtle)]",
          isMobile
            ? "h-[72px] px-3 pb-[max(0.25rem,env(safe-area-inset-bottom))]"
            : "h-28 px-8",
          "bg-gradient-to-t from-[var(--bg-primary)] to-[var(--bg-card)]"
        )}>
          {/* 左右渐隐遮罩 - 提示可滚动 */}
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 md:w-16 z-10 bg-gradient-to-r from-[var(--bg-primary)] to-transparent" />
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 md:w-16 z-10 bg-gradient-to-l from-[var(--bg-primary)] to-transparent" />

          <div
            ref={thumbnailStripRef}
            className={cn(
              "flex overflow-x-auto no-scrollbar scroll-smooth items-center",
              isMobile ? "gap-2 px-4" : "gap-3 px-12"
            )}
          >
            {items.map((item, index) => {
              const isActive = index === currentIndex;
              return (
                <button
                  key={item.id}
                  ref={(el) => { thumbnailRefs.current[index] = el; }}
                  onClick={() => onSelectIndex(index)}
                  className={cn(
                    "group relative flex-shrink-0 overflow-hidden transition-all duration-300 ease-out",
                    isMobile
                      ? "rounded-lg"
                      : "rounded-xl",
                    isActive
                      ? cn(
                          isMobile ? "w-12 h-12" : "w-[4.5rem] h-16",
                          "ring-2 ring-primary/50 shadow-lg shadow-primary/25 scale-105 z-10"
                        )
                      : cn(
                          isMobile ? "w-10 h-10" : "w-16 h-12",
                          "opacity-50 hover:opacity-80 hover:scale-105 ring-1 ring-white/10"
                        )
                  )}
                >
                  {/* Active glow underlay */}
                  {isActive && (
                    <div className="absolute -inset-1 bg-primary/20 rounded-xl blur-md -z-10" />
                  )}
                  {item.fileType === 'IMAGE' ? (
                    <img
                      src={getMediaUrl(item.fileUrl)}
                      className="w-full h-full object-cover"
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <div className={cn(
                      "w-full h-full flex items-center justify-center",
                      "bg-[var(--bg-secondary)]"
                    )}>
                      {item.fileType === 'VIDEO' ? (
                        <RotateCw className={cn(
                          "text-[var(--text-muted)] animate-spin",
                          isMobile ? "w-3.5 h-3.5" : "w-4 h-4"
                        )} />
                      ) : (
                        <ImageIcon className={cn(
                          "text-[var(--text-muted)]",
                          isMobile ? "w-3.5 h-3.5" : "w-4 h-4"
                        )} />
                      )}
                    </div>
                  )}
                  {/* Subtle inner border for depth */}
                  <div className="absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10 pointer-events-none" />
                </button>
              );
            })}
          </div>
        </div>
      </motion.div>
    </div>
  );
};
