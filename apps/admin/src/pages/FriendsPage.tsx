import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowUpDown,
  Eye,
  EyeOff,
  Globe,
  Link2,
  Loader2,
  Mail,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Rss,
  Save,
  Search,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from '@aetherblog/hooks';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { cn, extractApiErrorMessage } from '@/lib/utils';
import { friendService, FriendLink } from '@/services/friendService';
import { toast } from 'sonner';
import { useMediaQuery } from '@/hooks';
import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { AdminSectionCount, AdminSectionHeader } from '@/components/layout/AdminSectionHeader';
import { AdminPagination } from '@/components/common/AdminPagination';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { SortableFriendItem } from './friends/components/SortableFriendItem';

const friendSchema = z.object({
  name: z.string().min(1, '请输入网站名称').max(50, '名称太长了'),
  url: z.string().min(1, '请输入网址').url('请输入有效的 URL (https://...)'),
  logo: z.string().url('请输入有效的图片 URL').optional().or(z.literal('')),
  description: z.string().max(200, '描述不能超过 200 字').optional(),
  email: z.string().email('请输入有效的邮箱').optional().or(z.literal('')),
  themeColor: z.string().optional(),
  rssUrl: z.string().url('请输入有效的 RSS URL').optional().or(z.literal('')),
});

type FriendFormData = z.infer<typeof friendSchema>;
type StatusFilter = 'all' | 'visible' | 'hidden' | 'offline' | 'rss';

type ActiveChip = {
  key: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  onRemove: () => void;
};

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 200];

const friendPanelClass = cn(
  'access-surface surface-leaf surface-admin-panel rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'p-3 shadow-sm sm:p-4'
);

const friendShellClass = cn(
  'access-surface overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'bg-[var(--bg-leaf)] shadow-[0_18px_48px_-42px_rgba(0,0,0,0.45)]'
);

const defaultFriendValues: FriendFormData = {
  name: '',
  url: '',
  description: '',
  logo: '',
  email: '',
  themeColor: '#6366f1',
  rssUrl: '',
};

function normalizeThemeColor(color?: string): string {
  if (!color) return '#6366f1';
  const trimmed = color.trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed) ? trimmed : '#6366f1';
}

function getHost(url?: string): string {
  if (!url) return '未设置 URL';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function statusChipClass(isSelected: boolean): string {
  return cn(
    'relative z-0 inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-medium',
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

export default function FriendsPage() {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [deleteTarget, setDeleteTarget] = useState<FriendLink | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const debouncedSearch = useDebounce(searchQuery.trim(), 250);

  const queryClient = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const { data: friends = [], isLoading, isFetching } = useQuery({
    queryKey: ['friends'],
    queryFn: () => friendService.getAll(),
  });

  const form = useForm<FriendFormData>({
    resolver: zodResolver(friendSchema),
    defaultValues: defaultFriendValues,
  });

  const stats = useMemo(() => {
    const visible = friends.filter((friend) => friend.visible).length;
    const hidden = friends.length - visible;
    const offline = friends.filter((friend) => friend.isOnline === false).length;
    const withRss = friends.filter((friend) => !!friend.rssUrl).length;
    return { total: friends.length, visible, hidden, offline, withRss };
  }, [friends]);

  const filteredFriends = useMemo(() => {
    const keyword = debouncedSearch.toLowerCase();
    return friends.filter((friend) => {
      const matchesKeyword = !keyword || [
        friend.name,
        friend.url,
        friend.description,
        friend.email,
        friend.rssUrl,
        getHost(friend.url),
      ].some((value) => value?.toLowerCase().includes(keyword));

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'visible' && friend.visible) ||
        (statusFilter === 'hidden' && !friend.visible) ||
        (statusFilter === 'offline' && friend.isOnline === false) ||
        (statusFilter === 'rss' && !!friend.rssUrl);

      return matchesKeyword && matchesStatus;
    });
  }, [friends, debouncedSearch, statusFilter]);

  const isReorderLocked = searchQuery.trim().length > 0 || statusFilter !== 'all';
  const total = filteredFriends.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageFriends = filteredFriends.slice((pageNum - 1) * pageSize, pageNum * pageSize);
  const listRefreshing = isFetching && !isLoading;

  useEffect(() => {
    setPageNum(1);
  }, [debouncedSearch, statusFilter]);

  useEffect(() => {
    if (pageNum > totalPages) {
      setPageNum(totalPages);
    }
  }, [pageNum, totalPages]);

  const saveMutation = useMutation({
    mutationFn: (data: FriendFormData) =>
      editingId
        ? friendService.update(editingId, data)
        : friendService.create({ ...data, visible: true, sortOrder: 0 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      toast.success(editingId ? '友链更新成功' : '友链添加成功');
      handleCloseForm();
    },
    onError: (error) => {
      toast.error(extractApiErrorMessage(error, '保存友链失败'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => friendService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      toast.success('友链已删除');
      setDeleteTarget(null);
    },
    onError: (error) => {
      toast.error(extractApiErrorMessage(error, '删除友链失败'));
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: number) => friendService.toggleVisible(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      toast.success('展示状态已更新');
    },
    onError: (error) => {
      toast.error(extractApiErrorMessage(error, '更新展示状态失败'));
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (ids: number[]) => friendService.reorder(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      toast.success('排序已保存');
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      toast.error(extractApiErrorMessage(error, '保存排序失败'));
    },
  });

  function openCreateForm() {
    setEditingId(null);
    form.reset(defaultFriendValues);
    setIsFormOpen(true);
  }

  function handleEdit(friend: FriendLink) {
    setEditingId(friend.id);
    form.reset({
      name: friend.name,
      url: friend.url,
      description: friend.description || '',
      logo: friend.logo || '',
      email: friend.email || '',
      themeColor: friend.themeColor || '#6366f1',
      rssUrl: friend.rssUrl || '',
    });
    setIsFormOpen(true);
  }

  function handleCloseForm() {
    setEditingId(null);
    setIsFormOpen(false);
    form.reset(defaultFriendValues);
  }

  function handleDragEnd(event: DragEndEvent) {
    if (isReorderLocked) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = friends.findIndex((friend) => friend.id === active.id);
    const newIndex = friends.findIndex((friend) => friend.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const newOrder = arrayMove(friends, oldIndex, newIndex);
    queryClient.setQueryData<FriendLink[]>(['friends'], newOrder);
    reorderMutation.mutate(newOrder.map((friend) => friend.id));
  }

  function handlePageSizeChange(nextSize: number) {
    if (!PAGE_SIZE_OPTIONS.includes(nextSize) || nextSize === pageSize) return;
    setPageSize(nextSize);
    setPageNum(1);
  }

  function resetFilters() {
    setSearchQuery('');
    setStatusFilter('all');
    setPageNum(1);
  }

  const previewName = form.watch('name') || '新朋友';
  const previewUrl = form.watch('url') || 'https://example.com';
  const previewLogo = form.watch('logo') || '';
  const previewColor = normalizeThemeColor(form.watch('themeColor'));

  const statusOptions: Array<{
    value: StatusFilter;
    label: string;
    count: number;
    icon: ComponentType<{ className?: string }>;
  }> = [
    { value: 'all', label: '全部', count: stats.total, icon: Link2 },
    { value: 'visible', label: '公开', count: stats.visible, icon: Eye },
    { value: 'hidden', label: '隐藏', count: stats.hidden, icon: EyeOff },
    { value: 'offline', label: '离线', count: stats.offline, icon: WifiOff },
    { value: 'rss', label: 'RSS', count: stats.withRss, icon: Rss },
  ];

  const activeChips: ActiveChip[] = [];
  if (statusFilter !== 'all') {
    const currentStatus = statusOptions.find((option) => option.value === statusFilter);
    if (currentStatus) {
      activeChips.push({
        key: 'status',
        icon: currentStatus.icon,
        label: '状态',
        value: currentStatus.label,
        onRemove: () => setStatusFilter('all'),
      });
    }
  }
  if (debouncedSearch) {
    activeChips.push({
      key: 'search',
      icon: Search,
      label: '关键词',
      value: debouncedSearch,
      onRemove: () => setSearchQuery(''),
    });
  }

  const activeFilterCount = activeChips.length;

  const formContent = (
    <div className="flex h-full flex-col">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
            {editingId ? 'EDIT FRIEND LINK' : 'NEW FRIEND LINK'}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
            {editingId ? '编辑友链' : '添加友链'}
          </h2>
        </div>
        <button
          type="button"
          onClick={handleCloseForm}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
          aria-label="关闭表单"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
        <div className="flex items-center gap-3">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-popover)]"
            style={{ boxShadow: `inset 4px 0 0 ${previewColor}` }}
          >
            {previewLogo ? (
              <img src={previewLogo} alt="" className="h-full w-full object-cover" />
            ) : (
              <Globe className="h-5 w-5 text-[var(--text-muted)]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{previewName}</p>
            <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{getHost(previewUrl)}</p>
          </div>
        </div>
      </div>

      <form onSubmit={form.handleSubmit((data) => saveMutation.mutate(data))} className="space-y-4">
        <FormField label="网站名称" required error={form.formState.errors.name?.message}>
          <input
            {...form.register('name')}
            className="h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] outline-none transition-all placeholder:text-[var(--text-muted)] focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            placeholder="例如: AetherBlog"
          />
        </FormField>

        <FormField label="网站地址" required error={form.formState.errors.url?.message}>
          <div className="relative">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              {...form.register('url')}
              className="h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none transition-all placeholder:text-[var(--text-muted)] focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
              placeholder="https://example.com"
            />
          </div>
        </FormField>

        <FormField label="Logo 链接" error={form.formState.errors.logo?.message}>
          <input
            {...form.register('logo')}
            className="h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] outline-none transition-all placeholder:text-[var(--text-muted)] focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            placeholder="https://example.com/avatar.png"
          />
        </FormField>

        <FormField label="描述" error={form.formState.errors.description?.message}>
          <textarea
            {...form.register('description')}
            rows={3}
            className="w-full resize-none rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none transition-all placeholder:text-[var(--text-muted)] focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            placeholder="简短介绍这个站点"
          />
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="主题色" error={form.formState.errors.themeColor?.message} icon={<Palette className="h-3.5 w-3.5" />}>
            <div className="flex items-center gap-3">
              <input
                type="color"
                {...form.register('themeColor')}
                className="h-10 w-10 cursor-pointer overflow-hidden rounded-lg border-0 bg-transparent p-0"
                aria-label="选择主题色"
              />
              <input
                {...form.register('themeColor')}
                className="min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none transition-all placeholder:text-[var(--text-muted)] focus:border-primary/50"
                placeholder="#6366f1"
              />
            </div>
          </FormField>

          <FormField label="联系邮箱" error={form.formState.errors.email?.message} icon={<Mail className="h-3.5 w-3.5" />}>
            <input
              {...form.register('email')}
              className="h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] outline-none transition-all placeholder:text-[var(--text-muted)] focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
              placeholder="admin@example.com"
            />
          </FormField>
        </div>

        <FormField label="RSS 地址" error={form.formState.errors.rssUrl?.message} icon={<Rss className="h-3.5 w-3.5" />}>
          <input
            {...form.register('rssUrl')}
            className="h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] outline-none transition-all placeholder:text-[var(--text-muted)] focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            placeholder="https://example.com/feed"
          />
        </FormField>

        <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
          <button
            type="button"
            onClick={handleCloseForm}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
          >
            <RotateCcw className="h-4 w-4" />
            取消
          </button>
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-primary transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {editingId ? '保存修改' : '确认添加'}
          </button>
        </div>
      </form>
    </div>
  );

  return (
    <div className="admin-grid-page -m-4 min-h-[calc(100%+2rem)] overflow-hidden p-4 text-[var(--ink-primary)] md:-m-6 md:min-h-[calc(100%+3rem)] md:p-6">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-0 py-2 sm:gap-4 sm:px-6 sm:py-4 lg:px-8">
        <AdminModuleHeader
          className="compact-actions-module-header friends-actions-module-header"
          title="友情链接"
          description="管理友链展示、排序与状态。"
          icon={Link2}
          currentLabel={listRefreshing ? '同步中' : '站点目录'}
          activeSummary={`匹配 ${total} · 公开 ${stats.visible} · 离线 ${stats.offline}`}
          actions={
            <button
              type="button"
              onClick={openCreateForm}
              className="admin-module-action-button friends-header-action friends-header-create-action"
              aria-label="新建友链"
              title="新建友链"
            >
              <Plus className="h-4 w-4" />
              <span>新建</span>
            </button>
          }
        />

        <div className={cn(friendPanelClass, 'space-y-4')}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="relative md:col-span-12">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索站点名称、域名、邮箱、RSS 或描述"
                aria-label="友链关键词搜索"
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
              <ArrowUpDown className="h-3.5 w-3.5" />
              <span>筛选</span>
            </div>
            <div className="inline-flex max-w-full items-center overflow-x-auto rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] p-0.5">
              {statusOptions.map((option) => {
                const Icon = option.icon;
                const isSelected = statusFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setStatusFilter(option.value);
                      setPageNum(1);
                    }}
                    className={statusChipClass(isSelected)}
                  >
                    {isSelected && <SegmentThumb layoutId="friend-status-segment-thumb" />}
                    <Icon className="relative z-10 h-3 w-3" />
                    <span className="relative z-10">{option.label}</span>
                    <span className="tnum relative z-10 text-[10px] opacity-70">{option.count}</span>
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
                  匹配 <span className="tnum font-medium text-[var(--ink-primary)]">{total}</span> 个站点
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className={cn(friendShellClass, 'relative')} data-refreshing={listRefreshing}>
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
            icon={<Link2 className="h-4 w-4" />}
            title="友链目录"
            description={
              <>
                <span className="sm:hidden">{isReorderLocked ? '筛选中不可排序' : '拖拽排序'}</span>
                <span className="hidden sm:inline">
                  {isReorderLocked ? '筛选视图中排序暂锁定，清空筛选后可拖拽调整' : '拖拽左侧手柄调整前台展示顺序'}
                </span>
              </>
            }
            aside={<AdminSectionCount>{isLoading ? '加载中' : listRefreshing ? '刷新中' : `${total}/${stats.total}`}</AdminSectionCount>}
          />

          {isLoading ? (
            <div className="space-y-4 p-8">
              {[...Array(Math.min(pageSize, 10))].map((_, i) => (
                <div key={i} className="flex animate-pulse items-start gap-4">
                  <div className="h-11 w-11 rounded-2xl bg-[var(--bg-secondary)]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-[var(--bg-secondary)]" />
                    <div className="h-3 w-1/2 rounded bg-[var(--bg-secondary)]" />
                    <div className="h-12 rounded bg-[var(--bg-secondary)]" />
                  </div>
                </div>
              ))}
            </div>
          ) : total === 0 ? (
            <EmptyState
              title={friends.length === 0 ? '暂无友链' : '没有匹配的友链'}
              description={friends.length === 0 ? '添加第一个站点后，前台友链页会按这里的顺序展示。' : '调整搜索词或状态筛选后再查看。'}
              action={friends.length === 0 ? openCreateForm : resetFilters}
              actionText={friends.length === 0 ? '添加友链' : '清空筛选'}
            />
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={pageFriends.map((friend) => friend.id)} strategy={verticalListSortingStrategy}>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={`${statusFilter}-${debouncedSearch}-${pageNum}-${pageSize}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: listRefreshing ? 0.62 : 1, y: listRefreshing ? 2 : 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="divide-y divide-[var(--border-subtle)]"
                  >
                    {pageFriends.map((friend, index) => (
                      <SortableFriendItem
                        key={friend.id}
                        friend={friend}
                        index={(pageNum - 1) * pageSize + index}
                        dragDisabled={isReorderLocked || reorderMutation.isPending}
                        onEdit={() => handleEdit(friend)}
                        onDelete={() => setDeleteTarget(friend)}
                        onToggleVisible={() => toggleMutation.mutate(friend.id)}
                      />
                    ))}
                  </motion.div>
                </AnimatePresence>
              </SortableContext>
            </DndContext>
          )}

          {total > 0 && (
            <AdminPagination
              page={pageNum}
              total={total}
              totalPages={totalPages}
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageChange={setPageNum}
              onPageSizeChange={handlePageSizeChange}
              itemLabel="个"
            />
          )}
        </div>
      </div>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {isFormOpen && (
            isMobile ? (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm"
                  onClick={handleCloseForm}
                />
                <motion.div
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                  drag="y"
                  dragConstraints={{ top: 0 }}
                  dragElastic={0.18}
                  onDragEnd={(_, info) => {
                    if (info.offset.y > 100) handleCloseForm();
                  }}
                  className="fixed bottom-0 left-0 right-0 z-[70] max-h-[66vh] overflow-hidden rounded-t-2xl border-t border-[var(--border-default)] bg-[var(--bg-popover)] shadow-2xl"
                >
                  <div className="flex justify-center pt-3 pb-1">
                    <div className="h-1.5 w-12 rounded-full bg-[var(--border-hover)]" />
                  </div>
                  <div className="max-h-[calc(66vh-1.25rem)] overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
                    {formContent}
                  </div>
                </motion.div>
              </>
            ) : (
              <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-black/55 backdrop-blur-sm"
                  onClick={handleCloseForm}
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 14 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 14 }}
                  transition={{ duration: 0.18 }}
                  className="relative max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--border-default)] bg-[var(--bg-popover)] p-5 shadow-2xl"
                >
                  {formContent}
                </motion.div>
              </div>
            )
          )}
        </AnimatePresence>,
        document.body
      )}

      {deleteTarget && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDeleteTarget(null)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ duration: 0.18 }}
            className="relative w-full max-w-md rounded-3xl border border-[var(--border-default)] bg-[var(--bg-popover)] p-5 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-status-danger-light text-status-danger">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-[var(--text-primary)]">删除友链</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                  确定删除「{deleteTarget.name}」吗？删除后前台友链页将不再展示该站点。
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="h-11 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
              >
                取消
              </button>
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-status-danger px-4 text-sm font-semibold text-white transition-colors hover:bg-status-danger/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                确认删除
              </button>
            </div>
          </motion.div>
        </div>,
        document.body
      )}
    </div>
  );
}

function FormField({
  label,
  required,
  error,
  icon,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
        {icon}
        {label}
        {required && <span className="text-status-danger">*</span>}
      </span>
      {children}
      {error && <span className="block text-xs text-status-danger">{error}</span>}
    </label>
  );
}

function EmptyState({
  title,
  description,
  action,
  actionText,
}: {
  title: string;
  description: string;
  action: () => void;
  actionText: string;
}) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-muted)]">
        <Globe className="h-8 w-8" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-[var(--text-primary)]">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--text-muted)]">{description}</p>
      <button
        type="button"
        onClick={action}
        className="mt-5 flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" />
        {actionText}
      </button>
    </div>
  );
}
