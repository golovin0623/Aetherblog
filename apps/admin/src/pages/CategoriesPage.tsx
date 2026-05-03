import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Folder,
  Tag as TagIcon,
  Loader2,
  Trash2,
  Pencil,
  Sparkles,
  Inbox,
} from 'lucide-react';
import { spring, transition, variants } from '@aetherblog/ui';
import { ConfirmModal } from '@aetherblog/ui';
import { cn } from '@/lib/utils';
import { categoryService, Category } from '@/services/categoryService';
import { tagService, Tag } from '@/services/tagService';
import { logger } from '@/lib/logger';
import { getTagHex } from '@/lib/tagColor';
import { toast } from 'sonner';
import { CreateItemModal } from './categories/CreateItemModal';

type Tab = 'categories' | 'tags';
type EditTarget =
  | { kind: 'category'; data: Category }
  | { kind: 'tag'; data: Tag }
  | null;

export default function CategoriesPage() {
  const [activeTab, setActiveTab] = useState<Tab>('categories');
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<{
    id: number;
    name: string;
    type: 'category' | 'tag';
  } | null>(null);

  const [showFormModal, setShowFormModal] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
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
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab]);

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

  // 数据派生 —— 用作 header 摘要
  const stats = useMemo(() => {
    if (activeTab === 'categories') {
      const total = categories.length;
      const totalPosts = categories.reduce((s, c) => s + (c.postCount || 0), 0);
      const top = [...categories].sort(
        (a, b) => (b.postCount || 0) - (a.postCount || 0)
      )[0];
      return {
        total,
        totalPosts,
        topName: top?.name ?? '—',
        topCount: top?.postCount ?? 0,
      };
    }
    const total = tags.length;
    const totalPosts = tags.reduce((s, t) => s + (t.postCount || 0), 0);
    const top = [...tags].sort(
      (a, b) => (b.postCount || 0) - (a.postCount || 0)
    )[0];
    return {
      total,
      totalPosts,
      topName: top?.name ?? '—',
      topCount: top?.postCount ?? 0,
    };
  }, [activeTab, categories, tags]);

  const isCategoryTab = activeTab === 'categories';

  return (
    <div className="space-y-6 sm:space-y-7">
      {/* 页面标题区 */}
      <motion.header
        initial={variants.fadeUp.initial}
        animate={variants.fadeUp.animate}
        transition={transition.flow}
        className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4"
      >
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--ink-muted)]">
            <span className="text-[var(--aurora-1)]">●</span>{' '}
            CONTENT · TAXONOMY
          </p>
          <h1
            className="font-display text-[1.875rem] sm:text-[2.25rem] font-semibold leading-[1.1] text-[var(--ink-primary)] tracking-tight"
            style={{ fontVariationSettings: '"opsz" 24, "SOFT" 50, "WONK" 0' }}
          >
            分类标签
          </h1>
          <div className="flex items-center gap-3 font-mono text-[12px] tracking-wide text-[var(--ink-muted)] tnum">
            <span>
              <span className="text-[var(--ink-primary)] font-medium">
                {stats.total}
              </span>{' '}
              {isCategoryTab ? '个分类' : '个标签'}
            </span>
            <span className="opacity-40">·</span>
            <span>
              覆盖{' '}
              <span className="text-[var(--ink-primary)] font-medium">
                {stats.totalPosts}
              </span>{' '}
              篇
            </span>
            {stats.total > 0 && (
              <>
                <span className="opacity-40 hidden sm:inline">·</span>
                <span className="hidden sm:inline truncate max-w-[160px]">
                  最热{' '}
                  <span className="text-[var(--ink-primary)] font-medium">
                    {stats.topName}
                  </span>{' '}
                  ({stats.topCount})
                </span>
              </>
            )}
          </div>
        </div>

        <motion.button
          whileHover={{ y: -1, scale: 1.01 }}
          whileTap={{ scale: 0.97 }}
          transition={spring.precise}
          onClick={openCreate}
          className={cn(
            'group inline-flex items-center gap-2 px-4 sm:px-5 h-10 rounded-xl',
            'bg-[var(--aurora-1)] text-white font-medium text-[13.5px]',
            'shadow-[0_10px_28px_-10px_color-mix(in_oklch,var(--aurora-1)_55%,transparent)]',
            'hover:brightness-110 transition-all'
          )}
        >
          <Plus className="w-4 h-4" strokeWidth={2.2} />
          {isCategoryTab ? '新建分类' : '新建标签'}
          <Sparkles
            className="w-3.5 h-3.5 opacity-70 group-hover:opacity-100 group-hover:rotate-12 transition-all"
            strokeWidth={1.8}
          />
        </motion.button>
      </motion.header>

      {/* 标签页切换 —— Codex segmented */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...transition.flow, delay: 0.04 }}
        className="inline-flex items-center gap-1 p-1 rounded-xl surface-leaf"
        style={{ width: 'fit-content' }}
      >
        {(
          [
            { key: 'categories' as const, label: '分类管理', Icon: Folder },
            { key: 'tags' as const, label: '标签管理', Icon: TagIcon },
          ]
        ).map(({ key, label, Icon }) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                'relative inline-flex items-center gap-1.5 px-3.5 sm:px-4 h-9 rounded-lg',
                'text-[13px] font-medium transition-colors',
                active
                  ? 'text-white'
                  : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]'
              )}
            >
              {active && (
                <motion.span
                  layoutId="categories-tab-indicator"
                  className="absolute inset-0 rounded-lg bg-[var(--aurora-1)] shadow-[0_4px_14px_-6px_color-mix(in_oklch,var(--aurora-1)_55%,transparent)]"
                  transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                />
              )}
              <span className="relative z-10 inline-flex items-center gap-1.5">
                <Icon className="w-4 h-4" strokeWidth={1.8} />
                {label}
              </span>
            </button>
          );
        })}
      </motion.div>

      {/* 内容区 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={transition.flow}
        >
          {loading ? (
            <ContentSkeleton variant={isCategoryTab ? 'list' : 'grid'} />
          ) : error ? (
            <div className="surface-leaf p-10 text-center">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--signal-danger)]">
                Error
              </p>
              <p className="mt-2 text-[var(--ink-secondary)] text-[14px]">
                {error}
              </p>
            </div>
          ) : isCategoryTab ? (
            <CategoryList
              categories={categories}
              onEdit={openEditCategory}
              onDelete={(c) =>
                setDeleteTarget({ id: c.id, name: c.name, type: 'category' })
              }
              onCreate={openCreate}
            />
          ) : (
            <TagGrid
              tags={tags}
              onEdit={openEditTag}
              onDelete={(t) =>
                setDeleteTarget({ id: t.id, name: t.name, type: 'tag' })
              }
              onCreate={openCreate}
            />
          )}
        </motion.div>
      </AnimatePresence>

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
}: {
  type: 'category' | 'tag';
  onCreate: () => void;
}) {
  const isCategory = type === 'category';
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
          {isCategory ? '尚未创建任何分类' : '标签库还很空旷'}
        </h3>
        <p className="text-[13px] text-[var(--ink-secondary)] mt-2">
          {isCategory
            ? '建立分类,让文章像图书馆一样井然有序。'
            : '用标签为文章贴上标识,串起跨分类的脉络。'}
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
          创建第一个{isCategory ? '分类' : '标签'}
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
