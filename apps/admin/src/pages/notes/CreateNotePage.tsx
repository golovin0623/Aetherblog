import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTheme } from '@aetherblog/hooks';
import { EditorView } from '@codemirror/view';
import { EditorWithPreview, useEditorCommands, type EditorCommands, type ViewMode } from '@aetherblog/editor';
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  BookOpen,
  Bold,
  Check,
  CheckSquare,
  ChevronDown,
  Clock3,
  Code,
  Columns,
  Eye,
  FileCode2,
  FolderPlus,
  GitBranch,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Minus,
  PanelRight,
  Pencil,
  Pin,
  Quote,
  Redo2,
  Save,
  Star,
  Strikethrough,
  Sigma,
  Tag,
  Table2,
  Underline,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { Select, Tooltip } from '@aetherblog/ui';

import { noteService } from '@/services/noteService';
import type { CreateNoteRequest, NoteDetail, NoteFolderItem, NoteTagItem } from '@/types/note';
import { cn, extractApiErrorMessage } from '@/lib/utils';
import { useMediaQuery } from '@/hooks';
import { CreateFolderDialog } from './components/CreateFolderDialog';
import { AlertBlockDropdownButton } from '../posts/components/AlertBlockDropdownButton';

function parseTags(input: string) {
  return input.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function tagsToInput(tags: string[]) {
  return tags.join(', ');
}

function nowLabel(value?: string | null) {
  if (!value) return '尚未保存';
  return new Date(value).toLocaleString('zh-CN');
}

type InsertMode = 'wrap' | 'insert' | 'lineStart';

const sourceOptions: Array<{ value: NonNullable<CreateNoteRequest['sourceType']>; label: string }> = [
  { value: 'manual', label: '手动' },
  { value: 'web', label: '网页' },
  { value: 'article', label: '文章' },
  { value: 'chat', label: '对话' },
  { value: 'import', label: '导入' },
  { value: 'api', label: 'API' },
];

export default function CreateNotePage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);
  const noteId = id ? Number(id) : null;
  const isMobile = useMediaQuery('(max-width: 768px)');
  const { resolvedTheme } = useTheme();
  const editorViewRef = useRef<EditorView | null>(null);

  const [folders, setFolders] = useState<NoteFolderItem[]>([]);
  const [tags, setTags] = useState<NoteTagItem[]>([]);
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState('');
  const [folderId, setFolderId] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [sourceType, setSourceType] = useState<CreateNoteRequest['sourceType']>('manual');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(Boolean(isEditMode));
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'autosaved' | 'failed'>('idle');
  const [dirty, setDirty] = useState(false);
  const [panelOpen, setPanelOpen] = useState(!isMobile);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => (typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches ? 'edit' : 'split'));
  const [editorFontSize, setEditorFontSize] = useState(15);
  const [previewFontSize, setPreviewFontSize] = useState(16);
  const editorCommands = useEditorCommands(editorViewRef);

  useEffect(() => {
    if (isMobile && viewMode === 'split') {
      setViewMode('edit');
    }
  }, [isMobile, viewMode]);

  const loadMeta = useCallback(async () => {
    try {
      const [folderRes, tagRes] = await Promise.all([
        noteService.getFolders(),
        noteService.getTags(),
      ]);
      setFolders(folderRes.data || []);
      setTags(tagRes.data || []);
    } catch (error) {
      toast.error(extractApiErrorMessage(error, '加载笔记元数据失败'));
    }
  }, []);

  const loadNote = useCallback(async () => {
    if (!noteId) return;
    setLoading(true);
    try {
      const res = await noteService.getById(noteId);
      const data = res.data;
      const draft = data.draft;
      setNote(data);
      setTitle(draft?.title ?? data.title ?? '');
      setContent(draft?.contentMarkdown ?? data.contentMarkdown ?? '');
      setSummary(data.summary || '');
      setFolderId(String(draft?.folderId ?? data.folderId ?? ''));
      setTagInput(tagsToInput(draft?.tagNames ?? data.tagNames ?? []));
      setSourceType(data.sourceType);
      setSourceTitle(data.sourceTitle || '');
      setSourceUrl(data.sourceUrl || '');
      setIsPinned(data.isPinned);
      setIsFavorite(data.isFavorite);
      setArchived(data.archived);
      setDirty(false);
      setSaveState(draft ? 'autosaved' : 'saved');
    } catch (error) {
      toast.error(extractApiErrorMessage(error, '加载笔记失败'));
      navigate('/notes');
    } finally {
      setLoading(false);
    }
  }, [navigate, noteId]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadNote();
  }, [loadNote]);

  useEffect(() => {
    setPanelOpen(!isMobile);
  }, [isMobile]);

  useEffect(() => {
    if (!noteId || !dirty) return;
    const timer = window.setTimeout(async () => {
      try {
        setSaveState('saving');
        await noteService.autoSave(noteId, {
          title,
          contentMarkdown: content,
          folderId: folderId ? Number(folderId) : undefined,
          tagNames: parseTags(tagInput),
          sourceMeta: {},
        });
        setSaveState('autosaved');
      } catch {
        setSaveState('failed');
      }
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [content, dirty, folderId, noteId, tagInput, title]);

  const markDirty = () => {
    setDirty(true);
    if (saveState === 'saved') setSaveState('idle');
  };

  const insertMarkdown = useCallback((prefix: string, suffix = '', mode: InsertMode = 'wrap') => {
    if (mode === 'lineStart') {
      editorCommands.toggleLineStart(prefix);
    } else if (mode === 'wrap' && suffix) {
      editorCommands.toggleWrap(prefix, suffix);
    } else {
      editorCommands.insertText(prefix);
    }
    editorCommands.focus();
  }, [editorCommands]);

  const payload = useMemo<CreateNoteRequest>(() => ({
    title,
    contentMarkdown: content,
    summary: summary || undefined,
    folderId: folderId ? Number(folderId) : undefined,
    tagNames: parseTags(tagInput),
    sourceType,
    sourceTitle: sourceTitle || undefined,
    sourceUrl: sourceUrl || undefined,
    sourceMeta: {},
    isPinned,
    isFavorite,
  }), [content, folderId, isFavorite, isPinned, sourceTitle, sourceType, sourceUrl, summary, tagInput, title]);

  const handleSave = async (options: { redirectNew?: boolean } = {}) => {
    setSaving(true);
    setSaveState('saving');
    try {
      const res = noteId
        ? await noteService.update(noteId, payload)
        : await noteService.create(payload);
      setNote(res.data);
      setTitle(res.data.title);
      setContent(res.data.contentMarkdown);
      setSummary(res.data.summary || '');
      setTagInput(tagsToInput(res.data.tagNames || []));
      setDirty(false);
      setSaveState('saved');
      toast.success('笔记已保存');
      void loadMeta();
      if (!noteId && options.redirectNew !== false) {
        navigate(`/notes/${res.data.id}/edit`, { replace: true });
      }
      return res.data;
    } catch (error) {
      setSaveState('failed');
      toast.error(extractApiErrorMessage(error, '保存笔记失败'));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleOpenAtlasReader = async () => {
    let targetNoteId = noteId;
    if (!targetNoteId || dirty) {
      const saved = await handleSave({ redirectNew: false });
      if (!saved) return;
      targetNoteId = saved.id;
    }
    navigate(`/atlas/reader/note/${targetNoteId}`);
  };

  useEffect(() => {
    const handleFormatShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;

      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const isEditorFocused = Boolean(active?.closest('.cm-editor'));
      if (!isEditorFocused) return;

      switch (event.key.toLowerCase()) {
        case 'b':
          event.preventDefault();
          insertMarkdown('**', '**');
          break;
        case 'i':
          event.preventDefault();
          insertMarkdown('*', '*');
          break;
        case 'u':
          event.preventDefault();
          insertMarkdown('<u>', '</u>');
          break;
        case 'k':
          event.preventDefault();
          if (event.shiftKey) {
            insertMarkdown('```\n', '\n```');
          } else {
            insertMarkdown('[', '](url)');
          }
          break;
        case '`':
          event.preventDefault();
          insertMarkdown('`', '`');
          break;
      }
    };

    window.addEventListener('keydown', handleFormatShortcut);
    return () => window.removeEventListener('keydown', handleFormatShortcut);
  }, [handleSave, insertMarkdown]);

  const handleArchiveToggle = async () => {
    if (!noteId) {
      setArchived((value) => !value);
      markDirty();
      return;
    }
    if (!archived && !window.confirm('确定要归档当前笔记吗？')) return;

    try {
      const res = await noteService.updateProperties(noteId, { archived: !archived });
      setArchived(res.data.archived);
      setNote(res.data);
      toast.success(res.data.archived ? '笔记已归档' : '笔记已恢复');
    } catch (error) {
      toast.error(extractApiErrorMessage(error, '更新归档状态失败'));
    }
  };

  const saveText = {
    idle: dirty ? '有未保存更改' : '尚未保存',
    saving: '保存中',
    saved: '已保存',
    autosaved: '自动保存成功',
    failed: '保存失败',
  }[saveState];

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[640px] flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 md:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/notes')}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
            aria-label="返回智能笔记"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate text-sm font-semibold text-[var(--text-primary)]">智能笔记</span>
            </div>
            <p className={cn('text-xs', saveState === 'failed' ? 'text-status-danger' : 'text-[var(--text-muted)]')}>
              {saveText}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Tooltip content="在 Atlas Reader 中标注" side="bottom" delay={0}>
            <button
              type="button"
              onClick={() => void handleOpenAtlasReader()}
              disabled={saving}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 text-sm font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] disabled:opacity-60"
              aria-label="在 Atlas Reader 中标注"
            >
              <Highlighter className="h-4 w-4" />
              <span className="hidden sm:inline">Atlas</span>
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={() => setPanelOpen((open) => !open)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
            aria-label="打开笔记信息面板"
          >
            <PanelRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--color-primary)] px-3 text-sm font-semibold text-white shadow-[0_4px_12px_-2px_color-mix(in_oklch,var(--aurora-1)_28%,transparent)] transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/80 px-4 py-3">
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                markDirty();
              }}
              placeholder="未命名笔记"
              className="w-full bg-transparent text-xl font-bold text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] md:text-2xl"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
              <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{nowLabel(note?.updatedAt)}</span>
              <span className="inline-flex items-center gap-1"><Tag className="h-3.5 w-3.5" />{parseTags(tagInput).length || 0} 标签</span>
              {archived && <span className="rounded-full bg-status-warning/10 px-2 py-0.5 text-status-warning">已归档</span>}
            </div>
          </div>

          <NoteEditorToolbar
            editorCommands={editorCommands}
            insertMarkdown={insertMarkdown}
            isMobile={isMobile}
            viewMode={viewMode}
            setViewMode={setViewMode}
            editorFontSize={editorFontSize}
            previewFontSize={previewFontSize}
            setEditorFontSize={setEditorFontSize}
            setPreviewFontSize={setPreviewFontSize}
          />

          <div className="min-h-0 flex-1 overflow-hidden">
            <EditorWithPreview
              value={content}
              onChange={(value) => {
                setContent(value);
                markDirty();
              }}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              isSyncScroll
              editorViewRef={editorViewRef}
              theme={resolvedTheme}
              editorFontSize={editorFontSize}
              previewFontSize={previewFontSize}
              showLineNumbers={!isMobile}
              useCrossfade={isMobile}
              bearMode={isMobile}
              hideToolbar
              className="h-full"
            />
          </div>
        </section>

        {panelOpen && (
          <NoteInfoPanel
            isMobile={isMobile}
            folders={folders}
            tags={tags}
            note={note}
            summary={summary}
            setSummary={(value) => { setSummary(value); markDirty(); }}
            folderId={folderId}
            setFolderId={(value) => { setFolderId(value); markDirty(); }}
            onCreateFolder={() => setFolderDialogOpen(true)}
            tagInput={tagInput}
            setTagInput={(value) => { setTagInput(value); markDirty(); }}
            sourceType={sourceType || 'manual'}
            setSourceType={(value) => { setSourceType(value); markDirty(); }}
            sourceTitle={sourceTitle}
            setSourceTitle={(value) => { setSourceTitle(value); markDirty(); }}
            sourceUrl={sourceUrl}
            setSourceUrl={(value) => { setSourceUrl(value); markDirty(); }}
            isPinned={isPinned}
            setIsPinned={(value) => { setIsPinned(value); markDirty(); }}
            isFavorite={isFavorite}
            setIsFavorite={(value) => { setIsFavorite(value); markDirty(); }}
            archived={archived}
            onArchiveToggle={() => void handleArchiveToggle()}
            onClose={() => setPanelOpen(false)}
          />
        )}
        <CreateFolderDialog
          isOpen={folderDialogOpen}
          onClose={() => setFolderDialogOpen(false)}
          onCreated={(folder) => {
            setFolders((prev) => [...prev, folder]);
            setFolderId(String(folder.id));
            markDirty();
          }}
        />
      </main>
    </div>
  );
}

interface ToolbarButtonProps {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  tooltipSide?: 'top' | 'bottom';
}

function ToolbarButton({ label, children, onClick, active = false, tooltipSide = 'top' }: ToolbarButtonProps) {
  return (
    <Tooltip content={label} side={tooltipSide} delay={0}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]',
          active && 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary)] hover:text-white',
        )}
      >
        <span className="inline-flex transition-transform active:scale-90">{children}</span>
      </button>
    </Tooltip>
  );
}

function ToolbarDivider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-[var(--border-subtle)]" />;
}

function NoteEditorToolbar({
  editorCommands,
  insertMarkdown,
  isMobile,
  viewMode,
  setViewMode,
  editorFontSize,
  previewFontSize,
  setEditorFontSize,
  setPreviewFontSize,
}: {
  editorCommands: EditorCommands;
  insertMarkdown: (prefix: string, suffix?: string, mode?: InsertMode) => void;
  isMobile: boolean;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  editorFontSize: number;
  previewFontSize: number;
  setEditorFontSize: (updater: (value: number) => number) => void;
  setPreviewFontSize: (updater: (value: number) => number) => void;
}) {
  const tooltipSide = isMobile ? 'bottom' : 'top';
  const changeFontSize = (delta: number) => {
    setEditorFontSize((value) => Math.min(24, Math.max(12, value + delta)));
    setPreviewFontSize((value) => Math.min(24, Math.max(12, value + delta)));
  };

  return (
    <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/80 backdrop-blur-sm">
      <div className={cn('flex items-center gap-1 overflow-x-auto px-3 py-2', !isMobile && 'flex-wrap')}>
        <ToolbarButton label="撤销 (⌘Z)" onClick={() => editorCommands.undo()} tooltipSide={tooltipSide}>
          <Undo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="重做 (⇧⌘Z)" onClick={() => editorCommands.redo()} tooltipSide={tooltipSide}>
          <Redo2 className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton label="标题 1" onClick={() => insertMarkdown('# ', '', 'lineStart')} tooltipSide={tooltipSide}>
          <Heading1 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="标题 2" onClick={() => insertMarkdown('## ', '', 'lineStart')} tooltipSide={tooltipSide}>
          <Heading2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="标题 3" onClick={() => insertMarkdown('### ', '', 'lineStart')} tooltipSide={tooltipSide}>
          <Heading3 className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton label="粗体 (⌘B)" onClick={() => insertMarkdown('**', '**')} tooltipSide={tooltipSide}>
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="斜体 (⌘I)" onClick={() => insertMarkdown('*', '*')} tooltipSide={tooltipSide}>
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="下划线 (⌘U)" onClick={() => insertMarkdown('<u>', '</u>')} tooltipSide={tooltipSide}>
          <Underline className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="删除线" onClick={() => insertMarkdown('~~', '~~')} tooltipSide={tooltipSide}>
          <Strikethrough className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="行内代码 (⌘`)" onClick={() => insertMarkdown('`', '`')} tooltipSide={tooltipSide}>
          <Code className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="代码块 (⇧⌘K)" onClick={() => insertMarkdown('```\n', '\n```')} tooltipSide={tooltipSide}>
          <FileCode2 className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton label="无序列表" onClick={() => insertMarkdown('- ', '', 'lineStart')} tooltipSide={tooltipSide}>
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="有序列表" onClick={() => insertMarkdown('1. ', '', 'lineStart')} tooltipSide={tooltipSide}>
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="任务列表" onClick={() => insertMarkdown('- [ ] ', '', 'lineStart')} tooltipSide={tooltipSide}>
          <CheckSquare className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton label="链接 (⌘K)" onClick={() => insertMarkdown('[', '](url)')} tooltipSide={tooltipSide}>
          <Link2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="图片" onClick={() => insertMarkdown('![', '](image-url)')} tooltipSide={tooltipSide}>
          <Image className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="表格" onClick={() => insertMarkdown('| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n', '', 'insert')} tooltipSide={tooltipSide}>
          <Table2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="分割线" onClick={() => insertMarkdown('\n---\n', '', 'insert')} tooltipSide={tooltipSide}>
          <Minus className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="引用" onClick={() => insertMarkdown('> ', '', 'lineStart')} tooltipSide={tooltipSide}>
          <Quote className="h-4 w-4" />
        </ToolbarButton>
        <AlertBlockDropdownButton onInsertMarkdown={insertMarkdown} className="h-9 w-9 shrink-0" />
        <ToolbarButton label="数学公式" onClick={() => insertMarkdown('$$\n', '\n$$')} tooltipSide={tooltipSide}>
          <Sigma className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="流程图" onClick={() => insertMarkdown('```mermaid\n', '\n```')} tooltipSide={tooltipSide}>
          <GitBranch className="h-4 w-4" />
        </ToolbarButton>

        <div className="min-w-3 flex-1" />
        <ToolbarDivider />

        <ToolbarButton label="缩小字号" onClick={() => changeFontSize(-1)} tooltipSide={tooltipSide}>
          <ZoomOut className="h-4 w-4" />
        </ToolbarButton>
        <span className="flex h-9 shrink-0 items-center rounded-lg px-2 font-mono text-[11px] text-[var(--text-muted)]">
          {editorFontSize}/{previewFontSize}
        </span>
        <ToolbarButton label="放大字号" onClick={() => changeFontSize(1)} tooltipSide={tooltipSide}>
          <ZoomIn className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton label="仅编辑" active={viewMode === 'edit'} onClick={() => setViewMode('edit')} tooltipSide={tooltipSide}>
          <Pencil className="h-4 w-4" />
        </ToolbarButton>
        {!isMobile && (
          <ToolbarButton label="分屏" active={viewMode === 'split'} onClick={() => setViewMode('split')} tooltipSide={tooltipSide}>
            <Columns className="h-4 w-4" />
          </ToolbarButton>
        )}
        <ToolbarButton label="仅预览" active={viewMode === 'preview'} onClick={() => setViewMode('preview')} tooltipSide={tooltipSide}>
          <Eye className="h-4 w-4" />
        </ToolbarButton>
      </div>
    </div>
  );
}

function NoteInfoPanel({
  isMobile,
  folders,
  tags,
  note,
  summary,
  setSummary,
  folderId,
  setFolderId,
  onCreateFolder,
  tagInput,
  setTagInput,
  sourceType,
  setSourceType,
  sourceTitle,
  setSourceTitle,
  sourceUrl,
  setSourceUrl,
  isPinned,
  setIsPinned,
  isFavorite,
  setIsFavorite,
  archived,
  onArchiveToggle,
  onClose,
}: {
  isMobile: boolean;
  folders: NoteFolderItem[];
  tags: NoteTagItem[];
  note: NoteDetail | null;
  summary: string;
  setSummary: (value: string) => void;
  folderId: string;
  setFolderId: (value: string) => void;
  onCreateFolder: () => void;
  tagInput: string;
  setTagInput: (value: string) => void;
  sourceType: NonNullable<CreateNoteRequest['sourceType']>;
  setSourceType: (value: NonNullable<CreateNoteRequest['sourceType']>) => void;
  sourceTitle: string;
  setSourceTitle: (value: string) => void;
  sourceUrl: string;
  setSourceUrl: (value: string) => void;
  isPinned: boolean;
  setIsPinned: (value: boolean) => void;
  isFavorite: boolean;
  setIsFavorite: (value: boolean) => void;
  archived: boolean;
  onArchiveToggle: () => void;
  onClose: () => void;
}) {
  const currentFolder = folders.find((folder) => String(folder.id) === folderId);
  const tagCount = parseTags(tagInput).length;
  const currentSource = sourceOptions.find((item) => item.value === sourceType)?.label || '手动';
  const folderOptions = [
    { value: '__unfiled__', label: '未整理' },
    ...folders.map((folder) => ({ value: String(folder.id), label: folder.name })),
  ];

  const content = (
    <aside className={cn(
      'flex h-full w-full flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)]',
      isMobile ? 'max-h-[74vh] rounded-t-2xl border-l-0 border-t' : 'w-[384px]',
    )}>
      <header className="shrink-0 border-b border-[var(--border-subtle)] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-primary">
                <BookOpen className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">笔记信息</h2>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">来源 · 标签 · 关联</p>
              </div>
            </div>
            <div className="mt-3 flex min-w-0 flex-wrap gap-1.5">
              <InfoPill>{currentFolder?.name || '未整理'}</InfoPill>
              <InfoPill>{tagCount} 标签</InfoPill>
              <InfoPill>{currentSource}</InfoPill>
            </div>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]" aria-label="关闭信息面板">
            {isMobile ? <ChevronDown className="h-4 w-4" /> : <X className="h-4 w-4" />}
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <PanelGroup title="整理">
          <FieldLabel>摘要</FieldLabel>
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="摘要可选" rows={3} className="note-side-field min-h-24 resize-none leading-6" />

          <FieldLabel>文件夹</FieldLabel>
          <div className="grid grid-cols-[minmax(0,1fr)_2.5rem] gap-2">
            <Select
              value={folderId || '__unfiled__'}
              onValueChange={(value) => setFolderId(value === '__unfiled__' ? '' : value)}
              options={folderOptions}
              size="md"
              ariaLabel="笔记文件夹"
            />
            <button
              type="button"
              onClick={onCreateFolder}
              aria-label="新建文件夹"
              title="新建文件夹"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
            >
              <FolderPlus className="h-4 w-4" />
            </button>
          </div>

          <FieldLabel>标签</FieldLabel>
          <input value={tagInput} onChange={(event) => setTagInput(event.target.value)} list="note-tag-options" placeholder="标签, 用逗号分隔" className="note-side-field" />
          <datalist id="note-tag-options">
            {tags.map((tag) => <option key={tag.id} value={tag.name} />)}
          </datalist>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <ToggleButton active={isPinned} onClick={() => setIsPinned(!isPinned)} icon={<Pin className="h-4 w-4" />}>置顶</ToggleButton>
            <ToggleButton active={isFavorite} onClick={() => setIsFavorite(!isFavorite)} icon={<Star className="h-4 w-4" />}>收藏</ToggleButton>
          </div>
          <button type="button" onClick={onArchiveToggle} className={cn(
            'inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors',
            archived
              ? 'border-[color-mix(in_oklch,var(--color-primary)_32%,transparent)] bg-[color-mix(in_oklch,var(--color-primary)_10%,transparent)] text-[var(--color-primary)]'
              : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]',
          )}>
            {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            {archived ? '恢复笔记' : '归档笔记'}
          </button>
        </PanelGroup>

        <PanelGroup title="来源">
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-1">
            {sourceOptions.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setSourceType(item.value)}
                className={cn(
                  'h-8 rounded-lg text-xs font-medium transition-colors',
                  sourceType === item.value
                    ? 'bg-[var(--color-primary)] text-white shadow-sm'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} placeholder="来源标题" className="note-side-field" />
          <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="来源 URL, 只保存不抓取" className="note-side-field" />
        </PanelGroup>

        <PanelGroup title="关联">
          {(note?.backLinks?.length || 0) === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-card)]/60 px-3 py-3">
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <Link2 className="h-4 w-4 text-[var(--text-muted)]" />
                暂无反向链接
              </div>
              <p className="mt-1 pl-6 text-xs leading-5 text-[var(--text-muted)]">等待其他笔记引用</p>
            </div>
          ) : (
            <div className="space-y-2">
              {note?.backLinks.map((link) => (
                <div key={link.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-xs">
                  <div className="flex items-center gap-1.5 text-[var(--text-primary)]"><Link2 className="h-3.5 w-3.5" />{link.sourceTitle}</div>
                  <p className="mt-1 text-[var(--text-muted)]">引用为 {link.linkText}</p>
                </div>
              ))}
            </div>
          )}
        </PanelGroup>

        <PanelGroup title="AI">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--text-muted)]">索引状态</span>
              <span className="rounded-md bg-[var(--bg-secondary)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)]">{note?.embeddingStatus || 'PENDING'}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
              <span className="block h-full w-1/3 rounded-full bg-[var(--color-primary)]" />
            </div>
          </div>
        </PanelGroup>
      </div>
      <style>{`
        .note-side-field {
          width: 100%;
          min-height: 2.5rem;
          border-radius: 0.625rem;
          border: 1px solid var(--border-subtle);
          background: var(--bg-card);
          padding: 0.625rem 0.75rem;
          color: var(--text-primary);
          font-size: 0.875rem;
          outline: none;
          transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease;
        }
        .note-side-field::placeholder { color: var(--text-muted); }
        .note-side-field:focus {
          border-color: color-mix(in oklch, var(--color-primary) 48%, transparent);
          background: var(--bg-card);
          box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-primary) 16%, transparent);
        }
      `}</style>
    </aside>
  );

  if (!isMobile) return content;

  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-black/45 backdrop-blur-sm">
      <button className="absolute inset-0 cursor-default" aria-label="关闭信息面板" onClick={onClose} />
      <div className="relative w-full">{content}</div>
    </div>
  );
}

function InfoPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1 text-[11px] text-[var(--text-muted)]">
      <span className="truncate">{children}</span>
    </span>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="block text-xs font-medium text-[var(--text-muted)]">{children}</label>;
}

function PanelGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-[var(--border-subtle)] pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold text-[var(--text-muted)]">{title}</h3>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function ToggleButton({ active, icon, children, onClick }: { active: boolean; icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors',
        active
          ? 'border-[color-mix(in_oklch,var(--color-primary)_32%,transparent)] bg-[color-mix(in_oklch,var(--color-primary)_10%,transparent)] text-[var(--color-primary)]'
          : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]',
      )}
    >
      {active ? <Check className="h-4 w-4" /> : icon}
      {children}
    </button>
  );
}
