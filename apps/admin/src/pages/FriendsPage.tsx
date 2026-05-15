import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowUpDown,
  Eye,
  EyeOff,
  Globe,
  LayoutList,
  Link2,
  Loader2,
  Mail,
  Palette,
  Plus,
  RotateCcw,
  Rss,
  Save,
  Search,
  Sparkles,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { cn, extractApiErrorMessage } from '@/lib/utils';
import { friendService, FriendLink } from '@/services/friendService';
import { toast } from 'sonner';
import { useMediaQuery } from '@/hooks';
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
type StatusFilter = 'all' | 'visible' | 'hidden' | 'offline';

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

export default function FriendsPage() {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [deleteTarget, setDeleteTarget] = useState<FriendLink | null>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');

  const queryClient = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const { data: friends = [], isLoading } = useQuery({
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
    const keyword = searchQuery.trim().toLowerCase();
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
        (statusFilter === 'offline' && friend.isOnline === false);

      return matchesKeyword && matchesStatus;
    });
  }, [friends, searchQuery, statusFilter]);

  const isReorderLocked = searchQuery.trim().length > 0 || statusFilter !== 'all';

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

  function resetFilters() {
    setSearchQuery('');
    setStatusFilter('all');
  }

  const previewName = form.watch('name') || '新朋友';
  const previewUrl = form.watch('url') || 'https://example.com';
  const previewLogo = form.watch('logo') || '';
  const previewColor = normalizeThemeColor(form.watch('themeColor'));

  const statusOptions: { value: StatusFilter; label: string; count: number }[] = [
    { value: 'all', label: '全部', count: stats.total },
    { value: 'visible', label: '公开', count: stats.visible },
    { value: 'hidden', label: '隐藏', count: stats.hidden },
    { value: 'offline', label: '离线', count: stats.offline },
  ];

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
            <div className="flex h-11 items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-2">
              <input
                type="color"
                {...form.register('themeColor')}
                className="h-7 w-8 cursor-pointer border-0 bg-transparent p-0"
                aria-label="选择主题色"
              />
              <input
                {...form.register('themeColor')}
                className="min-w-0 flex-1 bg-transparent font-mono text-xs text-[var(--text-primary)] outline-none"
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
    <div className="space-y-5 pb-6">
      <header className="flex flex-col gap-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-popover)] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
            <Sparkles className="h-3 w-3" />
            Blogroll
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">友情链接</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">管理站点、展示状态与前台排序。</p>
        </div>
        <button
          type="button"
          onClick={openCreateForm}
          className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-white shadow-primary transition-all hover:bg-primary/90 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          添加友链
        </button>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="总数" value={stats.total} icon={<LayoutList className="h-4 w-4" />} />
        <MetricCard label="公开展示" value={stats.visible} icon={<Eye className="h-4 w-4" />} tone="success" />
        <MetricCard label="已隐藏" value={stats.hidden} icon={<EyeOff className="h-4 w-4" />} tone="warning" />
        <MetricCard label="离线" value={stats.offline} icon={<WifiOff className="h-4 w-4" />} tone={stats.offline > 0 ? 'danger' : 'muted'} />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-popover)] shadow-sm">
          <div className="border-b border-[var(--border-subtle)] p-4 lg:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">站点列表</h2>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {isReorderLocked ? '筛选视图中排序暂锁定' : '拖拽左侧手柄调整前台展示顺序'}
                </p>
              </div>
              {reorderMutation.isPending && (
                <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  保存排序中
                </span>
              )}
            </div>

            <div className="mt-4 flex flex-col gap-3 lg:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="h-11 w-full rounded-2xl border border-[var(--border-default)] bg-[var(--bg-input)] pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none transition-all placeholder:text-[var(--text-muted)] focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                  placeholder="搜索名称、域名、邮箱或描述"
                />
              </div>

              <div className="grid grid-cols-4 gap-1 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-1 lg:w-[360px]">
                {statusOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStatusFilter(option.value)}
                    className={cn(
                      'flex h-9 items-center justify-center gap-1 rounded-xl px-2 text-xs font-medium transition-colors',
                      statusFilter === option.value
                        ? 'bg-[var(--bg-popover)] text-[var(--text-primary)] shadow-sm'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                    )}
                  >
                    {option.label}
                    <span className="font-mono text-[10px] opacity-70">{option.count}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-3 lg:p-4">
            {isLoading ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm">加载友链中...</p>
              </div>
            ) : filteredFriends.length === 0 ? (
              <EmptyState
                title={friends.length === 0 ? '暂无友链' : '没有匹配的友链'}
                description={friends.length === 0 ? '添加第一个站点后，前台友链页会按这里的顺序展示。' : '调整搜索词或状态筛选后再查看。'}
                action={friends.length === 0 ? openCreateForm : resetFilters}
                actionText={friends.length === 0 ? '添加友链' : '清空筛选'}
              />
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={filteredFriends.map((friend) => friend.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-3">
                    {filteredFriends.map((friend, index) => (
                      <SortableFriendItem
                        key={friend.id}
                        friend={friend}
                        index={index}
                        dragDisabled={isReorderLocked || reorderMutation.isPending}
                        onEdit={() => handleEdit(friend)}
                        onDelete={() => setDeleteTarget(friend)}
                        onToggleVisible={() => toggleMutation.mutate(friend.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </section>

        {!isMobile && (
          <aside className="min-w-0">
            <AnimatePresence mode="wait">
              {isFormOpen ? (
                <motion.div
                  key="form"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ duration: 0.18 }}
                  className="sticky top-6 rounded-3xl border border-[var(--border-default)] bg-[var(--bg-popover)] p-5 shadow-xl"
                >
                  {formContent}
                </motion.div>
              ) : (
                <motion.div
                  key="summary"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ duration: 0.18 }}
                  className="sticky top-6 space-y-4"
                >
                  <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-popover)] p-5 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                        <ArrowUpDown className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-[var(--text-primary)]">排序与展示</h2>
                        <p className="mt-0.5 text-xs text-[var(--text-muted)]">列表顺序即前台展示顺序</p>
                      </div>
                    </div>
                    <div className="mt-5 space-y-3 text-sm">
                      <SummaryRow label="公开占比" value={stats.total ? `${Math.round((stats.visible / stats.total) * 100)}%` : '0%'} />
                      <SummaryRow label="RSS 订阅" value={`${stats.withRss} 个`} />
                      <SummaryRow label="健康异常" value={`${stats.offline} 个`} tone={stats.offline > 0 ? 'danger' : 'normal'} />
                    </div>
                    <button
                      type="button"
                      onClick={openCreateForm}
                      className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
                    >
                      <Plus className="h-4 w-4" />
                      新增站点
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </aside>
        )}
      </div>

      {isMobile && typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {isFormOpen && (
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

function MetricCard({
  label,
  value,
  icon,
  tone = 'normal',
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: 'normal' | 'success' | 'warning' | 'danger' | 'muted';
}) {
  const toneClass = {
    normal: 'text-[var(--text-secondary)] bg-[var(--bg-secondary)]',
    success: 'text-status-success bg-status-success-light',
    warning: 'text-status-warning bg-status-warning-light',
    danger: 'text-status-danger bg-status-danger-light',
    muted: 'text-[var(--text-muted)] bg-[var(--bg-secondary)]',
  }[tone];

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-popover)] p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--text-muted)]">{label}</span>
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-xl', toneClass)}>{icon}</span>
      </div>
      <div className="mt-3 font-mono text-2xl font-semibold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  value: string;
  tone?: 'normal' | 'danger';
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--bg-secondary)] px-3 py-2">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <span className={cn('text-sm font-medium', tone === 'danger' ? 'text-status-danger' : 'text-[var(--text-primary)]')}>
        {value}
      </span>
    </div>
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
