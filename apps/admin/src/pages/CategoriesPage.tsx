import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Folder, Tag as TagIcon, Loader2, Trash2, Edit2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { categoryService, Category } from '@/services/categoryService';
import { tagService, Tag } from '@/services/tagService';
import { ConfirmModal } from '@aetherblog/ui';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';
import { CreateItemModal } from './categories/CreateItemModal';

// 标签颜色调色板 - 12种色调，通过名称哈希分配确保同一标签始终使用相同颜色且不易重复
const TAG_PALETTE = [
  { bg: 'bg-blue-50 dark:bg-blue-500/15', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200/60 dark:border-blue-500/25', icon: 'text-blue-500 dark:text-blue-400', badge: 'bg-blue-100/80 dark:bg-blue-500/20 text-blue-600 dark:text-blue-300', shadow: 'hover:shadow-blue-500/10' },
  { bg: 'bg-violet-50 dark:bg-violet-500/15', text: 'text-violet-700 dark:text-violet-300', border: 'border-violet-200/60 dark:border-violet-500/25', icon: 'text-violet-500 dark:text-violet-400', badge: 'bg-violet-100/80 dark:bg-violet-500/20 text-violet-600 dark:text-violet-300', shadow: 'hover:shadow-violet-500/10' },
  { bg: 'bg-emerald-50 dark:bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200/60 dark:border-emerald-500/25', icon: 'text-emerald-500 dark:text-emerald-400', badge: 'bg-emerald-100/80 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300', shadow: 'hover:shadow-emerald-500/10' },
  { bg: 'bg-amber-50 dark:bg-amber-500/15', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200/60 dark:border-amber-500/25', icon: 'text-amber-500 dark:text-amber-400', badge: 'bg-amber-100/80 dark:bg-amber-500/20 text-amber-600 dark:text-amber-300', shadow: 'hover:shadow-amber-500/10' },
  { bg: 'bg-pink-50 dark:bg-pink-500/15', text: 'text-pink-700 dark:text-pink-300', border: 'border-pink-200/60 dark:border-pink-500/25', icon: 'text-pink-500 dark:text-pink-400', badge: 'bg-pink-100/80 dark:bg-pink-500/20 text-pink-600 dark:text-pink-300', shadow: 'hover:shadow-pink-500/10' },
  { bg: 'bg-teal-50 dark:bg-teal-500/15', text: 'text-teal-700 dark:text-teal-300', border: 'border-teal-200/60 dark:border-teal-500/25', icon: 'text-teal-500 dark:text-teal-400', badge: 'bg-teal-100/80 dark:bg-teal-500/20 text-teal-600 dark:text-teal-300', shadow: 'hover:shadow-teal-500/10' },
  { bg: 'bg-rose-50 dark:bg-rose-500/15', text: 'text-rose-700 dark:text-rose-300', border: 'border-rose-200/60 dark:border-rose-500/25', icon: 'text-rose-500 dark:text-rose-400', badge: 'bg-rose-100/80 dark:bg-rose-500/20 text-rose-600 dark:text-rose-300', shadow: 'hover:shadow-rose-500/10' },
  { bg: 'bg-indigo-50 dark:bg-indigo-500/15', text: 'text-indigo-700 dark:text-indigo-300', border: 'border-indigo-200/60 dark:border-indigo-500/25', icon: 'text-indigo-500 dark:text-indigo-400', badge: 'bg-indigo-100/80 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300', shadow: 'hover:shadow-indigo-500/10' },
  { bg: 'bg-sky-50 dark:bg-sky-500/15', text: 'text-sky-700 dark:text-sky-300', border: 'border-sky-200/60 dark:border-sky-500/25', icon: 'text-sky-500 dark:text-sky-400', badge: 'bg-sky-100/80 dark:bg-sky-500/20 text-sky-600 dark:text-sky-300', shadow: 'hover:shadow-sky-500/10' },
  { bg: 'bg-lime-50 dark:bg-lime-500/15', text: 'text-lime-700 dark:text-lime-300', border: 'border-lime-200/60 dark:border-lime-500/25', icon: 'text-lime-500 dark:text-lime-400', badge: 'bg-lime-100/80 dark:bg-lime-500/20 text-lime-600 dark:text-lime-300', shadow: 'hover:shadow-lime-500/10' },
  { bg: 'bg-fuchsia-50 dark:bg-fuchsia-500/15', text: 'text-fuchsia-700 dark:text-fuchsia-300', border: 'border-fuchsia-200/60 dark:border-fuchsia-500/25', icon: 'text-fuchsia-500 dark:text-fuchsia-400', badge: 'bg-fuchsia-100/80 dark:bg-fuchsia-500/20 text-fuchsia-600 dark:text-fuchsia-300', shadow: 'hover:shadow-fuchsia-500/10' },
  { bg: 'bg-orange-50 dark:bg-orange-500/15', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-200/60 dark:border-orange-500/25', icon: 'text-orange-500 dark:text-orange-400', badge: 'bg-orange-100/80 dark:bg-orange-500/20 text-orange-600 dark:text-orange-300', shadow: 'hover:shadow-orange-500/10' },
];

// 通过标签名称哈希计算颜色，保证同一标签始终使用相同颜色
const getTagColor = (name: string) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
};

export default function CategoriesPage() {
  const [activeTab, setActiveTab] = useState<'categories' | 'tags'>('categories');
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 删除弹窗状态
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string; type: 'category' | 'tag' } | null>(null);

  // 创建弹窗状态
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      if (activeTab === 'categories') {
        const res = await categoryService.getList();
        if (res.code === 200 && res.data) {
          setCategories(res.data);
        } else {
          setError(res.message || '获取分类失败');
        }
      } else {
        const res = await tagService.getList();
        if (res.code === 200 && res.data) {
          setTags(res.data);
        } else {
          setError(res.message || '获取标签失败');
        }
      }
    } catch (err: any) {
      logger.error('Fetch error:', err);
      setError(err.message || '网络错误');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (data: { name: string; description?: string }) => {
    try {
      setCreating(true);
      if (activeTab === 'categories') {
        const res = await categoryService.create({ name: data.name, description: data.description });
        if (res.code === 200) {
          setShowCreateModal(false);
          toast.success('分类创建成功');
          fetchData();
        } else {
          toast.error(res.message || '创建失败');
        }
      } else {
        const res = await tagService.create({ name: data.name });
        if (res.code === 200) {
          setShowCreateModal(false);
          toast.success('标签创建成功');
          fetchData();
        } else {
          toast.error(res.message || '创建失败');
        }
      }
    } catch (err: any) {
      logger.error('Create error:', err);
      toast.error(err.message || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    
    try {
      if (deleteTarget.type === 'category') {
        const res = await categoryService.delete(deleteTarget.id);
        if (res.code === 200) {
          fetchData();
        } else {
          toast.error(res.message || '删除失败');
        }
      } else {
        const res = await tagService.delete(deleteTarget.id);
        if (res.code === 200) {
          fetchData();
        } else {
          toast.error(res.message || '删除失败');
        }
      }
    } catch (err: any) {
      logger.error('Delete error:', err);
      toast.error(err.message || '删除失败');
    } finally {
      setDeleteTarget(null);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">分类标签</h1>
          <p className="text-[var(--text-muted)] mt-1">
            {activeTab === 'categories' ? `共 ${categories.length} 个分类` : `共 ${tags.length} 个标签`}
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowCreateModal(true)}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg',
            'bg-primary text-white font-medium',
            'hover:bg-primary/90 transition-colors'
          )}
        >
          <Plus className="w-4 h-4" />
          {activeTab === 'categories' ? '新建分类' : '新建标签'}
        </motion.button>
      </div>

      {/* 标签页切换 */}
      <div className="flex gap-1 p-1 bg-[var(--bg-secondary)] rounded-lg w-fit relative">
        <button
          onClick={() => setActiveTab('categories')}
          className={cn(
            'relative z-10 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2',
            activeTab === 'categories'
              ? 'text-white'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          )}
        >
          {activeTab === 'categories' && (
            <motion.div
              layoutId="activeTabBg"
              className="absolute inset-0 bg-primary rounded-md"
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
            />
          )}
          <span className="relative z-10 flex items-center gap-2">
            <Folder className="w-4 h-4" />
            分类管理
          </span>
        </button>
        <button
          onClick={() => setActiveTab('tags')}
          className={cn(
            'relative z-10 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2',
            activeTab === 'tags'
              ? 'text-white'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          )}
        >
          {activeTab === 'tags' && (
            <motion.div
              layoutId="activeTabBg"
              className="absolute inset-0 bg-primary rounded-md"
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
            />
          )}
          <span className="relative z-10 flex items-center gap-2">
            <TagIcon className="w-4 h-4" />
            标签管理
          </span>
        </button>
      </div>

      {/* 内容区域 */}
      <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="p-6 text-center text-status-danger">{error}</div>
        ) : activeTab === 'categories' ? (
          categories.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)]">暂无分类，点击"新建分类"创建</div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {categories.map((cat) => (
                <div key={cat.id} className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 hover:bg-[var(--bg-card-hover)] transition-colors">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                      <Folder className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[var(--text-primary)] font-medium truncate">{cat.name}</p>
                      <p className="text-[var(--text-secondary)] text-sm truncate">{cat.description || '暂无描述'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                    <span className="text-[var(--text-muted)] text-xs sm:text-sm whitespace-nowrap">{cat.postCount || 0} 篇</span>
                    <div className="flex gap-1 sm:gap-2">
                      <button className="p-1.5 sm:p-2 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => setDeleteTarget({ id: cat.id, name: cat.name, type: 'category' })}
                        className="p-1.5 sm:p-2 rounded-lg hover:bg-status-danger-light text-[var(--text-muted)] hover:text-status-danger transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          tags.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)]">暂无标签，点击"新建标签"创建</div>
          ) : (
            <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {tags.map((tag, index) => {
                const color = getTagColor(tag.name);
                
                return (
                  <motion.div
                    key={tag.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    className={cn(
                      'group relative flex items-center justify-between gap-2 px-4 py-3 rounded-xl',
                      'border transition-all duration-200',
                      'hover:-translate-y-0.5 hover:shadow-lg',
                      color.bg, color.border, color.shadow
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <TagIcon className={cn('w-4 h-4 shrink-0', color.icon)} />
                      <span className={cn('font-medium truncate text-sm', color.text)}>{tag.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full', color.badge)}>
                        {tag.postCount || 0} 篇
                      </span>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: tag.id, name: tag.name, type: 'tag' }); }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-500/10 dark:hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-500 dark:hover:text-red-400 transition-all duration-200"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* 创建弹窗 */}
      <CreateItemModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreate}
        type={activeTab === 'categories' ? 'category' : 'tag'}
        loading={creating}
      />

      {/* 删除确认弹窗 */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        title="确认删除"
        message={`确定要删除${deleteTarget?.type === 'category' ? '分类' : '标签'} “${deleteTarget?.name}” 吗？此操作不可撤销。`}
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}


