import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tag as TagIcon, X } from 'lucide-react';
import { mediaTagService } from '@/services/mediaTagService';
import type { MediaTag } from '@aetherblog/types';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@aetherblog/utils';

/**
 * 标签筛选栏组件 - 用于MediaPage顶部筛选
 *
 * @ref 媒体库深度优化方案 - Phase 2: 智能标签系统
 */

interface TagFilterBarProps {
  selectedTagIds: number[];
  onTagsChange: (tagIds: number[]) => void;
}

export function TagFilterBar({ selectedTagIds, onTagsChange }: TagFilterBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // 获取热门标签
  const { data: tagsResponse } = useQuery({
    queryKey: ['media-tags', 'popular'],
    queryFn: () => mediaTagService.getPopular(10),
  });

  const tags = tagsResponse?.data || [];
  const selectedTags = tags.filter(tag => selectedTagIds.includes(tag.id));

  const handleToggleTag = (tagId: number) => {
    const newSelected = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter(id => id !== tagId)
      : [...selectedTagIds, tagId];
    onTagsChange(newSelected);
  };

  const handleClearAll = () => {
    onTagsChange([]);
  };

  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {/* 已选标签 */}
      {selectedTags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-[var(--text-muted)]">已选:</span>
          {selectedTags.map(tag => (
            <motion.button
              key={tag.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={() => handleToggleTag(tag.id)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white/10 border border-white/20 text-white hover:bg-white/15 transition-all"
              style={{
                borderColor: tag.color + '80',
                backgroundColor: tag.color + '20',
              }}
            >
              <TagIcon className="w-3 h-3" style={{ color: tag.color }} />
              <span>{tag.name}</span>
              <X className="w-3 h-3" />
            </motion.button>
          ))}
          <button
            onClick={handleClearAll}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            清除全部
          </button>
        </div>
      )}

      {/* 标签选择器 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
            "border backdrop-blur-sm",
            isExpanded || selectedTagIds.length > 0
              ? "bg-primary/10 border-primary/30 text-primary"
              : "bg-white/5 border-white/10 text-[var(--text-secondary)] hover:bg-white/10"
          )}
        >
          <TagIcon className="w-4 h-4" />
          <span>按标签筛选</span>
          {selectedTagIds.length > 0 && (
            <span className="px-1.5 py-0.5 bg-primary/20 rounded text-xs">
              {selectedTagIds.length}
            </span>
          )}
        </button>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              className="flex items-center gap-2 flex-wrap overflow-hidden"
            >
              {tags.map(tag => {
                const isSelected = selectedTagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => handleToggleTag(tag.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all",
                      "border backdrop-blur-sm",
                      isSelected
                        ? "bg-white/10 border-white/20 text-white"
                        : "bg-white/5 border-white/10 text-[var(--text-secondary)] hover:bg-white/10"
                    )}
                    style={{
                      borderColor: isSelected ? tag.color + '80' : undefined,
                      backgroundColor: isSelected ? tag.color + '20' : undefined,
                    }}
                  >
                    <TagIcon className="w-3 h-3" style={{ color: tag.color }} />
                    <span>{tag.name}</span>
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
