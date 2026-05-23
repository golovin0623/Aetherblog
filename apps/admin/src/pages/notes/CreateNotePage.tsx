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
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { Tooltip } from '@aetherblog/ui';

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

  const handleSave = async () => {
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
      if (!noteId) {
        navigate(`/notes/${res.data.id}/edit`, { replace: true });
      }
    } catch (error) {
      setSaveState('failed');
      toast.error(extractApiErrorMessage(error, '保存笔记失败'));
    } finally {
      setSaving(false);
    }
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
        <Loader2 className="h-6 w-6 animate-spin text-[var(--ink-muted)]" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[640px] flex-col bg-[var(--bg-void)]">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-3 py-2 md:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/notes')}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--ink-primary)]"
            aria-label="返回智能笔记"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 shrink-0 text-[var(--aurora-1)]" />
              <span className="truncate text-sm font-semibold text-[var(--ink-primary)]">智能笔记</span>
            </div>
            <p className={cn('text-xs', saveState === 'failed' ? 'text-status-danger' : 'text-[var(--ink-muted)]')}>
              {saveText}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPanelOpen((open) => !open)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--ink-primary)]"
            aria-label="打开笔记信息面板"
          >
            <PanelRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--ink-primary)] px-3 text-sm font-semibold text-[var(--bg-void)] transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-4 py-3">
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                markDirty();
              }}
              placeholder="未命名笔记"
              className="w-full bg-transparent text-xl font-bold text-[var(--ink-primary)] outline-none placeholder:text-[var(--ink-muted)] md:text-2xl"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
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
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--ink-primary)]',
          active && 'bg-[var(--ink-primary)] text-[var(--bg-void)] hover:bg-[var(--ink-primary)] hover:text-[var(--bg-void)]',
        )}
      >
        <span className="inline-flex transition-transform active:scale-90">{children}</span>
      </button>
    </Tooltip>
  );
}

function ToolbarDivider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]" />;
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
    <div className="border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--bg-card)_86%,transparent)] backdrop-blur-sm">
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
        <span className="flex h-9 shrink-0 items-center rounded-lg px-2 font-mono text-[11px] text-[var(--ink-muted)]">
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
  const content = (
    <aside className={cn(
      'flex h-full w-full flex-col border-l border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)]',
      isMobile ? 'max-h-[72vh] rounded-t-2xl border-l-0 border-t' : 'w-[360px]',
    )}>
      <header className="flex items-center justify-between border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-[var(--ink-primary)]">笔记信息</h2>
          <p className="text-xs text-[var(--ink-muted)]">整理来源、标签与关联</p>
        </div>
        <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--ink-muted)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]" aria-label="关闭信息面板">
          <ChevronDown className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <PanelGroup title="基础">
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="摘要可选" rows={3} className="field min-h-20 resize-none" />
          <div className="grid grid-cols-[minmax(0,1fr)_2.5rem] gap-2">
            <select value={folderId} onChange={(event) => setFolderId(event.target.value)} className="field">
              <option value="">未整理</option>
              {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
            <button
              type="button"
              onClick={onCreateFolder}
              aria-label="新建文件夹"
              title="新建文件夹"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)]"
            >
              <FolderPlus className="h-4 w-4" />
            </button>
          </div>
          <input value={tagInput} onChange={(event) => setTagInput(event.target.value)} list="note-tag-options" placeholder="标签, 用逗号分隔" className="field" />
          <datalist id="note-tag-options">
            {tags.map((tag) => <option key={tag.id} value={tag.name} />)}
          </datalist>
          <div className="grid grid-cols-2 gap-2">
            <ToggleButton active={isPinned} onClick={() => setIsPinned(!isPinned)} icon={<Pin className="h-4 w-4" />}>置顶</ToggleButton>
            <ToggleButton active={isFavorite} onClick={() => setIsFavorite(!isFavorite)} icon={<Star className="h-4 w-4" />}>收藏</ToggleButton>
          </div>
          <button type="button" onClick={onArchiveToggle} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-sm font-medium text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]">
            {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            {archived ? '恢复笔记' : '归档笔记'}
          </button>
        </PanelGroup>

        <PanelGroup title="来源">
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value as NonNullable<CreateNoteRequest['sourceType']>)} className="field">
            <option value="manual">手动</option>
            <option value="web">网页</option>
            <option value="article">文章</option>
            <option value="chat">对话</option>
            <option value="import">导入</option>
            <option value="api">API</option>
          </select>
          <input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} placeholder="来源标题" className="field" />
          <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="来源 URL, 只保存不抓取" className="field" />
        </PanelGroup>

        <PanelGroup title="关联">
          {(note?.backLinks?.length || 0) === 0 ? (
            <p className="rounded-lg border border-dashed border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] p-3 text-xs leading-5 text-[var(--ink-muted)]">
              还没有反向链接。可以在其他笔记中输入 <span className="font-mono">[[{note?.title || '笔记标题'}]]</span> 建立关联。
            </p>
          ) : (
            <div className="space-y-2">
              {note?.backLinks.map((link) => (
                <div key={link.id} className="rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-2 text-xs">
                  <div className="flex items-center gap-1 text-[var(--ink-primary)]"><Link2 className="h-3.5 w-3.5" />{link.sourceTitle}</div>
                  <p className="mt-1 text-[var(--ink-muted)]">引用为 {link.linkText}</p>
                </div>
              ))}
            </div>
          )}
        </PanelGroup>

        <PanelGroup title="AI">
          <div className="rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-3 text-xs text-[var(--ink-muted)]">
            <div className="flex items-center justify-between">
              <span>索引状态</span>
              <span className="font-mono text-[var(--ink-primary)]">{note?.embeddingStatus || 'PENDING'}</span>
            </div>
            <p className="mt-2 leading-5">首版只落底座。后续灵境引用会在这里显示索引和召回状态。</p>
          </div>
        </PanelGroup>
      </div>
      <style>{`
        .field {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid color-mix(in oklch, var(--ink-primary) 10%, transparent);
          background: var(--bg-card);
          padding: 0.625rem 0.75rem;
          color: var(--ink-primary);
          font-size: 0.875rem;
          outline: none;
        }
        .field:focus { border-color: var(--aurora-1); }
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

function PanelGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-mono uppercase tracking-[0.16em] text-[var(--ink-muted)]">{title}</h3>
      <div className="space-y-2">{children}</div>
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
          ? 'border-[var(--ink-primary)] bg-[var(--ink-primary)] text-[var(--bg-void)]'
          : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]',
      )}
    >
      {active ? <Check className="h-4 w-4" /> : icon}
      {children}
    </button>
  );
}
