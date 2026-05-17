import { useEffect, useState, useCallback, useRef, useMemo, type FormEvent } from 'react';
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
import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
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

const STATUS_FILTERS: Array<{ key: string | undefined; label: string }> = [
  { key: undefined, label: '全部' },
  { key: 'PUBLISHED', label: '已发布' },
  { key: 'DRAFT', label: '草稿' },
];

const DEFAULT_POST_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS: SelectOption[] = [
  { value: '10', label: '10 条/页' },
  { value: '20', label: '20 条/页' },
  { value: '50', label: '50 条/页' },
  { value: '200', label: '200 条/页' },
];
const PAGINATION_FULL_RENDER_THRESHOLD = 10;
const PAGINATION_EDGE_COUNT = 5;
const PAGINATION_SIBLING_COUNT = 5;
const POST_ROW_HEIGHT_CLASS = 'h-[76px]';
const MOBILE_POST_CARD_CLASS = cn(
  'grid h-[190px] grid-rows-[48px_20px_22px_44px] gap-2 p-4',
  'transition-colors active:bg-[var(--bg-card-hover)]'
);
const MOBILE_POST_PLACEHOLDER_CLASS = 'h-[190px] pointer-events-none';

type PaginationEllipsis = {
  type: 'ellipsis';
  key: string;
  start: number;
  end: number;
};

type PaginationItem = number | PaginationEllipsis;

function pageRange(start: number, end: number): number[] {
  if (end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function isPaginationEllipsis(item: PaginationItem): item is PaginationEllipsis {
  return typeof item !== 'number';
}

function buildPaginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 1) return [1];
  if (totalPages <= PAGINATION_FULL_RENDER_THRESHOLD) {
    return pageRange(1, totalPages);
  }

  const safeCurrentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const rawRanges = ([
    [1, Math.min(PAGINATION_EDGE_COUNT, totalPages)],
    [
      Math.max(1, safeCurrentPage - PAGINATION_SIBLING_COUNT),
      Math.min(totalPages, safeCurrentPage + PAGINATION_SIBLING_COUNT),
    ],
    [Math.max(1, totalPages - PAGINATION_EDGE_COUNT + 1), totalPages],
  ] satisfies Array<[number, number]>).sort((a, b) => a[0] - b[0]);

  const ranges = rawRanges.reduce<Array<[number, number]>>((merged, range) => {
    const last = merged[merged.length - 1];
    if (!last || range[0] > last[1] + 1) {
      merged.push([...range]);
      return merged;
    }
    last[1] = Math.max(last[1], range[1]);
    return merged;
  }, []);

  const items: PaginationItem[] = [];
  let lastPage = 0;
  for (const [start, end] of ranges) {
    if (start > lastPage + 1) {
      if (start === lastPage + 2) {
        items.push(lastPage + 1);
      } else {
        items.push({
          type: 'ellipsis',
          key: `ellipsis-${lastPage + 1}-${start - 1}`,
          start: lastPage + 1,
          end: start - 1,
        });
      }
    }
    items.push(...pageRange(start, end));
    lastPage = end;
  }

  return items;
}

const postPanelClass = cn(
  'access-surface surface-leaf surface-admin-panel rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'p-3 shadow-sm sm:p-4'
);

const postShellClass = cn(
  'access-surface overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'bg-[var(--bg-leaf)] shadow-[0_18px_48px_-42px_rgba(0,0,0,0.45)]'
);

function statusChipClass(isSelected: boolean): string {
  return cn(
    'inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-xs font-medium sm:h-7 sm:min-h-0',
    'transition-[background-color,color,box-shadow] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
    isSelected
      ? 'bg-[var(--bg-leaf)] text-[var(--ink-primary)] shadow-[0_1px_2px_color-mix(in_oklch,var(--ink-primary)_8%,transparent)]'
      : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]'
  );
}

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

  // URL ?search= 是搜索关键词的唯一事实源:
  // 既支持外部入口(侧边栏全局搜索)直接预填,也让浏览器后退/分享链接保持搜索状态。
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSearch = searchParams.get('search') ?? '';
  const [searchQuery, setSearchQuery] = useState(urlSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(urlSearch);
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [pagination, setPagination] = useState({
    pageNum: 1,
    pageSize: DEFAULT_POST_PAGE_SIZE,
    total: 0,
    pages: 0,
  });
  const [pageSize, setPageSize] = useState(DEFAULT_POST_PAGE_SIZE);
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
  const tagPopoverRef = useRef<HTMLDivElement>(null);

  // 分页滚动条: 当前页跟随滚动并在可视区域居中显示, 边界时自然贴合首尾
  const pageStripRef = useRef<HTMLDivElement>(null);
  const [pageJumpTarget, setPageJumpTarget] = useState<string | null>(null);
  const [pageJumpValue, setPageJumpValue] = useState('');

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

  const fetchPosts = async (
    pageNum = 1,
    currentStatus?: string,
    keyword?: string,
    currentFilters = filters,
    currentPageSize = pageSize,
  ) => {
    try {
      setLoading(true);
      setError(null);
      const res = await postService.getList({
        pageNum,
        pageSize: currentPageSize,
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
    } catch (err: unknown) {
      logger.error('Posts fetch error:', err);
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  };

  // 初始加载及状态/搜索/筛选条件变更时重新加载
  useEffect(() => {
    setActiveTagPopover(null);
    fetchPosts(1, activeStatus, debouncedSearch || undefined, filters, pageSize);
  }, [activeStatus, debouncedSearch, filters, pageSize]);

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
    const maxPage = pagination.pages || 1;
    const nextPage = Math.min(Math.max(page, 1), maxPage);
    if (loading || nextPage === pagination.pageNum) return;
    setActiveTagPopover(null);
    setPageJumpTarget(null);
    fetchPosts(nextPage, activeStatus, debouncedSearch || undefined, filters, pageSize);
  };

  const handleOpenPageJump = (entry: PaginationEllipsis) => {
    const defaultPage =
      pagination.pageNum >= entry.start && pagination.pageNum <= entry.end
        ? pagination.pageNum
        : entry.start;
    setPageJumpTarget(entry.key);
    setPageJumpValue(String(defaultPage));
  };

  const handlePageJumpSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pageJumpValue.trim()) return;
    const page = Number(pageJumpValue);
    if (!Number.isFinite(page)) return;
    handlePageChange(Math.trunc(page));
  };

  const handlePageSizeChange = (next: string) => {
    const nextPageSize = Number(next);
    if (!PAGE_SIZE_OPTIONS.some((option) => option.value === next) || nextPageSize === pageSize) {
      return;
    }
    setActiveTagPopover(null);
    setPageJumpTarget(null);
    setPageSize(nextPageSize);
  };

  // 处理删除操作
  const confirmDelete = async () => {
    if (!confirmDialog.post) return;
    try {
      setActionLoading(confirmDialog.post.id);
      await postService.delete(confirmDialog.post.id);
      setConfirmDialog({ isOpen: false, type: 'delete', post: null });
      fetchPosts(pagination.pageNum, activeStatus, debouncedSearch || undefined, filters, pageSize);
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
        fetchPosts(1, activeStatus, debouncedSearch || undefined, filters, pageSize);
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
      fetchPosts(pagination.pageNum, activeStatus, debouncedSearch || undefined, filters, pageSize);
    } catch (err) {
      logger.error('更新属性失败:', err);
    } finally {
      setActionLoading(null);
    }
  }, [selectedPost, pagination.pageNum, activeStatus, debouncedSearch, filters, pageSize]);

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

  const activeStatusLabel = STATUS_FILTERS.find((item) => item.key === activeStatus)?.label ?? '全部';
  const totalPages = pagination.pages || 1;
  const currentPaginationPageSize = pagination.pageSize || pageSize;
  const paginationItems = useMemo(
    () => buildPaginationItems(pagination.pageNum, totalPages),
    [pagination.pageNum, totalPages]
  );
  const placeholderCount = posts.length > 0
    ? Math.max(0, currentPaginationPageSize - posts.length)
    : 0;
  const isInitialLoading = loading && posts.length === 0;
  const isListRefreshing = loading && posts.length > 0;

  return (
    <div className="admin-grid-page -m-4 min-h-[calc(100%+2rem)] overflow-hidden p-4 text-[var(--ink-primary)] md:-m-6 md:min-h-[calc(100%+3rem)] md:p-6">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-0 py-2 sm:gap-4 sm:px-6 sm:py-4 lg:px-8">
        <AdminModuleHeader
          title="文章管理"
          description="管理文章发布、草稿、分类标签、可见性与内容属性。"
          icon={FileText}
          currentLabel={isInitialLoading ? '同步中' : activeStatusLabel}
          activeSummary={
            isInitialLoading
              ? '正在同步文章列表'
              : `当前匹配 ${pagination.total} 篇文章，第 ${pagination.pageNum}/${totalPages} 页`
          }
          actions={
            <>
              <button
                type="button"
                onClick={() => navigate('/posts/ai-writing/new')}
                className="admin-module-action-button max-sm:!h-11 max-sm:!min-h-11 max-sm:!w-11"
                aria-label="AI 协同写作"
              >
                <Sparkles className="h-4 w-4" />
                AI 协同写作
              </button>
              <button
                type="button"
                onClick={() => navigate('/posts/new')}
                className="admin-module-action-button max-sm:!h-11 max-sm:!min-h-11 max-sm:!w-11"
                aria-label="新建文章"
              >
                <Plus className="h-4 w-4" />
                新建
              </button>
            </>
          }
        />

        <div className={cn(postPanelClass, 'space-y-4')}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="relative md:col-span-12">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input
                type="text"
                placeholder="搜索文章标题"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="文章关键词搜索"
                className={cn(
                  'h-11 w-full rounded-lg pl-9 pr-9 text-sm sm:h-10',
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
                  onClick={() => setSearchQuery('')}
                  aria-label="清空搜索"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--ink-primary)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-[60px] items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
              <FileText className="h-3.5 w-3.5" />
              <span>状态</span>
            </div>
            <div className="inline-flex max-w-full items-center overflow-x-auto rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] p-0.5">
              {STATUS_FILTERS.map((tab) => {
                const isActive = activeStatus === tab.key;
                return (
                  <button
                    key={tab.key ?? 'all'}
                    type="button"
                    onClick={() => handleStatusChange(tab.key)}
                    className={statusChipClass(isActive)}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                setFilters((f) => ({
                  ...f,
                  hidden: f.hidden === undefined ? true : f.hidden === true ? false : undefined,
                }));
              }}
              className={cn(
                'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium sm:h-7 sm:min-h-0',
                'transition-[background-color,border-color,color] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
                filters.hidden === true
                  ? 'border-[color-mix(in_oklch,var(--signal-warn)_30%,transparent)] bg-[color-mix(in_oklch,var(--signal-warn)_10%,transparent)] text-[var(--signal-warn)]'
                  : filters.hidden === false
                    ? 'border-[color-mix(in_oklch,var(--signal-success)_30%,transparent)] bg-[color-mix(in_oklch,var(--signal-success)_10%,transparent)] text-[var(--signal-success)]'
                    : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-muted)] hover:border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] hover:text-[var(--ink-primary)]'
              )}
              title="点击切换可见性筛选"
            >
              {filters.hidden === true
                ? <><EyeOff className="h-3.5 w-3.5" /> 仅隐藏</>
                : filters.hidden === false
                  ? <><Eye className="h-3.5 w-3.5" /> 仅公开</>
                  : <><Eye className="h-3.5 w-3.5" /> 全部可见性</>}
            </button>

            <button
              type="button"
              onClick={() => setShowAdvancedFilter(!showAdvancedFilter)}
              aria-expanded={showAdvancedFilter}
              aria-controls="posts-advanced-filter-panel"
              className={cn(
                'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium sm:h-8 sm:min-h-0',
                'transition-[background-color,border-color,color] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
                showAdvancedFilter
                  ? 'border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] text-[var(--ink-primary)]'
                  : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-secondary)] hover:border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] hover:text-[var(--ink-primary)]'
              )}
            >
              <Filter className="h-4 w-4" />
              <span>高级筛选</span>
              {activeFilterCount > 0 && (
                <span className="tnum inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--aurora-1)] px-1 font-mono text-[10px] font-semibold text-[var(--bg-void)]">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown className={cn('h-4 w-4 transition-transform duration-[var(--dur-quick)]', showAdvancedFilter && 'rotate-180')} />
            </button>
          </div>

          <div
            id="posts-advanced-filter-panel"
            aria-hidden={!showAdvancedFilter}
            className={cn(
              'grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none',
              showAdvancedFilter ? 'opacity-100' : 'pointer-events-none !mt-0 opacity-0'
            )}
            style={{ gridTemplateRows: showAdvancedFilter ? '1fr' : '0fr' }}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] p-3 sm:p-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
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
                      className="!h-11 sm:!h-10"
                      disabled={!showAdvancedFilter}
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
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
                      className="!h-11 sm:!h-10"
                      disabled={!showAdvancedFilter}
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                      浏览量
                    </label>
                    <Select
                      value={viewCountPreset}
                      onValueChange={handleViewCountPresetChange}
                      options={viewCountOptions}
                      placeholder="全部浏览量"
                      prefix={<BarChart3 />}
                      ariaLabel="浏览量范围"
                      className="!h-11 sm:!h-10"
                      disabled={!showAdvancedFilter}
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                      发布时间
                    </label>
                    <DateRangePicker
                      value={dateRange}
                      onChange={handleDateRangeChange}
                      placeholder="选择时间范围"
                      ariaLabel="发布时间筛选"
                      className="!h-11 sm:!h-10"
                      disabled={!showAdvancedFilter}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {activeFilterCount > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
                animate={{ opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' } }}
                exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                transition={heightTransition}
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
                          transition={chipTransition}
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
                    onClick={resetAllFilters}
                    className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-mono uppercase tracking-[0.12em] text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] hover:text-[var(--signal-danger)]"
                  >
                    <X className="h-3 w-3" />
                    全部清空
                  </button>
                </div>
                <div className="mt-2 text-xs text-[var(--ink-muted)]">
                  匹配 <span className="tnum font-medium text-[var(--ink-primary)]">{pagination.total}</span> 篇文章
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 文章列表 */}
        <div className={cn(postShellClass, 'relative flex flex-col')}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ink-primary)] text-[var(--bg-void)]">
                <FileText className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-[var(--ink-primary)]">文章列表</p>
                <p className="text-xs text-[var(--ink-muted)]">
                  {hasAnyFilter ? '按当前筛选查看文章与属性操作' : '按发布时间倒序管理文章内容'}
                </p>
              </div>
            </div>
            <span className="rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-muted)]">
              {isInitialLoading ? '加载中' : `${posts.length}/${pagination.total}`}
            </span>
          </div>

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
        <div className="relative flex-1 overflow-auto">
          <AnimatePresence mode="wait">
            {isInitialLoading ? (
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
                      {Array.from({ length: DEFAULT_POST_PAGE_SIZE }).map((_, i) => (
                        <tr key={i} className={cn(POST_ROW_HEIGHT_CLASS, 'border-b border-[var(--border-subtle)] last:border-b-0')}>
                          <td className="h-[76px] px-4 py-2 w-[40%] align-middle"><div className="h-5 bg-[var(--bg-secondary)] rounded w-3/4 animate-pulse"></div></td>
                          <td className="h-[76px] px-4 py-2 w-20 align-middle"><div className="h-5 bg-[var(--bg-secondary)] rounded-full w-14 animate-pulse"></div></td>
                          <td className="h-[76px] px-4 py-2 w-24 align-middle"><div className="h-6 bg-[var(--bg-secondary)] rounded-md w-16 animate-pulse"></div></td>
                          <td className="h-[76px] px-4 py-2 w-40 align-middle"><div className="flex gap-1.5"><div className="h-5 bg-[var(--bg-secondary)] rounded w-12 animate-pulse"></div><div className="h-5 bg-[var(--bg-secondary)] rounded w-12 animate-pulse"></div></div></td>
                          <td className="h-[76px] px-4 py-2 w-24 align-middle"><div className="h-5 bg-[var(--bg-secondary)] rounded w-20 animate-pulse"></div></td>
                          <td className="h-[76px] px-4 py-2 w-16 align-middle"><div className="h-5 bg-[var(--bg-secondary)] rounded w-10 animate-pulse"></div></td>
                          <td className="h-[76px] px-4 py-2 w-28 align-middle"><div className="flex justify-end gap-1"><div className="h-8 w-8 bg-[var(--bg-secondary)] rounded-lg animate-pulse"></div><div className="h-8 w-8 bg-[var(--bg-secondary)] rounded-lg animate-pulse"></div></div></td>
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
            ) : error && posts.length === 0 ? (
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
                      {Array.from({ length: placeholderCount }).map((_, index) => (
                        <tr
                          key={`desktop-placeholder-${index}`}
                          aria-hidden="true"
                          className={cn(
                            POST_ROW_HEIGHT_CLASS,
                            'pointer-events-none border-b border-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] last:border-b-0'
                          )}
                        >
                          <td colSpan={7} className="h-[76px] px-4 py-2" />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 移动端视图 - 列表卡片 */}
                <div className="md:hidden divide-y divide-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)]">
                  {posts.map((post) => (
                    <div key={post.id} className={MOBILE_POST_CARD_CLASS}>
                      <div className="grid h-12 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                        <button
                          type="button"
                          onClick={(e) => handleEdit(post, e)}
                          className="h-12 min-w-0 text-left"
                        >
                          <h3 className="line-clamp-2 text-sm font-semibold leading-6 text-[var(--ink-primary)]">
                            {post.title}
                          </h3>
                        </button>
                        <StatusBadge status={post.status} />
                      </div>

                      <div className="flex h-5 items-center gap-2 overflow-hidden">
                        {(post.isHidden || post.passwordRequired) && (
                          <>
                          {post.isHidden && (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] text-status-warning">
                              <EyeOff className="h-3 w-3" />
                              已隐藏
                            </span>
                          )}
                          {post.passwordRequired && (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] text-status-info">
                              <Lock className="h-3 w-3" />
                              已加密
                            </span>
                          )}
                          </>
                        )}
                      </div>

                      <div className="flex h-[22px] items-center gap-2 overflow-hidden text-[11px] text-[var(--ink-muted)]">
                        <span className="max-w-[8rem] truncate rounded border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] px-1.5 py-0.5">
                          {post.categoryName || '-'}
                        </span>
                        <span className="h-2.5 w-px shrink-0 bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]" />
                        <span className="shrink-0">{formatDate(post.publishedAt || post.createdAt)}</span>
                        <span className="h-2.5 w-px shrink-0 bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]" />
                        <span className="tnum shrink-0">{post.viewCount} 浏览</span>
                      </div>

                      <div className="flex h-11 items-center justify-between gap-3">
                        <div className="mr-1 flex h-11 min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                          {post.tagNames?.length > 0 ? (
                            <>
                              {post.tagNames.slice(0, 2).map((tag) => (
                                <span
                                  key={tag}
                                  className="max-w-[8rem] truncate rounded border border-[color-mix(in_oklch,var(--aurora-1)_20%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--aurora-1)]"
                                >
                                  {tag}
                                </span>
                              ))}
                              {post.tagNames.length > 2 && (
                                <span className="rounded border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
                                  +{post.tagNames.length - 2}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-[10px] text-[var(--ink-muted)]">无标签</span>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => handleOpenProperties(post, e)}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors active:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] active:text-[var(--ink-primary)]"
                            aria-label={`设置文章 ${post.title}`}
                          >
                            <Settings className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleEdit(post, e)}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors active:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] active:text-[var(--ink-primary)]"
                            aria-label={`编辑文章 ${post.title}`}
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleCopyClick(post, e)}
                            disabled={actionLoading === post.id}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors active:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] active:text-[var(--ink-primary)] disabled:opacity-50"
                            aria-label={`复制文章 ${post.title}`}
                          >
                            {actionLoading === post.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteClick(post, e)}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors active:bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] active:text-status-danger"
                            aria-label={`删除文章 ${post.title}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {Array.from({ length: placeholderCount }).map((_, index) => (
                    <div
                      key={`mobile-placeholder-${index}`}
                      aria-hidden="true"
                      className={MOBILE_POST_PLACEHOLDER_CLASS}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {isListRefreshing && (
            <div className="pointer-events-none absolute inset-0 z-10 bg-[var(--bg-leaf)]/35 backdrop-blur-[1px]">
              <div className="absolute right-4 top-3 inline-flex h-8 items-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-3 text-xs font-medium text-[var(--ink-secondary)] shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                同步列表
              </div>
            </div>
          )}
        </div>

        {/* 分页 - 移动到 Card 内部底部 */}
        <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:grid-cols-[minmax(0,1fr)_auto_auto] md:px-4 md:py-3">
          <AnimatePresence mode="wait">
            {isInitialLoading ? (
              <motion.div
                key="stats-skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="order-1 col-span-2 flex min-w-0 items-center md:col-span-1"
              >
                <div className="h-4 w-32 animate-pulse rounded bg-[var(--bg-secondary)]" />
              </motion.div>
            ) : (
              <motion.div
                key="stats-real"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="tnum order-1 col-span-2 flex min-w-0 flex-wrap items-center justify-start gap-1.5 text-left text-[13px] font-semibold leading-5 text-[var(--ink-muted)] md:col-span-1 md:text-xs"
              >
                <span>
                  第 <span className="text-[var(--ink-secondary)]">{pagination.pageNum}</span> / {totalPages} 页
                </span>
                <span className="mx-1 text-[var(--ink-subtle)]">·</span>
                <span>
                  共 <span className="text-[var(--ink-secondary)]">{pagination.total}</span> 篇
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <Select
            value={String(pageSize)}
            onValueChange={handlePageSizeChange}
            options={PAGE_SIZE_OPTIONS}
            ariaLabel="每页文章数量"
            size="sm"
            fullWidth={false}
            className="order-2 col-start-3 !h-10 !w-[112px] md:order-3 md:col-start-auto md:!h-8 md:!w-[132px]"
            disabled={isInitialLoading || isListRefreshing}
          />

          <div className="order-3 col-span-3 flex w-full items-center justify-center md:order-2 md:col-span-1 md:w-auto md:justify-end">
            {!isInitialLoading && pagination.pages > 1 ? (
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                className="grid w-full grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 md:flex md:w-auto md:gap-1.5"
              >
                <button
                  type="button"
                  onClick={() => handlePageChange(pagination.pageNum - 1)}
                  disabled={loading || pagination.pageNum <= 1}
                  className={cn(
                    'admin-module-action-button min-h-0 flex-shrink-0 p-2 disabled:cursor-not-allowed disabled:opacity-50 max-sm:!h-11 max-sm:!min-h-11 max-sm:!w-11',
                    loading || pagination.pageNum <= 1
                      ? 'text-[var(--ink-muted)]/50'
                      : 'text-[var(--ink-secondary)]'
                  )}
                  aria-label="上一页"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <div
                  ref={pageStripRef}
                  role="navigation"
                  aria-label="分页导航"
                  className="flex min-w-0 max-w-none items-center gap-1.5 overflow-x-auto overscroll-x-contain px-1 no-scrollbar md:max-w-[520px] md:px-0.5 lg:max-w-[640px] xl:max-w-[760px] snap-x snap-proximity scroll-smooth touch-pan-x [scrollbar-width:none]"
                  style={{ WebkitOverflowScrolling: 'touch' }}
                >
                  {paginationItems.map((entry) => {
                    if (isPaginationEllipsis(entry)) {
                      if (pageJumpTarget === entry.key) {
                        return (
                          <form
                            key={entry.key}
                            onSubmit={handlePageJumpSubmit}
                            className="flex h-10 w-[104px] flex-shrink-0 items-center gap-1 rounded-lg border border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] bg-[var(--bg-leaf)] p-1 md:h-8 md:w-[96px]"
                            aria-label={`跳转到第 ${entry.start} 到 ${entry.end} 页`}
                          >
                            <input
                              type="number"
                              min={entry.start}
                              max={entry.end}
                              value={pageJumpValue}
                              onChange={(event) => setPageJumpValue(event.target.value)}
                              onFocus={(event) => event.currentTarget.select()}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                  setPageJumpTarget(null);
                                }
                              }}
                              autoFocus
                              inputMode="numeric"
                              className="tnum h-full min-w-0 flex-1 rounded-md bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] px-1 text-center text-xs font-semibold text-[var(--ink-primary)] outline-none focus:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]"
                              aria-label="输入页码"
                            />
                            <button
                              type="submit"
                              disabled={loading}
                              className="h-full rounded-md px-2 text-xs font-semibold text-[var(--aurora-1)] transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              跳
                            </button>
                          </form>
                        );
                      }
                      return (
                        <button
                          type="button"
                          key={entry.key}
                          onClick={() => handleOpenPageJump(entry)}
                          disabled={loading}
                          className="flex h-10 w-10 flex-shrink-0 snap-center items-center justify-center rounded-lg border border-dashed border-[color-mix(in_oklch,var(--ink-primary)_14%,transparent)] bg-[var(--bg-leaf)] text-xs font-semibold text-[var(--ink-muted)] transition-all duration-200 hover:border-[color-mix(in_oklch,var(--aurora-1)_32%,transparent)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--ink-primary)] disabled:cursor-not-allowed disabled:opacity-60 md:h-8 md:w-9"
                          aria-label={`跳转到第 ${entry.start} 到 ${entry.end} 页`}
                        >
                          ...
                        </button>
                      );
                    }
                    const isActive = entry === pagination.pageNum;
                    return (
                      <button
                        type="button"
                        key={entry}
                        onClick={() => handlePageChange(entry)}
                        disabled={loading}
                        aria-current={isActive ? 'page' : undefined}
                        aria-label={`第 ${entry} 页`}
                        className={cn(
                          'flex h-10 w-10 flex-shrink-0 snap-center items-center justify-center rounded-lg text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60 md:h-8 md:w-8 md:text-xs',
                          isActive
                            ? 'bg-[var(--ink-primary)] text-[var(--bg-void)] shadow-[0_12px_24px_-20px_color-mix(in_oklch,var(--aurora-1)_55%,black)]'
                            : 'border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] text-[var(--ink-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--ink-primary)]'
                        )}
                      >
                        {entry}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => handlePageChange(pagination.pageNum + 1)}
                  disabled={loading || pagination.pageNum >= pagination.pages}
                  className={cn(
                    'admin-module-action-button min-h-0 flex-shrink-0 p-2 disabled:cursor-not-allowed disabled:opacity-50 max-sm:!h-11 max-sm:!min-h-11 max-sm:!w-11',
                    loading || pagination.pageNum >= pagination.pages
                      ? 'text-[var(--ink-muted)]/50'
                      : 'text-[var(--ink-secondary)]'
                  )}
                  aria-label="下一页"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            ) : !isInitialLoading && (
              <div className="h-8" />
            )}
          </div>
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
