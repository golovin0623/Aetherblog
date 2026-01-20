import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Tag as TagIcon, Hash } from 'lucide-react';
import { Button } from '@aetherblog/ui';
import { mediaTagService } from '@/services/mediaTagService';
import type { MediaTag, CreateMediaTagRequest } from '@aetherblog/types';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@aetherblog/utils';

/**
 * 标签管理器组件
 *
 * @ref 媒体库深度优化方案 - Phase 2: 智能标签系统
 */

interface TagManagerProps {
  fileId?: number;
  selectedTags?: number[];
  onTagsChange?: (tagIds: number[]) => void;
  mode?: 'manage' | 'select';
}

export function TagManager({
  fileId,
  selectedTags = [],
  onTagsChange,
  mode = 'select',
}: TagManagerProps) {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');

  // 获取所有标签
  const { data: tagsResponse } = useQuery({
    queryKey: ['media-tags'],
    queryFn: () => mediaTagService.getAll(),
  });

  const tags = tagsResponse?.data || [];

  // 获取文件的标签
  const { data: fileTagsResponse } = useQuery({
    queryKey: ['media-file-tags', fileId],
    queryFn: () => fileId ? mediaTagService.getFileTags(fileId) : null,
    enabled: !!fileId,
  });

  const fileTags = fileTagsResponse?.data || [];
  const fileTagIds = fileTags.map(t => t.id);

  // 创建标签
  const createTagMutation = useMutation({
    mutationFn: (data: CreateMediaTagRequest) => mediaTagService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-tags'] });
      setNewTagName('');
      setIsCreating(false);
    },
  });

  // 给文件打标签
  const tagFileMutation = useMutation({
    mutationFn: ({ tagId }: { tagId: number }) => {
      if (!fileId) return Promise.reject('No file ID');
      return mediaTagService.tagFile(fileId, [tagId]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-file-tags', fileId] });
    },
  });

  // 取消文件标签
  const untagFileMutation = useMutation({
    mutationFn: ({ tagId }: { tagId: number }) => {
      if (!fileId) return Promise.reject('No file ID');
      return mediaTagService.untagFile(fileId, tagId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-file-tags', fileId] });
    },
  });

  // 删除标签
  const deleteTagMutation = useMutation({
    mutationFn: (tagId: number) => mediaTagService.delete(tagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-tags'] });
    },
  });

  const handleCreateTag = () => {
    if (!newTagName.trim()) return;

    createTagMutation.mutate({
      name: newTagName.trim(),
      color: getRandomColor(),
    });
  };

  const handleToggleTag = (tagId: number) => {
    if (mode === 'select' && onTagsChange) {
      // 选择模式 - 用于筛选
      const newSelected = selectedTags.includes(tagId)
        ? selectedTags.filter(id => id !== tagId)
        : [...selectedTags, tagId];
      onTagsChange(newSelected);
    } else if (fileId) {
      // 文件模式 - 给文件打标签
      if (fileTagIds.includes(tagId)) {
        untagFileMutation.mutate({ tagId });
      } else {
        tagFileMutation.mutate({ tagId });
      }
    }
  };

  const handleDeleteTag = (tagId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('确定要删除这个标签吗？')) {
      deleteTagMutation.mutate(tagId);
    }
  };

  const filteredTags = searchKeyword
    ? tags.filter(tag => tag.name.toLowerCase().includes(searchKeyword.toLowerCase()))
    : tags;

  const isTagSelected = (tagId: number) => {
    if (mode === 'select') {
      return selectedTags.includes(tagId);
    }
    return fileTagIds.includes(tagId);
  };

  return (
    <div className="space-y-4">
      {/* 搜索和创建 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="搜索标签..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[var(--bg-secondary)] border border-white/10 rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-primary/50"
          />
        </div>

        {mode === 'manage' && (
          <Button
            onClick={() => setIsCreating(!isCreating)}
            variant="secondary"
            size="sm"
          >
            <Plus className="w-4 h-4" />
            新建
          </Button>
        )}
      </div>

      {/* 创建标签表单 */}
      <AnimatePresence>
        {isCreating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex gap-2 p-4 bg-white/5 border border-white/10 rounded-lg">
              <input
                type="text"
                placeholder="标签名称"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
                className="flex-1 px-3 py-2 bg-[var(--bg-secondary)] border border-white/10 rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-primary/50"
                autoFocus
              />
              <Button
                onClick={handleCreateTag}
                disabled={!newTagName.trim() || createTagMutation.isPending}
                size="sm"
              >
                创建
              </Button>
              <Button
                onClick={() => {
                  setIsCreating(false);
                  setNewTagName('');
                }}
                variant="secondary"
                size="sm"
              >
                取消
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 标签列表 */}
      <div className="flex flex-wrap gap-2">
        <AnimatePresence>
          {filteredTags.map((tag) => {
            const selected = isTagSelected(tag.id);

            return (
              <motion.button
                key={tag.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                onClick={() => handleToggleTag(tag.id)}
                className={cn(
                  'group relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                  'border backdrop-blur-sm',
                  selected
                    ? 'bg-white/10 border-white/20 text-white shadow-lg'
                    : 'bg-white/5 border-white/10 text-[var(--text-secondary)] hover:bg-white/10 hover:border-white/20'
                )}
                style={{
                  borderColor: selected ? tag.color + '80' : undefined,
                  backgroundColor: selected ? tag.color + '20' : undefined,
                }}
              >
                <TagIcon className="w-3.5 h-3.5" style={{ color: tag.color }} />
                <span>{tag.name}</span>

                {tag.usageCount > 0 && (
                  <span className="text-xs text-[var(--text-muted)]">
                    {tag.usageCount}
                  </span>
                )}

                {mode === 'manage' && (
                  <button
                    onClick={(e) => handleDeleteTag(tag.id, e)}
                    className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3.5 h-3.5 text-red-400 hover:text-red-300" />
                  </button>
                )}
              </motion.button>
            );
          })}
        </AnimatePresence>

        {filteredTags.length === 0 && (
          <div className="w-full text-center py-8 text-[var(--text-muted)]">
            {searchKeyword ? '未找到匹配的标签' : '暂无标签'}
          </div>
        )}
      </div>

      {/* 统计信息 */}
      {mode === 'select' && selectedTags.length > 0 && (
        <div className="text-sm text-[var(--text-muted)]">
          已选择 {selectedTags.length} 个标签
        </div>
      )}
    </div>
  );
}

// 随机颜色生成
function getRandomColor(): string {
  const colors = [
    '#6366f1', // indigo
    '#8b5cf6', // purple
    '#ec4899', // pink
    '#f43f5e', // rose
    '#f59e0b', // amber
    '#10b981', // emerald
    '#06b6d4', // cyan
    '#3b82f6', // blue
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}
