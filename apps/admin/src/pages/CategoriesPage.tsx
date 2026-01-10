import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Folder, Tag as TagIcon, Loader2, Trash2, Edit2, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { categoryService, Category } from '@/services/categoryService';
import { tagService, Tag } from '@/services/tagService';
import { ConfirmModal } from '@aetherblog/ui';
import { logger } from '@/lib/logger';

export default function CategoriesPage() {
  const [activeTab, setActiveTab] = useState<'categories' | 'tags'>('categories');
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  
  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string; type: 'category' | 'tag' } | null>(null);

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

  const handleCreate = async () => {
    if (!newName.trim()) return;
    
    try {
      setCreating(true);
      if (activeTab === 'categories') {
        const res = await categoryService.create({ name: newName, description: newDescription });
        if (res.code === 200) {
          setShowCreateForm(false);
          setNewName('');
          setNewDescription('');
          fetchData();
        } else {
          alert(res.message || '创建失败');
        }
      } else {
        const res = await tagService.create({ name: newName });
        if (res.code === 200) {
          setShowCreateForm(false);
          setNewName('');
          fetchData();
        } else {
          alert(res.message || '创建失败');
        }
      }
    } catch (err: any) {
      logger.error('Create error:', err);
      alert(err.message || '创建失败');
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
          alert(res.message || '删除失败');
        }
      } else {
        const res = await tagService.delete(deleteTarget.id);
        if (res.code === 200) {
          fetchData();
        } else {
          alert(res.message || '删除失败');
        }
      }
    } catch (err: any) {
      logger.error('Delete error:', err);
      alert(err.message || '删除失败');
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
          <h1 className="text-2xl font-bold text-white">分类标签</h1>
          <p className="text-gray-400 mt-1">
            {activeTab === 'categories' ? `共 ${categories.length} 个分类` : `共 ${tags.length} 个标签`}
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowCreateForm(true)}
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

      {/* 创建表单 */}
      {showCreateForm && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-xl bg-white/5 border border-primary/30"
        >
          <div className="flex items-center gap-4">
            <input
              type="text"
              placeholder={activeTab === 'categories' ? '分类名称' : '标签名称'}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={cn(
                'flex-1 px-4 py-2 rounded-lg',
                'bg-white/5 border border-white/10',
                'text-white placeholder-gray-500',
                'focus:outline-none focus:border-primary/50'
              )}
              autoFocus
            />
            {activeTab === 'categories' && (
              <input
                type="text"
                placeholder="描述（可选）"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className={cn(
                  'flex-1 px-4 py-2 rounded-lg',
                  'bg-white/5 border border-white/10',
                  'text-white placeholder-gray-500',
                  'focus:outline-none focus:border-primary/50'
                )}
              />
            )}
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className={cn(
                'p-2 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors',
                (creating || !newName.trim()) && 'opacity-50 cursor-not-allowed'
              )}
            >
              {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
            </button>
            <button
              onClick={() => { setShowCreateForm(false); setNewName(''); setNewDescription(''); }}
              className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </motion.div>
      )}

      {/* 标签页切换 */}
      <div className="flex gap-1 p-1 bg-white/5 rounded-lg w-fit relative">
        <button
          onClick={() => { setActiveTab('categories'); setShowCreateForm(false); }}
          className={cn(
            'relative z-10 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2',
            activeTab === 'categories'
              ? 'text-white'
              : 'text-gray-400 hover:text-white'
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
          onClick={() => { setActiveTab('tags'); setShowCreateForm(false); }}
          className={cn(
            'relative z-10 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2',
            activeTab === 'tags'
              ? 'text-white'
              : 'text-gray-400 hover:text-white'
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
      <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="p-6 text-center text-red-400">{error}</div>
        ) : activeTab === 'categories' ? (
          categories.length === 0 ? (
            <div className="text-center py-12 text-gray-500">暂无分类，点击"新建分类"创建</div>
          ) : (
            <div className="divide-y divide-white/5">
              {categories.map((cat) => (
                <div key={cat.id} className="flex items-center justify-between px-6 py-4 hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Folder className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-white font-medium">{cat.name}</p>
                      <p className="text-gray-500 text-sm">{cat.description || '暂无描述'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-gray-400 text-sm">{cat.postCount || 0} 篇文章</span>
                    <div className="flex gap-2">
                      <button className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => setDeleteTarget({ id: cat.id, name: cat.name, type: 'category' })}
                        className="p-2 rounded-lg hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-colors"
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
            <div className="text-center py-12 text-gray-500">暂无标签，点击"新建标签"创建</div>
          ) : (
            <div className="p-6 flex flex-wrap gap-3">
              {tags.map((tag) => (
                <div
                  key={tag.id}
                  className="group flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:border-primary/50 transition-colors"
                >
                  <TagIcon className="w-4 h-4 text-primary" />
                  <span className="text-white">{tag.name}</span>
                  <span className="text-gray-500 text-sm">({tag.postCount || 0})</span>
                  <button 
                    onClick={() => setDeleteTarget({ id: tag.id, name: tag.name, type: 'tag' })}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )
        )}
      </div>

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


