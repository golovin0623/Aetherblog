/**
 * @file MediaPage.tsx
 * @description 媒体库主页面
 * @ref §3.2.4 - 媒体管理模块
 */

import { useState, useCallback, useMemo, useRef, DragEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Upload,
  Grid,
  List,
  Image,
  Video,
  Music,
  FileText,
  Filter,
  Loader2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import { mediaService, MediaListParams, MediaType } from '@/services/mediaService';
import { MediaGrid } from './media/components/MediaGrid';
import { MediaList } from './media/components/MediaList';
import { MediaDetail } from './media/components/MediaDetail';
import { UploadProgress } from './media/components/UploadProgress';
import { Pagination } from '@/components/common/Pagination';

type ViewMode = 'grid' | 'list';
type FilterType = 'ALL' | MediaType;

interface UploadingFile {
  file: File;
  progress: number;
  id: string;
  error?: string;
}

const typeOptions: { value: FilterType; label: string; icon: typeof Filter }[] = [
  { value: 'ALL', label: '全部', icon: Filter },
  { value: 'IMAGE', label: '图片', icon: Image },
  { value: 'VIDEO', label: '视频', icon: Video },
  { value: 'AUDIO', label: '音频', icon: Music },
  { value: 'DOCUMENT', label: '文档', icon: FileText },
];

/**
 * 媒体库主页面
 */
export default function MediaPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedMedia, setSelectedMedia] = useState<number | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const debouncedSearch = useDebounce(searchQuery, 300);

  // 构建查询参数
  const queryParams: MediaListParams = useMemo(
    () => ({
      keyword: debouncedSearch || undefined,
      fileType: filterType !== 'ALL' ? filterType : undefined,
      pageNum: currentPage,
      pageSize: 24,
    }),
    [debouncedSearch, filterType, currentPage]
  );

  // 获取媒体列表
  const { data: mediaData, isLoading } = useQuery({
    queryKey: ['media', 'list', queryParams],
    queryFn: () => mediaService.getList(queryParams),
  });

  // 删除媒体
  const deleteMutation = useMutation({
    mutationFn: (id: number) => mediaService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
      setSelectedMedia(null);
    },
  });

  // 选择/取消选择媒体（点击同一项取消选择）
  const handleSelectMedia = useCallback((id: number) => {
    setSelectedMedia((prev) => (prev === id ? null : id));
  }, []);

  // 处理文件上传
  const handleUpload = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const newFiles: UploadingFile[] = fileArray.map((file) => ({
        file,
        progress: 0,
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      }));

      setUploadingFiles((prev) => [...prev, ...newFiles]);

      for (const uploadFile of newFiles) {
        try {
          await mediaService.upload(uploadFile.file, (progress) => {
            setUploadingFiles((prev) =>
              prev.map((f) =>
                f.id === uploadFile.id ? { ...f, progress } : f
              )
            );
          });
          // 上传完成后移除
          setUploadingFiles((prev) => prev.filter((f) => f.id !== uploadFile.id));
          queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
        } catch (error) {
          setUploadingFiles((prev) =>
            prev.map((f) =>
              f.id === uploadFile.id
                ? { ...f, error: '上传失败' }
                : f
            )
          );
        }
      }
    },
    [queryClient]
  );

  // 拖放处理
  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleUpload(files);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleUpload(files);
    }
    // 重置 input 以允许重复选择同一文件
    e.target.value = '';
  };

  const cancelUpload = (id: string) => {
    setUploadingFiles((prev) => prev.filter((f) => f.id !== id));
  };

  return (
    <div
      className="space-y-6 relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* 拖放覆盖层 */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-gray-950/90 flex items-center justify-center"
          >
            <div className="text-center">
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
              >
                <Upload className="w-16 h-16 text-primary mx-auto mb-4" />
              </motion.div>
              <p className="text-xl text-white font-medium">释放以上传文件</p>
              <p className="text-gray-400 mt-2">支持 PNG, JPG, GIF, MP4, PDF 等格式</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">媒体库</h1>
          <p className="text-gray-400 mt-1">
            管理您的所有媒体文件，共 {mediaData?.data?.total || 0} 个
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 rounded-lg',
            'bg-primary text-white font-medium',
            'hover:bg-primary/90 transition-colors'
          )}
        >
          <Upload className="w-4 h-4" />
          上传文件
        </motion.button>
      </div>

      {/* 工具栏 */}
      <div
        className={cn(
          'flex flex-col lg:flex-row lg:items-center gap-4 p-4 rounded-xl',
          'bg-white/5 backdrop-blur-sm border border-white/10'
        )}
      >
        {/* 搜索框 */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索媒体文件..."
            className={cn(
              'w-full pl-10 pr-4 py-2.5 rounded-lg',
              'bg-black/30 border border-white/10 text-white placeholder-gray-500',
              'focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30'
            )}
          />
        </div>

        {/* 类型筛选 */}
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
          {typeOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                onClick={() => {
                  setFilterType(option.value);
                  setCurrentPage(1);
                }}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm',
                  'transition-all duration-200',
                  filterType === option.value
                    ? 'bg-primary text-white'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{option.label}</span>
              </button>
            );
          })}
        </div>

        {/* 视图切换 */}
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={cn(
              'p-2 rounded-md transition-colors',
              viewMode === 'grid'
                ? 'bg-primary text-white'
                : 'text-gray-400 hover:text-white'
            )}
            title="网格视图"
          >
            <Grid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'p-2 rounded-md transition-colors',
              viewMode === 'list'
                ? 'bg-primary text-white'
                : 'text-gray-400 hover:text-white'
            )}
            title="列表视图"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 上传进度 */}
      <AnimatePresence>
        {uploadingFiles.length > 0 && (
          <UploadProgress files={uploadingFiles} onCancel={cancelUpload} />
        )}
      </AnimatePresence>

      {/* 主内容区 */}
      <div className="flex gap-6">
        {/* 媒体列表 */}
        <div className="flex-1 min-w-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : !mediaData?.data?.list || mediaData.data.list.length === 0 ? (
            <div
              className={cn(
                'p-12 rounded-xl text-center',
                'bg-white/5 backdrop-blur-sm border border-white/10'
              )}
            >
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
                <Image className="w-8 h-8 text-gray-500" />
              </div>
              <h3 className="text-lg font-medium text-white mb-2">
                暂无媒体文件
              </h3>
              <p className="text-gray-400 mb-4">
                上传您的第一个媒体文件开始使用
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90"
              >
                <Upload className="w-4 h-4" />
                上传文件
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            <MediaGrid
              items={mediaData.data.list}
              selectedId={selectedMedia}
              onSelect={handleSelectMedia}
            />
          ) : (
            <MediaList
              items={mediaData.data.list}
              selectedId={selectedMedia}
              onSelect={handleSelectMedia}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          )}

          {/* 分页 */}
          {mediaData?.data && mediaData.data.total > 24 && (
            <div className="mt-6">
              <Pagination
                page={currentPage}
                total={mediaData.data.total}
                pageSize={24}
                onPageChange={setCurrentPage}
              />
            </div>
          )}
        </div>

        {/* 详情面板 */}
        <AnimatePresence>
          {selectedMedia && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="w-80 flex-shrink-0"
            >
              <MediaDetail
                mediaId={selectedMedia}
                onClose={() => setSelectedMedia(null)}
                onDelete={() => deleteMutation.mutate(selectedMedia)}
                isDeleting={deleteMutation.isPending}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
