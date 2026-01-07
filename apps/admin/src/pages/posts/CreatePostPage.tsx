import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Save, Settings, Sparkles, ArrowLeft, Send, 
  Bold, Italic, Strikethrough, Code, List, ListOrdered,
  Link2, Image, Quote, Heading1, Heading2, Heading3,
  X, ChevronDown, Plus, Search, Loader2, CheckCircle, AlertCircle, Tag as TagIcon,
  Table2, Minus, CheckSquare, Sigma, GitBranch, Underline, FileCode2, ArrowUp,
  Maximize2, Minimize2, Eye, ListTree, ZoomIn, ZoomOut, Clock, HardDrive,
  Undo2, Redo2
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { EditorWithPreview, EditorView, useEditorCommands, useTableCommands, type ViewMode, type TableInfo } from '@aetherblog/editor';
import { cn } from '@/lib/utils';
import {
  ArrowUpToLine, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, Trash2,
  AlignLeft, AlignCenter, AlignRight
} from 'lucide-react';
import { Modal } from '@aetherblog/ui';
import { categoryService, Category } from '@/services/categoryService';
import { tagService, Tag } from '@/services/tagService';
import { postService } from '@/services/postService';
import { useSidebarStore } from '@/stores';

// Instant tooltip button component for toolbar
interface ToolbarButtonProps {
  onClick: () => void;
  tooltip: string;
  children: React.ReactNode;
  isActive?: boolean;
  activeColor?: 'primary' | 'emerald';
  className?: string;
  /** Tooltip position: 'top' (default) or 'bottom' */
  tooltipPosition?: 'top' | 'bottom';
}

function ToolbarButton({ onClick, tooltip, children, isActive, activeColor = 'primary', className, tooltipPosition = 'top' }: ToolbarButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleMouseEnter = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        x: rect.left + rect.width / 2,
        y: tooltipPosition === 'bottom' ? rect.bottom + 2 : rect.top - 2
      });
    }
    setShowTooltip(true);
  };

  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShowTooltip(false)}
      className={cn(
        'relative p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors',
        isActive && activeColor === 'primary' && 'bg-indigo-500/90 text-white',
        isActive && activeColor === 'emerald' && 'bg-emerald-600 text-white hover:bg-emerald-500',
        className
      )}
    >
      <span className="block transition-transform active:scale-90">
        {children}
      </span>
      {showTooltip && (
        <span
          className={cn(
            "fixed z-[9999] px-2.5 py-1.5 text-xs text-white bg-[#1e1e20] rounded-md border border-white/20 whitespace-nowrap -translate-x-1/2 pointer-events-none shadow-lg",
            tooltipPosition === 'bottom' ? 'mt-1' : '-translate-y-full -mt-1'
          )}
          style={{ left: position.x, top: position.y }}
        >
          {tooltip}
        </span>
      )}
    </button>
  );
}

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
  // Font size control - separate editor and preview font sizes
  const [editorFontSize, setEditorFontSize] = useState(14);
  const [previewFontSize, setPreviewFontSize] = useState(16);
  const [zoomTarget, setZoomTarget] = useState<'editor' | 'preview' | 'both'>('both');
  const [showLineNumbers, setShowLineNumbers] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [summary, setSummary] = useState('');
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [_loadingPost, setLoadingPost] = useState(isEditMode);
  const [_postStatus, setPostStatus] = useState<'DRAFT' | 'PUBLISHED'>('DRAFT');
  const [isAutoSaveEnabled, setIsAutoSaveEnabled] = useState(true);
  const [publishTime, setPublishTime] = useState<string>('');
  // Quick create category modal
  const [showCreateCategoryModal, setShowCreateCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);

  // Category state
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [categorySearch, setCategorySearch] = useState('');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(true);

  // Tag state
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [loadingTags, setLoadingTags] = useState(true);
  const [showAllTags, setShowAllTags] = useState(false);

  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const expandedTagsRef = useRef<HTMLDivElement>(null);

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  // Sidebar auto-collapse
  const { setAutoCollapse } = useSidebarStore();

  // Auto-collapse sidebar on mount, restore on unmount
  useEffect(() => {
    setAutoCollapse(true);
    return () => setAutoCollapse(false);
  }, [setAutoCollapse]);

  // Auto-save logic
  const latestDataRef = useRef({ title, content, summary, selectedCategory, selectedTags });
  useEffect(() => {
    latestDataRef.current = { title, content, summary, selectedCategory, selectedTags };
  }, [title, content, summary, selectedCategory, selectedTags]);

  useEffect(() => {
    if (!isEditMode || !postId || !isAutoSaveEnabled) return;

    const timer = setInterval(() => {
      const data = latestDataRef.current;
      // Only auto-save if content exists
      if (!data.title && !data.content) return;

      // Automatically save to draft cache (Redis)
      postService.autoSave(postId, {
        title: data.title,
        content: data.content,
        summary: data.summary,
        categoryId: data.selectedCategory?.id,
        tagIds: data.selectedTags.map(t => t.id),
        status: _postStatus
      }).catch(err => console.error('Auto save failed', err));
    }, 30000);

    return () => clearInterval(timer);
  }, [isEditMode, postId, _postStatus, isAutoSaveEnabled]);

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

  // Fetch categories, tags, and server time on mount
  useEffect(() => {
    const fetchData = async () => {
      setLoadingCategories(true);
      setLoadingTags(true);
      try {
        const [catRes, tagRes, timeRes] = await Promise.all([
          categoryService.getList(),
          tagService.getList(),
          postService.getServerTime().catch(() => null) // Gracefully handle if API not available
        ]);
        if (catRes.data) setCategories(catRes.data);
        if (tagRes.data) setTags(tagRes.data);
        
        // Set publish time from server time, fallback to local time if API fails
        if (timeRes?.data?.timestamp) {
          // Server returns ISO timestamp, convert to local datetime-local format
          const serverDate = new Date(timeRes.data.timestamp);
          const year = serverDate.getFullYear();
          const month = String(serverDate.getMonth() + 1).padStart(2, '0');
          const day = String(serverDate.getDate()).padStart(2, '0');
          const hours = String(serverDate.getHours()).padStart(2, '0');
          const minutes = String(serverDate.getMinutes()).padStart(2, '0');
          setPublishTime(`${year}-${month}-${day}T${hours}:${minutes}`);
        } else {
          // Fallback to local time
          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const day = String(now.getDate()).padStart(2, '0');
          const hours = String(now.getHours()).padStart(2, '0');
          const minutes = String(now.getMinutes()).padStart(2, '0');
          setPublishTime(`${year}-${month}-${day}T${hours}:${minutes}`);
        }
      } catch (error) {
        console.error('Failed to fetch categories/tags:', error);
        // Still set a default publish time on error
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        setPublishTime(`${year}-${month}-${day}T${hours}:${minutes}`);
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
            const draft = post.draft;
            const useDraft = !!draft;

            // Prefer draft content if available
            setTitle(useDraft ? draft.title : post.title);
            setContent(useDraft ? draft.content : post.content);
            setSummary((useDraft ? draft.summary : post.summary) || '');
            setPostStatus(post.status as 'DRAFT' | 'PUBLISHED');
            
            if (useDraft) {
              setSaveMessage({ type: 'success', text: '已自动恢复未发布的草稿内容' });
              setTimeout(() => setSaveMessage(null), 3000);
            }
            
            // For relations, we prioritize DB values initially to ensure we have full objects
            // Future improvement: Hydrate Category/Tags from draft IDs if possible
            if ((post as any).category) {
              setSelectedCategory((post as any).category as Category);
            }
            
            if (post.tags && post.tags.length > 0) {
              setSelectedTags(post.tags as Tag[]);
            }
          }
        } catch (error) {
          console.error('Failed to load post:', error);
          setSaveMessage({ type: 'error', text: '加载文章失败' });
        } finally {
          setLoadingPost(false);
        }
      };
      
      loadPost();
    }
  }, [isEditMode, postId]);

  // Click outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) {
        setShowCategoryDropdown(false);
      }
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setShowTagDropdown(false);
      }
      if (expandedTagsRef.current && !expandedTagsRef.current.contains(e.target as Node)) {
        setShowAllTags(false);
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
    let inCodeBlock = false;
    
    lines.forEach((line, index) => {
      // 检测代码块边界 (```xxx 或 ~~~xxx)
      if (/^(`{3,}|~{3,})/.test(line.trim())) {
        inCodeBlock = !inCodeBlock;
        return;
      }
      
      // 只在非代码块中识别标题
      if (!inCodeBlock) {
        const match = line.match(/^(#{1,6})\s+(.+)$/);
        if (match) {
          items.push({
            level: match[1].length,
            text: match[2].trim(),
            line: index + 1,
          });
        }
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

  // Editor commands for toolbar
  const editorCommands = useEditorCommands(editorViewRef);
  
  // Table commands for table operations
  const tableCommands = useTableCommands(editorViewRef);
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  const [showTableToolbar, setShowTableToolbar] = useState(false);
  const tableToolbarTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Check table state on selection change and scroll
  useEffect(() => {
    const checkTable = () => {
      const info = tableCommands.getTableInfo();
      setTableInfo(info);
    };
    
    // Check on content change
    const interval = setInterval(checkTable, 100);
    
    // Also update on scroll
    const editorContainer = editorContainerRef.current;
    if (editorContainer) {
      const scroller = editorContainer.querySelector('.cm-scroller');
      if (scroller) {
        scroller.addEventListener('scroll', checkTable);
      }
    }
    
    return () => {
      clearInterval(interval);
      if (editorContainer) {
        const scroller = editorContainer.querySelector('.cm-scroller');
        if (scroller) {
          scroller.removeEventListener('scroll', checkTable);
        }
      }
    };
  }, [tableCommands]);
  
  // Table toolbar hover handlers
  const handleTableTriggerEnter = useCallback(() => {
    if (tableToolbarTimeoutRef.current) {
      clearTimeout(tableToolbarTimeoutRef.current);
      tableToolbarTimeoutRef.current = null;
    }
    setShowTableToolbar(true);
  }, []);
  
  const handleTableTriggerLeave = useCallback(() => {
    // Delay hiding to allow moving to toolbar
    tableToolbarTimeoutRef.current = setTimeout(() => {
      setShowTableToolbar(false);
    }, 200);
  }, []);
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (tableToolbarTimeoutRef.current) {
        clearTimeout(tableToolbarTimeoutRef.current);
      }
    };
  }, []);

  type InsertMode = 'wrap' | 'insert' | 'lineStart';
  
  const insertMarkdown = useCallback((prefix: string, suffix: string = '', mode: InsertMode = 'wrap') => {
    if (mode === 'lineStart') {
      editorCommands.toggleLineStart(prefix);
    } else if (suffix) {
      editorCommands.toggleWrap(prefix, suffix);
    } else {
      editorCommands.insertText(prefix);
    }
    editorCommands.focus();
  }, [editorCommands]);

  // Handle formatting keyboard shortcuts (Ctrl+B, Ctrl+I, Ctrl+K, etc.)
  useEffect(() => {
    const handleFormatShortcut = (e: KeyboardEvent) => {
      // Only handle if Ctrl/Cmd is pressed
      if (!(e.ctrlKey || e.metaKey)) return;
      
      switch (e.key.toLowerCase()) {
        case 'b': // Bold
          e.preventDefault();
          editorCommands.toggleWrap('**', '**');
          editorCommands.focus();
          break;
        case 'i': // Italic
          e.preventDefault();
          editorCommands.toggleWrap('*', '*');
          editorCommands.focus();
          break;
        case 'k': // Link (Ctrl+K) or Code Block (Ctrl+Shift+K)
          e.preventDefault();
          if (e.shiftKey) {
            editorCommands.toggleWrap('```\n', '\n```');
          } else {
            editorCommands.toggleWrap('[', '](url)');
          }
          editorCommands.focus();
          break;
        case '`': // Inline code
          e.preventDefault();
          editorCommands.toggleWrap('`', '`');
          editorCommands.focus();
          break;
        case 'u': // Underline
          e.preventDefault();
          editorCommands.toggleWrap('<u>', '</u>');
          editorCommands.focus();
          break;
      }
    };
    window.addEventListener('keydown', handleFormatShortcut);
    return () => window.removeEventListener('keydown', handleFormatShortcut);
  }, [editorCommands]);

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
      // If editing a PUBLISHED post, "Save" only updates the Draft Cache
      // Un-published (DRAFT) posts update the DB directly
      if (isEditMode && postId && _postStatus === 'PUBLISHED') {
         await postService.autoSave(postId, {
            title: title.trim(),
            content,
            summary: summary.trim() || undefined,
            categoryId: selectedCategory?.id,
            tagIds: selectedTags.map(t => t.id),
            status: 'PUBLISHED',
         });
         setSaveMessage({ type: 'success', text: '草稿已保存（未发布）' });
      } else {
        // Normal save to DB
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
          setSaveMessage({ type: 'success', text: '保存成功！' });
          // If it was a new post, navigate to edit page
          if (!isEditMode && res.data.id) {
            setTimeout(() => navigate(`/posts/edit/${res.data.id}`), 1000);
          }
        } else {
          setSaveMessage({ type: 'error', text: res.message || '保存失败' });
        }
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
        try {
          const res = await tagService.create({ name: tagSearch.trim() });
          if (res.data) {
            setTags([...tags, res.data]);
            setSelectedTags([...selectedTags, res.data]);
          }
        } catch (error) {
          console.error('Failed to create tag:', error);

      }
      }
      setTagSearch('');
      setShowTagDropdown(false);
    }
  };

  const removeTag = (tagId: number) => {
    setSelectedTags(selectedTags.filter(t => t.id !== tagId));
  };



  // Loading skeleton
  if (_loadingPost || loadingCategories || loadingTags) {
    return (
      <div className="flex flex-col absolute inset-0 h-full bg-[#0a0a0c] z-50 overflow-hidden">
        {/* Header Skeleton */}
        <div className="h-14 flex-shrink-0 border-b border-white/10 bg-[#0a0a0c] flex items-center justify-between px-6 gap-4">
           {/* Left */}
           <div className="flex items-center gap-3 flex-1">
             <div className="w-8 h-8 rounded-lg bg-zinc-800 animate-pulse flex-shrink-0" /> {/* Back */}
             <div className="h-8 rounded-lg bg-zinc-800 animate-pulse flex-1 max-w-md" />   {/* Title */}
             <div className="w-px h-6 bg-white/10 flex-shrink-0 mx-1" />
             <div className="flex gap-2">
                <div className="w-24 h-7 rounded bg-zinc-800 animate-pulse" />
                <div className="w-16 h-7 rounded bg-zinc-800 animate-pulse" />
             </div>
           </div>
           
           {/* Right */}
           <div className="flex items-center gap-2">
              <div className="w-20 h-8 rounded-lg bg-zinc-800 animate-pulse" /> {/* AI */}
              <div className="w-8 h-8 rounded-lg bg-zinc-800 animate-pulse" />  {/* Settings */}
              <div className="w-[90px] h-8 rounded-lg bg-zinc-800 animate-pulse" /> {/* Save */}
              <div className="w-[90px] h-8 rounded-lg bg-primary/20 animate-pulse" /> {/* Publish */}
           </div>
        </div>

        {/* Toolbar Skeleton */}
        <div className="flex-shrink-0 h-10 border-b border-white/10 bg-[#0a0a0c]/80 flex items-center px-4 gap-4 overflow-hidden">
             <div className="flex items-center gap-1 pr-3 border-r border-white/10">
                <div className="w-6 h-6 rounded bg-zinc-800 animate-pulse" />
                <div className="w-6 h-6 rounded bg-zinc-800 animate-pulse" />
                <div className="w-6 h-6 rounded bg-zinc-800 animate-pulse" />
             </div>
             <div className="flex items-center gap-1 px-3">
                <div className="w-6 h-6 rounded bg-zinc-800 animate-pulse" />
                <div className="w-6 h-6 rounded bg-zinc-800 animate-pulse" />
                <div className="w-6 h-6 rounded bg-zinc-800 animate-pulse" />
             </div>
             <div className="flex-1" />
        </div>

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
             {/* Editor */}
             <div className="flex-1 p-8 space-y-6">
                <div className="w-3/4 h-10 rounded-lg bg-zinc-800 animate-pulse" /> {/* H1 title-like */}
                <div className="space-y-4">
                    <div className="w-full h-4 rounded bg-zinc-800 animate-pulse" />
                    <div className="w-11/12 h-4 rounded bg-zinc-800 animate-pulse" />
                    <div className="w-full h-4 rounded bg-zinc-800 animate-pulse" />
                    <div className="w-4/5 h-4 rounded bg-zinc-800 animate-pulse" />
                </div>
                <div className="space-y-4 pt-4">
                    <div className="w-full h-4 rounded bg-zinc-800 animate-pulse" />
                    <div className="w-10/12 h-4 rounded bg-zinc-800 animate-pulse" />
                </div>
             </div>
             
             {/* Preview */}
             <div className="flex-1 border-l border-white/10 bg-black/20 p-8 space-y-6 hidden lg:block">
                <div className="w-2/3 h-10 rounded-lg bg-zinc-800 animate-pulse" />
                <div className="space-y-4">
                    <div className="w-full h-4 rounded bg-zinc-800 animate-pulse" />
                    <div className="w-10/12 h-4 rounded bg-zinc-800 animate-pulse" />
                    <div className="w-full h-4 rounded bg-zinc-800 animate-pulse" />
                </div>
                <div className="w-full h-48 rounded-lg bg-zinc-800 animate-pulse" />
             </div>
        </div>
        
        {/* Footer (Status Bar) */}
        <div className="h-8 flex-shrink-0 border-t border-white/10 bg-[#0a0a0c] flex items-center justify-between px-4">
             <div className="w-24 h-3 rounded bg-zinc-800 animate-pulse" />
             <div className="w-16 h-3 rounded bg-zinc-800 animate-pulse" />
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
            <div className="flex items-center justify-between px-6 py-3.5 gap-4">
              {/* Left Block: Back + Title + Metadata */}
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <button 
                  onClick={() => navigate('/posts')}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
                  title="返回列表"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                
                {/* Title Input */}
                <motion.div className="flex-1 min-w-[150px]">
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="请输入文章标题..."
                    className="w-full bg-transparent text-xl font-bold text-white placeholder-gray-600 focus:outline-none min-w-0"
                  />
                </motion.div>

                {/* Divider */}
                <div className="w-px h-6 bg-white/10 flex-shrink-0" />

                {/* Metadata: Category & Tags */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  {/* Category Selector */}
                  <div ref={categoryDropdownRef} className="relative">
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        if (!showCategoryDropdown) {
                          setShowAllTags(false);
                          setShowTagDropdown(false);
                        }
                        setShowCategoryDropdown(!showCategoryDropdown);
                      }}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-white/10 transition-colors text-sm"
                    >
                      <span className={selectedCategory ? 'text-primary font-medium' : 'text-gray-500'}>
                        {selectedCategory?.name || '选择分类'}
                      </span>
                      <ChevronDown className={cn("w-3 h-3 text-gray-500 transition-transform", showCategoryDropdown && "rotate-180")} />
                    </button>
                    
                    <AnimatePresence>
                      {showCategoryDropdown && (
                        <motion.div
                          initial={{ opacity: 0, y: 5, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 5, scale: 0.95 }}
                          className="absolute top-full left-0 mt-2 w-60 z-50 bg-[#1a1a1c] border border-white/10 rounded-lg shadow-xl overflow-hidden"
                        >
                          <div className="p-2 border-b border-white/10">
                            <input
                              type="text"
                              value={categorySearch}
                              onChange={(e) => setCategorySearch(e.target.value)}
                              placeholder="搜索分类..."
                              autoFocus
                              className="w-full px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-primary/50"
                            />
                          </div>
                          <div className="max-h-48 overflow-auto py-1">
                            {filteredCategories.map((cat) => (
                              <button
                                key={cat.id}
                                onClick={() => { setSelectedCategory(cat); setShowCategoryDropdown(false); }}
                                className={cn(
                                  'w-full px-3 py-1.5 text-left text-sm hover:bg-white/10',
                                  selectedCategory?.id === cat.id ? 'text-primary' : 'text-gray-300'
                                )}
                              >
                                {cat.name}
                              </button>
                            ))}
                            <button
                              onClick={() => { setShowCategoryDropdown(false); setShowCreateCategoryModal(true); }}
                              className="w-full px-3 py-1.5 text-left text-xs text-primary hover:bg-white/10 flex items-center gap-2 border-t border-white/10 mt-1 pt-2"
                            >
                              <Plus className="w-3 h-3" /> 新建分类
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Tag Selector */}
                  <div ref={tagDropdownRef} className="relative flex items-center gap-1.5">
                     {/* Stable tags - first 2 always rendered if exist */}
                       {selectedTags.slice(0, 2).map((tag) => (
                        <motion.span
                          key={tag.id}
                          className="flex items-center gap-1 px-1.5 py-0.5 bg-primary/10 text-primary rounded text-xs border border-primary/20 whitespace-nowrap overflow-hidden z-10"
                        >
                          <span className="flex-shrink-0">{tag.name}</span>
                          <button onClick={() => removeTag(tag.id)} className="w-4 h-4 flex items-center justify-center hover:text-white flex-shrink-0 rounded-full hover:bg-primary/20 transition-colors"><X className="w-3 h-3" /></button>
                        </motion.span>
                      ))}

                     {/* Hidden Tags Floating Panel */}
                     {selectedTags.length > 2 && (
                       <div ref={expandedTagsRef} className="relative">
                         <button
                           onClick={() => {
                             if (!showAllTags) {
                               setShowCategoryDropdown(false);
                               setShowTagDropdown(false);
                             }
                             setShowAllTags(!showAllTags);
                           }}
                           className="flex items-center justify-center gap-0.5 w-14 py-0.5 bg-white/5 text-gray-400 rounded text-xs border border-white/10 hover:bg-white/10 transition-colors z-10"
                         >
                           <span>{showAllTags ? '收起' : `+${selectedTags.length - 2}`}</span>
                           <ChevronDown className={cn("w-3 h-3 transition-transform", showAllTags && "rotate-180")} />
                         </button>
                         
                         <AnimatePresence>
                          {showAllTags && (
                            <motion.div
                              initial={{ opacity: 0, y: 5, scale: 0.95 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 5, scale: 0.95 }}
                              className="absolute top-full right-0 mt-2 p-2 bg-[#1a1a1c] border border-white/10 rounded-lg shadow-xl z-50 grid grid-cols-3 gap-2 w-[340px] origin-top-right"
                            >
                               {selectedTags.slice(2).map((tag) => (
                                <span
                                  key={tag.id}
                                  className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded text-xs border border-primary/20 overflow-hidden"
                                >
                                  <span className="truncate" title={tag.name}>{tag.name}</span>
                                  <button onClick={() => removeTag(tag.id)} className="w-4 h-4 flex items-center justify-center hover:text-white rounded-full flex-shrink-0 hover:bg-primary/20 transition-colors"><X className="w-3 h-3" /></button>
                                </span>
                              ))}
                            </motion.div>
                          )}
                         </AnimatePresence>
                       </div>
                     )}


                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        if (!showTagDropdown) {
                          setShowCategoryDropdown(false);
                          setShowAllTags(false);
                        }
                        setShowTagDropdown(!showTagDropdown);
                      }}
                      className={cn(
                        "p-1 rounded hover:bg-white/10 text-gray-400 hover:text-primary transition-colors",
                         showTagDropdown && "bg-white/10 text-primary"
                      )}
                    >
                      <Plus className="w-4 h-4" />
                    </button>

                    <AnimatePresence>
                      {showTagDropdown && (
                        <motion.div
                          initial={{ opacity: 0, y: 5, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 5, scale: 0.95 }}
                          className="absolute top-full right-0 mt-2 w-64 z-50 bg-[#1a1a1c] border border-white/10 rounded-lg shadow-xl overflow-hidden"
                        >
                          <div className="p-2 border-b border-white/10">
                            <input
                              type="text"
                              value={tagSearch}
                              onChange={(e) => setTagSearch(e.target.value)}
                              onKeyDown={handleTagKeyDown}
                              placeholder="搜索或新建标签..."
                              autoFocus
                              className="w-full px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-primary/50"
                            />
                          </div>
                          <div className="max-h-48 overflow-auto py-1">
                             {filteredTags.map((tag) => {
                               const isSelected = selectedTags.some(t => t.id === tag.id);
                               return (
                                <button
                                  key={tag.id}
                                  onClick={() => { 
                                    if(isSelected) removeTag(tag.id);
                                    else setSelectedTags([...selectedTags, tag]);
                                    setTagSearch('');
                                  }}
                                  className={cn(
                                    'w-full px-3 py-1.5 text-left text-sm hover:bg-white/10 flex justify-between items-center',
                                    isSelected ? 'text-primary' : 'text-gray-300'
                                  )}
                                >
                                  {tag.name}
                                  {isSelected && <CheckCircle className="w-3 h-3" />}
                                </button>
                               );
                             })}
                             {tagSearch && !filteredTags.some(t => t.name === tagSearch) && (
                               <div className="px-3 py-1.5 text-xs text-gray-500">
                                 按回车创建 "{tagSearch}"
                               </div>
                             )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
              
              {/* Right Buttons */}
              <div className="flex items-center gap-2 flex-shrink-0 relative z-30 bg-[#0a0a0c]">
                
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowAI(true)}
                  className={cn(
                    'flex h-8 items-center gap-1.5 px-3 rounded-lg transition-colors text-sm',
                    showAI ? 'bg-primary text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'
                  )}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  AI
                </motion.button>
                
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowSettings(true)}
                  className={cn(
                    'flex h-8 items-center gap-1.5 px-3 rounded-lg transition-colors text-sm',
                    showSettings ? 'bg-primary text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'
                  )}
                >
                  <Settings className="w-3.5 h-3.5" />
                </motion.button>
                
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSave}
                  disabled={isSaving || isPublishing}
                  className={cn(
                    'flex h-8 items-center justify-center gap-1.5 px-3 min-w-[90px] rounded-lg transition-colors text-sm',
                    isSaving ? 'bg-primary/50 text-white cursor-wait' : 'bg-white/10 text-gray-300 hover:bg-white/20'
                  )}
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {isSaving ? '...' : '保存'}
                </motion.button>
                
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handlePublish}
                  disabled={isSaving || isPublishing}
                  className={cn(
                    'flex h-8 items-center justify-center gap-1.5 px-3 min-w-[90px] rounded-lg transition-colors text-sm',
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

      {/* Formatting Toolbar - outer container with overflow-visible for tooltips */}
      <div className="relative border-b border-white/10 bg-[#0a0a0c]/80">
        <div className="flex items-center gap-1 px-4 py-1.5 overflow-x-auto">
        {/* Undo/Redo */}
        <div className="flex items-center gap-0.5 pr-3 border-r border-white/10">
          <ToolbarButton onClick={() => editorCommands.undo()} tooltip="撤销 (⌘Z)">
            <Undo2 className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editorCommands.redo()} tooltip="重做 (⇧⌘Z)">
            <Redo2 className="w-4 h-4" />
          </ToolbarButton>
        </div>
        {/* Headings */}
        <div className="flex items-center gap-0.5 pr-3 border-r border-white/10">
          <ToolbarButton onClick={() => insertMarkdown('# ', '', 'lineStart')} tooltip="标题 1 (H1)">
            <Heading1 className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => insertMarkdown('## ', '', 'lineStart')} tooltip="标题 2 (H2)">
            <Heading2 className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => insertMarkdown('### ', '', 'lineStart')} tooltip="标题 3 (H3)">
            <Heading3 className="w-4 h-4" />
          </ToolbarButton>
        </div>
        
        {/* Text Formatting */}
        <div className="flex items-center gap-0.5 px-3 border-r border-white/10">
          <ToolbarButton onClick={() => insertMarkdown('**', '**')} tooltip="粗体 (⌘B)">
            <Bold className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => insertMarkdown('*', '*')} tooltip="斜体 (⌘I)">
            <Italic className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => insertMarkdown('<u>', '</u>')} tooltip="下划线 (⌘U)">
            <Underline className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => insertMarkdown('~~', '~~')} tooltip="删除线">
            <Strikethrough className="w-4 h-4" />
          </ToolbarButton>
        </div>

        {/* Code */}
        <div className="flex items-center gap-0.5 px-3 border-r border-white/10">
          <ToolbarButton onClick={() => insertMarkdown('`', '`')} tooltip="行内代码 (⌘`)">
            <Code className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => insertMarkdown('```\n', '\n```')} tooltip="代码块 (⇧⌘K)">
            <FileCode2 className="w-4 h-4" />
          </ToolbarButton>
        </div>
        
        {/* Lists */}
        <div className="flex items-center gap-0.5 px-3 border-r border-white/10">
          <ToolbarButton onClick={() => insertMarkdown('- ', '', 'lineStart')} tooltip="无序列表">
            <List className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => insertMarkdown('1. ', '', 'lineStart')} tooltip="有序列表">
            <ListOrdered className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => insertMarkdown('- [ ] ', '', 'lineStart')} tooltip="任务列表">
            <CheckSquare className="w-4 h-4" />
          </ToolbarButton>
        </div>

        {/* Insert */}
        <div className="flex items-center gap-0.5 px-3 border-r border-white/10">
          <ToolbarButton onClick={() => insertMarkdown('[', '](url)', 'wrap')} tooltip="链接 (⌘K)">
            <Link2 className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => insertMarkdown('![', '](image-url)', 'wrap')} tooltip="图片">
            <Image className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => insertMarkdown('| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n', '', 'insert')} tooltip="表格">
            <Table2 className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => insertMarkdown('\n---\n', '', 'insert')} tooltip="分割线">
            <Minus className="w-4 h-4" />
          </ToolbarButton>
        </div>

        {/* Advanced: Quote, Math, Diagram */}
        <div className="flex items-center gap-0.5 px-3">
          <ToolbarButton onClick={() => insertMarkdown('> ', '', 'lineStart')} tooltip="引用">
            <Quote className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => insertMarkdown('$$\n', '\n$$', 'wrap')} tooltip="数学公式">
            <Sigma className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => insertMarkdown('```mermaid\n', '\n```', 'wrap')} tooltip="流程图">
            <GitBranch className="w-4 h-4" />
          </ToolbarButton>
        </div>
        
        {/* Spacer */}
        <div className="flex-1" />
        
        {/* Zoom Controls with Domain Toggle */}
        <div className="flex items-center gap-0.5 px-3 border-l border-white/10">
          <ToolbarButton
            onClick={() => {
              if (zoomTarget === 'editor') {
                setEditorFontSize(s => Math.max(12, s - 1));
              } else if (zoomTarget === 'preview') {
                setPreviewFontSize(s => Math.max(12, s - 1));
              } else {
                setEditorFontSize(s => Math.max(12, s - 1));
                setPreviewFontSize(s => Math.max(12, s - 1));
              }
            }}
            tooltip={`缩小${zoomTarget === 'editor' ? '编辑器' : zoomTarget === 'preview' ? '预览' : ''}字号`}
          >
            <ZoomOut className="w-4 h-4" />
          </ToolbarButton>
          
          {/* Font Size Display with Domain Toggle */}
          <button
            onClick={() => setZoomTarget(t => t === 'both' ? 'editor' : t === 'editor' ? 'preview' : 'both')}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-all select-none min-w-[60px] justify-center",
              "hover:bg-white/10",
              zoomTarget === 'both' && "bg-gradient-to-r from-blue-500/10 to-emerald-500/10",
              zoomTarget === 'editor' && "text-blue-400 bg-blue-500/10",
              zoomTarget === 'preview' && "text-emerald-400 bg-emerald-500/10"
            )}
            title={`点击切换控制域 (当前: ${zoomTarget === 'both' ? '全部' : zoomTarget === 'editor' ? '编辑器' : '预览'})`}
          >
            {zoomTarget === 'both' ? (
              <>
                <span className="text-blue-400">{editorFontSize}</span>
                <span className="text-gray-500 mx-0.5">||</span>
                <span className="text-emerald-400">{previewFontSize}</span>
              </>
            ) : zoomTarget === 'editor' ? (
              <>
                <FileCode2 className="w-3 h-3" />
                <span>{editorFontSize}px</span>
              </>
            ) : (
              <>
                <Eye className="w-3 h-3" />
                <span>{previewFontSize}px</span>
              </>
            )}
          </button>
          
          <ToolbarButton
            onClick={() => {
              if (zoomTarget === 'editor') {
                setEditorFontSize(s => Math.min(24, s + 1));
              } else if (zoomTarget === 'preview') {
                setPreviewFontSize(s => Math.min(24, s + 1));
              } else {
                setEditorFontSize(s => Math.min(24, s + 1));
                setPreviewFontSize(s => Math.min(24, s + 1));
              }
            }}
            tooltip={`放大${zoomTarget === 'editor' ? '编辑器' : zoomTarget === 'preview' ? '预览' : ''}字号`}
          >
            <ZoomIn className="w-4 h-4" />
          </ToolbarButton>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-0.5 px-3 border-l border-white/10">
          <ToolbarButton 
            onClick={() => setViewMode(viewMode === 'edit' ? 'split' : 'edit')} 
            tooltip="源码模式"
            isActive={viewMode === 'edit'}
          >
            <FileCode2 className="w-4 h-4" />
          </ToolbarButton>
          
          <ToolbarButton 
            onClick={() => setViewMode(viewMode === 'preview' ? 'split' : 'preview')} 
            tooltip="阅读模式"
            isActive={viewMode === 'preview'}
          >
            <Eye className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarButton 
            onClick={() => setIsFullscreen(!isFullscreen)} 
            tooltip={isFullscreen ? '退出全屏' : '进入全屏'}
            isActive={isFullscreen}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </ToolbarButton>

          <ToolbarButton 
            onClick={() => setShowToc(!showToc)} 
            tooltip={showToc ? '关闭目录' : '打开目录'}
            isActive={showToc}
          >
            <ListTree className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarButton 
            onClick={() => setIsAutoSaveEnabled(!isAutoSaveEnabled)} 
            tooltip={isAutoSaveEnabled ? '关闭自动保存' : '开启自动保存'}
            isActive={isAutoSaveEnabled}
            activeColor="emerald"
          >
            <HardDrive className="w-4 h-4" />
          </ToolbarButton>
        </div>
      </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Editor Container */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Editor */}
          <div ref={editorContainerRef} className="flex-1 overflow-hidden min-h-0 relative">
            <EditorWithPreview
              value={content}
              onChange={setContent}
              className="h-full"
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              isSyncScroll={isSyncScroll}
              editorFontSize={editorFontSize}
              previewFontSize={previewFontSize}
              showLineNumbers={showLineNumbers}
              hideToolbar
              editorViewRef={editorViewRef}
            />
            
            {/* IDEA-style Table Trigger Zones - Fixed positioning with viewport coordinates */}
            {tableInfo?.isInTable && tableInfo.tableBounds && tableInfo.rowPositions && editorContainerRef.current && (() => {
              const containerRect = editorContainerRef.current.getBoundingClientRect();
              const isInViewport = tableInfo.tableBounds.top >= containerRect.top - 100 &&
                                   tableInfo.tableBounds.top <= containerRect.bottom + 100;
              if (!isInViewport) return null;
              
              // Calculate accurate line height
              const lineHeight = tableInfo.rowPositions.length > 1
                ? tableInfo.rowPositions[1] - tableInfo.rowPositions[0]
                : 24;

              // Generate extended row positions to include the bottom of the last row
              const extendedRowPositions = [...tableInfo.rowPositions, tableInfo.rowPositions[tableInfo.rowPositions.length - 1] + lineHeight];

              return (
                <>
                  {/* Top Trigger Zone (Column Operations) */}
                  {tableInfo.columnPositions && tableInfo.columnPositions.length > 0 && (
                    <div
                      className="fixed z-40"
                      style={{
                        top: tableInfo.tableBounds.top - 20,
                        left: tableInfo.tableBounds.left,
                        height: 20,
                        width: tableInfo.tableBounds.right - tableInfo.tableBounds.left,
                      }}
                      onMouseEnter={handleTableTriggerEnter}
                      onMouseLeave={handleTableTriggerLeave}
                    >
                       {/* Render Segments between dots */}
                       {tableInfo.columnPositions.slice(0, -1).map((x: number, i: number) => {
                         const nextX = tableInfo.columnPositions![i + 1];
                         const width = nextX - x;
                         return (
                           <div
                             key={`col-seg-${i}`}
                             className="absolute top-1/2 -translate-y-1/2 h-[4px] bg-[#52525b] hover:bg-[#3b82f6] cursor-pointer transition-colors"
                             style={{
                               left: x - tableInfo.tableBounds!.left,
                               width: width,
                             }}
                             onClick={() => setShowTableToolbar(true)}
                           />
                         );
                       })}
                       
                       {/* Render Dots exactly at pipe | positions */}
                       {tableInfo.columnPositions.map((x: number, i: number) => (
                         <div
                           key={`col-dot-${i}`}
                           className="absolute top-1/2 -translate-y-1/2 w-[6px] h-[6px] bg-[#71717a] rounded-full z-10 pointer-events-none"
                           style={{
                             left: x - tableInfo.tableBounds!.left - 3, // Center 6px dot: -3px offset
                           }}
                         />
                       ))}
                    </div>
                  )}

                  {/* Left Trigger Zone (Row Operations) */}
                  {extendedRowPositions.length > 0 && (
                    <div
                      className="fixed z-40"
                      style={{
                        top: tableInfo.tableBounds.top,
                        left: tableInfo.tableBounds.left - 24,
                        width: 24,
                        height: tableInfo.tableBounds.bottom - tableInfo.tableBounds.top,
                      }}
                      onMouseEnter={handleTableTriggerEnter}
                      onMouseLeave={handleTableTriggerLeave}
                    >
                      {/* Render Segments between dots (representing rows) */}
                      {extendedRowPositions.slice(0, -1).map((y, i) => {
                        const nextY = extendedRowPositions[i + 1];
                        const height = nextY - y;
                        // Start exactly at the row top (gap position)
                        const startY = y - tableInfo.tableBounds!.top;
                        
                        return (
                          <div
                            key={`row-seg-${i}`}
                            className="absolute left-1/2 -translate-x-1/2 w-[4px] bg-[#52525b] hover:bg-[#3b82f6] cursor-pointer transition-colors"
                            style={{
                              top: startY,
                              height: height,
                            }}
                            onClick={() => setShowTableToolbar(true)}
                          />
                        );
                      })}

                      {/* Render Dots at row gaps (top/bottom of lines) */}
                      {extendedRowPositions.map((y, i) => (
                        <div
                          key={`row-dot-${i}`}
                          className="absolute left-1/2 -translate-x-1/2 w-[6px] h-[6px] bg-[#71717a] rounded-full z-10 pointer-events-none"
                          style={{
                            top: y - tableInfo.tableBounds!.top - 3, // Center 6px dot at line gap: -3px offset
                          }}
                        />
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
            
            {/* Floating Table Operations Toolbar */}
            <AnimatePresence>
              {showTableToolbar && tableInfo?.isInTable && tableInfo.tableBounds && editorContainerRef.current && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.1, ease: 'easeOut' }}
                  className="fixed z-50 flex items-center gap-1 px-1 py-0.5 bg-[#2b2b2d] border border-[#3d3d40] rounded-md shadow-xl"
                  style={{
                    // Positioned above and slightly to the right
                    top: tableInfo.tableBounds.top - 50,
                    left: tableInfo.tableBounds.left + 20,
                  }}
                  onMouseEnter={handleTableTriggerEnter}
                  onMouseLeave={handleTableTriggerLeave}
                >
                  {/* Back/Return button */}
                  <ToolbarButton
                    onClick={() => setShowTableToolbar(false)}
                    tooltip="关闭"
                    tooltipPosition="bottom"
                    className="text-indigo-400 hover:text-indigo-300"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </ToolbarButton>
                  
                  <div className="w-px h-5 bg-[#3d3d40] mx-0.5" />
                  
                  {/* Row operations - purple/pink colors like IDEA */}
                  <ToolbarButton
                    onClick={() => { tableCommands.insertRowAbove(); editorCommands.focus(); }}
                    tooltip="上方插入行"
                    tooltipPosition="bottom"
                    className={tableInfo.currentRowIndex <= 1 ? 'opacity-40 cursor-not-allowed' : 'text-fuchsia-400 hover:text-fuchsia-300'}
                  >
                    <ArrowUpToLine className="w-4 h-4" />
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => { tableCommands.insertRowBelow(); editorCommands.focus(); }}
                    tooltip="下方插入行"
                    tooltipPosition="bottom"
                    className="text-emerald-400 hover:text-emerald-300"
                  >
                    <ArrowDownToLine className="w-4 h-4" />
                  </ToolbarButton>
                  
                  <div className="w-px h-5 bg-[#3d3d40] mx-0.5" />
                  
                  {/* Column operations - blue colors */}
                  <ToolbarButton
                    onClick={() => { tableCommands.insertColumnLeft(); editorCommands.focus(); }}
                    tooltip="左侧插入列"
                    tooltipPosition="bottom"
                    className="text-sky-400 hover:text-sky-300"
                  >
                    <ArrowLeftToLine className="w-4 h-4" />
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => { tableCommands.insertColumnRight(); editorCommands.focus(); }}
                    tooltip="右侧插入列"
                    tooltipPosition="bottom"
                    className="text-sky-400 hover:text-sky-300"
                  >
                    <ArrowRightToLine className="w-4 h-4" />
                  </ToolbarButton>
                  
                  <div className="w-px h-5 bg-[#3d3d40] mx-0.5" />
                  
                  {/* Column alignment - white/gray, active is blue bg */}
                  <ToolbarButton
                    onClick={() => { tableCommands.setColumnAlignment('left'); editorCommands.focus(); }}
                    tooltip="左对齐"
                    tooltipPosition="bottom"
                    isActive={tableInfo.alignments[tableInfo.currentColumnIndex] === 'left'}
                  >
                    <AlignLeft className="w-4 h-4" />
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => { tableCommands.setColumnAlignment('center'); editorCommands.focus(); }}
                    tooltip="居中对齐"
                    tooltipPosition="bottom"
                    isActive={tableInfo.alignments[tableInfo.currentColumnIndex] === 'center'}
                  >
                    <AlignCenter className="w-4 h-4" />
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => { tableCommands.setColumnAlignment('right'); editorCommands.focus(); }}
                    tooltip="右对齐"
                    tooltipPosition="bottom"
                    isActive={tableInfo.alignments[tableInfo.currentColumnIndex] === 'right'}
                  >
                    <AlignRight className="w-4 h-4" />
                  </ToolbarButton>
                  
                  <div className="w-px h-5 bg-[#3d3d40] mx-0.5" />
                  
                  {/* Delete operations - red colors */}
                  <ToolbarButton
                    onClick={() => { tableCommands.deleteRow(); editorCommands.focus(); }}
                    tooltip="删除行"
                    tooltipPosition="bottom"
                    className={tableInfo.currentRowIndex <= 1 || tableInfo.rowCount <= 3 ? 'opacity-40 cursor-not-allowed' : 'text-rose-400 hover:text-rose-300'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => { tableCommands.deleteColumn(); editorCommands.focus(); }}
                    tooltip="删除列"
                    tooltipPosition="bottom"
                    className={tableInfo.columnCount <= 1 ? 'opacity-40 cursor-not-allowed' : 'text-rose-400 hover:text-rose-300'}
                  >
                    <X className="w-4 h-4" />
                  </ToolbarButton>
                </motion.div>
              )}
            </AnimatePresence>
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
          title="设置"
          size="md"
        >
          <div className="space-y-6">
            <div className="space-y-4">
              {/* Cover Image */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">封面图片</label>
                <div className="border-2 border-dashed border-white/20 rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer">
                  <Image className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                  <p className="text-gray-400 text-sm">点击或拖拽上传</p>
                </div>
              </div>

              {/* Publish Time */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  发布时间
                </label>
                <input
                  type="datetime-local"
                  value={publishTime}
                  onChange={(e) => setPublishTime(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-primary/50 [color-scheme:dark]"
                />
                <p className="text-xs text-gray-500 mt-1">设置文章的发布时间，支持精确到分钟</p>
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
