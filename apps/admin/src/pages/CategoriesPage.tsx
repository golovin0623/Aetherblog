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

export default function CategoriesPage() {
  const [activeTab, setActiveTab] = useState<'categories' | 'tags'>('categories');
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string; type: 'category' | 'tag' } | null>(null);
  
  // Create modal state
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
          <div className="p-6 text-center text-red-400">{error}</div>
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
                        className="p-1.5 sm:p-2 rounded-lg hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 transition-colors"
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
            <div className="p-4 sm:p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {tags.map((tag, index) => {
                // Color variants based on index for visual variety
                const colorVariants = [
                  'from-primary/20 to-purple-500/10 border-primary/30 text-primary',
                  'from-blue-500/20 to-cyan-500/10 border-blue-500/30 text-blue-400',
                  'from-green-500/20 to-emerald-500/10 border-green-500/30 text-green-400',
                  'from-orange-500/20 to-amber-500/10 border-orange-500/30 text-orange-400',
                  'from-pink-500/20 to-rose-500/10 border-pink-500/30 text-pink-400',
                ];
                const colorClass = colorVariants[index % colorVariants.length];
                
                return (
                  <motion.div
                    key={tag.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.03 }}
                    className={`
                      group relative flex items-center justify-between gap-2 px-4 py-3 rounded-xl
                      bg-gradient-to-br ${colorClass.split(' ').slice(0, 2).join(' ')}
                      border ${colorClass.split(' ')[2]}
                      hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/10
                      transition-all duration-300 cursor-pointer
                    `}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <TagIcon className={`w-4 h-4 shrink-0 ${colorClass.split(' ')[3]}`} />
                      <span className="text-[var(--text-primary)] font-medium truncate">{tag.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-overlay)] px-2 py-0.5 rounded-full">
                        {tag.postCount || 0}
                      </span>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: tag.id, name: tag.name, type: 'tag' }); }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400 transition-all"
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


