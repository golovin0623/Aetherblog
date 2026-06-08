import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Folder,
  Tag as TagIcon,
  Loader2,
  Trash2,
  Pencil,
  Inbox,
  Search,
  X,
} from 'lucide-react';
import { spring, transition, variants } from '@aetherblog/ui';
import { ConfirmModal } from '@aetherblog/ui';
import { useDebounce } from '@aetherblog/hooks';
import { cn } from '@/lib/utils';
import { categoryService, Category } from '@/services/categoryService';
import { tagService, Tag } from '@/services/tagService';
import { logger } from '@/lib/logger';
import { getTagHex } from '@/lib/tagColor';
import { toast } from 'sonner';
import { AdminModuleHeader, type AdminModuleHeaderTab } from '@/components/layout/AdminModuleHeader';
import { AdminSectionCount, AdminSectionHeader } from '@/components/layout/AdminSectionHeader';
import { CreateItemModal } from './categories/CreateItemModal';

type Tab = 'categories' | 'tags';
type EditTarget =
  | { kind: 'category'; data: Category }
  | { kind: 'tag'; data: Tag }
  | null;
type ActiveChip = {
  key: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  onRemove: () => void;
};

const taxonomyTabs: AdminModuleHeaderTab<Tab>[] = [
  {
    key: 'categories',
    label: '分类管理',
    shortLabel: '分类',
    description: '组织文章主线，控制前台内容导航与归档结构。',
    icon: Folder,
  },
  {
    key: 'tags',
    label: '标签管理',
    shortLabel: '标签',
    description: '维护跨分类主题标识，支持文章聚合和智能写作复用。',
    icon: TagIcon,
  },
];

const taxonomyPanelClass = cn(
  'access-surface surface-leaf surface-admin-panel rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'p-3 shadow-sm sm:p-4'
);

const taxonomyShellClass = cn(
  'access-surface overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'bg-[var(--bg-leaf)] shadow-[0_18px_48px_-42px_rgba(0,0,0,0.45)]'
);

export default function CategoriesPage() {
  const [activeTab, setActiveTab] = useState<Tab>('categories');
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery.trim(), 250);

  const [deleteTarget, setDeleteTarget] = useState<{
    id: number;
    name: string;
    type: 'category' | 'tag';
  } | null>(null);

  const [showFormModal, setShowFormModal] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async ({ preserveList = false }: { preserveList?: boolean } = {}) => {
    try {
      if (!preserveList) setLoading(true);
      setError(null);

      if (activeTab === 'categories') {
        const res = await categoryService.getList();
        if (res.code === 200 && res.data) setCategories(res.data);
        else setError(res.message || '获取分类失败');
      } else {
        const res = await tagService.getList();
        if (res.code === 200 && res.data) setTags(res.data);
        else setError(res.message || '获取标签失败');
      }
    } catch (err: any) {
      logger.error('Fetch error:', err);
      setError(err.message || '网络错误');
    } finally {
      if (!preserveList) setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* close 时延迟清空 editTarget,让退场动画期间仍显示"编辑"标题/初值;
     用 ref 跟踪计时器,任一 open 路径必须先取消挂起的 reset,否则
     "关闭 A → 200ms 内打开 B" 的窗口会让旧定时器在新模态打开后
     才触发,把 editTarget 清成 null,导致表单被重置、Save 误走 create. */
  const editTargetResetTimer = useRef<number | null>(null);
  const cancelPendingEditReset = () => {
    if (editTargetResetTimer.current !== null) {
      window.clearTimeout(editTargetResetTimer.current);
      editTargetResetTimer.current = null;
    }
  };
  useEffect(() => () => cancelPendingEditReset(), []);

  const openCreate = () => {
    cancelPendingEditReset();
    setEditTarget(null);
    setShowFormModal(true);
  };
  const openEditCategory = (cat: Category) => {
    cancelPendingEditReset();
    setEditTarget({ kind: 'category', data: cat });
    setShowFormModal(true);
  };
  const openEditTag = (tag: Tag) => {
    cancelPendingEditReset();
    setEditTarget({ kind: 'tag', data: tag });
    setShowFormModal(true);
  };
  const closeFormModal = () => {
    setShowFormModal(false);
    cancelPendingEditReset();
    editTargetResetTimer.current = window.setTimeout(() => {
      setEditTarget(null);
      editTargetResetTimer.current = null;
    }, 200);
  };

  const handleSubmit = async (data: { name: string; description?: string }) => {
    try {
      setSubmitting(true);

      if (editTarget) {
        if (editTarget.kind === 'category') {
          const res = await categoryService.update(editTarget.data.id, {
            name: data.name,
            description: data.description,
          });
          if (res.code === 200) {
            toast.success('分类已更新');
            closeFormModal();
            fetchData();
          } else toast.error(res.message || '更新失败');
        } else {
          const res = await tagService.update(editTarget.data.id, {
            name: data.name,
          });
          if (res.code === 200) {
            toast.success('标签已更新');
            closeFormModal();
            fetchData();
          } else toast.error(res.message || '更新失败');
        }
      } else if (activeTab === 'categories') {
        const res = await categoryService.create({
          name: data.name,
          description: data.description,
        });
        if (res.code === 200) {
          toast.success('分类创建成功');
          closeFormModal();
          fetchData();
        } else toast.error(res.message || '创建失败');
      } else {
        const res = await tagService.create({ name: data.name });
        if (res.code === 200) {
          toast.success('标签创建成功');
          closeFormModal();
          fetchData();
        } else toast.error(res.message || '创建失败');
      }
    } catch (err: any) {
      logger.error('Submit error:', err);
      toast.error(err.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res =
        deleteTarget.type === 'category'
          ? await categoryService.delete(deleteTarget.id)
          : await tagService.delete(deleteTarget.id);

      if (res.code === 200) {
        toast.success(
          `${deleteTarget.type === 'category' ? '分类' : '标签'}已删除`
        );
        fetchData();
      } else {
        toast.error(res.message || '删除失败');
      }
    } catch (err: any) {
      logger.error('Delete error:', err);
      toast.error(err.message || '删除失败');
    } finally {
      setDeleteTarget(null);
    }
  };

  const isCategoryTab = activeTab === 'categories';

  const handleTabChange = (nextTab: Tab) => {
    if (nextTab === activeTab) return;
    setActiveTab(nextTab);
    setSearchQuery('');
  };

  const filteredCategories = useMemo(() => {
    const query = debouncedSearch.toLowerCase();
    if (!query) return categories;
    return categories.filter((category) =>
      [category.name, category.slug, category.description]
        .some((value) => value?.toLowerCase().includes(query))
    );
  }, [categories, debouncedSearch]);

  const filteredTags = useMemo(() => {
    const query = debouncedSearch.toLowerCase();
    if (!query) return tags;
    return tags.filter((tag) =>
      [tag.name, tag.slug].some((value) => value?.toLowerCase().includes(query))
    );
  }, [tags, debouncedSearch]);

  // 数据派生 —— 用作 header 摘要和 shell 计数
  const stats = useMemo(() => {
    const source = activeTab === 'categories' ? categories : tags;
    const filtered = activeTab === 'categories' ? filteredCategories : filteredTags;
    const totalPosts = filtered.reduce((sum, item) => sum + (item.postCount || 0), 0);
    const top = [...source].sort((a, b) => (b.postCount || 0) - (a.postCount || 0))[0];

    return {
      total: source.length,
      filteredTotal: filtered.length,
      totalPosts,
      topName: top?.name ?? '—',
      topCount: top?.postCount ?? 0,
    };
  }, [activeTab, categories, filteredCategories, filteredTags, tags]);

  const activeChips: ActiveChip[] = [];
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

  const resetFilters = () => {
    setSearchQuery('');
  };

  return (
    <div className="admin-grid-page -m-4 min-h-[calc(100%+2rem)] overflow-hidden p-4 text-[var(--ink-primary)] md:-m-6 md:min-h-[calc(100%+3rem)] md:p-6">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-0 py-2 sm:gap-4 sm:px-6 sm:py-4 lg:px-8">
        <AdminModuleHeader
          className="taxonomy-module-header"
          title="分类标签"
          description="统一维护文章分类与标签库，保持内容组织、检索和写作辅助的一致性。"
          tabs={taxonomyTabs}
          activeKey={activeTab}
          onTabChange={handleTabChange}
          currentLabel={isCategoryTab ? '分类库' : '标签库'}
          activeSummary={`匹配 ${stats.filteredTotal} / ${stats.total} · 覆盖 ${stats.totalPosts} 篇`}
          showCurrentLabel={false}
          showActiveSummary={false}
          actions={
            <button
              type="button"
              onClick={openCreate}
              className="admin-module-action-button taxonomy-header-create-action"
              aria-label={isCategoryTab ? '新建分类' : '新建标签'}
              title={isCategoryTab ? '新建分类' : '新建标签'}
            >
              <Plus className="h-4 w-4" />
              <span>新建</span>
            </button>
          }
        />

        <div className={cn(taxonomyPanelClass, 'space-y-4')}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="relative md:col-span-12">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={isCategoryTab ? '搜索分类名称、slug 或描述' : '搜索标签名称或 slug'}
                aria-label={isCategoryTab ? '分类关键词搜索' : '标签关键词搜索'}
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
              {isCategoryTab ? <Folder className="h-3.5 w-3.5" /> : <TagIcon className="h-3.5 w-3.5" />}
              <span>概览</span>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {[
                { label: isCategoryTab ? '分类' : '标签', value: stats.total },
                { label: '匹配', value: stats.filteredTotal },
                { label: '文章', value: stats.totalPosts },
                ...(stats.topCount > 0
                  ? [{ label: '最热', value: `${stats.topName} (${stats.topCount})` }]
                  : []),
              ].map((item) => (
                <span
                  key={item.label}
                  className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] px-3 text-xs"
                >
                  <span className="shrink-0 font-mono uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                    {item.label}
                  </span>
                  <span className="tnum min-w-0 truncate font-semibold text-[var(--ink-primary)]">
                    {item.value}
                  </span>
                </span>
              ))}
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
                  匹配{' '}
                  <span className="tnum font-medium text-[var(--ink-primary)]">
                    {stats.filteredTotal}
                  </span>{' '}
                  个{isCategoryTab ? '分类' : '标签'}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className={cn(taxonomyShellClass, 'relative')}>
          <AdminSectionHeader
            icon={isCategoryTab ? <Folder className="h-4 w-4" /> : <TagIcon className="h-4 w-4" />}
            title={isCategoryTab ? '分类目录' : '标签集合'}
            description={
              <>
                <span className="sm:hidden">
                  {debouncedSearch ? '关键词筛选中' : isCategoryTab ? '文章主线' : '主题聚合'}
                </span>
                <span className="hidden sm:inline">
                  {debouncedSearch
                    ? `正在按“${debouncedSearch}”筛选结果`
                    : isCategoryTab
                      ? '分类用于承载文章主线、导航入口和归档结构'
                      : '标签用于连接跨分类主题、专题聚合和写作上下文'}
                </span>
              </>
            }
            aside={<AdminSectionCount>{loading ? '加载中' : `${stats.filteredTotal}/${stats.total}`}</AdminSectionCount>}
          />

          {loading ? (
            <div className="p-4 sm:p-5">
              <ContentSkeleton variant={isCategoryTab ? 'list' : 'grid'} />
            </div>
          ) : error ? (
            <div className="p-4 sm:p-5">
              <div className="rounded-xl border border-[color-mix(in_oklch,var(--signal-danger)_20%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_7%,transparent)] px-6 py-10 text-center">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--signal-danger)]">
                  Error
                </p>
                <p className="mt-2 text-[14px] text-[var(--ink-secondary)]">{error}</p>
              </div>
            </div>
          ) : stats.total === 0 ? (
            <div className="p-4 sm:p-5">
              <EmptyState type={isCategoryTab ? 'category' : 'tag'} onCreate={openCreate} />
            </div>
          ) : stats.filteredTotal === 0 ? (
            <div className="p-4 sm:p-5">
              <EmptyState
                type={isCategoryTab ? 'category' : 'tag'}
                onCreate={resetFilters}
                title={isCategoryTab ? '没有匹配的分类' : '没有匹配的标签'}
                description="调整关键词后再查看，或清空筛选返回完整列表。"
                actionText="清空筛选"
              />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={`${activeTab}-${debouncedSearch}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="p-4 sm:p-5"
              >
                {isCategoryTab ? (
                  <CategoryList
                    categories={filteredCategories}
                    onEdit={openEditCategory}
                    onDelete={(category) =>
                      setDeleteTarget({ id: category.id, name: category.name, type: 'category' })
                    }
                    onCreate={openCreate}
                  />
                ) : (
                  <TagGrid
                    tags={filteredTags}
                    onEdit={openEditTag}
                    onDelete={(tag) =>
                      setDeleteTarget({ id: tag.id, name: tag.name, type: 'tag' })
                    }
                    onCreate={openCreate}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* 创建 / 编辑弹窗 */}
      <CreateItemModal
        isOpen={showFormModal}
        onClose={closeFormModal}
        onSubmit={handleSubmit}
        type={editTarget?.kind ?? (isCategoryTab ? 'category' : 'tag')}
        loading={submitting}
        initial={
          editTarget
            ? editTarget.kind === 'category'
              ? {
                  name: editTarget.data.name,
                  description: editTarget.data.description ?? '',
                }
              : { name: editTarget.data.name }
            : null
        }
      />

      {/* 删除确认 */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        title="确认删除"
        message={`确定要删除${
          deleteTarget?.type === 'category' ? '分类' : '标签'
        } "${deleteTarget?.name}" 吗?此操作不可撤销。`}
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/* ============================================================
 * 子组件 —— 分类列表
 * ============================================================ */
function CategoryList({
  categories,
  onEdit,
  onDelete,
  onCreate,
}: {
  categories: Category[];
  onEdit: (c: Category) => void;
  onDelete: (c: Category) => void;
  onCreate: () => void;
}) {
  if (categories.length === 0) {
    return <EmptyState type="category" onCreate={onCreate} />;
  }
  return (
    <motion.div
      initial="initial"
      animate="animate"
      variants={{
        animate: { transition: { staggerChildren: 0.04 } },
      }}
      className="grid grid-cols-1 lg:grid-cols-2 gap-3"
    >
      {categories.map((cat) => (
        <motion.article
          key={cat.id}
          variants={variants.fadeUp}
          transition={transition.flow}
          data-interactive
          className="surface-leaf relative overflow-hidden p-4 sm:p-5 group"
        >
          <div className="flex items-center gap-4">
            {/* 图标块 */}
            <div className="relative shrink-0">
              <span
                className="absolute inset-0 rounded-2xl"
                style={{
                  background:
                    'color-mix(in oklch, var(--aurora-1) 14%, transparent)',
                }}
              />
              <span
                className="relative flex items-center justify-center w-12 h-12 rounded-2xl"
                style={{
                  background:
                    'color-mix(in oklch, var(--aurora-1) 8%, transparent)',
                  border:
                    '1px solid color-mix(in oklch, var(--aurora-1) 25%, transparent)',
                }}
              >
                <Folder
                  className="w-5 h-5 text-[var(--aurora-1)]"
                  strokeWidth={1.8}
                />
              </span>
            </div>

            {/* 名称 + 描述 */}
            <div className="min-w-0 flex-1">
              <h3
                className="font-display text-[1.0625rem] font-semibold text-[var(--ink-primary)] truncate leading-snug"
                style={{ fontVariationSettings: '"opsz" 14, "SOFT" 50, "WONK" 0' }}
              >
                {cat.name}
              </h3>
              <p className="text-[13px] text-[var(--ink-secondary)] truncate mt-0.5">
                {cat.description || '暂无描述'}
              </p>
            </div>

            {/* 计数 + 操作 */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="hidden sm:flex flex-col items-end leading-none">
                <span className="font-display text-[1.5rem] font-semibold text-[var(--ink-primary)] tnum">
                  {cat.postCount ?? 0}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-muted)] mt-1">
                  Posts
                </span>
              </div>
              <span className="sm:hidden font-mono text-[12px] tracking-wide text-[var(--ink-secondary)] tnum whitespace-nowrap">
                {cat.postCount ?? 0} 篇
              </span>

              <div className="flex items-center gap-1">
                <IconButton
                  label="编辑"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(cat);
                  }}
                >
                  <Pencil className="w-3.5 h-3.5" strokeWidth={1.8} />
                </IconButton>
                <IconButton
                  label="删除"
                  variant="danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(cat);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                </IconButton>
              </div>
            </div>
          </div>
        </motion.article>
      ))}
    </motion.div>
  );
}

/* ============================================================
 * 子组件 —— 标签网格
 * ============================================================ */
function TagGrid({
  tags,
  onEdit,
  onDelete,
  onCreate,
}: {
  tags: Tag[];
  onEdit: (t: Tag) => void;
  onDelete: (t: Tag) => void;
  onCreate: () => void;
}) {
  if (tags.length === 0) {
    return <EmptyState type="tag" onCreate={onCreate} />;
  }
  return (
    <motion.div
      initial="initial"
      animate="animate"
      variants={{
        animate: { transition: { staggerChildren: 0.025 } },
      }}
      className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
    >
      {tags.map((tag) => {
        const hex = getTagHex(tag.name);
        return (
          <motion.article
            key={tag.id}
            variants={variants.fadeUp}
            transition={transition.flow}
            data-interactive
            className="surface-leaf relative overflow-hidden px-4 py-3.5 group"
            style={{
              // 用 tag 自身色相覆盖 --aurora-1,这样左侧光带跟随 tag 色相
              ['--aurora-1' as string]: hex,
              background: `linear-gradient(140deg, ${hex}10, var(--bg-leaf))`,
            }}
          >
            {/* 顶部柔光描线 */}
            <span
              className="absolute top-0 left-0 right-0 h-px opacity-50"
              style={{
                background: `linear-gradient(90deg, transparent, ${hex}, transparent)`,
              }}
              aria-hidden
            />

            <div className="relative flex items-center gap-2.5 min-w-0">
              {/* 颜色点 */}
              <span
                className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full"
                style={{
                  background: `${hex}1A`,
                  border: `1px solid ${hex}55`,
                }}
              >
                <TagIcon
                  className="w-3.5 h-3.5"
                  style={{ color: hex }}
                  strokeWidth={1.8}
                />
              </span>

              {/* 名称 */}
              <span
                className="font-display text-[14px] font-medium text-[var(--ink-primary)] truncate leading-tight"
                style={{
                  fontVariationSettings: '"opsz" 12, "SOFT" 40, "WONK" 0',
                }}
              >
                {tag.name}
              </span>

              {/* 计数徽章 */}
              <span
                className="ml-auto shrink-0 font-mono text-[10.5px] tracking-wide tnum px-1.5 py-0.5 rounded-md"
                style={{
                  background: `${hex}1F`,
                  color: hex,
                }}
              >
                {tag.postCount ?? 0}
              </span>
            </div>

            {/* 悬停操作条 —— 桌面端 hover 显示,移动端常驻底部 */}
            <div
              className={cn(
                'mt-2.5 flex items-center justify-end gap-1 -mb-1',
                'opacity-0 group-hover:opacity-100 transition-opacity duration-200',
                '[@media(hover:none)]:opacity-100'
              )}
            >
              <button
                type="button"
                aria-label="编辑标签"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(tag);
                }}
                className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] transition-colors"
              >
                <Pencil className="w-3 h-3" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                aria-label="删除标签"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(tag);
                }}
                className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--ink-muted)] hover:text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_12%,transparent)] transition-colors"
              >
                <Trash2 className="w-3 h-3" strokeWidth={1.8} />
              </button>
            </div>
          </motion.article>
        );
      })}
    </motion.div>
  );
}

/* ============================================================
 * 子组件 —— 空状态
 * ============================================================ */
function EmptyState({
  type,
  onCreate,
  title,
  description,
  actionText,
}: {
  type: 'category' | 'tag';
  onCreate: () => void;
  title?: string;
  description?: string;
  actionText?: string;
}) {
  const isCategory = type === 'category';
  const resolvedTitle = title ?? (isCategory ? '尚未创建任何分类' : '标签库还很空旷');
  const resolvedDescription =
    description ??
    (isCategory
      ? '建立分类,让文章像图书馆一样井然有序。'
      : '用标签为文章贴上标识,串起跨分类的脉络。');
  const resolvedActionText = actionText ?? `创建第一个${isCategory ? '分类' : '标签'}`;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={transition.flow}
      className="surface-leaf relative overflow-hidden px-6 py-14 text-center"
    >
      <div
        className="absolute inset-0 opacity-60 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at top, color-mix(in oklch, var(--aurora-1) 8%, transparent), transparent 60%)',
        }}
        aria-hidden
      />
      <div className="relative">
        <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
          style={{
            background:
              'color-mix(in oklch, var(--aurora-1) 10%, transparent)',
            border:
              '1px solid color-mix(in oklch, var(--aurora-1) 25%, transparent)',
          }}
        >
          <Inbox
            className="w-7 h-7 text-[var(--aurora-1)]"
            strokeWidth={1.5}
          />
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--ink-muted)]">
          Empty Catalog
        </p>
        <h3
          className="font-editorial italic text-[1.5rem] text-[var(--ink-primary)] mt-3 leading-snug"
        >
          {resolvedTitle}
        </h3>
        <p className="text-[13px] text-[var(--ink-secondary)] mt-2">
          {resolvedDescription}
        </p>
        <motion.button
          whileHover={{ y: -1, scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          transition={spring.precise}
          onClick={onCreate}
          className={cn(
            'mt-6 inline-flex items-center gap-2 px-5 h-10 rounded-xl',
            'bg-[var(--aurora-1)] text-white font-medium text-[13.5px]',
            'shadow-[0_10px_28px_-10px_color-mix(in_oklch,var(--aurora-1)_55%,transparent)]',
            'hover:brightness-110 transition-all'
          )}
        >
          <Plus className="w-4 h-4" strokeWidth={2.2} />
          {resolvedActionText}
        </motion.button>
      </div>
    </motion.div>
  );
}

/* ============================================================
 * 子组件 —— 列表加载骨架
 * ============================================================ */
function ContentSkeleton({ variant }: { variant: 'list' | 'grid' }) {
  const items = Array.from({ length: variant === 'list' ? 4 : 8 });
  return (
    <div
      className={cn(
        variant === 'list'
          ? 'grid grid-cols-1 lg:grid-cols-2 gap-3'
          : 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3'
      )}
    >
      {items.map((_, i) => (
        <div
          key={i}
          className={cn(
            'surface-leaf relative overflow-hidden',
            variant === 'list' ? 'h-[78px]' : 'h-[68px]'
          )}
        >
          <div className="absolute inset-0 animate-pulse">
            <div
              className="absolute inset-0 opacity-60"
              style={{
                background:
                  'linear-gradient(110deg, transparent 30%, color-mix(in oklch, var(--ink-primary) 5%, transparent) 50%, transparent 70%)',
              }}
            />
          </div>
        </div>
      ))}
      <span className="sr-only">
        <Loader2 className="w-4 h-4 animate-spin" /> 加载中
      </span>
    </div>
  );
}

/* ============================================================
 * 子组件 —— 行内图标按钮
 * ============================================================ */
function IconButton({
  label,
  variant = 'neutral',
  children,
  onClick,
}: {
  label: string;
  variant?: 'neutral' | 'danger';
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.92 }}
      transition={spring.precise}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors',
        variant === 'danger'
          ? 'text-[var(--ink-muted)] hover:text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)]'
          : 'text-[var(--ink-muted)] hover:text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]'
      )}
    >
      {children}
    </motion.button>
  );
}
