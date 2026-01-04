import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Save, Settings, Sparkles, ArrowLeft, Send, 
  Bold, Italic, Strikethrough, Code, List, ListOrdered,
  Link2, Image, Quote, Heading1, Heading2, Heading3,
  X, ChevronDown, Plus, Search, Loader2, CheckCircle, AlertCircle, Tag as TagIcon,
  Table2, Minus, CheckSquare, Sigma, GitBranch, Underline, FileCode2, ArrowUp,
  Maximize2, Minimize2, Eye, ListTree, ZoomIn, ZoomOut
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { EditorWithPreview, type ViewMode } from '@aetherblog/editor';
import { cn } from '@/lib/utils';
import { Modal } from '@aetherblog/ui';
import { categoryService, Category } from '@/services/categoryService';
import { tagService, Tag } from '@/services/tagService';
import { postService } from '@/services/postService';
import { useSidebarStore } from '@/stores';

export function CreatePostPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;
  const postId = id ? parseInt(id, 10) : null;
  
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSyncScroll, setIsSyncScroll] = useState(true);
  const [showToc, setShowToc] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [showLineNumbers, setShowLineNumbers] = useState(false);
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
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Sidebar auto-collapse
  const { setAutoCollapse } = useSidebarStore();

  // Auto-collapse sidebar on mount, restore on unmount
  useEffect(() => {
    setAutoCollapse(true);
    return () => setAutoCollapse(false);
  }, [setAutoCollapse]);

  // View configuration automation
  useEffect(() => {
    if (viewMode === 'edit') {
      setShowToc(true);
      setIsFullscreen(false); 
    } else if (viewMode === 'preview') {
      setIsFullscreen(true);
      setShowToc(false);
    } else {
      // Split mode defaults
      setIsFullscreen(false);
      setShowToc(false);
    }
  }, [viewMode]);

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

  // Handle Esc to exit full screen
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isFullscreen]);

  // Handle Ctrl+S / Cmd+S to save
  useEffect(() => {
    const handleSaveShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleSaveShortcut);
    return () => window.removeEventListener('keydown', handleSaveShortcut);
  }, [content, title, selectedCategory, selectedTags, summary]); // Use relevant states for saving

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

  // Character, word, and line count
  const stats = useMemo(() => {
    const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (content.match(/[a-zA-Z]+/g) || []).length;
    const lines = content.split('\n').length;
    return {
      words: chineseChars + englishWords,
      chars: content.length,
      lines,
    };
  }, [content]);

  // Extract headings for TOC
  interface TocItem {
    level: number;
    text: string;
    line: number;
  }
  
  const tocItems = useMemo((): TocItem[] => {
    const lines = content.split('\n');
    const items: TocItem[] = [];
    
    lines.forEach((line, index) => {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        items.push({
          level: match[1].length,
          text: match[2].trim(),
          line: index + 1,
        });
      }
    });
    
    return items;
  }, [content]);

  // Ref to store original sync scroll state during TOC navigation
  const syncScrollBeforeNavRef = useRef(false);

  // Scroll to heading - Two-phase approach for virtual DOM accuracy
  const scrollToHeading = useCallback((headingText: string, lineNumber: number) => {
    const editorContainer = editorContainerRef.current;
    if (!editorContainer) return;
    
    // Temporarily disable sync scroll to prevent interference
    syncScrollBeforeNavRef.current = isSyncScroll;
    if (isSyncScroll) {
      setIsSyncScroll(false);
    }
    
    const cmScroller = editorContainer.querySelector('.cm-scroller') as HTMLElement | null;
    const cmContent = editorContainer.querySelector('.cm-content') as HTMLElement | null;

    // Wrap execution in setTimeout to ensure setIsSyncScroll(false) has propagated to children
    setTimeout(() => {
    // Helper: Find heading in editor DOM
    const findHeadingInEditor = (): HTMLElement | null => {
      if (!cmContent) return null;
      const lines = cmContent.querySelectorAll('.cm-line');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] as HTMLElement;
        const text = (line.textContent || '').trim();
        if (text.includes(headingText) && /^#+\s/.test(text)) {
          return line;
        }
      }
      return null;
    };

    // Helper: Scroll editor to element
    const scrollEditorToElement = (element: HTMLElement) => {
      if (!cmScroller || !cmContent) return;
      const lineTop = element.offsetTop - cmContent.offsetTop;
      cmScroller.scrollTo({ top: Math.max(0, lineTop - 50), behavior: 'smooth' });
    };

    // Helper: Scroll preview to heading
    const scrollPreviewToHeading = () => {
      const previewPanels = editorContainer.querySelectorAll('[class*="overflow-y-auto"]');
      previewPanels.forEach(panel => {
        const pEl = panel as HTMLElement;
        const headings = pEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
        
        for (let i = 0; i < headings.length; i++) {
          const heading = headings[i] as HTMLElement;
          if (heading.textContent?.trim() === headingText) {
            const containerRect = pEl.getBoundingClientRect();
            const targetRect = heading.getBoundingClientRect();
            const currentScrollTop = pEl.scrollTop;
            const targetScrollTop = currentScrollTop + (targetRect.top - containerRect.top) - 60;
            pEl.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
            break;
          }
        }
      });
    };

    // Phase 1: Try direct text match first
    let foundLine = findHeadingInEditor();
    
    if (foundLine) {
      // Heading is in visible DOM - scroll directly (both smooth)
      scrollEditorToElement(foundLine);
      scrollPreviewToHeading(); // Preview always has DOM, so this works
    } else if (cmScroller && cmContent) {
      // Phase 2: Heading not in DOM - use "Seek & Lock" approach
      
      // 2a: Launch smooth scroll to estimated position for Editor
      const lineHeight = 24;
      const estimatedTop = (lineNumber - 1) * lineHeight;
      cmScroller.scrollTo({ top: Math.max(0, estimatedTop - 50), behavior: 'smooth' });
      
      // 2b: Preview is NOT virtualized, so we can always find and scroll to it directly & smoothly
      // We don't need estimation for preview, just force a search
      scrollPreviewToHeading();
      
      // 2c: MutationObserver (Zero Overhead)
      // Instead of polling every frame, we wait for the browser to notify us of DOM updates
      
      const observerTimeout = setTimeout(() => {
        observer.disconnect();
      }, 2000); // Safety timeout

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            // Only check newly added nodes
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === 1) { // Element node
                const el = node as HTMLElement;
                // Check if this new node is a line containing our heading
                if (el.classList.contains('cm-line')) {
                  const text = el.textContent || '';
                  if (text.includes(headingText) && /^#+\s/.test(text)) {
                    // Target acquired!
                    // Only correct if deviation is significant (> 50px) to avoid visual jitter
                    // Only correct if deviation between ESTIMATED target and ACTUAL target is significant
                    // This prevents interrupting the smooth scroll if we are already going to the right place
                    const targetTop = el.offsetTop - (cmContent?.offsetTop || 0) - 50;
                    if (Math.abs(estimatedTop - targetTop) > 50) {
                       scrollEditorToElement(el);
                    }
                    observer.disconnect();
                    clearTimeout(observerTimeout);
                  }
                }
              }
            });
          }
        }
      });

      if (cmContent) {
        // Start observing for line additions
        observer.observe(cmContent, { childList: true, subtree: true });
        
        // Final check: in case it appeared just before observation started
        const finalLine = findHeadingInEditor();
        if (finalLine) {
          scrollEditorToElement(finalLine);
          observer.disconnect();
          clearTimeout(observerTimeout);
        }
      }
    }

    // Restore sync scroll after enough time for all animations to complete
    // Increased to 1500ms to cover long scrolls and polling time
    setTimeout(() => {
      if (syncScrollBeforeNavRef.current) {
        setIsSyncScroll(true);
      }
    }, 1500);
    }, 10);
  }, [isSyncScroll, stats.lines]);

  // Scroll to top function - targets CodeMirror's internal scroller
  const scrollToTop = useCallback(() => {
    // Find all scroll containers within the editor
    const editorContainer = editorContainerRef.current;
    if (!editorContainer) return;
    
    // Scroll the CodeMirror scroller
    const cmScroller = editorContainer.querySelector('.cm-scroller');
    if (cmScroller) {
      cmScroller.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    // Also scroll the preview panel (look for the container with bg-[#0a0a0c])
    const previewPanels = editorContainer.querySelectorAll('.overflow-y-auto, [class*="overflow-y-auto"]');
    previewPanels.forEach(panel => {
      panel.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, []);

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
        // If it was a new post, navigate to edit page for this post to allow continued editing
        if (!isEditMode && res.data.id) {
          setTimeout(() => navigate(`/posts/edit/${res.data.id}`), 1000);
        }
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

  // Loading skeleton for edit mode
  if (isEditMode && (_loadingPost || loadingCategories || loadingTags)) {
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col">
        {/* Header Skeleton */}
        <div className="flex items-center justify-between px-6 py-2 border-b border-white/10 bg-[#0a0a0c]">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-lg bg-white/5 animate-pulse" />
            <div className="w-64 h-6 rounded bg-white/5 animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="w-16 h-8 rounded-lg bg-white/5 animate-pulse" />
            <div className="w-20 h-8 rounded-lg bg-white/5 animate-pulse" />
            <div className="w-16 h-8 rounded-lg bg-white/5 animate-pulse" />
            <div className="w-24 h-8 rounded-lg bg-white/5 animate-pulse" />
            <div className="w-20 h-8 rounded-lg bg-primary/20 animate-pulse" />
          </div>
        </div>

        {/* Toolbar Skeleton */}
        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-white/10 bg-[#0a0a0c]/80">
          {[1, 2, 3, 4, 5].map((group) => (
            <div key={group} className="flex items-center gap-1 px-3 border-r border-white/10 last:border-r-0">
              {[1, 2, 3].map((btn) => (
                <div key={btn} className="w-7 h-7 rounded bg-white/5 animate-pulse" />
              ))}
            </div>
          ))}
        </div>

        {/* Editor Content Skeleton */}
        <div className="flex-1 flex">
          {/* Left Editor Panel */}
          <div className="flex-1 flex flex-col">
            {/* Mode Tabs Skeleton */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10">
              <div className="w-16 h-7 rounded-lg bg-white/5 animate-pulse" />
              <div className="w-16 h-7 rounded-lg bg-white/5 animate-pulse" />
              <div className="w-16 h-7 rounded-lg bg-primary/20 animate-pulse" />
            </div>
            
            {/* Editor Area Skeleton */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left: Editor Lines */}
              <div className="flex-1 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-4 rounded bg-white/10 animate-pulse" />
                  <div className="h-5 bg-white/5 rounded animate-pulse" style={{ width: '85%' }} />
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-6 h-4 rounded bg-white/10 animate-pulse" />
                  <div className="h-5 bg-white/5 rounded animate-pulse" style={{ width: '60%' }} />
                </div>
                {[3, 4, 5, 6, 7, 8].map((line) => (
                  <div key={line} className="flex items-center gap-3">
                    <div className="w-6 h-4 rounded bg-white/10 animate-pulse" />
                    <div 
                      className="h-5 bg-white/5 rounded animate-pulse" 
                      style={{ width: `${Math.random() * 40 + 30}%`, animationDelay: `${line * 50}ms` }} 
                    />
                  </div>
                ))}
                <div className="flex items-center gap-3">
                  <div className="w-6 h-4 rounded bg-white/10 animate-pulse" />
                  <div className="h-5 bg-white/5 rounded animate-pulse" style={{ width: '75%' }} />
                </div>
                {[10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((line) => (
                  <div key={line} className="flex items-center gap-3">
                    <div className="w-6 h-4 rounded bg-white/10 animate-pulse" />
                    <div 
                      className="h-5 bg-white/5 rounded animate-pulse" 
                      style={{ width: `${Math.random() * 50 + 20}%`, animationDelay: `${line * 50}ms` }} 
                    />
                  </div>
                ))}
              </div>

              {/* Right: Preview Panel */}
              <div className="flex-1 border-l border-white/10 p-6 space-y-4 bg-black/20">
                <div className="h-8 bg-white/5 rounded animate-pulse" style={{ width: '70%' }} />
                <div className="h-4 bg-white/5 rounded animate-pulse" style={{ width: '90%' }} />
                <div className="h-4 bg-white/5 rounded animate-pulse" style={{ width: '85%' }} />
                <div className="h-4 bg-white/5 rounded animate-pulse" style={{ width: '70%' }} />
                <div className="h-6 mt-6 bg-white/5 rounded animate-pulse" style={{ width: '50%' }} />
                <div className="h-4 bg-white/5 rounded animate-pulse" style={{ width: '95%' }} />
                <div className="h-4 bg-white/5 rounded animate-pulse" style={{ width: '80%' }} />
                <div className="h-24 bg-white/5 rounded-lg animate-pulse mt-4" />
              </div>
            </div>
          </div>
        </div>

        {/* Footer Skeleton */}
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-white/10 bg-[#0a0a0c]">
          <div className="flex items-center gap-4">
            <div className="w-16 h-4 rounded bg-white/5 animate-pulse" />
            <div className="w-16 h-4 rounded bg-white/5 animate-pulse" />
          </div>
          <div className="w-20 h-6 rounded bg-white/5 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "flex flex-col absolute inset-0 h-full bg-[#0a0a0c] z-10 transition-all duration-300 overflow-hidden"
    )}>
      {/* Top Header Section - With fold-up animation */}
      <AnimatePresence initial={false}>
        {!isFullscreen && (
          <motion.div 
            key="editor-header"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="border-b border-white/10 bg-[#0a0a0c] z-20"
          >
            <div className="flex items-center justify-between px-6 py-3.5">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => navigate('/posts')}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                  title="返回列表"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex-1 min-w-[300px]">
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="请输入文章标题..."
                    className="w-full bg-transparent text-xl font-bold text-white placeholder-gray-600 focus:outline-none"
                  />
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowAI(true)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-sm',
                    showAI ? 'bg-primary text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'
                  )}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  AI 助手
                </motion.button>
                
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowSettings(true)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-sm',
                    showSettings ? 'bg-primary text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'
                  )}
                >
                  <Settings className="w-3.5 h-3.5" />
                  设置
                </motion.button>
                
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSave}
                  disabled={isSaving || isPublishing}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-sm',
                    isSaving ? 'bg-primary/50 text-white cursor-wait' : 'bg-white/10 text-gray-300 hover:bg-white/20'
                  )}
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {isSaving ? '保存中...' : '保存草稿'}
                </motion.button>
                
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handlePublish}
                  disabled={isSaving || isPublishing}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-sm',
                    isPublishing ? 'bg-primary/50 cursor-wait' : 'bg-primary hover:bg-primary/90',
                    'text-white'
                  )}
                >
                  {isPublishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
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
                        'absolute right-6 top-16 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 z-50',
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* Formatting Toolbar */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-white/10 bg-[#0a0a0c]/80 overflow-x-auto">
        {/* Headings */}
        <div className="flex items-center gap-0.5 pr-3 border-r border-white/10">
          <button onClick={() => insertMarkdown('# ')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="标题 1 (H1)">
            <Heading1 className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('## ')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="标题 2 (H2)">
            <Heading2 className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('### ')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="标题 3 (H3)">
            <Heading3 className="w-4 h-4" />
          </button>
        </div>
        
        {/* Text Formatting */}
        <div className="flex items-center gap-0.5 px-3 border-r border-white/10">
          <button onClick={() => insertMarkdown('**', '**')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="粗体 (Bold)">
            <Bold className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('*', '*')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="斜体 (Italic)">
            <Italic className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('<u>', '</u>')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="下划线 (Underline)">
            <Underline className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('~~', '~~')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="删除线 (Strikethrough)">
            <Strikethrough className="w-4 h-4" />
          </button>
        </div>

        {/* Code */}
        <div className="flex items-center gap-0.5 px-3 border-r border-white/10">
          <button onClick={() => insertMarkdown('`', '`')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="行内代码 (Inline Code)">
            <Code className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('```\n', '\n```')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="代码块 (Code Block)">
            <FileCode2 className="w-4 h-4" />
          </button>
        </div>
        
        {/* Lists */}
        <div className="flex items-center gap-0.5 px-3 border-r border-white/10">
          <button onClick={() => insertMarkdown('- ')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="无序列表 (Unordered List)">
            <List className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('1. ')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="有序列表 (Ordered List)">
            <ListOrdered className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('- [ ] ')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="任务列表 (Task List)">
            <CheckSquare className="w-4 h-4" />
          </button>
        </div>

        {/* Insert */}
        <div className="flex items-center gap-0.5 px-3 border-r border-white/10">
          <button onClick={() => insertMarkdown('[链接文字](', ')')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="链接 (Link)">
            <Link2 className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('![图片描述](', ')')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="图片 (Image)">
            <Image className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="表格 (Table)">
            <Table2 className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('\n---\n')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="分割线 (Horizontal Rule)">
            <Minus className="w-4 h-4" />
          </button>
        </div>

        {/* Advanced: Quote, Math, Diagram */}
        <div className="flex items-center gap-0.5 px-3">
          <button onClick={() => insertMarkdown('> ')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="引用 (Quote)">
            <Quote className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('$$\n', '\n$$')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="数学公式 (Math/LaTeX)">
            <Sigma className="w-4 h-4" />
          </button>
          <button onClick={() => insertMarkdown('```mermaid\ngraph TD;\n  A-->B;\n', '```')} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="流程图 (Mermaid Diagram)">
            <GitBranch className="w-4 h-4" />
          </button>
        </div>
        
        {/* Spacer */}
        <div className="flex-1" />
        
        {/* Zoom Controls */}
        <div className="flex items-center gap-0.5 px-3 border-l border-white/10">
          <button
            onClick={() => setFontSize(s => Math.max(12, s - 1))}
            className="p-1.5 rounded-lg transition-colors text-gray-400 hover:bg-white/10 hover:text-white"
            title="缩小 (Zoom Out)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-500 w-8 text-center select-none">{fontSize}px</span>
          <button
            onClick={() => setFontSize(s => Math.min(24, s + 1))}
            className="p-1.5 rounded-lg transition-colors text-gray-400 hover:bg-white/10 hover:text-white"
            title="放大 (Zoom In)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-0.5 px-3 border-l border-white/10">
          <button
            onClick={() => setViewMode(viewMode === 'edit' ? 'split' : 'edit')}
            className={cn(
              'p-1.5 rounded-lg transition-colors relative',
              viewMode === 'edit' ? 'bg-primary text-white' : 'text-gray-400 hover:bg-white/10 hover:text-white'
            )}
            title="源码 (Source)"
          >
            <FileCode2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode(viewMode === 'preview' ? 'split' : 'preview')}
            className={cn(
              'p-1.5 rounded-lg transition-colors relative',
              viewMode === 'preview' ? 'bg-primary text-white' : 'text-gray-400 hover:bg-white/10 hover:text-white'
            )}
            title="阅读 (Reading)"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className={cn(
              'p-1.5 rounded-lg transition-colors text-gray-400 hover:bg-white/10 hover:text-white',
              isFullscreen ? 'bg-primary text-white' : ''
            )}
            title={isFullscreen ? '退出全屏' : '进入全屏 (Fullscreen)'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setShowToc(!showToc)}
            className={cn(
              'p-1.5 rounded-lg transition-colors text-gray-400 hover:bg-white/10 hover:text-white',
              showToc ? 'bg-primary text-white' : ''
            )}
            title={showToc ? '关闭目录' : '打开目录 (TOC)'}
          >
            <ListTree className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Editor Container */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Editor */}
          <div ref={editorContainerRef} className="flex-1 overflow-hidden min-h-0">
            <EditorWithPreview 
              value={content} 
              onChange={setContent} 
              className="h-full" 
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              isSyncScroll={isSyncScroll}
              fontSize={fontSize}
              showLineNumbers={showLineNumbers}
              hideToolbar
            />
          </div>
        </div>

        {/* TOC Panel */}
        <AnimatePresence mode="wait">
          {showToc && (
            <motion.div
              initial={{ width: 0, opacity: 0, x: 30 }}
              animate={{ width: 320, opacity: 1, x: 0 }}
              exit={{ 
                width: 0, 
                opacity: 0, 
                x: 60,
                transition: {
                  type: "spring",
                  stiffness: 400,
                  damping: 40,
                  opacity: { duration: 0.2 }
                }
              }}
              transition={{ 
                type: "spring",
                stiffness: 350,
                damping: 32,
                mass: 0.6
              }}
              className="h-full border-l border-white/10 bg-[#0d0d0f]/85 backdrop-blur-2xl overflow-hidden flex flex-col z-30 shadow-[0_0_50px_rgba(0,0,0,0.5)] relative"
            >
              {/* Cinematic Edge Highlight */}
              <div className="absolute inset-y-0 left-0 w-[1px] bg-gradient-to-b from-transparent via-primary/30 to-transparent" />

              {/* TOC Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(139,92,246,0.6)]" />
                  <span className="text-sm font-semibold text-white/90 tracking-wide uppercase">目录索引</span>
                </div>
                <button
                  onClick={() => setShowToc(false)}
                  className="p-1.5 rounded-full hover:bg-white/10 text-gray-500 hover:text-white transition-all duration-300"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              {/* TOC Content */}
              <div className="flex-1 overflow-y-auto py-4 scrollbar-hide">
                {tocItems.length === 0 ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="px-6 py-12 text-center"
                  >
                    <div className="inline-flex p-3 rounded-full bg-white/[0.03] mb-3">
                      <ListTree className="w-5 h-5 text-gray-600" />
                    </div>
                    <p className="text-sm font-medium text-gray-500">空空如也</p>
                    <p className="mt-1 text-xs text-gray-600 px-4">
                      在编辑器中输入 # 标题 即可自动生成目录
                    </p>
                  </motion.div>
                ) : (
                  <motion.div 
                    initial="hidden"
                    animate="show"
                    variants={{
                      show: {
                        transition: {
                          staggerChildren: 0.04,
                          delayChildren: 0.2,
                          staggerDirection: 1
                        }
                      }
                    }}
                    className="space-y-0.5 px-3"
                  >
                    {tocItems.map((item, index) => (
                      <motion.button
                        key={`${item.line}-${index}`}
                        variants={{
                          hidden: { opacity: 0, y: 15, scale: 0.95, filter: "blur(4px)" },
                          show: { 
                            opacity: 1, 
                            y: 0, 
                            scale: 1, 
                            filter: "blur(0px)",
                            transition: {
                              type: "spring",
                              stiffness: 260,
                              damping: 20
                            }
                          }
                        }}
                        onClick={() => scrollToHeading(item.text, item.line)}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-md text-sm transition-all duration-300 group relative flex items-center gap-3',
                          'hover:bg-white/[0.06] text-gray-400 hover:text-white'
                        )}
                        style={{ paddingLeft: `${(item.level - 1) * 14 + 12}px` }}
                        title={item.text}
                      >
                        {/* Elegant Hover Indicator */}
                        <div className="absolute left-1 w-0.5 h-0 bg-primary group-hover:h-3/5 transition-all duration-400 ease-out-expo rounded-full opacity-0 group-hover:opacity-100 shadow-[0_0_8px_#8b5cf6]" />
                        
                        <span className={cn(
                          "truncate transition-all duration-500",
                          item.level === 1 ? "font-bold text-gray-100 tracking-tight" : 
                          item.level === 2 ? "font-semibold text-gray-300" : 
                          "font-normal text-gray-400"
                        )}>
                          {item.text}
                        </span>
                      </motion.button>
                    ))}
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Editor Footer - Updated to match image */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-white/10 bg-[#0a0a0c] text-[12px] text-gray-400">
        <div className="flex items-center gap-4">
          <span>字数: <span className="text-gray-200 font-medium">{stats.words.toLocaleString()}</span></span>
          <span>行数: <span className="text-gray-200 font-medium">{stats.lines.toLocaleString()}</span></span>
        </div>
        
        <div className="flex items-center gap-4">
          {viewMode !== 'preview' && (
            <label className="flex items-center gap-2 cursor-pointer group">
              <input 
                type="checkbox" 
                checked={showLineNumbers} 
                onChange={(e) => setShowLineNumbers(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-primary focus:ring-0 focus:ring-offset-0 transition-all cursor-pointer"
              />
              <span className="group-hover:text-gray-200 transition-colors">显示行号</span>
            </label>
          )}
          
          {viewMode === 'split' && (
            <label className="flex items-center gap-2 cursor-pointer group">
              <input 
                type="checkbox" 
                checked={isSyncScroll} 
                onChange={(e) => setIsSyncScroll(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-primary focus:ring-0 focus:ring-offset-0 transition-all cursor-pointer"
              />
              <span className="group-hover:text-gray-200 transition-colors">同步滚动</span>
            </label>
          )}
          <button 
            onClick={scrollToTop} 
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-white/10 hover:text-gray-200 transition-all ml-2"
          >
            <ArrowUp className="w-3.5 h-3.5" />
            回到顶部
          </button>
        </div>
      </div>

      {/* Settings Modal */}
        <Modal 
          isOpen={showSettings} 
          onClose={() => setShowSettings(false)}
          title="发布设置"
          size="md"
        >
          <div className="space-y-6">
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
                      className="absolute z-20 w-full mt-1 bg-[#1a1a1c] border border-white/10 rounded-lg shadow-xl overflow-hidden"
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
                      className="absolute z-20 w-full mt-1 bg-[#1a1a1c] border border-white/10 rounded-lg shadow-xl overflow-hidden"
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
            
            <div className="flex justify-end pt-4 border-t border-white/10">
               <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
               >
                 确认
               </button>
            </div>
          </div>
        </Modal>

        {/* AI Assistant Modal */}
        <Modal 
          isOpen={showAI} 
          onClose={() => setShowAI(false)}
          title="AI 写作助手"
          size="md"
        >
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              选择 AI 功能
            </h3>
            
            <div className="grid grid-cols-1 gap-3">
              {[
                { title: '生成摘要', desc: 'AI 自动生成文章摘要', icon: Sparkles },
                { title: '智能标签', desc: 'AI 推荐相关标签', icon: TagIcon },
                { title: '润色优化', desc: '优化文章表达和结构', icon: Settings },
                { title: '续写内容', desc: 'AI 辅助续写段落', icon: Send },
                { title: 'SEO 优化', desc: '生成 SEO 标题和描述', icon: Search },
              ].map((item) => (
                <button 
                  key={item.title}
                  className="w-full p-4 rounded-xl bg-white/5 hover:bg-white/10 text-left transition-colors border border-white/5 hover:border-primary/30 group"
                  onClick={() => {/* Implement AI action */}}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                      <item.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-white font-medium">{item.title}</p>
                      <p className="text-gray-400 text-sm">{item.desc}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </Modal>

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
  );
}

export default CreatePostPage;
