import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDebounce } from '@aetherblog/hooks';
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Copy,
  Edit,
  Folder,
  Loader2,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
  Star,
  Tag,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { AdminPagination } from '@/components/common/AdminPagination';
import { noteService, type NoteListParams } from '@/services/noteService';
import type { NoteFolderItem, NoteListItem, NoteTagItem } from '@/types/note';
import { cn, extractApiErrorMessage } from '@/lib/utils';
import { QuickNoteDialog } from './notes/components/QuickNoteDialog';
import { CreateFolderDialog } from './notes/components/CreateFolderDialog';

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 10;

const noteViews = [
  { id: 'all', label: '全部' },
  { id: 'recent', label: '最近' },
  { id: 'pinned', label: '置顶' },
  { id: 'unorganized', label: '未整理' },
  { id: 'archived', label: '已归档' },
] as const;

type NoteView = typeof noteViews[number]['id'];

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function sourceLabel(type: string) {
  const labels: Record<string, string> = {
    manual: '手动',
    web: '网页',
    article: '文章',
    chat: '对话',
    import: '导入',
    api: 'API',
  };
  return labels[type] || type;
}

function tagList(tags: string[]) {
  if (!tags?.length) return <span className="text-xs text-[var(--ink-muted)]">无标签</span>;
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {tags.slice(0, 3).map((tag) => (
        <span key={tag} className="max-w-[7rem] truncate rounded-md border border-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_7%,transparent)] px-1.5 py-0.5 text-[11px] text-[var(--aurora-1)]">
          {tag}
        </span>
      ))}
      {tags.length > 3 && (
        <span className="rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)]">+{tags.length - 3}</span>
      )}
    </div>
  );
}

export default function NotesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [folders, setFolders] = useState<NoteFolderItem[]>([]);
  const [tags, setTags] = useState<NoteTagItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);
  const hasLoadedNotesRef = useRef(false);

  const pageNum = Math.max(1, Number(searchParams.get('pageNum') || '1'));
  const pageSize = Number(searchParams.get('pageSize') || DEFAULT_PAGE_SIZE);
  const view = (searchParams.get('view') || 'all') as NoteView;
  const keyword = searchParams.get('keyword') || '';
  const folderId = searchParams.get('folderId') || '';
  const tag = searchParams.get('tag') || '';
  const sourceType = searchParams.get('sourceType') || '';
  const debouncedKeyword = useDebounce(keyword, 350);

  const updateParams = useCallback((patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (value === undefined || value === '') {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
    });
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

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

  const loadNotes = useCallback(async () => {
    const isFirst = !hasLoadedNotesRef.current;
    if (isFirst) setLoading(true);
    else setRefreshing(true);
    try {
      const params: NoteListParams = {
        pageNum,
        pageSize,
        view,
        keyword: debouncedKeyword || undefined,
        folderId: folderId ? Number(folderId) : undefined,
        tag: tag || undefined,
        sourceType: sourceType || undefined,
      };
      const res = await noteService.getList(params);
      setNotes(res.data.list || []);
      setTotal(res.data.total || 0);
      setPages(res.data.pages || 1);
    } catch (error) {
      toast.error(extractApiErrorMessage(error, '加载笔记失败'));
      setNotes([]);
    } finally {
      hasLoadedNotesRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [debouncedKeyword, folderId, pageNum, pageSize, sourceType, tag, view]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const hasFilter = Boolean(keyword || folderId || tag || sourceType || view !== 'all');

  const currentViewLabel = useMemo(() => noteViews.find((item) => item.id === view)?.label || '全部', [view]);

  const handleDelete = async (note: NoteListItem) => {
    if (!window.confirm(`确定要删除笔记「${note.title}」吗？`)) return;
    setActionId(note.id);
    try {
      await noteService.delete(note.id);
      toast.success('笔记已删除');
      void loadNotes();
    } catch (error) {
      toast.error(extractApiErrorMessage(error, '删除笔记失败'));
    } finally {
      setActionId(null);
    }
  };

  const handleArchive = async (note: NoteListItem, archived: boolean) => {
    if (archived && !window.confirm(`确定要归档笔记「${note.title}」吗？`)) return;

    setActionId(note.id);
    try {
      await noteService.updateProperties(note.id, { archived });
      toast.success(archived ? '笔记已归档' : '笔记已恢复');
      void loadNotes();
    } catch (error) {
      toast.error(extractApiErrorMessage(error, '更新笔记失败'));
    } finally {
      setActionId(null);
    }
  };

  const handleDuplicate = async (note: NoteListItem) => {
    setActionId(note.id);
    try {
      const res = await noteService.duplicate(note.id);
      toast.success('笔记已复制');
      navigate(`/notes/${res.data.id}/edit`);
    } catch (error) {
      toast.error(extractApiErrorMessage(error, '复制笔记失败'));
    } finally {
      setActionId(null);
    }
  };

  const resetFilters = () => {
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  return (
    <div className="min-h-full bg-[var(--bg-void)] px-4 py-4 md:px-6 md:py-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="surface-leaf surface-dashboard-card rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--ink-primary)] text-[var(--bg-void)]">
                <BookOpen className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-xl font-bold text-[var(--ink-primary)]">智能笔记</h1>
                <p className="text-sm text-[var(--ink-muted)]">{currentViewLabel} · {loading ? '加载中' : `${total} 条笔记`}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setQuickOpen(true)}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_7%,transparent)] px-3 text-sm font-medium text-[var(--aurora-1)] transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)]"
              >
                <Zap className="h-4 w-4" />
                快速记录
              </button>
              <button
                type="button"
                onClick={() => navigate('/notes/new')}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--ink-primary)] px-3 text-sm font-semibold text-[var(--bg-void)] transition-transform active:scale-[0.98]"
              >
                <Plus className="h-4 w-4" />
                新建笔记
              </button>
              <button
                type="button"
                onClick={() => setFolderDialogOpen(true)}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-3 text-sm font-medium text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)]"
              >
                <Folder className="h-4 w-4" />
                新建文件夹
              </button>
            </div>
          </div>
        </header>

        <section className="surface-leaf surface-dashboard-card rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_160px_150px]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input
                value={keyword}
                onChange={(event) => updateParams({ keyword: event.target.value, pageNum: 1 })}
                placeholder="搜索标题、正文或标签..."
                className="h-11 w-full rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-card)] pl-9 pr-3 text-sm text-[var(--ink-primary)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--aurora-1)]"
              />
            </label>
            <select
              value={folderId}
              onChange={(event) => updateParams({ folderId: event.target.value, pageNum: 1 })}
              className="h-11 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-card)] px-3 text-sm text-[var(--ink-primary)] outline-none focus:border-[var(--aurora-1)]"
            >
              <option value="">全部文件夹</option>
              {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
            <select
              value={tag}
              onChange={(event) => updateParams({ tag: event.target.value, pageNum: 1 })}
              className="h-11 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-card)] px-3 text-sm text-[var(--ink-primary)] outline-none focus:border-[var(--aurora-1)]"
            >
              <option value="">全部标签</option>
              {tags.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
            </select>
            <select
              value={sourceType}
              onChange={(event) => updateParams({ sourceType: event.target.value, pageNum: 1 })}
              className="h-11 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-card)] px-3 text-sm text-[var(--ink-primary)] outline-none focus:border-[var(--aurora-1)]"
            >
              <option value="">全部来源</option>
              <option value="manual">手动</option>
              <option value="web">网页</option>
              <option value="article">文章</option>
              <option value="chat">对话</option>
              <option value="import">导入</option>
              <option value="api">API</option>
            </select>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {noteViews.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => updateParams({ view: item.id === 'all' ? undefined : item.id, pageNum: 1 })}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center rounded-full border px-3 text-sm transition-colors',
                  view === item.id || (view === 'all' && item.id === 'all')
                    ? 'border-[var(--ink-primary)] bg-[var(--ink-primary)] text-[var(--bg-void)]'
                    : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)]',
                )}
              >
                {item.label}
              </button>
            ))}
            {hasFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-sm text-[var(--ink-muted)] hover:text-status-danger"
              >
                <X className="h-4 w-4" />
                清空
              </button>
            )}
          </div>
        </section>

        <section className="surface-leaf surface-dashboard-card relative overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
          <div className="flex items-center justify-between border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-4 py-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-[var(--aurora-1)]" />
              <span className="text-sm font-semibold text-[var(--ink-primary)]">笔记列表</span>
            </div>
            {refreshing && <Loader2 className="h-4 w-4 animate-spin text-[var(--ink-muted)]" />}
          </div>

          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: pageSize }).map((_, index) => (
                <div key={index} className="h-16 animate-pulse rounded-lg bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)]" />
              ))}
            </div>
          ) : notes.length === 0 ? (
            <div className="flex min-h-80 flex-col items-center justify-center px-6 py-16 text-center">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_7%,transparent)]">
                {hasFilter ? <Search className="h-7 w-7 text-[var(--aurora-1)]" /> : <BookOpen className="h-7 w-7 text-[var(--aurora-1)]" />}
              </div>
              <h2 className="text-lg font-bold text-[var(--ink-primary)]">{hasFilter ? '没有匹配的笔记' : '还没有笔记'}</h2>
              <p className="mt-1 max-w-sm text-sm text-[var(--ink-muted)]">{hasFilter ? '换个关键词或清空筛选后再试。' : '先快速记录一个想法, 或创建一篇完整笔记。'}</p>
              <div className="mt-5 flex gap-2">
                {hasFilter ? (
                  <button type="button" onClick={resetFilters} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-3 text-sm text-[var(--ink-secondary)]">
                    <X className="h-4 w-4" />
                    清空筛选
                  </button>
                ) : (
                  <button type="button" onClick={() => setQuickOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--ink-primary)] px-3 text-sm font-semibold text-[var(--bg-void)]">
                    <Zap className="h-4 w-4" />
                    快速记录
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <table className="w-full table-fixed">
                  <thead className="border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] text-left text-xs text-[var(--ink-muted)]">
                    <tr>
                      <th className="w-[38%] px-4 py-3 font-mono uppercase tracking-[0.16em]">标题</th>
                      <th className="w-[18%] px-4 py-3 font-mono uppercase tracking-[0.16em]">标签</th>
                      <th className="w-[14%] px-4 py-3 font-mono uppercase tracking-[0.16em]">文件夹</th>
                      <th className="w-[10%] px-4 py-3 font-mono uppercase tracking-[0.16em]">来源</th>
                      <th className="w-[12%] px-4 py-3 font-mono uppercase tracking-[0.16em]">更新</th>
                      <th className="w-[8%] px-4 py-3 text-right font-mono uppercase tracking-[0.16em]">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notes.map((note) => (
                      <tr key={note.id} className="group h-[76px] border-b border-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]">
                        <td className="px-4 py-3">
                          <button type="button" onClick={() => navigate(`/notes/${note.id}/edit`)} className="block min-w-0 text-left">
                            <div className="flex min-w-0 items-center gap-2">
                              {note.isPinned && <Pin className="h-3.5 w-3.5 shrink-0 text-[var(--aurora-1)]" />}
                              {note.isFavorite && <Star className="h-3.5 w-3.5 shrink-0 text-status-warning" />}
                              <span className="truncate text-sm font-semibold text-[var(--ink-primary)]">{note.title}</span>
                            </div>
                            <p className="mt-1 line-clamp-1 text-xs text-[var(--ink-muted)]">{note.summary || `${note.wordCount} 字`}</p>
                          </button>
                        </td>
                        <td className="px-4 py-3">{tagList(note.tagNames)}</td>
                        <td className="px-4 py-3 text-sm text-[var(--ink-secondary)]">
                          <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-2 py-1">
                            <Folder className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{note.folderName || '未整理'}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-[var(--ink-muted)]">{sourceLabel(note.sourceType)}</td>
                        <td className="px-4 py-3 text-xs text-[var(--ink-muted)]">{formatDate(note.updatedAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <IconButton label="编辑" onClick={() => navigate(`/notes/${note.id}/edit`)} icon={<Edit className="h-4 w-4" />} />
                            <IconButton label="复制" onClick={() => void handleDuplicate(note)} loading={actionId === note.id} icon={<Copy className="h-4 w-4" />} />
                            <IconButton label={note.archived ? '恢复' : '归档'} onClick={() => void handleArchive(note, !note.archived)} icon={note.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />} />
                            <IconButton label="删除" onClick={() => void handleDelete(note)} danger icon={<Trash2 className="h-4 w-4" />} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] md:hidden">
                {notes.map((note) => (
                  <article key={note.id} className="p-4">
                    <button type="button" onClick={() => navigate(`/notes/${note.id}/edit`)} className="block w-full text-left">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="line-clamp-2 text-sm font-semibold leading-6 text-[var(--ink-primary)]">{note.title}</h3>
                        <MoreHorizontal className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--ink-muted)]">{note.summary || `${note.wordCount} 字 · ${formatDate(note.updatedAt)}`}</p>
                    </button>
                    <div className="mt-3 flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                      <Folder className="h-3.5 w-3.5" />
                      <span>{note.folderName || '未整理'}</span>
                      <span className="h-1 w-1 rounded-full bg-[var(--ink-muted)]/40" />
                      <span>{sourceLabel(note.sourceType)}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">{tagList(note.tagNames)}</div>
                      <div className="flex shrink-0 gap-1">
                        <IconButton label="编辑" onClick={() => navigate(`/notes/${note.id}/edit`)} icon={<Edit className="h-4 w-4" />} />
                        <IconButton label={note.archived ? '恢复' : '归档'} onClick={() => void handleArchive(note, !note.archived)} icon={note.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />} />
                        <IconButton label="删除" onClick={() => void handleDelete(note)} danger icon={<Trash2 className="h-4 w-4" />} />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}

          <AdminPagination
            page={pageNum}
            total={total}
            totalPages={Math.max(pages, 1)}
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={(page) => updateParams({ pageNum: page })}
            onPageSizeChange={(nextSize) => updateParams({ pageSize: nextSize, pageNum: 1 })}
            itemLabel="条"
            loading={refreshing}
            summaryLoading={loading}
            pageSizeAriaLabel="每页笔记数量"
          />
        </section>
      </div>

      <QuickNoteDialog
        isOpen={quickOpen}
        folders={folders}
        onClose={() => setQuickOpen(false)}
        onCreated={() => {
          void loadNotes();
          void loadMeta();
        }}
      />
      <CreateFolderDialog
        isOpen={folderDialogOpen}
        onClose={() => setFolderDialogOpen(false)}
        onCreated={(folder) => {
          setFolders((prev) => [...prev, folder]);
          updateParams({ folderId: folder.id, pageNum: 1 });
        }}
      />
    </div>
  );
}

function IconButton({
  label,
  icon,
  loading,
  danger,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  loading?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)] disabled:opacity-60 md:h-8 md:w-8',
        danger && 'hover:bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] hover:text-status-danger',
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
    </button>
  );
}
