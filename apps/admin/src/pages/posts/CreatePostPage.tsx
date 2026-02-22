import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Save, Settings, Sparkles, ArrowLeft, Send,
  Bold, Italic, Strikethrough, Code, List, ListOrdered,
  Link2, Image, Quote, Heading1, Heading2, Heading3,
  X, ChevronDown, Plus, Search, Loader2, CheckCircle, AlertCircle,
  Table2, Minus, CheckSquare, Sigma, GitBranch, Underline, FileCode2, ArrowUp,
  Maximize2, Minimize2, Eye, ListTree, ZoomIn, ZoomOut, Clock, HardDrive,
  Undo2, Redo2, Hash
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { EditorWithPreview, EditorView, useEditorCommands, useTableCommands, useImageUpload, UploadProgress, type ViewMode, type TableInfo, type UploadResult } from '@aetherblog/editor';
import { cn } from '@/lib/utils';
import { Tooltip } from '@aetherblog/ui';
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
import { useEditorStore } from '@/stores/editorStore';
import { useTheme } from '@aetherblog/hooks';
import { useMediaQuery } from '@/hooks';
import { logger } from '@/lib/logger';

const TAG_COLORS = [
  { bg: 'bg-blue-400/10 dark:bg-blue-500/20', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/20', hoverBorder: 'hover:border-blue-500/40', bgHover: 'hover:bg-blue-400/20 dark:hover:bg-blue-500/30', activeBg: 'bg-blue-500 text-white border-blue-500 shadow-blue-500/30' },
  { bg: 'bg-emerald-400/10 dark:bg-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/20', hoverBorder: 'hover:border-emerald-500/40', bgHover: 'hover:bg-emerald-400/20 dark:hover:bg-emerald-500/30', activeBg: 'bg-emerald-500 text-white border-emerald-500 shadow-emerald-500/30' },
  { bg: 'bg-violet-400/10 dark:bg-violet-500/20', text: 'text-violet-600 dark:text-violet-400', border: 'border-violet-500/20', hoverBorder: 'hover:border-violet-500/40', bgHover: 'hover:bg-violet-400/20 dark:hover:bg-violet-500/30', activeBg: 'bg-violet-500 text-white border-violet-500 shadow-violet-500/30' },
  { bg: 'bg-pink-400/10 dark:bg-pink-500/20', text: 'text-pink-600 dark:text-pink-400', border: 'border-pink-500/20', hoverBorder: 'hover:border-pink-500/40', bgHover: 'hover:bg-pink-400/20 dark:hover:bg-pink-500/30', activeBg: 'bg-pink-500 text-white border-pink-500 shadow-pink-500/30' },
  { bg: 'bg-amber-400/10 dark:bg-amber-500/20', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/20', hoverBorder: 'hover:border-amber-500/40', bgHover: 'hover:bg-amber-400/20 dark:hover:bg-amber-500/30', activeBg: 'bg-amber-500 text-white border-amber-500 shadow-amber-500/30' },
  { bg: 'bg-indigo-400/10 dark:bg-indigo-500/20', text: 'text-indigo-600 dark:text-indigo-400', border: 'border-indigo-500/20', hoverBorder: 'hover:border-indigo-500/40', bgHover: 'hover:bg-indigo-400/20 dark:hover:bg-indigo-500/30', activeBg: 'bg-indigo-500 text-white border-indigo-500 shadow-indigo-500/30' },
  { bg: 'bg-rose-400/10 dark:bg-rose-500/20', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/20', hoverBorder: 'hover:border-rose-500/40', bgHover: 'hover:bg-rose-400/20 dark:hover:bg-rose-500/30', activeBg: 'bg-rose-500 text-white border-rose-500 shadow-rose-500/30' },
  { bg: 'bg-cyan-400/10 dark:bg-cyan-500/20', text: 'text-cyan-600 dark:text-cyan-400', border: 'border-cyan-500/20', hoverBorder: 'hover:border-cyan-500/40', bgHover: 'hover:bg-cyan-400/20 dark:hover:bg-cyan-500/30', activeBg: 'bg-cyan-500 text-white border-cyan-500 shadow-cyan-500/30' }
];

const getTagColor = (name: string) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
};

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
  return (
    <Tooltip content={tooltip} side={tooltipPosition} delay={0}>
      <button
        onClick={onClick}
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
      </button>
    </Tooltip>
  );
}

type SaveStatusType = 'saving' | 'saved' | 'error' | 'disabled';
type SaveStatusSource = 'auto' | 'manual' | 'publish' | 'system';
type MobilePanel = 'none' | 'ai' | 'toc' | 'meta' | 'settings';

interface SaveStatusState {
  type: SaveStatusType;
  source: SaveStatusSource;
  label: string;
  detail?: string;
  updatedAt: number | null;
}

function buildDraftFingerprint(params: {
  title: string;
  content: string;
  summary: string;
  categoryId?: number;
  tagIds: number[];
}): string {
  return JSON.stringify({
    title: params.title.trim(),
    content: params.content,
    summary: params.summary.trim(),
    categoryId: params.categoryId ?? null,
    tagIds: [...params.tagIds].sort((first, second) => first - second),
  });
}

function formatRelativeTime(timestamp: number | null, now: number, emptyText: string): string {
  if (!timestamp) {
    return emptyText;
  }

  const diffMs = Math.max(0, now - timestamp);
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 10) {
    return '刚刚';
  }
  if (diffSeconds < 60) {
    return `${diffSeconds} 秒前`;
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} 天前`;
}


function formatAbsoluteTime(timestamp: number | null, emptyText: string): string {
  if (!timestamp) {
    return emptyText;
  }

  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function CreatePostPage() {
  const navigate = useNavigate();
  // 使用 resolvedTheme 确保总是向编辑器传递 'light' 或 'dark'，处理 'system' 偏好
  const { resolvedTheme } = useTheme();

  const enableSelectionAi = useEditorStore((state) => state.enableSelectionAi);
  const enableSlashAi = useEditorStore((state) => state.enableSlashAi);

  const isMobile = useMediaQuery('(max-width: 768px)');
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
  const [activeTocLine, setActiveTocLine] = useState<number | null>(null);
  // 字号控制 - 分离编辑器和预览字号
  const [editorFontSize, setEditorFontSize] = useState(14);
  const [previewFontSize, setPreviewFontSize] = useState(16);
  const [zoomTarget, setZoomTarget] = useState<'editor' | 'preview' | 'both'>('both');
  const [showLineNumbers, setShowLineNumbers] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('none');
  const [summary, setSummary] = useState('');
  const [_loadingPost, setLoadingPost] = useState(isEditMode);
  const [_postStatus, setPostStatus] = useState<'DRAFT' | 'PUBLISHED'>('DRAFT');
  const [isAutoSaveEnabled, setIsAutoSaveEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('aether_autosave_enabled');
      return saved !== 'false';
    }
    return true;
  });

  useEffect(() => {
    localStorage.setItem('aether_autosave_enabled', String(isAutoSaveEnabled));
  }, [isAutoSaveEnabled]);
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
  const [_showAllTags, setShowAllTags] = useState(false);
  const [aiModelId, setAiModelId] = useState<string | undefined>(undefined);
  const [aiProviderCode, setAiProviderCode] = useState<string | undefined>(undefined);
  const prefersReducedMotion = useReducedMotion();
  const [saveStatus, setSaveStatus] = useState<SaveStatusState>({
    type: 'saved',
    source: 'system',
    label: '编辑就绪',
    detail: '开始编辑后将自动保存',
    updatedAt: null,
  });
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<number | null>(null);
  const [lastSavedFingerprint, setLastSavedFingerprint] = useState<string | null>(null);
  const [saveStatusTick, setSaveStatusTick] = useState(Date.now());

  const currentFingerprint = useMemo(() => buildDraftFingerprint({
    title,
    content,
    summary,
    categoryId: selectedCategory?.id,
    tagIds: selectedTags.map((tag) => tag.id),
  }), [title, content, summary, selectedCategory?.id, selectedTags]);

  const hasDraftContent = useMemo(() => {
    return Boolean(title.trim() || content.trim() || summary.trim());
  }, [title, content, summary]);

  const hasUnsavedChanges = useMemo(() => {
    if (!hasDraftContent) {
      return false;
    }

    if (!lastSavedFingerprint) {
      return true;
    }

    return currentFingerprint !== lastSavedFingerprint;
  }, [currentFingerprint, hasDraftContent, lastSavedFingerprint]);

  const updateSaveStatus = useCallback((
    next: Omit<SaveStatusState, 'updatedAt'>,
    options?: { markSuccess?: boolean; fingerprint?: string; autoSaved?: boolean }
  ) => {
    const now = Date.now();
    setSaveStatus({ ...next, updatedAt: now });
    if (options?.markSuccess) {
      if (options.autoSaved) {
        setLastAutoSavedAt(now);
      } else {
        setLastSavedAt(now);
      }
      if (options.fingerprint) {
        setLastSavedFingerprint(options.fingerprint);
      }
    }
  }, []);

  const relativeSavedText = useMemo(() => {
    return formatRelativeTime(lastSavedAt, saveStatusTick, '尚未手动保存');
  }, [lastSavedAt, saveStatusTick]);

  const relativeAutoSavedText = useMemo(() => {
    return formatRelativeTime(lastAutoSavedAt, saveStatusTick, '尚无自动保存记录');
  }, [lastAutoSavedAt, saveStatusTick]);

  const absoluteSavedText = useMemo(() => {
    return formatAbsoluteTime(lastSavedAt, '尚未手动保存');
  }, [lastSavedAt]);

  const absoluteAutoSavedText = useMemo(() => {
    return formatAbsoluteTime(lastAutoSavedAt, '尚无自动保存记录');
  }, [lastAutoSavedAt]);

  const saveTimelineText = useMemo(() => {
    const latestAutoSaved = lastAutoSavedAt
      ? `最新自动保存：${absoluteAutoSavedText}（${relativeAutoSavedText}）`
      : `最新自动保存：${absoluteAutoSavedText}`;
    const latestSaved = lastSavedAt
      ? `最近保存：${absoluteSavedText}（${relativeSavedText}）`
      : `最近保存：${absoluteSavedText}`;

    return `${latestAutoSaved} · ${latestSaved}`;
  }, [
    absoluteAutoSavedText,
    absoluteSavedText,
    lastAutoSavedAt,
    lastSavedAt,
    relativeAutoSavedText,
    relativeSavedText,
  ]);

  const saveStatusDisplay = useMemo(() => {
    if (saveStatus.type === 'error') {
      return {
        label: saveStatus.label || '保存失败',
        detail: saveStatus.detail || '请检查网络或稍后重试',
        toneClass: 'text-red-600 dark:text-red-300',
        dotClass: 'bg-red-500 dark:bg-red-400',
        icon: <AlertCircle className="w-3.5 h-3.5" />,
        showRetry: true,
      };
    }

    if (saveStatus.type === 'saving' || isSaving || isPublishing) {
      return {
        label: saveStatus.label || '保存中',
        detail: saveStatus.detail || '正在同步草稿内容',
        toneClass: 'text-sky-600 dark:text-sky-300',
        dotClass: 'bg-sky-500 dark:bg-sky-400',
        icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
        showRetry: false,
      };
    }

    if (hasUnsavedChanges) {
      return {
        label: '有改动待保存',
        detail: saveTimelineText,
        toneClass: 'text-amber-600 dark:text-amber-300',
        dotClass: 'bg-amber-500 dark:bg-amber-400',
        icon: <Clock className="w-3.5 h-3.5" />,
        showRetry: false,
      };
    }

    if (saveStatus.type === 'disabled') {
      return {
        label: '自动保存已关闭',
        detail: saveTimelineText,
        toneClass: 'text-slate-600 dark:text-slate-300',
        dotClass: 'bg-slate-500 dark:bg-slate-400',
        icon: <HardDrive className="w-3.5 h-3.5" />,
        showRetry: false,
      };
    }

    return {
      label: '内容已同步',
      detail: saveTimelineText,
      toneClass: 'text-emerald-600 dark:text-emerald-300',
      dotClass: 'bg-emerald-500 dark:bg-emerald-400',
      icon: <CheckCircle className="w-3.5 h-3.5" />,
      showRetry: false,
    };
  }, [
    hasUnsavedChanges,
    isPublishing,
    isSaving,
    saveStatus.detail,
    saveStatus.label,
    saveStatus.type,
    saveTimelineText,
  ]);

  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const expandedTagsRef = useRef<HTMLDivElement>(null);

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const aiPanelRef = useRef<AiSidePanelHandle | null>(null);
  const [pendingAiAction, setPendingAiAction] = useState<AiPanelAction | null>(null);
  const closeMobilePanel = useCallback(() => {
    setMobilePanel('none');
  }, []);
  const openMobilePanel = useCallback((panel: Exclude<MobilePanel, 'none'>) => {
    setShowCategoryDropdown(false);
    setShowTagDropdown(false);
    setShowAllTags(false);
    setShowAI(false);
    setShowToc(false);
    setShowSettings(false);
    setMobilePanel((prev) => (prev === panel ? 'none' : panel));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setSaveStatusTick(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (isMobile) {
      setShowAI(false);
      setShowToc(false);
      setShowSettings(false);
      setShowCategoryDropdown(false);
      setShowTagDropdown(false);
      return;
    }
    setMobilePanel('none');
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile || mobilePanel === 'none') {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobile, mobilePanel]);

  useEffect(() => {
    if (!isAutoSaveEnabled) {
      updateSaveStatus({
        type: 'disabled',
        source: 'auto',
        label: '自动保存已关闭',
        detail: `最近自动保存 ${relativeAutoSavedText}`,
      });
      return;
    }

    if (saveStatus.type === 'disabled') {
      updateSaveStatus({
        type: 'saved',
        source: 'auto',
        label: '自动保存已恢复',
        detail: `最近自动保存 ${relativeAutoSavedText}`,
      });
    }
  }, [isAutoSaveEnabled, relativeAutoSavedText, saveStatus.type, updateSaveStatus]);

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

      const savedFingerprint = buildDraftFingerprint({
        title: data.title,
        content: data.content,
        summary: data.summary ?? '',
        categoryId: data.selectedCategory?.id,
        tagIds: data.selectedTags.map((tag) => tag.id),
      });

      updateSaveStatus({
        type: 'saving',
        source: 'auto',
        label: '自动保存中',
        detail: '正在同步草稿缓存',
      });

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
        updateSaveStatus({
          type: 'saved',
          source: 'auto',
          label: '自动保存成功',
          detail: '草稿已同步',
        }, {
          markSuccess: true,
          fingerprint: savedFingerprint,
          autoSaved: true,
        });
      }).catch(err => {
        logger.error('Auto save failed', err);
        updateSaveStatus({
          type: 'error',
          source: 'auto',
          label: '自动保存失败',
          detail: '请检查网络或点击刷新重试',
        });
      });
    }, 30000);

    return () => clearInterval(timer);
  }, [isEditMode, postId, _postStatus, isAutoSaveEnabled, updateSaveStatus]);

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

  const refreshMetaData = useCallback(async () => {
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
  }, []);

  // 挂载时获取分类、标签和服务器时间
  useEffect(() => {
    refreshMetaData();
  }, [refreshMetaData]);

  // 按 Esc 退出全屏
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        return;
      }
      if (isMobile && mobilePanel !== 'none') {
        closeMobilePanel();
        return;
      }
      if (isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [closeMobilePanel, isFullscreen, isMobile, mobilePanel]);

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
            const loadedTitle = useDraft ? draft.title : post.title;
            const loadedContent = useDraft ? draft.content : post.content;
            const loadedSummary = (useDraft ? draft.summary : post.summary) || '';
            const loadedCategory = post.category ? (post.category as Category) : null;
            const loadedTags = post.tags && post.tags.length > 0 ? (post.tags as Tag[]) : [];
            const loadedFingerprint = buildDraftFingerprint({
              title: loadedTitle,
              content: loadedContent,
              summary: loadedSummary,
              categoryId: loadedCategory?.id,
              tagIds: loadedTags.map((tag) => tag.id),
            });

            setTitle(loadedTitle);
            setContent(loadedContent);
            setSummary(loadedSummary);
            setPostStatus(post.status as 'DRAFT' | 'PUBLISHED');
            setSelectedCategory(loadedCategory);
            setSelectedTags(loadedTags);
            updateSaveStatus({
              type: 'saved',
              source: useDraft ? 'auto' : 'system',
              label: useDraft ? '草稿已恢复' : '内容已同步',
              detail: useDraft ? '已载入草稿版本，继续编辑将自动保存' : '当前内容与已保存版本一致',
            }, {
              markSuccess: true,
              fingerprint: loadedFingerprint,
            });

            if (useDraft) {
              toast.success('已自动恢复未发布的草稿内容', { id: 'draft-restore' });
            }
          }
        } catch (error) {
          logger.error('Failed to load post:', error);
          toast.error('加载文章失败');
        } finally {
          setLoadingPost(false);
        }
      };

      loadPost();
    }
  }, [isEditMode, postId, updateSaveStatus]);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!isMobile && categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) {
        setShowCategoryDropdown(false);
      }
      if (!isMobile && tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setShowTagDropdown(false);
      }
      if (expandedTagsRef.current && !expandedTagsRef.current.contains(e.target as Node)) {
        setShowAllTags(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMobile]);

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

    // 追踪代码块状态：存储开始围栏的字符和长度
    let fenceChar: string | null = null;
    let fenceLength = 0;

    lines.forEach((line, index) => {
      const trimmedLine = line.trim();

      // 检测代码块边界
      const fenceMatch = trimmedLine.match(/^(`{3,}|~{3,})/);

      if (fenceMatch) {
        const matchedChar = fenceMatch[1][0];
        const matchedLength = fenceMatch[1].length;

        if (fenceChar === null) {
          // 开始新的代码块
          fenceChar = matchedChar;
          fenceLength = matchedLength;
        } else if (matchedChar === fenceChar && matchedLength >= fenceLength) {
          // 闭合当前代码块（相同字符，相同或更多长度）
          fenceChar = null;
          fenceLength = 0;
        }
        // 如果是不同字符或更少长度，视为代码块内的内容，忽略
        return;
      }

      // 只在非代码块中识别标题
      if (fenceChar === null) {
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

  const tocPanelVariants = useMemo(() => {
    const enterDuration = prefersReducedMotion ? 0.12 : 0.24;
    const exitDuration = prefersReducedMotion ? 0.1 : 0.2;

    return {
      hidden: {
        width: 0,
        opacity: 0,
        x: prefersReducedMotion ? 0 : 20,
      },
      show: {
        width: 320,
        opacity: 1,
        x: 0,
        transition: {
          duration: enterDuration,
          ease: [0.22, 1, 0.36, 1],
          when: 'beforeChildren',
          delayChildren: prefersReducedMotion ? 0 : 0.04,
          staggerChildren: prefersReducedMotion ? 0 : 0.018,
        },
      },
      exit: {
        width: 0,
        opacity: 0,
        x: prefersReducedMotion ? 0 : 24,
        transition: {
          duration: exitDuration,
          ease: [0.4, 0, 1, 1],
          when: 'afterChildren',
          staggerChildren: prefersReducedMotion ? 0 : 0.01,
          staggerDirection: -1,
        },
      },
    };
  }, [prefersReducedMotion]);

  const tocItemVariants = useMemo(() => ({
    hidden: {
      opacity: 0,
      y: prefersReducedMotion ? 0 : 6,
      scale: prefersReducedMotion ? 1 : 0.99,
    },
    show: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        duration: prefersReducedMotion ? 0.08 : 0.16,
        ease: [0.22, 1, 0.36, 1],
      },
    },
    exit: {
      opacity: 0,
      y: prefersReducedMotion ? 0 : -4,
      transition: {
        duration: prefersReducedMotion ? 0.06 : 0.12,
      },
    },
  }), [prefersReducedMotion]);

  // 用于在 TOC 导航期间存储原始同步滚动状态的 Ref
  const syncScrollBeforeNavRef = useRef(false);

  const getNavigationTarget = useCallback((mode: ViewMode): 'editor' | 'preview' | 'both' => {
    if (mode === 'edit') {
      return 'editor';
    }
    if (mode === 'preview') {
      return 'preview';
    }
    return 'both';
  }, []);

  const getPreviewScrollContainer = useCallback((container: HTMLElement): HTMLElement | null => {
    const markdownPreview = container.querySelector('.markdown-preview') as HTMLElement | null;
    if (markdownPreview) {
      const previewPanel = markdownPreview.closest('[class*="overflow-y-auto"]') as HTMLElement | null;
      if (previewPanel) {
        return previewPanel;
      }
    }

    const candidates = container.querySelectorAll('[class*="overflow-y-auto"]');
    for (const node of Array.from(candidates)) {
      const panel = node as HTMLElement;
      if (panel.querySelector('.markdown-preview')) {
        return panel;
      }
    }

    return null;
  }, []);

  const navigatePreviewToHeading = useCallback((container: HTMLElement, headingText: string): boolean => {
    const previewPanel = getPreviewScrollContainer(container);
    if (!previewPanel) {
      logger.warn('TOC preview panel not found', { headingText, viewMode });
      return false;
    }

    const normalizedHeading = headingText.trim();
    const headingElements = previewPanel.querySelectorAll('h1, h2, h3, h4, h5, h6');

    let targetHeading: HTMLElement | null = null;
    for (const node of Array.from(headingElements)) {
      const heading = node as HTMLElement;
      if ((heading.textContent || '').trim() === normalizedHeading) {
        targetHeading = heading;
        break;
      }
    }

    if (!targetHeading) {
      for (const node of Array.from(headingElements)) {
        const heading = node as HTMLElement;
        if ((heading.textContent || '').trim().includes(normalizedHeading)) {
          targetHeading = heading;
          break;
        }
      }
    }

    if (!targetHeading) {
      logger.warn('TOC preview heading not found', { headingText, viewMode });
      return false;
    }

    const containerRect = previewPanel.getBoundingClientRect();
    const targetRect = targetHeading.getBoundingClientRect();
    const currentScrollTop = previewPanel.scrollTop;
    const targetScrollTop = currentScrollTop + (targetRect.top - containerRect.top) - 60;
    previewPanel.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
    return true;
  }, [getPreviewScrollContainer, viewMode]);

  const navigateEditorToHeading = useCallback((container: HTMLElement, headingText: string, lineNumber: number): boolean => {
    const cmScroller = container.querySelector('.cm-scroller') as HTMLElement | null;
    const cmContent = container.querySelector('.cm-content') as HTMLElement | null;

    if (!cmScroller || !cmContent) {
      logger.warn('TOC editor container not found', { headingText, lineNumber, viewMode });
      return false;
    }

    const normalizedHeading = headingText.trim();

    const findHeadingInEditor = (): HTMLElement | null => {
      const lines = cmContent.querySelectorAll('.cm-line');
      for (const node of Array.from(lines)) {
        const line = node as HTMLElement;
        const text = (line.textContent || '').trim();
        if (!/^#+\s/.test(text)) {
          continue;
        }

        const normalizedLineHeading = text.replace(/^#{1,6}\s*/, '').trim();
        if (normalizedLineHeading === normalizedHeading || normalizedLineHeading.includes(normalizedHeading)) {
          return line;
        }
      }
      return null;
    };

    const scrollEditorToElement = (element: HTMLElement) => {
      const lineTop = element.offsetTop - cmContent.offsetTop;
      cmScroller.scrollTo({ top: Math.max(0, lineTop - 50), behavior: 'smooth' });
    };

    const immediateLine = findHeadingInEditor();
    if (immediateLine) {
      scrollEditorToElement(immediateLine);
      return true;
    }

    const estimatedTop = Math.max(0, (lineNumber - 1) * 24 - 50);
    cmScroller.scrollTo({ top: estimatedTop, behavior: 'smooth' });

    const observerTimeout = setTimeout(() => {
      observer.disconnect();
    }, 1200);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') {
          continue;
        }

        for (const node of Array.from(mutation.addedNodes)) {
          if (node.nodeType !== 1) {
            continue;
          }
          const el = node as HTMLElement;
          if (!el.classList.contains('cm-line')) {
            continue;
          }

          const text = (el.textContent || '').trim();
          if (!/^#+\s/.test(text)) {
            continue;
          }

          const normalizedLineHeading = text.replace(/^#{1,6}\s*/, '').trim();
          if (normalizedLineHeading === normalizedHeading || normalizedLineHeading.includes(normalizedHeading)) {
            scrollEditorToElement(el);
            observer.disconnect();
            clearTimeout(observerTimeout);
            return;
          }
        }
      }
    });

    observer.observe(cmContent, { childList: true, subtree: true });
    return true;
  }, [viewMode]);

  // 统一 TOC 导航执行器（按 viewMode 选择目标容器）
  const scrollToHeading = useCallback((headingText: string, lineNumber: number) => {
    const editorContainer = editorContainerRef.current;
    if (!editorContainer) return;

    const navigationTarget = getNavigationTarget(viewMode);
    const shouldNavigateEditor = navigationTarget === 'editor' || navigationTarget === 'both';
    const shouldNavigatePreview = navigationTarget === 'preview' || navigationTarget === 'both';
    const shouldTemporarilyDisableSync = navigationTarget === 'both' && isSyncScroll;

    setActiveTocLine(lineNumber);

    if (shouldTemporarilyDisableSync) {
      syncScrollBeforeNavRef.current = true;
      setIsSyncScroll(false);
    } else {
      syncScrollBeforeNavRef.current = false;
    }

    const executeNavigation = () => {
      const editorMatched = shouldNavigateEditor
        ? navigateEditorToHeading(editorContainer, headingText, lineNumber)
        : false;
      const previewMatched = shouldNavigatePreview
        ? navigatePreviewToHeading(editorContainer, headingText)
        : false;

      if (!editorMatched && !previewMatched) {
        logger.warn('TOC navigation target not found', {
          headingText,
          lineNumber,
          viewMode,
          navigationTarget,
        });
      }
    };

    if (shouldTemporarilyDisableSync) {
      setTimeout(executeNavigation, 10);
    } else {
      executeNavigation();
    }

    setTimeout(() => {
      if (syncScrollBeforeNavRef.current) {
        setIsSyncScroll(true);
      }
      syncScrollBeforeNavRef.current = false;
    }, 1200);
    if (isMobile) {
      closeMobilePanel();
    }
  }, [closeMobilePanel, getNavigationTarget, isMobile, isSyncScroll, navigateEditorToHeading, navigatePreviewToHeading, viewMode]);

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
    if (isMobile) {
      openMobilePanel('ai');
    } else {
      setShowToc(false);
      setShowAI(true);
    }
    if (action) {
      setPendingAiAction(action);
    }
  }, [isMobile, openMobilePanel]);

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

  const isAiPanelOpen = showAI || (isMobile && mobilePanel === 'ai');

  useEffect(() => {
    if (isAiPanelOpen && pendingAiAction) {
      aiPanelRef.current?.runAction(pendingAiAction);
      setPendingAiAction(null);
    }
  }, [isAiPanelOpen, pendingAiAction]);

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
    if (isMobile) {
      setTableInfo(null);
      setShowTableToolbar(false);
      return;
    }

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
  }, [isMobile, tableCommands]);

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
      toast.error('请输入文章标题');
      return false;
    }
    if (!content.trim()) {
      toast.error('请输入文章内容');
      return false;
    }
    // 发布需要分类
    if (forPublish && !selectedCategory) {
      toast.error('发布文章请先选择分类');
      if (isMobile) {
        openMobilePanel('meta');
      } else {
        // 打开设置面板并显示分类下拉菜单
        setShowSettings(true);
        setShowCategoryDropdown(true);
      }
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
        toast.success(`分类 “${res.data.name}” 创建成功`);
      }
    } catch (error) {
      logger.error('Create category error:', error);
      toast.error('创建分类失败');
    } finally {
      setCreatingCategory(false);
    }
  };

  // 保存为草稿
  const handleSave = async () => {
    if (!validatePost()) return;

    setIsSaving(true);
    updateSaveStatus({
      type: 'saving',
      source: 'manual',
      label: '手动保存中',
      detail: '正在提交保存请求',
    });

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
        toast.success('草稿已保存（未发布）');
        updateSaveStatus({
          type: 'saved',
          source: 'manual',
          label: '草稿已保存',
          detail: '当前改动已写入草稿缓存',
        }, {
          markSuccess: true,
          fingerprint: currentFingerprint,
        });
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
          toast.success('保存成功！');
          updateSaveStatus({
            type: 'saved',
            source: 'manual',
            label: '保存成功',
            detail: '当前改动已保存',
          }, {
            markSuccess: true,
            fingerprint: currentFingerprint,
          });
          // 如果是新文章，导航到编辑页面
          if (!isEditMode && res.data.id) {
            setTimeout(() => navigate(`/posts/edit/${res.data.id}`), 1000);
          }
        } else {
          toast.error(res.message || '保存失败');
          updateSaveStatus({
            type: 'error',
            source: 'manual',
            label: '保存失败',
            detail: res.message || '请稍后重试',
          });
        }
      }
    } catch (error) {
      logger.error('Save error:', error);
      toast.error('保存失败，请重试');
      updateSaveStatus({
        type: 'error',
        source: 'manual',
        label: '保存失败',
        detail: '请检查网络后重试',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // 发布文章
  const handlePublish = async () => {
    if (!validatePost(true)) return; // true = 用于发布，需要分类

    setIsPublishing(true);
    updateSaveStatus({
      type: 'saving',
      source: 'publish',
      label: '发布中',
      detail: '正在提交发布请求',
    });

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
        toast.success('文章发布成功！');
        updateSaveStatus({
          type: 'saved',
          source: 'publish',
          label: '发布成功',
          detail: '已发布并同步最新内容',
        }, {
          markSuccess: true,
          fingerprint: currentFingerprint,
        });
        setTimeout(() => navigate('/posts'), 1500);
      } else {
        toast.error(res.message || '发布失败');
        updateSaveStatus({
          type: 'error',
          source: 'publish',
          label: '发布失败',
          detail: res.message || '请稍后重试',
        });
      }
    } catch (error) {
      logger.error('Publish error:', error);
      toast.error('发布失败，请重试');
      updateSaveStatus({
        type: 'error',
        source: 'publish',
        label: '发布失败',
        detail: '请检查网络后重试',
      });
    } finally {
      setIsPublishing(false);
    }
  };


  const appendTagByName = useCallback(async (rawName: string) => {
    const nextName = rawName.trim();
    if (!nextName) {
      return;
    }

    const existing = tags.find((tag) => tag.name.toLowerCase() === nextName.toLowerCase());
    if (existing) {
      if (!selectedTags.find((tag) => tag.id === existing.id)) {
        setSelectedTags([...selectedTags, existing]);
      }
      return;
    }

    try {
      const res = await tagService.create({ name: nextName });
      if (res.data) {
        setTags([...tags, res.data]);
        setSelectedTags([...selectedTags, res.data]);
      }
    } catch (error) {
      logger.error('Failed to create tag:', error);
    }
  }, [selectedTags, tags]);

  const handleTagInputConfirm = useCallback(async () => {
    if (!tagSearch.trim()) {
      return;
    }
    await appendTagByName(tagSearch);
    setTagSearch('');
    setShowTagDropdown(false);
  }, [appendTagByName, tagSearch]);

  const handleTagKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') {
      return;
    }
    e.preventDefault();
    await handleTagInputConfirm();
  };

  const removeTag = (tagId: number) => {
    setSelectedTags(selectedTags.filter(t => t.id !== tagId));
  };

  const handleRetrySaveStatus = useCallback(async () => {
    if (isSaving || isPublishing) {
      return;
    }

    if (!isEditMode || !postId) {
      updateSaveStatus({
        type: 'error',
        source: 'manual',
        label: '无法刷新',
        detail: '新建文章请先手动保存一次',
      });
      return;
    }

    updateSaveStatus({
      type: 'saving',
      source: 'manual',
      label: '刷新状态中',
      detail: '正在重试保存请求',
    });

    try {
      const data = latestDataRef.current;
      const refreshedFingerprint = buildDraftFingerprint({
        title: data.title,
        content: data.content,
        summary: data.summary ?? '',
        categoryId: data.selectedCategory?.id,
        tagIds: data.selectedTags.map((tag) => tag.id),
      });

      await postService.autoSave(postId, {
        title: data.title,
        content: data.content,
        summary: data.summary,
        categoryId: data.selectedCategory?.id,
        tagIds: data.selectedTags.map((tag) => tag.id),
        status: _postStatus,
      });

      updateSaveStatus({
        type: 'saved',
        source: 'manual',
        label: '状态已刷新',
        detail: '草稿缓存已同步',
      }, {
        markSuccess: true,
        fingerprint: refreshedFingerprint,
        autoSaved: true,
      });
      toast.success('保存状态已刷新');
    } catch (error) {
      logger.error('Refresh save status failed:', error);
      updateSaveStatus({
        type: 'error',
        source: 'manual',
        label: '刷新失败',
        detail: '请稍后重试',
      });
      toast.error('保存状态刷新失败');
    }
  }, [isSaving, isPublishing, isEditMode, postId, updateSaveStatus, _postStatus]);



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
      "flex flex-col absolute inset-0 h-full bg-[var(--bg-primary)] z-10 transition-all duration-300 overflow-hidden",
      isMobile && "pb-16"
    )}>
      {/* 顶部头部区域 - 带平滑悬浮折叠动画 */}
      <AnimatePresence initial={false}>
        {!isFullscreen && (
          <motion.div
            key="editor-header"
            initial={{ height: 0, opacity: 0, y: -20 }}
            animate={{ height: 'auto', opacity: 1, y: 0 }}
            exit={{ height: 0, opacity: 0, y: -20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 250 }}
            className="border-b border-[var(--border-subtle)] bg-[var(--bg-card)] relative z-[80] overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 md:px-6 py-3 gap-2 md:gap-4">
              {/* 左侧块：返回 + 标题 */}
              <div className="flex items-center gap-2 md:gap-4 flex-1 min-w-0">
                <button
                  onClick={() => navigate('/posts')}
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors flex-shrink-0"
                  title="返回列表"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>

                {/* 标题输入 */}
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="请输入文章标题..."
                    className="w-full bg-transparent focus:bg-[var(--bg-secondary)] hover:bg-[var(--bg-secondary)]/50 px-3 py-1.5 rounded-lg text-lg md:text-xl font-bold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none truncate transition-colors border border-transparent focus:border-[var(--border-subtle)]"
                  />
                </div>

                {/* 元数据：分类和标签 (仅 PC 端) */}
                <div className="hidden md:flex items-center gap-3 flex-shrink-0">
                  <div className="w-px h-6 bg-[var(--border-subtle)]" />
                  {/* 分类选择器 */}
                  <div ref={categoryDropdownRef} className="relative">
                    <button
                      onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-[var(--bg-card-hover)] transition-colors text-sm"
                    >
                      <span className={selectedCategory ? 'text-primary font-medium' : 'text-gray-500'}>
                        {selectedCategory?.name || '选择分类'}
                      </span>
                      <ChevronDown className={cn("w-3 h-3 text-gray-500 transition-transform", showCategoryDropdown && "rotate-180")} />
                    </button>
                    {/* 分类下拉列表 */}
                    <AnimatePresence>
                      {showCategoryDropdown && (
                        <motion.div
                          initial={{ opacity: 0, y: 6, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 6, scale: 0.96 }}
                          className="absolute top-full left-0 mt-3 w-64 z-[2000] bg-[var(--bg-popover)]/95 border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl"
                        >
                          <div className="p-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/70">
                            <input
                              type="text"
                              value={categorySearch}
                              onChange={(e) => setCategorySearch(e.target.value)}
                              placeholder="搜索分类..."
                              autoFocus
                              className="w-full px-3 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-xs text-[var(--text-primary)] focus:outline-none"
                            />
                          </div>
                          <div className="max-h-56 overflow-auto py-2">
                            {categories.map((cat) => (
                              <button
                                key={cat.id}
                                onClick={() => { setSelectedCategory(cat); setShowCategoryDropdown(false); }}
                                className={cn(
                                  'w-full px-4 py-2 text-left text-sm hover:bg-[var(--bg-card-hover)] transition-colors',
                                  selectedCategory?.id === cat.id ? 'text-primary' : 'text-[var(--text-secondary)]'
                                )}
                              >
                                {cat.name}
                              </button>
                            ))}
                            <button onClick={() => { setShowCategoryDropdown(false); setShowCreateCategoryModal(true); }} className="w-full px-4 py-2 text-left text-xs text-primary hover:bg-[var(--bg-card-hover)] flex items-center gap-2 border-t border-[var(--border-subtle)] mt-2">
                              <Plus className="w-3 h-3" /> 新建分类
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* 标签选择器 */}
                  <div ref={tagDropdownRef} className="relative flex items-center gap-1.5 z-[2100]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {selectedTags.slice(0, 3).map((tag) => {
                        const tc = getTagColor(tag.name);
                        return (
                          <span key={tag.id} className={cn("group/tag flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors", tc.bg, tc.text, tc.border)}>
                            <span className="truncate max-w-[80px] sm:max-w-[120px]">{tag.name}</span>
                            <X className="w-3 h-3 opacity-60 hover:opacity-100 cursor-pointer flex-shrink-0" onClick={() => removeTag(tag.id)} />
                          </span>
                        );
                      })}
                      {selectedTags.length > 3 && (
                        <div className="group/more relative flex items-center">
                          <span className="px-2 py-1 text-xs font-medium bg-[var(--bg-secondary)] text-[var(--text-secondary)] rounded-full border border-[var(--border-subtle)] cursor-default transition-colors group-hover/more:border-primary/40 group-hover/more:text-primary">
                            +{selectedTags.length - 3}
                          </span>
                          {/* 悬浮展示所有超长标签 */}
                          <div className="absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 p-2.5 bg-[var(--bg-popover)]/95 backdrop-blur-xl border border-[var(--border-subtle)] rounded-2xl shadow-xl opacity-0 invisible group-hover/more:opacity-100 group-hover/more:visible transition-all z-[2200] flex flex-wrap gap-1.5 max-w-[300px] pointer-events-auto">
                            {selectedTags.map(tag => {
                              const tc = getTagColor(tag.name);
                              return (
                                <span key={`all-${tag.id}`} className={cn("flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border", tc.bg, tc.text, tc.border)}>
                                  <span>{tag.name}</span>
                                  <X className="w-3 h-3 opacity-60 hover:opacity-100 cursor-pointer flex-shrink-0" onClick={() => removeTag(tag.id)} />
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setShowTagDropdown(!showTagDropdown)}
                      className="flex items-center justify-center w-6 h-6 rounded-md border border-dashed border-[var(--border-subtle)] hover:border-primary hover:text-primary text-[var(--text-muted)] transition-colors"
                      title="添加标签"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <AnimatePresence>
                      {showTagDropdown && (
                        <motion.div
                          initial={{ opacity: 0, y: 6, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 6, scale: 0.96 }}
                          className="absolute top-full right-0 mt-3 w-80 z-[2000] bg-[var(--bg-popover)]/95 border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl"
                        >
                          <div className="p-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/70">
                            <div className="relative">
                              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                              <input
                                type="text"
                                value={tagSearch}
                                onChange={(e) => setTagSearch(e.target.value)}
                                onKeyDown={handleTagKeyDown}
                                placeholder="输入标签后回车..."
                                autoFocus
                                className="w-full pl-9 pr-3 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-xs text-[var(--text-primary)] focus:outline-none"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={handleTagInputConfirm}
                              className="mt-2 w-full px-3 py-1.5 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/15 transition-colors font-medium border border-transparent"
                            >
                              添加到文章
                            </button>
                          </div>
                          <div className="max-h-60 overflow-auto p-3 flex flex-wrap gap-2">
                            {filteredTags.length === 0 ? (
                              <div className="w-full py-8 text-center text-xs text-[var(--text-muted)]">
                                找不到相关标签...
                              </div>
                            ) : (
                              filteredTags.slice(0, 40).map((tag) => {
                                const isSelected = selectedTags.some(t => t.id === tag.id);
                                const tc = getTagColor(tag.name);
                                return (
                                  <button
                                    key={tag.id}
                                    type="button"
                                    onClick={() => isSelected ? removeTag(tag.id) : setSelectedTags([...selectedTags, tag])}
                                    className={cn(
                                      "px-3 py-1.5 text-sm rounded-full transition-all flex items-center gap-1.5 border select-none group focus:outline-none",
                                      isSelected
                                        ? `${tc.activeBg} shadow-sm font-medium`
                                        : `${tc.bg} ${tc.text} ${tc.border} hover:shadow-sm ${tc.hoverBorder} ${tc.bgHover}`
                                    )}
                                  >
                                    <span>{tag.name}</span>
                                    {isSelected && <X className="w-3.5 h-3.5 ml-0.5 flex-shrink-0 opacity-80 hover:opacity-100 transition-opacity" />}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              {/* 右侧按钮 (PC 端) */}
              <div className="hidden md:flex items-center gap-2 flex-shrink-0 relative z-30">
                <button
                  onClick={() => setShowAI(!showAI)}
                  className={cn('flex h-8 items-center gap-1.5 px-3 rounded-lg transition-colors text-sm', showAI ? 'bg-primary text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]')}
                >
                  <Sparkles className="w-3.5 h-3.5" /> AI
                </button>
                <button
                  onClick={() => setShowSettings(true)}
                  className="flex h-8 items-center gap-1.5 px-3 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] text-sm"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex h-8 items-center gap-1.5 px-3 min-w-[80px] justify-center rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] text-sm"
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} 保存
                </button>
                <button
                  onClick={handlePublish}
                  disabled={isPublishing}
                  className="flex h-8 items-center gap-1.5 px-4 rounded-lg bg-primary text-white hover:bg-primary/90 text-sm font-medium shadow-lg shadow-primary/20"
                >
                  {isPublishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} 发布
                </button>
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
                if (isMobile) {
                  openMobilePanel('toc');
                  return;
                }
                setShowAI(false);
                setShowToc(!showToc);
              }}
              tooltip={isMobile ? '打开目录' : showToc ? '关闭目录' : '打开目录'}
              isActive={isMobile ? mobilePanel === 'toc' : showToc}
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

            {!isMobile && (
              <>
                {enableSelectionAi && (
                  <SelectionAiToolbar
                    editorViewRef={editorViewRef}
                    selectedModelId={aiModelId}
                    selectedProviderCode={aiProviderCode}
                  />
                )}
                <SlashCommandMenu editorViewRef={editorViewRef} onRunAiAction={openAiPanel} showAiCommands={enableSlashAi} />
              </>
            )}

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
            {!isMobile && tableInfo?.isInTable && tableInfo.tableBounds && tableInfo.rowPositions && editorContainerRef.current && (() => {
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
              {!isMobile && showTableToolbar && tableInfo?.isInTable && tableInfo.tableBounds && editorContainerRef.current && (
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
          {!isMobile && showAI && (
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
          {!isMobile && showToc && (
            <motion.div
              initial="hidden"
              animate="show"
              exit="exit"
              variants={tocPanelVariants}
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
                  <div className="space-y-0.5 px-3">
                    {tocItems.map((item, index) => (
                      <motion.button
                        key={`${item.line}-${index}`}
                        variants={tocItemVariants}
                        onClick={() => scrollToHeading(item.text, item.line)}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-md text-sm transition-all duration-300 group relative flex items-center gap-3',
                          activeTocLine === item.line
                            ? 'bg-primary/12 text-[var(--text-primary)]'
                            : 'hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        )}
                        style={{ paddingLeft: `${(item.level - 1) * 14 + 12}px` }}
                        title={item.text}
                      >
                        {/* Elegant Hover Indicator */}
                        <div className={cn(
                          'absolute left-1 w-0.5 bg-primary transition-all duration-400 ease-out-expo rounded-full shadow-[0_0_8px_#8b5cf6]',
                          activeTocLine === item.line
                            ? 'h-3/5 opacity-100'
                            : 'h-0 opacity-0 group-hover:h-3/5 group-hover:opacity-100'
                        )} />

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
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 编辑器页脚 */}
      <div className="hidden md:flex items-center justify-between px-4 py-1.5 border-t border-[var(--border-subtle)] bg-[var(--bg-card)] text-[12px] text-[var(--text-muted)]">
        <div className="flex items-center gap-4">
          <span>字数: <span className="text-[var(--text-primary)] font-medium">{stats.words.toLocaleString()}</span></span>
          <span>行数: <span className="text-[var(--text-primary)] font-medium">{stats.lines.toLocaleString()}</span></span>
          <div className="flex min-w-0 items-center gap-2 pl-3 border-l border-[var(--border-subtle)]" aria-live="polite">
            <span
              className={cn(
                'inline-flex h-2 w-2 flex-shrink-0 rounded-full transition-colors',
                saveStatusDisplay.dotClass,
                (saveStatus.type === 'saving' || isSaving || isPublishing) && 'animate-pulse'
              )}
            />
            <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium', saveStatusDisplay.toneClass)}>
              {saveStatusDisplay.icon}
              {saveStatusDisplay.label}
            </span>
            <span className="truncate text-[11px] text-[var(--text-muted)]">{saveStatusDisplay.detail}</span>
            {saveStatusDisplay.showRetry && (
              <button
                type="button"
                onClick={handleRetrySaveStatus}
                className="ml-1 rounded border border-red-500/30 px-1.5 py-0.5 text-[11px] text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-300"
              >
                刷新
              </button>
            )}
          </div>
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
        {!isMobile && showSettings && (
          <>
            {/* 背景遮罩 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 top-14 z-[70] bg-black/20 backdrop-blur-[2px]"
            />

            {/* 侧滑面板：设置 top-14 避开顶部标题栏 (h-14) */}
            <motion.div
              initial={{ x: '100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="absolute right-0 top-14 bottom-0 w-[400px] z-[70] bg-[var(--bg-primary)] border-l border-[var(--border-default)] shadow-2xl flex flex-col"
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
      <AnimatePresence mode="wait">
        {isMobile && mobilePanel === 'ai' && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeMobilePanel}
              className="fixed inset-0 z-[120] bg-black/45 backdrop-blur-sm md:hidden"
            />
            <div className="fixed inset-0 z-[121] md:hidden">
              <AiSidePanel
                isMobile
                ref={aiPanelRef}
                content={content}
                title={title}
                summary={summary}
                selectedModelId={aiModelId}
                selectedProviderCode={aiProviderCode}
                onModelChange={handleModelChange}
                onClose={closeMobilePanel}
                onInsertText={insertAiText}
                onReplaceContent={replaceAiContent}
                onUpdateSummary={setSummary}
                onUpdateTitle={setTitle}
                onApplyTags={applyAiTags}
              />
            </div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isMobile && mobilePanel !== 'none' && mobilePanel !== 'ai' && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeMobilePanel}
              className="fixed inset-0 z-[120] bg-black/45 backdrop-blur-sm md:hidden"
            />

            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 260 }}
              className="fixed inset-0 z-[121] bg-[var(--bg-primary)] flex flex-col md:hidden"
            >
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3 bg-[var(--bg-secondary)]">
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {mobilePanel === 'toc' ? '目录' : mobilePanel === 'meta' ? '文章属性' : '文章设置'}
                </div>
                <button
                  type="button"
                  onClick={closeMobilePanel}
                  className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {mobilePanel === 'toc' && (
                  <div className="space-y-2">
                    {tocItems.length === 0 ? (
                      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50 px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                        暂无目录，请先在正文中添加标题
                      </div>
                    ) : (
                      tocItems.map((item, index) => (
                        <button
                          key={`${item.line}-${index}`}
                          type="button"
                          onClick={() => scrollToHeading(item.text, item.line)}
                          className={cn(
                            'w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
                            activeTocLine === item.line
                              ? 'bg-primary/12 text-[var(--text-primary)]'
                              : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
                          )}
                          style={{ paddingLeft: `${(item.level - 1) * 14 + 12}px` }}
                        >
                          {item.text}
                        </button>
                      ))
                    )}
                  </div>
                )}

                {mobilePanel === 'meta' && (
                  <div className="space-y-5">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-[var(--text-secondary)]">分类</label>
                        <button
                          type="button"
                          onClick={() => setShowCreateCategoryModal(true)}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80"
                        >
                          <Plus className="w-3 h-3" />
                          新建分类
                        </button>
                      </div>
                      <div className="relative">
                        <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={categorySearch}
                          onChange={(e) => setCategorySearch(e.target.value)}
                          placeholder="搜索分类..."
                          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] focus:outline-none"
                        />
                      </div>
                      <div className="max-h-52 overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/60 p-1">
                        {filteredCategories.map((cat) => (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => setSelectedCategory(cat)}
                            className={cn(
                              'w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
                              selectedCategory?.id === cat.id
                                ? 'bg-primary/15 text-primary'
                                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
                            )}
                          >
                            {cat.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-sm font-medium text-[var(--text-secondary)]">标签</label>
                      <div className="flex flex-wrap gap-2">
                        {selectedTags.map((tag) => (
                          <span key={tag.id} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary">
                            #{tag.name}
                            <button type="button" onClick={() => removeTag(tag.id)}>
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={tagSearch}
                          onChange={(e) => setTagSearch(e.target.value)}
                          onKeyDown={handleTagKeyDown}
                          placeholder="输入标签后回车"
                          className="flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleTagInputConfirm}
                          className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary"
                        >
                          添加
                        </button>
                      </div>
                      <div className="max-h-44 overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/60 p-1">
                        {filteredTags.slice(0, 60).map((tag) => (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => setSelectedTags((prev) => prev.find((item) => item.id === tag.id) ? prev : [...prev, tag])}
                            className="w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] transition-colors"
                          >
                            #{tag.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {mobilePanel === 'settings' && (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-[var(--text-secondary)]">发布时间</label>
                      <input
                        type="datetime-local"
                        value={publishTime}
                        onChange={(e) => setPublishTime(e.target.value)}
                        className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none"
                        style={{ colorScheme: resolvedTheme }}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-[var(--text-secondary)]">文章摘要</label>
                        <button
                          type="button"
                          onClick={() => openAiPanel('summary')}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80"
                        >
                          <Sparkles className="w-3 h-3" />
                          AI 生成
                        </button>
                      </div>
                      <textarea
                        rows={6}
                        value={summary}
                        onChange={(e) => setSummary(e.target.value)}
                        placeholder="输入文章摘要，或使用 AI 生成..."
                        className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none focus:outline-none"
                      />
                    </div>
                    <label className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/60 px-3 py-2 text-sm text-[var(--text-secondary)]">
                      自动保存
                      <input
                        type="checkbox"
                        checked={isAutoSaveEnabled}
                        onChange={(e) => setIsAutoSaveEnabled(e.target.checked)}
                        className="w-4 h-4 rounded border-[var(--border-subtle)]"
                      />
                    </label>
                  </div>
                )}
              </div>

              <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {mobilePanel === 'toc' ? (
                  <button
                    type="button"
                    onClick={closeMobilePanel}
                    className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] py-2.5 text-sm font-medium text-[var(--text-primary)]"
                  >
                    关闭目录
                  </button>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={isSaving}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] py-2.5 text-sm font-medium text-[var(--text-primary)] disabled:opacity-60"
                    >
                      {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      保存草稿
                    </button>
                    <button
                      type="button"
                      onClick={closeMobilePanel}
                      className="rounded-xl bg-primary py-2.5 text-sm font-medium text-white"
                    >
                      完成
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {isMobile && (
        <div className="fixed inset-x-0 bottom-0 z-[110] border-t border-[var(--border-subtle)] bg-[var(--bg-card)]/95 backdrop-blur-xl px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
          <div className="grid grid-cols-5 gap-1">
            <button
              type="button"
              onClick={() => openMobilePanel('ai')}
              className={cn(
                'flex flex-col items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] transition-colors',
                mobilePanel === 'ai' ? 'bg-primary/12 text-primary' : 'text-[var(--text-secondary)]'
              )}
            >
              <Sparkles className="w-4 h-4" />
              AI
            </button>
            <button
              type="button"
              onClick={() => openMobilePanel('toc')}
              className={cn(
                'flex flex-col items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] transition-colors',
                mobilePanel === 'toc' ? 'bg-primary/12 text-primary' : 'text-[var(--text-secondary)]'
              )}
            >
              <ListTree className="w-4 h-4" />
              目录
            </button>
            <button
              type="button"
              onClick={() => openMobilePanel('meta')}
              className={cn(
                'flex flex-col items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] transition-colors',
                mobilePanel === 'meta' ? 'bg-primary/12 text-primary' : 'text-[var(--text-secondary)]'
              )}
            >
              <CheckSquare className="w-4 h-4" />
              属性
            </button>
            <button
              type="button"
              onClick={() => openMobilePanel('settings')}
              className={cn(
                'flex flex-col items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] transition-colors',
                mobilePanel === 'settings' ? 'bg-primary/12 text-primary' : 'text-[var(--text-secondary)]'
              )}
            >
              <Settings className="w-4 h-4" />
              设置
            </button>
            <button
              type="button"
              onClick={() => {
                closeMobilePanel();
                void handlePublish();
              }}
              disabled={isPublishing}
              className="flex flex-col items-center justify-center gap-1 rounded-lg bg-primary py-1.5 text-[11px] text-white disabled:opacity-60"
            >
              {isPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              发布
            </button>
          </div>
        </div>
      )}


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
              className="w-full max-w-md p-6 bg-[var(--bg-popover)] border border-[var(--border-default)] rounded-xl shadow-2xl"
            >
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">新建分类</h3>
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
                  className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
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
