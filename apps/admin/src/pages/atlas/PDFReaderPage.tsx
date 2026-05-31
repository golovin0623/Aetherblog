// Atlas P1-02/P1-05 — PDF text-layer reader with PageRect jump-back.
//
// 路由: /atlas/reader/pdf/:carrierId
// PDF 原文件由 media_files 管理；本页读取已抽取并持久化的页级文本层，
// 用 TextQuote + TextPosition + PageRectSelector 创建可审计标注。

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Highlighter, LocateFixed, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import type {
  AtlasAnnotation,
  AtlasCarrier,
  AtlasCarrierTextLayer,
  AtlasCarrierTextPage,
  FragmentSelector,
  PageRectSelector,
  TextQuoteSelector,
} from '@aetherblog/types';

import { Skeleton } from '@/components/ui/skeleton';
import { atlasService } from '@/services/atlasService';
import { cn, extractApiErrorMessage } from '@/lib/utils';
import { buildSelectorsFromTextRange, validateSelectors } from './lib/selectors';

interface PDFReaderState {
  carrier: AtlasCarrier | null;
  layer: AtlasCarrierTextLayer | null;
  annotations: AtlasAnnotation[];
  loading: boolean;
  error: string | null;
}

type PageRect = { x: number; y: number; width: number; height: number };

interface PageRectTarget {
  page: number;
  rects: PageRect[];
  annotationId?: number;
}

const initial: PDFReaderState = {
  carrier: null,
  layer: null,
  annotations: [],
  loading: true,
  error: null,
};

const PDF_TEXT_LAYER_CONFORMS_TO = 'https://aetherblog.local/atlas/pdf-text-layer';

export default function PDFReaderPage() {
  const { carrierId: carrierIdParam } = useParams<{ carrierId: string }>();
  const carrierId = carrierIdParam ? Number(carrierIdParam) : 0;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<PDFReaderState>(initial);
  const [activeTarget, setActiveTarget] = useState<PageRectTarget | null>(null);
  const [generatingCarrierSuggestions, setGeneratingCarrierSuggestions] = useState(false);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!carrierId) {
      setState({ ...initial, loading: false, error: '无效的 PDF carrier ID' });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        setState((s) => ({ ...s, loading: true, error: null }));
        const [carrierRes, layerRes, annotationRes] = await Promise.all([
          atlasService.getCarrier(carrierId),
          atlasService.getCarrierTextLayer(carrierId),
          atlasService.listAnnotations(carrierId),
        ]);
        if (cancelled) return;
        setState({
          carrier: carrierRes.data,
          layer: layerRes.data,
          annotations: annotationRes.data ?? [],
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setState({ ...initial, loading: false, error: extractApiErrorMessage(err, '加载 PDF 文本层失败') });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [carrierId]);

  const pages = useMemo(() => normalisePages(state.layer), [state.layer]);

  const setPageRef = useCallback((page: number) => (node: HTMLDivElement | null) => {
    if (node) {
      pageRefs.current.set(page, node);
    } else {
      pageRefs.current.delete(page);
    }
  }, []);

  const jumpToPageRect = useCallback((target: PageRectTarget) => {
    setActiveTarget(target);
    window.requestAnimationFrame(() => {
      pageRefs.current.get(target.page)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, []);

  useEffect(() => {
    if (state.loading || !state.layer) return;
    const annotationId = Number(searchParams.get('annotationId'));
    if (Number.isFinite(annotationId) && annotationId > 0) {
      const annotation = state.annotations.find((item) => item.id === annotationId);
      const target = annotation ? pageRectTargetFromAnnotation(annotation) : null;
      if (target) {
        jumpToPageRect({ ...target, annotationId });
        return;
      }
    }

    const page = Number(searchParams.get('page'));
    const rects = parseRectParam(searchParams.get('rect'));
    if (Number.isFinite(page) && page > 0 && rects.length > 0) {
      jumpToPageRect({ page, rects });
    }
  }, [jumpToPageRect, searchParams, state.annotations, state.layer, state.loading]);

  const handleHighlight = useCallback(async () => {
    if (!state.carrier || !state.layer) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      toast.error('请先在 PDF 文本层中选中一段内容');
      return;
    }

    const range = selection.getRangeAt(0);
    const startPageEl = findPDFPageElement(range.startContainer);
    const endPageEl = findPDFPageElement(range.endContainer);
    if (!startPageEl || !endPageEl) {
      toast.error('选区不在 PDF 文本层内');
      return;
    }
    if (startPageEl !== endPageEl) {
      toast.error('暂不支持跨页 PDF 标注，请在单页内选择');
      return;
    }

    const pageNo = Number(startPageEl.dataset.atlasPdfPage);
    const page = pages.find((item) => item.page === pageNo);
    const textEl = startPageEl.querySelector<HTMLElement>('[data-atlas-pdf-page-text]');
    const surfaceEl = startPageEl.querySelector<HTMLElement>('[data-atlas-pdf-page-surface]');
    if (!page || !textEl || !surfaceEl) {
      toast.error('PDF 页文本层尚未就绪');
      return;
    }
    if (!textEl.contains(range.startContainer) || !textEl.contains(range.endContainer)) {
      toast.error('选区必须完全落在页文本层内');
      return;
    }

    const localStart = absoluteCharOffset(textEl, range.startContainer, range.startOffset);
    const localEnd = absoluteCharOffset(textEl, range.endContainer, range.endOffset);
    if (localEnd <= localStart) {
      toast.error('无法解析该选区位置');
      return;
    }

    const selectedText = page.text.slice(localStart, localEnd) || range.toString();
    if (!selectedText.trim()) {
      toast.error('不能标注空白内容');
      return;
    }

    let start = page.charStart + localStart;
    let end = page.charStart + localEnd;
    if (state.layer.text.slice(start, end) !== selectedText) {
      const fallbackStart = state.layer.text.indexOf(selectedText, Math.max(0, page.charStart - 4));
      if (fallbackStart >= 0) {
        start = fallbackStart;
        end = fallbackStart + selectedText.length;
      }
    }
    if (state.layer.text.slice(start, end) !== selectedText) {
      toast.error('选区与 PDF rootText 偏移不一致，无法创建稳定标注');
      return;
    }

    const base = buildSelectorsFromTextRange(state.layer.text, start, end);
    const rects = buildPageRectsFromRange(range, surfaceEl);
    const pageRect: PageRectSelector = { type: 'PageRectSelector', page: pageNo, rects };
    const fragment: FragmentSelector = {
      type: 'FragmentSelector',
      conformsTo: PDF_TEXT_LAYER_CONFORMS_TO,
      value: buildFragmentValue(pageNo, rects),
    };
    const selectors = [...base.selectors, pageRect, fragment];
    const valid = validateSelectors(selectors);
    if (!valid.ok) {
      toast.error(valid.reason ?? 'PDF 标注 selector 不完整');
      return;
    }

    try {
      const res = await atlasService.createAnnotation({
        carrierId: state.carrier.id,
        selectors,
        bodyType: 'highlight',
        bodyText: base.exact,
        bodyMeta: { source: 'pdf-text-layer', page: pageNo },
        anchorState: 'anchored',
        anchorScore: 1,
      });
      setState((s) => ({ ...s, annotations: [res.data, ...s.annotations] }));
      selection.removeAllRanges();
      setSearchParams({
        page: String(pageNo),
        rect: formatRectParam(rects),
        annotationId: String(res.data.id),
      });
      jumpToPageRect({ page: pageNo, rects, annotationId: res.data.id });
      toast.success('PDF 标注已创建');
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '创建 PDF 标注失败'));
    }
  }, [jumpToPageRect, pages, setSearchParams, state.carrier, state.layer]);

  const handleDelete = useCallback(async (annotationId: number) => {
    try {
      await atlasService.deleteAnnotation(annotationId);
      setState((s) => ({ ...s, annotations: s.annotations.filter((item) => item.id !== annotationId) }));
      if (activeTarget?.annotationId === annotationId) {
        setActiveTarget(null);
      }
      toast.success('标注已删除');
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '删除标注失败'));
    }
  }, [activeTarget?.annotationId]);

  const handleGenerateCarrierSuggestions = useCallback(async () => {
    if (!state.carrier) return;
    setGeneratingCarrierSuggestions(true);
    try {
      const res = await atlasService.generateCarrierSuggestions(state.carrier.id, { maxCandidates: 8 });
      const count = res.data?.length ?? 0;
      toast.success(count > 0 ? `已从全文生成 ${count} 条 AI 建议，前往 Inbox 处理` : 'AI 未生成可用建议');
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '生成全文 AI 建议失败'));
    } finally {
      setGeneratingCarrierSuggestions(false);
    }
  }, [state.carrier]);

  const handleJumpAnnotation = useCallback((annotation: AtlasAnnotation) => {
    const target = pageRectTargetFromAnnotation(annotation);
    if (!target) {
      toast.error('该标注缺少 PageRectSelector，无法定位到页内区域');
      return;
    }
    setSearchParams({
      page: String(target.page),
      rect: formatRectParam(target.rects),
      annotationId: String(annotation.id),
    });
    jumpToPageRect({ ...target, annotationId: annotation.id });
  }, [jumpToPageRect, setSearchParams]);

  if (state.loading) {
    return (
      <div className="grid h-[calc(100vh-4rem)] min-h-[640px] grid-cols-[minmax(0,1fr)_360px] gap-0">
        <div className="space-y-4 bg-[var(--bg-substrate)] p-6">
          <Skeleton className="h-10 w-72 rounded-lg bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-72 rounded-lg bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
          ))}
        </div>
        <aside className="space-y-3 border-l border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-lg bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
          ))}
        </aside>
      </div>
    );
  }

  if (state.error || !state.carrier || !state.layer) {
    return (
      <div className="space-y-4 p-6">
        <button
          type="button"
          onClick={() => navigate('/atlas')}
          className="inline-flex items-center gap-2 text-sm text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
        >
          <ArrowLeft className="h-4 w-4" /> 返回 Atlas
        </button>
        <div className="rounded-lg border border-[color-mix(in_oklch,var(--signal-danger)_30%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] p-4 text-sm text-[var(--ink-primary)]">
          {state.error ?? 'PDF 文本层加载失败'}
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
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
              PDF · carrier #{state.carrier.id} · {state.layer.pageCount} pages
            </p>
            <h1 className="truncate text-sm font-semibold text-[var(--ink-primary)]">{state.carrier.title}</h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={generatingCarrierSuggestions}
            onClick={() => void handleGenerateCarrierSuggestions()}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--aurora-2)_28%,transparent)] px-3 text-sm font-semibold text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-2)_10%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles className="h-4 w-4" /> {generatingCarrierSuggestions ? '生成中' : '全文 AI 建议'}
          </button>
          <button
            type="button"
            onClick={() => void handleHighlight()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] px-3 text-sm font-semibold text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_38%,transparent)]"
          >
            <Highlighter className="h-4 w-4" /> 标注选区
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <section className="min-h-0 flex-1 overflow-y-auto bg-[var(--bg-substrate)] px-5 py-5">
          {pages.length === 0 ? (
            <div className="rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-6 text-sm text-[var(--ink-secondary)]">
              当前 PDF 文本层没有可显示页面。
            </div>
          ) : (
            <div className="mx-auto max-w-5xl space-y-5">
              {pages.map((page) => (
                <PDFPage
                  key={page.page}
                  page={page}
                  annotations={state.annotations}
                  activeTarget={activeTarget}
                  setPageRef={setPageRef}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="w-[360px] shrink-0 overflow-y-auto border-l border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-4 py-4">
          <h2 className="mb-3 text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            PDF 标注 · {state.annotations.length}
          </h2>
          {state.annotations.length === 0 ? (
            <p className="text-xs text-[var(--ink-secondary)]">在页文本层里选中文本，点击右上角「标注选区」即可创建 PageRect 标注。</p>
          ) : (
            <ul className="space-y-2">
              {state.annotations.map((annotation) => {
                const target = pageRectTargetFromAnnotation(annotation);
                const quote = annotation.selectors.find((s) => s.type === 'TextQuoteSelector') as TextQuoteSelector | undefined;
                const isActive = activeTarget?.annotationId === annotation.id;
                return (
                  <li
                    key={annotation.id}
                    className={cn(
                      'rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] p-3 text-xs',
                      isActive && 'border-[color-mix(in_oklch,var(--aurora-1)_42%,transparent)]'
                    )}
                  >
                    <header className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-secondary)]">
                        {target ? `page ${target.page}` : annotation.anchorState}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--ink-muted)]">
                        score {annotation.anchorScore.toFixed(2)}
                      </span>
                    </header>
                    {quote ? (
                      <p className="line-clamp-3 text-[var(--ink-primary)]">
                        <span className="text-[var(--ink-muted)]">「</span>
                        {quote.exact}
                        <span className="text-[var(--ink-muted)]">」</span>
                      </p>
                    ) : null}
                    {annotation.bodyText ? (
                      <p className="mt-1 text-[var(--ink-secondary)]">{annotation.bodyText}</p>
                    ) : null}
                    <footer className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!target}
                        onClick={() => handleJumpAnnotation(annotation)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--aurora-1)_25%,transparent)] px-2 text-[10px] text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <LocateFixed className="h-3 w-3" /> 定位
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(annotation.id)}
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

function PDFPage({
  page,
  annotations,
  activeTarget,
  setPageRef,
}: {
  page: AtlasCarrierTextPage;
  annotations: AtlasAnnotation[];
  activeTarget: PageRectTarget | null;
  setPageRef: (page: number) => (node: HTMLDivElement | null) => void;
}) {
  const pageAnnotations = annotations
    .map((annotation) => ({ annotation, target: pageRectTargetFromAnnotation(annotation) }))
    .filter((item): item is { annotation: AtlasAnnotation; target: PageRectTarget } => item.target?.page === page.page);
  const activeRects = activeTarget?.page === page.page ? activeTarget.rects : [];

  return (
    <article
      ref={setPageRef(page.page)}
      data-atlas-pdf-page={page.page}
      className="overflow-hidden rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] shadow-sm"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Page {page.page}</span>
        <span className="font-mono text-[10px] text-[var(--ink-muted)]">
          chars {page.charStart}-{page.charEnd}
        </span>
      </header>
      <div data-atlas-pdf-page-surface className="relative">
        <pre
          data-atlas-pdf-page-text
          className="relative z-10 min-h-[220px] whitespace-pre-wrap break-words px-5 py-5 font-mono text-sm leading-7 text-[var(--ink-primary)]"
        >
          {page.text || ' '}
        </pre>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-20">
          {pageAnnotations.flatMap(({ annotation, target }) =>
            target.rects.map((rect, index) => (
              <span
                key={`${annotation.id}-${index}`}
                className="absolute rounded-sm bg-[color-mix(in_oklch,var(--aurora-2)_26%,transparent)] ring-1 ring-[color-mix(in_oklch,var(--aurora-2)_36%,transparent)]"
                style={rectStyle(rect)}
              />
            ))
          )}
          {activeRects.map((rect, index) => (
            <span
              key={`active-${index}`}
              className="absolute rounded-sm bg-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] ring-2 ring-[color-mix(in_oklch,var(--aurora-1)_72%,transparent)]"
              style={rectStyle(rect)}
            />
          ))}
        </div>
      </div>
    </article>
  );
}

function normalisePages(layer: AtlasCarrierTextLayer | null): AtlasCarrierTextPage[] {
  if (!layer) return [];
  if (layer.pages.length > 0) {
    return [...layer.pages].sort((a, b) => a.page - b.page);
  }
  if (!layer.text) return [];
  return [{ page: 1, text: layer.text, charStart: 0, charEnd: layer.text.length }];
}

function findPDFPageElement(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>('[data-atlas-pdf-page]') ?? null;
}

function absoluteCharOffset(root: HTMLElement, node: Node, offsetInNode: number): number {
  if (!root.contains(node) && node !== root) return 0;
  try {
    const range = document.createRange();
    range.setStart(root, 0);
    range.setEnd(node, offsetInNode);
    const text = range.toString();
    range.detach?.();
    return text.length;
  } catch {
    return 0;
  }
}

function buildPageRectsFromRange(range: Range, surface: HTMLElement): PageRect[] {
  const surfaceRect = surface.getBoundingClientRect();
  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      x: roundPercent(((rect.left - surfaceRect.left) / surfaceRect.width) * 100),
      y: roundPercent(((rect.top - surfaceRect.top) / surfaceRect.height) * 100),
      width: roundPercent((rect.width / surfaceRect.width) * 100),
      height: roundPercent((rect.height / surfaceRect.height) * 100),
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0);

  if (rects.length > 0) return rects;
  return [{ x: 0, y: 0, width: 100, height: 8 }];
}

function roundPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
}

function pageRectTargetFromAnnotation(annotation: AtlasAnnotation): PageRectTarget | null {
  const pageRect = annotation.selectors.find((selector) => selector.type === 'PageRectSelector') as PageRectSelector | undefined;
  if (pageRect && pageRect.page > 0 && pageRect.rects.length > 0) {
    return { page: pageRect.page, rects: pageRect.rects.map(normaliseRect).filter(Boolean) as PageRect[] };
  }

  const fragment = annotation.selectors.find((selector) => selector.type === 'FragmentSelector') as
    | (FragmentSelector & { page?: number; rects?: PageRect[] })
    | undefined;
  if (!fragment) return null;
  if (typeof fragment.page === 'number' && Array.isArray(fragment.rects) && fragment.rects.length > 0) {
    return { page: fragment.page, rects: fragment.rects.map(normaliseRect).filter(Boolean) as PageRect[] };
  }

  const params = new URLSearchParams(fragment.value);
  const page = Number(params.get('page'));
  const rects = parseRectParam(params.get('rect'));
  return Number.isFinite(page) && page > 0 && rects.length > 0 ? { page, rects } : null;
}

function normaliseRect(rect: PageRect): PageRect | null {
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
    return null;
  }
  return {
    x: roundPercent(rect.x),
    y: roundPercent(rect.y),
    width: roundPercent(rect.width),
    height: roundPercent(rect.height),
  };
}

function buildFragmentValue(page: number, rects: PageRect[]): string {
  return `page=${page}&rect=${encodeURIComponent(formatRectParam(rects))}`;
}

function formatRectParam(rects: PageRect[]): string {
  return rects
    .map((rect) => [rect.x, rect.y, rect.width, rect.height].map((value) => String(roundPercent(value))).join(','))
    .join(';');
}

function parseRectParam(raw: string | null): PageRect[] {
  if (!raw) return [];
  return raw
    .split(';')
    .map((chunk) => chunk.split(',').map((part) => Number(part)))
    .filter((values) => values.length === 4 && values.every(Number.isFinite))
    .map(([x, y, width, height]) => normaliseRect({ x, y, width, height }))
    .filter((rect): rect is PageRect => rect !== null && rect.width > 0 && rect.height > 0);
}

function rectStyle(rect: PageRect): CSSProperties {
  return {
    left: `${rect.x}%`,
    top: `${rect.y}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
  };
}
