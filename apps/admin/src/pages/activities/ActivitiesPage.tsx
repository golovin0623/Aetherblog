import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  MessageSquare,
  User,
  Settings,
  Link as LinkIcon,
  Image as ImageIcon,
  Sparkles,
  Shield,
  AlertTriangle,
  Clock,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Search as SearchIcon,
  X,
  Layers,
  Activity as ActivityIcon,
  Tag as TagIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDebounce } from '@aetherblog/hooks';
import { Select, DateRangePicker, type DateRangeValue, type SelectOption } from '@aetherblog/ui';
import { formatDistanceToNow, format, parseISO, isValid } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { activityService, ActivityEvent, ActivityQueryParams } from '@/services/activityService';

/* -----------------------------------------------------------
 * 事件类别配置 —— 颜色与图标
 * 颜色用 token，避免 hard-code hex
 * ----------------------------------------------------------- */
const categoryConfig = {
  post:     { icon: FileText,      label: '文章',  bgColor: 'bg-status-info-light',    borderColor: 'border-status-info-border',    textColor: 'text-status-info' },
  comment:  { icon: MessageSquare, label: '评论',  bgColor: 'bg-status-success-light', borderColor: 'border-status-success-border', textColor: 'text-status-success' },
  user:     { icon: User,          label: '用户',  bgColor: 'bg-accent/10',            borderColor: 'border-accent/20',             textColor: 'text-accent' },
  system:   { icon: Settings,      label: '系统',  bgColor: 'bg-[var(--bg-tertiary)]', borderColor: 'border-[var(--border-default)]', textColor: 'text-[var(--text-muted)]' },
  friend:   { icon: LinkIcon,      label: '友链',  bgColor: 'bg-pink-500/10',          borderColor: 'border-pink-500/20',           textColor: 'text-pink-400' },
  media:    { icon: ImageIcon,     label: '媒体',  bgColor: 'bg-cyan-500/10',          borderColor: 'border-cyan-500/20',           textColor: 'text-cyan-400' },
  ai:       { icon: Sparkles,      label: 'AI',    bgColor: 'bg-primary/10',           borderColor: 'border-primary/20',            textColor: 'text-primary' },
  security: { icon: Shield,        label: '安全',  bgColor: 'bg-status-warning-light', borderColor: 'border-status-warning-border', textColor: 'text-status-warning' },
} as const;

type CategoryKey = keyof typeof categoryConfig;

const statusConfig = {
  INFO:    { label: '信息', color: 'text-[var(--text-muted)]', bgColor: 'bg-[var(--bg-tertiary)]' },
  SUCCESS: { label: '成功', color: 'text-status-success',      bgColor: 'bg-status-success-light' },
  WARNING: { label: '警告', color: 'text-status-warning',      bgColor: 'bg-status-warning-light' },
  ERROR:   { label: '错误', color: 'text-status-danger',       bgColor: 'bg-status-danger-light' },
} as const;

type StatusKey = keyof typeof statusConfig;

const categories: Array<'all' | CategoryKey> = [
  'all', 'post', 'comment', 'user', 'system', 'friend', 'media', 'ai', 'security',
];

const statuses: Array<'all' | StatusKey> = ['all', 'INFO', 'SUCCESS', 'WARNING', 'ERROR'];

/**
 * 各分类下的细分事件类型 —— 用于 category 选中后的二级 eventType 下拉。
 * 取值与后端 handler 中实际写入的 EventType 严格一致；
 * 新增事件类型时请同步追加，避免下拉框选中后查不到记录。
 */
const eventTypeOptions: Record<CategoryKey, Array<{ value: string; label: string }>> = {
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
    'shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-sm font-medium',
    'transition-[background-color,border-color,color,box-shadow] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
    'border',
    isSelected
      ? 'bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)] text-[var(--ink-primary)] shadow-[0_0_0_1px_color-mix(in_oklch,var(--aurora-1)_25%,transparent)]'
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

  const [selectedCategory, setSelectedCategory] = useState<'all' | CategoryKey>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | StatusKey>('all');
  const [selectedEventType, setSelectedEventType] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [dateRange, setDateRange] = useState<DateRangeValue>({ startTime: '', endTime: '' });
  const [pageNum, setPageNum] = useState(1);
  const pageSize = 20;

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
  }), [selectedCategory, selectedStatus, selectedEventType, debouncedSearch, dateRange.startTime, dateRange.endTime, pageNum]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['activities', queryParams],
    queryFn: async () => {
      const res = await activityService.getActivities(queryParams);
      return res.code === 200 ? res.data : { list: [], total: 0 };
    },
  });

  const activities = data?.list || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  /* -----------------------------------------------------------
   * 激活筛选可视化 —— 把所有非默认值收集为可单独移除的 chip
   * 这是当前 UI 与原版最大的差异：用户能"看见"自己开了什么。
   * ----------------------------------------------------------- */
  type ActiveChip = {
    key: string;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
    onRemove: () => void;
  };

  const activeChips: ActiveChip[] = [];
  if (selectedCategory !== 'all') {
    const cfg = categoryConfig[selectedCategory];
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
      value: statusConfig[selectedStatus].label,
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
  };

  const lookupCategory = (category: string): typeof categoryConfig.system => {
    const map = categoryConfig as unknown as Record<string, typeof categoryConfig.system>;
    return map[category] ?? categoryConfig.system;
  };

  const getIcon = (category: ActivityEvent['eventCategory'], status: string) => {
    if (status === 'WARNING' || status === 'ERROR') {
      return <AlertTriangle className={cn('w-5 h-5', status === 'WARNING' ? 'text-status-warning' : 'text-status-danger')} />;
    }
    const config = lookupCategory(category);
    const Icon = config.icon;
    return <Icon className={cn('w-5 h-5', config.textColor)} />;
  };

  const getColors = (category: ActivityEvent['eventCategory'], status: string) => {
    if (status === 'WARNING') return { bgColor: 'bg-status-warning-light', borderColor: 'border-status-warning-border' };
    if (status === 'ERROR')   return { bgColor: 'bg-status-danger-light',  borderColor: 'border-status-danger-border' };
    return lookupCategory(category);
  };

  // 当前分类下的事件类型 → Select 选项
  const eventTypeSelectOptions: SelectOption[] = useMemo(() => {
    if (selectedCategory === 'all') return [];
    return eventTypeOptions[selectedCategory].map((o) => ({
      value: o.value,
      label: o.label,
      description: o.value,
    }));
  }, [selectedCategory]);

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {fromDashboard && (
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
              title="返回仪表盘"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">活动记录</h1>
            <p className="text-[var(--text-secondary)] mt-1">查看系统中的所有活动事件</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
        >
          <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          刷新
        </button>
      </div>

      {/* ===========================================================
           筛选卡片 —— 三层结构（搜索行 / segmented 行 / 激活筛选行）
           =========================================================== */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-subtle)] p-4 space-y-4">
        {/* 行 1 · 主搜索 + 时间 + 事件类型 */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* 搜索栏 */}
          <div className="md:col-span-5 relative">
            <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)] pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索标题或描述"
              aria-label="关键词搜索"
              className={cn(
                'w-full h-10 pl-9 pr-9 rounded-lg text-sm',
                'bg-[var(--bg-leaf)] border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]',
                'text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)]',
                'transition-[border-color,box-shadow] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
                'hover:border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)]',
                'focus:outline-none focus:border-[color-mix(in_oklch,var(--aurora-1)_50%,transparent)]',
                'focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--aurora-1)_22%,transparent)]'
              )}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                aria-label="清空搜索"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 时间范围 */}
          <div className="md:col-span-4">
            <DateRangePicker
              value={dateRange}
              onChange={setDateRange}
              placeholder="选择时间范围"
              ariaLabel="时间范围筛选"
            />
          </div>

          {/* 事件类型 */}
          <div className="md:col-span-3">
            <Select
              value={selectedEventType}
              onValueChange={setSelectedEventType}
              options={eventTypeSelectOptions}
              placeholder={
                selectedCategory === 'all'
                  ? '先选择分类'
                  : eventTypeSelectOptions.length === 0
                    ? '该分类暂无细分'
                    : '所有事件类型'
              }
              disabled={selectedCategory === 'all' || eventTypeSelectOptions.length === 0}
              disabledHint={
                selectedCategory === 'all'
                  ? '先选择分类'
                  : eventTypeSelectOptions.length === 0
                    ? '该分类暂无细分'
                    : undefined
              }
              prefix={<TagIcon />}
              ariaLabel="事件类型"
            />
          </div>
        </div>

        {/* 行 2 · 分类 —— 「全部」固定在左，其余 chips 在一行内左右滚动 */}
        <div className="flex items-center gap-2 min-w-0" role="group" aria-label="分类筛选">
          <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)] shrink-0">
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">分类</span>
            <span className="sr-only sm:hidden">分类</span>
          </div>

          {/* 「全部」固定锚点 */}
          <button
            onClick={() => setSelectedCategory('all')}
            className={categoryChipClass(selectedCategory === 'all')}
          >
            全部
          </button>

          {/* 视觉分隔 */}
          <div className="shrink-0 w-px h-5 bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]" aria-hidden />

          {/* 其余分类 —— 单行横向滚动；右侧渐隐遮罩提示可滑动 */}
          <div
            className="flex-1 min-w-0 overflow-x-auto overscroll-x-contain no-scrollbar touch-pan-x [scrollbar-width:none] [-webkit-mask-image:linear-gradient(to_right,black_0,black_calc(100%-20px),transparent_100%)] [mask-image:linear-gradient(to_right,black_0,black_calc(100%-20px),transparent_100%)]"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            <div className="flex items-center gap-1.5 flex-nowrap pr-5">
              {categories.filter((c): c is CategoryKey => c !== 'all').map((cat) => {
                const config = categoryConfig[cat];
                const isSelected = selectedCategory === cat;
                const Icon = config.icon;
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={categoryChipClass(isSelected)}
                  >
                    <Icon className={cn('w-3.5 h-3.5', isSelected ? 'text-[var(--aurora-1)]' : 'text-[var(--ink-muted)]')} />
                    {config.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 行 3 · 状态 segmented chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)] min-w-[60px]">
            <ActivityIcon className="w-3.5 h-3.5" />
            <span>状态</span>
          </div>
          <div className="inline-flex items-center p-0.5 rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
            {statuses.map((s) => {
              const isSelected = selectedStatus === s;
              const cfg = s === 'all' ? null : statusConfig[s];
              return (
                <button
                  key={s}
                  onClick={() => setSelectedStatus(s)}
                  className={cn(
                    'h-7 px-3 rounded-full text-xs font-medium',
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

        {/* 行 4 · 已激活筛选 chips（条件渲染） */}
        <AnimatePresence initial={false}>
          {activeFilterCount > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
              animate={{ opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' } }}
              exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
              transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="pt-3 pb-0.5 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] flex items-center gap-2 flex-wrap">
                <span className="tnum text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
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
                        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
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
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-xs font-mono uppercase tracking-[0.12em] text-[var(--ink-muted)] hover:text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] transition-colors"
                >
                  <X className="w-3 h-3" />
                  全部清空
                </button>
              </div>
              <div className="mt-2 text-xs text-[var(--ink-muted)]">
                匹配 <span className="text-[var(--ink-primary)] font-medium tnum">{total}</span> 条记录
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 活动列表 */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
        {isLoading ? (
          <div className="p-8 space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-start gap-4 animate-pulse">
                <div className="w-10 h-10 rounded-full bg-[var(--bg-secondary)]" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 bg-[var(--bg-secondary)] rounded" />
                  <div className="h-3 w-1/2 bg-[var(--bg-secondary)] rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className="py-16 text-center">
            <Clock className="w-16 h-16 mx-auto text-[var(--text-muted)] opacity-50 mb-4" />
            <p className="text-[var(--text-secondary)]">
              {activeFilterCount > 0 ? '当前筛选条件下暂无活动记录' : '暂无活动记录'}
            </p>
            {activeFilterCount > 0 && (
              <button
                onClick={resetFilters}
                className="mt-3 text-sm text-primary hover:underline"
              >
                清空筛选条件
              </button>
            )}
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={`${selectedCategory}-${selectedStatus}-${selectedEventType}-${debouncedSearch}-${dateRange.startTime}-${dateRange.endTime}-${pageNum}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="divide-y divide-[var(--border-subtle)]"
            >
              {activities.map((item, index) => {
                const colors = getColors(item.eventCategory, item.status);
                const statusCfg = statusConfig[item.status];

                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className="p-4 hover:bg-[var(--bg-card-hover)] transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      {/* 图标 */}
                      <div className={cn(
                        'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0',
                        colors.bgColor,
                        'border',
                        colors.borderColor
                      )}>
                        {getIcon(item.eventCategory, item.status)}
                      </div>

                      {/* 内容 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-[var(--text-primary)] font-medium">{item.title}</p>
                            {item.description && (
                              <p className="text-sm text-[var(--text-secondary)] mt-1 line-clamp-2">
                                {item.description}
                              </p>
                            )}
                            <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-muted)] flex-wrap">
                              <span className="font-mono text-[var(--text-muted)]">{item.eventType}</span>
                              {item.user && (
                                <span>
                                  操作者: <span className="text-[var(--text-secondary)]">{item.user.nickname || item.user.username}</span>
                                </span>
                              )}
                              {item.ip && (
                                <span>IP: {item.ip}</span>
                              )}
                              <span className={cn('px-1.5 py-0.5 rounded text-xs', statusCfg.bgColor, statusCfg.color)}>
                                {statusCfg.label}
                              </span>
                            </div>
                          </div>

                          {/* 时间 */}
                          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] flex-shrink-0">
                            <Clock className="w-3 h-3" />
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
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-[var(--text-muted)]">
            共 {total} 条记录，第 {pageNum}/{totalPages} 页
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPageNum(p => Math.max(1, p - 1))}
              disabled={pageNum <= 1}
              className="p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-1 text-sm text-[var(--text-secondary)]">
              {pageNum}
            </span>
            <button
              onClick={() => setPageNum(p => Math.min(totalPages, p + 1))}
              disabled={pageNum >= totalPages}
              className="p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
