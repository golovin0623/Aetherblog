import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Save, Settings, Sparkles, ArrowLeft, Send, 
  Bold, Italic, Strikethrough, Code, List, ListOrdered,
  Link2, Image, Quote, Heading1, Heading2, Heading3,
  X, ChevronDown, Plus, Search, Loader2, CheckCircle, AlertCircle
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { EditorWithPreview } from '@aetherblog/editor';
import { cn } from '@/lib/utils';
import { categoryService, Category } from '@/services/categoryService';
import { tagService, Tag } from '@/services/tagService';
import { postService } from '@/services/postService';

export function CreatePostPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;
  const postId = id ? parseInt(id, 10) : null;
  
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [summary, setSummary] = useState('');
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [_loadingPost, setLoadingPost] = useState(false);
  const [_postStatus, setPostStatus] = useState<'DRAFT' | 'PUBLISHED'>('DRAFT');
  // Quick create category modal
  const [showCreateCategoryModal, setShowCreateCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);

  // Category state
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [categorySearch, setCategorySearch] = useState('');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(false);

  // Tag state
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [loadingTags, setLoadingTags] = useState(false);
  const [creatingTag, setCreatingTag] = useState(false);

  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch categories and tags on mount
  useEffect(() => {
    const fetchData = async () => {
      setLoadingCategories(true);
      setLoadingTags(true);
      try {
        const [catRes, tagRes] = await Promise.all([
          categoryService.getList(),
          tagService.getList()
        ]);
        if (catRes.data) setCategories(catRes.data);
        if (tagRes.data) setTags(tagRes.data);
      } catch (error) {
        console.error('Failed to fetch categories/tags:', error);
      } finally {
        setLoadingCategories(false);
        setLoadingTags(false);
      }
    };
    fetchData();
  }, []);

  // Load existing post when in edit mode
  useEffect(() => {
    if (isEditMode && postId) {
      const loadPost = async () => {
        setLoadingPost(true);
        try {
          const res = await postService.getById(postId);
          if (res.code === 200 && res.data) {
            const post = res.data;
            setTitle(post.title);
            setContent(post.content);
            setSummary(post.summary || '');
            setPostStatus(post.status as 'DRAFT' | 'PUBLISHED');
            // Set category if exists
            if (post.categoryId) {
              const cat = categories.find(c => c.id === post.categoryId);
              if (cat) setSelectedCategory(cat);
            }
            // Set tags if exist
            if (post.tags && post.tags.length > 0) {
              const tagIds = post.tags.map((t: any) => t.id);
              const matchedTags = tags.filter(t => tagIds.includes(t.id));
              setSelectedTags(matchedTags);
            }
          }
        } catch (error) {
          console.error('Failed to load post:', error);
          setSaveMessage({ type: 'error', text: '加载文章失败' });
        } finally {
          setLoadingPost(false);
        }
      };
      // Wait for categories/tags to load first
      if (categories.length > 0 || tags.length > 0) {
        loadPost();
      }
    }
  }, [isEditMode, postId, categories, tags]);

  // Click outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) {
        setShowCategoryDropdown(false);
      }
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setShowTagDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filtered categories based on search
  const filteredCategories = useMemo(() => {
    if (!categorySearch) return categories;
    return categories.filter(c => 
      c.name.toLowerCase().includes(categorySearch.toLowerCase())
    );
  }, [categories, categorySearch]);

  // Filtered tags based on search
  const filteredTags = useMemo(() => {
    if (!tagSearch) return tags.filter(t => !selectedTags.find(s => s.id === t.id));
    return tags.filter(t => 
      t.name.toLowerCase().includes(tagSearch.toLowerCase()) &&
      !selectedTags.find(s => s.id === t.id)
    );
  }, [tags, tagSearch, selectedTags]);

  // Character and word count
  const stats = useMemo(() => {
    const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (content.match(/[a-zA-Z]+/g) || []).length;
    return {
      words: chineseChars + englishWords,
      chars: content.length,
    };
  }, [content]);

  const insertMarkdown = useCallback((prefix: string, suffix: string = '') => {
    setContent((prev) => prev + prefix + suffix);
  }, []);

  // Validation check
  const validatePost = (forPublish = false) => {
    if (!title.trim()) {
      setSaveMessage({ type: 'error', text: '请输入文章标题' });
      return false;
    }
    if (!content.trim()) {
      setSaveMessage({ type: 'error', text: '请输入文章内容' });
      return false;
    }
    // Category required for publishing
    if (forPublish && !selectedCategory) {
      setSaveMessage({ type: 'error', text: '发布文章请先选择分类' });
      // Open settings panel and show category dropdown
      setShowSettings(true);
      setShowCategoryDropdown(true);
      return false;
    }
    return true;
  };

  // Create new category
  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    
    setCreatingCategory(true);
    try {
      const res = await categoryService.create({ name: newCategoryName.trim() });
      if (res.data) {
        setCategories([...categories, res.data]);
        setSelectedCategory(res.data);
        setNewCategoryName('');
        setShowCreateCategoryModal(false);
        setSaveMessage({ type: 'success', text: `分类 “${res.data.name}” 创建成功` });
      }
    } catch (error) {
      console.error('Create category error:', error);
      setSaveMessage({ type: 'error', text: '创建分类失败' });
    } finally {
      setCreatingCategory(false);
    }
  };

  // Save as draft
  const handleSave = async () => {
    if (!validatePost()) return;
    
    setIsSaving(true);
    setSaveMessage(null);
    
    try {
      const res = isEditMode && postId
        ? await postService.update(postId, {
            title: title.trim(),
            content,
            summary: summary.trim() || undefined,
            categoryId: selectedCategory?.id,
            tagIds: selectedTags.map(t => t.id),
            status: 'DRAFT',
          })
        : await postService.create({
            title: title.trim(),
            content,
            summary: summary.trim() || undefined,
            categoryId: selectedCategory?.id,
            tagIds: selectedTags.map(t => t.id),
            status: 'DRAFT',
          });
      
      if (res.code === 200 && res.data) {
        setSaveMessage({ type: 'success', text: '草稿保存成功！' });
        // Navigate to edit page after short delay
        setTimeout(() => navigate('/posts'), 1500);
      } else {
        setSaveMessage({ type: 'error', text: res.message || '保存失败' });
      }
    } catch (error) {
      console.error('Save error:', error);
      setSaveMessage({ type: 'error', text: '保存失败，请重试' });
    } finally {
      setIsSaving(false);
    }
  };

  // Publish post
  const handlePublish = async () => {
    if (!validatePost(true)) return; // true = forPublish, requires category
    
    setIsPublishing(true);
    setSaveMessage(null);
    
    try {
      const res = isEditMode && postId
        ? await postService.update(postId, {
            title: title.trim(),
            content,
            summary: summary.trim() || undefined,
            categoryId: selectedCategory?.id,
            tagIds: selectedTags.map(t => t.id),
            status: 'PUBLISHED',
          })
        : await postService.create({
            title: title.trim(),
            content,
            summary: summary.trim() || undefined,
            categoryId: selectedCategory?.id,
            tagIds: selectedTags.map(t => t.id),
            status: 'PUBLISHED',
          });
      
      if (res.code === 200 && res.data) {
        setSaveMessage({ type: 'success', text: '文章发布成功！' });
        setTimeout(() => navigate('/posts'), 1500);
      } else {
        setSaveMessage({ type: 'error', text: res.message || '发布失败' });
      }
    } catch (error) {
      console.error('Publish error:', error);
      setSaveMessage({ type: 'error', text: '发布失败，请重试' });
    } finally {
      setIsPublishing(false);
    }
  };

  // Clear message after 3 seconds
  useEffect(() => {
    if (saveMessage) {
      const timer = setTimeout(() => setSaveMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveMessage]);

  const handleTagKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && tagSearch.trim()) {
      e.preventDefault();
      // Check if tag already exists
      const existing = tags.find(t => t.name.toLowerCase() === tagSearch.toLowerCase());
      if (existing) {
        if (!selectedTags.find(s => s.id === existing.id)) {
          setSelectedTags([...selectedTags, existing]);
        }
      } else {
        // Create new tag
        setCreatingTag(true);
        try {
          const res = await tagService.create({ name: tagSearch.trim() });
          if (res.data) {
            setTags([...tags, res.data]);
            setSelectedTags([...selectedTags, res.data]);
          }
        } catch (error) {
          console.error('Failed to create tag:', error);
        } finally {
          setCreatingTag(false);
        }
      }
      setTagSearch('');
      setShowTagDropdown(false);
    }
  };

  const removeTag = (tagId: number) => {
    setSelectedTags(selectedTags.filter(t => t.id !== tagId));
  };

  // Panel animation variants
  const panelVariants = {
    hidden: { width: 0, opacity: 0, x: 50 },
    visible: { width: 320, opacity: 1, x: 0, transition: { type: 'spring', stiffness: 300, damping: 30 } },
    exit: { width: 0, opacity: 0, x: 50, transition: { duration: 0.2 } }
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* Top Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-[#0a0a0c]">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/posts')}
            className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入文章标题..."
            className="text-xl font-bold bg-transparent text-white placeholder:text-gray-500 focus:outline-none w-96"
          />
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 mr-2">
            {stats.words.toLocaleString()} 字 / {stats.chars.toLocaleString()} 字符
          </span>
          
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => { setShowAI(!showAI); setShowSettings(false); }}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg transition-colors',
              showAI ? 'bg-primary text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'
            )}
          >
            <Sparkles className="w-4 h-4" />
            AI 助手
          </motion.button>
          
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => { setShowSettings(!showSettings); setShowAI(false); }}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg transition-colors',
              showSettings ? 'bg-primary text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'
            )}
          >
            <Settings className="w-4 h-4" />
            设置
          </motion.button>
          
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleSave}
            disabled={isSaving || isPublishing}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors',
              isSaving ? 'bg-primary/50 text-white cursor-wait' : 'bg-white/10 text-gray-300 hover:bg-white/20'
            )}
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isSaving ? '保存中...' : '保存草稿'}
          </motion.button>
          
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handlePublish}
            disabled={isSaving || isPublishing}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors',
              isPublishing ? 'bg-primary/50 cursor-wait' : 'bg-primary hover:bg-primary/90',
              'text-white'
            )}
          >
            {isPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {isPublishing ? '发布中...' : '发布'}
          </motion.button>
          
          {/* Save message toast */}
          <AnimatePresence>
            {saveMessage && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className={cn(
                  'absolute right-6 top-16 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2',
                  saveMessage.type === 'success' ? 'bg-green-500/90 text-white' : 'bg-red-500/90 text-white'
                )}
              >
                {saveMessage.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                {saveMessage.text}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Formatting Toolbar */}
      <div className="flex items-center gap-1 px-6 py-2 border-b border-white/10 bg-[#0a0a0c]/80">
        <div className="flex items-center gap-1 pr-4 border-r border-white/10">
          <button onClick={() => insertMarkdown('# ')} className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="标题 1">
            <Heading1 className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('## ')} className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="标题 2">
            <Heading2 className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('### ')} className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="标题 3">
            <Heading3 className="w-4 h-4" />
          </button>
        </div>
        
        <div className="flex items-center gap-1 px-4 border-r border-white/10">
          <button onClick={() => insertMarkdown('**', '**')} className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="粗体">
            <Bold className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('*', '*')} className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="斜体">
            <Italic className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('~~', '~~')} className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="删除线">
            <Strikethrough className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('`', '`')} className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="行内代码">
            <Code className="w-4 h-4" />
          </button>
        </div>
        
        <div className="flex items-center gap-1 px-4 border-r border-white/10">
          <button onClick={() => insertMarkdown('- ')} className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="无序列表">
            <List className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('1. ')} className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="有序列表">
            <ListOrdered className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('> ')} className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="引用">
            <Quote className="w-4 h-4" />
          </button>
        </div>
        
        <div className="flex items-center gap-1 px-4">
          <button onClick={() => insertMarkdown('[链接文字](', ')')} className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="链接">
            <Link2 className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('![图片描述](', ')')} className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="图片">
            <Image className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor */}
        <div className="flex-1 overflow-hidden">
          <EditorWithPreview value={content} onChange={setContent} className="h-full" />
        </div>

        {/* Settings Panel with AnimatePresence */}
        <AnimatePresence>
          {showSettings && (
            <motion.div 
              key="settings"
              variants={panelVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="w-80 border-l border-white/10 p-6 space-y-6 overflow-auto bg-[#0a0a0c]"
            >
              <h3 className="text-lg font-semibold text-white">发布设置</h3>
              
              <div className="space-y-4">
                {/* Category Selector */}
                <div ref={categoryDropdownRef} className="relative">
                  <label className="block text-sm font-medium text-gray-300 mb-2">分类</label>
                  <button
                    onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white hover:border-primary/50 transition-colors"
                  >
                    <span className={selectedCategory ? 'text-white' : 'text-gray-500'}>
                      {selectedCategory?.name || '选择分类'}
                    </span>
                    <ChevronDown className={cn('w-4 h-4 text-gray-400 transition-transform', showCategoryDropdown && 'rotate-180')} />
                  </button>
                  
                  <AnimatePresence>
                    {showCategoryDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute z-10 w-full mt-1 bg-[#1a1a1c] border border-white/10 rounded-lg shadow-xl overflow-hidden"
                      >
                        <div className="p-2 border-b border-white/10">
                          <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <input
                              type="text"
                              value={categorySearch}
                              onChange={(e) => setCategorySearch(e.target.value)}
                              placeholder="搜索分类..."
                              className="w-full pl-8 pr-3 py-1.5 bg-white/5 border border-white/10 rounded text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-primary/50"
                            />
                          </div>
                        </div>
                        <div className="max-h-48 overflow-auto">
                          {loadingCategories ? (
                            <div className="p-4 text-center text-gray-500">
                              <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                            </div>
                          ) : (
                            <>
                              {filteredCategories.length === 0 ? (
                                <div className="p-4 text-center text-gray-500 text-sm">无匹配分类</div>
                              ) : (
                                filteredCategories.map((cat) => (
                                  <button
                                    key={cat.id}
                                    onClick={() => { setSelectedCategory(cat); setShowCategoryDropdown(false); setCategorySearch(''); }}
                                    className={cn(
                                      'w-full px-3 py-2 text-left text-sm hover:bg-white/10 transition-colors',
                                      selectedCategory?.id === cat.id ? 'bg-primary/20 text-primary' : 'text-white'
                                    )}
                                  >
                                    {cat.name}
                                  </button>
                                ))
                              )}
                              {/* Create new category button */}
                              <button
                                onClick={() => { setShowCategoryDropdown(false); setShowCreateCategoryModal(true); }}
                                className="w-full px-3 py-2 text-left text-sm text-primary hover:bg-white/10 transition-colors flex items-center gap-2 border-t border-white/10"
                              >
                                <Plus className="w-4 h-4" />
                                新建分类...
                              </button>
                            </>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Tag Selector */}
                <div ref={tagDropdownRef} className="relative">
                  <label className="block text-sm font-medium text-gray-300 mb-2">标签</label>
                  
                  {/* Selected tags */}
                  {selectedTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {selectedTags.map((tag) => (
                        <span key={tag.id} className="inline-flex items-center gap-1 px-2 py-1 bg-primary/20 text-primary rounded-md text-sm">
                          {tag.name}
                          <button onClick={() => removeTag(tag.id)} className="hover:text-white transition-colors">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  
                  <div className="relative">
                    <input
                      type="text"
                      value={tagSearch}
                      onChange={(e) => { setTagSearch(e.target.value); setShowTagDropdown(true); }}
                      onFocus={() => setShowTagDropdown(true)}
                      onKeyDown={handleTagKeyDown}
                      placeholder="搜索或输入新标签，回车添加"
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:border-primary/50"
                      disabled={creatingTag}
                    />
                    {creatingTag && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary" />}
                  </div>

                  <AnimatePresence>
                    {showTagDropdown && (tagSearch || filteredTags.length > 0) && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute z-10 w-full mt-1 bg-[#1a1a1c] border border-white/10 rounded-lg shadow-xl overflow-hidden"
                      >
                        <div className="max-h-48 overflow-auto">
                          {loadingTags ? (
                            <div className="p-4 text-center text-gray-500">
                              <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                            </div>
                          ) : (
                            <>
                              {filteredTags.map((tag) => (
                                <button
                                  key={tag.id}
                                  onClick={() => { setSelectedTags([...selectedTags, tag]); setTagSearch(''); setShowTagDropdown(false); }}
                                  className="w-full px-3 py-2 text-left text-sm text-white hover:bg-white/10 transition-colors"
                                >
                                  {tag.name}
                                </button>
                              ))}
                              {tagSearch && !tags.find(t => t.name.toLowerCase() === tagSearch.toLowerCase()) && (
                                <button
                                  onClick={() => handleTagKeyDown({ key: 'Enter', preventDefault: () => {} } as React.KeyboardEvent<HTMLInputElement>)}
                                  className="w-full px-3 py-2 text-left text-sm text-primary hover:bg-white/10 transition-colors flex items-center gap-2"
                                >
                                  <Plus className="w-4 h-4" />
                                  创建 "{tagSearch}"
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Cover Image */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">封面图片</label>
                  <div className="border-2 border-dashed border-white/20 rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer">
                    <Image className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                    <p className="text-gray-400 text-sm">点击或拖拽上传</p>
                  </div>
                </div>

                {/* Summary */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">摘要</label>
                  <textarea
                    rows={3}
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="文章摘要，为空将自动截取..."
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-gray-500 resize-none focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* AI Panel with AnimatePresence */}
        <AnimatePresence>
          {showAI && (
            <motion.div 
              key="ai"
              variants={panelVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="w-80 border-l border-white/10 p-6 space-y-4 overflow-auto bg-[#0a0a0c]"
            >
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                AI 写作助手
              </h3>
              
              <div className="space-y-3">
                {[
                  { title: '生成摘要', desc: 'AI 自动生成文章摘要' },
                  { title: '智能标签', desc: 'AI 推荐相关标签' },
                  { title: '润色优化', desc: '优化文章表达和结构' },
                  { title: '续写内容', desc: 'AI 辅助续写段落' },
                  { title: 'SEO 优化', desc: '生成 SEO 标题和描述' },
                ].map((item) => (
                  <motion.button 
                    key={item.title}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    className="w-full px-4 py-3 rounded-lg bg-white/5 hover:bg-white/10 text-left transition-colors border border-white/5 hover:border-primary/30"
                  >
                    <p className="text-white font-medium">{item.title}</p>
                    <p className="text-gray-400 text-sm">{item.desc}</p>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Create Category Modal */}
        <AnimatePresence>
          {showCreateCategoryModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
              onClick={() => setShowCreateCategoryModal(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md p-6 bg-[#1a1a2e] border border-white/10 rounded-xl shadow-2xl"
              >
                <h3 className="text-lg font-semibold text-white mb-4">新建分类</h3>
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateCategory()}
                  placeholder="输入分类名称..."
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:border-primary/50 mb-4"
                  autoFocus
                />
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => { setShowCreateCategoryModal(false); setNewCategoryName(''); }}
                    className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleCreateCategory}
                    disabled={creatingCategory || !newCategoryName.trim()}
                    className={cn(
                      'px-4 py-2 text-sm font-medium rounded-lg',
                      'bg-primary text-white hover:bg-primary/90',
                      'disabled:opacity-50 disabled:cursor-not-allowed',
                      'transition-colors flex items-center gap-2'
                    )}
                  >
                    {creatingCategory && <Loader2 className="w-4 h-4 animate-spin" />}
                    创建分类
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default CreatePostPage;
