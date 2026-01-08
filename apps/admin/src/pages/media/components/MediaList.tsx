/**
 * @file MediaList.tsx
 * @description 媒体列表视图组件
 * @ref §3.2.4 - 媒体管理模块
 */

import { Image, Video, Music, FileText, Download, Trash2 } from 'lucide-react';
import { cn, formatFileSize } from '@/lib/utils';
import { MediaItem, MediaType, getMediaUrl } from '@/services/mediaService';
import { format } from 'date-fns';

interface MediaListProps {
  items: MediaItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete?: (id: number) => void;
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
export function MediaList({ items, selectedId, onSelect, onDelete }: MediaListProps) {
  const handleDownload = (e: React.MouseEvent, url: string, name: string) => {
    e.stopPropagation();
    const link = document.createElement('a');
    link.href = getMediaUrl(url);
    link.download = name;
    link.click();
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    onDelete?.(id);
  };

  return (
    <div className={cn('rounded-xl overflow-hidden', 'bg-white/5 border border-white/10')}>
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/10">
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
              文件名
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
              类型
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
              大小
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
              上传时间
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
              操作
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {items.map((item) => {
            const Icon = typeIcons[item.fileType] || FileText;
            const isSelected = selectedId === item.id;
            const fullUrl = getMediaUrl(item.fileUrl);

            return (
              <tr
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={cn(
                  'cursor-pointer transition-colors',
                  isSelected ? 'bg-primary/10' : 'hover:bg-white/5'
                )}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden',
                        'bg-white/5'
                      )}
                    >
                      {item.fileType === 'IMAGE' ? (
                        <img
                          src={fullUrl}
                          alt={item.originalName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Icon className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                    <span className="text-sm text-white truncate max-w-xs">
                      {item.originalName}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-gray-400">
                    {typeLabels[item.fileType] || item.fileType}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-gray-400">
                    {formatFileSize(item.fileSize)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-gray-400">
                    {format(new Date(item.createdAt), 'yyyy-MM-dd HH:mm')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={(e) => handleDownload(e, item.fileUrl, item.originalName)}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => handleDelete(e, item.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
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
  );
}
