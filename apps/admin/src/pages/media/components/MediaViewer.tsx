/**
 * @file MediaViewer.tsx
 * @description 媒体预览查看器组件 - 审美优化版 (Quick Look 风格)
 * @ref §3.2.4 - 媒体管理模块
 */

import React, { useState, useEffect, useCallback } from 'react';
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
  FileText
} from 'lucide-react';
import { cn, formatFileSize } from '@/lib/utils';
import { MediaItem, getMediaUrl } from '@/services/mediaService';

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
  const currentItem = items[currentIndex];
  
  useEffect(() => {
    setRotation(0);
    setIsZoomed(false);
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

  const handleDownloadClick = useCallback(() => {
    if (currentItem) {
      onDownload(getMediaUrl(currentItem.fileUrl), currentItem.originalName);
    }
  }, [currentItem, onDownload]);

  if (!currentItem) return null;

  const fullUrl = getMediaUrl(currentItem.fileUrl);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 md:p-12">
      {/* 核心背景遮罩 (超重毛玻璃) */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-2xl"
      />

      {/* 模态框容器 (精致比例 & 毛玻璃容器) */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className={cn(
          "relative z-10 w-full max-w-6xl h-full max-h-[85vh]",
          "flex flex-col rounded-[2.5rem] overflow-hidden shadow-[0_0_80px_rgba(0,0,0,0.5)]",
          "bg-white/5 border border-white/10 backdrop-blur-md"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部精致工具栏 */}
        <div className="flex items-center justify-between px-8 py-6 bg-gradient-to-b from-black/20 to-transparent">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
               <ImageIcon className="w-5 h-5 text-primary" />
            </div>
            <div className="flex flex-col">
              <h3 className="text-white text-base font-semibold truncate max-w-[300px]">
                {currentItem.originalName}
              </h3>
              <p className="text-[10px] text-white/50 tracking-wider">
                {currentIndex + 1} OF {items.length} • {formatFileSize(currentItem.fileSize)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-black/20 backdrop-blur-md border border-white/5">
            {currentItem.fileType === 'IMAGE' && (
              <>
                <button
                  onClick={() => setRotation(prev => (prev + 90) % 360)}
                  className="p-2.5 text-white/60 hover:text-white hover:bg-white/10 rounded-xl transition-all"
                  title="旋转"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsZoomed(!isZoomed)}
                  className="p-2.5 text-white/60 hover:text-white hover:bg-white/10 rounded-xl transition-all"
                  title={isZoomed ? "缩小" : "放大"}
                >
                  {isZoomed ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
              </>
            )}
            <button
              onClick={handleDownloadClick}
              className="p-2.5 text-white/60 hover:text-white hover:bg-white/10 rounded-xl transition-all"
              title="下载"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={() => onDelete(currentItem.id)}
              className="p-2.5 text-red-400/60 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all"
              title="删除"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-white/10 mx-1" />
            <button
              onClick={onClose}
              className="p-2.5 text-white/60 hover:text-white hover:bg-white/10 rounded-xl transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 主展示区 */}
        <div className="flex-1 relative flex items-center justify-center overflow-hidden px-8 pb-8">
          {/* 上一页 悬浮按钮 (更扁平化) */}
          <button
            onClick={onPrev}
            className={cn(
              "absolute left-8 z-20 p-4 rounded-full bg-white/0 hover:bg-white/5 text-white/30 hover:text-white transition-all",
              currentIndex === 0 && "invisible"
            )}
          >
            <ChevronLeft className="w-10 h-10" />
          </button>

          {/* 媒体核心 */}
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

          {/* 下一页 悬浮按钮 */}
          <button
            onClick={onNext}
            className={cn(
              "absolute right-8 z-20 p-4 rounded-full bg-white/0 hover:bg-white/5 text-white/30 hover:text-white transition-all",
              currentIndex === items.length - 1 && "invisible"
            )}
          >
            <ChevronRight className="w-10 h-10" />
          </button>
        </div>

        {/* 精致缩略图页脚导航 */}
        <div className="h-28 bg-black/20 border-t border-white/5 px-8 flex items-center justify-center">
          <div className="flex gap-3 overflow-x-auto no-scrollbar scroll-smooth">
            {items.map((item, index) => (
              <button
                key={item.id}
                onClick={() => onSelectIndex(index)}
                className={cn(
                  "relative flex-shrink-0 w-20 h-14 rounded-xl overflow-hidden border-2 transition-all duration-300",
                  index === currentIndex 
                    ? "border-primary scale-110 shadow-lg" 
                    : "border-transparent opacity-40 hover:opacity-100 hover:scale-105"
                )}
              >
                 {item.fileType === 'IMAGE' ? (
                   <img src={getMediaUrl(item.fileUrl)} className="w-full h-full object-cover" alt="" />
                 ) : (
                   <div className="w-full h-full bg-white/5 flex items-center justify-center">
                     {item.fileType === 'VIDEO' ? (
                        <RotateCw className="w-4 h-4 text-white/30 animate-spin" />
                      ) : (
                        <ImageIcon className="w-4 h-4 text-white/30" />
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
