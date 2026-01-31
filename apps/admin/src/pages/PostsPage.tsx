import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Search, Filter, Loader2, Edit, Copy, Trash2, X, ChevronDown, Settings } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { postService, PostListItem, Post } from '@/services/postService';
import { categoryService, Category } from '@/services/categoryService';
import { tagService, Tag } from '@/services/tagService';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PostPropertiesModal } from '@/components/PostPropertiesModal';
import { UpdatePostPropertiesRequest } from '@/types/post';
import { logger } from '@/lib/logger';

export default function PostsPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [pagination, setPagination] = useState({ pageNum: 1, pageSize: 10, total: 0, pages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<string | undefined>(undefined);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  // 高级筛选状态
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [filters, setFilters] = useState({
    categoryId: undefined as number | undefined,
    tagId: undefined as number | undefined,
    minViewCount: undefined as number | undefined,
    maxViewCount: undefined as number | undefined,
    startDate: '',
    endDate: '',
  });

  // 操作确认状态
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    type: 'delete' | 'copy';
    post: PostListItem | null;
  }>({ isOpen: false, type: 'delete', post: null });

  // 属性模态框状态
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [isPropertiesModalOpen, setIsPropertiesModalOpen] = useState(false);
  const [activeTagPopover, setActiveTagPopover] = useState<number | null>(null);
  const tagPopoverRef = useRef<HTMLDivElement>(null);

  // 点击外部时关闭标签弹出框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tagPopoverRef.current && !tagPopoverRef.current.contains(event.target as Node)) {
        setActiveTagPopover(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  const [isFetchingDetail, setIsFetchingDetail] = useState(false);

  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchPosts = async (pageNum = 1, currentStatus?: string, keyword?: string, currentFilters = filters) => {
    try {
      setLoading(true);
      const res = await postService.getList({ 
        pageNum, 
        pageSize: 10, 
        status: currentStatus, 
        keyword,
        ...currentFilters,
        startDate: currentFilters.startDate ? `${currentFilters.startDate}T00:00:00` : undefined,
        endDate: currentFilters.endDate ? `${currentFilters.endDate}T23:59:59` : undefined,
      });
      if (res.code === 200 && res.data) {
        setPosts(res.data.list);
        setPagination({
          pageNum: res.data.pageNum,
          pageSize: res.data.pageSize,
          total: res.data.total,
          pages: res.data.pages,
        });
      } else {
        setError(res.message || '获取文章列表失败');
      }
    } catch (err: any) {
      logger.error('Posts fetch error:', err);
      setError(err.message || '网络错误');
    } finally {
      setLoading(false);
    }
  };

  // 初始获取及状态/搜索/筛选变更时获取
  useEffect(() => {
    fetchPosts(1, activeStatus, debouncedSearch || undefined, filters);
  }, [activeStatus, debouncedSearch, filters]);

  // 获取筛选用的分类和标签
  useEffect(() => {
    const loadFilterData = async () => {
      try {
        const [cRes, tRes] = await Promise.all([
          categoryService.getList(),
          tagService.getList()
        ]);
        if (cRes.code === 200) setCategories(cRes.data);
        if (tRes.code === 200) setTags(tRes.data);
      } catch (err) {
        logger.error('Failed to load filter data:', err);
      }
    };
    loadFilterData();
  }, []);

  const handleStatusChange = (status: string | undefined) => {
    setActiveStatus(status);
  };

  const handlePageChange = (page: number) => {
    fetchPosts(page, activeStatus, debouncedSearch || undefined, filters);
  };

  // 处理删除操作
  const confirmDelete = async () => {
    if (!confirmDialog.post) return;
    try {
      setActionLoading(confirmDialog.post.id);
      await postService.delete(confirmDialog.post.id);
      setConfirmDialog({ isOpen: false, type: 'delete', post: null });
      fetchPosts(pagination.pageNum, activeStatus, debouncedSearch || undefined, filters);
    } catch (err) {
      logger.error('Delete failed:', err);
    } finally {
      setActionLoading(null);
    }
  };

  // 处理复制操作
  const confirmCopy = async () => {
    if (!confirmDialog.post) return;
    try {
      setActionLoading(confirmDialog.post.id);
      const original = await postService.getById(confirmDialog.post.id);
      if (original.data) {
        await postService.create({
          title: `${original.data.title} (复制)`,
          content: original.data.content,
          summary: original.data.summary,
          coverImage: original.data.coverImage || undefined,
          categoryId: original.data.categoryId || undefined,
          tagIds: original.data.tags.map(t => t.id),
          status: 'DRAFT',
        });
        setConfirmDialog({ isOpen: false, type: 'copy', post: null });
        fetchPosts(1, activeStatus, debouncedSearch || undefined, filters);
      }
    } catch (err) {
      logger.error('Copy failed:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteClick = useCallback((post: PostListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDialog({ isOpen: true, type: 'delete', post });
  }, []);

  const handleCopyClick = useCallback((post: PostListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDialog({ isOpen: true, type: 'copy', post });
  }, []);

  // 处理编辑
  const handleEdit = useCallback((post: PostListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/posts/${post.id}/edit`);
  }, [navigate]);

  // 处理打开属性模态框
  const handleOpenProperties = useCallback(async (post: PostListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setIsFetchingDetail(true);
    try {
      const res = await postService.getById(post.id);
      console.log('[Debug] API Response:', res);
      if (res.data) {
        setSelectedPost(res.data);
        setIsPropertiesModalOpen(true);
      }
    } catch (err) {
      logger.error('获取文章详情失败:', err);
    } finally {
      setIsFetchingDetail(false);
    }
  }, []);

  // 处理保存属性
  const handleSaveProperties = useCallback(async (data: UpdatePostPropertiesRequest) => {
    if (!selectedPost) return;
    try {
      setActionLoading(selectedPost.id);
      await postService.updateProperties(selectedPost.id, data);
      setIsPropertiesModalOpen(false);
      fetchPosts(pagination.pageNum, activeStatus, debouncedSearch || undefined, filters);
    } catch (err) {
      logger.error('Update properties failed:', err);
    } finally {
      setActionLoading(null);
    }
  }, [selectedPost, pagination.pageNum, activeStatus, debouncedSearch, filters]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('zh-CN');
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      PUBLISHED: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
      DRAFT: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20',
      ARCHIVED: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20',
    };
    const labels = { PUBLISHED: '已发布', DRAFT: '草稿', ARCHIVED: '已归档' };
    return (
      <span className={cn('px-1.5 py-0.5 text-xs rounded-full border leading-none font-medium', styles[status as keyof typeof styles] || styles.DRAFT)}>
        {labels[status as keyof typeof labels] || status}
      </span>
    );
  };


  return (
    <div className="flex flex-col">
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)] leading-tight">文章管理</h1>
          <div className="h-5 flex items-center mt-0.5">
            {loading ? (
              <div className="h-4 w-20 bg-[var(--bg-secondary)] rounded animate-pulse" />
            ) : (
              <p className="text-[var(--text-secondary)] text-sm">共 {pagination.total} 篇文章</p>
            )}
          </div>
        </div>
      </div>

      {/* 筛选和搜索 */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        {/* Premium 新建按钮 (持续光泽流动效果) */}
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate('/posts/new')}
          className="group relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-primary via-primary to-primary overflow-hidden shadow-lg shadow-primary/25"
        >
          {/* 持续流动的光泽效果 */}
          <div 
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
            style={{
              animation: 'shimmer 3s ease-in-out infinite',
            }}
          />
          <style>{`
            @keyframes shimmer {
              0% { transform: translateX(-100%); }
              50% { transform: translateX(100%); }
              50.01% { transform: translateX(-100%); }
              100% { transform: translateX(-100%); }
            }
          `}</style>
          <Plus className="w-4 h-4 relative z-10" />
          <span className="relative z-10">新建文章</span>
        </motion.button>

        {/* 状态筛选 (滑动背景效果) */}
        <div className="flex items-center p-1 bg-[var(--bg-secondary)] rounded-full border border-[var(--border-subtle)] backdrop-blur-md">
          {[
            { key: undefined, label: '全部' },
            { key: 'PUBLISHED', label: '已发布' },
            { key: 'DRAFT', label: '草稿' },
          ].map((tab) => {
            const isActive = activeStatus === tab.key;
            return (
              <button
                key={tab.key ?? 'all'}
                onClick={() => handleStatusChange(tab.key)}
                className={cn(
                  'relative px-5 py-2 rounded-full text-sm font-medium transition-colors duration-300',
                  isActive ? 'text-primary' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeStatusTab"
                    className="absolute inset-0 bg-primary/20 border border-primary/50 text-primary rounded-full shadow-[0_0_15px_rgba(99,102,241,0.3)]"
                    transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                    style={{ borderRadius: 9999 }}
                  >
                    <div className="absolute inset-0 bg-primary/20 blur opacity-50 rounded-full" />
                  </motion.div>
                )}
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* 搜索框 */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="搜索文章标题..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              'w-full pl-10 pr-4 py-2 rounded-xl text-sm',
              'bg-[var(--bg-secondary)] border border-[var(--border-subtle)]',
              'text-[var(--text-primary)] placeholder-[var(--text-muted)]',
              'focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20',
              'transition-all duration-200'
            )}
          />
        </div>

        {/* 筛选按钮 + 重置按钮 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAdvancedFilter(!showAdvancedFilter)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-all duration-200 shadow-sm border',
              showAdvancedFilter
                ? 'bg-primary/20 border-primary/50 text-primary'
                : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
            )}
          >
            <Filter className="w-4 h-4" />
            <span>高级筛选</span>
            <ChevronDown className={cn('w-4 h-4 transition-transform duration-300', showAdvancedFilter && 'rotate-180')} />
          </button>
          
          {/* 重置按钮 (与主题色协调) */}
          {showAdvancedFilter && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9, x: -10 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.9, x: -10 }}
              transition={{ duration: 0.15 }}
              onClick={() => setFilters({
                categoryId: undefined,
                tagId: undefined,
                minViewCount: undefined,
                maxViewCount: undefined,
                startDate: '',
                endDate: '',
              })}
              className="group relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium overflow-hidden"
            >
              {/* 渐变边框背景 (使用主题色) */}
              <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary via-violet-500 to-primary opacity-50 group-hover:opacity-100 transition-opacity duration-300" />
              {/* 内部背景 */}
              <div className="absolute inset-[1px] rounded-[10px] bg-gray-900" />
              {/* 光泽流动 */}
              <div 
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 group-hover:opacity-100"
                style={{
                  animation: 'shimmerReset 1.5s ease-in-out infinite',
                }}
              />
              <style>{`
                @keyframes shimmerReset {
                  0% { transform: translateX(-100%); }
                  100% { transform: translateX(100%); }
                }
              `}</style>
              <X className="w-3.5 h-3.5 relative z-10 text-primary/80 group-hover:text-primary transition-colors" />
              <span className="relative z-10 text-gray-300 group-hover:text-white transition-colors">重置</span>
            </motion.button>
          )}
        </div>
      </div>

      {/* 高级筛选面板 */}
      <AnimatePresence initial={false}>
        {showAdvancedFilter && (
          <motion.div
            key="content"
            initial="collapsed"
            animate="open"
            exit="collapsed"
            variants={{
              open: { opacity: 1, height: 'auto', marginBottom: 16 },
              collapsed: { opacity: 0, height: 0, marginBottom: 0 }
            }}
            transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
            className="overflow-hidden"
          >
            <div className="p-5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-2xl">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 分类筛选 */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-[var(--text-secondary)] ml-1">所属分类</label>
                  <select
                    value={filters.categoryId || ''}
                    onChange={(e) => setFilters(f => ({ ...f, categoryId: e.target.value ? Number(e.target.value) : undefined }))}
                    className="w-full px-3 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
                  >
                    <option value="" className="bg-[var(--bg-card)]">全部分类</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id} className="bg-[var(--bg-card)]">{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* 标签筛选 */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-[var(--text-secondary)] ml-1">标签筛选</label>
                  <select
                    value={filters.tagId || ''}
                    onChange={(e) => setFilters(f => ({ ...f, tagId: e.target.value ? Number(e.target.value) : undefined }))}
                    className="w-full px-3 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
                  >
                    <option value="" className="bg-[var(--bg-card)]">全部标签</option>
                    {tags.map(t => (
                      <option key={t.id} value={t.id} className="bg-[var(--bg-card)]">{t.name}</option>
                    ))}
                  </select>
                </div>

                {/* 浏览量范围 */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-[var(--text-secondary)] ml-1">浏览量范围</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="最小"
                      value={filters.minViewCount || ''}
                      onChange={(e) => setFilters(f => ({ ...f, minViewCount: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/50"
                    />
                    <span className="text-[var(--text-muted)] flex-shrink-0">-</span>
                    <input
                      type="number"
                      placeholder="最大"
                      value={filters.maxViewCount || ''}
                      onChange={(e) => setFilters(f => ({ ...f, maxViewCount: e.target.value ? Number(e.target.value) : undefined }))}
                      className="w-full px-3 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/50"
                    />
                  </div>
                </div>

                {/* 发布时间范围 */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-[var(--text-secondary)] ml-1">发布时间</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      value={filters.startDate}
                      onChange={(e) => setFilters(f => ({ ...f, startDate: e.target.value }))}
                      className="flex-1 min-w-0 px-2 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-xs text-[var(--text-primary)] focus:outline-none focus:border-primary/50 [color-scheme:dark]"
                    />
                    <span className="text-[var(--text-muted)] flex-shrink-0">-</span>
                    <input
                      type="date"
                      value={filters.endDate}
                      onChange={(e) => setFilters(f => ({ ...f, endDate: e.target.value }))}
                      className="flex-1 min-w-0 px-2 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-xs text-[var(--text-primary)] focus:outline-none focus:border-primary/50 [color-scheme:dark]"
                    />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>


      {/* 文章列表 */}
      <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] overflow-hidden backdrop-blur-sm shadow-xl relative flex flex-col">
        {/* 固定表头 - 仅桌面端显示 */}
        <table className="w-full table-fixed hidden md:table">
          <thead className="bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] text-[var(--text-muted)] text-xs font-semibold uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3.5 text-left w-[40%]">标题</th>
              <th className="px-4 py-3.5 text-left w-20">状态</th>
              <th className="px-4 py-3.5 text-left w-24">分类</th>
              <th className="px-4 py-3.5 text-left w-40">标签</th>
              <th className="px-4 py-3.5 text-left w-24">时间</th>
              <th className="px-4 py-3.5 text-left w-16">浏览</th>
              <th className="px-4 py-3.5 text-right w-28">操作</th>
            </tr>
          </thead>
        </table>
        
        {/* 表格内容区 - 带动画 */}
        <div className="flex-1 overflow-auto">
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div
                key="skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="p-4"
              >
                {/* 桌面端骨架屏 */}
                <div className="hidden md:block">
                  <table className="w-full table-fixed">
                    <tbody>
                      {Array.from({ length: 10 }).map((_, i) => (
                        <tr key={i} className="border-b border-[var(--border-subtle)] last:border-b-0">
                          <td className="px-4 py-3.5 w-[40%]"><div className="h-5 bg-[var(--bg-secondary)] rounded w-3/4 animate-pulse"></div></td>
                          <td className="px-4 py-3.5 w-20"><div className="h-5 bg-[var(--bg-secondary)] rounded-full w-14 animate-pulse"></div></td>
                          <td className="px-4 py-3.5 w-24"><div className="h-6 bg-[var(--bg-secondary)] rounded-md w-16 animate-pulse"></div></td>
                          <td className="px-4 py-3.5 w-40"><div className="flex gap-1.5"><div className="h-5 bg-[var(--bg-secondary)] rounded w-12 animate-pulse"></div><div className="h-5 bg-[var(--bg-secondary)] rounded w-12 animate-pulse"></div></div></td>
                          <td className="px-4 py-3.5 w-24"><div className="h-5 bg-[var(--bg-secondary)] rounded w-20 animate-pulse"></div></td>
                          <td className="px-4 py-3.5 w-16"><div className="h-5 bg-[var(--bg-secondary)] rounded w-10 animate-pulse"></div></td>
                          <td className="px-4 py-3.5 w-28 flex justify-end gap-1"><div className="h-7 w-7 bg-[var(--bg-secondary)] rounded-lg animate-pulse"></div><div className="h-7 w-7 bg-[var(--bg-secondary)] rounded-lg animate-pulse"></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 移动端骨架屏 */}
                <div className="md:hidden space-y-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3">
                      <div className="h-5 bg-[var(--bg-secondary)] rounded w-3/4 animate-pulse"></div>
                      <div className="flex justify-between items-center">
                        <div className="h-5 bg-[var(--bg-secondary)] rounded-full w-14 animate-pulse"></div>
                        <div className="h-5 bg-[var(--bg-secondary)] rounded w-24 animate-pulse"></div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            ) : error ? (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="p-8 text-center text-red-400"
              >
                {error}
              </motion.div>
            ) : posts.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center py-20"
              >
                <div className="w-16 h-16 bg-[var(--bg-secondary)] rounded-full flex items-center justify-center mx-auto mb-4">
                  <Search className="w-8 h-8 text-[var(--text-muted)]" />
                </div>
                <p className="text-[var(--text-muted)]">暂无符合条件的文章</p>
              </motion.div>
            ) : (
              <motion.div
                key="content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                  {/* 桌面端视图 */}
                  <div className="hidden md:block">
                    <table className="w-full table-fixed">
                      <tbody>
                        {posts.map((post) => (
                          <tr 
                            key={post.id} 
                            className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--bg-card-hover)] transition-colors group"
                          >
                            <td className="px-4 py-3.5 w-[40%]">
                              <button
                                onClick={(e) => handleEdit(post, e)}
                                className="text-left w-full"
                              >
                                <p className="text-[var(--text-primary)] font-medium truncate group-hover:text-primary hover:text-primary transition-colors cursor-pointer" title={post.title}>
                                  {post.title}
                                </p>
                              </button>
                            </td>
                            <td className="px-4 py-3.5 w-20 whitespace-nowrap">
                              {getStatusBadge(post.status)}
                            </td>
                            <td className="px-4 py-3.5 w-24 whitespace-nowrap">
                              <span className="px-2 py-1 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
                                {post.categoryName || '-'}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 w-40 overflow-visible">
                              <div className="flex items-center gap-1.5 overflow-visible relative">
                                {post.tagNames?.length > 0 ? (
                                  <>
                                    <div className="flex flex-wrap gap-1.5 max-w-[120px]">
                                      <span className="px-2 py-0.5 text-[10px] bg-primary/10 border border-primary/20 rounded-md text-primary-light truncate max-w-[80px]">
                                        {post.tagNames[0]}
                                      </span>
                                      {post.tagNames.length > 1 && (
                                        <div className="relative">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setActiveTagPopover(activeTagPopover === post.id ? null : post.id);
                                            }}
                                            className={cn(
                                              "px-1.5 py-0.5 text-[10px] rounded-md font-mono transition-all",
                                              activeTagPopover === post.id 
                                                ? "bg-primary text-white border-primary shadow-lg shadow-primary/20" 
                                                : "bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
                                            )}
                                          >
                                            +{post.tagNames.length - 1}
                                          </button>

                                          <AnimatePresence>
                                            {activeTagPopover === post.id && (
                                              <motion.div
                                                ref={tagPopoverRef}
                                                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                                                className="absolute left-0 bottom-full mb-2 z-[60] min-w-[120px] p-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] backdrop-blur-xl shadow-2xl"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                <div className="flex flex-wrap gap-1.5 max-w-[200px]">
                                                  {post.tagNames.map((tag) => (
                                                    <span 
                                                      key={tag} 
                                                      className="px-2 py-0.5 text-[10px] bg-primary/10 border border-primary/20 rounded-md text-primary-light whitespace-nowrap"
                                                    >
                                                      {tag}
                                                    </span>
                                                  ))}
                                                </div>
                                                <div className="absolute left-4 -bottom-1 w-2 h-2 bg-gray-900 border-r border-b border-white/10 rotate-45" />
                                              </motion.div>
                                            )}
                                          </AnimatePresence>
                                        </div>
                                      )}
                                    </div>
                                  </>
                                ) : (
                                  <span className="text-[var(--text-muted)] text-[10px] ml-1">无标签</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3.5 w-24 text-sm text-[var(--text-muted)] whitespace-nowrap">
                              {formatDate(post.publishedAt || post.createdAt)}
                            </td>
                            <td className="px-4 py-3.5 w-16 text-sm text-[var(--text-muted)] font-mono whitespace-nowrap">
                              {post.viewCount}
                            </td>
                            <td className="px-4 py-3 w-28">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={(e) => handleOpenProperties(post, e)}
                                  className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all duration-200"
                                  title="设置"
                                >
                                  <Settings className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={(e) => handleEdit(post, e)}
                                  className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all duration-200"
                                  title="编辑"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={(e) => handleCopyClick(post, e)}
                                  disabled={actionLoading === post.id}
                                  className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all duration-200 disabled:opacity-50"
                                  title="复制"
                                >
                                  {actionLoading === post.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Copy className="w-4 h-4" />
                                  )}
                                </button>
                                <button
                                  onClick={(e) => handleDeleteClick(post, e)}
                                  disabled={actionLoading === post.id}
                                  className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-red-400 transition-all duration-200 disabled:opacity-50"
                                  title="删除"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* 移动端视图 - 列表卡片 */}
                  <div className="md:hidden divide-y divide-[var(--border-subtle)]">
                    {posts.map((post) => (
                      <div key={post.id} className="p-4 space-y-3 active:bg-[var(--bg-card-hover)] transition-colors">
                        <div className="flex justify-between items-start gap-4">
                          <button
                            onClick={(e) => handleEdit(post, e)}
                            className="text-left flex-1"
                          >
                            <h3 className="text-[var(--text-primary)] font-medium text-sm line-clamp-2 leading-relaxed">
                              {post.title}
                            </h3>
                          </button>
                          {getStatusBadge(post.status)}
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                          <span className="px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
                            {post.categoryName || '-'}
                          </span>
                          <span className="w-px h-2.5 bg-[var(--border-subtle)]" />
                          <span>{formatDate(post.publishedAt || post.createdAt)}</span>
                          <span className="w-px h-2.5 bg-[var(--border-subtle)]" />
                          <span>{post.viewCount} 浏览</span>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <div className="flex flex-wrap gap-1.5 flex-1 mr-4">
                            {post.tagNames?.length > 0 ? (
                              <>
                                {post.tagNames.slice(0, 2).map((tag) => (
                                  <span 
                                    key={tag} 
                                    className="px-1.5 py-0.5 text-[10px] bg-primary/10 border border-primary/20 rounded text-primary-light/90 whitespace-nowrap"
                                  >
                                    {tag}
                                  </span>
                                ))}
                                {post.tagNames.length > 2 && (
                                  <span className="px-1.5 py-0.5 text-[10px] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded text-[var(--text-muted)] font-mono">
                                    +{post.tagNames.length - 2}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-[10px] text-[var(--text-muted)] italic">无标签</span>
                            )}
                          </div>
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={(e) => handleOpenProperties(post, e)}
                              className="p-2 text-[var(--text-muted)] active:text-[var(--text-primary)]"
                            >
                              <Settings className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => handleEdit(post, e)}
                              className="p-2 text-[var(--text-muted)] active:text-[var(--text-primary)]"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => handleCopyClick(post, e)}
                              disabled={actionLoading === post.id}
                              className="p-2 text-[var(--text-muted)] active:text-[var(--text-primary)] disabled:opacity-50"
                            >
                              {actionLoading === post.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                            </button>
                            <button
                              onClick={(e) => handleDeleteClick(post, e)}
                              className="p-2 text-[var(--text-muted)] active:text-red-400"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 分页 - 移动到 Card 内部底部 */}
        <div className="flex items-center justify-between py-3 px-4 border-t border-white/5 bg-white/[0.02] min-h-[64px] relative">
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div
                key="stats-skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2"
              >
                <div className="h-4 w-32 bg-white/5 rounded animate-pulse" />
                <div className="h-4 w-20 bg-white/5 rounded animate-pulse" />
              </motion.div>
            ) : (
              <motion.div
                key="stats-real"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 text-[11px] font-medium"
              >
                <span className="text-gray-500">
                  共 <span className="text-primary/70 font-semibold">{pagination.total}</span> 篇文章
                </span>
                <div className="w-px h-3 bg-white/10 mx-1" />
                <span className="text-gray-500">
                  第 <span className="text-white/70">{pagination.pageNum}</span> 页 / 共 <span className="text-white/70">{pagination.pages || 1}</span> 页
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center gap-2">
            {!loading && pagination.pages > 1 ? (
              <motion.div 
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-1.5"
              >
                <button
                  onClick={() => handlePageChange(pagination.pageNum - 1)}
                  disabled={pagination.pageNum <= 1}
                  className={cn(
                    'px-2.5 py-1.5 rounded-xl text-[11px] font-medium transition-all duration-300 border',
                    pagination.pageNum <= 1
                      ? 'text-gray-600 border-transparent cursor-not-allowed'
                      : 'bg-white/5 text-gray-400 border-white/10 hover:bg-primary/10 hover:text-primary hover:border-primary/30'
                  )}
                >
                  上一页
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, pagination.pages) }, (_, i) => {
                    const start = Math.max(1, Math.min(pagination.pageNum - 2, pagination.pages - 4));
                    return start + i;
                  }).filter(p => p <= pagination.pages).map((page) => (
                    <button
                      key={page}
                      onClick={() => handlePageChange(page)}
                      className={cn(
                        'w-7 h-7 rounded-xl text-[11px] font-medium transition-all duration-300 border flex items-center justify-center',
                        page === pagination.pageNum
                          ? 'bg-primary text-white border-primary shadow-lg shadow-primary/25 scale-105'
                          : 'bg-white/5 text-gray-400 border-white/5 hover:bg-white/10 hover:border-white/20'
                      )}
                    >
                      {page}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => handlePageChange(pagination.pageNum + 1)}
                  disabled={pagination.pageNum >= pagination.pages}
                  className={cn(
                    'px-2.5 py-1.5 rounded-xl text-[11px] font-medium transition-all duration-300 border',
                    pagination.pageNum >= pagination.pages
                      ? 'text-gray-600 border-transparent cursor-not-allowed'
                      : 'bg-white/5 text-gray-400 border-white/10 hover:bg-primary/10 hover:text-primary hover:border-primary/30'
                  )}
                >
                  下一页
                </button>
              </motion.div>
            ) : !loading && (
              <div className="h-8" />
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.type === 'delete' ? '确定要删除这篇文章吗？' : '确定要复制这篇文章吗？'}
        message={confirmDialog.type === 'delete'
          ? `确定要删除文章 "${confirmDialog.post?.title}" 吗？此操作不可恢复。`
          : `确定要复制文章 "${confirmDialog.post?.title}" 吗？复制后的文章将以草稿形式存在。`}
        confirmText={confirmDialog.type === 'delete' ? '确定删除' : '确定复制'}
        variant={confirmDialog.type === 'delete' ? 'danger' : 'copy'}
        onConfirm={confirmDialog.type === 'delete' ? confirmDelete : confirmCopy}
        onCancel={() => setConfirmDialog({ isOpen: false, type: 'delete', post: null })}
      />

      {/* 属性模态框 */}
      {selectedPost && (
        <PostPropertiesModal
          isOpen={isPropertiesModalOpen}
          onClose={() => setIsPropertiesModalOpen(false)}
          post={selectedPost}
          categories={categories}
          tags={tags}
          onSave={handleSaveProperties}
        />
      )}
    </div>
  );
}
