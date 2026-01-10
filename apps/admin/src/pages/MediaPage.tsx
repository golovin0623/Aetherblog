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
  Upload,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import { mediaService, MediaListParams, MediaType, getMediaUrl } from '@/services/mediaService';
import { MediaGrid } from './media/components/MediaGrid';
import { MediaList } from './media/components/MediaList';
import { MediaDetail } from './media/components/MediaDetail';
import { MediaViewer } from './media/components/MediaViewer';
import { UploadProgress } from './media/components/UploadProgress';
import { MediaGridSkeleton } from './media/components/MediaGridSkeleton';
import { Pagination } from '@/components/common/Pagination';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';

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
  
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 获取媒体列表
  const params: MediaListParams = {
    pageNum: page,
    pageSize: 20,
    fileType: filterType === 'ALL' ? undefined : filterType,
    keyword: debouncedSearch || undefined,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['media', 'list', params],
    queryFn: async () => {
      const res = await mediaService.getList(params);
      return res.data; // 返回 PageResult<MediaItem>
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => mediaService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
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
      toast.success('删除成功');
    },
  });

  // 删除确认处理 - 支持传入回调
  const handleDeleteConfirm = (id: number, onSuccess?: () => void) => {
    toast.custom((t) => (
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 shadow-2xl w-80">
        <div className="flex items-start gap-4">
          <div className="p-2 bg-red-500/10 rounded-lg shrink-0">
            <Trash2 className="w-5 h-5 text-red-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-white mb-1">确认删除？</h3>
            <p className="text-xs text-zinc-400 mb-4">
              此操作无法撤销，文件将被永久删除。
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toast.dismiss(t)}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  deleteMutation.mutate(id);
                  toast.dismiss(t);
                  onSuccess?.();
                }}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
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
      setSelectedIds(new Set());
      toast.success('批量删除成功');
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
          });
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
    [queryClient]
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

  return (
    <div 
      className="p-4 lg:p-6 h-full flex flex-col gap-4 lg:gap-6 overflow-hidden"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-white mb-0.5 lg:mb-1">媒体库</h1>
          <p className="text-xs lg:text-sm text-gray-400 hidden sm:block">管理您的图片、视频和文档资源</p>
        </div>

        <div className="flex items-center gap-2 lg:gap-3">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            multiple
            onChange={(e) => e.target.files && handleUpload(e.target.files)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-1.5 lg:px-4 lg:py-2 bg-primary hover:bg-primary/90 text-white rounded-lg lg:rounded-xl transition-all shadow-lg shadow-primary/20"
          >
            <Upload className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
            <span className="text-sm font-medium">上传</span>
          </button>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row lg:items-center gap-3 shrink-0 bg-transparent lg:bg-white/5 lg:p-2 lg:rounded-2xl lg:border lg:border-white/10">
        <div className="relative w-full lg:flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索文件名..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/5 rounded-xl pl-10 pr-4 py-2.5 lg:py-2 text-sm focus:border-primary/50 transition-all outline-none"
          />
        </div>

        <div className="flex items-center justify-between gap-3 overflow-x-auto no-scrollbar lg:contents">
            <div className="flex items-center gap-1.5 lg:gap-1 p-1 bg-white/5 lg:bg-black/20 rounded-xl overflow-x-auto no-scrollbar flex-1 lg:flex-none">
            {typeOptions.map((opt) => {
                const Icon = opt.icon;
                return (
                <button
                    key={opt.value}
                    onClick={() => setFilterType(opt.value)}
                    className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0 whitespace-nowrap',
                    filterType === opt.value
                        ? 'bg-primary text-white shadow-md'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    )}
                >
                    <Icon className="w-3.5 h-3.5" />
                    {opt.label}
                </button>
                );
            })}
            </div>

            <div className="w-px h-6 bg-white/10 hidden lg:block" />

            <div className="flex items-center gap-1 p-1 bg-white/5 lg:bg-black/20 rounded-xl shrink-0">
            <button
                onClick={() => setViewMode('grid')}
                className={cn(
                'p-1.5 rounded-lg transition-all',
                viewMode === 'grid' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'
                )}
            >
                <LayoutGrid className="w-4 h-4" />
            </button>
            <button
                onClick={() => setViewMode('list')}
                className={cn(
                'p-1.5 rounded-lg transition-all',
                viewMode === 'list' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'
                )}
            >
                <List className="w-4 h-4" />
            </button>
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
                <MediaGridSkeleton />
              </div>
            ) : currentItems.length > 0 ? (
            <div className="flex-1 overflow-y-auto no-scrollbar pb-20 pr-4">
              {viewMode === 'grid' ? (
                <MediaGrid
                  items={currentItems}
                  selectedIds={selectedIds}
                  onSelect={handleSelectMedia}
                  onToggleSelect={handleToggleSelect}
                  onPreview={handlePreview}
                  onDelete={(id) => handleDeleteConfirm(id)}
                  onCopyUrl={handleCopyUrl}
                  onDownload={handleDownload}
                  selectionMode={selectedIds.size > 0}
                />
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
            <div className="flex-1 flex flex-col items-center justify-center bg-white/5 rounded-3xl border border-dashed border-white/10">
              <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mb-4">
                <ImageIcon className="w-10 h-10 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-white mb-1">暂无媒体文件</h3>
              <p className="text-sm text-gray-400">点击上方按钮或拖拽文件到此处上传</p>
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
                <div className="h-full bg-white/5 backdrop-blur-sm rounded-3xl border border-white/10 p-6 overflow-y-auto no-scrollbar">
                  <MediaDetail
                    item={currentMedia}
                    onClose={() => setSelectedMedia(null)}
                    onDelete={(id) => handleDeleteConfirm(id)}
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
                className="lg:hidden fixed bottom-0 left-0 right-0 z-50 h-[85vh] bg-[#1a1b1e] rounded-t-3xl border-t border-white/10 shadow-2xl overflow-hidden flex flex-col"
              >
                {/* 拖拽手柄 */}
                <div className="flex justify-center pt-3 pb-1 shrink-0" onClick={() => setSelectedMedia(null)}>
                  <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                </div>

                <div className="flex-1 overflow-y-auto p-4 pb-safe-area">
                  <MediaDetail
                    item={currentMedia}
                    onClose={() => setSelectedMedia(null)}
                    onDelete={(id) => handleDeleteConfirm(id)}
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
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
          >
            <div className={cn(
              "pointer-events-auto flex items-center gap-6 px-8 py-4",
              "bg-black/40 backdrop-blur-2xl border border-white/10 rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
            )}>
              <div className="flex flex-col">
                <span className="text-white text-sm font-bold">{selectedIds.size} 项已选中</span>
                <span className="text-white/40 text-[10px] tracking-widest uppercase">Batch Mode</span>
              </div>
              
              <div className="w-px h-8 bg-white/10 mx-2" />
              
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const urls = currentItems
                      .filter((item: any) => selectedIds.has(item.id))
                      .map((item: any) => getMediaUrl(item.fileUrl))
                      .join('\n');
                    navigator.clipboard.writeText(urls);
                    toast.success('已复制所有选中链接');
                  }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 text-white transition-all group"
                >
                  <Link2 className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-semibold">复制全部</span>
                </button>
                
                <button
                  onClick={() => {
                    const count = selectedIds.size;
                    const ids = Array.from(selectedIds);
                    toast.custom((t) => (
                      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 shadow-2xl w-80">
                        <div className="flex items-start gap-4">
                          <div className="p-2 bg-red-500/10 rounded-lg shrink-0">
                            <Trash2 className="w-5 h-5 text-red-500" />
                          </div>
                          <div className="flex-1">
                            <h3 className="text-sm font-semibold text-white mb-1">批量删除?</h3>
                            <p className="text-xs text-zinc-400 mb-4">
                              确定要删除选中的 {count} 个文件吗？操作无法撤销。
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => toast.dismiss(t)}
                                className="flex-1 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors"
                              >
                                取消
                              </button>
                              <button
                                onClick={() => {
                                  batchDeleteMutation.mutate(ids);
                                  toast.dismiss(t);
                                }}
                                className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
                              >
                                确认删除
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ), { duration: 5000 });
                  }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 transition-all group"
                >
                  <Trash2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-semibold">批量删除</span>
                </button>
                
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="p-2.5 rounded-2xl hover:bg-white/10 text-white/40 hover:text-white transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
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
    </div>
  );
}
