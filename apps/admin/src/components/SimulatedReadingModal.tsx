import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen, FileText, NotebookPen, Library, Search, Loader2,
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

/** 拟真阅读器前台地址（与博客同源，位于站点根路径 /reader/:slug）。 */
function readerUrl(slug: string): string {
  return `/reader/${slug}`;
}

/**
 * SimulatedReadingModal —— 「拟真阅读」管理入口。
 * 提供两个视图：
 *   - shelf：已生成成书的书架（打开 / 重新生成 / 删除）
 *   - import：选择来源（文章 / 学习笔记 / 知识库文件）→ 导入生成成书缓存
 */
export function SimulatedReadingModal({ isOpen, onClose }: SimulatedReadingModalProps) {
  const [view, setView] = useState<View>('shelf');

  // ----- 书架 -----
  const [books, setBooks] = useState<ReadingBookListItem[]>([]);
  const [shelfLoading, setShelfLoading] = useState(false);

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
      loadShelf();
    }
  }, [isOpen, loadShelf]);

  const handleDelete = async (id: number) => {
    try {
      await readingBookService.delete(id);
      setBooks((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      logger.error('删除拟真阅读失败:', err);
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
      const res = await knowledgeBaseService.list();
      if (res.code === 200 && res.data) {
        setKbs(res.data);
        if (res.data.length > 0) setActiveKbId((prev) => prev ?? res.data[0].id);
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
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[var(--aurora-1)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" />
              新建拟真阅读
            </button>
          </div>

          {shelfLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-[var(--bg-raised)]" />
              ))}
            </div>
          ) : books.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--ink-muted)]/30 py-12 text-center">
              <BookOpen className="h-10 w-10 text-[var(--ink-muted)]" />
              <p className="text-sm text-[var(--ink-muted)]">还没有拟真阅读书籍，点击「新建拟真阅读」开始。</p>
            </div>
          ) : (
            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {books.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-3 rounded-lg border border-[var(--ink-muted)]/15 bg-[var(--bg-leaf)] p-3"
                >
                  <div className="flex h-12 w-9 shrink-0 items-center justify-center rounded bg-[var(--aurora-1)]/15 text-[var(--aurora-1)]">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--ink-primary)]">{b.title}</p>
                    <p className="truncate text-xs text-[var(--ink-muted)]">
                      {b.sourceRef || b.sourceType} · {b.wordCount} 字 · 约 {b.readingTime} 分钟
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <a
                      href={readerUrl(b.slug)}
                      target="_blank"
                      rel="noreferrer"
                      title="打开阅读"
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-[var(--aurora-1)] transition hover:bg-[var(--aurora-1)]/10"
                    >
                      <ExternalLink className="h-4 w-4" />
                      <span className="hidden sm:inline">打开</span>
                    </a>
                    <button
                      type="button"
                      onClick={() => handleDelete(b.id)}
                      title="删除"
                      className="inline-flex items-center rounded-md p-1.5 text-[var(--signal-danger)] transition hover:bg-[var(--signal-danger)]/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
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
                      ? 'border-[var(--aurora-1)] bg-[var(--aurora-1)]/10 text-[var(--aurora-1)]'
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
              onValueChange={(v) => setActiveKbId(Number(v))}
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
              <div className="flex h-40 items-center justify-center text-[var(--ink-muted)]">
                <Loader2 className="h-5 w-5 animate-spin" />
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
                      active ? 'bg-[var(--aurora-1)]/10' : 'hover:bg-[var(--bg-raised)]',
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
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--aurora-1)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {generating ? '生成中…' : '导入并生成'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
