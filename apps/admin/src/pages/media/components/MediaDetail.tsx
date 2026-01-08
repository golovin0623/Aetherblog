/**
 * @file MediaDetail.tsx
 * @description 媒体详情侧边栏组件
 * @ref §3.2.4 - 媒体管理模块
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  Copy,
  Download,
  Trash2,
  ExternalLink,
  Image,
  Video,
  Music,
  FileText,
  Loader2,
  Check,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn, formatFileSize } from '@/lib/utils';
import { mediaService, MediaType, getMediaUrl } from '@/services/mediaService';
import { format } from 'date-fns';

interface MediaDetailProps {
  mediaId: number;
  onClose: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}

const typeIcons: Record<MediaType, typeof Image> = {
  IMAGE: Image,
  VIDEO: Video,
  AUDIO: Music,
  DOCUMENT: FileText,
};

/**
 * 媒体详情侧边栏组件
 */
export function MediaDetail({ mediaId, onClose, onDelete, isDeleting }: MediaDetailProps) {
  const [copied, setCopied] = useState(false);

  const { data: response, isLoading } = useQuery({
    queryKey: ['media', 'detail', mediaId],
    queryFn: () => mediaService.getDetail(mediaId),
  });

  const media = response?.data;

  const handleCopyUrl = async () => {
    if (media?.fileUrl) {
      const fullUrl = getMediaUrl(media.fileUrl);
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (media) {
      const link = document.createElement('a');
      link.href = getMediaUrl(media.fileUrl);
      link.download = media.originalName;
      link.click();
    }
  };

  const handleOpenInNewTab = () => {
    if (media) {
      window.open(getMediaUrl(media.fileUrl), '_blank');
    }
  };

  if (isLoading) {
    return (
      <div className={cn('h-full rounded-xl', 'bg-white/5 backdrop-blur-sm border border-white/10')}>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </div>
    );
  }

  if (!media) {
    return (
      <div className={cn('h-full rounded-xl p-4', 'bg-white/5 backdrop-blur-sm border border-white/10')}>
        <p className="text-gray-500 text-center">媒体不存在</p>
      </div>
    );
  }

  const Icon = typeIcons[media.fileType] || FileText;
  const fullUrl = getMediaUrl(media.fileUrl);

  return (
    <div className={cn('h-fit rounded-xl overflow-hidden', 'bg-white/5 backdrop-blur-sm border border-white/10')}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <h3 className="text-sm font-medium text-white truncate">文件详情</h3>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 预览区 */}
      <div className="aspect-video bg-black/50 flex items-center justify-center">
        {media.fileType === 'IMAGE' ? (
          <img
            src={fullUrl}
            alt={media.originalName}
            className="max-w-full max-h-full object-contain"
          />
        ) : media.fileType === 'VIDEO' ? (
          <video
            src={fullUrl}
            controls
            className="max-w-full max-h-full"
          />
        ) : media.fileType === 'AUDIO' ? (
          <div className="p-8">
            <Music className="w-16 h-16 text-gray-500 mx-auto mb-4" />
            <audio src={fullUrl} controls className="w-full" />
          </div>
        ) : (
          <Icon className="w-16 h-16 text-gray-500" />
        )}
      </div>

      {/* 文件信息 */}
      <div className="p-4 space-y-3">
        <div>
          <p className="text-xs text-gray-500 mb-1">文件名</p>
          <p className="text-sm text-white break-all">{media.originalName}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-gray-500 mb-1">类型</p>
            <p className="text-sm text-gray-300">{media.mimeType}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">大小</p>
            <p className="text-sm text-gray-300">{formatFileSize(media.fileSize)}</p>
          </div>
        </div>

        {(media.width && media.height) && (
          <div>
            <p className="text-xs text-gray-500 mb-1">尺寸</p>
            <p className="text-sm text-gray-300">{media.width} × {media.height}</p>
          </div>
        )}

        <div>
          <p className="text-xs text-gray-500 mb-1">上传时间</p>
          <p className="text-sm text-gray-300">
            {format(new Date(media.createdAt), 'yyyy-MM-dd HH:mm:ss')}
          </p>
        </div>

        {/* URL */}
        <div>
          <p className="text-xs text-gray-500 mb-1">URL</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={fullUrl}
              readOnly
              className="flex-1 px-3 py-2 text-xs rounded-lg bg-black/30 border border-white/10 text-gray-300 truncate"
            />
            <button
              onClick={handleOpenInNewTab}
              className="p-2 rounded-lg bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              title="在新标签页打开"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="p-4 border-t border-white/10 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleCopyUrl}
            className={cn(
              'flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm',
              'bg-white/5 text-gray-300 hover:bg-white/10 transition-colors'
            )}
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-green-400" />
                已复制
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                复制链接
              </>
            )}
          </button>
          <button
            onClick={handleDownload}
            className={cn(
              'flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm',
              'bg-white/5 text-gray-300 hover:bg-white/10 transition-colors'
            )}
          >
            <Download className="w-4 h-4" />
            下载
          </button>
        </div>
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className={cn(
            'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm',
            'bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
        >
          {isDeleting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
          删除文件
        </button>
      </div>
    </div>
  );
}
