/**
 * @file MediaGrid.tsx
 * @description 媒体网格视图组件 - 视觉审美优化 (Cognitive Elegance)
 * @ref §3.2.4 - 媒体管理模块
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Image, Video, Music, FileText, Check, Trash2, Download, Link2, Eye } from 'lucide-react';
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
  selectionMode: boolean;
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
  selectionMode,
}: MediaGridProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
      <AnimatePresence mode="popLayout">
        {items.map((item, index) => {
          const Icon = typeIcons[item.fileType] || FileText;
          const isSelected = selectedIds.has(item.id);
          const fullUrl = getMediaUrl(item.fileUrl);

          return (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ 
                type: 'spring', 
                stiffness: 300, 
                damping: 25,
                delay: index * 0.01 
              }}
              onClick={() => onSelect(item.id)}
              className={cn(
                'relative aspect-square rounded-2xl overflow-hidden cursor-pointer group',
                'bg-white/5 border-2 transition-all duration-500',
                isSelected
                  ? 'border-primary ring-4 ring-primary/20 scale-[0.98]'
                  : 'border-transparent hover:border-white/20 hover:shadow-2xl hover:shadow-primary/5'
              )}
            >
              {/* 媒体内容容器 */}
              <div className="w-full h-full relative">
                {item.fileType === 'IMAGE' ? (
                  <img
                    src={fullUrl}
                    alt={item.originalName}
                    className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                    loading="lazy"
                  />
                ) : item.fileType === 'VIDEO' ? (
                  <video
                    src={fullUrl}
                    className="w-full h-full object-cover"
                    muted
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-white/10 to-transparent">
                    <Icon className="w-16 h-16 text-gray-400 group-hover:scale-110 transition-transform duration-500" />
                  </div>
                )}

                {/* 背景毛玻璃遮罩 (仅在 hover 时加强) */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-500" />
              </div>

              {/* [核心改进] 居中半透明预览按钮 (Eye Icon) */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  className={cn(
                    'w-14 h-14 rounded-full flex items-center justify-center',
                    'bg-white/10 backdrop-blur-md border border-white/20 text-white',
                    'opacity-0 group-hover:opacity-100 transition-all duration-300',
                    'pointer-events-auto cursor-pointer shadow-lg'
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPreview(item.id);
                  }}
                >
                  <Eye className="w-7 h-7" />
                </motion.button>
              </div>

              {/* 多选框 - 优雅版本 */}
              <div 
                className="absolute top-3 left-3 z-20 pointer-events-auto"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect(item.id);
                }}
              >
                <div className={cn(
                  'w-6 h-6 rounded-lg flex items-center justify-center border-2 transition-all duration-300',
                  isSelected 
                    ? 'bg-primary border-primary scale-110 shadow-lg' 
                    : 'bg-black/30 backdrop-blur-sm border-white/30 opacity-0 group-hover:opacity-100'
                )}>
                  {isSelected && <Check className="w-4 h-4 text-white" />}
                </div>
              </div>

              {/* 底部悬浮操作条 (细长毛玻璃风格) */}
              <div
                className={cn(
                  'absolute bottom-3 left-3 right-3 h-10 px-2',
                  'bg-black/40 backdrop-blur-md border border-white/10 rounded-xl',
                  'flex items-center justify-between gap-1',
                  'translate-y-12 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500 ease-out'
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex-1 min-w-0 pr-2">
                  <p className="text-[10px] text-white/80 font-medium truncate">{item.originalName}</p>
                </div>
                
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => onCopyUrl(fullUrl)}
                    className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
                    title="复制链接"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDownload(fullUrl, item.originalName)}
                    className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
                    title="下载"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDelete(item.id)}
                    className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400/80 hover:text-red-400 transition-colors"
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export default MediaGrid;
