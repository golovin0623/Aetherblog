/**
 * @file MediaList.tsx
 * @description 媒体列表视图组件 - 优化交互逻辑
 * @ref §3.2.4 - 媒体管理模块
 */

import { Image, Video, Music, FileText, Download, Trash2, Eye, Link2 } from 'lucide-react';
import { cn, formatFileSize } from '@/lib/utils';
import { MediaItem, MediaType, getMediaUrl } from '@/services/mediaService';
import { format } from 'date-fns';

interface MediaListProps {
  items: MediaItem[];
  selectedId: number | null;
  selectedIds: Set<number>;
  onSelect: (id: number) => void;
  onToggleSelect: (id: number) => void;
  onPreview: (id: number) => void;
  onDelete: (id: number) => void;
  onCopyUrl: (url: string) => void;
  onDownload: (url: string, filename: string) => void;
}

const typeIcons: Record<MediaType, typeof Image> = {
  IMAGE: Image,
  VIDEO: Video,
  AUDIO: Music,
  DOCUMENT: FileText,
};

const typeLabels: Record<MediaType, string> = {
  IMAGE: '图片',
  VIDEO: '视频',
  AUDIO: '音频',
  DOCUMENT: '文档',
};

/**
 * 媒体列表视图组件
 */
export function MediaList({ 
  items, 
  selectedId, 
  selectedIds,
  onSelect, 
  onToggleSelect,
  onPreview,
  onDelete,
  onCopyUrl,
  onDownload 
}: MediaListProps) {
  return (
    <div className="rounded-xl overflow-hidden">
      {/* 桌面端表格视图 */}
      <div className="hidden md:block bg-white/5 border border-white/10 rounded-xl overflow-hidden">
      <table className="w-full text-left border-collapse table-fixed">
        <thead>
          <tr className="border-b border-white/10 bg-white/5">
            <th className="w-12 px-4 py-3">
              {/* 全选 logic */}
              <div className="w-5 h-5 rounded border-2 border-white/20" />
            </th>
            <th className="w-auto px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              文件名
            </th>
            <th className="w-32 px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              类型
            </th>
            <th className="w-32 px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              大小
            </th>
            <th className="w-48 px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              上传时间
            </th>
            <th className="w-44 px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">
              操作
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {items.map((item) => {
            const Icon = typeIcons[item.fileType] || FileText;
            const isSidebarSelected = selectedId === item.id;
            const isBatchSelected = selectedIds.has(item.id);
            const fullUrl = getMediaUrl(item.fileUrl);

            return (
              <tr
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={cn(
                  'group cursor-pointer transition-all duration-200',
                  isSidebarSelected ? 'bg-primary/10' : 'hover:bg-white/5',
                  isBatchSelected && 'bg-primary/5'
                )}
              >
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isBatchSelected}
                    onChange={() => onToggleSelect(item.id)}
                    className="w-5 h-5 rounded border-2 border-white/20 bg-transparent text-primary focus:ring-primary/30"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden bg-white/10 flex-shrink-0">
                      {item.fileType === 'IMAGE' ? (
                        <img src={fullUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Icon className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white truncate" title={item.originalName}>
                        {item.originalName}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-gray-400">
                    {typeLabels[item.fileType] || item.fileType}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-400">
                  {formatFileSize(item.fileSize)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-400">
                  {format(new Date(item.createdAt), 'yyyy-MM-dd HH:mm')}
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1.5 transition-opacity">
                    <button
                      onClick={() => onPreview(item.id)}
                      className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                      title="预览"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onCopyUrl(fullUrl)}
                      className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                      title="复制链接"
                    >
                      <Link2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDownload(fullUrl, item.originalName)}
                      className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                      title="下载"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDelete(item.id)}
                      className="p-2 rounded-lg hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-colors"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {/* 移动端卡片视图 */}
      <div className="md:hidden divide-y divide-white/5 border border-white/10 rounded-xl bg-white/5 overflow-hidden">
        {items.map((item) => {
          const Icon = typeIcons[item.fileType] || FileText;
          const isSelected = selectedId === item.id || selectedIds.has(item.id);
          const fullUrl = getMediaUrl(item.fileUrl);

          return (
            <div 
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={cn(
                'p-4 space-y-3 active:bg-white/5 transition-colors relative',
                isSelected && 'bg-primary/5'
              )}
            >
              <div className="flex items-start gap-4">
                {/* 缩略图 */}
                <div className="w-16 h-16 rounded-xl flex items-center justify-center overflow-hidden bg-white/10 shrink-0 border border-white/5 shadow-inner">
                  {item.fileType === 'IMAGE' ? (
                    <img src={fullUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Icon className="w-6 h-6 text-gray-400" />
                  )}
                </div>

                {/* 基本信息 */}
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-white font-medium text-sm line-clamp-2 leading-relaxed break-all">
                      {item.originalName}
                    </h3>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        onToggleSelect(item.id);
                      }}
                      className="mt-1 w-5 h-5 rounded border-2 border-white/20 bg-transparent text-primary focus:ring-primary/30 shrink-0"
                    />
                  </div>
                  
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-500 font-medium">
                    <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400 uppercase tracking-tight">
                      {typeLabels[item.fileType] || item.fileType}
                    </span>
                    <span className="w-px h-2 bg-white/10" />
                    <span>{formatFileSize(item.fileSize)}</span>
                  </div>
                </div>
              </div>

              {/* 操作区 */}
              <div className="flex items-center justify-between pt-1 border-t border-white/[0.02]">
                <span className="text-[10px] text-gray-600 font-mono">
                  {format(new Date(item.createdAt), 'yyyy-MM-dd HH:mm')}
                </span>
                
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); onPreview(item.id); }}
                    className="p-2 text-gray-400 active:text-white"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onCopyUrl(fullUrl); }}
                    className="p-2 text-gray-400 active:text-white"
                  >
                    <Link2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDownload(fullUrl, item.originalName); }}
                    className="p-2 text-gray-400 active:text-white"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                    className="p-2 text-gray-400 active:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
