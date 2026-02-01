import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Save, Settings, Sparkles, ArrowLeft, Send, 
  Bold, Italic, Strikethrough, Code, List, ListOrdered,
  Link2, Image, Quote, Heading1, Heading2, Heading3,
  X, ChevronDown, Plus, Search, Loader2, CheckCircle, AlertCircle,
  Table2, Minus, CheckSquare, Sigma, GitBranch, Underline, FileCode2, ArrowUp,
  Maximize2, Minimize2, Eye, ListTree, ZoomIn, ZoomOut, Clock, HardDrive,
  Undo2, Redo2
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { EditorWithPreview, EditorView, useEditorCommands, useTableCommands, useImageUpload, UploadProgress, type ViewMode, type TableInfo, type UploadResult } from '@aetherblog/editor';
import { cn } from '@/lib/utils';
import {
  ArrowUpToLine, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, Trash2,
  AlignLeft, AlignCenter, AlignRight
} from 'lucide-react';
import { categoryService, Category } from '@/services/categoryService';
import { tagService, Tag } from '@/services/tagService';
import { postService } from '@/services/postService';
import { mediaService, getMediaUrl } from '@/services/mediaService';
import { SelectionAiToolbar } from './components/SelectionAiToolbar';
import { AiSidePanel, type AiPanelAction, type AiSidePanelHandle } from './components/AiSidePanel';
import { SlashCommandMenu } from './components/SlashCommandMenu';
import { useSidebarStore } from '@/stores';
import { useTheme } from '@aetherblog/hooks';
import { logger } from '@/lib/logger';

// 工具栏的即时提示按钮组件
interface ToolbarButtonProps {
  onClick: () => void;
  tooltip: string;
  children: React.ReactNode;
  isActive?: boolean;
  activeColor?: 'primary' | 'emerald';
  className?: string;
  /** 提示框位置: 'top' (默认) 或 'bottom' */
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
        'relative p-1.5 rounded hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors',
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
            "fixed z-[9999] px-2.5 py-1.5 text-xs text-white bg-[var(--bg-tooltip)] rounded-md border border-[var(--border-subtle)] whitespace-nowrap -translate-x-1/2 pointer-events-none shadow-lg",
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
  // 使用 resolvedTheme 确保总是向编辑器传递 'light' 或 'dark'，处理 'system' 偏好
  const { resolvedTheme } = useTheme();
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
  // 字号控制 - 分离编辑器和预览字号
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
  const [autoSaveFlash, setAutoSaveFlash] = useState(false); // 自动保存时的微妙闪烁
  const [publishTime, setPublishTime] = useState<string>('');
  // 快速创建分类模态框
  const [showCreateCategoryModal, setShowCreateCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);

  // 分类状态
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [categorySearch, setCategorySearch] = useState('');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(true);

  // 标签状态
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [loadingTags, setLoadingTags] = useState(true);
  const [showAllTags, setShowAllTags] = useState(false);
  const [aiModelId, setAiModelId] = useState<string | undefined>(undefined);
  const [aiProviderCode, setAiProviderCode] = useState<string | undefined>(undefined);

  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const expandedTagsRef = useRef<HTMLDivElement>(null);

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const aiPanelRef = useRef<AiSidePanelHandle | null>(null);
  const [pendingAiAction, setPendingAiAction] = useState<AiPanelAction | null>(null);

  // 侧边栏自动折叠
  const { setAutoCollapse } = useSidebarStore();

  // 挂载时自动折叠侧边栏，卸载时恢复
  // 使用 requestAnimationFrame + setTimeout 延迟折叠，直到页面渲染完成
  useEffect(() => {
    // 延迟折叠以避免动画与页面渲染冲突
    const rafId = requestAnimationFrame(() => {
      const timerId = setTimeout(() => {
        setAutoCollapse(true);
      }, 100); // 小延迟以获得更平滑的过渡
      
      // 在类似 ref 的闭包中存储 timerId 以便清理
      return () => clearTimeout(timerId);
    });
    
    return () => {
      cancelAnimationFrame(rafId);
      setAutoCollapse(false);
    };
  }, [setAutoCollapse]);

  // 自动保存逻辑
  const latestDataRef = useRef({ title, content, summary, selectedCategory, selectedTags });
  useEffect(() => {
    latestDataRef.current = { title, content, summary, selectedCategory, selectedTags };
  }, [title, content, summary, selectedCategory, selectedTags]);

  useEffect(() => {
    if (!isEditMode || !postId || !isAutoSaveEnabled) return;

    const timer = setInterval(() => {
      const data = latestDataRef.current;
      // 仅当内容存在时自动保存
      if (!data.title && !data.content) return;

      // 自动保存到草稿缓存 (Redis)
      postService.autoSave(postId, {
        title: data.title,
        content: data.content,
        summary: data.summary,
        categoryId: data.selectedCategory?.id,
        tagIds: data.selectedTags.map(t => t.id),
        status: _postStatus
      }).then(() => {
        // 触发微妙的保存闪烁动画
        setAutoSaveFlash(true);
        setTimeout(() => setAutoSaveFlash(false), 1500);
      }).catch(err => logger.error('Auto save failed', err));
    }, 30000);

    return () => clearInterval(timer);
  }, [isEditMode, postId, _postStatus, isAutoSaveEnabled]);

  // 视图配置自动化
  useEffect(() => {
    if (viewMode === 'edit') {
      setShowToc(true);
      setIsFullscreen(false); 
    } else if (viewMode === 'preview') {
      setIsFullscreen(true);
      setShowToc(false);
    } else {
      // 分屏模式默认值
      setIsFullscreen(false);
      setShowToc(false);
    }
  }, [viewMode]);

  // 挂载时获取分类、标签和服务器时间
  useEffect(() => {
    const fetchData = async () => {
      setLoadingCategories(true);
      setLoadingTags(true);
      try {
        const [catRes, tagRes, timeRes] = await Promise.all([
          categoryService.getList(),
          tagService.getList(),
          postService.getServerTime().catch(() => null) // API 不可用时优雅处理
        ]);
        if (catRes.data) setCategories(catRes.data);
        if (tagRes.data) setTags(tagRes.data);
        
        // 从服务器时间设置发布时间，如果 API 失败则回退到本地时间
        if (timeRes?.data?.timestamp) {
          // 服务器返回 ISO 时间戳，转换为本地 datetime-local 格式
          const serverDate = new Date(timeRes.data.timestamp);
          const year = serverDate.getFullYear();
          const month = String(serverDate.getMonth() + 1).padStart(2, '0');
          const day = String(serverDate.getDate()).padStart(2, '0');
          const hours = String(serverDate.getHours()).padStart(2, '0');
          const minutes = String(serverDate.getMinutes()).padStart(2, '0');
          setPublishTime(`${year}-${month}-${day}T${hours}:${minutes}`);
        } else {
          // 回退到本地时间
          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const day = String(now.getDate()).padStart(2, '0');
          const hours = String(now.getHours()).padStart(2, '0');
          const minutes = String(now.getMinutes()).padStart(2, '0');
          setPublishTime(`${year}-${month}-${day}T${hours}:${minutes}`);
        }
      } catch (error) {
        logger.error('Failed to fetch categories/tags:', error);
        // 出错时仍设置默认发布时间
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

  // 按 Esc 退出全屏
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isFullscreen]);

  // 处理 Ctrl+S / Cmd+S 保存
  useEffect(() => {
    const handleSaveShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleSaveShortcut);
    return () => window.removeEventListener('keydown', handleSaveShortcut);
  }, [content, title, selectedCategory, selectedTags, summary]); // 使用相关状态进行保存

  // 编辑模式下加载现有文章
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

            // 如果可用，优先使用草稿内容
            setTitle(useDraft ? draft.title : post.title);
            setContent(useDraft ? draft.content : post.content);
            setSummary((useDraft ? draft.summary : post.summary) || '');
            setPostStatus(post.status as 'DRAFT' | 'PUBLISHED');
            
            if (useDraft) {
              setSaveMessage({ type: 'success', text: '已自动恢复未发布的草稿内容' });
              setTimeout(() => setSaveMessage(null), 3000);
            }
            
            // 对于关系，我们最初优先考虑数据库值，以确保拥有完整的对象
            // 未来改进：如果可能，从草稿 ID 中恢复分类/标签
            if (post.category) {
              setSelectedCategory(post.category as Category);
            }
            
            if (post.tags && post.tags.length > 0) {
              setSelectedTags(post.tags as Tag[]);
            }
          }
        } catch (error) {
          logger.error('Failed to load post:', error);
          setSaveMessage({ type: 'error', text: '加载文章失败' });
        } finally {
          setLoadingPost(false);
        }
      };
      
      loadPost();
    }
  }, [isEditMode, postId]);

  // 点击外部关闭下拉菜单
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

  // 基于搜索过滤分类
  const filteredCategories = useMemo(() => {
    if (!categorySearch) return categories;
    return categories.filter(c => 
      c.name.toLowerCase().includes(categorySearch.toLowerCase())
    );
  }, [categories, categorySearch]);

  // 基于搜索过滤标签
  const filteredTags = useMemo(() => {
    if (!tagSearch) return tags.filter(t => !selectedTags.find(s => s.id === t.id));
    return tags.filter(t => 
      t.name.toLowerCase().includes(tagSearch.toLowerCase()) &&
      !selectedTags.find(s => s.id === t.id)
    );
  }, [tags, tagSearch, selectedTags]);

  // 字符、单词和行数统计
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

  // 提取 TOC 标题
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

  // 用于在 TOC 导航期间存储原始同步滚动状态的 Ref
  const syncScrollBeforeNavRef = useRef(false);

  // 滚动到标题 - 虚拟 DOM 准确性的两阶段方法
  const scrollToHeading = useCallback((headingText: string, lineNumber: number) => {
    const editorContainer = editorContainerRef.current;
    if (!editorContainer) return;
    
    // 暂时禁用同步滚动以防止干扰
    syncScrollBeforeNavRef.current = isSyncScroll;
    if (isSyncScroll) {
      setIsSyncScroll(false);
    }
    
    const cmScroller = editorContainer.querySelector('.cm-scroller') as HTMLElement | null;
    const cmContent = editorContainer.querySelector('.cm-content') as HTMLElement | null;

    // 将执行包装在 setTimeout 中，以确保 setIsSyncScroll(false) 已传播到子组件
    setTimeout(() => {
    // 辅助函数：在编辑器 DOM 中查找标题
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

    // 辅助函数：将编辑器滚动到元素
    const scrollEditorToElement = (element: HTMLElement) => {
      if (!cmScroller || !cmContent) return;
      const lineTop = element.offsetTop - cmContent.offsetTop;
      cmScroller.scrollTo({ top: Math.max(0, lineTop - 50), behavior: 'smooth' });
    };

    // 辅助函数：将预览滚动到标题
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

    // 阶段 1：首先尝试直接文本匹配
    let foundLine = findHeadingInEditor();
    
    if (foundLine) {
      // 标题在可见 DOM 中 - 直接滚动（均平滑）
      scrollEditorToElement(foundLine);
      scrollPreviewToHeading(); // 预览总是有 DOM，所以这行得通
    } else if (cmScroller && cmContent) {
      // 阶段 2：标题不在 DOM 中 - 使用 "Seek & Lock" 方法
      
      // 2a: 启动平滑滚动到编辑器的估计位置
      const lineHeight = 24;
      const estimatedTop = (lineNumber - 1) * lineHeight;
      cmScroller.scrollTo({ top: Math.max(0, estimatedTop - 50), behavior: 'smooth' });
      
      // 2b: 预览没有虚拟化，所以我们总是可以直接且平滑地找到并滚动到它
      // 我们不需要预览的估计，只需强制搜索
      scrollPreviewToHeading();
      
      // 2c: MutationObserver (零开销)
      // 我们不每帧轮询，而是等待浏览器通知我们 DOM 更新
      
      const observerTimeout = setTimeout(() => {
        observer.disconnect();
      }, 2000); // 安全超时

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            // 仅检查新添加的节点
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === 1) { // 元素节点
                const el = node as HTMLElement;
                // 检查这个新节点是否包含我们的标题的行
                if (el.classList.contains('cm-line')) {
                  const text = el.textContent || '';
                  if (text.includes(headingText) && /^#+\s/.test(text)) {
                    // 目标已获取！
                    // 仅当偏差显著 (> 50px) 时才更正，以避免视觉抖动
                    // 仅当估计目标和实际目标之间的偏差显著时才更正
                    // 如果我们已经去了正确的地方，这可以防止中断平滑滚动
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
        // 开始观察行添加
        observer.observe(cmContent, { childList: true, subtree: true });
        
        // 最终检查：以防它在观察开始前刚刚出现
        const finalLine = findHeadingInEditor();
        if (finalLine) {
          scrollEditorToElement(finalLine);
          observer.disconnect();
          clearTimeout(observerTimeout);
        }
      }
    }

    // 在足够的时间让所有动画完成后恢复同步滚动
    // 增加到 1500ms 以覆盖长滚动和轮询时间
    setTimeout(() => {
      if (syncScrollBeforeNavRef.current) {
        setIsSyncScroll(true);
      }
    }, 1500);
    }, 10);
  }, [isSyncScroll, stats.lines]);

  // 滚动到顶部函数 - 针对 CodeMirror 的内部滚动条
  const scrollToTop = useCallback(() => {
    // 查找编辑器内的所有滚动容器
    const editorContainer = editorContainerRef.current;
    if (!editorContainer) return;
    
    // 滚动 CodeMirror 滚动条
    const cmScroller = editorContainer.querySelector('.cm-scroller');
    if (cmScroller) {
      cmScroller.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    // 同时滚动预览面板 (寻找带有 bg-[#0a0a0c] 的容器)
    const previewPanels = editorContainer.querySelectorAll('.overflow-y-auto, [class*="overflow-y-auto"]');
    previewPanels.forEach(panel => {
      panel.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, []);

  // 工具栏的编辑器命令
  const editorCommands = useEditorCommands(editorViewRef);
  
  // 表格操作的表格命令
  const tableCommands = useTableCommands(editorViewRef);
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  const [showTableToolbar, setShowTableToolbar] = useState(false);
  const tableToolbarTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openAiPanel = useCallback((action?: AiPanelAction) => {
    setShowToc(false);
    setShowAI(true);
    if (action) {
      setPendingAiAction(action);
    }
  }, []);

  useEffect(() => {
    const savedModelId = localStorage.getItem('aetherblog.editor.aiModelId') || undefined;
    const savedProviderCode = localStorage.getItem('aetherblog.editor.aiProviderCode') || undefined;
    if (savedModelId && savedProviderCode) {
      setAiModelId(savedModelId);
      setAiProviderCode(savedProviderCode);
    }
  }, []);

  const handleModelChange = useCallback((modelId: string, providerCode: string) => {
    setAiModelId(modelId);
    setAiProviderCode(providerCode);
    localStorage.setItem('aetherblog.editor.aiModelId', modelId);
    localStorage.setItem('aetherblog.editor.aiProviderCode', providerCode);
  }, []);

  useEffect(() => {
    if (showAI && pendingAiAction) {
      aiPanelRef.current?.runAction(pendingAiAction);
      setPendingAiAction(null);
    }
  }, [showAI, pendingAiAction]);

  const insertAiText = useCallback((text: string) => {
    editorCommands.insertText(text);
    editorCommands.focus();
  }, [editorCommands]);

  const replaceAiContent = useCallback((text: string) => {
    const view = editorViewRef.current;
    if (!view) {
      setContent(text);
      return;
    }

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: text.length },
    });
    view.focus();
  }, [setContent]);

  const applyAiTags = useCallback(async (tagNames: string[], mode: 'replace' | 'append') => {
    const normalized = Array.from(new Set(tagNames.map(name => name.trim()).filter(Boolean)));
    if (normalized.length === 0) return;

    const existingMap = new Map(tags.map(tag => [tag.name.toLowerCase(), tag]));
    const nextSelected: Tag[] = mode === 'append' ? [...selectedTags] : [];

    for (const name of normalized) {
      const key = name.toLowerCase();
      let tag = existingMap.get(key);
      if (!tag) {
        try {
          const res = await tagService.create({ name });
          if (res.data) {
            tag = res.data;
            existingMap.set(key, tag);
            setTags(prev => [...prev, tag!]);
          }
        } catch (error) {
          logger.error('Failed to create tag:', error);
        }
      }

      if (tag && !nextSelected.find(item => item.id === tag!.id)) {
        nextSelected.push(tag);
      }
    }

    setSelectedTags(nextSelected);
  }, [tags, selectedTags, setTags, setSelectedTags]);

  // 图片上传 Hook
  const handleUploadFn = useCallback(async (file: File, onProgress?: (percent: number) => void): Promise<UploadResult> => {
    const result = await mediaService.upload(file, onProgress);
    return {
      url: getMediaUrl(result.fileUrl),
      originalName: result.originalName,
      width: result.width,
      height: result.height,
    };
  }, []);

  const {
    uploads,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    handlePaste,
    isDragging,
    removeUpload,
    retryUpload,
    clearCompleted,
  } = useImageUpload({
    uploadFn: handleUploadFn,
    onUploadComplete: (result) => {
      //上传成功后插入图片到编辑器
      editorCommands.insertImage(result.url, result.originalName);
    },
    onUploadError: (error, file) => {
      logger.error('图片上传失败:', error, file.name);
    },
  });
  // 在选择更改和滚动时检查表格状态
  useEffect(() => {
    const checkTable = () => {
      const info = tableCommands.getTableInfo();
      setTableInfo(info);
    };
    
    // 检查内容更改
    const interval = setInterval(checkTable, 100);
    
    // 滚动时也更新
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
  
  // 表格工具栏悬停处理程序
  const handleTableTriggerEnter = useCallback(() => {
    if (tableToolbarTimeoutRef.current) {
      clearTimeout(tableToolbarTimeoutRef.current);
      tableToolbarTimeoutRef.current = null;
    }
    setShowTableToolbar(true);
  }, []);
  
  const handleTableTriggerLeave = useCallback(() => {
    // 延迟隐藏以允许移动到工具栏
    tableToolbarTimeoutRef.current = setTimeout(() => {
      setShowTableToolbar(false);
    }, 200);
  }, []);
  
  // 卸载时清理超时
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

  // 处理格式化键盘快捷键 (Ctrl+B, Ctrl+I, Ctrl+K 等)
  useEffect(() => {
    const handleFormatShortcut = (e: KeyboardEvent) => {
      // 仅在按下 Ctrl/Cmd 时处理
      // 仅在按下 Ctrl/Cmd 时处理
      if (!(e.ctrlKey || e.metaKey)) return;
      
      switch (e.key.toLowerCase()) {
        case 'b': // 粗体
          e.preventDefault();
          editorCommands.toggleWrap('**', '**');
          editorCommands.focus();
          break;
        case 'i': // 斜体
          e.preventDefault();
          editorCommands.toggleWrap('*', '*');
          editorCommands.focus();
          break;
        case 'k': // 链接 (Ctrl+K) 或代码块 (Ctrl+Shift+K)
          e.preventDefault();
          if (e.shiftKey) {
            editorCommands.toggleWrap('```\n', '\n```');
          } else {
            editorCommands.toggleWrap('[', '](url)');
          }
          editorCommands.focus();
          break;
        case '`': // 行内代码
          e.preventDefault();
          editorCommands.toggleWrap('`', '`');
          editorCommands.focus();
          break;
        case 'u': // 下划线
          e.preventDefault();
          editorCommands.toggleWrap('<u>', '</u>');
          editorCommands.focus();
          break;
      }
    };
    window.addEventListener('keydown', handleFormatShortcut);
    return () => window.removeEventListener('keydown', handleFormatShortcut);
  }, [editorCommands]);

  // 验证检查
  const validatePost = (forPublish = false) => {
    if (!title.trim()) {
      setSaveMessage({ type: 'error', text: '请输入文章标题' });
      return false;
    }
    if (!content.trim()) {
      setSaveMessage({ type: 'error', text: '请输入文章内容' });
      return false;
    }
    // 发布需要分类
    if (forPublish && !selectedCategory) {
      setSaveMessage({ type: 'error', text: '发布文章请先选择分类' });
      // 打开设置面板并显示分类下拉菜单
      setShowSettings(true);
      setShowCategoryDropdown(true);
      return false;
    }
    return true;
  };

  // 创建新分类
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
      logger.error('Create category error:', error);
      setSaveMessage({ type: 'error', text: '创建分类失败' });
    } finally {
      setCreatingCategory(false);
    }
  };

  // 保存为草稿
  const handleSave = async () => {
    if (!validatePost()) return;
    
    setIsSaving(true);
    setSaveMessage(null);
    
    try {
      // 如果正在编辑已发布的文章，"保存" 仅更新草稿缓存
      // 未发布 (草稿) 文章直接更新数据库
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
        // 正常保存到数据库
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
          // 如果是新文章，导航到编辑页面
          if (!isEditMode && res.data.id) {
            setTimeout(() => navigate(`/posts/edit/${res.data.id}`), 1000);
          }
        } else {
          setSaveMessage({ type: 'error', text: res.message || '保存失败' });
        }
      }
    } catch (error) {
      logger.error('Save error:', error);
      setSaveMessage({ type: 'error', text: '保存失败，请重试' });
    } finally {
      setIsSaving(false);
    }
  };

  // 发布文章
  const handlePublish = async () => {
    if (!validatePost(true)) return; // true = 用于发布，需要分类
    
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
      logger.error('Publish error:', error);
      setSaveMessage({ type: 'error', text: '发布失败，请重试' });
    } finally {
      setIsPublishing(false);
    }
  };

  // 3 秒后清除消息
  useEffect(() => {
    if (saveMessage) {
      const timer = setTimeout(() => setSaveMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveMessage]);

  const handleTagKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && tagSearch.trim()) {
      e.preventDefault();
      // 检查标签是否已存在
      const existing = tags.find(t => t.name.toLowerCase() === tagSearch.toLowerCase());
      if (existing) {
        if (!selectedTags.find(s => s.id === existing.id)) {
          setSelectedTags([...selectedTags, existing]);
        }
      } else {
        // 创建新标签
        try {
          const res = await tagService.create({ name: tagSearch.trim() });
          if (res.data) {
            setTags([...tags, res.data]);
            setSelectedTags([...selectedTags, res.data]);
          }
        } catch (error) {
          logger.error('Failed to create tag:', error);

      }
      }
      setTagSearch('');
      setShowTagDropdown(false);
    }
  };

  const removeTag = (tagId: number) => {
    setSelectedTags(selectedTags.filter(t => t.id !== tagId));
  };



  // 加载骨架屏 - 感知主题
  if (_loadingPost || loadingCategories || loadingTags) {
    return (
      <div className="flex flex-col absolute inset-0 h-full bg-[var(--bg-primary)] z-50 overflow-hidden">
        {/* 头部骨架 */}
        <div className="h-14 flex-shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-card)] flex items-center justify-between px-6 gap-4">
           {/* 左侧 */}
           <div className="flex items-center gap-3 flex-1">
             <div className="w-8 h-8 rounded-lg bg-[var(--shimmer-bg)] animate-pulse flex-shrink-0" /> {/* 返回 */}
             <div className="h-8 rounded-lg bg-[var(--shimmer-bg)] animate-pulse flex-1 max-w-md" />   {/* 标题 */}
             <div className="w-px h-6 bg-[var(--border-subtle)] flex-shrink-0 mx-1" />
             <div className="flex gap-2">
                <div className="w-24 h-7 rounded bg-[var(--shimmer-bg)] animate-pulse" />
                <div className="w-16 h-7 rounded bg-[var(--shimmer-bg)] animate-pulse" />
             </div>
           </div>
           
           {/* 右侧 */}
           <div className="flex items-center gap-2">
              <div className="w-20 h-8 rounded-lg bg-[var(--shimmer-bg)] animate-pulse" /> {/* AI */}
              <div className="w-8 h-8 rounded-lg bg-[var(--shimmer-bg)] animate-pulse" />  {/* 设置 */}
              <div className="w-[90px] h-8 rounded-lg bg-[var(--shimmer-bg)] animate-pulse" /> {/* 保存 */}
              <div className="w-[90px] h-8 rounded-lg bg-primary/20 animate-pulse" /> {/* 发布 */}
           </div>
        </div>

        {/* 工具栏骨架 */}
        <div className="flex-shrink-0 h-10 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/80 flex items-center px-4 gap-4 overflow-hidden">
             <div className="flex items-center gap-1 pr-3 border-r border-[var(--border-subtle)]">
                <div className="w-6 h-6 rounded bg-[var(--shimmer-bg)] animate-pulse" />
                <div className="w-6 h-6 rounded bg-[var(--shimmer-bg)] animate-pulse" />
                <div className="w-6 h-6 rounded bg-[var(--shimmer-bg)] animate-pulse" />
             </div>
             <div className="flex items-center gap-1 px-3">
                <div className="w-6 h-6 rounded bg-[var(--shimmer-bg)] animate-pulse" />
                <div className="w-6 h-6 rounded bg-[var(--shimmer-bg)] animate-pulse" />
                <div className="w-6 h-6 rounded bg-[var(--shimmer-bg)] animate-pulse" />
             </div>
             <div className="flex-1" />
        </div>

        {/* 内容区域 */}
        <div className="flex-1 flex overflow-hidden">
             {/* 编辑器 */}
             <div className="flex-1 p-8 space-y-6 bg-[var(--bg-primary)]">
                <div className="w-3/4 h-10 rounded-lg bg-[var(--shimmer-bg)] animate-pulse" /> {/* H1 标题样式 */}
                <div className="space-y-4">
                    <div className="w-full h-4 rounded bg-[var(--shimmer-bg)] animate-pulse" />
                    <div className="w-11/12 h-4 rounded bg-[var(--shimmer-bg)] animate-pulse" />
                    <div className="w-full h-4 rounded bg-[var(--shimmer-bg)] animate-pulse" />
                    <div className="w-4/5 h-4 rounded bg-[var(--shimmer-bg)] animate-pulse" />
                </div>
                <div className="space-y-4 pt-4">
                    <div className="w-full h-4 rounded bg-[var(--shimmer-bg)] animate-pulse" />
                    <div className="w-10/12 h-4 rounded bg-[var(--shimmer-bg)] animate-pulse" />
                </div>
             </div>
             
             {/* 预览 */}
             <div className="flex-1 border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-8 space-y-6 hidden lg:block">
                <div className="w-2/3 h-10 rounded-lg bg-[var(--shimmer-bg)] animate-pulse" />
                <div className="space-y-4">
                    <div className="w-full h-4 rounded bg-[var(--shimmer-bg)] animate-pulse" />
                    <div className="w-10/12 h-4 rounded bg-[var(--shimmer-bg)] animate-pulse" />
                    <div className="w-full h-4 rounded bg-[var(--shimmer-bg)] animate-pulse" />
                </div>
                <div className="w-full h-48 rounded-lg bg-[var(--shimmer-bg)] animate-pulse" />
             </div>
        </div>
        
        {/* 页脚 (状态栏) */}
        <div className="h-8 flex-shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-card)] flex items-center justify-between px-4">
             <div className="w-24 h-3 rounded bg-[var(--shimmer-bg)] animate-pulse" />
             <div className="w-16 h-3 rounded bg-[var(--shimmer-bg)] animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "flex flex-col absolute inset-0 h-full bg-[var(--bg-primary)] z-10 transition-all duration-300 overflow-hidden"
    )}>
      {/* 顶部头部区域 - 带折叠动画 */}
      <AnimatePresence initial={false}>
        {!isFullscreen && (
          <motion.div 
            key="editor-header"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="border-b border-[var(--border-subtle)] bg-[var(--bg-card)] z-20"
          >
            <div className="flex items-center justify-between px-6 py-3.5 gap-4">
              {/* 左侧块：返回 + 标题 + 元数据 */}
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <button 
                  onClick={() => navigate('/posts')}
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors flex-shrink-0"
                  title="返回列表"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                
                {/* 标题输入 */}
                <motion.div className="flex-1 min-w-[150px]">
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="请输入文章标题..."
                    className="w-full bg-transparent text-xl font-bold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none min-w-0"
                  />
                </motion.div>

                {/* 分隔线 */}
                <div className="w-px h-6 bg-[var(--border-subtle)] flex-shrink-0" />

                {/* 元数据：分类和标签 */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  {/* 分类选择器 */}
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
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-[var(--bg-card-hover)] transition-colors text-sm"
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
                          className="absolute top-full left-0 mt-2 w-60 z-50 bg-[var(--bg-popover)] border border-[var(--border-subtle)] rounded-lg shadow-xl overflow-hidden"
                        >
                          <div className="p-2 border-b border-[var(--border-subtle)]">
                            <input
                              type="text"
                              value={categorySearch}
                              onChange={(e) => setCategorySearch(e.target.value)}
                              placeholder="搜索分类..."
                              autoFocus
                              className="w-full px-2 py-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded text-xs text-[var(--text-primary)] focus:outline-none focus:border-primary/50"
                            />
                          </div>
                          <div className="max-h-48 overflow-auto py-1">
                            {filteredCategories.map((cat) => (
                              <button
                                key={cat.id}
                                onClick={() => { setSelectedCategory(cat); setShowCategoryDropdown(false); }}
                                className={cn(
                                  'w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--bg-card-hover)]',
                                  selectedCategory?.id === cat.id ? 'text-primary' : 'text-gray-300'
                                )}
                              >
                                {cat.name}
                              </button>
                            ))}
                            <button
                              onClick={() => { setShowCategoryDropdown(false); setShowCreateCategoryModal(true); }}
                              className="w-full px-3 py-1.5 text-left text-xs text-primary hover:bg-[var(--bg-card-hover)] flex items-center gap-2 border-t border-[var(--border-subtle)] mt-1 pt-2"
                            >
                              <Plus className="w-3 h-3" /> 新建分类
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* 标签选择器 */}
                  <div ref={tagDropdownRef} className="relative flex items-center gap-1.5">
                     {/* 稳定标签 - 如果存在，前 2 个始终渲染 */}
                       {selectedTags.slice(0, 2).map((tag) => (
                        <motion.span
                          key={tag.id}
                          className="flex items-center gap-1 px-1.5 py-0.5 bg-primary/10 text-primary rounded text-xs border border-primary/20 whitespace-nowrap overflow-hidden z-10"
                        >
                          <span className="flex-shrink-0">{tag.name}</span>
                          <button onClick={() => removeTag(tag.id)} className="w-4 h-4 flex items-center justify-center hover:text-white flex-shrink-0 rounded-full hover:bg-primary/20 transition-colors"><X className="w-3 h-3" /></button>
                        </motion.span>
                      ))}

                     {/* 隐藏标签浮动面板 */}
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
                           className="flex items-center justify-center gap-0.5 w-14 py-0.5 bg-[var(--bg-secondary)] text-[var(--text-muted)] rounded text-xs border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] transition-colors z-10"
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
                              className="absolute top-full right-0 mt-2 p-2 bg-[var(--bg-popover)] border border-[var(--border-subtle)] rounded-lg shadow-xl z-50 grid grid-cols-3 gap-2 w-[340px] origin-top-right"
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
                        "p-1 rounded hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-primary transition-colors",
                         showTagDropdown && "bg-[var(--bg-secondary)] text-primary"
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
                          className="absolute top-full right-0 mt-2 w-64 z-50 bg-[var(--bg-popover)] border border-[var(--border-subtle)] rounded-lg shadow-xl overflow-hidden"
                        >
                          <div className="p-2 border-b border-[var(--border-subtle)]">
                            <input
                              type="text"
                              value={tagSearch}
                              onChange={(e) => setTagSearch(e.target.value)}
                              onKeyDown={handleTagKeyDown}
                              placeholder="搜索或新建标签..."
                              autoFocus
                              className="w-full px-2 py-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded text-xs text-[var(--text-primary)] focus:outline-none focus:border-primary/50"
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
                                    'w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--bg-card-hover)] flex justify-between items-center',
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
              
              {/* 右侧按钮 */}
              <div className="flex items-center gap-2 flex-shrink-0 relative z-30 bg-[var(--bg-card)]">
                
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setShowToc(false);
                    setShowAI(prev => !prev);
                  }}
                  className={cn(
                    'flex h-8 items-center gap-1.5 px-3 rounded-lg transition-colors text-sm',
                    showAI ? 'bg-primary text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
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
                    showSettings ? 'bg-primary text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
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
                    isSaving ? 'bg-primary/50 text-white cursor-wait' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
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
                
                {/* 保存消息提示 */}
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
      <div className="relative border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/80 backdrop-blur-sm">
        <div className="flex items-center gap-1 px-4 py-1.5 overflow-x-auto">
        {/* Undo/Redo */}
        <div className="flex items-center gap-0.5 pr-3 border-r border-[var(--border-subtle)]">
          <ToolbarButton onClick={() => editorCommands.undo()} tooltip="撤销 (⌘Z)">
            <Undo2 className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editorCommands.redo()} tooltip="重做 (⇧⌘Z)">
            <Redo2 className="w-4 h-4" />
          </ToolbarButton>
        </div>
        {/* Headings */}
        <div className="flex items-center gap-0.5 pr-3 border-r border-[var(--border-subtle)]">
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
        <div className="flex items-center gap-0.5 px-3 border-r border-[var(--border-subtle)]">
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
        <div className="flex items-center gap-0.5 px-3 border-r border-[var(--border-subtle)]">
          <ToolbarButton onClick={() => insertMarkdown('`', '`')} tooltip="行内代码 (⌘`)">
            <Code className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => insertMarkdown('```\n', '\n```')} tooltip="代码块 (⇧⌘K)">
            <FileCode2 className="w-4 h-4" />
          </ToolbarButton>
        </div>
        
        {/* Lists */}
        <div className="flex items-center gap-0.5 px-3 border-r border-[var(--border-subtle)]">
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
        <div className="flex items-center gap-0.5 px-3 border-r border-[var(--border-subtle)]">
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
        <div className="flex items-center gap-0.5 px-3 border-l border-[var(--border-subtle)]">
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
              "hover:bg-[var(--bg-card-hover)]",
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
            onClick={() => {
              setShowAI(false);
              setShowToc(!showToc);
            }} 
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
            <div className="relative">
              <HardDrive className={cn(
                "w-4 h-4 transition-all duration-300",
                autoSaveFlash && "scale-110"
              )} />
              {/* 自动保存成功时的微妙光晕 */}
              {autoSaveFlash && (
                <motion.div
                  initial={{ opacity: 0.8, scale: 0.8 }}
                  animate={{ opacity: 0, scale: 2 }}
                  transition={{ duration: 1.2, ease: "easeOut" }}
                  className="absolute inset-0 rounded-full bg-emerald-400/40"
                />
              )}
              {/* 保存成功时的小勾号 */}
              <AnimatePresence>
                {autoSaveFlash && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.5, y: 2 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.3 }}
                    className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full flex items-center justify-center"
                  >
                    <CheckCircle className="w-2 h-2 text-white" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
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
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onPaste={handlePaste}
              isDragging={isDragging}
              theme={resolvedTheme}
            />

            <SelectionAiToolbar
              editorViewRef={editorViewRef}
              selectedModelId={aiModelId}
              selectedProviderCode={aiProviderCode}
            />
            <SlashCommandMenu editorViewRef={editorViewRef} onRunAiAction={openAiPanel} />

            {/* Upload Progress Overlay */}
            {uploads.length > 0 && (
              <UploadProgress
                uploads={uploads}
                onRemove={removeUpload}
                onRetry={retryUpload}
                onClearCompleted={clearCompleted}
              />
            )}
            
            {/* IDEA-style Table Trigger Zones - Fixed positioning with viewport coordinates */}
            {tableInfo?.isInTable && tableInfo.tableBounds && tableInfo.rowPositions && editorContainerRef.current && (() => {
              const containerRect = editorContainerRef.current.getBoundingClientRect();
              const isInViewport = tableInfo.tableBounds.top >= containerRect.top - 100 &&
                                   tableInfo.tableBounds.top <= containerRect.bottom + 100;
              if (!isInViewport) return null;
              
              // 计算准确的行高
              const lineHeight = tableInfo.rowPositions.length > 1
                ? tableInfo.rowPositions[1] - tableInfo.rowPositions[0]
                : 24;

              // 生成扩展的行位置以包含最后一行的底部
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
                             left: x - tableInfo.tableBounds!.left - 3, // 居中 6px 圆点：偏移 -3px
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
                        // 准确从行顶部开始（间隙位置）
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
                            top: y - tableInfo.tableBounds!.top - 3, // 在行间隙处居中 6px 圆点：偏移 -3px
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
                    // 定位于上方并略微向右
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

        {/* AI Side Panel */}
        <AnimatePresence mode="wait">
          {showAI && (
            <AiSidePanel
              ref={aiPanelRef}
              content={content}
              title={title}
              summary={summary}
              selectedModelId={aiModelId}
              selectedProviderCode={aiProviderCode}
              onModelChange={handleModelChange}
              onClose={() => setShowAI(false)}
              onInsertText={insertAiText}
              onReplaceContent={replaceAiContent}
              onUpdateSummary={setSummary}
              onUpdateTitle={setTitle}
              onApplyTags={applyAiTags}
            />
          )}
        </AnimatePresence>

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
              className="h-full border-l border-[var(--border-subtle)] bg-[var(--bg-card)]/95 backdrop-blur-2xl overflow-hidden flex flex-col z-30 shadow-xl relative"
            >
              {/* Cinematic Edge Highlight */}
              <div className="absolute inset-y-0 left-0 w-[1px] bg-gradient-to-b from-transparent via-primary/30 to-transparent" />

              {/* TOC Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(139,92,246,0.6)]" />
                  <span className="text-sm font-semibold text-[var(--text-primary)] tracking-wide uppercase">目录索引</span>
                </div>
                <button
                  onClick={() => setShowToc(false)}
                  className="p-1.5 rounded-full hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all duration-300"
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
                    <div className="inline-flex p-3 rounded-full bg-[var(--bg-secondary)] mb-3">
                      <ListTree className="w-5 h-5 text-[var(--text-muted)]" />
                    </div>
                    <p className="text-sm font-medium text-[var(--text-secondary)]">空空如也</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)] px-4">
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
                          'hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        )}
                        style={{ paddingLeft: `${(item.level - 1) * 14 + 12}px` }}
                        title={item.text}
                      >
                        {/* Elegant Hover Indicator */}
                        <div className="absolute left-1 w-0.5 h-0 bg-primary group-hover:h-3/5 transition-all duration-400 ease-out-expo rounded-full opacity-0 group-hover:opacity-100 shadow-[0_0_8px_#8b5cf6]" />
                        
                        <span className={cn(
                          "truncate transition-all duration-500",
                          item.level === 1 ? "font-bold text-[var(--text-primary)] tracking-tight" : 
                          item.level === 2 ? "font-semibold text-[var(--text-secondary)]" : 
                          "font-normal text-[var(--text-muted)]"
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

      {/* 编辑器页脚 */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-[var(--border-subtle)] bg-[var(--bg-card)] text-[12px] text-[var(--text-muted)]">
        <div className="flex items-center gap-4">
          <span>字数: <span className="text-[var(--text-primary)] font-medium">{stats.words.toLocaleString()}</span></span>
          <span>行数: <span className="text-[var(--text-primary)] font-medium">{stats.lines.toLocaleString()}</span></span>
        </div>
        
        <div className="flex items-center gap-4">
          {viewMode !== 'preview' && (
            <label className="flex items-center gap-2 cursor-pointer group">
              <input 
                type="checkbox" 
                checked={showLineNumbers} 
                onChange={(e) => setShowLineNumbers(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-[var(--border-subtle)] bg-[var(--bg-card)] text-primary focus:ring-0 focus:ring-offset-0 transition-all cursor-pointer"
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
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] transition-all ml-2"
          >
            <ArrowUp className="w-3.5 h-3.5" />
            回到顶部
          </button>
        </div>
      </div>

      {/* 设置面板（替代模态框） */}
      <AnimatePresence>
        {showSettings && (
          <>
            {/* 背景遮罩 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
            />
            
            {/* 侧滑面板 */}
            <motion.div
              initial={{ x: '100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="absolute right-0 top-0 bottom-0 w-[400px] z-50 bg-[var(--bg-primary)] border-l border-[var(--border-default)] shadow-2xl flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-secondary)]">
                <div className="flex items-center gap-2">
                  <Settings className="w-5 h-5 text-primary" />
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">文章设置</h2>
                </div>
                <button
                  onClick={() => setShowSettings(false)}
                  className="p-2 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content - Scrollable */}
              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {/* Cover Image */}
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-[var(--text-secondary)]">封面图片</label>
                  <div className="border-2 border-dashed border-[var(--border-default)] rounded-xl p-8 text-center hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer group">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--bg-input)] flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <Image className="w-6 h-6 text-[var(--text-muted)] group-hover:text-primary transition-colors" />
                    </div>
                    <p className="text-[var(--text-secondary)] font-medium text-sm">点击或拖拽上传</p>
                    <p className="text-[var(--text-muted)] text-xs mt-1">支持 JPG, PNG, WebP (Max 5MB)</p>
                  </div>
                </div>

                {/* Publish Time */}
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
                    <Clock className="w-4 h-4 text-primary" />
                    发布时间
                  </label>
                  <input
                    type="datetime-local"
                    value={publishTime}
                    onChange={(e) => setPublishTime(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-default)] text-[var(--text-primary)] focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                    style={{ colorScheme: resolvedTheme }}
                  />
                  <p className="text-xs text-[var(--text-muted)]">预设发布时间，即刻发布请留空</p>
                </div>

                {/* Summary */}
                <div className="space-y-3">
                   <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-[var(--text-secondary)]">文章摘要</label>
                    <button 
                      onClick={() => openAiPanel('summary')}
                      className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
                    >
                      <Sparkles className="w-3 h-3" />
                      AI 生成
                    </button>
                   </div>
                  <textarea
                    rows={4}
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="输入文章摘要，或让 AI 为你生成..."
                    className="w-full px-4 py-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm leading-relaxed"
                  />
                </div>
                
                {/* Advanced Settings Divider */}
                <div className="pt-4 border-t border-[var(--border-subtle)]">
                   <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">高级设置</h3>
                   {/* SEO Settings could go here */}
                   <div className="opacity-50 pointer-events-none filter blur-[1px]">
                      <div className="space-y-3">
                        <label className="block text-sm font-medium text-[var(--text-secondary)]">SEO 标题 (即将上线)</label>
                        <input type="text" disabled className="w-full px-4 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-default)] text-[var(--text-muted)]" placeholder="默认使用文章标题" />
                      </div>
                   </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-6 border-t border-[var(--border-default)] bg-[var(--bg-secondary)]">
                 <button
                  onClick={() => setShowSettings(false)}
                  className="w-full py-3 text-sm font-semibold text-white bg-gradient-to-r from-primary to-primary/90 rounded-xl hover:from-primary/90 hover:to-primary/80 transition-all shadow-lg shadow-primary/25 active:scale-[0.98]"
                 >
                   完成设置
                 </button>
              </div>
            </motion.div>
          </>
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
                  className="w-full px-4 py-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-primary/50 mb-4"
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
