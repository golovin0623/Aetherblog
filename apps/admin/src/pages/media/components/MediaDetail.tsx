/**
 * @file MediaDetail.tsx
 * @description 媒体详情侧边栏组件 - 高级玻璃态设计
 * @ref §3.2.4 - 媒体管理模块
 * @ref 媒体库深度优化方案 - Phase 2-5 组件集成
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  Share2,
  Edit3,
  History,
  Tag,
  Move,
} from 'lucide-react';
import { cn, formatFileSize } from '@/lib/utils';
import { MediaItem, MediaType, getMediaUrl, mediaService } from '@/services/mediaService';
import { format } from 'date-fns';
import { TagManager } from './TagManager';
import { ShareDialog } from './ShareDialog';
import { ImageEditor } from './ImageEditor';
import { VersionHistory } from './VersionHistory';
import { StorageStatusIcon } from './StorageStatusIcon';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { storageSyncService } from '@/services/storageSyncService';
import { toast } from 'sonner';
import { CloudUpload, RefreshCcw, CloudOff, ExternalLink as ExternalLinkIcon } from 'lucide-react';
import { ConfirmModal } from '@aetherblog/ui';

interface MediaDetailProps {
  item: MediaItem;
  onClose: () => void;
  onDelete: (id: number) => void;
  onMove?: (fileId: number, fileName: string) => void;
}

const typeIcons: Record<MediaType, typeof Image> = {
  IMAGE: Image,
  VIDEO: Video,
  AUDIO: Music,
  DOCUMENT: FileText,
  OTHER: FileText,
};

const typeLabels: Record<MediaType, string> = {
  IMAGE: '图片',
  VIDEO: '视频',
  AUDIO: '音频',
  DOCUMENT: '文档',
  OTHER: '其他',
};

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const err = error as {
    message?: string;
    msg?: string;
    errorMessage?: string;
    response?: { data?: { message?: string; msg?: string; errorMessage?: string } };
  };
  return (
    err.response?.data?.message ||
    err.response?.data?.msg ||
    err.response?.data?.errorMessage ||
    err.message ||
    err.msg ||
    err.errorMessage ||
    fallback
  );
}

type DetailTab = 'info' | 'tags' | 'versions';

/**
 * 媒体详情侧边栏组件 - 高级玻璃态设计
 */
export function MediaDetail({ item: initialMedia, onClose, onDelete, onMove }: MediaDetailProps) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>('info');
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: media = initialMedia } = useQuery({
    queryKey: ['media', 'detail', initialMedia.id],
    queryFn: async () => {
      const res = await mediaService.getDetail(initialMedia.id);
      return res.data;
    },
    initialData: initialMedia,
    refetchInterval: (query) => {
      const status = query.state.data?.syncStatus;
      return status === 'PENDING' || status === 'SYNCING' ? 2000 : false;
    },
  });

  useEffect(() => {
    if (!media) return;
    queryClient.setQueriesData<{ list: MediaItem[] }>(
      { queryKey: ['media', 'list'] },
      (old) => {
        if (!old?.list?.length) return old;
        let matched = false;
        const list = old.list.map((item) => {
          if (item.id !== media.id) return item;
          matched = true;
          return { ...item, ...media };
        });
        return matched ? { ...old, list } : old;
      }
    );
  }, [media, queryClient]);

  const handleCopyUrl = async () => {
    if (media?.fileUrl) {
      const fullUrl = getMediaUrl(media);
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (media) {
      const link = document.createElement('a');
      link.href = getMediaUrl(media);
      link.download = media.originalName;
      link.click();
    }
  };

  const handleOpenInNewTab = () => {
    if (media) {
      window.open(getMediaUrl(media), '_blank');
    }
  };

  if (!media) return null;

  const Icon = typeIcons[media.fileType] || FileText;
  const fullUrl = getMediaUrl(media);
  const isImage = media.fileType === 'IMAGE';

  const tabs: { id: DetailTab; label: string; icon: typeof Tag }[] = [
    { id: 'info', label: '详情', icon: FileText },
    { id: 'tags', label: '标签', icon: Tag },
    { id: 'versions', label: '版本', icon: History },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* 顶部关闭按钮 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{typeLabels[media.fileType]}</p>
            <p className="text-sm font-semibold text-[var(--text-primary)]">文件详情</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-xl hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* 预览区 */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative aspect-video rounded-2xl overflow-hidden bg-[var(--bg-secondary)]/50 dark:bg-white/5 border border-black/5 dark:border-white/10 mb-4 group"
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
            <Icon className="w-16 h-16 text-[var(--text-muted)]" />
          </div>
        )}
        
        {/* 悬停放大按钮 */}
        <button
          onClick={handleOpenInNewTab}
          className="absolute top-2 right-2 p-2 rounded-lg bg-[var(--bg-card)]/80 backdrop-blur-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] opacity-0 group-hover:opacity-100 transition-all"
          title="在新窗口打开"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </motion.div>

      {/* 快捷操作按钮 */}
      <div className="flex items-center gap-2 mb-4">
        {isImage && (
          <button
            onClick={() => setImageEditorOpen(true)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-secondary)]/50 dark:bg-white/5 border border-black/5 dark:border-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50 dark:hover:bg-white/10 transition-all text-xs font-medium"
          >
            <Edit3 className="w-3.5 h-3.5" />
            编辑
          </button>
        )}
        <button
          onClick={() => setShareDialogOpen(true)}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-secondary)]/50 dark:bg-white/5 border border-black/5 dark:border-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50 dark:hover:bg-white/10 transition-all text-xs font-medium"
        >
          <Share2 className="w-3.5 h-3.5" />
          分享
        </button>
        {onMove && (
          <button
            onClick={() => onMove(media.id, media.originalName)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-secondary)]/50 dark:bg-white/5 border border-black/5 dark:border-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50 dark:hover:bg-white/10 transition-all text-xs font-medium"
          >
            <Move className="w-3.5 h-3.5" />
            移动
          </button>
        )}
      </div>

      {/* Tab 导航 */}
      <div className="flex items-center gap-1 p-1 bg-[var(--bg-secondary)]/50 dark:bg-white/5 rounded-xl mb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all',
              activeTab === tab.id
                ? 'bg-primary text-white shadow-md'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            )}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <AnimatePresence mode="wait">
          {activeTab === 'info' && (
            <motion.div
              key="info"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.15 }}
              className="space-y-4 pb-8"
            >
              {/* 文件名 */}
              <div>
                <p className="text-[10px] text-[var(--text-muted)] uppercase mb-1">文件名</p>
                <p 
                  className="text-sm font-medium text-[var(--text-primary)] break-all leading-relaxed hover:text-primary transition-colors cursor-help"
                  title={media.originalName || media.filename}
                >
                  {media.originalName || media.filename || '未知文件名'}
                </p>
              </div>

              {/* 元信息网格 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-[var(--bg-secondary)]/50 dark:bg-white/5 border border-black/5 dark:border-white/10">
                  <div className="flex items-center gap-2 mb-1">
                    <HardDrive className="w-3 h-3 text-[var(--text-muted)]" />
                    <span className="text-[10px] text-[var(--text-secondary)] uppercase">大小</span>
                  </div>
                  <p className="text-sm text-[var(--text-primary)] font-medium">{formatFileSize(media.fileSize)}</p>
                </div>
                <div className="p-3 rounded-xl bg-[var(--bg-secondary)]/50 dark:bg-white/5 border border-black/5 dark:border-white/10">
                  <div className="flex items-center gap-2 mb-1">
                    <Calendar className="w-3 h-3 text-[var(--text-muted)]" />
                    <span className="text-[10px] text-[var(--text-secondary)] uppercase">上传时间</span>
                  </div>
                  <p className="text-sm text-[var(--text-primary)] font-medium">{format(new Date(media.createdAt), 'MM/dd HH:mm')}</p>
                </div>
              </div>

              {/* MIME 类型 */}
              {media.mimeType && (
                <div className="p-3 rounded-xl bg-[var(--bg-secondary)]/50 dark:bg-white/5 border border-black/5 dark:border-white/10">
                  <p className="text-[10px] text-[var(--text-muted)] uppercase mb-1">MIME 类型</p>
                  <p className="text-xs text-[var(--text-primary)] font-mono">{media.mimeType}</p>
                </div>
              )}

              {/* 尺寸 */}
              {(media.width && media.height) && (
                <div className="p-3 rounded-xl bg-[var(--bg-secondary)]/50 dark:bg-white/5 border border-black/5 dark:border-white/10">
                  <p className="text-[10px] text-[var(--text-muted)] uppercase mb-1">尺寸</p>
                  <p className="text-sm text-[var(--text-primary)] font-medium">{media.width} × {media.height} px</p>
                </div>
              )}

              {/* URL 复制区 */}
              <div>
                <p className="text-[10px] text-[var(--text-muted)] uppercase mb-2">文件地址</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={fullUrl}
                    readOnly
                    className="flex-1 px-3 py-2.5 text-xs rounded-xl bg-[var(--bg-secondary)]/50 dark:bg-black/20 border border-black/5 dark:border-white/10 text-[var(--text-secondary)] font-mono truncate focus:outline-none focus:border-primary/50"
                  />
                  <button
                    onClick={handleOpenInNewTab}
                    className="p-2.5 rounded-xl bg-[var(--bg-secondary)]/50 dark:bg-white/5 border border-black/5 dark:border-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50 dark:hover:bg-white/10 transition-all"
                    title="新窗口打开"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* 存储信息分组 — 对象存储 rollout - Phase 3 + Phase 4 */}
              {media.storageType && (
                <StorageInfoSection media={media} />
              )}
            </motion.div>
          )}

          {activeTab === 'tags' && (
            <motion.div
              key="tags"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.15 }}
              className="pb-4"
            >
              <TagManager fileId={media.id} mode="manage" />
            </motion.div>
          )}

          {activeTab === 'versions' && (
            <motion.div
              key="versions"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.15 }}
            >
              <VersionHistory fileId={media.id} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 底部操作按钮 */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="pt-4 border-t border-[var(--border-subtle)] mt-auto"
      >
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyUrl}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all',
              copied 
                ? 'bg-status-success/20 text-status-success border border-status-success-border' 
                : 'bg-[var(--bg-secondary)]/50 dark:bg-white/5 border border-black/5 dark:border-white/10 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/50 dark:hover:bg-white/10 hover:text-[var(--text-primary)]'
            )}
            title="复制链接"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span className="hidden sm:inline">{copied ? '已复制' : '复制'}</span>
          </button>
          
          <button
            onClick={handleDownload}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30 transition-all"
            title="下载文件"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">下载</span>
          </button>

          <button
            onClick={() => onDelete(media.id)}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium bg-status-danger-light border border-status-danger-border text-status-danger hover:bg-status-danger/20 transition-all"
            title="删除文件"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">删除</span>
          </button>
        </div>
      </motion.div>

      {/* 分享对话框 */}
      <AnimatePresence>
        {shareDialogOpen && (
          <ShareDialog
            fileId={media.id}
            onClose={() => setShareDialogOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* 图片编辑器 */}
      <AnimatePresence>
        {imageEditorOpen && isImage && (
          <ImageEditor
            fileId={media.id}
            imageUrl={fullUrl}
            onClose={() => setImageEditorOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * StorageInfoSection - 详情页"存储信息"分组(iCloud 风格重构)
 *  - 单图标合并显示 storage type + sync status (StorageStatusIcon)
 *  - 提供"立即同步" / "重试" / "重新备份" / "从云端移除备份" 操作
 * @ref 对象存储 rollout - Phase 3 + Phase 4 + Phase 5(备份校验)
 */
function StorageInfoSection({ media }: { media: MediaItem }) {
  const queryClient = useQueryClient();
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);

  const syncMutation = useMutation({
    mutationFn: () => storageSyncService.syncOne(media.id),
    onSuccess: () => {
      toast.success('已加入备份队列');
      queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'detail', media.id] });
    },
    onError: (e) => {
      toast.error(getApiErrorMessage(e, '加入备份失败'));
    },
  });

  const removeBackupMutation = useMutation({
    mutationFn: () => storageSyncService.removeBackup(media.id),
    onSuccess: () => {
      toast.success('已移除备份文件(主文件保留)');
      queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'detail', media.id] });
    },
    onError: (e) => {
      toast.error(getApiErrorMessage(e, '移除备份失败'));
    },
  });

  const status = media.syncStatus || 'NONE';
  const canSync = status === 'NONE' || status === 'FAILED' || status === 'MISSING';
  const canRetry = status === 'FAILED';
  const canRemove = status === 'SYNCED' && !!media.backupUrl;
  const isMissing = status === 'MISSING';

  return (
    <div className="rounded-xl bg-[var(--bg-secondary)]/30 dark:bg-white/[0.02] border border-black/5 dark:border-white/10 p-3 space-y-2.5">
      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">存储信息</p>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--text-secondary)]">云端状态</span>
        <StorageStatusIcon
          storageType={media.storageType}
          syncStatus={status}
          size="md"
          showLabel
        />
      </div>
      {media.storageType && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-secondary)]">主存储</span>
          <span className="text-[11px] font-mono text-[var(--text-muted)] tracking-wider">{media.storageType}</span>
        </div>
      )}
      {media.cdnUrl && (
        <div>
          <p className="text-[10px] text-[var(--text-muted)] mb-1">访问 URL</p>
          <a
            href={media.cdnUrl}
            target="_blank"
            rel="noreferrer"
            className="block text-xs font-mono text-primary hover:underline break-all"
          >
            {media.cdnUrl}
          </a>
        </div>
      )}
      {media.backupUrl && status !== 'MISSING' && (
        <div>
          <p className="text-[10px] text-[var(--text-muted)] mb-1">备份位置</p>
          <a
            href={media.backupUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs font-mono text-[var(--text-secondary)] hover:text-primary hover:underline break-all"
          >
            {media.backupUrl}
            <ExternalLinkIcon className="w-3 h-3 shrink-0" />
          </a>
        </div>
      )}
      {media.backupAt && (
        <p className="text-[10px] text-[var(--text-muted)]">
          最后备份: {format(new Date(media.backupAt), 'yyyy-MM-dd HH:mm:ss')}
        </p>
      )}
      {isMissing && (
        <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-status-danger/10 border border-status-danger/30 text-[11px] text-status-danger">
          <CloudOff className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>备份对象已不存在(可能被外部删除),请重新备份。</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        {(canSync || canRetry) && (
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              isMissing
                ? 'bg-status-danger/15 text-status-danger hover:bg-status-danger/25'
                : canRetry
                  ? 'bg-status-warning/15 text-status-warning hover:bg-status-warning/25'
                  : 'bg-primary/15 text-primary hover:bg-primary/25',
              syncMutation.isPending && 'opacity-60 cursor-not-allowed'
            )}
          >
            {isMissing ? <RefreshCcw className="w-3.5 h-3.5" /> : canRetry ? <RefreshCcw className="w-3.5 h-3.5" /> : <CloudUpload className="w-3.5 h-3.5" />}
            {syncMutation.isPending ? '提交中...' : isMissing ? '重新备份' : canRetry ? '重试同步' : '立即同步'}
          </button>
        )}
        {canRemove && (
          <button
            onClick={() => setRemoveConfirmOpen(true)}
            disabled={removeBackupMutation.isPending}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              'bg-status-danger/10 text-status-danger hover:bg-status-danger/20 border border-status-danger/30',
              removeBackupMutation.isPending && 'opacity-60 cursor-not-allowed'
            )}
            title="只删除备份对象,不动主文件"
          >
            <CloudOff className="w-3.5 h-3.5" />
            移除备份
          </button>
        )}
      </div>

      <ConfirmModal
        isOpen={removeConfirmOpen}
        title="移除备份"
        message="将删除备份对象,但主文件保留。可随时通过「立即同步」重新复制。是否继续?"
        confirmText="移除备份"
        cancelText="取消"
        variant="danger"
        onConfirm={() => {
          setRemoveConfirmOpen(false);
          removeBackupMutation.mutate();
        }}
        onCancel={() => setRemoveConfirmOpen(false)}
      />
    </div>
  );
}
