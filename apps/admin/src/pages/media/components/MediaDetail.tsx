/**
 * @file MediaDetail.tsx
 * @description 媒体详情侧边栏组件 - 高级玻璃态设计
 * @ref §3.2.4 - 媒体管理模块
 * @ref 媒体库深度优化方案 - Phase 2-5 组件集成
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Sparkles,
} from 'lucide-react';
import { cn, extractApiErrorMessage, formatFileSize } from '@/lib/utils';
import { MediaItem, MediaType, getMediaUrl, mediaService } from '@/services/mediaService';
import { ATLAS_CARRIER_SUGGESTION_MAX_COST_USD, atlasService } from '@/services/atlasService';
import { format } from 'date-fns';
import { TagManager } from './TagManager';
import { ShareDialog } from './ShareDialog';
import { ImageEditor } from './ImageEditor';
import { VersionHistory } from './VersionHistory';
import { StorageStatusIcon } from './StorageStatusIcon';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { storageSyncService, type BackupRemoveFailure } from '@/services/storageSyncService';
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

type DetailTab = 'info' | 'tags' | 'versions';

const detailPanelClass = cn(
  'media-detail-card rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'bg-[color-mix(in_oklch,var(--bg-leaf)_84%,var(--ink-primary)_4%)]'
);

const detailSoftButtonClass = cn(
  'media-detail-control flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
  'border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]',
  'text-[var(--ink-secondary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)]'
);

function formatAtlasCostUsd(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '未知';
  return `$${value.toFixed(4)}`;
}

function getRecordProp(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  return (value as Record<string, unknown>)[key];
}

function getBackupRemoveFailure(error: unknown): BackupRemoveFailure | null {
  const rootData = getRecordProp(error, 'data');
  const responseData = getRecordProp(getRecordProp(error, 'response'), 'data');
  const data = rootData ?? getRecordProp(responseData, 'data');
  if (!data || typeof data !== 'object') return null;
  const raw = data as Partial<BackupRemoveFailure>;
  if (typeof raw.reason !== 'string' || typeof raw.stage !== 'string') return null;
  return {
    stage: raw.stage,
    reason: raw.reason,
    forceAllowed: raw.forceAllowed === true,
  };
}

function isAtlasNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 404;
}

/**
 * 媒体详情侧边栏组件 - 高级玻璃态设计
 */
export function MediaDetail({ item: initialMedia, onClose, onDelete, onMove }: MediaDetailProps) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>('info');
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
  const [ensuringAtlas, setEnsuringAtlas] = useState(false);
  const [openingAtlas, setOpeningAtlas] = useState(false);
  const [generatingAtlas, setGeneratingAtlas] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [transcriptCarrierId, setTranscriptCarrierId] = useState<number | null>(null);
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [openingTranscript, setOpeningTranscript] = useState(false);
  const [generatingTranscript, setGeneratingTranscript] = useState(false);
  const [imageDescriptionDraft, setImageDescriptionDraft] = useState('');
  const [imageCarrierId, setImageCarrierId] = useState<number | null>(null);
  const [savingImageDescription, setSavingImageDescription] = useState(false);
  const [openingImageAtlas, setOpeningImageAtlas] = useState(false);
  const [generatingImageAtlas, setGeneratingImageAtlas] = useState(false);
  const navigate = useNavigate();
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

  useEffect(() => {
    setTranscriptDraft('');
    setTranscriptCarrierId(null);
    setImageDescriptionDraft('');
    setImageCarrierId(null);
  }, [initialMedia.id]);

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
  const thumbnailUrl = media.thumbnailUrl ? getMediaUrl(media.thumbnailUrl) : '';
  const isImage = media.fileType === 'IMAGE';
  const isPDF = media.fileType === 'DOCUMENT' && (
    media.mimeType?.toLowerCase() === 'application/pdf' ||
    media.originalName.toLowerCase().endsWith('.pdf')
  );
  const isTranscriptMedia = media.fileType === 'VIDEO' || media.fileType === 'AUDIO';

  const ensureAtlasPDFCarrier = async () => {
    if (!isPDF) return;
    const res = await atlasService.ensurePDFCarrier(media.id);
    return res.data;
  };

  const handleEnsureAtlasPDF = async () => {
    if (!isPDF) return;
    setEnsuringAtlas(true);
    try {
      const carrier = await ensureAtlasPDFCarrier();
      if (carrier) {
        toast.success(`已加入 Atlas：carrier #${carrier.id}`);
      }
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '加入 Atlas 失败'));
    } finally {
      setEnsuringAtlas(false);
    }
  };

  const handleOpenAtlasPDF = async () => {
    if (!isPDF) return;
    setOpeningAtlas(true);
    try {
      const carrier = (await getExistingMediaCarrier(['pdf'])) ?? (await ensureAtlasPDFCarrier());
      if (carrier) {
        navigate(`/atlas/reader/pdf/${carrier.id}`);
      }
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '打开 Atlas PDF Reader 失败'));
    } finally {
      setOpeningAtlas(false);
    }
  };

  const handleGenerateAtlasPDFSuggestions = async () => {
    if (!isPDF) return;
    setGeneratingAtlas(true);
    try {
      const carrier = await ensureAtlasPDFCarrier();
      if (!carrier) return;
      const payload = { maxCandidates: 8, maxCostUsd: ATLAS_CARRIER_SUGGESTION_MAX_COST_USD };
      const preview = await atlasService.previewCarrierSuggestions(carrier.id, payload);
      if (preview.data?.budgetExceeded) {
        toast.warning(
          `预估费用 ${formatAtlasCostUsd(preview.data.estimatedCostUsd)} 超过本次预算 ${formatAtlasCostUsd(preview.data.maxCostUsd)}，已取消生成`
        );
        return;
      }
      if (preview.data?.pricingMissing) {
        toast.warning('当前模型缺少全局价格配置，无法预估本次费用；将继续生成并保留预算上限');
      } else {
        toast.message(
          `本次预估 ${formatAtlasCostUsd(preview.data?.estimatedCostUsd)} / 上限 ${formatAtlasCostUsd(preview.data?.maxCostUsd)}`
        );
      }
      const res = await atlasService.generateCarrierSuggestions(carrier.id, payload);
      const count = res.data?.length ?? 0;
      toast.success(count > 0 ? `已从媒体全文生成 ${count} 条 Atlas 建议，前往 Inbox 处理` : 'Atlas 未生成可用建议');
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '抽取 Atlas 知识点失败'));
    } finally {
      setGeneratingAtlas(false);
    }
  };

  const ensureAtlasTranscriptCarrier = async () => {
    if (!isTranscriptMedia) return;
    const transcriptMarkdown = transcriptDraft.trim();
    if (!transcriptMarkdown) {
      toast.message('请先填写转录文本');
      return;
    }
    const res = await atlasService.ensureMediaTranscriptCarrier({
      mediaFileId: media.id,
      transcriptMarkdown,
    });
    setTranscriptCarrierId(res.data.id);
    return res.data;
  };

  const getExistingMediaCarrier = async (types: string[]) => {
    try {
      const res = await atlasService.getMediaCarrier(media.id);
      if (!types.includes(res.data.type)) return null;
      return res.data;
    } catch (err) {
      if (isAtlasNotFound(err)) return null;
      throw err;
    }
  };

  const handleSaveAtlasTranscript = async () => {
    if (!isTranscriptMedia) return;
    setSavingTranscript(true);
    try {
      const carrier = await ensureAtlasTranscriptCarrier();
      if (carrier) {
        toast.success(`已保存 Atlas 转录：carrier #${carrier.id}`);
      }
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '保存 Atlas 转录失败'));
    } finally {
      setSavingTranscript(false);
    }
  };

  const handleOpenAtlasTranscript = async () => {
    if (!isTranscriptMedia) return;
    setOpeningTranscript(true);
    try {
      const carrier = transcriptCarrierId
        ? { id: transcriptCarrierId }
        : (await getExistingMediaCarrier(['video', 'audio'])) ?? (await ensureAtlasTranscriptCarrier());
      if (carrier) {
        setTranscriptCarrierId(carrier.id);
        navigate(`/atlas/reader/transcript/${carrier.id}`);
      }
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '打开 Atlas 转录 Reader 失败'));
    } finally {
      setOpeningTranscript(false);
    }
  };

  const handleGenerateAtlasTranscriptSuggestions = async () => {
    if (!isTranscriptMedia) return;
    setGeneratingTranscript(true);
    try {
      const carrier = await ensureAtlasTranscriptCarrier();
      if (!carrier) return;
      const payload = { maxCandidates: 8, maxCostUsd: ATLAS_CARRIER_SUGGESTION_MAX_COST_USD };
      const preview = await atlasService.previewCarrierSuggestions(carrier.id, payload);
      if (preview.data?.budgetExceeded) {
        toast.warning(
          `预估费用 ${formatAtlasCostUsd(preview.data.estimatedCostUsd)} 超过本次预算 ${formatAtlasCostUsd(preview.data.maxCostUsd)}，已取消生成`
        );
        return;
      }
      if (preview.data?.pricingMissing) {
        toast.warning('当前模型缺少全局价格配置，无法预估本次费用；将继续生成并保留预算上限');
      } else {
        toast.message(
          `本次预估 ${formatAtlasCostUsd(preview.data?.estimatedCostUsd)} / 上限 ${formatAtlasCostUsd(preview.data?.maxCostUsd)}`
        );
      }
      const res = await atlasService.generateCarrierSuggestions(carrier.id, payload);
      const count = res.data?.length ?? 0;
      toast.success(count > 0 ? `已从转录全文生成 ${count} 条 Atlas 建议，前往 Inbox 处理` : 'Atlas 未生成可用建议');
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '抽取 Atlas 转录知识点失败'));
    } finally {
      setGeneratingTranscript(false);
    }
  };

  const transcriptBusy = savingTranscript || openingTranscript || generatingTranscript;
  const ensureAtlasImageCarrier = async () => {
    if (!isImage) return;
    const descriptionMarkdown = imageDescriptionDraft.trim();
    if (!descriptionMarkdown) {
      toast.message('请先填写图片描述或 OCR 文本');
      return;
    }
    const res = await atlasService.ensureImageCarrier({
      mediaFileId: media.id,
      descriptionMarkdown,
    });
    setImageCarrierId(res.data.id);
    return res.data;
  };

  const handleSaveAtlasImage = async () => {
    if (!isImage) return;
    setSavingImageDescription(true);
    try {
      const carrier = await ensureAtlasImageCarrier();
      if (carrier) {
        toast.success(`已保存 Atlas 图片描述：carrier #${carrier.id}`);
      }
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '保存 Atlas 图片描述失败'));
    } finally {
      setSavingImageDescription(false);
    }
  };

  const handleOpenAtlasImage = async () => {
    if (!isImage) return;
    setOpeningImageAtlas(true);
    try {
      const carrier = imageCarrierId
        ? { id: imageCarrierId }
        : (await getExistingMediaCarrier(['image'])) ?? (await ensureAtlasImageCarrier());
      if (carrier) {
        setImageCarrierId(carrier.id);
        navigate(`/atlas/reader/image/${carrier.id}`);
      }
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '打开 Atlas 图片 Reader 失败'));
    } finally {
      setOpeningImageAtlas(false);
    }
  };

  const handleGenerateAtlasImageSuggestions = async () => {
    if (!isImage) return;
    setGeneratingImageAtlas(true);
    try {
      const carrier = await ensureAtlasImageCarrier();
      if (!carrier) return;
      const payload = { maxCandidates: 8, maxCostUsd: ATLAS_CARRIER_SUGGESTION_MAX_COST_USD };
      const preview = await atlasService.previewCarrierSuggestions(carrier.id, payload);
      if (preview.data?.budgetExceeded) {
        toast.warning(
          `预估费用 ${formatAtlasCostUsd(preview.data.estimatedCostUsd)} 超过本次预算 ${formatAtlasCostUsd(preview.data.maxCostUsd)}，已取消生成`
        );
        return;
      }
      if (preview.data?.pricingMissing) {
        toast.warning('当前模型缺少全局价格配置，无法预估本次费用；将继续生成并保留预算上限');
      } else {
        toast.message(
          `本次预估 ${formatAtlasCostUsd(preview.data?.estimatedCostUsd)} / 上限 ${formatAtlasCostUsd(preview.data?.maxCostUsd)}`
        );
      }
      const res = await atlasService.generateCarrierSuggestions(carrier.id, payload);
      const count = res.data?.length ?? 0;
      toast.success(count > 0 ? `已从图片描述生成 ${count} 条 Atlas 建议，前往 Inbox 处理` : 'Atlas 未生成可用建议');
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '抽取 Atlas 图片知识点失败'));
    } finally {
      setGeneratingImageAtlas(false);
    }
  };

  const imageAtlasBusy = savingImageDescription || openingImageAtlas || generatingImageAtlas;

  const tabs: { id: DetailTab; label: string; icon: typeof Tag }[] = [
    { id: 'info', label: '详情', icon: FileText },
    { id: 'tags', label: '标签', icon: Tag },
    { id: 'versions', label: '版本', icon: History },
  ];

  return (
    <div className="flex h-full flex-col text-[var(--ink-primary)]">
      {/* 顶部关闭按钮 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]">
            <Icon className="h-5 w-5 text-[var(--aurora-1)]" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">{typeLabels[media.fileType]}</p>
            <p className="text-sm font-semibold text-[var(--ink-primary)]">文件详情</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-xl p-2 text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)]"
          aria-label="关闭媒体详情"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* 预览区 */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="group relative mb-4 aspect-video overflow-hidden rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]"
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
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-4">
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt={media.originalName}
                className="min-h-0 max-h-[calc(100%-3.25rem)] max-w-full rounded-xl object-contain shadow-[0_18px_48px_-34px_color-mix(in_oklch,black_70%,transparent)]"
              />
            ) : (
              <Music className="h-12 w-12 text-[color-mix(in_oklch,var(--aurora-1)_72%,transparent)]" />
            )}
            <audio src={fullUrl} controls className="w-full" />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Icon className="h-16 w-16 text-[var(--ink-muted)]" />
          </div>
        )}
        
        {/* 悬停放大按钮 */}
        <button
          onClick={handleOpenInNewTab}
          className="absolute right-2 top-2 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--bg-leaf)_86%,transparent)] p-2 text-[var(--ink-secondary)] opacity-0 backdrop-blur-md transition-all hover:text-[var(--ink-primary)] group-hover:opacity-100"
          title="在新窗口打开"
          aria-label="在新窗口打开"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </motion.div>

      {/* 快捷操作按钮 */}
      <div className="flex items-center gap-2 mb-4">
        {isImage && (
          <button
            onClick={() => setImageEditorOpen(true)}
            className={detailSoftButtonClass}
          >
            <Edit3 className="w-3.5 h-3.5" />
            编辑
          </button>
        )}
        {isImage && (
          <button
            onClick={() => void handleOpenAtlasImage()}
            disabled={imageAtlasBusy}
            className={detailSoftButtonClass}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {openingImageAtlas ? '打开中' : '查看标注'}
          </button>
        )}
        <button
          onClick={() => setShareDialogOpen(true)}
          className={detailSoftButtonClass}
        >
          <Share2 className="w-3.5 h-3.5" />
          分享
        </button>
        {isPDF && (
          <button
            onClick={() => void handleOpenAtlasPDF()}
            disabled={openingAtlas || ensuringAtlas || generatingAtlas}
            className={detailSoftButtonClass}
          >
            <FileText className="w-3.5 h-3.5" />
            {openingAtlas ? '打开中' : '查看标注'}
          </button>
        )}
        {onMove && (
          <button
            onClick={() => onMove(media.id, media.originalName)}
            className={detailSoftButtonClass}
          >
            <Move className="w-3.5 h-3.5" />
            移动
          </button>
        )}
      </div>

      {/* Tab 导航 */}
      <div className="media-detail-control relative mb-4 flex items-center gap-1 overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'relative z-10 flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-leaf)]',
              activeTab === tab.id
                ? 'text-[var(--ink-primary)]'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]'
            )}
          >
            {activeTab === tab.id && (
              <motion.span
                layoutId={`media-detail-tab-bg-${media.id}`}
                className="absolute inset-0 -z-10 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] shadow-sm"
                transition={{ type: 'spring', bounce: 0.18, duration: 0.42 }}
              />
            )}
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
                <p className="mb-1 text-[10px] uppercase text-[var(--ink-muted)]">文件名</p>
                <p 
                  className="cursor-help break-all text-sm font-medium leading-relaxed text-[var(--ink-primary)] transition-colors hover:text-[var(--aurora-1)]"
                  title={media.originalName || media.filename}
                >
                  {media.originalName || media.filename || '未知文件名'}
                </p>
              </div>

              {/* 元信息网格 */}
              <div className="grid grid-cols-2 gap-3">
                <div className={cn(detailPanelClass, 'p-3')}>
                  <div className="flex items-center gap-2 mb-1">
                    <HardDrive className="h-3 w-3 text-[var(--ink-muted)]" />
                    <span className="text-[10px] uppercase text-[var(--ink-secondary)]">大小</span>
                  </div>
                  <p className="text-sm font-medium text-[var(--ink-primary)]">{formatFileSize(media.fileSize)}</p>
                </div>
                <div className={cn(detailPanelClass, 'p-3')}>
                  <div className="flex items-center gap-2 mb-1">
                    <Calendar className="h-3 w-3 text-[var(--ink-muted)]" />
                    <span className="text-[10px] uppercase text-[var(--ink-secondary)]">上传时间</span>
                  </div>
                  <p className="text-sm font-medium text-[var(--ink-primary)]">{format(new Date(media.createdAt), 'MM/dd HH:mm')}</p>
                </div>
              </div>

              {/* MIME 类型 */}
              {media.mimeType && (
                <div className={cn(detailPanelClass, 'p-3')}>
                  <p className="mb-1 text-[10px] uppercase text-[var(--ink-muted)]">MIME 类型</p>
                  <p className="font-mono text-xs text-[var(--ink-primary)]">{media.mimeType}</p>
                </div>
              )}

              {isPDF && (
                <div className={cn(detailPanelClass, 'space-y-3 p-3')}>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">Atlas</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => void handleEnsureAtlasPDF()}
                      disabled={ensuringAtlas || openingAtlas || generatingAtlas}
                      className={detailSoftButtonClass}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {ensuringAtlas ? '处理中' : '加入 Atlas'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleOpenAtlasPDF()}
                      disabled={ensuringAtlas || openingAtlas || generatingAtlas}
                      className={detailSoftButtonClass}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {openingAtlas ? '打开中' : '查看标注'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleGenerateAtlasPDFSuggestions()}
                      disabled={ensuringAtlas || openingAtlas || generatingAtlas}
                      className={detailSoftButtonClass}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {generatingAtlas ? '生成中' : '抽取知识点'}
                    </button>
                  </div>
                </div>
              )}

              {isTranscriptMedia && (
                <div className={cn(detailPanelClass, 'space-y-3 p-3')}>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">Atlas Transcript</p>
                  </div>
                  <textarea
                    value={transcriptDraft}
                    onChange={(event) => setTranscriptDraft(event.target.value)}
                    placeholder="[00:12] Transcript"
                    rows={6}
                    className="min-h-[132px] w-full resize-y rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] px-3 py-2 font-mono text-xs leading-5 text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)] focus:outline-none"
                  />
                  <div className="grid gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => void handleSaveAtlasTranscript()}
                      disabled={transcriptBusy}
                      className={detailSoftButtonClass}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {savingTranscript ? '保存中' : '保存转录'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleOpenAtlasTranscript()}
                      disabled={transcriptBusy}
                      className={detailSoftButtonClass}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {openingTranscript ? '打开中' : '查看转录'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleGenerateAtlasTranscriptSuggestions()}
                      disabled={transcriptBusy}
                      className={detailSoftButtonClass}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {generatingTranscript ? '生成中' : '抽取知识点'}
                    </button>
                  </div>
                </div>
              )}

              {isImage && (
                <div className={cn(detailPanelClass, 'space-y-3 p-3')}>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">Atlas Image</p>
                  </div>
                  <textarea
                    value={imageDescriptionDraft}
                    onChange={(event) => setImageDescriptionDraft(event.target.value)}
                    placeholder="描述图片内容、OCR 文本或可作为证据的观察笔记"
                    rows={6}
                    className="min-h-[132px] w-full resize-y rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] px-3 py-2 font-mono text-xs leading-5 text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)] focus:outline-none"
                  />
                  <div className="grid gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => void handleSaveAtlasImage()}
                      disabled={imageAtlasBusy}
                      className={detailSoftButtonClass}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {savingImageDescription ? '保存中' : '保存描述'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleOpenAtlasImage()}
                      disabled={imageAtlasBusy}
                      className={detailSoftButtonClass}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {openingImageAtlas ? '打开中' : '查看标注'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleGenerateAtlasImageSuggestions()}
                      disabled={imageAtlasBusy}
                      className={detailSoftButtonClass}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {generatingImageAtlas ? '生成中' : '抽取知识点'}
                    </button>
                  </div>
                </div>
              )}

              {/* 尺寸 */}
              {(media.width && media.height) && (
                <div className={cn(detailPanelClass, 'p-3')}>
                  <p className="mb-1 text-[10px] uppercase text-[var(--ink-muted)]">尺寸</p>
                  <p className="text-sm font-medium text-[var(--ink-primary)]">{media.width} × {media.height} px</p>
                </div>
              )}

              {/* URL 复制区 */}
              <div>
                <p className="mb-2 text-[10px] uppercase text-[var(--ink-muted)]">文件地址</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={fullUrl}
                    readOnly
                    className="flex-1 truncate rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] px-3 py-2.5 font-mono text-xs text-[var(--ink-secondary)] focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)] focus:outline-none"
                  />
                  <button
                    onClick={handleOpenInNewTab}
                    className="rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] p-2.5 text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)]"
                    title="新窗口打开"
                    aria-label="新窗口打开"
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
        className="mt-auto border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] pt-4"
      >
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyUrl}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-colors',
              copied 
                ? 'bg-status-success/20 text-status-success border border-status-success-border' 
                : 'border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] text-[var(--ink-secondary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)]'
            )}
            title="复制链接"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span className="hidden sm:inline">{copied ? '已复制' : '复制'}</span>
          </button>
          
          <button
            onClick={handleDownload}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] px-3 py-2.5 text-xs font-medium text-[var(--aurora-1)] transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)]"
            title="下载文件"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">下载</span>
          </button>

          <button
            onClick={() => onDelete(media.id)}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-status-danger-border bg-status-danger-light px-3 py-2.5 text-xs font-medium text-status-danger transition-colors hover:bg-status-danger/20"
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
  const [removeFailure, setRemoveFailure] = useState<BackupRemoveFailure | null>(null);

  const syncMutation = useMutation({
    mutationFn: () => storageSyncService.syncOne(media.id),
    onSuccess: () => {
      toast.success('已加入备份队列');
      queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'detail', media.id] });
    },
    onError: (e) => {
      toast.error(extractApiErrorMessage(e, '加入备份失败'));
    },
  });

  const removeBackupMutation = useMutation({
    mutationFn: (options?: { force?: boolean }) => storageSyncService.removeBackup(media.id, options),
    onSuccess: (_resp, options) => {
      toast.success(options?.force ? '已强制移除备份关联(主文件保留)' : '已移除备份文件(主文件保留)');
      setRemoveFailure(null);
      queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'detail', media.id] });
    },
    onError: (e) => {
      const failure = getBackupRemoveFailure(e);
      if (failure?.forceAllowed) {
        setRemoveFailure(failure);
        setRemoveConfirmOpen(true);
        toast.error(failure.reason);
        return;
      }
      toast.error(extractApiErrorMessage(e, '移除备份失败'));
    },
  });

  const status = media.syncStatus || 'NONE';
  const canSync = status === 'NONE' || status === 'FAILED' || status === 'MISSING';
  const canRetry = status === 'FAILED';
  const canRemove = status === 'SYNCED' && !!media.backupUrl;
  const isMissing = status === 'MISSING';

  return (
    <div className={cn(detailPanelClass, 'space-y-2.5 p-3')}>
      <p className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">存储信息</p>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ink-secondary)]">云端状态</span>
        <StorageStatusIcon
          storageType={media.storageType}
          syncStatus={status}
          size="md"
          showLabel
        />
      </div>
      {media.storageType && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--ink-secondary)]">主存储</span>
          <span className="font-mono text-[11px] tracking-wider text-[var(--ink-muted)]">{media.storageType}</span>
        </div>
      )}
      {media.cdnUrl && (
        <div>
          <p className="mb-1 text-[10px] text-[var(--ink-muted)]">访问 URL</p>
          <a
            href={media.cdnUrl}
            target="_blank"
            rel="noreferrer"
            className="block break-all font-mono text-xs text-[var(--aurora-1)] hover:underline"
          >
            {media.cdnUrl}
          </a>
        </div>
      )}
      {media.backupUrl && status !== 'MISSING' && (
        <div>
          <p className="mb-1 text-[10px] text-[var(--ink-muted)]">备份位置</p>
          <a
            href={media.backupUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 break-all font-mono text-xs text-[var(--ink-secondary)] hover:text-[var(--aurora-1)] hover:underline"
          >
            {media.backupUrl}
            <ExternalLinkIcon className="w-3 h-3 shrink-0" />
          </a>
        </div>
      )}
      {media.backupAt && (
        <p className="text-[10px] text-[var(--ink-muted)]">
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
            onClick={() => {
              setRemoveFailure(null);
              setRemoveConfirmOpen(true);
            }}
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
        title={removeFailure ? '强制移除备份关联' : '移除备份'}
        message={
          removeFailure
            ? `远端备份删除失败: ${removeFailure.reason}。可以强制清理媒体库中的备份关联,主文件会保留,但不会继续删除云端对象。是否继续?`
            : '将删除备份对象,但主文件保留。可随时通过「立即同步」重新复制。是否继续?'
        }
        confirmText={removeFailure ? '强制移除关联' : '移除备份'}
        cancelText="取消"
        variant="danger"
        onConfirm={() => {
          setRemoveConfirmOpen(false);
          removeBackupMutation.mutate({ force: !!removeFailure });
        }}
        onCancel={() => {
          setRemoveConfirmOpen(false);
          setRemoveFailure(null);
        }}
      />
    </div>
  );
}
