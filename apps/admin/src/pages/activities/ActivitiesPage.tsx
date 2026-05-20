import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock,
  RefreshCw,
  ChevronDown,
  ArrowLeft,
  Search as SearchIcon,
  X,
  Layers,
  Activity as ActivityIcon,
  Tag as TagIcon,
  SlidersHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { AdminSectionCount, AdminSectionHeader } from '@/components/layout/AdminSectionHeader';
import { useDebounce } from '@aetherblog/hooks';
import { Select, DateRangePicker, type DateRangeValue, type SelectOption } from '@aetherblog/ui';
import { formatDistanceToNow, format, parseISO, isValid } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { activityService, type ActivityQueryParams } from '@/services/activityService';
import {
  activityCategoryConfig,
  activityStatusConfig,
  activityStatusPillStyle,
  activityToneStyle,
  getActivityStatusConfig,
  getActivityVisual,
  type ActivityCategoryKey,
  type ActivityStatusKey,
} from '@/lib/activityVisuals';
import { AdminPagination } from '@/components/common/AdminPagination';

const categories: Array<'all' | ActivityCategoryKey> = [
  'all', 'post', 'comment', 'user', 'system', 'friend', 'media', 'ai', 'security',
];

const statuses: Array<'all' | ActivityStatusKey> = ['all', 'INFO', 'SUCCESS', 'WARNING', 'ERROR'];
const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 200];

const activityPanelClass = cn(
  'access-surface surface-leaf surface-admin-panel rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'p-3 shadow-sm sm:p-4'
);

const activityShellClass = cn(
  'access-surface overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'bg-[var(--bg-leaf)] shadow-[0_18px_48px_-42px_rgba(0,0,0,0.45)]'
);

/**
 * 各分类下的细分事件类型 —— 用于 category 选中后的二级 eventType 下拉。
 * 取值与后端 handler 中实际写入的 EventType 严格一致；
 * 新增事件类型时请同步追加，避免下拉框选中后查不到记录。
 */
const eventTypeOptions: Record<ActivityCategoryKey, Array<{ value: string; label: string }>> = {
  post: [
    { value: 'post.create',  label: '创建文章' },
    { value: 'post.update',  label: '更新文章' },
    { value: 'post.delete',  label: '删除文章' },
    { value: 'post.publish', label: '发布文章' },
  ],
  comment: [
    { value: 'comment.approve', label: '审核通过' },
    { value: 'comment.delete',  label: '删除评论' },
  ],
  user: [
    { value: 'user.login', label: '用户登录' },
  ],
  system: [
    { value: 'system.setting_update', label: '更新设置' },
  ],
  friend: [
    { value: 'friend.create', label: '创建友链' },
    { value: 'friend.delete', label: '删除友链' },
  ],
  media: [
    { value: 'media.upload', label: '上传媒体' },
    { value: 'media.delete', label: '删除媒体' },
  ],
  ai: [
    { value: 'ai.generation.summary',        label: 'AI 生成 - 摘要' },
    { value: 'ai.generation.summary_stream', label: 'AI 生成 - 摘要(流式)' },
    { value: 'ai.generation.tags',           label: 'AI 生成 - 标签' },
    { value: 'ai.generation.titles',         label: 'AI 生成 - 标题' },
    { value: 'ai.generation.polish',         label: 'AI 生成 - 润色' },
    { value: 'ai.generation.outline',        label: 'AI 生成 - 大纲' },
    { value: 'ai.generation.translate',      label: 'AI 生成 - 翻译' },
    { value: 'ai.agent_chat',                label: 'Agent 工作台对话' },
    { value: 'ai.prompt_update',             label: '更新提示词' },
    { value: 'ai.task_create',               label: '创建 AI 任务' },
    { value: 'ai.task_update',               label: '更新 AI 任务' },
    { value: 'ai.task_delete',               label: '删除 AI 任务' },
    { value: 'ai.provider_proxy_write',      label: 'AI 提供商代理写入' },
  ],
  security: [
    { value: 'security.jwt_rotate', label: '轮换 JWT 密钥' },
  ],
};

/**
 * 分类 chip 的统一 className —— 供「全部」固定按钮和滚动列表中的循环按钮共用，
 * 避免选中态 / hover 样式在两处重复维护时漂移。
 */
function categoryChipClass(isSelected: boolean): string {
  return cn(
    'shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-sm font-medium',
    'transition-[background-color,border-color,color,box-shadow] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
    'border',
    isSelected
      ? 'bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)] text-[var(--ink-primary)] shadow-[0_0_0_1px_color-mix(in_oklch,var(--aurora-1)_25%,transparent),0_6px_18px_-14px_color-mix(in_oklch,var(--aurora-1)_55%,transparent)]'
      : 'bg-[var(--bg-leaf)] border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] text-[var(--ink-secondary)] hover:border-[color-mix(in_oklch,var(--aurora-1)_25%,transparent)] hover:text-[var(--ink-primary)]'
  );
}

/**
 * 时间范围 chip 显示用 —— 把 ISO 转中文友好文案
 */
function formatDateRangeChip(start?: string, end?: string): string | null {
  const s = start ? parseISO(start) : null;
  const e = end ? parseISO(end) : null;
  if (!s && !e) return null;
  if (s && e && isValid(s) && isValid(e)) {
    if (format(s, 'yyyy-MM-dd') === format(e, 'yyyy-MM-dd')) {
      return format(s, 'yyyy 年 M 月 d 日', { locale: zhCN });
    }
    if (s.getFullYear() === e.getFullYear()) {
      return `${format(s, 'M/d')} – ${format(e, 'M/d')}`;
    }
    return `${format(s, 'yyyy/M/d')} – ${format(e, 'yyyy/M/d')}`;
  }
  if (s && isValid(s)) return `自 ${format(s, 'yyyy/M/d')}`;
  if (e && isValid(e)) return `至 ${format(e, 'yyyy/M/d')}`;
  return null;
}

/**
 * 活动事件列表页面
 *
 * @ref §8.2 - 活动事件管理
 */
export default function ActivitiesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromDashboard = searchParams.get('from') === 'dashboard';

  const [selectedCategory, setSelectedCategory] = useState<'all' | ActivityCategoryKey>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | ActivityStatusKey>('all');
  const [selectedEventType, setSelectedEventType] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [dateRange, setDateRange] = useState<DateRangeValue>({ startTime: '', endTime: '' });
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [refreshPulse, setRefreshPulse] = useState(0);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const debouncedSearch = useDebounce(searchTerm.trim(), 350);

  // 切换分类时重置二级 eventType（避免 post 选中 'post.create' 后切到 comment 仍带着 stale 值）
  useEffect(() => {
    setSelectedEventType('');
  }, [selectedCategory]);

  // 任何过滤维度变化都回到第一页
  useEffect(() => {
    setPageNum(1);
  }, [selectedCategory, selectedStatus, selectedEventType, debouncedSearch, dateRange.startTime, dateRange.endTime]);

  const queryParams: ActivityQueryParams = useMemo(() => ({
    category: selectedCategory === 'all' ? undefined : selectedCategory,
    eventType: selectedEventType || undefined,
    status: selectedStatus === 'all' ? undefined : selectedStatus,
    search: debouncedSearch || undefined,
    startTime: dateRange.startTime || undefined,
    endTime: dateRange.endTime || undefined,
    pageNum,
    pageSize,
  }), [selectedCategory, selectedStatus, selectedEventType, debouncedSearch, dateRange.startTime, dateRange.endTime, pageNum, pageSize]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['activities', queryParams],
    queryFn: async () => {
      const res = await activityService.getActivities(queryParams);
      return res.code === 200 ? res.data : { list: [], total: 0, pageNum, pageSize, pages: 0 };
    },
    placeholderData: (previousData) => previousData,
  });

  const activities = data?.list || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const listRefreshing = (isFetching && !isLoading) || manualRefreshing;

  useEffect(() => {
    if (pageNum > totalPages) {
      setPageNum(totalPages);
    }
  }, [pageNum, totalPages]);

  const handleRefresh = async () => {
    if (manualRefreshing) return;
    setManualRefreshing(true);
    setRefreshPulse((value) => value + 1);
    try {
      await Promise.all([
        refetch(),
        new Promise((resolve) => window.setTimeout(resolve, 520)),
      ]);
    } finally {
      setManualRefreshing(false);
    }
  };

  const handlePageSizeChange = (nextSize: number) => {
    if (!PAGE_SIZE_OPTIONS.includes(nextSize) || nextSize === pageSize) return;
    setPageSize(nextSize);
    setPageNum(1);
  };

  /* -----------------------------------------------------------
   * 激活筛选可视化 —— 把所有非默认值收集为可单独移除的 chip
   * 这是当前 UI 与原版最大的差异：用户能"看见"自己开了什么。
   * ----------------------------------------------------------- */
  type ActiveChip = {
    key: string;
    icon: ComponentType<{ className?: string }>;
    label: string;
    value: string;
    onRemove: () => void;
  };

  const activeChips: ActiveChip[] = [];
  if (selectedCategory !== 'all') {
    const cfg = activityCategoryConfig[selectedCategory];
    activeChips.push({
      key: 'category',
      icon: cfg.icon,
      label: '分类',
      value: cfg.label,
      onRemove: () => setSelectedCategory('all'),
    });
  }
  if (selectedStatus !== 'all') {
    activeChips.push({
      key: 'status',
      icon: ActivityIcon,
      label: '状态',
      value: activityStatusConfig[selectedStatus].label,
      onRemove: () => setSelectedStatus('all'),
    });
  }
  if (selectedEventType) {
    const opt = selectedCategory !== 'all'
      ? eventTypeOptions[selectedCategory].find((o) => o.value === selectedEventType)
      : undefined;
    activeChips.push({
      key: 'eventType',
      icon: TagIcon,
      label: '类型',
      value: opt?.label ?? selectedEventType,
      onRemove: () => setSelectedEventType(''),
    });
  }
  const dateChip = formatDateRangeChip(dateRange.startTime, dateRange.endTime);
  if (dateChip) {
    activeChips.push({
      key: 'date',
      icon: Clock,
      label: '时间',
      value: dateChip,
      onRemove: () => setDateRange({ startTime: '', endTime: '' }),
    });
  }
  if (debouncedSearch) {
    activeChips.push({
      key: 'search',
      icon: SearchIcon,
      label: '关键词',
      value: debouncedSearch,
      onRemove: () => setSearchTerm(''),
    });
  }

  const activeFilterCount = activeChips.length;

  const resetFilters = () => {
    setSelectedCategory('all');
    setSelectedStatus('all');
    setSelectedEventType('');
    setSearchTerm('');
    setDateRange({ startTime: '', endTime: '' });
    setMobileFiltersOpen(false);
  };

  // 当前分类下的事件类型 → Select 选项；空值代表“不按事件类型过滤”。
  const eventTypeSelectOptions: SelectOption[] = useMemo(() => {
    const allOption: SelectOption = {
      value: '',
      label: '所有事件类型',
      description: selectedCategory === 'all' ? '不按分类或事件类型过滤' : '不限制当前分类下的事件类型',
    };

    if (selectedCategory === 'all') return [allOption];

    return [
      allOption,
      ...eventTypeOptions[selectedCategory].map((o) => ({
        value: o.value,
        label: o.label,
        description: o.value,
      })),
    ];
  }, [selectedCategory]);

  return (
    <div className="admin-grid-page -m-4 min-h-[calc(100%+2rem)] overflow-hidden p-4 text-[var(--ink-primary)] md:-m-6 md:min-h-[calc(100%+3rem)] md:p-6">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-0 py-2 sm:gap-4 sm:px-6 sm:py-4 lg:px-8">
        <AdminModuleHeader
          className="activity-log-actions-module-header compact-actions-module-header"
          title="活动记录"
          description="记录账号、内容、媒体、AI 与安全事件，支持快速回溯。"
          icon={ActivityIcon}
          currentLabel={isFetching ? '同步中' : '事件流'}
          activeSummary={`当前匹配 ${total} 条记录，第 ${pageNum}/${totalPages} 页`}
          actions={
            <>
              {fromDashboard && (
                <button
                  type="button"
                  onClick={() => navigate('/dashboard')}
                  className="admin-module-action-button"
                  title="返回仪表盘"
                  aria-label="返回仪表盘"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="sr-only">返回仪表盘</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleRefresh}
                disabled={manualRefreshing}
                className="admin-module-action-button activity-refresh-button"
                data-refreshing={listRefreshing}
                title={listRefreshing ? '正在刷新' : '刷新'}
                aria-label="刷新活动记录"
                aria-busy={listRefreshing}
              >
                <RefreshCw className={cn('h-4 w-4', listRefreshing && 'animate-spin')} />
                <span className="sr-only">{listRefreshing ? '刷新中' : '刷新'}</span>
              </button>
            </>
          }
        />

        {/* ===========================================================
             筛选卡片 —— 移动端默认折叠，避免挤占事件流首屏空间
             =========================================================== */}
        <div className={cn(activityPanelClass, 'space-y-3 md:space-y-4')}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 md:grid-cols-12 md:gap-3">
            <div className="relative md:col-span-5">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索标题或描述"
                aria-label="关键词搜索"
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
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  aria-label="清空搜索"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--ink-primary)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setMobileFiltersOpen((value) => !value)}
              className={cn(
                'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold md:hidden',
                'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] text-[var(--ink-secondary)]',
                'transition-[background-color,border-color,color,box-shadow] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
                'active:scale-[0.98]',
                mobileFiltersOpen || activeFilterCount > 0
                  ? 'border-[color-mix(in_oklch,var(--aurora-1)_32%,transparent)] text-[var(--ink-primary)] shadow-[0_0_0_2px_color-mix(in_oklch,var(--aurora-1)_12%,transparent)]'
                  : 'hover:border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)]'
              )}
              aria-expanded={mobileFiltersOpen}
              aria-label={mobileFiltersOpen ? '收起筛选项' : '展开筛选项'}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span>筛选</span>
              {activeFilterCount > 0 && (
                <span className="tnum inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] px-1.5 text-[11px] text-[var(--aurora-1)]">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', mobileFiltersOpen && 'rotate-180')} />
            </button>

            <div className="hidden md:col-span-4 md:block">
              <DateRangePicker
                value={dateRange}
                onChange={setDateRange}
                placeholder="选择时间范围"
                ariaLabel="时间范围筛选"
              />
            </div>

            <div className="hidden md:col-span-3 md:block">
              <Select
                value={selectedEventType}
                onValueChange={setSelectedEventType}
                options={eventTypeSelectOptions}
                placeholder="所有事件类型"
                prefix={<TagIcon />}
                ariaLabel="事件类型"
              />
            </div>
          </div>

          <div
            className={cn(
              'grid transition-[grid-template-rows,opacity,transform] duration-200 ease-[var(--ease-out)] md:hidden',
              mobileFiltersOpen
                ? 'grid-rows-[1fr] translate-y-0 opacity-100'
                : 'pointer-events-none grid-rows-[0fr] -translate-y-1 opacity-0'
            )}
            aria-hidden={!mobileFiltersOpen}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-2">
                  <DateRangePicker
                    value={dateRange}
                    onChange={setDateRange}
                    placeholder="选择时间范围"
                    ariaLabel="时间范围筛选"
                  />
                  <Select
                    value={selectedEventType}
                    onValueChange={setSelectedEventType}
                    options={eventTypeSelectOptions}
                    placeholder="所有事件类型"
                    prefix={<TagIcon />}
                    ariaLabel="事件类型"
                  />
                </div>

                <div className="space-y-2 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--bg-leaf)_72%,transparent)] p-2.5">
                  <div className="flex min-w-0 items-center gap-2" role="group" aria-label="分类筛选">
                    <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                      <Layers className="h-3.5 w-3.5" />
                      <span className="sr-only">分类</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedCategory('all')}
                      className={categoryChipClass(selectedCategory === 'all')}
                      aria-pressed={selectedCategory === 'all'}
                    >
                      全部
                    </button>
                    <div className="h-5 w-px shrink-0 bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]" aria-hidden />
                    <div
                      className="no-scrollbar my-[-4px] min-w-0 flex-1 overflow-x-auto overscroll-x-contain py-1 touch-pan-x [scrollbar-width:none] [-webkit-mask-image:linear-gradient(to_right,black_0,black_calc(100%-20px),transparent_100%)] [mask-image:linear-gradient(to_right,black_0,black_calc(100%-20px),transparent_100%)]"
                      style={{ WebkitOverflowScrolling: 'touch' }}
                    >
                      <div className="flex flex-nowrap items-center gap-1.5 pr-5">
                        {categories.filter((c): c is ActivityCategoryKey => c !== 'all').map((cat) => {
                          const config = activityCategoryConfig[cat];
                          const isSelected = selectedCategory === cat;
                          const Icon = config.icon;
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => setSelectedCategory(cat)}
                              className={categoryChipClass(isSelected)}
                              aria-pressed={isSelected}
                            >
                              <Icon
                                className="h-3.5 w-3.5"
                                style={{ color: isSelected ? config.tone : 'var(--ink-muted)' }}
                              />
                              {config.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                      <ActivityIcon className="h-3.5 w-3.5" />
                      <span className="sr-only">状态</span>
                    </div>
                    <div className="no-scrollbar min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
                      <div className="inline-flex items-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] p-0.5">
                        {statuses.map((s) => {
                          const isSelected = selectedStatus === s;
                          const cfg = s === 'all' ? null : activityStatusConfig[s];
                          return (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setSelectedStatus(s)}
                              className={cn(
                                'h-7 rounded-full px-3 text-xs font-medium',
                                'transition-[background-color,color,box-shadow] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
                                isSelected
                                  ? 'bg-[var(--bg-leaf)] text-[var(--ink-primary)] shadow-[0_1px_2px_color-mix(in_oklch,var(--ink-primary)_8%,transparent)]'
                                  : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]'
                              )}
                            >
                              {s === 'all' ? '全部' : cfg?.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="hidden min-w-0 items-center gap-2 md:flex" role="group" aria-label="分类筛选">
            <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
              <Layers className="h-3.5 w-3.5" />
              <span>分类</span>
            </div>

            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={categoryChipClass(selectedCategory === 'all')}
              aria-pressed={selectedCategory === 'all'}
            >
              全部
            </button>

            <div className="h-5 w-px shrink-0 bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]" aria-hidden />

            <div
              className="no-scrollbar my-[-4px] min-w-0 flex-1 overflow-x-auto overscroll-x-contain py-1 touch-pan-x [scrollbar-width:none] [-webkit-mask-image:linear-gradient(to_right,black_0,black_calc(100%-20px),transparent_100%)] [mask-image:linear-gradient(to_right,black_0,black_calc(100%-20px),transparent_100%)]"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              <div className="flex flex-nowrap items-center gap-1.5 pr-5">
                {categories.filter((c): c is ActivityCategoryKey => c !== 'all').map((cat) => {
                  const config = activityCategoryConfig[cat];
                  const isSelected = selectedCategory === cat;
                  const Icon = config.icon;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={categoryChipClass(isSelected)}
                      aria-pressed={isSelected}
                    >
                      <Icon
                        className="h-3.5 w-3.5"
                        style={{ color: isSelected ? config.tone : 'var(--ink-muted)' }}
                      />
                      {config.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="hidden flex-wrap items-center gap-2 md:flex">
            <div className="flex min-w-[60px] items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
              <ActivityIcon className="h-3.5 w-3.5" />
              <span>状态</span>
            </div>
            <div className="inline-flex items-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] p-0.5">
              {statuses.map((s) => {
                const isSelected = selectedStatus === s;
                const cfg = s === 'all' ? null : activityStatusConfig[s];
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSelectedStatus(s)}
                    className={cn(
                      'h-7 rounded-full px-3 text-xs font-medium',
                      'transition-[background-color,color,box-shadow] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
                      isSelected
                        ? 'bg-[var(--bg-leaf)] text-[var(--ink-primary)] shadow-[0_1px_2px_color-mix(in_oklch,var(--ink-primary)_8%,transparent)]'
                        : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]'
                    )}
                  >
                    {s === 'all' ? '全部' : cfg?.label}
                  </button>
                );
              })}
            </div>
          </div>

          <AnimatePresence initial={false}>
            {activeFilterCount > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
                animate={{ opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' } }}
                exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-center gap-2 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] pb-0.5 pt-2 md:flex-wrap md:pt-3">
                  <span className="tnum shrink-0 text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    已应用 {activeFilterCount}
                  </span>
                  <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 md:flex-wrap md:overflow-visible md:py-0">
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
                          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] pl-2.5 pr-1 text-xs"
                        >
                          <Icon className="h-3 w-3 shrink-0 text-[var(--aurora-1)]" />
                          <span className="font-mono text-[var(--ink-muted)]">{chip.label}</span>
                          <span className="max-w-[140px] truncate font-medium text-[var(--ink-primary)] md:max-w-[180px]">
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
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-mono uppercase tracking-[0.12em] text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] hover:text-[var(--signal-danger)]"
                  >
                    <X className="h-3 w-3" />
                    <span className="hidden sm:inline">全部清空</span>
                    <span className="sm:hidden">清空</span>
                  </button>
                </div>
                <div className="mt-1.5 text-xs text-[var(--ink-muted)] md:mt-2">
                  匹配 <span className="tnum font-medium text-[var(--ink-primary)]">{total}</span> 条记录
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 活动列表 */}
        <div className={cn(activityShellClass, 'relative')} data-refreshing={listRefreshing}>
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
            icon={<ActivityIcon className="h-4 w-4" />}
            title="事件流"
            description="按时间倒序记录系统操作与安全状态"
            aside={<AdminSectionCount>{isLoading ? '加载中' : listRefreshing ? '刷新中' : `${activities.length}/${total}`}</AdminSectionCount>}
          />

        {isLoading ? (
          <div className="p-8 space-y-4">
            {[...Array(Math.min(pageSize, 10))].map((_, i) => (
              <div key={i} className="flex animate-pulse items-start gap-4">
                <div className="h-11 w-11 rounded-2xl bg-[var(--bg-secondary)]" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-[var(--bg-secondary)]" />
                  <div className="h-3 w-1/2 rounded bg-[var(--bg-secondary)]" />
                </div>
              </div>
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className="py-16 text-center">
            <Clock className="mx-auto mb-4 h-16 w-16 text-[var(--ink-muted)] opacity-50" />
            <p className="text-[var(--ink-secondary)]">
              {activeFilterCount > 0 ? '当前筛选条件下暂无活动记录' : '暂无活动记录'}
            </p>
            {activeFilterCount > 0 && (
              <button
                onClick={resetFilters}
                className="mt-3 text-sm font-semibold text-[var(--aurora-1)] hover:underline"
              >
                清空筛选条件
              </button>
            )}
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={`${selectedCategory}-${selectedStatus}-${selectedEventType}-${debouncedSearch}-${dateRange.startTime}-${dateRange.endTime}-${pageNum}-${pageSize}-${refreshPulse}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: listRefreshing ? 0.62 : 1, y: listRefreshing ? 2 : 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="divide-y divide-[var(--border-subtle)]"
            >
              {activities.map((item, index) => {
                const visual = getActivityVisual(item.eventCategory, item.status);
                const Icon = visual.icon;
                const statusCfg = getActivityStatusConfig(item.status);

                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className="group p-4 transition-colors hover:bg-[var(--bg-card-hover)]"
                  >
                    <div className="flex items-start gap-4">
                      {/* 图标 */}
                      <div
                        className={cn(
                          'w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0',
                          'border bg-[color-mix(in_oklch,var(--activity-tone)_12%,transparent)]',
                          'border-[color-mix(in_oklch,var(--activity-tone)_30%,transparent)]',
                          'text-[var(--activity-tone)] shadow-[inset_0_1px_0_color-mix(in_oklch,var(--activity-tone)_18%,transparent)]',
                          'transition-transform duration-200 group-hover:scale-[1.03]'
                        )}
                        style={activityToneStyle(visual.tone)}
                        data-activity-icon
                        data-category={item.eventCategory}
                        data-status={item.status}
                      >
                        <Icon className="w-5 h-5" />
                      </div>

                      {/* 内容 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-[var(--ink-primary)]">{item.title}</p>
                            {item.description && (
                              <p className="mt-1 line-clamp-2 text-sm text-[var(--ink-secondary)]">
                                {item.description}
                              </p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--ink-muted)]">
                              <span className="font-mono text-[var(--ink-muted)]">{item.eventType}</span>
                              {item.user && (
                                <span>
                                  操作者: <span className="text-[var(--ink-secondary)]">{item.user.nickname || item.user.username}</span>
                                </span>
                              )}
                              {item.ip && (
                                <span>IP: {item.ip}</span>
                              )}
                              <span
                                className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium"
                                style={activityStatusPillStyle(statusCfg.tone)}
                              >
                                {statusCfg.label}
                              </span>
                            </div>
                          </div>

                          {/* 时间 */}
                          <div className="flex flex-shrink-0 items-center gap-1.5 text-xs text-[var(--ink-muted)]">
                            <Clock className="h-3 w-3" />
                            <span>
                              {formatDistanceToNow(new Date(item.createdAt), {
                                addSuffix: true,
                                locale: zhCN
                              })}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          </AnimatePresence>
        )}

          {(total > 0 || totalPages > 1) && (
            <AdminPagination
              page={pageNum}
              total={total}
              totalPages={totalPages}
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageChange={setPageNum}
              onPageSizeChange={handlePageSizeChange}
            />
          )}
      </div>
      </div>
    </div>
  );
}
