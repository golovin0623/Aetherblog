/**
 * @file MediaPage.tsx
 * @description 媒体库主页面
 * @ref §3.2.4 - 媒体管理模块
 */

import { useState, useCallback, useRef, useEffect, type DragEvent, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  Filter,
  Trash2,
  X,
  Link2,
  RefreshCw,
  Image as ImageIcon,
  Video as VideoIcon,
  Music as MusicIcon,
  FileText,
  Upload,
  FolderInput,
  Keyboard,
  FolderOpen,
  Folder,
  PanelLeftClose,
  CloudUpload,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks';
import { mediaService, MediaItem, MediaListParams, MediaType, getMediaUrl, isUploadAborted } from '@/services/mediaService';
import { folderService } from '@/services/folderService';
import { MediaGrid } from './media/components/MediaGrid';
import { MediaList } from './media/components/MediaList';
import { MediaDetail } from './media/components/MediaDetail';
import { MediaViewer } from './media/components/MediaViewer';
import { UploadProgress } from './media/components/UploadProgress';
import { FolderTree } from './media/components/FolderTree';
import { FolderDialog } from './media/components/FolderDialog';
import { MoveDialog } from './media/components/MoveDialog';
import { VirtualMediaGrid } from './media/components/VirtualMediaGrid';
import { KeyboardShortcutsPanel } from './media/components/KeyboardShortcutsPanel';
import { TrashDialog } from './media/components/TrashDialog';
import { SyncDialog } from './media/components/SyncDialog';
import { MediaGridSkeleton as MediaSkeletonGrid, MediaListSkeleton } from '@/components/skeletons/MediaSkeleton';
import { useMediaKeyboardShortcuts } from '@/hooks/useMediaKeyboardShortcuts';
import { AdminPagination } from '@/components/common/AdminPagination';
import { ConfirmModal } from '@aetherblog/ui';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import type { MediaFolder } from '@aetherblog/types';
import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { AdminSectionCount, AdminSectionHeader } from '@/components/layout/AdminSectionHeader';

type PendingConfirm =
  | { kind: 'trash-file'; id: number; onSuccess?: () => void }
  | { kind: 'delete-folder'; folderId: number }
  | { kind: 'batch-trash'; ids: number[] };

type ViewMode = 'grid' | 'list';
type FilterType = 'ALL' | MediaType;
type ActiveChip = {
  key: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  onRemove: () => void;
};

function hasActiveMediaSync(items?: MediaItem[]): boolean {
  return items?.some((item) => item.syncStatus === 'PENDING' || item.syncStatus === 'SYNCING') ?? false;
}

const mediaPanelClass = cn(
  'media-neutral-surface access-surface surface-leaf surface-admin-panel rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'p-3 shadow-sm sm:p-4'
);

const mediaShellClass = cn(
  'media-neutral-surface access-surface overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'bg-[var(--bg-leaf)] shadow-[0_18px_48px_-42px_rgba(0,0,0,0.45)]'
);

function mediaChipClass(isSelected: boolean, compactOnMobile = false): string {
  return cn(
    'relative z-0 inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full text-xs font-medium',
    'transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)]',
    compactOnMobile ? 'h-11 w-11 gap-0 px-0 sm:h-7 sm:w-auto sm:gap-1.5 sm:px-3' : 'h-7 gap-1.5 px-3',
    isSelected ? 'text-[var(--ink-primary)]' : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]'
  );
}

function SegmentThumb({ layoutId }: { layoutId: string }) {
  return (
    <motion.span
      layoutId={layoutId}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] shadow-[0_1px_2px_color-mix(in_oklch,var(--ink-primary)_8%,transparent)]"
      transition={{ type: 'spring', stiffness: 430, damping: 34, mass: 0.55 }}
    />
  );
}

function utilityButtonClass(tone: 'default' | 'danger' | 'primary' = 'default'): string {
  return cn(
    'inline-flex h-11 w-11 shrink-0 items-center justify-center gap-0 rounded-lg border p-0 text-xs font-semibold',
    'transition-[border-color,background-color,color,transform] duration-[var(--dur-quick)] ease-[var(--ease-out)] active:translate-y-px',
    'sm:h-9 sm:w-auto sm:gap-1.5 sm:px-3',
    tone === 'primary' &&
      'border-[color-mix(in_oklch,var(--aurora-1)_26%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)] hover:border-[color-mix(in_oklch,var(--aurora-1)_42%,transparent)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]',
    tone === 'danger' &&
      'border-[color-mix(in_oklch,var(--signal-danger)_24%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_12%,transparent)]',
    tone === 'default' &&
      'border-[color-mix(in_oklch,var(--ink-primary)_9%,transparent)] bg-[var(--bg-leaf)] text-[var(--ink-secondary)] hover:border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] hover:text-[var(--ink-primary)]'
  );
}

/**
 * UploadingFile 是 UploadProgress 浮窗里展示的纯渲染数据。
 *
 * AbortController 不放在 state 里 —— 改用 controllersRef.current(Map<id, AbortController>),
 * 解决"异步 setState 完成前 cancel 即触发 → controller 还是 undefined,abort() 失效"的 race。
 * @ref PR #646 fix: gemini-code-assist medium — controller race condition
 */
interface UploadingFile {
  file: File;
  progress: number;
  id: string;
  error?: string;
  status: 'queued' | 'uploading' | 'processing' | 'success' | 'error' | 'aborted';
  /** 当前重试次数(2 = 第 1 次重试中) */
  attempt?: number;
  /** 目标文件夹 ID(用于 retry 时复用) */
  folderId?: number;
}

const typeOptions: { value: FilterType; label: string; icon: any }[] = [
  { value: 'ALL', label: '全部', icon: Filter },
  { value: 'IMAGE', label: '图片', icon: ImageIcon },
  { value: 'VIDEO', label: '视频', icon: VideoIcon },
  { value: 'AUDIO', label: '音频', icon: MusicIcon },
  { value: 'DOCUMENT', label: '文档', icon: FileText },
];

/**
 * 媒体库主页面
 */
export default function MediaPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filterType, setFilterType] = useState<FilterType>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [page, setPage] = useState(1);
  const [selectedMedia, setSelectedMedia] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [viewingIndex, setViewingIndex] = useState(0);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  // 副作用专用 ref —— React state 之外保留 abort 控制器和最新文件快照,
  // 避免在 setState updater 内调副作用(违反 React 纯函数语义),
  // 也避免"setState 还没落到 state 时 cancel 已经触发"的 race。
  // @ref PR #646 fix: gemini-code-assist medium — controller race + setState 反模式
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const uploadingFilesRef = useRef<UploadingFile[]>([]);

  // @ref 媒体库深度优化方案 - Phase 1: 文件夹管理状态
  const [currentFolderId, setCurrentFolderId] = useState<number | undefined>(undefined);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<MediaFolder | undefined>(undefined);
  const [parentFolderId, setParentFolderId] = useState<number | undefined>(undefined);

  // @ref Phase 1: 移动对话框状态
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<{ type: 'file' | 'folder'; id: number; name: string } | null>(null);
  const [batchMoveIds, setBatchMoveIds] = useState<number[]>([]);

  // @ref Phase 2: 标签筛选状态
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);

  // @ref Phase 6: 快捷键面板状态
  const [showShortcuts, setShowShortcuts] = useState(false);

  // @ref 回收站对话框状态
  const [trashDialogOpen, setTrashDialogOpen] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);

  // @ref 移动端文件夹抽屉状态
  const [showMobileFolders, setShowMobileFolders] = useState(false);

  // 删除确认弹窗状态（统一一个 ConfirmModal，按 kind 区分文案与回调）
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  // 文件夹面板可调整宽度
  const [folderPanelWidth, setFolderPanelWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 处理拖拽调整宽度
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeRef.current = {
      startX: e.clientX,
      startWidth: folderPanelWidth,
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = e.clientX - resizeRef.current.startX;
      const newWidth = Math.min(Math.max(resizeRef.current.startWidth + delta, 248), 440);
      setFolderPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [folderPanelWidth]);

  // @ref Phase 6: 键盘快捷键集成
  useMediaKeyboardShortcuts({
    onUpload: () => fileInputRef.current?.click(),
    onNewFolder: () => handleCreateFolder(),
    onSelectAll: () => {
      const allIds = new Set(currentItems.map((item: any) => item.id));
      setSelectedIds(allIds);
    },
    onDelete: () => {
      if (selectedIds.size > 0) {
        const ids = Array.from(selectedIds);
        batchDeleteMutation.mutate(ids);
      }
    },
    onSearch: () => {
      const searchInput = document.querySelector('input[type="text"]') as HTMLInputElement;
      searchInput?.focus();
    },
    onEscape: () => {
      if (selectedMedia) setSelectedMedia(null);
      else if (selectedIds.size > 0) setSelectedIds(new Set());
    },
    onToggleHelp: () => setShowShortcuts((prev) => !prev),
    enabled: !isViewerOpen && !folderDialogOpen && !moveDialogOpen,
  });

  // 获取媒体列表
  const params: MediaListParams = {
    pageNum: page,
    pageSize: 20,
    fileType: filterType === 'ALL' ? undefined : filterType,
    keyword: debouncedSearch || undefined,
    folderId: currentFolderId, // @ref Phase 1: 传递当前文件夹ID
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['media', 'list', params],
    queryFn: async () => {
      const res = await mediaService.getList(params);
      return res.data; // 返回 PageResult<MediaItem>
    },
    refetchInterval: (query) => (hasActiveMediaSync(query.state.data?.list) ? 2000 : false),
  });

  // @ref 回收站: 获取回收站文件数量
  const { data: trashCountData } = useQuery({
    queryKey: ['media', 'trash', 'count'],
    queryFn: async () => {
      const res = await mediaService.getTrashCount();
      return res.data;
    },
  });
  const trashCount = trashCountData || 0;
  const listRefreshing = isFetching && !isLoading;

  const deleteMutation = useMutation({
    mutationFn: (id: number) => mediaService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'trash'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'trash', 'count'] });
      // 只有当删除的是当前选中的项目才关闭详情栏
      if (selectedMedia) {
        // 使用函数式更新确保获取最新状态
        setSelectedMedia((prev) => {
          // 这里其实 deleteMutation 是在 MediaDetail 触发的，
          // MediaDetail 传进来的是具体的 id，但这里 selectedMedia 是 state
          // 为了简单，如果删除操作成功，我们可以直接关闭详情栏如果它是打开的
          return null;
        });
      }
      toast.success('已移入回收站');
    },
  });

  // 删除确认处理 - 支持传入回调
  const handleDeleteConfirm = (id: number, onSuccess?: () => void) => {
    setPendingConfirm({ kind: 'trash-file', id, onSuccess });
  };

  const currentItems = data?.list || [];
  const currentMedia = currentItems.find((item: any) => item.id === selectedMedia);
  const totalMedia = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalMedia / 20));
  const activeUploadCount = uploadingFiles.filter((file) =>
    file.status === 'queued' || file.status === 'uploading' || file.status === 'processing'
  ).length;

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handleSearchChange = useCallback((nextValue: string) => {
    setSearchQuery(nextValue);
    setPage(1);
  }, []);

  const handleFilterTypeChange = useCallback((nextType: FilterType) => {
    setFilterType(nextType);
    setPage(1);
  }, []);

  const handleFolderSelect = useCallback((id: number | undefined) => {
    setCurrentFolderId(id);
    setPage(1);
  }, []);

  const resetFilters = useCallback(() => {
    setFilterType('ALL');
    setSearchQuery('');
    setSelectedTagIds([]);
    handleFolderSelect(undefined);
  }, [handleFolderSelect]);

  const activeChips: ActiveChip[] = [];
  if (filterType !== 'ALL') {
    const option = typeOptions.find((item) => item.value === filterType);
    activeChips.push({
      key: 'type',
      icon: option?.icon ?? Filter,
      label: '类型',
      value: option?.label ?? filterType,
      onRemove: () => handleFilterTypeChange('ALL'),
    });
  }
  if (debouncedSearch.trim()) {
    activeChips.push({
      key: 'search',
      icon: Search,
      label: '关键词',
      value: debouncedSearch.trim(),
      onRemove: () => handleSearchChange(''),
    });
  }
  if (currentFolderId !== undefined) {
    activeChips.push({
      key: 'folder',
      icon: Folder,
      label: '文件夹',
      value: `#${currentFolderId}`,
      onRemove: () => handleFolderSelect(undefined),
    });
  }
  if (selectedTagIds.length > 0) {
    activeChips.push({
      key: 'tags',
      icon: Filter,
      label: '标签',
      value: `${selectedTagIds.length} 个`,
      onRemove: () => setSelectedTagIds([]),
    });
  }
  const activeFilterCount = activeChips.length;

  const closeMediaDetail = useCallback(() => {
    setSelectedMedia(null);
  }, []);

  const handleSelectMedia = useCallback((id: number) => {
    setSelectedMedia((prev) => (prev === id ? null : id));
  }, []);

  const handleToggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handlePreview = useCallback((id: number) => {
    const index = currentItems.findIndex((item: any) => item.id === id);
    if (index !== -1) {
      setViewingIndex(index);
      setIsViewerOpen(true);
    }
  }, [currentItems]);

  const handleCopyUrl = useCallback((url: string) => {
    navigator.clipboard.writeText(url);
    toast.success('链接已复制到剪贴板');
  }, []);

  const handleDownload = useCallback((url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const batchDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => mediaService.batchDelete(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'trash'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'trash', 'count'] });
      setSelectedIds(new Set());
      toast.success('已批量移入回收站');
    },
  });

  // 让 uploadingFilesRef 跟踪最新 state —— 副作用回调可以直接读最新文件快照,
  // 不必再到 setUploadingFiles updater 里去找 target 后再触发副作用。
  useEffect(() => {
    uploadingFilesRef.current = uploadingFiles;
  }, [uploadingFiles]);

  // 单文件上传执行体 —— 同时被首次上传与重试调用。
  // 调用方必须先在 controllersRef 里登记好 controller,本函数不再 new。
  const startUpload = useCallback(
    (uploadId: string, file: File, folderId: number | undefined, controller: AbortController) => {
      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.id === uploadId
            ? { ...f, status: 'uploading', progress: 0, error: undefined, attempt: 1, folderId }
            : f
        )
      );

      mediaService
        .upload(file, (percent, phase) => {
          setUploadingFiles((prev) =>
            prev.map((f) =>
              f.id === uploadId && (f.status === 'uploading' || f.status === 'processing')
                ? { ...f, progress: percent, status: phase }
                : f
            )
          );
        }, {
          folderId,
          signal: controller.signal,
          onAttempt: (attempt) => {
            setUploadingFiles((prev) =>
              prev.map((f) => (f.id === uploadId ? { ...f, attempt, status: 'uploading', progress: 0 } : f))
            );
          },
        })
        .then(() => {
          controllersRef.current.delete(uploadId);
          setUploadingFiles((prev) =>
            prev.map((f) => (f.id === uploadId ? { ...f, status: 'success', progress: 100 } : f))
          );
          // 成功项淡出 —— 1.2s 后移除
          setTimeout(() => {
            setUploadingFiles((prev) => prev.filter((f) => f.id !== uploadId));
          }, 1200);
          queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
        })
        .catch((error: unknown) => {
          controllersRef.current.delete(uploadId);
          if (isUploadAborted(error)) {
            setUploadingFiles((prev) =>
              prev.map((f) => (f.id === uploadId ? { ...f, status: 'aborted', error: '已取消' } : f))
            );
            return;
          }
          const anyErr = error as { response?: { data?: { msg?: string; message?: string } }; message?: string };
          const errorMessage =
            anyErr.response?.data?.msg || anyErr.response?.data?.message || anyErr.message || '上传失败';
          logger.error('Upload failed:', error);
          setUploadingFiles((prev) =>
            prev.map((f) => (f.id === uploadId ? { ...f, status: 'error', error: errorMessage } : f))
          );
          toast.error(`${file.name}: ${errorMessage}`);
        });
    },
    [queryClient]
  );

  const handleUpload = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      // 同步预创建 controller —— 在 setState 提交前就放到 ref,即使用户在 setState
      // 完成前点 X 取消也能立即生效(消除 race condition)。
      const queued = fileArray.map((file) => {
        const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const controller = new AbortController();
        controllersRef.current.set(id, controller);
        return { id, file, controller };
      });
      const placeholders: UploadingFile[] = queued.map(({ id, file }) => ({
        file,
        progress: 0,
        id,
        status: 'queued' as const,
        folderId: currentFolderId,
      }));
      setUploadingFiles((prev) => [...prev, ...placeholders]);
      queued.forEach(({ id, file, controller }) => startUpload(id, file, currentFolderId, controller));
    },
    [currentFolderId, startUpload]
  );

  // handleCancelUpload 是纯副作用 + 最多一次 setState(终态行的移除),
  // 不再 mix 副作用到 setState updater 内部。
  const handleCancelUpload = useCallback((id: string) => {
    const controller = controllersRef.current.get(id);
    if (controller) {
      controllersRef.current.delete(id);
      controller.abort();
      // .catch 分支会把 status 切到 'aborted',这里不直接 setState 让流程统一
      return;
    }
    // 终态(success/error/aborted):直接从列表移除
    setUploadingFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  // handleRetryUpload 用 uploadingFilesRef 读最新 state(useEffect 同步过),
  // 不再在 setState updater 里 queueMicrotask 触发副作用。
  const handleRetryUpload = useCallback(
    (id: string) => {
      const target = uploadingFilesRef.current.find((f) => f.id === id);
      if (!target) return;
      if (target.status !== 'error' && target.status !== 'aborted') return;
      const controller = new AbortController();
      controllersRef.current.set(id, controller);
      startUpload(id, target.file, target.folderId, controller);
    },
    [startUpload]
  );

  const handleCancelAll = useCallback(() => {
    // ref 迭代 —— 没有 setState,纯副作用。catch 分支后续会把 status 切到 aborted。
    controllersRef.current.forEach((c) => c.abort());
    controllersRef.current.clear();
  }, []);

  const handleClearCompleted = useCallback(() => {
    setUploadingFiles((prev) =>
      prev.filter((f) => f.status === 'uploading' || f.status === 'processing' || f.status === 'queued')
    );
  }, []);

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleUpload(e.dataTransfer.files);
    }
  };

  // @ref 媒体库深度优化方案 - Phase 1: 文件夹操作处理
  const handleCreateFolder = (parentId?: number) => {
    setParentFolderId(parentId);
    setEditingFolder(undefined);
    setFolderDialogOpen(true);
  };

  const handleEditFolder = (folder: MediaFolder) => {
    setEditingFolder(folder);
    setFolderDialogOpen(true);
  };

  const handleDeleteFolder = (folderId: number) => {
    setPendingConfirm({ kind: 'delete-folder', folderId });
  };

  const performDeleteFolder = async (folderId: number) => {
    try {
      await folderService.delete(folderId);
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      if (currentFolderId === folderId) {
        setCurrentFolderId(undefined);
      }
      toast.success('文件夹已删除');
    } catch (error) {
      toast.error('删除失败');
    }
  };

  const handleMoveFolder = (folderId: number, _targetParentId?: number) => {
    // 从文件夹树找到文件夹名称
    // 这里简化处理，实际使用时可以从 folderService 获取
    setMoveTarget({ type: 'folder', id: folderId, name: `文件夹 ${folderId}` });
    setMoveDialogOpen(true);
  };

  // @ref Phase 1: 移动文件
  const handleMoveFile = (fileId: number, fileName: string) => {
    setMoveTarget({ type: 'file', id: fileId, name: fileName });
    setMoveDialogOpen(true);
  };

  return (
    <div
      className="media-library-page admin-grid-page box-border min-h-full overflow-visible p-4 text-[var(--ink-primary)] md:h-full md:overflow-hidden md:p-6"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="mx-auto flex min-h-full w-full max-w-[1440px] flex-col gap-3 px-0 py-2 sm:gap-4 sm:px-6 sm:py-4 md:h-full lg:px-8">
        <AdminModuleHeader
          className="media-balanced-actions-module-header"
          title="媒体库"
          description="统一治理图片、视频、音频与文档资源，保留文件夹、预览、编辑、分享、备份与回收站闭环。"
          icon={ImageIcon}
          currentLabel={listRefreshing ? '同步中' : '资源工作台'}
          activeSummary={`当前匹配 ${totalMedia} 个文件 · 已选 ${selectedIds.size} · 回收站 ${trashCount}${activeUploadCount > 0 ? ` · 上传中 ${activeUploadCount}` : ''}`}
          actions={
            <>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                multiple
                onChange={(e) => e.target.files && handleUpload(e.target.files)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="admin-module-action-button media-header-action media-header-upload-action"
                aria-label="上传媒体文件"
              >
                <Upload className="h-4 w-4" />
                <span>上传</span>
              </button>
            </>
          }
        />

        <div className={cn(mediaPanelClass, 'flex flex-col gap-3 sm:gap-4')}>
          <div className="order-2 grid grid-cols-1 gap-2.5 xl:order-1 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input
                type="text"
                placeholder="搜索文件名、原始名称或媒体关键词"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                aria-label="媒体文件关键词搜索"
                className={cn(
                  'h-10 w-full rounded-lg pl-9 pr-9 text-sm',
                  'border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)]',
                  'text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)]',
                  'transition-[border-color,box-shadow] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
                  'hover:border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)]',
                  'focus:border-[color-mix(in_oklch,var(--aurora-1)_50%,transparent)] focus:outline-none',
                  'focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--aurora-1)_22%,transparent)]'
                )}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => handleSearchChange('')}
                  aria-label="清空搜索"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--ink-primary)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex min-w-0 items-center gap-2">
              <div className="hidden min-w-[60px] items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)] sm:flex">
                <Filter className="h-3.5 w-3.5" />
                <span>类型</span>
              </div>
              <div className="inline-flex max-w-full items-center overflow-x-auto rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] p-0.5">
                {typeOptions.map((opt) => {
                  const Icon = opt.icon;
                  const active = filterType === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleFilterTypeChange(opt.value)}
                      className={mediaChipClass(active, true)}
                      title={`筛选${opt.label}`}
                      aria-label={`筛选${opt.label}`}
                    >
                      {active && <SegmentThumb layoutId="media-type-segment-thumb" />}
                      <Icon className="relative z-10 h-4 w-4 sm:h-3 sm:w-3" />
                      <span className="relative z-10 hidden sm:inline">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="order-1 flex flex-wrap items-center justify-between gap-2 xl:order-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => setShowMobileFolders(true)}
                className={cn(utilityButtonClass('primary'), 'lg:hidden')}
                title="文件夹"
                aria-label="打开文件夹面板"
              >
                <Folder className="h-4 w-4" />
                <span className="hidden sm:inline">文件夹</span>
              </button>
              <button
                type="button"
                onClick={() => setShowShortcuts(true)}
                className={utilityButtonClass()}
                title="键盘快捷键 (⌘ /)"
                aria-label="键盘快捷键"
              >
                <Keyboard className="h-4 w-4" />
                <span className="hidden sm:inline">快捷键</span>
              </button>
              <button
                type="button"
                onClick={() => setSyncDialogOpen(true)}
                className={utilityButtonClass('primary')}
                title="备份同步"
                aria-label="打开备份同步"
              >
                <CloudUpload className="h-4 w-4" />
                <span className="hidden sm:inline">备份同步</span>
              </button>
              <button
                type="button"
                onClick={() => setTrashDialogOpen(true)}
                className={cn(utilityButtonClass(trashCount > 0 ? 'danger' : 'default'), 'relative')}
                title="回收站"
                aria-label={trashCount > 0 ? `回收站，${trashCount > 99 ? '超过 99' : trashCount} 个项目` : '回收站'}
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">回收站</span>
                {trashCount > 0 && (
                  <span className="tnum absolute -right-1 -top-1 inline-grid h-4 min-w-4 place-items-center rounded-full bg-status-danger px-1 text-[9px] font-bold leading-4 text-white sm:static sm:ml-0.5 sm:h-auto sm:min-w-0 sm:px-1.5 sm:py-0.5 sm:text-[10px] sm:leading-none">
                    {trashCount > 99 ? '99+' : trashCount}
                  </span>
                )}
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)] sm:inline">
                视图
              </span>
              <div className="inline-flex items-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  title="网格视图"
                  aria-label="网格视图"
                  className={mediaChipClass(viewMode === 'grid', true)}
                >
                  {viewMode === 'grid' && <SegmentThumb layoutId="media-view-segment-thumb" />}
                  <LayoutGrid className="relative z-10 h-4 w-4 sm:h-3 sm:w-3" />
                  <span className="relative z-10 hidden sm:inline">网格</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  title="列表视图"
                  aria-label="列表视图"
                  className={mediaChipClass(viewMode === 'list', true)}
                >
                  {viewMode === 'list' && <SegmentThumb layoutId="media-view-segment-thumb" />}
                  <List className="relative z-10 h-4 w-4 sm:h-3 sm:w-3" />
                  <span className="relative z-10 hidden sm:inline">列表</span>
                </button>
              </div>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {activeFilterCount > 0 && (
              <motion.div
                className="order-3"
                initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
                animate={{ opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' } }}
                exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex flex-wrap items-center gap-2 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] pb-0.5 pt-3">
                  <span className="tnum text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    已应用 {activeFilterCount}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    {activeChips.map((chip) => {
                      const Icon = chip.icon;
                      return (
                        <motion.span
                          key={chip.key}
                          layout
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] pl-2.5 pr-1 text-xs"
                        >
                          <Icon className="h-3 w-3 shrink-0 text-[var(--aurora-1)]" />
                          <span className="font-mono text-[var(--ink-muted)]">{chip.label}</span>
                          <span className="max-w-[180px] truncate font-medium text-[var(--ink-primary)]">
                            {chip.value}
                          </span>
                          <button
                            type="button"
                            onClick={chip.onRemove}
                            aria-label={`移除${chip.label}筛选`}
                            className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] hover:text-[var(--ink-primary)]"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </motion.span>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-mono uppercase tracking-[0.12em] text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] hover:text-[var(--signal-danger)]"
                  >
                    <X className="h-3 w-3" />
                    全部清空
                  </button>
                </div>
                <div className="mt-2 text-xs text-[var(--ink-muted)]">
                  匹配 <span className="tnum font-medium text-[var(--ink-primary)]">{totalMedia}</span> 个媒体文件
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className={cn(mediaShellClass, 'relative flex flex-col md:min-h-0 md:flex-1')} data-refreshing={listRefreshing}>
          <AnimatePresence>
            {listRefreshing && (
              <>
                <motion.div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-[3.65rem] z-20 h-px overflow-hidden bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <motion.span
                    className="absolute inset-y-0 w-1/2 rounded-full bg-gradient-to-r from-transparent via-[var(--aurora-1)] to-transparent"
                    initial={{ x: '-100%' }}
                    animate={{ x: '220%' }}
                    transition={{ duration: 1.05, repeat: Infinity, ease: [0.16, 1, 0.3, 1] }}
                  />
                </motion.div>
                <motion.div
                  className="pointer-events-none absolute right-4 top-[4.35rem] z-20 inline-flex h-7 items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)] bg-[color-mix(in_oklch,var(--bg-leaf)_88%,transparent)] px-2.5 text-xs font-semibold text-[var(--ink-secondary)] shadow-[0_10px_26px_-20px_rgba(0,0,0,0.45)] backdrop-blur"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                >
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-[var(--aurora-1)]" />
                  刷新中
                </motion.div>
              </>
            )}
          </AnimatePresence>

          <AdminSectionHeader
            icon={<ImageIcon className="h-4 w-4" />}
            title="资源浏览"
            description={
              <>
                {currentFolderId === undefined ? '根目录与所有子资源视图' : `当前文件夹 #${currentFolderId}`}
                <span className="hidden sm:inline"> · {viewMode === 'grid' ? '网格预览' : '列表核对'}</span>
              </>
            }
            aside={<AdminSectionCount>{isLoading ? '加载中' : listRefreshing ? '刷新中' : `${currentItems.length}/${totalMedia}`}</AdminSectionCount>}
          />

          <div className="p-3 md:min-h-0 md:flex-1 lg:p-4">
            {/* 主布局: 左侧文件夹树 + 右侧内容区 */}
            <div className="flex gap-3 overflow-visible md:h-full md:overflow-hidden lg:gap-4">
              {/* 左侧文件夹树 - 可调整宽度 */}
              <div
                className="hidden shrink-0 lg:flex relative"
                style={{ width: folderPanelWidth }}
              >
                <div className="media-neutral-pane flex h-full flex-1 flex-col overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--bg-leaf)_86%,var(--bg-substrate))]">
                  {/* 固定标题头 */}
                  <div className="flex shrink-0 items-center justify-between border-b border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] px-3.5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="relative inline-flex h-6 w-6 items-center justify-center">
                        <span className="absolute inset-0 rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]" />
                        <FolderOpen className="relative h-3.5 w-3.5 text-[var(--aurora-1)]" strokeWidth={1.6} />
                      </span>
                      <h2 className="font-display text-[14px] font-semibold text-[var(--ink-primary)]">文件夹</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCreateFolder()}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] hover:text-[var(--aurora-1)]"
                      title="新建文件夹"
                      aria-label="新建文件夹"
                    >
                      <Plus className="h-4 w-4" strokeWidth={2} />
                    </button>
                  </div>

                  {/* 可滚动的文件树区域 - 隐藏滑轨 */}
                  <div className="flex-1 overflow-y-auto no-scrollbar px-2 py-2">
                    <FolderTree
                      selectedFolderId={currentFolderId}
                      onSelectFolder={handleFolderSelect}
                      onCreateFolder={handleCreateFolder}
                      onEditFolder={handleEditFolder}
                      onDeleteFolder={handleDeleteFolder}
                      onMoveFolder={handleMoveFolder}
                    />
                  </div>
                </div>

                {/* 拖拽调整宽度的手柄 - 优化位置和视觉 */}
                <div
                  onMouseDown={handleResizeStart}
                  className={cn(
                    'absolute -right-4 bottom-0 top-0 z-20 flex w-5 cursor-col-resize items-center justify-center transition-all group',
                    isResizing && 'bg-primary/5'
                  )}
                >
                  {/* 中心把手 */}
                  <div className={cn(
                    'flex h-10 w-1.5 flex-col items-center justify-center gap-1 rounded-full transition-all',
                    isResizing
                      ? 'h-14 bg-primary shadow-[0_0_15px_rgba(99,102,241,0.5)]'
                      : 'bg-[var(--bg-quaternary)] group-hover:h-14 group-hover:bg-primary dark:bg-[var(--bg-tertiary)]'
                  )}>
                    {/* 抓取点装饰 */}
                    <div className="h-0.5 w-0.5 rounded-full bg-white/50" />
                    <div className="h-0.5 w-0.5 rounded-full bg-white/50" />
                    <div className="h-0.5 w-0.5 rounded-full bg-white/50" />
                  </div>
                </div>
              </div>

              {/* 主内容区 + 抽屉式侧边栏 */}
              <div className="relative flex min-w-0 flex-1 overflow-visible md:overflow-hidden">
                {/* 主内容区 - 自动调整宽度，移除 layout 属性以避免垂直抖动 */}
                <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-visible md:overflow-hidden">
                  {/* 将加载状态和内容包装在同一个容器中以避免布局跳动 */}
                  <div className="flex flex-col md:h-full md:min-h-0 md:flex-1">
                    {isLoading ? (
                      <div className="p-1 md:flex-1 md:overflow-hidden">
                        {/* @ref Phase 6: 使用新的骨架屏组件 */}
                        {viewMode === 'grid' ? (
                          <MediaSkeletonGrid count={20} />
                        ) : (
                          <MediaListSkeleton count={10} />
                        )}
                      </div>
                    ) : currentItems.length > 0 ? (
                      <div className="pb-6 pr-0 md:flex-1 md:overflow-y-auto md:pb-16 lg:pr-2">
                        {/* @ref Phase 6: 使用虚拟滚动优化大列表性能 */}
                        {viewMode === 'grid' ? (
                          currentItems.length > 100 ? (
                            <VirtualMediaGrid
                              items={currentItems}
                              selectedIds={selectedIds}
                              onSelect={handleSelectMedia}
                              onToggleSelect={handleToggleSelect}
                              onPreview={(item) => handlePreview(item.id)}
                              onDelete={(id) => handleDeleteConfirm(id)}
                              onCopyUrl={handleCopyUrl}
                              onDownload={(item) => handleDownload(getMediaUrl(item), item.originalName)}
                            />
                          ) : (
                            <MediaGrid
                              items={currentItems}
                              selectedIds={selectedIds}
                              onSelect={handleSelectMedia}
                              onToggleSelect={handleToggleSelect}
                              onPreview={handlePreview}
                              onDelete={(id) => handleDeleteConfirm(id)}
                              onCopyUrl={handleCopyUrl}
                              onDownload={handleDownload}
                              onMove={handleMoveFile}
                              selectionMode={selectedIds.size > 0}
                              isCompact={!!selectedMedia}
                            />
                          )
                        ) : (
                          <MediaList
                            items={currentItems}
                            selectedId={selectedMedia}
                            selectedIds={selectedIds}
                            onSelect={handleSelectMedia}
                            onToggleSelect={handleToggleSelect}
                            onPreview={handlePreview}
                            onDelete={(id) => handleDeleteConfirm(id)}
                            onCopyUrl={handleCopyUrl}
                            onDownload={handleDownload}
                            onMove={handleMoveFile}
                          />
                        )}

                        {data && data.total > 20 && (
                          <AdminPagination
                            page={page}
                            total={data.total}
                            pageSize={20}
                            onPageChange={setPage}
                            className="mt-6"
                          />
                        )}
                      </div>
                    ) : (
                      <div className="media-empty-state flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[color-mix(in_oklch,var(--bg-leaf)_82%,var(--ink-primary)_3%)] px-4 text-center">
                        <div className="media-empty-icon mb-3 flex h-16 w-16 items-center justify-center rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]">
                          <ImageIcon className="h-8 w-8 text-[var(--ink-muted)]" />
                        </div>
                        <h3 className="mb-1 text-lg font-semibold text-[var(--ink-primary)]">
                          {activeFilterCount > 0 ? '没有匹配的媒体文件' : '暂无媒体文件'}
                        </h3>
                        <p className="max-w-sm text-sm leading-6 text-[var(--ink-muted)]">
                          {activeFilterCount > 0 ? '调整搜索、类型或文件夹筛选后再查看。' : '点击上传按钮或拖拽文件到此处上传。'}
                        </p>
                        {activeFilterCount > 0 && (
                          <button
                            type="button"
                            onClick={resetFilters}
                            className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--ink-primary)] px-4 text-sm font-semibold text-[var(--bg-void)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_88%,var(--aurora-1)_12%)]"
                          >
                            <X className="h-4 w-4" />
                            清空筛选
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 侧边详情栏 - 桌面端 (lg:block) */}
                <AnimatePresence>
                  {selectedMedia && currentMedia && (
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: 360 }}
                      exit={{ width: 0 }}
                      transition={{
                        duration: 0.4,
                        ease: [0.32, 0.72, 0, 1]
                      }}
                      className="hidden shrink-0 overflow-hidden will-change-[width] lg:block"
                      style={{ willChange: 'width' }}
                    >
                      <motion.div
                        initial={{ opacity: 0, x: 30 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 30 }}
                        transition={{
                          duration: 0.35,
                          ease: [0.32, 0.72, 0, 1],
                          delay: 0.05
                        }}
                        className="h-full w-[360px] pl-4"
                      >
                        <div className="media-neutral-pane h-full overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--bg-leaf)_90%,var(--bg-substrate))] p-4">
                          <MediaDetail
                            item={currentMedia}
                            onClose={() => setSelectedMedia(null)}
                            onDelete={(id) => handleDeleteConfirm(id)}
                            onMove={handleMoveFile}
                          />
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* 底部详情板 - 移动端 (lg:hidden) */}
                {typeof document !== 'undefined' && createPortal(
                  <AnimatePresence>
                    {selectedMedia && currentMedia && (
                      <motion.div
                        key={`mobile-media-detail-${selectedMedia}`}
                        initial="closed"
                        animate="open"
                        exit="closed"
                        variants={{
                          open: { opacity: 1, pointerEvents: 'auto' },
                          closed: { opacity: 0, pointerEvents: 'none' },
                        }}
                        transition={{ duration: 0.18 }}
                        className="media-library-page fixed inset-0 z-50 lg:hidden"
                      >
                        <button
                          type="button"
                          aria-label="关闭媒体详情"
                          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                          onClick={closeMediaDetail}
                        />

                        <motion.div
                          variants={{
                            open: { y: 0 },
                            closed: { y: '100%' },
                          }}
                          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                          drag="y"
                          dragConstraints={{ top: 0 }}
                          dragElastic={0.2}
                          onDragEnd={(_, info) => {
                            if (info.offset.y > 100) {
                              closeMediaDetail();
                            }
                          }}
                          className="media-neutral-pane absolute bottom-0 left-0 right-0 z-10 flex max-h-[82vh] flex-col overflow-hidden rounded-t-2xl border-t border-[var(--border-default)] bg-[var(--bg-popover)] text-[var(--text-primary)] shadow-2xl backdrop-blur-xl"
                        >
                          {/* 拖拽手柄 */}
                          <button
                            type="button"
                            className="flex shrink-0 justify-center pb-1 pt-3"
                            onClick={closeMediaDetail}
                            aria-label="关闭媒体详情"
                          >
                            <span className="h-1.5 w-12 rounded-full bg-[var(--border-hover)]" />
                          </button>

                          <div className="flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                            <MediaDetail
                              item={currentMedia}
                              onClose={closeMediaDetail}
                              onDelete={(id) => handleDeleteConfirm(id)}
                              onMove={handleMoveFile}
                            />
                          </div>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>,
                  document.body
                )}

                {/* 拖拽上传遮罩 */}
                <AnimatePresence>
                  {isDragging && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-4 border-dashed border-[var(--aurora-1)] bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] backdrop-blur-sm"
                    >
                      <div className="flex flex-col items-center gap-4 rounded-3xl bg-black/80 p-8">
                        <Upload className="h-12 w-12 animate-bounce text-[var(--aurora-1)]" />
                        <p className="text-xl font-bold text-white">松开上传到媒体库</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>

      {uploadingFiles.length > 0 && (
        <UploadProgress
          files={uploadingFiles}
          onCancel={handleCancelUpload}
          onRetry={handleRetryUpload}
          onCancelAll={handleCancelAll}
          onClearCompleted={handleClearCompleted}
        />
      )}

      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed left-1/2 -translate-x-1/2 z-50 pointer-events-none bottom-[max(1.25rem,calc(env(safe-area-inset-bottom,0px)_+_0.5rem))] sm:bottom-10 w-[calc(100vw_-_2rem)] sm:w-auto max-w-[min(960px,calc(100vw_-_2rem))]"
          >
            <div className={cn(
              "pointer-events-auto surface-overlay flex items-center",
              "gap-2 px-3 py-2.5 sm:gap-6 sm:px-8 sm:py-4",
              "!rounded-3xl sm:!rounded-[2rem]"
            )}>
              <div className="flex flex-col shrink-0 min-w-0">
                <span className="text-[var(--ink-primary,var(--text-primary))] text-xs sm:text-sm font-bold whitespace-nowrap">
                  {selectedIds.size} 项已选中
                </span>
                <span className="hidden sm:block text-[var(--ink-muted,var(--text-muted))] text-[10px] tracking-widest uppercase">
                  Batch Mode
                </span>
              </div>

              <div className="w-px h-6 sm:h-8 bg-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] shrink-0" />

              <div className="flex items-center justify-center sm:justify-start gap-1.5 sm:gap-3 flex-1 min-w-0 overflow-x-auto no-scrollbar">
                <button
                  onClick={() => {
                    const urls = currentItems
                      .filter((item: any) => selectedIds.has(item.id))
                      .map((item: any) => getMediaUrl(item))
                      .join('\n');
                    navigator.clipboard.writeText(urls);
                    toast.success('已复制所有选中链接');
                  }}
                  title="复制全部链接"
                  aria-label="复制全部链接"
                  className="group flex shrink-0 items-center gap-2 rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] p-2 text-[var(--ink-primary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] sm:rounded-2xl sm:px-4 sm:py-2.5"
                >
                  <Link2 className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
                  <span className="hidden sm:inline text-xs font-semibold">复制全部</span>
                </button>

                <button
                  onClick={() => {
                    setBatchMoveIds(Array.from(selectedIds));
                    setMoveTarget({ type: 'file', id: 0, name: '' });
                    setMoveDialogOpen(true);
                  }}
                  title="批量移动到文件夹"
                  aria-label="批量移动到文件夹"
                  className="group flex shrink-0 items-center gap-2 rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] p-2 text-[var(--ink-primary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] sm:rounded-2xl sm:px-4 sm:py-2.5"
                >
                  <FolderInput className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
                  <span className="hidden sm:inline text-xs font-semibold">批量移动</span>
                </button>

                <button
                  onClick={() => {
                    setPendingConfirm({ kind: 'batch-trash', ids: Array.from(selectedIds) });
                  }}
                  title="批量删除"
                  aria-label="批量删除"
                  className="flex items-center gap-2 rounded-xl sm:rounded-2xl bg-status-danger-light hover:bg-status-danger/20 border border-status-danger-border text-status-danger transition-all group shrink-0 p-2 sm:px-4 sm:py-2.5"
                >
                  <Trash2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                  <span className="hidden sm:inline text-xs font-semibold">批量删除</span>
                </button>
              </div>

              <div className="w-px h-6 sm:h-8 bg-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] shrink-0" />

              <button
                onClick={() => setSelectedIds(new Set())}
                title="取消全选"
                aria-label="取消全选"
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] p-2 text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)] sm:rounded-2xl sm:px-3 sm:py-2.5"
              >
                <X className="w-4 h-4" />
                <span className="hidden sm:inline text-xs font-semibold">取消全选</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isViewerOpen && (
          <MediaViewer
            items={currentItems}
            currentIndex={viewingIndex}
            onClose={() => setIsViewerOpen(false)}
            onNext={() => setViewingIndex((prev) => Math.min(prev + 1, currentItems.length - 1))}
            onPrev={() => setViewingIndex((prev) => Math.max(prev - 1, 0))}
            onSelectIndex={(index: number) => setViewingIndex(index)}
            onDelete={(id) => handleDeleteConfirm(id, () => setIsViewerOpen(false))}
            onDownload={handleDownload}
          />
        )}
      </AnimatePresence>

      {/* 文件夹对话框 */}
      <FolderDialog
        open={folderDialogOpen}
        onClose={() => {
          setFolderDialogOpen(false);
          setEditingFolder(undefined);
          setParentFolderId(undefined);
        }}
        folder={editingFolder}
        parentId={parentFolderId}
      />

      {/* @ref Phase 6: 键盘快捷键面板 */}
      <KeyboardShortcutsPanel open={showShortcuts} onOpenChange={setShowShortcuts} />

      {/* @ref 回收站对话框 */}
      <TrashDialog open={trashDialogOpen} onClose={() => setTrashDialogOpen(false)} />
      <SyncDialog open={syncDialogOpen} onClose={() => setSyncDialogOpen(false)} />

      {/* @ref 移动端文件夹抽屉 - 优化为常驻 DOM 以消除初次呼出卡顿 */}
      <div className="lg:hidden">
        {/* 遮罩 - 使用 AnimatePresence 保持淡入淡出 */}
        <AnimatePresence>
          {showMobileFolders && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMobileFolders(false)}
              className="fixed inset-x-0 bottom-0 top-14 bg-background/80 backdrop-blur-sm z-[110]"
            />
          )}
        </AnimatePresence>

        {/* 抽屉内容 —— Codex surface-overlay,加宽到 88vw / 360px 以消除截断 */}
        <div
          className={cn(
            "fixed left-0 top-14 bottom-0 w-[88vw] max-w-[360px] z-[120] flex flex-col",
            "surface-overlay !rounded-none !rounded-r-2xl",
            "transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform",
            showMobileFolders ? "translate-x-0" : "-translate-x-full"
          )}
        >
          {/* 抽屉头部 —— 极光点 + Fraunces 标题,剥离品牌渐变 */}
          <div className="px-4 h-14 flex items-center justify-between shrink-0 border-b border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="relative inline-flex items-center justify-center w-7 h-7 shrink-0">
                <span className="absolute inset-0 rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]" />
                <FolderOpen className="relative w-4 h-4 text-[var(--aurora-1)]" strokeWidth={1.6} />
              </span>
              <h2 className="font-display text-[15px] font-semibold text-[var(--ink-primary)] truncate">
                文件夹
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setShowMobileFolders(false)}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-[var(--ink-tertiary,var(--text-muted))] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] transition-colors"
              aria-label="关闭"
            >
              <PanelLeftClose className="w-5 h-5" />
            </button>
          </div>

          {/* 抽屉主体 - 文件树 */}
          <div className="flex-1 overflow-y-auto no-scrollbar px-2.5 py-3">
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="font-mono text-[10px] font-semibold text-[var(--ink-tertiary,var(--text-muted))] uppercase tracking-[0.22em]">
                目录结构
              </span>
              <button
                type="button"
                onClick={() => handleCreateFolder()}
                className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg transition-all active:scale-[0.97] bg-[var(--aurora-1)] text-white shadow-[0_6px_16px_-6px_color-mix(in_oklch,var(--aurora-1)_50%,transparent)] hover:brightness-110"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2.2} />
                <span className="text-[12px] font-semibold">新建</span>
              </button>
            </div>

            <FolderTree
              selectedFolderId={currentFolderId}
              onSelectFolder={(id: number | undefined) => {
                handleFolderSelect(id);
                setShowMobileFolders(false);
              }}
              onCreateFolder={handleCreateFolder}
              onEditFolder={handleEditFolder}
              onDeleteFolder={handleDeleteFolder}
              onMoveFolder={handleMoveFolder}
              compact
            />
          </div>

          {/* 抽屉底部 TIPS */}
          <div className="px-4 py-3 shrink-0 border-t border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]">
            <p className="font-mono text-[10px] text-[var(--ink-tertiary,var(--text-muted))] text-center leading-relaxed tracking-wide">
              <span className="text-[var(--aurora-1)] font-semibold mr-1">TIPS</span>
              长按文件夹可唤起编辑 / 删除菜单
            </p>
          </div>
        </div>
      </div>

      {/* @ref Phase 1: 移动对话框 */}
      {moveTarget && (
        <MoveDialog
          open={moveDialogOpen}
          onClose={() => {
            setMoveDialogOpen(false);
            setMoveTarget(null);
            setBatchMoveIds([]);
          }}
          type={moveTarget.type}
          itemId={moveTarget.id}
          itemName={moveTarget.name}
          currentFolderId={currentFolderId}
          batchFileIds={batchMoveIds.length > 0 ? batchMoveIds : undefined}
          onBatchMoveSuccess={() => {
            setSelectedIds(new Set());
            setBatchMoveIds([]);
          }}
        />
      )}

      <ConfirmModal
        isOpen={!!pendingConfirm}
        variant="danger"
        title={
          pendingConfirm?.kind === 'delete-folder'
            ? '删除文件夹？'
            : pendingConfirm?.kind === 'batch-trash'
              ? '批量移入回收站？'
              : '移入回收站？'
        }
        message={
          pendingConfirm?.kind === 'delete-folder'
            ? '此操作将删除文件夹及其所有子文件夹和文件，无法撤销。'
            : pendingConfirm?.kind === 'batch-trash'
              ? `选中的 ${pendingConfirm.ids.length} 个文件将移入回收站，可在回收站中恢复或彻底删除。`
              : '文件将移入回收站，可在回收站中恢复或彻底删除。'
        }
        confirmText={pendingConfirm?.kind === 'delete-folder' ? '确认删除' : '确认删除'}
        cancelText="取消"
        onConfirm={() => {
          if (!pendingConfirm) return;
          if (pendingConfirm.kind === 'trash-file') {
            deleteMutation.mutate(pendingConfirm.id);
            pendingConfirm.onSuccess?.();
          } else if (pendingConfirm.kind === 'delete-folder') {
            performDeleteFolder(pendingConfirm.folderId);
          } else if (pendingConfirm.kind === 'batch-trash') {
            batchDeleteMutation.mutate(pendingConfirm.ids);
          }
          setPendingConfirm(null);
        }}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
