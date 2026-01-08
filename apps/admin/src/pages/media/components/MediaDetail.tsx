/**
 * @file MediaDetail.tsx
 * @description 媒体详情侧边栏组件 - 高级玻璃态设计
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
  Check,
  Calendar,
  HardDrive,
  Maximize2,
} from 'lucide-react';
import { cn, formatFileSize } from '@/lib/utils';
import { MediaItem, MediaType, getMediaUrl } from '@/services/mediaService';
import { format } from 'date-fns';

interface MediaDetailProps {
  item: MediaItem;
  onClose: () => void;
  onDelete: (id: number) => void;
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
 * 媒体详情侧边栏组件 - 高级玻璃态设计
 */
export function MediaDetail({ item: media, onClose, onDelete }: MediaDetailProps) {
  const [copied, setCopied] = useState(false);

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

  if (!media) return null;

  const Icon = typeIcons[media.fileType] || FileText;
  const fullUrl = getMediaUrl(media.fileUrl);

  return (
    <div className="h-full flex flex-col">
      {/* 顶部关闭按钮 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-white/40 uppercase tracking-wider">{typeLabels[media.fileType]}</p>
            <p className="text-sm font-semibold text-white">文件详情</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition-all"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* 预览区 - 高级玻璃态 */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative aspect-video rounded-2xl overflow-hidden bg-black/40 backdrop-blur-sm border border-white/10 mb-4 group"
      >
        {media.fileType === 'IMAGE' ? (
          <img
            src={fullUrl}
            alt={media.originalName}
            className="w-full h-full object-contain"
          />
        ) : media.fileType === 'VIDEO' ? (
          <video
            src={fullUrl}
            controls
            className="w-full h-full object-contain"
          />
        ) : media.fileType === 'AUDIO' ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-4">
            <Music className="w-12 h-12 text-primary/60 mb-3" />
            <audio src={fullUrl} controls className="w-full" />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Icon className="w-16 h-16 text-white/20" />
          </div>
        )}
        
        {/* 悬停放大按钮 */}
        <button
          onClick={handleOpenInNewTab}
          className="absolute top-2 right-2 p-2 rounded-lg bg-black/40 backdrop-blur-md text-white/60 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
          title="在新窗口打开"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </motion.div>

      {/* 文件名 */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.05 }}
        className="mb-4"
      >
        <p className="text-sm font-medium text-white break-all leading-relaxed">
          {media.originalName}
        </p>
      </motion.div>

      {/* 元信息网格 */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-2 gap-3 mb-4"
      >
        <div className="p-3 rounded-xl bg-white/5 border border-white/5">
          <div className="flex items-center gap-2 mb-1">
            <HardDrive className="w-3 h-3 text-white/30" />
            <span className="text-[10px] text-white/40 uppercase">大小</span>
          </div>
          <p className="text-sm text-white font-medium">{formatFileSize(media.fileSize)}</p>
        </div>
        <div className="p-3 rounded-xl bg-white/5 border border-white/5">
          <div className="flex items-center gap-2 mb-1">
            <Calendar className="w-3 h-3 text-white/30" />
            <span className="text-[10px] text-white/40 uppercase">上传时间</span>
          </div>
          <p className="text-sm text-white font-medium">{format(new Date(media.createdAt), 'MM/dd HH:mm')}</p>
        </div>
      </motion.div>

      {/* MIME 类型 */}
      {media.mimeType && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="p-3 rounded-xl bg-white/5 border border-white/5 mb-4"
        >
          <p className="text-[10px] text-white/40 uppercase mb-1">MIME 类型</p>
          <p className="text-xs text-white/70 font-mono">{media.mimeType}</p>
        </motion.div>
      )}

      {/* 尺寸 (如果是图片/视频) */}
      {(media.width && media.height) && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="p-3 rounded-xl bg-white/5 border border-white/5 mb-4"
        >
          <p className="text-[10px] text-white/40 uppercase mb-1">尺寸</p>
          <p className="text-sm text-white font-medium">{media.width} × {media.height} px</p>
        </motion.div>
      )}

      {/* URL 复制区 */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25 }}
        className="mb-4"
      >
        <p className="text-[10px] text-white/40 uppercase mb-2">文件地址</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={fullUrl}
            readOnly
            className="flex-1 px-3 py-2.5 text-xs rounded-xl bg-black/30 border border-white/10 text-white/60 font-mono truncate focus:outline-none focus:border-primary/50"
          />
          <button
            onClick={handleOpenInNewTab}
            className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10 transition-all"
            title="新窗口打开"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </motion.div>

      {/* 弹性填充 */}
      <div className="flex-1" />

      {/* 操作按钮组 */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="space-y-2"
      >
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleCopyUrl}
            className={cn(
              'flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm font-medium transition-all',
              copied 
                ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                : 'bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 hover:text-white'
            )}
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" />
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
            className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm font-medium bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30 transition-all"
          >
            <Download className="w-4 h-4" />
            下载
          </button>
        </div>
        <button
          onClick={() => onDelete(media.id)}
          className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm font-medium bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all"
        >
          <Trash2 className="w-4 h-4" />
          删除文件
        </button>
      </motion.div>
    </div>
  );
}
