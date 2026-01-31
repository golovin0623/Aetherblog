/**
 * @file EditorSettingsPanel.tsx
 * @description 文章编辑器设置侧边栏 - 包含设置、分类标签、封面图片、摘要等可折叠区块
 * @ref §3.2.3.3 - 文章编辑器页面设计
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, ChevronUp, Folder, Tag, Image, FileText,
  Plus, X, Search, Loader2, Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Category } from '@/services/categoryService';
import { Tag as TagType } from '@/services/tagService';

interface EditorSettingsPanelProps {
  // 分类
  categories: Category[];
  selectedCategory: Category | null;
  onCategorySelect: (category: Category | null) => void;
  onCreateCategory: () => void;
  loadingCategories: boolean;
  
  // 标签
  tags: TagType[];
  selectedTags: TagType[];
  onTagAdd: (tag: TagType) => void;
  onTagRemove: (tagId: number) => void;
  onTagCreate: (name: string) => Promise<void>;
  loadingTags: boolean;
  
  // 摘要
  summary: string;
  onSummaryChange: (value: string) => void;
  
  // 封面图片 (未来实现的占位符)
  coverUrl?: string;
  onCoverChange?: (url: string) => void;
}

// 可折叠区块包装器
function SettingsSection({ 
  title, 
  icon: Icon, 
  children,
  defaultOpen = true,
  badge,
}: { 
  title: string; 
  icon: React.ElementType; 
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string | number;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-card-hover)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-[var(--text-muted)]" />
          <span className="text-sm font-medium text-[var(--text-primary)]">{title}</span>
          {badge !== undefined && (
            <span className="px-1.5 py-0.5 text-xs rounded-full bg-primary/20 text-primary">
              {badge}
            </span>
          )}
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-[var(--text-muted)]" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
        )}
      </button>
      
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-4 pb-4 border-t border-[var(--border-subtle)]">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function EditorSettingsPanel({
  categories,
  selectedCategory,
  onCategorySelect,
  onCreateCategory,
  loadingCategories,
  tags,
  selectedTags,
  onTagAdd,
  onTagRemove,
  onTagCreate,
  loadingTags,
  summary,
  onSummaryChange,
  coverUrl: _coverUrl,
  onCoverChange: _onCoverChange,
}: EditorSettingsPanelProps) {
  const [categorySearch, setCategorySearch] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [creatingTag, setCreatingTag] = useState(false);

  // 筛选的分类
  const filteredCategories = useMemo(() => {
    if (!categorySearch) return categories;
    return categories.filter(c =>
      c.name.toLowerCase().includes(categorySearch.toLowerCase())
    );
  }, [categories, categorySearch]);

  // 筛选的标签（排除已选中的）
  const filteredTags = useMemo(() => {
    const unselected = tags.filter(t => !selectedTags.find(s => s.id === t.id));
    if (!tagSearch) return unselected;
    return unselected.filter(t =>
      t.name.toLowerCase().includes(tagSearch.toLowerCase())
    );
  }, [tags, tagSearch, selectedTags]);

  const handleTagKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && tagSearch.trim()) {
      e.preventDefault();
      const existing = tags.find(t => t.name.toLowerCase() === tagSearch.toLowerCase());
      if (existing) {
        if (!selectedTags.find(s => s.id === existing.id)) {
          onTagAdd(existing);
        }
      } else {
        setCreatingTag(true);
        try {
          await onTagCreate(tagSearch.trim());
        } finally {
          setCreatingTag(false);
        }
      }
      setTagSearch('');
      setShowTagDropdown(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="w-[340px] flex-shrink-0 space-y-3 overflow-y-auto max-h-[calc(100vh-8rem)]"
    >
      {/* 分类部分 */}
      <SettingsSection title="分类" icon={Folder}>
        <div className="pt-3 space-y-2">
          {/* 搜索 */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <input
              type="text"
              value={categorySearch}
              onChange={e => setCategorySearch(e.target.value)}
              placeholder="搜索分类..."
              className="w-full pl-9 pr-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-primary/50"
            />
          </div>
          
          {/* 分类列表 */}
          <div className="max-h-40 overflow-y-auto space-y-1">
            {loadingCategories ? (
              <div className="py-4 text-center">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-500" />
              </div>
            ) : filteredCategories.length === 0 ? (
              <div className="py-3 text-center text-sm text-gray-500">暂无分类</div>
            ) : (
              filteredCategories.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => onCategorySelect(selectedCategory?.id === cat.id ? null : cat)}
                  className={cn(
                    'w-full px-3 py-2 rounded-lg text-left text-sm transition-colors',
                    selectedCategory?.id === cat.id
                      ? 'bg-primary/20 text-primary border border-primary/30'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
                  )}
                >
                  {cat.name}
                </button>
              ))
            )}
          </div>
          
          {/* 创建新分类 */}
          <button
            type="button"
            onClick={onCreateCategory}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-[var(--bg-card-hover)] rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            新建分类
          </button>
        </div>
      </SettingsSection>

      {/* 标签部分 */}
      <SettingsSection 
        title="标签" 
        icon={Tag} 
        badge={selectedTags.length > 0 ? selectedTags.length : undefined}
      >
        <div className="pt-3 space-y-3">
          {/* 已选标签 */}
          {selectedTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedTags.map(tag => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-primary/20 text-primary rounded-md text-sm"
                >
                  {tag.name}
                  <button
                    type="button"
                    onClick={() => onTagRemove(tag.id)}
                    className="hover:text-white transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          
          {/* 标签输入 */}
          <div className="relative">
              <input
                type="text"
                value={tagSearch}
                onChange={e => { setTagSearch(e.target.value); setShowTagDropdown(true); }}
                onFocus={() => setShowTagDropdown(true)}
                onKeyDown={handleTagKeyDown}
                placeholder="搜索或输入新标签，回车添加"
                className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-primary/50"
                disabled={creatingTag}
              />
            {creatingTag && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary" />
            )}
            
            {/* 标签下拉框 */}
            <AnimatePresence>
              {showTagDropdown && (tagSearch || filteredTags.length > 0) && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute z-20 w-full mt-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg shadow-xl max-h-40 overflow-y-auto"
                >
                  {loadingTags ? (
                    <div className="py-4 text-center">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto text-[var(--text-muted)]" />
                    </div>
                  ) : (
                    <>
                      {filteredTags.slice(0, 8).map(tag => (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => {
                            onTagAdd(tag);
                            setTagSearch('');
                            setShowTagDropdown(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
                        >
                          {tag.name}
                        </button>
                      ))}
                      {tagSearch && !tags.find(t => t.name.toLowerCase() === tagSearch.toLowerCase()) && (
                        <button
                          type="button"
                          onClick={() => handleTagKeyDown({ key: 'Enter', preventDefault: () => {} } as React.KeyboardEvent<HTMLInputElement>)}
                          className="w-full px-3 py-2 text-left text-sm text-primary hover:bg-white/10 transition-colors flex items-center gap-2"
                        >
                          <Plus className="w-4 h-4" />
                          创建 "{tagSearch}"
                        </button>
                      )}
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </SettingsSection>

      {/* 封面图片部分 */}
      <SettingsSection title="封面图片" icon={Image} defaultOpen={false}>
        <div className="pt-3">
          <div className="border-2 border-dashed border-[var(--border-subtle)] rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer">
            <Image className="w-8 h-8 mx-auto mb-2 text-[var(--text-muted)]" />
            <p className="text-[var(--text-muted)] text-sm">点击或拖拽上传</p>
            <p className="text-[var(--text-muted)] text-xs mt-1">支持 JPG、PNG、WebP (最大 5MB)</p>
          </div>
        </div>
      </SettingsSection>

      {/* 摘要部分 */}
      <SettingsSection title="摘要" icon={FileText}>
        <div className="pt-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500">
              {summary.length} / 200 字符
            </span>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
            >
              <Sparkles className="w-3 h-3" />
              AI 生成
            </button>
          </div>
          <textarea
            rows={4}
            value={summary}
            onChange={e => onSummaryChange(e.target.value)}
            maxLength={200}
            placeholder="文章摘要，为空将自动截取前200字..."
            className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none focus:outline-none focus:border-primary/50"
          />
        </div>
      </SettingsSection>
    </motion.div>
  );
}

export default EditorSettingsPanel;
