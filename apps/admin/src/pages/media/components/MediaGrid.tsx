/**
 * @file MediaGrid.tsx
 * @description 媒体网格视图组件 - 视觉审美优化 (Cognitive Elegance)
 * @ref §3.2.4 - 媒体管理模块
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Image, Video, Music, FileText, Check, Trash2, Download, Link2, Eye, FolderInput } from 'lucide-react';
import { cn, formatFileSize } from '@/lib/utils';
import { MediaItem, MediaType, getMediaUrl } from '@/services/mediaService';

interface MediaGridProps {
  items: MediaItem[];
  selectedIds: Set<number>;
  onSelect: (id: number) => void;
  onToggleSelect: (id: number) => void;
  onPreview: (id: number) => void;
  onDelete: (id: number) => void;
  onCopyUrl: (url: string) => void;
  onDownload: (url: string, filename: string) => void;
  onMove?: (id: number, name: string) => void;
  selectionMode: boolean;
  isCompact?: boolean;
}

const typeIcons: Record<MediaType, typeof Image> = {
  IMAGE: Image,
  VIDEO: Video,
  AUDIO: Music,
  DOCUMENT: FileText,
};

/**
 * 媒体网格视图组件
 */
export function MediaGrid({
  items,
  selectedIds,
  onSelect,
  onToggleSelect,
  onPreview,
  onDelete,
  onCopyUrl,
  onDownload,
  onMove,
  selectionMode,
  isCompact = false,
}: MediaGridProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-6">
      <AnimatePresence mode="popLayout">
        {items.map((item, index) => {
          const Icon = typeIcons[item.fileType] || FileText;
          const isSelected = selectedIds.has(item.id);
          const fullUrl = getMediaUrl(item.fileUrl);

          return (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ 
                type: 'spring', 
                stiffness: 300, 
                damping: 25,
                delay: index * 0.01 
              }}
              className="group flex flex-col gap-2"
              onContextMenu={(e) => {
                e.preventDefault();
                onToggleSelect(item.id);
              }}
            >
              {/* 1. 媒体内容容器 (缩略图) */}
              <div 
                className={cn(
                  'relative aspect-square rounded-2xl overflow-hidden cursor-pointer',
                  'bg-[var(--bg-card)] border-2 transition-all duration-300',
                  isSelected
                    ? 'border-primary ring-4 ring-primary/20 scale-[0.98]'
                    : 'border-gray-200/60 dark:border-white/5 shadow-sm hover:border-[var(--border-subtle)] hover:shadow-xl hover:-translate-y-1'
                )}
                onClick={() => onSelect(item.id)}
              >
                {/* 图片/图标 */}
                <div className="w-full h-full relative">
                  {item.fileType === 'IMAGE' ? (
                    <img
                      src={fullUrl}
                      alt={item.originalName}
                      className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : item.fileType === 'VIDEO' ? (
                    <video
                      src={fullUrl}
                      className="w-full h-full object-cover"
                      muted
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[var(--bg-secondary)] to-transparent">
                      <Icon className="w-16 h-16 text-[var(--text-muted)] group-hover:scale-110 transition-transform duration-500" />
                    </div>
                  )}
                  
                  {/* Hover 遮罩 - 加深以突出白色图标 */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-300" />
                </div>

                {/* 预览按钮 (中心透明) */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <motion.div
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    className={cn(
                      'flex items-center justify-center text-white/80 dark:text-white/60 hover:text-white drop-shadow-lg',
                      'opacity-0 group-hover:opacity-100 transition-all duration-300',
                      'pointer-events-auto cursor-pointer'
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPreview(item.id);
                    }}
                  >
                    <Eye className={cn('drop-shadow-lg', isCompact ? 'w-7 h-7' : 'w-10 h-10')} strokeWidth={1.5} />
                  </motion.div>
                </div>

                {/* 选择框 (左上角) */}
                <div 
                  className="absolute top-2 left-2 z-20 pointer-events-auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSelect(item.id);
                  }}
                >
                  <div className={cn(
                    'w-5 h-5 rounded-md flex items-center justify-center border transition-all duration-200',
                    isSelected 
                      ? 'bg-primary border-primary shadow-sm' 
                      : 'bg-black/20 backdrop-blur-sm border-white/30 hover:bg-black/40 hover:border-white/60 opacity-0 group-hover:opacity-100'
                  )}>
                    {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                  </div>
                </div>

                {/* 底部悬浮工具条 - 仅在非紧凑模式显示 */}
                {!isCompact && (
                  <div className="absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none">
                    <div
                      className={cn(
                        'flex items-center gap-0.5 p-1',
                        'bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-full shadow-lg border border-black/5 dark:border-white/10',
                        'translate-y-4 opacity-0 scale-95 group-hover:translate-y-0 group-hover:opacity-100 group-hover:scale-100 transition-all duration-300 ease-out',
                        'pointer-events-auto'
                      )}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {onMove && (
                        <button
                          onClick={() => onMove(item.id, item.originalName)}
                          className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
                          title="移动"
                        >
                          <FolderInput className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => onCopyUrl(fullUrl)}
                        className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
                        title="复制链接"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDownload(fullUrl, item.originalName)}
                        className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
                        title="下载"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <div className="w-px h-3 bg-gray-200 dark:bg-white/20 mx-1" />
                      <button
                        onClick={() => onDelete(item.id)}
                        className="p-1.5 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500/80 hover:text-red-500 transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 2. 底部文件名 (元数据) */}
              <div className="px-1 text-center group-hover:text-primary transition-colors">
                <p 
                  className="text-xs font-medium text-[var(--text-secondary)] truncate w-full" 
                  title={item.originalName}
                >
                  {item.originalName}
                </p>
                <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                  {formatFileSize(item.fileSize)}
                </p>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export default MediaGrid;
