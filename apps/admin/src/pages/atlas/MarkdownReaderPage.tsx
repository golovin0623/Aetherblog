// Atlas P1-04 + P1-08 — Markdown 阅读 + 标注视图
//
// 路由: /atlas/reader/note/:noteId
//
// 流程:
//   1. 路由参数 noteId → POST /atlas/carriers/markdown 懒创建 carrier
//   2. 拉取 carrier 详情 + 该 carrier 下所有 annotations
//   3. 渲染 markdown （reuse @aetherblog/editor MarkdownPreview）+ 在文本里高亮标注
//   4. 监听文本选区 → buildSelectorsFromTextRange → POST /atlas/annotations
//   5. 右侧栏列出所有标注，含三态徽章（anchored / soft_anchored / orphan）
//
// 红线 C1-3: UI 必走 @aetherblog/ui；本页直接用 lucide icons + 基础 div，
// 不重造组件，复杂组件（如 dialog）从既有页拷模式。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MarkdownPreview } from '@aetherblog/editor';
import { ArrowLeft, Highlighter, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import type { AtlasAnnotation, AtlasCarrier } from '@aetherblog/types';

import { atlasService } from '@/services/atlasService';
import { noteService } from '@/services/noteService';
import type { NoteDetail } from '@/types/note';
import { cn, extractApiErrorMessage } from '@/lib/utils';
import { buildSelectorsFromDomRange, validateSelectors } from './lib/selectors';
import { anchor } from './lib/anchoring';

interface ReaderState {
  note: NoteDetail | null;
  carrier: AtlasCarrier | null;
  annotations: AtlasAnnotation[];
  loading: boolean;
  error: string | null;
}

const initial: ReaderState = {
  note: null,
  carrier: null,
  annotations: [],
  loading: true,
  error: null,
};

export default function MarkdownReaderPage() {
  const { noteId: noteIdParam } = useParams<{ noteId: string }>();
  const navigate = useNavigate();
  const noteId = noteIdParam ? Number(noteIdParam) : 0;

  const [state, setState] = useState<ReaderState>(initial);
  const previewRef = useRef<HTMLDivElement | null>(null);

  // 拉数据
  useEffect(() => {
    if (!noteId) {
      setState({ ...initial, loading: false, error: '无效的笔记 ID' });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        setState((s) => ({ ...s, loading: true, error: null }));
        const [noteRes, carrierRes] = await Promise.all([
          noteService.getById(noteId),
          atlasService.ensureMarkdownCarrier(noteId),
        ]);
        if (cancelled) return;
        const carrier = carrierRes.data;
        const annoRes = await atlasService.listAnnotations(carrier.id);
        if (cancelled) return;
        setState({
          note: noteRes.data,
          carrier,
          annotations: annoRes.data ?? [],
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setState({ ...initial, loading: false, error: extractApiErrorMessage(err, '加载失败') });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  // 选中文本 → 抽取多选择器
  //
  // PR #724 review fix (Codex P1 #2): 过去用 fullText.indexOf(text) 取偏移会永远命中
  // 第一个相同子串；同一短语在文档中重复出现时所有标注都会落到第一处。
  // 现在改走 buildSelectorsFromDomRange + DOM Range API，从真实 DOM 选区计算字符偏移。
  // 锚定空间是「渲染后 textContent」而非 markdown 源——TextQuote prefix/suffix 仍然管用。
  const handleHighlight = useCallback(async () => {
    if (!state.carrier || !state.note) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      toast.message('请先选中要标注的文本');
      return;
    }
    const range = selection.getRangeAt(0);
    const root = previewRef.current;
    if (!root || !root.contains(range.commonAncestorContainer)) {
      toast.message('请在阅读区内选择文本');
      return;
    }
    const text = selection.toString();
    if (!text.trim()) {
      toast.message('选中文本为空');
      return;
    }

    const rootText = root.textContent ?? '';
    const built = buildSelectorsFromDomRange(range, rootText, root);
    if (!built) {
      toast.error('选区无法构造选择器（DOM 文本与渲染不一致），请缩短选择范围或重试');
      return;
    }

    // buildSelectorsFromDomRange 默认返回 TextQuote+TextPosition+CssSelector ≥3 个，
    // 已满足红线 C1-1；validateSelectors 二次兜底校验。
    const selectors = built.selectors;
    const valid = validateSelectors(selectors);
    if (!valid.ok) {
      toast.error(valid.reason || '选择器校验失败');
      return;
    }

    try {
      const res = await atlasService.createAnnotation({
        carrierId: state.carrier.id,
        selectors,
        bodyType: 'highlight',
        bodyText: null,
        bodyMeta: { color: 'aurora-1' },
        anchorState: 'anchored',
        anchorScore: 1,
      });
      setState((s) => ({ ...s, annotations: [...s.annotations, res.data] }));
      toast.success('已添加标注');
      selection.removeAllRanges();
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '创建标注失败'));
    }
  }, [state.carrier, state.note]);

  // 删除
  const handleDelete = useCallback(async (id: number) => {
    try {
      await atlasService.deleteAnnotation(id);
      setState((s) => ({ ...s, annotations: s.annotations.filter((a) => a.id !== id) }));
      toast.success('已删除标注');
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '删除失败'));
    }
  }, []);

  // 重新对齐（点击 orphan / soft 状态的 reanchor 按钮）
  //
  // PR #724 review fix (Codex P1, MarkdownReaderPage.tsx:164):
  //   过去把 state.note.contentMarkdown（raw markdown）传给 anchor()，
  //   但标注创建时锚定空间是渲染后 root.textContent（buildSelectorsFromDomRange）。
  //   markdown 语法 (`#`、`**`、链接 URL) 让 prefix/suffix/position 不对齐 → 误判 orphan
  //   或误锚到重复子串。客户端这里**直接读 DOM 的 textContent**最准确——live DOM 就是
  //   选择时的同一文本空间，比后端跑 markdown→plaintext 转换更不容易漂移。
  const handleReanchor = useCallback(
    async (annotation: AtlasAnnotation) => {
      if (!state.note) return;
      const root = previewRef.current;
      const fullText = root?.textContent ?? state.note.contentMarkdown ?? '';
      const outcome = anchor(fullText, annotation.selectors);
      if (outcome.state === 'orphan') {
        toast.error('文本中无法重新定位（已是 orphan）');
        return;
      }
      try {
        const res = await atlasService.updateAnnotation(annotation.id, {
          anchorState: outcome.state,
          anchorScore: outcome.score,
        });
        setState((s) => ({
          ...s,
          annotations: s.annotations.map((a) => (a.id === annotation.id ? res.data : a)),
        }));
        toast.success(
          outcome.state === 'anchored'
            ? `已重新对齐（score=${outcome.score.toFixed(2)}）`
            : `软对齐成功（score=${outcome.score.toFixed(2)}），请人工确认`
        );
      } catch (err) {
        toast.error(extractApiErrorMessage(err, '重对齐失败'));
      }
    },
    [state.note]
  );

  const stateBadgeMap: Record<AtlasAnnotation['anchorState'], { label: string; cls: string }> = {
    anchored: { label: '已锚定', cls: 'bg-[color-mix(in_oklch,var(--signal-success)_20%,transparent)] text-[var(--signal-success)]' },
    soft_anchored: { label: '软锚定', cls: 'bg-[color-mix(in_oklch,var(--signal-warn)_22%,transparent)] text-[var(--signal-warn)]' },
    orphan: { label: '失锚', cls: 'bg-[color-mix(in_oklch,var(--signal-danger)_22%,transparent)] text-[var(--signal-danger)]' },
  };

  // 把锚定的 anchored / soft_anchored 标注按 TextPosition 排序 + 渲染高亮
  const highlightedMarkdown = useMemo(() => {
    if (!state.note) return '';
    const text = state.note.contentMarkdown ?? '';
    // Phase 1 简化：不在 markdown 源里插入高亮 span（会破坏渲染）；
    // 高亮通过侧栏 + 选区呈现，正文保持原样。复杂的内嵌高亮留给 Phase 2 UI 改造。
    return text;
  }, [state.note]);

  if (state.loading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--ink-muted)]" />
      </div>
    );
  }

  if (state.error || !state.note || !state.carrier) {
    return (
      <div className="space-y-4 p-6">
        <button
          type="button"
          onClick={() => navigate('/atlas')}
          className="inline-flex items-center gap-2 text-sm text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
        >
          <ArrowLeft className="h-4 w-4" /> 返回 Atlas
        </button>
        <div className="rounded-xl border border-[color-mix(in_oklch,var(--signal-danger)_30%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] p-4 text-sm text-[var(--ink-primary)]">
          {state.error ?? '加载失败'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[640px] flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/atlas')}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--ink-muted)] hover:bg-[var(--bg-substrate)] hover:text-[var(--ink-primary)]"
            aria-label="返回"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">Markdown · carrier #{state.carrier.id}</p>
            <h1 className="truncate text-sm font-semibold text-[var(--ink-primary)]">{state.note.title}</h1>
          </div>
        </div>
        <button
          type="button"
          onClick={handleHighlight}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] px-3 text-sm font-semibold text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_38%,transparent)]"
        >
          <Highlighter className="h-4 w-4" /> 标注选区
        </button>
      </header>

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <section
          ref={previewRef}
          data-atlas-reader
          className="min-h-0 flex-1 overflow-y-auto bg-[var(--bg-substrate)] px-6 py-6"
        >
          <MarkdownPreview content={highlightedMarkdown} />
        </section>

        <aside className="w-[360px] shrink-0 overflow-y-auto border-l border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-4 py-4">
          <h2 className="mb-3 text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            标注 · {state.annotations.length}
          </h2>
          {state.annotations.length === 0 ? (
            <p className="text-xs text-[var(--ink-secondary)]">在正文里选中一段文本，点击右上角「标注选区」即可添加。</p>
          ) : (
            <ul className="space-y-2">
              {state.annotations.map((a) => {
                const badge = stateBadgeMap[a.anchorState];
                const quote = a.selectors.find((s) => s.type === 'TextQuoteSelector') as
                  | import('@aetherblog/types').TextQuoteSelector
                  | undefined;
                return (
                  <li
                    key={a.id}
                    className={cn(
                      'rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] p-3 text-xs',
                      a.anchorState === 'orphan' && 'border-[color-mix(in_oklch,var(--signal-danger)_25%,transparent)]'
                    )}
                  >
                    <header className="mb-1.5 flex items-center justify-between gap-2">
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]', badge.cls)}>
                        {badge.label}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--ink-muted)]">
                        score {a.anchorScore.toFixed(2)}
                      </span>
                    </header>
                    {quote && (
                      <p className="line-clamp-3 text-[var(--ink-primary)]">
                        <span className="text-[var(--ink-muted)]">「</span>
                        {quote.exact}
                        <span className="text-[var(--ink-muted)]">」</span>
                      </p>
                    )}
                    {a.bodyText && (
                      <p className="mt-1 text-[var(--ink-secondary)]">{a.bodyText}</p>
                    )}
                    <footer className="mt-2 flex items-center gap-2">
                      {a.anchorState !== 'anchored' && (
                        <button
                          type="button"
                          onClick={() => void handleReanchor(a)}
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-2 text-[10px] text-[var(--ink-primary)] hover:bg-[var(--bg-leaf)]"
                        >
                          重新对齐
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDelete(a.id)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--signal-danger)_25%,transparent)] px-2 text-[10px] text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)]"
                      >
                        <Trash2 className="h-3 w-3" /> 删除
                      </button>
                    </footer>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </main>
    </div>
  );
}
