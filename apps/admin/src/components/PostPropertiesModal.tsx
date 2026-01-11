'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@aetherblog/ui';
import { PostListItem, UpdatePostPropertiesRequest } from '@/types/post';
import { Category } from '@/services/categoryService';
import { Tag } from '@/services/tagService';
import { X, Calendar, Eye, EyeOff } from 'lucide-react';
import { motion } from 'framer-motion';

interface PostPropertiesModalProps {
  isOpen: boolean;
  onClose: () => void;
  post: PostListItem;
  categories: Category[];
  tags: Tag[];
  onSave: (data: UpdatePostPropertiesRequest) => Promise<void>;
}

export function PostPropertiesModal({
  isOpen,
  onClose,
  post,
  categories,
  tags,
  onSave,
}: PostPropertiesModalProps) {
  const [formData, setFormData] = useState<UpdatePostPropertiesRequest>({});
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (isOpen && post) {
      // Initialize form data with current post values
      setFormData({
        title: post.title,
        summary: post.summary || '',
        coverImage: post.coverImage || '',
        status: post.status,
        isPinned: post.isPinned || false,
        pinPriority: post.pinPriority || 0,
        slug: post.slug,
        createdAt: post.createdAt,
      });
      setSelectedTags([]);
    }
  }, [isOpen, post]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSave({
        ...formData,
        tagIds: selectedTags.length > 0 ? selectedTags : undefined,
      });
      onClose();
    } catch (error) {
      console.error('Failed to update post properties:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleTag = (tagId: number) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" title="修改信息">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 文章标题 */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            <span className="text-red-400">*</span> 文章标题
          </label>
          <input
            type="text"
            value={formData.title || ''}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
            required
          />
        </div>

        {/* 作者 (只读显示) */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">作者</label>
          <div className="px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-400">
            Golovin
          </div>
        </div>

        {/* 标签 */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">标签</label>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                  selectedTags.includes(tag.id)
                    ? 'bg-primary text-white'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                }`}
              >
                {tag.name}
                {selectedTags.includes(tag.id) && (
                  <X className="inline-block w-3 h-3 ml-1" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 分类 */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            <span className="text-red-400">*</span> 分类
          </label>
          <select
            value={formData.categoryId || ''}
            onChange={(e) =>
              setFormData({ ...formData, categoryId: Number(e.target.value) })
            }
            className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
            required
          >
            <option value="">选择分类</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        {/* 创建时间 */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">创建时间</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="datetime-local"
              value={
                formData.createdAt
                  ? new Date(formData.createdAt).toISOString().slice(0, 16)
                  : ''
              }
              onChange={(e) =>
                setFormData({ ...formData, createdAt: e.target.value })
              }
              className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
            />
          </div>
        </div>

        {/* 置顶优先级 */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            置顶优先级
          </label>
          <input
            type="number"
            value={formData.pinPriority || 0}
            onChange={(e) =>
              setFormData({ ...formData, pinPriority: Number(e.target.value) })
            }
            min="0"
            className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          />
          <p className="text-xs text-gray-500 mt-1">数值越大优先级越高，0 表示不置顶</p>
        </div>

        {/* 自定义路径名 */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            自定义路径名
          </label>
          <input
            type="text"
            value={formData.slug || ''}
            onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
            placeholder="留空或为空则使用 id 作为路径名"
            className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          />
        </div>

        {/* 是否加密 */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">是否加密</label>
          <select
            value={formData.password ? 'yes' : 'no'}
            onChange={(e) => {
              if (e.target.value === 'no') {
                setFormData({ ...formData, password: '' });
              }
            }}
            className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          >
            <option value="no">否</option>
            <option value="yes">是</option>
          </select>
        </div>

        {/* 密码输入 */}
        {formData.password !== '' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <label className="block text-sm font-medium text-gray-300 mb-2">密码</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={formData.password || ''}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="请输入密码"
                className="w-full px-4 py-2.5 pr-10 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </motion.div>
        )}

        {/* 是否隐藏 */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">是否隐藏</label>
          <select
            value={formData.status || 'PUBLISHED'}
            onChange={(e) =>
              setFormData({
                ...formData,
                status: e.target.value as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED',
              })
            }
            className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          >
            <option value="PUBLISHED">否</option>
            <option value="ARCHIVED">是</option>
          </select>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/5">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? '保存中...' : '保存'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
