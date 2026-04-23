/**
 * @file MediaGrid.tsx
 * @description 媒体网格视图 —— 迁移到 Aether Codex surface 层
 * @ref §3.2.4 - 媒体管理模块
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image, Video, Music, FileText, Check, Trash2, Download, Link2, Eye, FolderInput } from 'lucide-react';
import { useMediaQuery } from '@aetherblog/hooks';
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
  // 触摸设备没有 hover 态,需要以"激活项"显式管理工具条
  const isTouch = useMediaQuery('(hover: none) and (pointer: coarse)');
  const [activeId, setActiveId] = useState<number | null>(null);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-6">
      <AnimatePresence mode="popLayout">
        {items.map((item, index) => {
          const Icon = typeIcons[item.fileType] || FileText;
          const isSelected = selectedIds.has(item.id);
          const isActive = activeId === item.id;
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
              data-active={isActive || undefined}
              onContextMenu={(e) => {
                e.preventDefault();
                onToggleSelect(item.id);
              }}
            >
              {/* 1. 媒体内容容器 (缩略图) */}
              <div
                className={cn(
                  'relative aspect-square rounded-2xl overflow-hidden cursor-pointer',
                  'bg-[var(--bg-leaf,var(--bg-card))] border transition-[transform,box-shadow,border-color] duration-300 ease-out',
                  isSelected
                    ? 'border-[var(--aurora-1)] ring-2 ring-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] scale-[0.98]'
                    : cn(
                        'border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]',
                        'hover:border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)]',
                        'hover:shadow-[0_16px_40px_-20px_color-mix(in_oklch,var(--aurora-1)_35%,transparent)]',
                        'hover:-translate-y-0.5'
                      )
                )}
                onClick={() => {
                  // 触屏:首次点唤起工具条,第二次点进入选中态
                  if (isTouch && !isActive) {
                    setActiveId(item.id);
                    return;
                  }
                  onSelect(item.id);
                }}
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
                    <div className="w-full h-full flex items-center justify-center bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)]">
                      <Icon className="w-16 h-16 text-[var(--ink-tertiary,var(--text-muted))] group-hover:scale-110 transition-transform duration-500" strokeWidth={1.25} />
                    </div>
                  )}

                  {/* 交互遮罩 —— hover / active 时加深,突出白色图标 */}
                  <div
                    className={cn(
                      'absolute inset-0 transition-colors duration-300',
                      'bg-black/0 group-hover:bg-black/35',
                      'group-data-[active]:bg-black/45'
                    )}
                  />
                </div>

                {/* 预览按钮 (中心) —— 圆形胶囊,统一亮/暗模式;触屏跟随卡片宽度等比缩小 */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.92 }}
                    className={cn(
                      'inline-flex items-center justify-center rounded-full pointer-events-auto cursor-pointer',
                      'backdrop-blur-md bg-white/15 border border-white/25 text-white',
                      'shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]',
                      'opacity-0 group-hover:opacity-100 group-data-[active]:opacity-100',
                      'transition-[opacity,transform] duration-300 ease-out',
                      isCompact || isTouch ? 'w-10 h-10' : 'w-14 h-14'
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPreview(item.id);
                    }}
                    aria-label="预览"
                  >
                    <Eye className={cn(isCompact || isTouch ? 'w-4 h-4' : 'w-6 h-6')} strokeWidth={1.6} />
                  </motion.button>
                </div>

                {/* 选择框 (左上角) —— hover 或 active 时显现 */}
                <div
                  className="absolute top-2 left-2 z-20 pointer-events-auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSelect(item.id);
                  }}
                >
                  <div className={cn(
                    'w-6 h-6 rounded-md flex items-center justify-center border transition-all duration-200',
                    isSelected
                      ? 'bg-[var(--aurora-1)] border-[var(--aurora-1)] shadow-[0_4px_10px_-2px_color-mix(in_oklch,var(--aurora-1)_50%,transparent)]'
                      : 'bg-black/30 backdrop-blur-md border-white/40 hover:bg-black/50 hover:border-white/70 opacity-0 group-hover:opacity-100 group-data-[active]:opacity-100'
                  )}>
                    {isSelected && <Check className="w-4 h-4 text-white" strokeWidth={2.5} />}
                  </div>
                </div>

                {/* 底部悬浮工具条 —— Codex surface-raised 胶囊;触屏整体等比缩小避免左右被裁切 */}
                {!isCompact && (
                  <div
                    className={cn(
                      'absolute left-1/2 -translate-x-1/2 flex justify-center pointer-events-none max-w-[calc(100%-0.5rem)]',
                      isTouch ? 'bottom-2' : 'bottom-3'
                    )}
                  >
                    <div
                      className={cn(
                        'surface-raised !rounded-full flex items-center gap-0.5 p-1',
                        'translate-y-3 opacity-0 scale-95',
                        'group-hover:translate-y-0 group-hover:opacity-100 group-hover:scale-100',
                        'group-data-[active]:translate-y-0 group-data-[active]:opacity-100 group-data-[active]:scale-100',
                        'transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                        'pointer-events-auto'
                      )}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {onMove && (
                        <ToolbarIconButton
                          onClick={() => onMove(item.id, item.originalName)}
                          title="移动"
                          isTouch={isTouch}
                        >
                          <FolderInput className="w-3.5 h-3.5" />
                        </ToolbarIconButton>
                      )}
                      <ToolbarIconButton
                        onClick={() => onCopyUrl(fullUrl)}
                        title="复制链接"
                        isTouch={isTouch}
                      >
                        <Link2 className="w-3.5 h-3.5" />
                      </ToolbarIconButton>
                      <ToolbarIconButton
                        onClick={() => onDownload(fullUrl, item.originalName)}
                        title="下载"
                        isTouch={isTouch}
                      >
                        <Download className="w-3.5 h-3.5" />
                      </ToolbarIconButton>
                      <div className="w-px h-4 bg-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] mx-0.5" />
                      <ToolbarIconButton
                        onClick={() => onDelete(item.id)}
                        title="删除"
                        isTouch={isTouch}
                        danger
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </ToolbarIconButton>
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

/**
 * 工具条图标按钮 —— 触屏 44px、桌面 28px,统一语义色
 */
function ToolbarIconButton({
  children,
  onClick,
  title,
  isTouch,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  isTouch: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex items-center justify-center rounded-full transition-colors',
        isTouch ? 'w-8 h-8' : 'w-7 h-7',
        danger
          ? 'text-[var(--signal-danger,#E26B6B)] hover:bg-[color-mix(in_oklch,var(--signal-danger,#E26B6B)_14%,transparent)]'
          : 'text-[var(--ink-secondary,var(--text-secondary))] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)]'
      )}
    >
      {children}
    </button>
  );
}

export default MediaGrid;
