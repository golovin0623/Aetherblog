import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Plus, Search, Filter, Loader2, Edit, Copy, Trash2, X, ChevronDown,
  ChevronLeft, ChevronRight, Settings, Sparkles, EyeOff, Lock, Eye,
  FolderOpen, Tag as TagIcon, BarChart3, FileText,
} from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { StatusBadge } from '@/components/common/StatusBadge';
import { postService, PostListItem, Post } from '@/services/postService';
import { categoryService, Category } from '@/services/categoryService';
import { tagService, Tag } from '@/services/tagService';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Select, DateRangePicker, type SelectOption, type DateRangeValue } from '@aetherblog/ui';
import { PostPropertiesModal } from '@/components/PostPropertiesModal';
import PostTableRow from '@/components/posts/PostTableRow';
import { UpdatePostPropertiesRequest } from '@/types/post';
import { logger } from '@/lib/logger';

/**
 * 浏览量预设 —— 与其让用户填两个 number input，不如给 5 个常用区间。
 * value 用 'min:max' 编码，'-' 表示无界。
 */
const VIEW_COUNT_PRESETS: Array<{ value: string; label: string; min?: number; max?: number }> = [
  { value: '',                label: '全部浏览量' },
  { value: '0:99',            label: '< 100',           max: 99 },
  { value: '100:999',         label: '100 – 1k',        min: 100, max: 999 },
  { value: '1000:9999',       label: '1k – 10k',        min: 1000, max: 9999 },
  { value: '10000:-',         label: '> 10k',           min: 10000 },
];

export default function PostsPage() {
  const navigate = useNavigate();
  // 尊重系统 prefers-reduced-motion；下面的 motion.div 共用这套 transition 预设。
  // CSS 侧（shimmer / scroll-smooth）已由 tokens.css 的全局 reduce 媒体查询接管。
  const reduceMotion = useReducedMotion();
  const heightTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.26, ease: [0.16, 1, 0.3, 1] as const };
  const chipTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const };
  const tabSpring = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 320, damping: 30 };

  // URL ?search= 是搜索关键词的唯一事实源:
  // 既支持外部入口(侧边栏全局搜索)直接预填,也让浏览器后退/分享链接保持搜索状态。
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSearch = searchParams.get('search') ?? '';
  const [searchQuery, setSearchQuery] = useState(urlSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(urlSearch);
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
    hidden: undefined as boolean | undefined,
  });
  // UI 派生：浏览量预设 / 日期范围 —— 单一来源是 filters，
  // 控件读取走 useMemo 派生，写入直接 setFilters，避免
  // useEffect → setFilters 的 cascade 引发 fetchPosts 多次触发。
  const viewCountPreset = useMemo(() => {
    const p = VIEW_COUNT_PRESETS.find(
      (preset) => preset.min === filters.minViewCount && preset.max === filters.maxViewCount,
    );
    return p?.value ?? '';
  }, [filters.minViewCount, filters.maxViewCount]);

  const dateRange: DateRangeValue = useMemo(
    () => ({ startTime: filters.startDate, endTime: filters.endDate }),
    [filters.startDate, filters.endDate],
  );

  const handleViewCountPresetChange = useCallback((next: string) => {
    if (!next) {
      setFilters((f) => ({ ...f, minViewCount: undefined, maxViewCount: undefined }));
      return;
    }
    const preset = VIEW_COUNT_PRESETS.find((p) => p.value === next);
    if (preset) {
      setFilters((f) => ({ ...f, minViewCount: preset.min, maxViewCount: preset.max }));
    }
  }, []);

  const handleDateRangeChange = useCallback((next: DateRangeValue) => {
    setFilters((f) => ({
      ...f,
      startDate: next.startTime || '',
      endDate: next.endTime || '',
    }));
  }, []);

  // 操作确认状态
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    type: 'delete' | 'copy';
    post: PostListItem | null;
  }>({ isOpen: false, type: 'delete', post: null });

  // 属性弹窗状态
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [isPropertiesModalOpen, setIsPropertiesModalOpen] = useState(false);
  const [activeTagPopover, setActiveTagPopover] = useState<number | null>(null);
  const [chipsOverflowHidden, setChipsOverflowHidden] = useState(true);
  const tagPopoverRef = useRef<HTMLDivElement>(null);

  // 分页滚动条: 当前页跟随滚动并在可视区域居中显示, 边界时自然贴合首尾
  const pageStripRef = useRef<HTMLDivElement>(null);
  const pageNumbers = useMemo(
    () => Array.from({ length: pagination.pages }, (_, i) => i + 1),
    [pagination.pages]
  );

  // 点击外部区域时关闭标签弹出框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tagPopoverRef.current && !tagPopoverRef.current.contains(event.target as Node)) {
        setActiveTagPopover(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 当前页变化时将 active 按钮滚动到容器中心; 容器自身滚动, 不影响外层视口.
  // 当 active 靠近首尾时, scrollLeft 被浏览器自动钳制在 [0, scrollWidth - clientWidth],
  // 自然呈现 "近端跟随移动 / 中段始终居中" 的效果.
  useEffect(() => {
    const container = pageStripRef.current;
    if (!container) return;
    const activeBtn = container.querySelector<HTMLButtonElement>('[aria-current="page"]');
    if (!activeBtn) return;
    const containerRect = container.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    const target =
      container.scrollLeft +
      (btnRect.left + btnRect.width / 2) -
      (containerRect.left + containerRect.width / 2);
    container.scrollTo({ left: target, behavior: 'smooth' });
  }, [pagination.pageNum, pagination.pages]);


  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // debouncedSearch → URL: 输入稳定后回写 ?search=, 用 replace 避免污染历史栈
  useEffect(() => {
    const current = searchParams.get('search') ?? '';
    if (current === debouncedSearch) return;
    const next = new URLSearchParams(searchParams);
    if (debouncedSearch) next.set('search', debouncedSearch);
    else next.delete('search');
    setSearchParams(next, { replace: true });
  }, [debouncedSearch, searchParams, setSearchParams]);

  // 外部 URL 变更(如侧边栏跳转 /posts?search=...) → 同步回输入框
  useEffect(() => {
    setSearchQuery(prev => (prev === urlSearch ? prev : urlSearch));
    setDebouncedSearch(prev => (prev === urlSearch ? prev : urlSearch));
  }, [urlSearch]);

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

  // 初始加载及状态/搜索/筛选条件变更时重新加载
  useEffect(() => {
    fetchPosts(1, activeStatus, debouncedSearch || undefined, filters);
  }, [activeStatus, debouncedSearch, filters]);

  // 加载用于筛选的分类和标签数据
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
        logger.error('加载筛选数据失败:', err);
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
      logger.error('删除失败:', err);
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
      logger.error('复制失败:', err);
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

  // 处理打开属性弹窗
  const handleOpenProperties = useCallback(async (post: PostListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await postService.getById(post.id);
      if (res.data) {
        setSelectedPost(res.data);
        setIsPropertiesModalOpen(true);
      }
    } catch (err) {
      logger.error('获取文章详情失败:', err);
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
      logger.error('更新属性失败:', err);
    } finally {
      setActionLoading(null);
    }
  }, [selectedPost, pagination.pageNum, activeStatus, debouncedSearch, filters]);

  // 处理标签弹窗切换 - 使用 callback 确保引用稳定，配合 React.memo 减少重复渲染
  const handleTogglePopover = useCallback((id: number) => {
    setActiveTagPopover(prev => prev === id ? null : id);
  }, []);

  const categorySelectOptions: SelectOption[] = useMemo(
    () => [
      { value: '', label: '全部分类' },
      ...categories.map((category) => ({ value: String(category.id), label: category.name })),
    ],
    [categories]
  );
  const tagSelectOptions: SelectOption[] = useMemo(
    () => [
      { value: '', label: '全部标签' },
      ...tags.map((tag) => ({ value: String(tag.id), label: tag.name })),
    ],
    [tags]
  );
  const viewCountOptions: SelectOption[] = useMemo(
    () => VIEW_COUNT_PRESETS.map((p) => ({ value: p.value, label: p.label })),
    []
  );

  /* -----------------------------------------------------------
   * 激活筛选 chip 摘要
   * 收集：搜索 / 分类 / 标签 / 浏览量 / 日期 / 仅隐藏
   * status tab 不入 chip（它已有独立的 segmented 显示）
   * ----------------------------------------------------------- */
  type ActiveFilterChip = {
    key: string;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
    onRemove: () => void;
  };

  const activeChips: ActiveFilterChip[] = [];

  if (debouncedSearch) {
    activeChips.push({
      key: 'search',
      icon: Search,
      label: '搜索',
      value: debouncedSearch,
      onRemove: () => setSearchQuery(''),
    });
  }
  if (filters.categoryId) {
    const cat = categories.find((c) => c.id === filters.categoryId);
    activeChips.push({
      key: 'category',
      icon: FolderOpen,
      label: '分类',
      value: cat?.name ?? `#${filters.categoryId}`,
      onRemove: () => setFilters((f) => ({ ...f, categoryId: undefined })),
    });
  }
  if (filters.tagId) {
    const t = tags.find((tt) => tt.id === filters.tagId);
    activeChips.push({
      key: 'tag',
      icon: TagIcon,
      label: '标签',
      value: t?.name ?? `#${filters.tagId}`,
      onRemove: () => setFilters((f) => ({ ...f, tagId: undefined })),
    });
  }
  if (viewCountPreset) {
    const preset = VIEW_COUNT_PRESETS.find((p) => p.value === viewCountPreset);
    activeChips.push({
      key: 'viewCount',
      icon: BarChart3,
      label: '浏览',
      value: preset?.label ?? viewCountPreset,
      onRemove: () =>
        setFilters((f) => ({ ...f, minViewCount: undefined, maxViewCount: undefined })),
    });
  }
  if (dateRange.startTime || dateRange.endTime) {
    const s = dateRange.startTime;
    const e = dateRange.endTime;
    let value = '';
    if (s && e && s === e) value = s;
    else if (s && e) value = `${s} → ${e}`;
    else if (s) value = `自 ${s}`;
    else if (e) value = `至 ${e}`;
    activeChips.push({
      key: 'date',
      icon: FileText,
      label: '日期',
      value,
      onRemove: () => setFilters((f) => ({ ...f, startDate: '', endDate: '' })),
    });
  }
  if (filters.hidden === true) {
    activeChips.push({
      key: 'hidden',
      icon: EyeOff,
      label: '可见性',
      value: '仅隐藏',
      onRemove: () => setFilters((f) => ({ ...f, hidden: undefined })),
    });
  } else if (filters.hidden === false) {
    activeChips.push({
      key: 'hidden',
      icon: Eye,
      label: '可见性',
      value: '仅公开',
      onRemove: () => setFilters((f) => ({ ...f, hidden: undefined })),
    });
  }

  const activeFilterCount = activeChips.length;
  // 空态判断 —— 把 status segmented 也算入"有筛选"。
  // chip strip / 角标仍只看 activeFilterCount（避免与 status tab 重复展示），
  // 但空态消息要根据是否有"任何筛选"来分支：
  //   - 切到"已发布"且子集为空 ⇒ "当前筛选条件下没有文章"（提供清空 CTA）
  //   - 真正全空      ⇒ "还没有任何文章"（提供创建 CTA）
  const hasAnyFilter = activeFilterCount > 0 || activeStatus !== undefined;

  const resetAllFilters = useCallback(() => {
    // 单次 atomic 重置 —— viewCountPreset / dateRange 是 useMemo 派生，
    // 随 filters 自动归零；activeStatus 也清，避免「全部清空」之后
    // status tab 还停在「已发布」造成结果集仍然受限。
    setFilters({
      categoryId: undefined,
      tagId: undefined,
      minViewCount: undefined,
      maxViewCount: undefined,
      startDate: '',
      endDate: '',
      hidden: undefined,
    });
    setSearchQuery('');
    setActiveStatus(undefined);
  }, []);

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

      {/* 主操作行 */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {/* CTA 组 —— AI 协同写作 + 新建文章 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/posts/ai-writing/new')}
            className={cn(
              'inline-flex items-center gap-2 h-10 px-3.5 rounded-lg text-sm font-medium',
              'border border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)]',
              'bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]',
              'text-[var(--aurora-1)]',
              'hover:bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]',
              'transition-[background-color,border-color] duration-[var(--dur-quick)] ease-[var(--ease-out)]'
            )}
          >
            <Sparkles className="w-4 h-4" />
            <span>AI 协同写作</span>
            <span className="px-1.5 py-px text-[10px] font-mono uppercase tracking-[0.12em] rounded bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)]">
              新
            </span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/posts/new')}
            className={cn(
              'group relative inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold text-white overflow-hidden',
              'bg-[var(--color-primary)]',
              'shadow-[0_4px_12px_-2px_color-mix(in_oklch,var(--aurora-1)_28%,transparent)]',
              'hover:shadow-[0_6px_16px_-2px_color-mix(in_oklch,var(--aurora-1)_38%,transparent)]',
              'transition-shadow duration-[var(--dur-quick)] ease-[var(--ease-out)]'
            )}
          >
            <span
              aria-hidden
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-[var(--dur-flow)] ease-[var(--ease-out)]"
            />
            <Plus className="w-4 h-4 relative" />
            <span className="relative">新建文章</span>
          </button>
        </div>

        {/* 状态 segmented */}
        <div className="surface-leaf flex items-center p-1 rounded-full">
          {[
            { key: undefined,    label: '全部' },
            { key: 'PUBLISHED',  label: '已发布' },
            { key: 'DRAFT',      label: '草稿' },
          ].map((tab) => {
            const isActive = activeStatus === tab.key;
            return (
              <button
                key={tab.key ?? 'all'}
                onClick={() => handleStatusChange(tab.key)}
                className={cn(
                  'relative h-8 px-4 rounded-full text-sm font-medium',
                  'transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)]',
                  isActive ? 'text-[var(--text-inverse)]' : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]'
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeStatusTab"
                    className="absolute inset-0 bg-[var(--color-primary)] rounded-full"
                    transition={tabSpring}
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* 可见性切换 chip —— 三态循环：全部 → 仅隐藏 → 仅公开 → 全部 */}
        <button
          type="button"
          onClick={() => {
            setFilters((f) => ({
              ...f,
              hidden: f.hidden === undefined ? true : f.hidden === true ? false : undefined,
            }));
          }}
          className={cn(
            'inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border',
            'transition-[background-color,border-color,color] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
            filters.hidden === true
              ? 'border-[color-mix(in_oklch,var(--signal-warn)_30%,transparent)] bg-[color-mix(in_oklch,var(--signal-warn)_10%,transparent)] text-[var(--signal-warn)]'
              : filters.hidden === false
                ? 'border-[color-mix(in_oklch,var(--signal-success)_30%,transparent)] bg-[color-mix(in_oklch,var(--signal-success)_10%,transparent)] text-[var(--signal-success)]'
                : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)]'
          )}
          title="点击切换可见性筛选"
        >
          {filters.hidden === true
            ? <><EyeOff className="w-3.5 h-3.5" /> 仅隐藏</>
            : filters.hidden === false
              ? <><Eye className="w-3.5 h-3.5" /> 仅公开</>
              : <><Eye className="w-3.5 h-3.5" /> 全部可见性</>}
        </button>

        {/* 搜索框 */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ink-muted)] pointer-events-none" />
          <input
            type="text"
            placeholder="搜索文章标题…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              'w-full h-10 pl-10 pr-9 rounded-lg text-sm',
              'bg-[var(--bg-leaf)] border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]',
              'text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)]',
              'transition-[border-color,box-shadow] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
              'hover:border-[color-mix(in_oklch,var(--aurora-1)_25%,transparent)]',
              'focus:outline-none focus:border-[color-mix(in_oklch,var(--aurora-1)_50%,transparent)]',
              'focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--aurora-1)_22%,transparent)]'
            )}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="清空搜索"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[var(--ink-muted)] hover:text-[var(--ink-primary)] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 高级筛选切换 */}
        <button
          type="button"
          onClick={() => setShowAdvancedFilter(!showAdvancedFilter)}
          className={cn(
            'inline-flex items-center gap-1.5 h-10 px-3 rounded-lg text-sm font-medium border',
            'transition-[background-color,border-color,color] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
            showAdvancedFilter
              ? 'border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] text-[var(--ink-primary)]'
              : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)]'
          )}
        >
          <Filter className="w-4 h-4" />
          <span>高级筛选</span>
          {activeFilterCount > 0 && (
            <span className="tnum inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-mono font-semibold bg-[var(--aurora-1)] text-[var(--bg-void)]">
              {activeFilterCount}
            </span>
          )}
          <ChevronDown className={cn('w-4 h-4 transition-transform duration-[var(--dur-quick)]', showAdvancedFilter && 'rotate-180')} />
        </button>
      </div>

      {/* 高级筛选面板 */}
      <AnimatePresence initial={false}>
        {showAdvancedFilter && (
          <motion.div
            key="advanced-panel"
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 12 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={heightTransition}
            className="overflow-visible"
          >
            <div className="surface-leaf rounded-xl p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)] mb-1.5">
                    所属分类
                  </label>
                  <Select
                    value={filters.categoryId ? String(filters.categoryId) : ''}
                    onValueChange={(v) =>
                      setFilters((f) => ({ ...f, categoryId: v ? Number(v) : undefined }))
                    }
                    options={categorySelectOptions}
                    placeholder="全部分类"
                    prefix={<FolderOpen />}
                    ariaLabel="所属分类"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)] mb-1.5">
                    标签
                  </label>
                  <Select
                    value={filters.tagId ? String(filters.tagId) : ''}
                    onValueChange={(v) =>
                      setFilters((f) => ({ ...f, tagId: v ? Number(v) : undefined }))
                    }
                    options={tagSelectOptions}
                    placeholder="全部标签"
                    prefix={<TagIcon />}
                    ariaLabel="标签"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)] mb-1.5">
                    浏览量
                  </label>
                  <Select
                    value={viewCountPreset}
                    onValueChange={handleViewCountPresetChange}
                    options={viewCountOptions}
                    placeholder="全部浏览量"
                    prefix={<BarChart3 />}
                    ariaLabel="浏览量范围"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)] mb-1.5">
                    发布时间
                  </label>
                  <DateRangePicker
                    value={dateRange}
                    onChange={handleDateRangeChange}
                    placeholder="选择时间范围"
                    ariaLabel="发布时间筛选"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 激活筛选 chip 摘要 —— 让用户随时看清在筛什么 */}
      <AnimatePresence initial={false}>
        {activeFilterCount > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 12 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={heightTransition}
            onAnimationStart={() => setChipsOverflowHidden(true)}
            onAnimationComplete={() => setChipsOverflowHidden(false)}
            style={{ overflow: chipsOverflowHidden ? 'hidden' : 'visible' }}
          >
            <div className="flex items-center gap-2 flex-wrap py-0.5">
              <span className="tnum text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                已应用 {activeFilterCount}
              </span>
              <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                {activeChips.map((chip) => {
                  const Icon = chip.icon;
                  return (
                    <motion.span
                      key={chip.key}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={chipTransition}
                      className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1 rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] border border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] text-xs"
                    >
                      <Icon className="w-3 h-3 text-[var(--aurora-1)] shrink-0" />
                      <span className="text-[var(--ink-muted)] font-mono">{chip.label}</span>
                      <span className="text-[var(--ink-primary)] font-medium max-w-[180px] truncate">
                        {chip.value}
                      </span>
                      <button
                        type="button"
                        onClick={chip.onRemove}
                        aria-label={`移除${chip.label}筛选`}
                        className="ml-0.5 w-5 h-5 inline-flex items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] hover:text-[var(--ink-primary)] transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </motion.span>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={resetAllFilters}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-xs font-mono uppercase tracking-[0.12em] text-[var(--ink-muted)] hover:text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] transition-colors"
              >
                <X className="w-3 h-3" />
                全部清空
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 文章列表 */}
      <div className="surface-leaf surface-admin-card rounded-2xl overflow-hidden relative flex flex-col">
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
                className="p-8 text-center text-status-danger"
              >
                {error}
              </motion.div>
            ) : posts.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center py-20 px-6"
              >
                <div className="w-16 h-16 mx-auto mb-4 inline-flex items-center justify-center rounded-2xl bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] border border-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)]">
                  {hasAnyFilter
                    ? <Search className="w-8 h-8 text-[var(--aurora-1)]" />
                    : <FileText className="w-8 h-8 text-[var(--aurora-1)]" />}
                </div>
                <h3 className="font-display text-lg text-[var(--ink-primary)] mb-1">
                  {hasAnyFilter ? '当前筛选条件下没有文章' : '还没有任何文章'}
                </h3>
                <p className="text-sm text-[var(--ink-muted)] max-w-sm mx-auto">
                  {hasAnyFilter
                    ? '尝试清空当前筛选，或者换个关键字搜索'
                    : '从一篇空白文章开始，或者让 AI 协同写作帮你打草稿'}
                </p>
                <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
                  {hasAnyFilter ? (
                    <button
                      type="button"
                      onClick={resetAllFilters}
                      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-medium border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] transition-colors"
                    >
                      <X className="w-4 h-4" />
                      清空筛选
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => navigate('/posts/new')}
                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-semibold text-white bg-[var(--color-primary)] shadow-[0_4px_12px_-2px_color-mix(in_oklch,var(--aurora-1)_28%,transparent)] hover:shadow-[0_6px_16px_-2px_color-mix(in_oklch,var(--aurora-1)_38%,transparent)] transition-shadow"
                      >
                        <Plus className="w-4 h-4" />
                        创建第一篇文章
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate('/posts/ai-writing/new')}
                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-medium border border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] transition-colors"
                      >
                        <Sparkles className="w-4 h-4" />
                        AI 协同写作
                      </button>
                    </>
                  )}
                </div>
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
                        <PostTableRow
                          key={post.id}
                          post={post}
                          isActivePopover={activeTagPopover === post.id}
                          actionLoading={actionLoading === post.id}
                          onTogglePopover={handleTogglePopover}
                          onEdit={handleEdit}
                          onOpenProperties={handleOpenProperties}
                          onCopy={handleCopyClick}
                          onDelete={handleDeleteClick}
                          popoverRef={tagPopoverRef}
                        />
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
                        <StatusBadge status={post.status} />
                      </div>

                      {(post.isHidden || post.passwordRequired) && (
                        <div className="flex items-center gap-2">
                          {post.isHidden && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-status-warning">
                              <EyeOff className="w-3 h-3" />
                              已隐藏
                            </span>
                          )}
                          {post.passwordRequired && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-status-info">
                              <Lock className="w-3 h-3" />
                              已加密
                            </span>
                          )}
                        </div>
                      )}

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
                            className="p-2 text-[var(--text-muted)] active:text-status-danger"
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
        <div className="flex flex-col md:flex-row items-center justify-between gap-2 py-3 px-4 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50 min-h-[48px] md:min-h-[64px] relative">
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div
                key="stats-skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2"
              >
                <div className="h-4 w-32 bg-[var(--bg-secondary)] rounded animate-pulse" />
              </motion.div>
            ) : (
              <motion.div
                key="stats-real"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)]"
              >
                <span>
                  共 <span className="text-primary/70 font-semibold">{pagination.total}</span> 篇
                </span>
                <span className="hidden md:inline">文章</span>
                <div className="w-px h-3 bg-[var(--border-subtle)] mx-0.5" />
                <span>
                  {pagination.pageNum} / {pagination.pages || 1} 页
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center">
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
                    'flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-300',
                    pagination.pageNum <= 1
                      ? 'text-[var(--text-muted)]/50 cursor-not-allowed'
                      : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)]'
                  )}
                  aria-label="上一页"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <div
                  ref={pageStripRef}
                  role="group"
                  aria-label="分页导航"
                  className="flex items-center gap-1.5 px-0.5 overflow-x-auto overscroll-x-contain no-scrollbar min-w-0 max-w-[240px] sm:max-w-[360px] md:max-w-[520px] lg:max-w-[640px] snap-x snap-proximity scroll-smooth touch-pan-x [scrollbar-width:none]"
                  style={{ WebkitOverflowScrolling: 'touch' }}
                >
                  {pageNumbers.map((entry) => {
                    const isActive = entry === pagination.pageNum;
                    return (
                      <button
                        key={entry}
                        onClick={() => handlePageChange(entry)}
                        aria-current={isActive ? 'page' : undefined}
                        aria-label={`第 ${entry} 页`}
                        className={cn(
                          'flex-shrink-0 w-8 h-8 rounded-lg text-xs font-medium transition-all duration-300 flex items-center justify-center snap-center',
                          isActive
                            ? 'bg-primary text-white shadow-lg shadow-primary/25'
                            : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)]'
                        )}
                      >
                        {entry}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => handlePageChange(pagination.pageNum + 1)}
                  disabled={pagination.pageNum >= pagination.pages}
                  className={cn(
                    'flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-300',
                    pagination.pageNum >= pagination.pages
                      ? 'text-[var(--text-muted)]/50 cursor-not-allowed'
                      : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)]'
                  )}
                  aria-label="下一页"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
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

      {/* 属性弹窗 */}
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
