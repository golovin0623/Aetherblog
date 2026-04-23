/**
 * @file MediaPage.tsx
 * @description 媒体库主页面
 * @ref §3.2.4 - 媒体管理模块
 */

import { useState, useCallback, useMemo, useRef, DragEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  Filter,
  Trash2,
  Check,
  X,
  Copy,
  Download,
  Link2,
  ChevronRight,
  RefreshCw,
  Eye,
  Image as ImageIcon,
  Video as VideoIcon,
  Music as MusicIcon,
  FileText,
  File,
  Upload,
  Loader2,
  CheckCircle2,
  FolderInput,
  Keyboard,
  FolderOpen,
  Folder,
  PanelLeftClose,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks';
import { mediaService, MediaListParams, MediaType, getMediaUrl } from '@/services/mediaService';
import { folderService } from '@/services/folderService';
import { MediaGrid } from './media/components/MediaGrid';
import { MediaList } from './media/components/MediaList';
import { MediaDetail } from './media/components/MediaDetail';
import { MediaViewer } from './media/components/MediaViewer';
import { UploadProgress } from './media/components/UploadProgress';
import { MediaGridSkeleton } from './media/components/MediaGridSkeleton';
import { FolderTree } from './media/components/FolderTree';
import { FolderDialog } from './media/components/FolderDialog';
import { MoveDialog } from './media/components/MoveDialog';
import { TagFilterBar } from './media/components/TagFilterBar';
import { VirtualMediaGrid } from './media/components/VirtualMediaGrid';
import { KeyboardShortcutsPanel } from './media/components/KeyboardShortcutsPanel';
import { TrashDialog } from './media/components/TrashDialog';
import { MediaGridSkeleton as MediaSkeletonGrid, MediaListSkeleton, FolderTreeSkeleton } from '@/components/skeletons/MediaSkeleton';
import { useMediaKeyboardShortcuts } from '@/hooks/useMediaKeyboardShortcuts';
import { Pagination } from '@/components/common/Pagination';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import type { MediaFolder } from '@aetherblog/types';

type ViewMode = 'grid' | 'list';
type FilterType = 'ALL' | MediaType;

interface UploadingFile {
  file: File;
  progress: number;
  id: string;
  error?: string;
  status: 'uploading' | 'processing' | 'success' | 'error';
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

  // @ref 移动端文件夹抽屉状态
  const [showMobileFolders, setShowMobileFolders] = useState(false);

  // 文件夹面板可调整宽度
  const [folderPanelWidth, setFolderPanelWidth] = useState(288);
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
      const newWidth = Math.min(Math.max(resizeRef.current.startWidth + delta, 256), 520);
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

  const { data, isLoading } = useQuery({
    queryKey: ['media', 'list', params],
    queryFn: async () => {
      const res = await mediaService.getList(params);
      return res.data; // 返回 PageResult<MediaItem>
    },
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

  const deleteMutation = useMutation({
    mutationFn: (id: number) => mediaService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
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
    toast.custom((t) => (
      <div className="bg-[var(--bg-card)] border border-[var(--border-default)] dark:border-white/10 rounded-xl p-4 shadow-2xl w-80">
        <div className="flex items-start gap-4">
          <div className="p-2 bg-status-danger-light dark:bg-status-danger-light rounded-lg shrink-0">
            <Trash2 className="w-5 h-5 text-status-danger" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] dark:text-white mb-1">移入回收站？</h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              文件将移入回收站，可在回收站中恢复或彻底删除。
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toast.dismiss(t)}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] dark:text-[var(--text-tertiary)] hover:text-[var(--text-primary)] dark:hover:text-white bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] dark:hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  deleteMutation.mutate(id);
                  toast.dismiss(t);
                  onSuccess?.();
                }}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-status-danger hover:bg-status-danger rounded-lg transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      </div>
    ), { duration: 5000 });
  };

  const currentItems = data?.list || [];
  const currentMedia = currentItems.find((item: any) => item.id === selectedMedia);

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
      queryClient.invalidateQueries({ queryKey: ['media', 'trash', 'count'] });
      setSelectedIds(new Set());
      toast.success('已批量移入回收站');
    },
  });

  const handleUpload = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const newFiles: UploadingFile[] = fileArray.map((file) => ({
        file,
        progress: 0,
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        status: 'uploading' as const,
      }));

      setUploadingFiles((prev) => [...prev, ...newFiles]);

      newFiles.forEach(async (uploadFile) => {
        try {
          // @ref Phase 1: 上传到当前选中的文件夹
          await mediaService.upload(uploadFile.file, (progress: number) => {
            setUploadingFiles((prev) =>
              prev.map((f) => {
                if (f.id !== uploadFile.id) return f;
                // 当进度达到 100% 时，切换到 'processing' 状态
                if (progress >= 100) {
                  return { ...f, progress: 100, status: 'processing' as const };
                }
                return { ...f, progress, status: 'uploading' as const };
              })
            );
          }, currentFolderId);
          // 服务器返回成功响应，标记为成功并延迟移除
          setUploadingFiles((prev) =>
            prev.map((f) => f.id === uploadFile.id ? { ...f, status: 'success' as const } : f)
          );
          // 延迟 1 秒后移除成功项，让用户看到成功状态
          setTimeout(() => {
            setUploadingFiles((prev) => prev.filter((f) => f.id !== uploadFile.id));
          }, 1000);
          queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
        } catch (error: any) {
          const errorMessage = error.response?.data?.msg || error.response?.data?.message || '上传失败';
          logger.error('Upload failed:', error);
          setUploadingFiles((prev) =>
            prev.map((f) => f.id === uploadFile.id ? { ...f, status: 'error' as const, error: errorMessage } : f)
          );
          // 显示错误提示
          toast.error(`${uploadFile.file.name}: ${errorMessage}`);
        }
      });
    },
    [queryClient, currentFolderId]
  );

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
    toast.custom((t) => (
      <div className="bg-[var(--bg-card)] border border-[var(--border-default)] dark:border-white/10 rounded-xl p-4 shadow-2xl w-80">
        <div className="flex items-start gap-4">
          <div className="p-2 bg-status-danger-light dark:bg-status-danger-light rounded-lg shrink-0">
            <Trash2 className="w-5 h-5 text-status-danger" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] dark:text-white mb-1">删除文件夹？</h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              此操作将删除文件夹及其所有子文件夹和文件，无法撤销。
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toast.dismiss(t)}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] dark:text-[var(--text-tertiary)] hover:text-[var(--text-primary)] dark:hover:text-white bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] dark:hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={async () => {
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
                  toast.dismiss(t);
                }}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-status-danger hover:bg-status-danger rounded-lg transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      </div>
    ), { duration: 5000 });
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
      className="p-4 lg:p-6 h-full flex flex-col gap-4 lg:gap-6 overflow-hidden"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-[var(--text-primary)] mb-0.5 lg:mb-1">媒体库</h1>
          <p className="text-xs lg:text-sm text-[var(--text-secondary)] hidden sm:block">管理您的图片、视频和文档资源</p>
        </div>

        <div className="flex items-center gap-2 lg:gap-3">
          <button
            onClick={() => setShowMobileFolders(true)}
            className="lg:hidden p-2 hover:bg-[var(--bg-card-hover)] rounded-lg transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title="文件夹"
          >
            <Folder className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowShortcuts(true)}
            className="p-2 hover:bg-[var(--bg-card-hover)] rounded-lg transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title="键盘快捷键 (⌘ /)"
          >
            <Keyboard className="w-5 h-5" />
          </button>
          <button
            onClick={() => setTrashDialogOpen(true)}
            className="relative p-2 hover:bg-[var(--bg-card-hover)] rounded-lg transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title="回收站"
          >
            <Trash2 className="w-5 h-5" />
            {trashCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-status-danger rounded-full">
                {trashCount > 99 ? '99+' : trashCount}
              </span>
            )}
          </button>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            multiple
            onChange={(e) => e.target.files && handleUpload(e.target.files)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="ml-2 lg:ml-3 flex items-center gap-2 px-3 py-1.5 lg:px-4 lg:py-2 bg-primary hover:bg-primary/90 text-white rounded-lg lg:rounded-xl transition-all shadow-lg shadow-primary/20"
          >
            <Upload className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
            <span className="text-sm font-medium">上传</span>
          </button>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row lg:items-center gap-3 shrink-0 bg-transparent lg:bg-[var(--bg-card)] lg:p-2 lg:rounded-2xl lg:border lg:border-[var(--border-subtle)]">
        <div className="relative w-full lg:flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="搜索文件名..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[var(--bg-card)] hover:bg-[var(--bg-secondary)] focus:bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl pl-10 pr-4 py-2.5 lg:py-2 text-sm focus:border-primary/50 text-[var(--text-primary)] transition-all outline-none shadow-sm"
          />
        </div>

        <div className="flex items-center justify-between gap-3 lg:contents">
            {/* 类型过滤胶囊组 —— 自适应内容宽度,可横向滚动 */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] min-w-0 overflow-x-auto no-scrollbar">
            {typeOptions.map((opt) => {
                const Icon = opt.icon;
                const active = filterType === opt.value;
                return (
                <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFilterType(opt.value)}
                    className={cn(
                    'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium transition-all shrink-0 whitespace-nowrap',
                    active
                        ? 'bg-[var(--aurora-1)] text-white shadow-[0_4px_12px_-4px_color-mix(in_oklch,var(--aurora-1)_45%,transparent)]'
                        : 'text-[var(--ink-secondary,var(--text-muted))] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]'
                    )}
                >
                    <Icon className="w-3.5 h-3.5" strokeWidth={1.8} />
                    <span className="leading-none">{opt.label}</span>
                </button>
                );
            })}
            </div>

            <div className="w-px h-6 bg-[var(--border-subtle)] hidden lg:block" />

            {/* 视图切换 —— 正方形等宽,确保图标视觉居中 */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] shrink-0">
            <button
                type="button"
                onClick={() => setViewMode('grid')}
                aria-label="网格视图"
                className={cn(
                'inline-flex items-center justify-center w-8 h-8 rounded-lg transition-all',
                viewMode === 'grid'
                    ? 'bg-[var(--aurora-1)] text-white shadow-[0_4px_12px_-4px_color-mix(in_oklch,var(--aurora-1)_45%,transparent)]'
                    : 'text-[var(--ink-secondary,var(--text-muted))] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]'
                )}
            >
                <LayoutGrid className="w-4 h-4" strokeWidth={1.8} />
            </button>
            <button
                type="button"
                onClick={() => setViewMode('list')}
                aria-label="列表视图"
                className={cn(
                'inline-flex items-center justify-center w-8 h-8 rounded-lg transition-all',
                viewMode === 'list'
                    ? 'bg-[var(--aurora-1)] text-white shadow-[0_4px_12px_-4px_color-mix(in_oklch,var(--aurora-1)_45%,transparent)]'
                    : 'text-[var(--ink-secondary,var(--text-muted))] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]'
                )}
            >
                <List className="w-4 h-4" strokeWidth={1.8} />
            </button>
            </div>
        </div>
      </div>

      {/* 主布局: 左侧文件夹树 + 右侧内容区 */}
      <div className="flex-1 flex gap-4 lg:gap-6 overflow-hidden">
        {/* 左侧文件夹树 - 可调整宽度 */}
        <div
          className="hidden lg:flex shrink-0 relative"
          style={{ width: folderPanelWidth }}
        >
          <div className="flex-1 h-full surface-leaf !rounded-2xl flex flex-col overflow-hidden">
            {/* 固定标题头 */}
            <div className="px-4 py-3.5 flex items-center justify-between shrink-0 border-b border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]">
              <div className="flex items-center gap-2">
                <span className="relative inline-flex items-center justify-center w-6 h-6">
                  <span className="absolute inset-0 rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]" />
                  <FolderOpen className="relative w-3.5 h-3.5 text-[var(--aurora-1)]" strokeWidth={1.6} />
                </span>
                <h2 className="font-display text-[14px] font-semibold text-[var(--ink-primary)]">文件夹</h2>
              </div>
              <button
                type="button"
                onClick={() => handleCreateFolder()}
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--ink-tertiary,var(--text-muted))] hover:text-[var(--aurora-1)] transition-colors"
                title="新建文件夹"
                aria-label="新建文件夹"
              >
                <Plus className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>

            {/* 可滚动的文件树区域 - 隐藏滑轨 */}
            <div className="flex-1 overflow-y-auto no-scrollbar px-2 py-2">
              <FolderTree
                selectedFolderId={currentFolderId}
                onSelectFolder={(id: number | undefined) => setCurrentFolderId(id)}
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
              "absolute -right-5 top-0 bottom-0 w-6 cursor-col-resize z-20 group",
              "flex items-center justify-center transition-all",
              isResizing && "bg-primary/5"
            )}
          >
            {/* 中心把手 */}
            <div className={cn(
              "w-1.5 h-10 rounded-full transition-all flex flex-col items-center justify-center gap-1",
              isResizing
                ? "bg-primary shadow-[0_0_15px_rgba(99,102,241,0.5)] h-14"
                : "bg-[var(--bg-quaternary)] dark:bg-[var(--bg-tertiary)] group-hover:bg-primary group-hover:h-14"
            )}>
              {/* 抓取点装饰 */}
              <div className="w-0.5 h-0.5 rounded-full bg-white/50" />
              <div className="w-0.5 h-0.5 rounded-full bg-white/50" />
              <div className="w-0.5 h-0.5 rounded-full bg-white/50" />
            </div>
          </div>
        </div>

      {/* 主内容区 + 抽屉式侧边栏 (完美同步) */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* 主内容区 - 自动调整宽度，移除 layout 属性以避免垂直抖动 */}
        <div className="flex-1 flex flex-col gap-6 overflow-hidden">
          {/* 将加载状态和内容包装在同一个容器中以避免布局跳动 */}
          <div className="flex-1 flex flex-col h-full">
            {isLoading ? (
              <div className="flex-1 overflow-hidden p-1">
                {/* @ref Phase 6: 使用新的骨架屏组件 */}
                {viewMode === 'grid' ? (
                  <MediaSkeletonGrid count={20} />
                ) : (
                  <MediaListSkeleton count={10} />
                )}
              </div>
            ) : currentItems.length > 0 ? (
            <div className="flex-1 overflow-y-auto no-scrollbar pb-20 pr-0 lg:pr-4">
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
                    onDownload={(item) => handleDownload(item.fileUrl, item.originalName)}
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
                <div className="mt-8 flex justify-center">
                  <Pagination
                    page={page}
                    total={data.total}
                    pageSize={20}
                    onPageChange={setPage}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-[var(--bg-card)] rounded-3xl border border-dashed border-[var(--border-subtle)]">
              <div className="w-20 h-20 rounded-3xl bg-[var(--bg-secondary)] flex items-center justify-center mb-4">
                <ImageIcon className="w-10 h-10 text-[var(--text-muted)]" />
              </div>
              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-1">暂无媒体文件</h3>
              <p className="text-sm text-[var(--text-secondary)]">点击上方按钮或拖拽文件到此处上传</p>
            </div>
          )}
          </div>
        </div>

      {/* 侧边详情栏 - 桌面端 (lg:block) */}
        <AnimatePresence>
          {selectedMedia && currentMedia && (
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: 384 }}
              exit={{ width: 0 }}
              transition={{
                duration: 0.4,
                ease: [0.32, 0.72, 0, 1]
              }}
              className="hidden lg:block shrink-0 overflow-hidden will-change-[width]"
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
                className="w-96 h-full pl-6"
              >
                <div className="h-full bg-[var(--bg-card)] backdrop-blur-sm rounded-3xl border border-[var(--border-subtle)] p-6 overflow-hidden">
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
        <AnimatePresence>
          {selectedMedia && currentMedia && (
            <>
              {/* 遮罩 */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="lg:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
                onClick={() => setSelectedMedia(null)}
              />
              
              {/* Bottom Sheet */}
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                drag="y"
                dragConstraints={{ top: 0 }}
                dragElastic={0.2}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 100) {
                    setSelectedMedia(null);
                  }
                }}
                // 底部菜单 (Bottom Sheet)
                className="lg:hidden fixed bottom-0 left-0 right-0 z-50 h-[85vh] bg-white/85/85 backdrop-blur-xl rounded-t-3xl border-t border-white/20 dark:border-white/10 shadow-2xl overflow-hidden flex flex-col"
              >
                {/* 拖拽手柄 */}
                <div className="flex justify-center pt-3 pb-1 shrink-0" onClick={() => setSelectedMedia(null)}>
                  <div className="w-12 h-1.5 bg-[var(--bg-secondary)] rounded-full" />
                </div>

                <div className="flex-1 overflow-y-auto p-4 pb-safe-area">
                  <MediaDetail
                    item={currentMedia}
                    onClose={() => setSelectedMedia(null)}
                    onDelete={(id) => handleDeleteConfirm(id)}
                    onMove={handleMoveFile}
                  />
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>


        {/* 拖拽上传遮罩 */}
        <AnimatePresence>
          {isDragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-primary/10 backdrop-blur-sm border-4 border-dashed border-primary rounded-3xl flex items-center justify-center"
            >
              <div className="bg-black/80 rounded-3xl p-8 flex flex-col items-center gap-4">
                <Upload className="w-12 h-12 text-primary animate-bounce" />
                <p className="text-xl font-bold text-white">松开上传到媒体库</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </div>

      {uploadingFiles.length > 0 && (
        <UploadProgress
          files={uploadingFiles}
          onCancel={(id) => setUploadingFiles((prev) => prev.filter((f) => f.id !== id))}
        />
      )}

      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed left-1/2 -translate-x-1/2 z-50 pointer-events-none bottom-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-10 w-[calc(100vw-1rem)] sm:w-auto max-w-[min(960px,calc(100vw-1rem))]"
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

              <div className="flex items-center gap-1.5 sm:gap-3 flex-1 min-w-0 overflow-x-auto no-scrollbar">
                <button
                  onClick={() => {
                    const urls = currentItems
                      .filter((item: any) => selectedIds.has(item.id))
                      .map((item: any) => getMediaUrl(item.fileUrl))
                      .join('\n');
                    navigator.clipboard.writeText(urls);
                    toast.success('已复制所有选中链接');
                  }}
                  title="复制全部链接"
                  aria-label="复制全部链接"
                  className="flex items-center gap-2 rounded-xl sm:rounded-2xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] transition-all group shrink-0 p-2 sm:px-4 sm:py-2.5"
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
                  className="flex items-center gap-2 rounded-xl sm:rounded-2xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] transition-all group shrink-0 p-2 sm:px-4 sm:py-2.5"
                >
                  <FolderInput className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
                  <span className="hidden sm:inline text-xs font-semibold">批量移动</span>
                </button>

                <button
                  onClick={() => {
                    const count = selectedIds.size;
                    const ids = Array.from(selectedIds);
                    toast.custom((t) => (
                      <div className="bg-[var(--bg-card)] border border-[var(--border-default)] dark:border-white/10 rounded-xl p-4 shadow-2xl w-80">
                        <div className="flex items-start gap-4">
                          <div className="p-2 bg-status-danger-light dark:bg-status-danger-light rounded-lg shrink-0">
                            <Trash2 className="w-5 h-5 text-status-danger" />
                          </div>
                          <div className="flex-1">
                            <h3 className="text-sm font-semibold text-[var(--text-primary)] dark:text-white mb-1">批量移入回收站?</h3>
                            <p className="text-xs text-[var(--text-muted)] mb-4">
                              选中的 {count} 个文件将移入回收站，可在回收站中恢复或彻底删除。
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => toast.dismiss(t)}
                                className="flex-1 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] dark:text-[var(--text-tertiary)] hover:text-[var(--text-primary)] dark:hover:text-white bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] dark:hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
                              >
                                取消
                              </button>
                              <button
                                onClick={() => {
                                  batchDeleteMutation.mutate(ids);
                                  toast.dismiss(t);
                                }}
                                className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-status-danger hover:bg-status-danger rounded-lg transition-colors"
                              >
                                确认删除
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ), { duration: 5000 });
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
                className="flex items-center gap-1.5 rounded-xl sm:rounded-2xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all shrink-0 p-2 sm:px-3 sm:py-2.5"
              >
                <X className="w-4 h-4" />
                <span className="text-xs font-semibold">取消全选</span>
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
              className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[60]"
            />
          )}
        </AnimatePresence>

        {/* 抽屉内容 —— Codex surface-overlay,加宽到 88vw / 360px 以消除截断 */}
        <div
          className={cn(
            "fixed left-0 top-0 bottom-0 w-[88vw] max-w-[360px] z-[70] flex flex-col",
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
                setCurrentFolderId(id);
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
    </div>
  );
}
