import {
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type CSSProperties,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Ban,
  Check,
  Clock,
  ExternalLink,
  Flag,
  Hash,
  Heart,
  Mail,
  MessageSquare,
  RefreshCw,
  Reply,
  RotateCcw,
  Search as SearchIcon,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useDebounce } from '@aetherblog/hooks';
import { cn, formatDateTime } from '@/lib/utils';
import { toast } from 'sonner';
import { commentService, Comment, CommentStatus } from '@/services/commentService';
import { logger } from '@/lib/logger';
import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { AdminPagination } from '@/components/common/AdminPagination';

type UIStatus = 'all' | 'pending' | 'approved' | 'rejected' | 'spam' | 'deleted';
type CommentStatusFilter = Exclude<UIStatus, 'all'>;

type CommentStatusVisual = {
  label: string;
  description: string;
  tone: string;
  icon: ComponentType<{ className?: string }>;
};

const COMMENT_STATUSES: UIStatus[] = ['all', 'pending', 'approved', 'rejected', 'spam', 'deleted'];
const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 200];

const statusConfig: Record<CommentStatusFilter, CommentStatusVisual> = {
  pending: {
    label: '待审核',
    description: '需要处理的新增评论',
    tone: 'var(--signal-warn, #f59e0b)',
    icon: Clock,
  },
  approved: {
    label: '已通过',
    description: '已公开展示的评论',
    tone: 'var(--signal-success, #22c55e)',
    icon: Check,
  },
  rejected: {
    label: '已拒绝',
    description: '审核拒绝但仍可恢复',
    tone: 'var(--signal-danger, #ef4444)',
    icon: Ban,
  },
  spam: {
    label: '垃圾评论',
    description: '已标记为垃圾内容',
    tone: 'oklch(0.58 0.18 25)',
    icon: Flag,
  },
  deleted: {
    label: '已删除',
    description: '已移入回收站',
    tone: 'oklch(0.52 0.03 255)',
    icon: Trash2,
  },
};

const commentPanelClass = cn(
  'access-surface surface-leaf surface-admin-panel rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'p-3 shadow-sm sm:p-4'
);

const commentShellClass = cn(
  'access-surface overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'bg-[var(--bg-leaf)] shadow-[0_18px_48px_-42px_rgba(0,0,0,0.45)]'
);

const mockComments: Comment[] = [
  {
    id: 1,
    nickname: '张三',
    email: 'zhangsan@example.com',
    content: '这篇文章写得太棒了！对虚拟线程的原理讲解非常清晰，学到了很多。期待更多这样的深度技术文章！',
    status: CommentStatus.PENDING,
    createdAt: '2026-01-10T10:30:00Z',
    updatedAt: '2026-01-10T10:30:00Z',
    likeCount: 12,
    isAdmin: false,
    post: { id: 1, title: '深入理解JVM虚拟线程', slug: 'jvm-virtual-threads' },
  },
  {
    id: 2,
    nickname: '李四',
    email: 'lisi@example.com',
    content: '请问虚拟线程和协程有什么区别？能否详细说明一下？',
    status: CommentStatus.REJECTED,
    createdAt: '2026-01-10T11:00:00Z',
    updatedAt: '2026-01-10T11:00:00Z',
    likeCount: 5,
    isAdmin: false,
    post: { id: 1, title: '深入理解JVM虚拟线程', slug: 'jvm-virtual-threads' },
  },
  {
    id: 3,
    nickname: '王五',
    email: 'wangwu@example.com',
    content: '感谢分享，这正是我在找的资料！',
    status: CommentStatus.APPROVED,
    createdAt: '2026-01-09T14:20:00Z',
    updatedAt: '2026-01-09T14:20:00Z',
    likeCount: 8,
    isAdmin: false,
    post: { id: 2, title: 'Spring Boot 3.0 新特性详解', slug: 'spring-boot-3-features' },
  },
  {
    id: 4,
    nickname: 'spammer123',
    email: 'spam@spam.com',
    content: '免费领取优惠券，点击链接...',
    status: CommentStatus.SPAM,
    createdAt: '2026-01-09T08:00:00Z',
    updatedAt: '2026-01-09T08:00:00Z',
    likeCount: 0,
    isAdmin: false,
    post: { id: 3, title: 'React 19 深度解析', slug: 'react-19-deep-dive' },
  },
];

function getStatusKey(status: CommentStatus | string): CommentStatusFilter {
  const key = String(status).toLowerCase() as CommentStatusFilter;
  return statusConfig[key] ? key : 'pending';
}

function commentToneStyle(tone: string): CSSProperties {
  return {
    '--comment-tone': tone,
  } as CSSProperties;
}

function commentPillStyle(tone: string): CSSProperties {
  return {
    color: tone,
    background: `color-mix(in oklch, ${tone} 12%, transparent)`,
    borderColor: `color-mix(in oklch, ${tone} 26%, transparent)`,
  };
}

function statusChipClass(isSelected: boolean): string {
  return cn(
    'relative z-0 inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-xs font-medium',
    'transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)]',
    isSelected
      ? 'text-[var(--ink-primary)]'
      : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]'
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

function actionButtonClass(tone: 'success' | 'danger' | 'warning' | 'info' | 'neutral'): string {
  const toneClass = {
    success: 'hover:border-[color-mix(in_oklch,var(--signal-success)_30%,transparent)] hover:bg-[color-mix(in_oklch,var(--signal-success)_10%,transparent)] hover:text-[var(--signal-success)]',
    danger: 'hover:border-[color-mix(in_oklch,var(--signal-danger)_30%,transparent)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] hover:text-[var(--signal-danger)]',
    warning: 'hover:border-[color-mix(in_oklch,var(--signal-warn)_30%,transparent)] hover:bg-[color-mix(in_oklch,var(--signal-warn)_10%,transparent)] hover:text-[var(--signal-warn)]',
    info: 'hover:border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] hover:text-[var(--aurora-1)]',
    neutral: 'hover:border-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] hover:text-[var(--ink-primary)]',
  }[tone];

  return cn(
    'inline-flex h-8 items-center gap-1.5 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
    'bg-[var(--bg-leaf)] px-3 text-xs font-semibold text-[var(--ink-secondary)] transition-colors touch-manipulation',
    toneClass
  );
}

function formatCommentDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return formatDistanceToNow(date, { addSuffix: true, locale: zhCN });
}

function formatAbsoluteDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return formatDateTime(dateStr);
}

function matchesCommentSearch(comment: Comment, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    comment.content,
    comment.nickname,
    comment.email,
    comment.post?.title,
  ].some((value) => (value ?? '').toLowerCase().includes(q));
}

export default function CommentsPage() {
  const [selectedStatus, setSelectedStatus] = useState<UIStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [refreshPulse, setRefreshPulse] = useState(0);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const debouncedSearch = useDebounce(searchQuery.trim(), 250);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const listRefreshing = manualRefreshing && !loading;

  const fetchComments = useCallback(async ({ preserveList = false }: { preserveList?: boolean } = {}) => {
    try {
      if (preserveList) {
        setManualRefreshing(true);
      } else {
        setLoading(true);
      }

      const status = selectedStatus === 'all'
        ? undefined
        : (selectedStatus.toUpperCase() as CommentStatus);
      const res = await commentService.listAll(status, pageNum, pageSize, debouncedSearch || undefined);

      if (res.code === 200 && res.data) {
        setComments(res.data.list);
        setTotal(res.data.total);
      } else {
        const mockFiltered = mockComments.filter(
          (c) => (status === undefined || c.status === status) && matchesCommentSearch(c, debouncedSearch)
        );
        setComments(mockFiltered);
        setTotal(mockFiltered.length);
      }
    } catch (error) {
      logger.error('Failed to fetch comments:', error);
      const status = selectedStatus === 'all'
        ? undefined
        : (selectedStatus.toUpperCase() as CommentStatus);
      const mockFiltered = mockComments.filter(
        (c) => (status === undefined || c.status === status) && matchesCommentSearch(c, debouncedSearch)
      );
      setComments(mockFiltered);
      setTotal(mockFiltered.length);
    } finally {
      if (preserveList) {
        window.setTimeout(() => setManualRefreshing(false), 260);
      } else {
        setLoading(false);
      }
    }
  }, [debouncedSearch, pageNum, pageSize, selectedStatus]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  useEffect(() => {
    if (pageNum > totalPages) {
      setPageNum(totalPages);
    }
  }, [pageNum, totalPages]);

  useEffect(() => {
    setPageNum(1);
  }, [debouncedSearch]);

  const handleRefresh = async () => {
    if (manualRefreshing) return;
    setRefreshPulse((value) => value + 1);
    await fetchComments({ preserveList: true });
  };

  const handleStatusChange = (status: UIStatus) => {
    setSelectedStatus(status);
    setPageNum(1);
  };

  const handlePageSizeChange = (nextSize: number) => {
    if (!PAGE_SIZE_OPTIONS.includes(nextSize) || nextSize === pageSize) return;
    setPageSize(nextSize);
    setPageNum(1);
  };

  const handleSearchChange = (nextValue: string) => {
    setSearchQuery(nextValue);
    setPageNum(1);
  };

  const handleToggleReply = (id: number) => {
    if (replyingTo === id) {
      setReplyingTo(null);
      setReplyContent('');
      return;
    }
    setReplyingTo(id);
    setReplyContent('');
  };

  const handleApprove = async (id: number) => {
    try {
      const res = await commentService.approve(id);
      if (res.code === 200) {
        toast.success('评论已通过');
        fetchComments({ preserveList: true });
      }
    } catch (error) {
      setComments(prev => prev.map(c => c.id === id ? { ...c, status: CommentStatus.APPROVED } : c));
      toast.success('评论已通过 (演示模式)');
    }
  };

  const handleReject = async (id: number) => {
    try {
      const res = await commentService.reject(id);
      if (res.code === 200) {
        toast.success('评论已拒绝');
        fetchComments({ preserveList: true });
      }
    } catch (error) {
      setComments(prev => prev.map(c => c.id === id ? { ...c, status: CommentStatus.REJECTED } : c));
      toast.success('评论已拒绝 (演示模式)');
    }
  };

  const handleMarkSpam = async (id: number) => {
    try {
      const res = await commentService.markAsSpam(id);
      if (res.code === 200) {
        toast.success('已标记为垃圾评论');
        fetchComments({ preserveList: true });
      }
    } catch (error) {
      setComments(prev => prev.map(c => c.id === id ? { ...c, status: CommentStatus.SPAM } : c));
      toast.success('已标记为垃圾评论 (演示模式)');
    }
  };

  const handleRestore = async (id: number) => {
    try {
      const res = await commentService.restore(id);
      if (res.code === 200) {
        toast.success('评论已还原');
        fetchComments({ preserveList: true });
      }
    } catch (error) {
      setComments(prev => prev.map(c => c.id === id ? { ...c, status: CommentStatus.PENDING } : c));
      toast.success('评论已还原 (演示模式)');
    }
  };

  const handleDelete = async (id: number, isPermanent: boolean) => {
    try {
      if (isPermanent) {
        const res = await commentService.permanentDelete(id);
        if (res.code === 200) {
          toast.success('评论已彻底删除');
          fetchComments({ preserveList: true });
        }
      } else {
        const res = await commentService.delete(id);
        if (res.code === 200) {
          toast.success('评论已移至回收站');
          fetchComments({ preserveList: true });
        }
      }
    } catch (error) {
      if (isPermanent) {
        setComments(prev => prev.filter(c => c.id !== id));
        toast.success('评论已彻底删除 (演示模式)');
      } else {
        setComments(prev => prev.map(c => c.id === id ? { ...c, status: CommentStatus.DELETED } : c));
        toast.success('评论已移至回收站 (演示模式)');
      }
    }
  };

  const handleReply = async (id: number) => {
    const content = replyContent.trim();
    if (!content) return;
    try {
      const res = await commentService.reply(id, content);
      if (res.code === 200) {
        toast.success('回复已发送');
        setReplyingTo(null);
        setReplyContent('');
        fetchComments({ preserveList: true });
        return;
      }
      toast.error(res.message || '回复失败');
    } catch (error) {
      toast.error('回复失败');
    }
  };

  type ActiveChip = {
    key: string;
    icon: ComponentType<{ className?: string }>;
    label: string;
    value: string;
    onRemove: () => void;
  };

  const activeChips: ActiveChip[] = [];
  if (selectedStatus !== 'all') {
    const cfg = statusConfig[selectedStatus];
    activeChips.push({
      key: 'status',
      icon: cfg.icon,
      label: '状态',
      value: cfg.label,
      onRemove: () => handleStatusChange('all'),
    });
  }
  if (debouncedSearch) {
    activeChips.push({
      key: 'search',
      icon: SearchIcon,
      label: '关键词',
      value: debouncedSearch,
      onRemove: () => handleSearchChange(''),
    });
  }

  const activeFilterCount = activeChips.length;

  const resetFilters = () => {
    setSelectedStatus('all');
    setSearchQuery('');
    setPageNum(1);
  };

  return (
    <div className="admin-grid-page -m-4 min-h-[calc(100%+2rem)] overflow-hidden p-4 text-[var(--ink-primary)] md:-m-6 md:min-h-[calc(100%+3rem)] md:p-6">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-0 py-2 sm:gap-4 sm:px-6 sm:py-4 lg:px-8">
        <AdminModuleHeader
          title="评论管理"
          description="集中审核、回复与清理文章评论，保持内容互动质量。"
          icon={MessageSquare}
          currentLabel={listRefreshing ? '同步中' : '审核队列'}
          activeSummary={`当前匹配 ${total} 条评论，第 ${pageNum}/${totalPages} 页`}
          actions={
            <button
              type="button"
              onClick={handleRefresh}
              disabled={manualRefreshing}
              className="admin-module-action-button"
              title={listRefreshing ? '正在刷新' : '刷新'}
              aria-label="刷新评论列表"
              aria-busy={listRefreshing}
            >
              <RefreshCw className={cn('h-4 w-4', listRefreshing && 'animate-spin')} />
              {listRefreshing ? '刷新中' : '刷新'}
            </button>
          }
        />

        <div className={cn(commentPanelClass, 'space-y-4')}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="relative md:col-span-12">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="搜索评论内容、昵称、邮箱或文章标题"
                aria-label="评论关键词搜索"
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
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-[60px] items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
              <MessageSquare className="h-3.5 w-3.5" />
              <span>状态</span>
            </div>
            <div className="inline-flex max-w-full items-center overflow-x-auto rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] p-0.5">
              {COMMENT_STATUSES.map((status) => {
                const isSelected = selectedStatus === status;
                const cfg = status === 'all' ? null : statusConfig[status];
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => handleStatusChange(status)}
                    className={statusChipClass(isSelected)}
                    title={cfg?.description}
                  >
                    {isSelected && <SegmentThumb layoutId="comment-status-segment-thumb" />}
                    <span className="relative z-10">{status === 'all' ? '全部' : cfg?.label}</span>
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
                  匹配 <span className="tnum font-medium text-[var(--ink-primary)]">{total}</span> 条评论
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className={cn(commentShellClass, 'relative')} data-refreshing={listRefreshing}>
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

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ink-primary)] text-[var(--bg-void)]">
                <MessageSquare className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-[var(--ink-primary)]">评论队列</p>
                <p className="text-xs text-[var(--ink-muted)]">按时间倒序处理审核、回复与清理动作</p>
              </div>
            </div>
            <span className="rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-muted)]">
              {loading ? '加载中' : listRefreshing ? '刷新中' : `${comments.length}/${total}`}
            </span>
          </div>

          {loading ? (
            <div className="space-y-4 p-8">
              {[...Array(Math.min(pageSize, 10))].map((_, i) => (
                <div key={i} className="flex animate-pulse items-start gap-4">
                  <div className="h-11 w-11 rounded-2xl bg-[var(--bg-secondary)]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-[var(--bg-secondary)]" />
                    <div className="h-3 w-1/2 rounded bg-[var(--bg-secondary)]" />
                    <div className="h-14 rounded bg-[var(--bg-secondary)]" />
                  </div>
                </div>
              ))}
            </div>
          ) : comments.length === 0 ? (
            <div className="py-16 text-center">
              <AlertCircle className="mx-auto mb-4 h-16 w-16 text-[var(--ink-muted)] opacity-50" />
              <p className="text-[var(--ink-secondary)]">
                {activeFilterCount > 0 ? '当前筛选条件下暂无评论' : '暂无评论'}
              </p>
              {activeFilterCount > 0 && (
                <button
                  type="button"
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
                key={`${selectedStatus}-${debouncedSearch}-${pageNum}-${pageSize}-${refreshPulse}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: listRefreshing ? 0.62 : 1, y: listRefreshing ? 2 : 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="divide-y divide-[var(--border-subtle)]"
              >
                {comments.map((comment, index) => {
                  const statusKey = getStatusKey(comment.status);
                  const config = statusConfig[statusKey];
                  const StatusIcon = config.icon;
                  const isPending = comment.status === CommentStatus.PENDING;
                  const isApproved = comment.status === CommentStatus.APPROVED;
                  const isRejected = comment.status === CommentStatus.REJECTED;
                  const isDeleted = comment.status === CommentStatus.DELETED;
                  const isSpam = comment.status === CommentStatus.SPAM;

                  return (
                    <motion.div
                      key={comment.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      className="group p-4 transition-colors hover:bg-[var(--bg-card-hover)] sm:p-5"
                    >
                      <div className="flex items-start gap-4">
                        <div
                          className={cn(
                            'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border',
                            'border-[color-mix(in_oklch,var(--comment-tone)_30%,transparent)] bg-[color-mix(in_oklch,var(--comment-tone)_12%,transparent)]',
                            'text-[var(--comment-tone)] shadow-[inset_0_1px_0_color-mix(in_oklch,var(--comment-tone)_18%,transparent)]',
                            'transition-transform duration-200 group-hover:scale-[1.03]'
                          )}
                          style={commentToneStyle(config.tone)}
                          data-comment-icon
                          data-status={comment.status}
                        >
                          <StatusIcon className="h-5 w-5" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-semibold text-[var(--ink-primary)]">{comment.nickname}</p>
                                {comment.isAdmin && (
                                  <span className="rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--aurora-1)]">
                                    Admin
                                  </span>
                                )}
                                <span
                                  className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium"
                                  style={commentPillStyle(config.tone)}
                                >
                                  <StatusIcon className="h-3 w-3" />
                                  {config.label}
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
                                <span className="inline-flex items-center gap-1">
                                  <Mail className="h-3 w-3" />
                                  {comment.email}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <Hash className="h-3 w-3" />
                                  {comment.id}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <Heart className="h-3 w-3" />
                                  {comment.likeCount}
                                </span>
                                {comment.parent && (
                                  <span className="inline-flex items-center gap-1">
                                    <Reply className="h-3 w-3" />
                                    回复 @{comment.parent.nickname}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div
                              className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--ink-muted)]"
                              title={formatAbsoluteDate(comment.createdAt)}
                            >
                              <Clock className="h-3 w-3" />
                              <span>{formatCommentDate(comment.createdAt)}</span>
                            </div>
                          </div>

                          {comment.post && (
                            <a
                              href={`/posts/${comment.post.slug}`}
                              className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--ink-secondary)] transition-colors hover:border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] hover:text-[var(--aurora-1)]"
                            >
                              <MessageSquare className="h-3 w-3 shrink-0" />
                              <span className="truncate">Re: {comment.post.title}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          )}

                          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--ink-primary)]">
                            {comment.content}
                          </p>

                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            {isPending && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleApprove(comment.id)}
                                  className={actionButtonClass('success')}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  通过
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleReject(comment.id)}
                                  className={actionButtonClass('danger')}
                                >
                                  <X className="h-3.5 w-3.5" />
                                  拒绝
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMarkSpam(comment.id)}
                                  className={actionButtonClass('warning')}
                                >
                                  <Flag className="h-3.5 w-3.5" />
                                  垃圾
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(comment.id, false)}
                                  className={actionButtonClass('neutral')}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  删除
                                </button>
                              </>
                            )}

                            {isApproved && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleToggleReply(comment.id)}
                                  className={actionButtonClass('info')}
                                >
                                  <Reply className="h-3.5 w-3.5" />
                                  回复
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMarkSpam(comment.id)}
                                  className={actionButtonClass('warning')}
                                >
                                  <Flag className="h-3.5 w-3.5" />
                                  垃圾
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(comment.id, false)}
                                  className={actionButtonClass('neutral')}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  删除
                                </button>
                              </>
                            )}

                            {(isRejected || isDeleted) && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleRestore(comment.id)}
                                  className={actionButtonClass('info')}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  还原
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(comment.id, true)}
                                  className={actionButtonClass('danger')}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  彻底删除
                                </button>
                              </>
                            )}

                            {isSpam && (
                              <button
                                type="button"
                                onClick={() => handleDelete(comment.id, true)}
                                className={actionButtonClass('danger')}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                彻底删除
                              </button>
                            )}
                          </div>

                          <AnimatePresence>
                            {replyingTo === comment.id && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                                className="overflow-hidden"
                              >
                                <div className="mt-4 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] pt-4">
                                  <textarea
                                    value={replyContent}
                                    onChange={(e) => setReplyContent(e.target.value)}
                                    placeholder="输入回复内容..."
                                    rows={3}
                                    className={cn(
                                      'w-full resize-none rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] p-3 text-sm',
                                      'text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)]',
                                      'focus:border-[color-mix(in_oklch,var(--aurora-1)_50%,transparent)] focus:outline-none',
                                      'focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--aurora-1)_18%,transparent)]'
                                    )}
                                  />
                                  <div className="mt-2 flex justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setReplyingTo(null);
                                        setReplyContent('');
                                      }}
                                      className={actionButtonClass('neutral')}
                                    >
                                      取消
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleReply(comment.id)}
                                      className={actionButtonClass('info')}
                                    >
                                      发送回复
                                    </button>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
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
