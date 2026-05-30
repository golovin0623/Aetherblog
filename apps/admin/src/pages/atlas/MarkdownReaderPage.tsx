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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MarkdownPreview } from '@aetherblog/editor';
import { ArrowLeft, Brain, Highlighter, Sparkles, Trash2 } from 'lucide-react';
import { Modal, Select } from '@aetherblog/ui';
import { toast } from 'sonner';

import type {
  AtlasAnnotation,
  AtlasCarrier,
  AtlasKnowledgePointStatus,
  AtlasKnowledgePointType,
} from '@aetherblog/types';

import { atlasService } from '@/services/atlasService';
import { Skeleton } from '@/components/ui/skeleton';
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

type EvidenceRole = 'evidence' | 'definition' | 'example' | 'counter';

interface KPDraft {
  annotation: AtlasAnnotation;
  title: string;
  bodyMarkdown: string;
  type: AtlasKnowledgePointType;
  status: AtlasKnowledgePointStatus;
  confidence: number;
  evidenceRole: EvidenceRole;
  submitting: boolean;
}

const KP_TYPE_OPTIONS: Array<{ value: AtlasKnowledgePointType; label: string; description: string }> = [
  { value: 'claim', label: '主张', description: '可被证据支持或反驳的判断' },
  { value: 'concept', label: '概念', description: '稳定术语、主题或对象' },
  { value: 'question', label: '问题', description: '尚未回答或需要继续探索' },
  { value: 'definition', label: '定义', description: '对术语边界的解释' },
  { value: 'method', label: '方法', description: '可复用的流程或技术' },
  { value: 'example', label: '例子', description: '支撑理解的实例' },
  { value: 'person', label: '人物', description: '作者、研究者或相关人物' },
  { value: 'source', label: '来源', description: '可被引用的材料来源' },
];

const KP_STATUS_OPTIONS: Array<{ value: AtlasKnowledgePointStatus; label: string; description: string }> = [
  { value: 'seed', label: 'Seed', description: '刚提炼的种子知识点' },
  { value: 'growing', label: 'Growing', description: '仍在补证据和关系' },
  { value: 'evergreen', label: 'Evergreen', description: '相对稳定、可长期复用' },
  { value: 'archived', label: 'Archived', description: '暂不参与主图谱' },
];

const EVIDENCE_ROLE_OPTIONS: Array<{ value: EvidenceRole; label: string; description: string }> = [
  { value: 'evidence', label: '证据', description: '直接支撑该知识点' },
  { value: 'definition', label: '定义', description: '解释该知识点的边界' },
  { value: 'example', label: '例子', description: '作为说明性样例' },
  { value: 'counter', label: '反例', description: '对该知识点形成反向证据' },
];

export default function MarkdownReaderPage() {
  const { noteId: noteIdParam } = useParams<{ noteId: string }>();
  const navigate = useNavigate();
  const noteId = noteIdParam ? Number(noteIdParam) : 0;

  const [state, setState] = useState<ReaderState>(initial);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [kpDraft, setKpDraft] = useState<KPDraft | null>(null);
  const [generatingAnnotationId, setGeneratingAnnotationId] = useState<number | null>(null);

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

  const handleOpenKPDraft = useCallback((annotation: AtlasAnnotation) => {
      const quote = annotation.selectors.find((s) => s.type === 'TextQuoteSelector') as
        | import('@aetherblog/types').TextQuoteSelector
        | undefined;
      const exact = quote?.exact?.trim();
      if (!exact) {
        toast.error('该标注缺少 TextQuoteSelector，无法提炼为 KP');
        return;
      }
      const title = exact.length > 72 ? `${exact.slice(0, 72)}...` : exact;
      setKpDraft({
        annotation,
        title,
        bodyMarkdown: exact,
        type: 'claim',
        status: 'seed',
        confidence: 0.72,
        evidenceRole: 'evidence',
        submitting: false,
      });
    }, []);

  const handleSubmitKPDraft = useCallback(
    async () => {
      if (!kpDraft) return;
      const title = kpDraft.title.trim();
      const bodyMarkdown = kpDraft.bodyMarkdown.trim();
      if (!title) {
        toast.error('请填写 KP 标题');
        return;
      }
      if (kpDraft.confidence < 0 || kpDraft.confidence > 1) {
        toast.error('Confidence 必须在 0 到 1 之间');
        return;
      }
      setKpDraft((draft) => (draft ? { ...draft, submitting: true } : draft));
      try {
        const res = await atlasService.createKnowledgePoint({
          title,
          bodyMarkdown,
          type: kpDraft.type,
          status: kpDraft.status,
          confidence: kpDraft.confidence,
          provenance: 'user',
        });
        await atlasService.linkAnnotationToKP(res.data.id, kpDraft.annotation.id, kpDraft.evidenceRole);
        toast.success(`已提炼为 KP #${res.data.id}`);
        setKpDraft(null);
        navigate(`/atlas/kp/${res.data.id}`);
      } catch (err) {
        setKpDraft((draft) => (draft ? { ...draft, submitting: false } : draft));
        toast.error(extractApiErrorMessage(err, '提炼 KP 失败'));
      }
    },
    [kpDraft, navigate]
  );

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

  const handleGenerateAISuggestion = useCallback(async (annotation: AtlasAnnotation) => {
    setGeneratingAnnotationId(annotation.id);
    try {
      const res = await atlasService.generateAnnotationSuggestions(annotation.id, { maxCandidates: 3 });
      const count = res.data?.length ?? 0;
      toast.success(count > 0 ? `已生成 ${count} 条 AI 建议，前往 Inbox 处理` : 'AI 未生成可用建议');
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '生成 AI 建议失败'));
    } finally {
      setGeneratingAnnotationId(null);
    }
  }, []);

  const stateBadgeMap: Record<AtlasAnnotation['anchorState'], { label: string; cls: string }> = {
    anchored: { label: '已锚定', cls: 'bg-[color-mix(in_oklch,var(--signal-success)_20%,transparent)] text-[var(--signal-success)]' },
    soft_anchored: { label: '软锚定', cls: 'bg-[color-mix(in_oklch,var(--signal-warn)_22%,transparent)] text-[var(--signal-warn)]' },
    orphan: { label: '失锚', cls: 'bg-[color-mix(in_oklch,var(--signal-danger)_22%,transparent)] text-[var(--signal-danger)]' },
  };

  // 把锚定的 anchored / soft_anchored 标注渲染到 MarkdownPreview 的 DOM textContent 空间。
  const highlightedMarkdown = useMemo(() => {
    if (!state.note) return '';
    const text = state.note.contentMarkdown ?? '';
    return text;
  }, [state.note]);

  useLayoutEffect(() => {
    const root = previewRef.current;
    if (!root || state.loading || !state.note) return;
    unwrapAnnotationMarks(root);
    const fullText = root.textContent ?? '';
    const ranges = state.annotations
      .map((annotation) => {
        if (annotation.anchorState === 'orphan') return null;
        const outcome = anchor(fullText, annotation.selectors);
        if (outcome.start < 0 || outcome.end <= outcome.start || outcome.state === 'orphan') return null;
        return {
          id: annotation.id,
          start: outcome.start,
          end: outcome.end,
          state: annotation.anchorState === 'soft_anchored' || outcome.state === 'soft_anchored'
            ? 'soft_anchored'
            : 'anchored',
        } as const;
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => a.start - b.start || b.end - a.end);

    let cursor = -1;
    for (const range of ranges) {
      if (range.start < cursor) continue;
      wrapTextRange(root, range.start, range.end, range.id, range.state);
      cursor = range.end;
    }
  }, [state.annotations, state.loading, state.note]);

  if (state.loading) {
    return (
      <div className="grid h-[calc(100vh-4rem)] min-h-[640px] grid-cols-[minmax(0,1fr)_360px] gap-0">
        <div className="space-y-4 bg-[var(--bg-substrate)] p-6">
          <Skeleton className="h-10 w-64 rounded-lg bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
          <Skeleton className="h-96 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
          <Skeleton className="h-56 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
        </div>
        <aside className="space-y-3 border-l border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
          ))}
        </aside>
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
                      <button
                        type="button"
                        onClick={() => handleOpenKPDraft(a)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--aurora-1)_25%,transparent)] px-2 text-[10px] text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]"
                      >
                        <Brain className="h-3 w-3" /> 提炼 KP
                      </button>
                      <button
                        type="button"
                        disabled={generatingAnnotationId === a.id}
                        onClick={() => void handleGenerateAISuggestion(a)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--aurora-2)_25%,transparent)] px-2 text-[10px] text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-2)_10%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Sparkles className="h-3 w-3" /> AI 建议
                      </button>
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

      <Modal
        isOpen={Boolean(kpDraft)}
        onClose={() => {
          if (!kpDraft?.submitting) setKpDraft(null);
        }}
        title="提炼为知识点"
        size="lg"
      >
        {kpDraft && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmitKPDraft();
            }}
          >
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--ink-secondary)]">标题</span>
              <input
                value={kpDraft.title}
                onChange={(event) => setKpDraft((draft) => (draft ? { ...draft, title: event.target.value } : draft))}
                className="w-full rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[var(--bg-substrate)] px-3 py-2 text-sm text-[var(--ink-primary)] outline-none focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--ink-secondary)]">正文</span>
              <textarea
                value={kpDraft.bodyMarkdown}
                onChange={(event) => setKpDraft((draft) => (draft ? { ...draft, bodyMarkdown: event.target.value } : draft))}
                rows={6}
                className="w-full resize-none rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[var(--bg-substrate)] px-3 py-2 text-sm leading-6 text-[var(--ink-primary)] outline-none focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-[var(--ink-secondary)]">类型</span>
                <Select
                  value={kpDraft.type}
                  onValueChange={(next) => setKpDraft((draft) => (draft ? { ...draft, type: next as AtlasKnowledgePointType } : draft))}
                  options={KP_TYPE_OPTIONS}
                  ariaLabel="知识点类型"
                  size="sm"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-[var(--ink-secondary)]">状态</span>
                <Select
                  value={kpDraft.status}
                  onValueChange={(next) => setKpDraft((draft) => (draft ? { ...draft, status: next as AtlasKnowledgePointStatus } : draft))}
                  options={KP_STATUS_OPTIONS}
                  ariaLabel="知识点状态"
                  size="sm"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-[var(--ink-secondary)]">证据角色</span>
                <Select
                  value={kpDraft.evidenceRole}
                  onValueChange={(next) => setKpDraft((draft) => (draft ? { ...draft, evidenceRole: next as EvidenceRole } : draft))}
                  options={EVIDENCE_ROLE_OPTIONS}
                  ariaLabel="证据角色"
                  size="sm"
                />
              </label>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--ink-secondary)]">
                Confidence · {kpDraft.confidence.toFixed(2)}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={kpDraft.confidence}
                onChange={(event) => setKpDraft((draft) => (draft ? { ...draft, confidence: Number(event.target.value) } : draft))}
                className="w-full accent-[var(--aurora-1)]"
              />
            </label>

            <div className="rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] p-3 text-xs text-[var(--ink-secondary)]">
              Evidence annotation #{kpDraft.annotation.id} 会与新 KP 建立链接，role 使用上方选择的证据角色。
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={kpDraft.submitting}
                onClick={() => setKpDraft(null)}
                className="inline-flex h-9 items-center rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] px-3 text-xs text-[var(--ink-secondary)] hover:bg-[var(--bg-substrate)] disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={kpDraft.submitting}
                className="inline-flex h-9 items-center rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_32%,transparent)] px-3 text-xs font-semibold text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_42%,transparent)] disabled:opacity-60"
              >
                {kpDraft.submitting ? '创建中...' : '创建 KP'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function unwrapAnnotationMarks(root: HTMLElement) {
  const parents = new Set<Node>();
  root.querySelectorAll('mark[data-atlas-highlight]').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parents.add(parent);
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  });
  parents.forEach((node) => node.normalize());
}

function wrapTextRange(
  root: HTMLElement,
  start: number,
  end: number,
  annotationId: number,
  state: 'anchored' | 'soft_anchored'
) {
  if (start < 0 || end <= start) return;
  let offset = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!node.nodeValue || parent?.closest('mark[data-atlas-highlight]')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Array<{ node: Text; start: number; end: number }> = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const nodeStart = offset;
    const nodeEnd = nodeStart + (node.nodeValue?.length ?? 0);
    if (nodeEnd > start && nodeStart < end) {
      nodes.push({ node, start: nodeStart, end: nodeEnd });
    }
    offset = nodeEnd;
    if (offset >= end) break;
  }

  for (const entry of nodes) {
    const text = entry.node.nodeValue ?? '';
    const localStart = Math.max(0, start - entry.start);
    const localEnd = Math.min(text.length, end - entry.start);
    if (localEnd <= localStart) continue;

    const mark = document.createElement('mark');
    mark.dataset.atlasHighlight = String(annotationId);
    mark.className =
      state === 'soft_anchored'
        ? 'rounded bg-[color-mix(in_oklch,var(--signal-warn)_20%,transparent)] px-0.5 text-[var(--ink-primary)] ring-1 ring-inset ring-[color-mix(in_oklch,var(--signal-warn)_35%,transparent)]'
        : 'rounded bg-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] px-0.5 text-[var(--ink-primary)] ring-1 ring-inset ring-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)]';
    mark.textContent = text.slice(localStart, localEnd);

    const fragment = document.createDocumentFragment();
    if (localStart > 0) fragment.append(document.createTextNode(text.slice(0, localStart)));
    fragment.append(mark);
    if (localEnd < text.length) fragment.append(document.createTextNode(text.slice(localEnd)));
    entry.node.parentNode?.replaceChild(fragment, entry.node);
  }
}
