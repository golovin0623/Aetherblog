/**
 * @file MediaGrid.tsx
 * @description 媒体网格视图组件
 * @ref §3.2.4 - 媒体管理模块
 */

import { motion } from 'framer-motion';
import { Image, Video, Music, FileText, Check } from 'lucide-react';
import { cn, formatFileSize } from '@/lib/utils';
import { MediaItem, MediaType, getMediaUrl } from '@/services/mediaService';

interface MediaGridProps {
  items: MediaItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
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
export function MediaGrid({ items, selectedId, onSelect }: MediaGridProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {items.map((item, index) => {
        const Icon = typeIcons[item.fileType] || FileText;
        const isSelected = selectedId === item.id;
        const fullUrl = getMediaUrl(item.fileUrl);

        return (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.02 }}
            onClick={() => onSelect(item.id)}
            className={cn(
              'relative aspect-square rounded-xl overflow-hidden cursor-pointer group',
              'bg-white/5 border-2 transition-all duration-200',
              isSelected
                ? 'border-primary ring-2 ring-primary/30'
                : 'border-transparent hover:border-white/20'
            )}
          >
            {/* 预览区域 */}
            {item.fileType === 'IMAGE' ? (
              <img
                src={fullUrl}
                alt={item.originalName}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : item.fileType === 'VIDEO' ? (
              <video
                src={fullUrl}
                className="w-full h-full object-cover"
                muted
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-white/5 to-white/10">
                <Icon className="w-12 h-12 text-gray-500" />
              </div>
            )}

            {/* 选中指示 */}
            {isSelected && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary flex items-center justify-center shadow-lg"
              >
                <Check className="w-4 h-4 text-white" />
              </motion.div>
            )}

            {/* 悬停遮罩 */}
            <div
              className={cn(
                'absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent',
                'opacity-0 group-hover:opacity-100 transition-opacity',
                isSelected && 'opacity-100'
              )}
            >
              <div className="absolute bottom-0 left-0 right-0 p-3">
                <p className="text-sm text-white truncate">{item.originalName}</p>
                <p className="text-xs text-gray-400">{formatFileSize(item.fileSize)}</p>
              </div>
            </div>

            {/* 类型标识 */}
            {item.fileType !== 'IMAGE' && (
              <div className="absolute top-2 left-2 px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm">
                <Icon className="w-3 h-3 text-white" />
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

export default MediaGrid;
