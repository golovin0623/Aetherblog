import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen, FileText, NotebookPen, Library, Search,
  ExternalLink, Trash2, RefreshCw, ChevronLeft, Check, Sparkles,
} from 'lucide-react';
import { Modal, Select, type SelectOption } from '@aetherblog/ui';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import {
  readingBookService,
  type ReadingBookListItem,
  type ReadingSourceType,
} from '@/services/readingBookService';
import { postService } from '@/services/postService';
import { noteService } from '@/services/noteService';
import { knowledgeBaseService, type KnowledgeBase } from '@/services/knowledgeBaseService';

interface SimulatedReadingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type View = 'shelf' | 'import';

interface PickItem {
  id: number;
  title: string;
  meta?: string;
}

const SOURCE_TABS: Array<{ key: ReadingSourceType; label: string; icon: typeof FileText }> = [
  { key: 'POST', label: '文章', icon: FileText },
  { key: 'NOTE', label: '学习笔记', icon: NotebookPen },
  { key: 'KB_FILE', label: '知识库', icon: Library },
];

const THEME_OPTIONS: SelectOption[] = [
  { value: 'paper', label: '纸张 Paper' },
  { value: 'sepia', label: '羊皮 Sepia' },
  { value: 'night', label: '夜读 Night' },
];

/** 成书主题对应的封面纸色（内容数据色，与阅读器皮肤 swatch 同源）。 */
const THEME_COVERS: Record<string, { bg: string; ink: string; edge: string; label: string }> = {
  paper: { bg: '#fbfaf6', ink: '#2b2a27', edge: '#e4dfd2', label: '纸张' },
  sepia: { bg: '#f6ecd6', ink: '#46392a', edge: '#e4d5b6', label: '羊皮' },
  night: { bg: '#20242c', ink: '#d3d8df', edge: '#14171d', label: '夜读' },
};

const COVER_SERIF = "Georgia, 'Songti SC', 'STSong', SimSun, serif";

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');
const BLOG_BASE_URL = (import.meta.env.VITE_BLOG_URL ?? '').trim().replace(/\/+$/, '');

/** 拟真阅读器前台地址。网关同源时使用根路径；直连模式可用 VITE_BLOG_URL 指向博客前台。 */
function readerUrl(slug: string): string {
  const path = `/reader/${encodeURIComponent(slug)}`;
  return BLOG_BASE_URL ? `${BLOG_BASE_URL}${path}` : path;
}

function readerLaunchUrl(slug: string): string {
  const encodedSlug = encodeURIComponent(slug);
  const redirect = encodeURIComponent(readerUrl(slug));
  return `${API_BASE_URL}/v1/admin/reading-books/reader/${encodedSlug}?redirect=${redirect}`;
}

function coverForTheme(theme: string | undefined) {
  return THEME_COVERS[theme ?? 'paper'] ?? THEME_COVERS.paper;
}

/**
 * SimulatedReadingModal —— 「拟真阅读」管理入口。
 * 提供两个视图：
 *   - shelf：已生成成书的书架（书封网格：打开 / 重新生成 / 删除）
 *   - import：选择来源（文章 / 学习笔记 / 知识库文件）→ 导入生成成书缓存
 */
export function SimulatedReadingModal({ isOpen, onClose }: SimulatedReadingModalProps) {
  const [view, setView] = useState<View>('shelf');

  // ----- 书架 -----
  const [books, setBooks] = useState<ReadingBookListItem[]>([]);
  const [shelfLoading, setShelfLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  // 允许多本书并发重制，各自独立跟踪，互不清除对方的进行中状态。
  const [regeneratingIds, setRegeneratingIds] = useState<ReadonlySet<number>>(new Set());
  const [shelfError, setShelfError] = useState<string | null>(null);

  const loadShelf = useCallback(async () => {
    setShelfLoading(true);
    try {
      const res = await readingBookService.getList({ pageNum: 1, pageSize: 100 });
      if (res.code === 200 && res.data) setBooks(res.data.list);
    } catch (err) {
      logger.error('加载拟真阅读书架失败:', err);
    } finally {
      setShelfLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setView('shelf');
      setConfirmDeleteId(null);
      setShelfError(null);
      loadShelf();
    }
  }, [isOpen, loadShelf]);

  const handleDelete = async (id: number) => {
    try {
      await readingBookService.delete(id);
      setBooks((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      logger.error('删除拟真阅读失败:', err);
    } finally {
      setConfirmDeleteId(null);
    }
  };

  /** 用原来源与主题重跑一次成书渲染（内容更新后刷新缓存）。 */
  const handleRegenerate = async (b: ReadingBookListItem) => {
    setRegeneratingIds((prev) => new Set(prev).add(b.id));
    setShelfError(null);
    try {
      const theme = (['paper', 'sepia', 'night'].includes(b.theme) ? b.theme : 'paper') as 'paper' | 'sepia' | 'night';
      const res = await readingBookService.generate({ sourceType: b.sourceType, sourceId: b.sourceId, theme });
      if (res.code === 200) {
        await loadShelf();
      } else {
        setShelfError(res.message || `《${b.title}》重新生成失败`);
      }
    } catch (err) {
      logger.error('重新生成拟真阅读失败:', err);
      setShelfError(err instanceof Error ? err.message : `《${b.title}》重新生成失败`);
    } finally {
      setRegeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(b.id);
        return next;
      });
    }
  };

  // ----- 导入 -----
  const [sourceType, setSourceType] = useState<ReadingSourceType>('POST');
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<PickItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [theme, setTheme] = useState('paper');
  const [generating, setGenerating] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // 知识库二级选择
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [activeKbId, setActiveKbId] = useState<number | null>(null);

  const resetImport = useCallback(() => {
    setKeyword('');
    setItems([]);
    setSelectedId(null);
    setFeedback(null);
    setActiveKbId(null);
  }, []);

  const goImport = () => {
    resetImport();
    setSourceType('POST');
    setView('import');
  };

  // 拉取来源列表。
  const loadSources = useCallback(async () => {
    setListLoading(true);
    setSelectedId(null);
    try {
      if (sourceType === 'POST') {
        const res = await postService.getList({ pageNum: 1, pageSize: 50, keyword: keyword || undefined });
        if (res.code === 200 && res.data) {
          setItems(res.data.list.map((p) => ({
            id: p.id,
            title: p.title,
            meta: p.status === 'PUBLISHED' ? '已发布' : p.status === 'DRAFT' ? '草稿' : '归档',
          })));
        }
      } else if (sourceType === 'NOTE') {
        const res = await noteService.getList({ pageNum: 1, pageSize: 50, keyword: keyword || undefined });
        if (res.code === 200 && res.data) {
          setItems(res.data.list.map((n) => ({
            id: n.id,
            title: n.title,
            meta: n.folderName || (n.wordCount ? `${n.wordCount} 字` : undefined),
          })));
        }
      } else if (sourceType === 'KB_FILE' && activeKbId) {
        const res = await knowledgeBaseService.listFiles(activeKbId, {
          q: keyword || undefined, pageSize: 50, status: 'SUCCEEDED',
        });
        if (res.code === 200 && res.data) {
          setItems(res.data.items.map((f) => ({
            id: f.id,
            title: f.title || f.filename || `文件 #${f.id}`,
            meta: `${f.chunkCount ?? 0} 段`,
          })));
        }
      } else {
        setItems([]);
      }
    } catch (err) {
      logger.error('加载来源列表失败:', err);
      setItems([]);
    } finally {
      setListLoading(false);
    }
  }, [sourceType, keyword, activeKbId]);

  // 知识库列表（进入 KB tab 时拉取一次）。
  const loadKbs = useCallback(async () => {
    try {
      const res = await knowledgeBaseService.list({ kind: 'CUSTOM' });
      if (res.code === 200 && res.data) {
        const customKbs = res.data.filter((k) => k.kind === 'CUSTOM');
        setKbs(customKbs);
        setActiveKbId((prev) => (
          customKbs.some((k) => k.id === prev) ? prev : customKbs[0]?.id ?? null
        ));
      }
    } catch (err) {
      logger.error('加载知识库失败:', err);
    }
  }, []);

  useEffect(() => {
    if (view !== 'import') return;
    if (sourceType === 'KB_FILE' && kbs.length === 0) {
      loadKbs();
    }
  }, [view, sourceType, kbs.length, loadKbs]);

  useEffect(() => {
    if (view !== 'import') return;
    // KB 模式需要先选中某个库。
    if (sourceType === 'KB_FILE' && !activeKbId) return;
    const t = setTimeout(loadSources, 250);
    return () => clearTimeout(t);
  }, [view, sourceType, keyword, activeKbId, loadSources]);

  const kbOptions: SelectOption[] = useMemo(
    () => kbs.map((k) => ({ value: String(k.id), label: k.name })),
    [kbs],
  );

  const handleGenerate = async () => {
    if (!selectedId) return;
    setGenerating(true);
    setFeedback(null);
    try {
      const res = await readingBookService.generate({
        sourceType,
        sourceId: selectedId,
        theme: theme as 'paper' | 'sepia' | 'night',
      });
      if (res.code === 200 && res.data) {
        setFeedback({ type: 'ok', msg: `《${res.data.title}》已生成，可直接打开阅读。` });
        await loadShelf();
      } else {
        setFeedback({ type: 'err', msg: res.message || '生成失败' });
      }
    } catch (err) {
      logger.error('生成拟真阅读失败:', err);
      const msg = err instanceof Error ? err.message : '生成失败';
      setFeedback({ type: 'err', msg });
    } finally {
      setGenerating(false);
    }
  };

  const renderBookCard = (b: ReadingBookListItem) => {
    const cover = coverForTheme(b.theme);
    const regenerating = regeneratingIds.has(b.id);
    const ready = b.status === 'READY';
    return (
      <div key={b.id} className="group flex flex-col gap-2">
        {/* 书封：主题纸色 + 书脊 + 书口纸线 */}
        <div
          className={cn(
            'relative aspect-[3/4] overflow-hidden rounded-r-lg rounded-l-[3px]',
            'shadow-[0_10px_24px_-12px_rgba(0,0,0,0.4)] transition-all duration-200 ease-out',
            'group-hover:-translate-y-1 group-hover:shadow-[0_18px_34px_-14px_rgba(0,0,0,0.5)]',
            regenerating && 'animate-pulse',
          )}
          style={{ background: cover.bg }}
        >
          {/* 书脊 */}
          <div
            className="absolute inset-y-0 left-0 w-[7px]"
            style={{
              background: `linear-gradient(90deg, ${cover.edge}, transparent 90%)`,
              boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.28)',
            }}
          />
          {/* 书口纸线 */}
          <div
            className="absolute inset-y-1 right-0 w-[5px] opacity-70"
            style={{
              background: `repeating-linear-gradient(90deg, ${cover.edge} 0 1px, transparent 1px 2.5px)`,
            }}
          />
          {/* 顶部柔光 */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/25 via-transparent to-black/10" />

          <div className="relative flex h-full flex-col items-center justify-between px-4 pb-3 pt-5 text-center">
            <span
              className="font-mono text-[9px] uppercase tracking-[0.2em]"
              style={{ color: cover.ink, opacity: 0.55 }}
            >
              {cover.label}
            </span>
            <span
              className="line-clamp-4 text-sm font-semibold leading-relaxed"
              style={{ color: cover.ink, fontFamily: COVER_SERIF }}
            >
              {b.title}
            </span>
            <span className="font-mono text-[10px] tabular-nums" style={{ color: cover.ink, opacity: 0.6 }}>
              {b.wordCount} 字 · {b.readingTime} 分钟
            </span>
          </div>

          {b.status !== 'READY' && (
            <span
              className={cn(
                'absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-medium',
                b.status === 'FAILED'
                  ? 'bg-[var(--signal-danger)]/15 text-[var(--signal-danger)]'
                  : 'bg-[var(--signal-warn)]/15 text-[var(--signal-warn)]',
              )}
            >
              {b.status === 'FAILED' ? '生成失败' : '生成中'}
            </span>
          )}
        </div>

        {/* 元信息 + 操作 */}
        <div className="min-w-0">
          <p className="truncate text-xs text-[var(--ink-muted)]">{b.sourceRef || b.sourceType}</p>
        </div>
        <div className="flex items-center gap-1">
          {confirmDeleteId === b.id ? (
            <>
              <button
                type="button"
                onClick={() => handleDelete(b.id)}
                className="flex-1 rounded-md px-2 py-1.5 text-xs font-medium text-[var(--signal-danger)] transition hover:bg-[var(--signal-danger)]/10"
              >
                确认删除
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 rounded-md px-2 py-1.5 text-xs text-[var(--ink-muted)] transition hover:bg-[var(--bg-raised)]"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <a
                href={ready ? readerLaunchUrl(b.slug) : undefined}
                target="_blank"
                rel="noreferrer"
                title="打开阅读"
                aria-disabled={!ready}
                className={cn(
                  'inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs transition',
                  ready
                    ? 'text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]'
                    : 'cursor-not-allowed text-[var(--ink-muted)] opacity-50',
                )}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                打开
              </a>
              <button
                type="button"
                disabled={regenerating}
                onClick={() => handleRegenerate(b)}
                title="重新生成（内容更新后刷新成书缓存）"
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs text-[var(--ink-muted)] transition hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {regenerating ? '生成中' : '重制'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(b.id)}
                title="删除"
                className="inline-flex items-center justify-center rounded-md p-1.5 text-[var(--signal-danger)] transition hover:bg-[var(--signal-danger)]/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="拟真阅读" size="xl">
      {view === 'shelf' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--ink-muted)]">
              将文章、学习笔记或知识库文件转换为可翻页的拟真书籍。生成后缓存成书格式，下次直接打开无需重新渲染。
            </p>
            <button
              type="button"
              onClick={goImport}
              data-interactive
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[var(--aurora-1)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" />
              新建拟真阅读
            </button>
          </div>

          {shelfError && (
            <div className="rounded-lg bg-[var(--signal-danger)]/10 px-3 py-2 text-sm text-[var(--signal-danger)]">
              {shelfError}
            </div>
          )}

          {shelfLoading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex flex-col gap-2">
                  <div className="aspect-[3/4] animate-pulse rounded-r-lg rounded-l-[3px] bg-[var(--bg-raised)]" />
                  <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--bg-raised)]" />
                  <div className="h-6 animate-pulse rounded bg-[var(--bg-raised)]" />
                </div>
              ))}
            </div>
          ) : books.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--ink-muted)]/30 py-14 text-center">
              <BookOpen className="h-10 w-10 text-[var(--ink-muted)]" />
              <p className="text-sm text-[var(--ink-muted)]">书架还空着，点击「新建拟真阅读」放上第一本书。</p>
            </div>
          ) : (
            <div className="grid max-h-[56vh] grid-cols-2 gap-x-4 gap-y-5 overflow-y-auto p-1 pr-2 sm:grid-cols-3 md:grid-cols-4">
              {books.map(renderBookCard)}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setView('shelf')}
            className="inline-flex items-center gap-1 text-sm text-[var(--ink-muted)] transition hover:text-[var(--ink-primary)]"
          >
            <ChevronLeft className="h-4 w-4" />
            返回书架
          </button>

          {/* 来源选项卡 */}
          <div className="flex gap-2">
            {SOURCE_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = sourceType === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setSourceType(tab.key);
                    setSelectedId(null);
                    setItems([]);
                    setKeyword('');
                  }}
                  className={cn(
                    'inline-flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition',
                    active
                      ? 'border-[var(--aurora-1)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)]'
                      : 'border-[var(--ink-muted)]/20 text-[var(--ink-muted)] hover:border-[var(--ink-muted)]/40',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* 知识库二级选择 */}
          {sourceType === 'KB_FILE' && (
            <Select
              value={activeKbId ? String(activeKbId) : ''}
              onValueChange={(v) => setActiveKbId(v ? Number(v) : null)}
              options={kbOptions}
              placeholder="选择知识库"
              fullWidth
              ariaLabel="选择知识库"
            />
          )}

          {/* 搜索 */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索标题"
              className="h-10 w-full rounded-lg border border-[var(--ink-muted)]/20 bg-[var(--bg-leaf)] pl-9 pr-3 text-sm text-[var(--ink-primary)] outline-none focus:border-[var(--aurora-1)]"
            />
          </div>

          {/* 来源列表 */}
          <div className="max-h-[34vh] min-h-[12rem] space-y-1 overflow-y-auto rounded-lg border border-[var(--ink-muted)]/15 p-1">
            {listLoading ? (
              <div className="space-y-1 p-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-3 rounded-md px-3 py-2">
                    <span className="h-5 w-5 shrink-0 animate-pulse rounded-full bg-[var(--bg-raised)]" />
                    <span
                      className="h-4 animate-pulse rounded bg-[var(--bg-raised)]"
                      style={{ width: `${62 - (i % 3) * 14}%` }}
                    />
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-[var(--ink-muted)]">
                {sourceType === 'KB_FILE' && !activeKbId ? '请先选择知识库' : '没有可选内容'}
              </div>
            ) : (
              items.map((it) => {
                const active = selectedId === it.id;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setSelectedId(it.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition',
                      active ? 'bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]' : 'hover:bg-[var(--bg-raised)]',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                        active
                          ? 'border-[var(--aurora-1)] bg-[var(--aurora-1)] text-white'
                          : 'border-[var(--ink-muted)]/40',
                      )}
                    >
                      {active && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-[var(--ink-primary)]">{it.title}</span>
                      {it.meta && <span className="block truncate text-xs text-[var(--ink-muted)]">{it.meta}</span>}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {feedback && (
            <div
              className={cn(
                'rounded-lg px-3 py-2 text-sm',
                feedback.type === 'ok'
                  ? 'bg-[var(--signal-success)]/10 text-[var(--signal-success)]'
                  : 'bg-[var(--signal-danger)]/10 text-[var(--signal-danger)]',
              )}
            >
              {feedback.msg}
            </div>
          )}

          {/* 底部操作 */}
          <div className="flex items-center justify-between gap-3 border-t border-[var(--ink-muted)]/15 pt-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--ink-muted)]">阅读主题</span>
              <Select value={theme} onValueChange={setTheme} options={THEME_OPTIONS} size="sm" ariaLabel="阅读主题" />
            </div>
            <button
              type="button"
              disabled={!selectedId || generating}
              onClick={handleGenerate}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg bg-[var(--aurora-1)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
                generating && 'animate-pulse',
              )}
            >
              <RefreshCw className="h-4 w-4" />
              {generating ? '生成中…' : '导入并生成'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
