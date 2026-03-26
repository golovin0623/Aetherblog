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

  // Touch/swipe state
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const touchDeltaRef = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const isSwiping = useRef(false);

  useEffect(() => {
    setRotation(0);
    setIsZoomed(false);
    setMobileMenuOpen(false);
  }, [currentIndex]);

  // Auto-scroll thumbnail strip to center the active thumbnail
  useEffect(() => {
    // Small delay to ensure DOM is updated after index change
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

  // Close mobile menu on outside tap
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleTap = () => setMobileMenuOpen(false);
    // Delay to avoid closing immediately
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

  // Touch handlers for swipe navigation (mobile only)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile || isZoomed) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    touchDeltaRef.current = 0;
    isSwiping.current = false;
  }, [isMobile, isZoomed]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || !isMobile || isZoomed) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;

    // Determine if this is a horizontal swipe (lock direction after threshold)
    if (!isSwiping.current && Math.abs(deltaX) > 10) {
      // Only start swiping if horizontal movement is dominant
      if (Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        isSwiping.current = true;
      }
    }

    if (isSwiping.current) {
      e.preventDefault();
      touchDeltaRef.current = deltaX;
      // Add resistance at edges
      const atStart = currentIndex === 0 && deltaX > 0;
      const atEnd = currentIndex === items.length - 1 && deltaX < 0;
      const resistance = (atStart || atEnd) ? 0.3 : 1;
      setSwipeOffset(deltaX * resistance);
    }
  }, [isMobile, isZoomed, currentIndex, items.length]);

  const handleTouchEnd = useCallback(() => {
    if (!touchStartRef.current || !isMobile) return;
    const deltaX = touchDeltaRef.current;
    const elapsed = Date.now() - touchStartRef.current.time;

    // Determine if swipe should trigger navigation
    const isQuickSwipe = Math.abs(deltaX) > 50 && elapsed < 300;
    const isLongSwipe = Math.abs(deltaX) > 100;

    if (isSwiping.current && (isQuickSwipe || isLongSwipe)) {
      if (deltaX < 0 && currentIndex < items.length - 1) {
        onNext();
      } else if (deltaX > 0 && currentIndex > 0) {
        onPrev();
      }
    }

    touchStartRef.current = null;
    touchDeltaRef.current = 0;
    isSwiping.current = false;
    setSwipeOffset(0);
  }, [isMobile, currentIndex, items.length, onNext, onPrev]);

  if (!currentItem) return null;

  const fullUrl = getMediaUrl(currentItem.fileUrl);

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
            isMobile ? "px-2 pb-2" : "px-8 pb-8"
          )}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* 上一页 悬浮按钮 - 仅桌面端显示 */}
          {!isMobile && (
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
          )}

          {/* 媒体核心 */}
          <div className="relative w-full h-full flex items-center justify-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentItem.id}
                initial={{ opacity: 0, scale: 0.98, x: 10 }}
                animate={{ opacity: 1, scale: 1, x: swipeOffset }}
                exit={{ opacity: 0, scale: 1.02, x: -10 }}
                transition={swipeOffset !== 0
                  ? { x: { duration: 0 } }
                  : { type: 'spring', damping: 30, stiffness: 200 }
                }
                className="w-full h-full flex items-center justify-center"
              >
                {currentItem.fileType === 'IMAGE' ? (
                  <div
                    className="relative w-full h-full flex items-center justify-center will-change-transform"
                    style={{
                      transform: `rotate(${rotation}deg) scale(${isZoomed ? 1.5 : 1})`,
                      transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)'
                    }}
                  >
                    <img
                      src={fullUrl}
                      alt={currentItem.originalName}
                      className={cn(
                        "max-w-full max-h-full object-contain rounded-lg shadow-2xl transform-gpu",
                        isZoomed ? "cursor-zoom-out" : "cursor-zoom-in"
                      )}
                      onClick={() => setIsZoomed(!isZoomed)}
                      draggable={false}
                    />
                  </div>
                ) : currentItem.fileType === 'VIDEO' ? (
                  <video
                    src={fullUrl}
                    controls
                    autoPlay
                    className="max-w-full max-h-full rounded-xl shadow-2xl border border-white/10"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-6">
                    <div className="w-32 h-32 rounded-[2rem] bg-white/5 border border-white/10 flex items-center justify-center shadow-inner">
                      {currentItem.fileType === 'DOCUMENT' ? (
                        <FileText className="w-16 h-16 text-primary/80" />
                      ) : (
                        <RotateCw className="w-16 h-16 text-primary/80 animate-spin" />
                      )}
                    </div>
                    <div className="text-center">
                      <p className="text-white text-xl font-medium mb-1">{currentItem.originalName}</p>
                      <p className="text-white/40 text-sm">此文件类型暂不支持直接预览</p>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* 下一页 悬浮按钮 - 仅桌面端显示 */}
          {!isMobile && (
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
          )}
        </div>

        {/* 缩略图页脚导航 - 移动端缩小卡片，增加可见区域 */}
        <div className={cn(
          "bg-[var(--bg-card)] border-t border-[var(--border-subtle)] flex items-center justify-center",
          isMobile
            ? "h-16 px-3 pb-[max(0.25rem,env(safe-area-inset-bottom))]"
            : "h-28 px-8"
        )}>
          <div
            ref={thumbnailStripRef}
            className={cn(
              "flex overflow-x-auto no-scrollbar scroll-smooth",
              isMobile ? "gap-1.5" : "gap-3"
            )}
          >
            {items.map((item, index) => (
              <button
                key={item.id}
                ref={(el) => { thumbnailRefs.current[index] = el; }}
                onClick={() => onSelectIndex(index)}
                className={cn(
                  "relative flex-shrink-0 overflow-hidden transition-all duration-300",
                  isMobile
                    ? "w-10 h-10 rounded-md border-[1.5px]"
                    : "w-20 h-14 rounded-xl border-2",
                  index === currentIndex
                    ? "border-primary ring-2 ring-primary/30 shadow-lg shadow-primary/20"
                    : "border-transparent opacity-40 hover:opacity-100 hover:scale-105"
                )}
              >
                 {item.fileType === 'IMAGE' ? (
                   <img src={getMediaUrl(item.fileUrl)} className="w-full h-full object-cover" alt="" />
                 ) : (
                   <div className="w-full h-full bg-[var(--bg-card)] flex items-center justify-center border border-[var(--border-subtle)]">
                     {item.fileType === 'VIDEO' ? (
                        <RotateCw className="w-4 h-4 text-[var(--text-muted)] animate-spin" />
                      ) : (
                        <ImageIcon className="w-4 h-4 text-[var(--text-muted)]" />
                      )}
                   </div>
                 )}
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
};
