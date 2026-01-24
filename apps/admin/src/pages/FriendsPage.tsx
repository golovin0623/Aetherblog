import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Globe, Loader2, Save, X, RotateCcw } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { cn } from '@/lib/utils';
import { friendService, FriendLink } from '@/services/friendService';
import { toast } from 'sonner';
import { 
  DndContext, 
  closestCenter, 
  PointerSensor, 
  useSensor, 
  useSensors, 
  DragEndEvent 
} from '@dnd-kit/core';
import { 
  SortableContext, 
  verticalListSortingStrategy,
  arrayMove
} from '@dnd-kit/sortable';
import { SortableFriendItem } from './friends/components/SortableFriendItem';

// Zod 模式和类型
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

export default function FriendsPage() {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const queryClient = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // 查询：获取所有友链
  const { data: friends = [], isLoading } = useQuery({
    queryKey: ['friends'],
    queryFn: () => friendService.getAll(),
  });

  // 乐观排序的本地状态
  const [items, setItems] = useState<FriendLink[]>([]);
  // 当友链数据更新时同步项
  if (friends.length > 0 && items.length === 0 && !isLoading) {
      // 如果小心处理循环，可以在渲染期间使用 useEffect 或简单检查
      // 最好使用 useEffect，但在渲染中简单赋值有风险。
      // 在完整实现中让我们使用 useEffect。
      // 目前更简单的方法：DndContext 中的派生状态通过 friends 数组处理，
      // 但重新排序需要本地状态才能平滑。
  }
  // 目前直接使用查询数据，并通过突变乐观地处理重新排序
  
  // 表单设置
  const form = useForm<FriendFormData>({
    resolver: zodResolver(friendSchema),
    defaultValues: { name: '', url: '', description: '', logo: '', email: '', themeColor: '#6366f1', rssUrl: '' },
  });

  // 突变：创建/更新
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
    onError: (err: any) => {
      toast.error(err.message || '操作失败');
    }
  });

  // 突变：删除
  const deleteMutation = useMutation({
    mutationFn: (id: number) => friendService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      toast.success('友链已删除');
    }
  });

  // 突变：切换可见性
  const toggleMutation = useMutation({
    mutationFn: (id: number) => friendService.toggleVisible(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      toast.success('状态已更新');
    }
  });

  // 突变：重新排序
  const reorderMutation = useMutation({
    mutationFn: (ids: number[]) => friendService.reorder(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      toast.success('排序已保存');
    }
  });

  // 辅助函数：打开表单
  const handleEdit = (friend: FriendLink) => {
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
  };

  const handleCloseForm = () => {
    setEditingId(null);
    setIsFormOpen(false);
    form.reset({ name: '', url: '', description: '', logo: '', email: '', themeColor: '#6366f1', rssUrl: '' });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id && friends) {
      const oldIndex = friends.findIndex(f => f.id === active.id);
      const newIndex = friends.findIndex(f => f.id === over?.id);
      
      const newOrder = arrayMove(friends, oldIndex, newIndex);
      
      // 如果使用本地状态则进行 UI 乐观更新，但此处我们触发 API
      // 在实际应用中，我们应该先更新本地状态。
      // 由于依赖 RQ 缓存，我们直接触发突变。
      // 理想情况下 queryClient.setQueryData(['friends'], newOrder);
      queryClient.setQueryData(['friends'], newOrder); 

      reorderMutation.mutate(newOrder.map(f => f.id));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">友情链接</h1>
          <p className="text-[var(--text-muted)] mt-1">管理和排序您的友情链接</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => { setIsFormOpen(true); form.reset(); setEditingId(null); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> 添加友链
        </motion.button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 列表区域 */}
        <div className="lg:col-span-2 space-y-4">
          <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] min-h-[500px]">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-64 text-gray-500 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p>加载中...</p>
              </div>
            ) : friends.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-[var(--text-muted)] gap-4">
                <div className="w-16 h-16 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center">
                  <Globe className="w-8 h-8 opacity-50" />
                </div>
                <p>暂无友链，点击右上角添加</p>
              </div>
            ) : (
              <DndContext 
                sensors={sensors} 
                collisionDetection={closestCenter} 
                onDragEnd={handleDragEnd}
              >
                <SortableContext 
                  items={friends.map(f => f.id)} 
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-3">
                    {friends.map((friend) => (
                      <SortableFriendItem
                        key={friend.id}
                        friend={friend}
                        onEdit={() => handleEdit(friend)}
                        onDelete={() => {
                          if (window.confirm('确定要删除这个友链吗？')) {
                            deleteMutation.mutate(friend.id);
                          }
                        }}
                        onToggleVisible={() => toggleMutation.mutate(friend.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>

        {/* 表单区域 - 粘性侧边栏 */}
        <AnimatePresence>
          {isFormOpen && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="lg:col-span-1"
            >
              <div className="sticky top-6 p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] backdrop-blur-md">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                    {editingId ? '编辑友链' : '添加友链'}
                  </h3>
                  <button 
                    onClick={handleCloseForm}
                    className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={form.handleSubmit((data) => saveMutation.mutate(data))} className="space-y-4">
                  {/* 名称 */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--text-secondary)]">网站名称 *</label>
                    <input
                      {...form.register('name')}
                      className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-[var(--text-muted)] transition-all"
                      placeholder="例如: AetherBlog"
                    />
                    {form.formState.errors.name && (
                      <p className="text-xs text-red-400">{form.formState.errors.name.message}</p>
                    )}
                  </div>

                  {/* 网址 */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--text-secondary)]">网站地址 *</label>
                    <input
                      {...form.register('url')}
                      className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-[var(--text-muted)] transition-all"
                      placeholder="https://..."
                    />
                    {form.formState.errors.url && (
                      <p className="text-xs text-red-400">{form.formState.errors.url.message}</p>
                    )}
                  </div>

                  {/* Logo */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--text-secondary)]">Logo 链接</label>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <input
                          {...form.register('logo')}
                          className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-[var(--text-muted)] transition-all"
                          placeholder="https://..."
                        />
                      </div>
                      <div className="w-9 h-9 rounded bg-[var(--bg-input)] border border-[var(--border-subtle)] flex items-center justify-center overflow-hidden shrink-0">
                        {form.watch('logo') ? (
                          <img src={form.watch('logo')} alt="preview" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
                        ) : (
                          <Globe className="w-4 h-4 text-gray-600" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 描述 */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--text-secondary)]">描述</label>
                    <textarea
                      {...form.register('description')}
                      rows={3}
                      className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-[var(--text-muted)] transition-all resize-none"
                      placeholder="简短介绍..."
                    />
                  </div>

                  {/* 高级 - 邮箱/RSS/颜色 */}
                  <div className="pt-2 border-t border-[var(--border-subtle)] space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      {/* 主题色 */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--text-secondary)]">主题色</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            {...form.register('themeColor')}
                            className="bg-transparent border-0 w-8 h-8 p-0 cursor-pointer"
                          />
                          <input
                            {...form.register('themeColor')}
                            className="flex-1 px-2 py-1.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-xs font-mono"
                          />
                        </div>
                      </div>
                      
                      {/* 邮箱 */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--text-secondary)]">联系邮箱</label>
                        <input
                          {...form.register('email')}
                          className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm focus:border-primary/50 focus:outline-none placeholder:text-[var(--text-muted)]"
                          placeholder="admin@..."
                        />
                      </div>
                    </div>

                    {/* RSS */}
                    <div className="space-y-1.5">
                       <label className="text-xs font-medium text-[var(--text-secondary)]">RSS 地址</label>
                       <input
                          {...form.register('rssUrl')}
                          className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm focus:border-primary/50 focus:outline-none placeholder:text-[var(--text-muted)]"
                          placeholder="https://.../feed"
                        />
                    </div>
                  </div>

                  <div className="pt-4 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleCloseForm}
                      className="flex-1 px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors text-sm"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={saveMutation.isPending}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saveMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      {editingId ? '保存修改' : '确认添加'}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
