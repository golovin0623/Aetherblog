// Atlas M2 — 图像描述阅读器。
//
// 路由: /atlas/reader/image/:carrierId
// Image carrier 的描述/OCR 文本由 POST /atlas/carriers/image 写入，并以 text layer
// 作为稳定锚定空间。这里展示原图和已保存文本，支持标注/AI 建议。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Highlighter, Image as ImageIcon, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import type {
  AtlasAnnotation,
  AtlasCarrier,
  AtlasCarrierTextLayer,
  FragmentSelector,
  TextQuoteSelector,
} from '@aetherblog/types';

import { Skeleton } from '@/components/ui/skeleton';
import { ATLAS_CARRIER_SUGGESTION_MAX_COST_USD, atlasService } from '@/services/atlasService';
import { extractApiErrorMessage } from '@/lib/utils';
import { anchor } from './lib/anchoring';
import { unwrapAnnotationMarks, wrapTextRange } from './lib/domHighlight';
import { buildSelectorsFromDomRange, validateSelectors } from './lib/selectors';

interface ImageReaderState {
  carrier: AtlasCarrier | null;
  layer: AtlasCarrierTextLayer | null;
  annotations: AtlasAnnotation[];
  loading: boolean;
  error: string | null;
}

const IMAGE_TEXT_LAYER_CONFORMS_TO = 'https://aetherblog.local/atlas/image-text-layer';

const initial: ImageReaderState = {
  carrier: null,
  layer: null,
  annotations: [],
  loading: true,
  error: null,
};

function formatAtlasCostUsd(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '费用未知';
  return `$${value.toFixed(value < 0.01 ? 6 : 4)}`;
}

export default function ImageReaderPage() {
  const { carrierId: carrierIdParam } = useParams<{ carrierId: string }>();
  const carrierId = carrierIdParam ? Number(carrierIdParam) : 0;
  const navigate = useNavigate();
  const [state, setState] = useState<ImageReaderState>(initial);
  const [generatingAnnotationId, setGeneratingAnnotationId] = useState<number | null>(null);
  const [generatingCarrierSuggestions, setGeneratingCarrierSuggestions] = useState(false);
  const textRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (!carrierId) {
      setState({ ...initial, loading: false, error: '无效的图片 carrier ID' });
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
        if (carrierRes.data.type !== 'image') {
          setState({ ...initial, loading: false, error: '该 carrier 不是图片描述' });
          return;
        }
        setState({
          carrier: carrierRes.data,
          layer: layerRes.data,
          annotations: annotationRes.data ?? [],
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setState({ ...initial, loading: false, error: extractApiErrorMessage(err, '加载图片描述失败') });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [carrierId]);

  const imageUrl = useMemo(() => {
    if (!state.carrier) return '';
    const metaUrl = typeof state.carrier.metadata?.fileUrl === 'string' ? state.carrier.metadata.fileUrl : '';
    return metaUrl || state.carrier.sourceUri;
  }, [state.carrier]);

  const handleHighlight = useCallback(async () => {
    if (!state.carrier || !state.layer) return;
    const root = textRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      toast.message('请先选中要标注的图片描述文本');
      return;
    }
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      toast.message('请在图片描述区域内选择文本');
      return;
    }
    if (!selection.toString().trim()) {
      toast.message('选中文本为空');
      return;
    }

    const fullText = root.textContent ?? state.layer.text;
    const built = buildSelectorsFromDomRange(range, fullText, root);
    if (!built) {
      toast.error('选区无法构造稳定选择器，请缩短选择范围后重试');
      return;
    }
    const fragment: FragmentSelector = {
      type: 'FragmentSelector',
      conformsTo: IMAGE_TEXT_LAYER_CONFORMS_TO,
      value: `source=${encodeURIComponent(state.carrier.sourceUri)}`,
    };
    const selectors = [...built.selectors, fragment];
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
        bodyText: built.exact,
        bodyMeta: { source: 'image-text-layer', imageUrl },
        anchorState: 'anchored',
        anchorScore: 1,
      });
      setState((s) => ({ ...s, annotations: [res.data, ...s.annotations] }));
      selection.removeAllRanges();
      toast.success('图片描述标注已创建');
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '创建图片描述标注失败'));
    }
  }, [imageUrl, state.carrier, state.layer]);

  const handleDelete = useCallback(async (annotationId: number) => {
    try {
      await atlasService.deleteAnnotation(annotationId);
      setState((s) => ({ ...s, annotations: s.annotations.filter((item) => item.id !== annotationId) }));
      toast.success('标注已删除');
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '删除标注失败'));
    }
  }, []);

  const handleGenerateAnnotationSuggestions = useCallback(async (annotation: AtlasAnnotation) => {
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

  const handleGenerateCarrierSuggestions = useCallback(async () => {
    if (!state.carrier) return;
    setGeneratingCarrierSuggestions(true);
    try {
      const payload = { maxCandidates: 8, maxCostUsd: ATLAS_CARRIER_SUGGESTION_MAX_COST_USD };
      const preview = await atlasService.previewCarrierSuggestions(state.carrier.id, payload);
      if (preview.data?.budgetExceeded) {
        toast.warning(
          `预估费用 ${formatAtlasCostUsd(preview.data.estimatedCostUsd)} 超过本次预算 ${formatAtlasCostUsd(preview.data.maxCostUsd)}，已取消生成`
        );
        return;
      }
      if (preview.data?.pricingMissing) {
        toast.warning('当前模型缺少全局价格配置，无法预估本次费用；将继续生成并保留预算上限');
      } else {
        toast.message(
          `本次预估 ${formatAtlasCostUsd(preview.data?.estimatedCostUsd)} / 上限 ${formatAtlasCostUsd(preview.data?.maxCostUsd)}`
        );
      }
      const res = await atlasService.generateCarrierSuggestions(state.carrier.id, payload);
      const count = res.data?.length ?? 0;
      toast.success(count > 0 ? `已从图片描述生成 ${count} 条 AI 建议，前往 Inbox 处理` : 'AI 未生成可用建议');
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '生成图片 AI 建议失败'));
    } finally {
      setGeneratingCarrierSuggestions(false);
    }
  }, [state.carrier]);

  useLayoutEffect(() => {
    const root = textRef.current;
    if (!root || state.loading || !state.layer) return;
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
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => a.start - b.start || b.end - a.end);

    let cursor = -1;
    for (const range of ranges) {
      if (range.start < cursor) continue;
      wrapTextRange(root, range.start, range.end, range.id, range.state);
      cursor = range.end;
    }
  }, [state.annotations, state.layer, state.loading]);

  if (state.loading) {
    return (
      <div className="grid h-[calc(100vh-4rem)] min-h-[640px] grid-cols-[minmax(0,1fr)_360px] gap-0">
        <div className="space-y-4 bg-[var(--bg-substrate)] p-6">
          <Skeleton className="h-10 w-80 rounded-lg bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
          <Skeleton className="h-[520px] rounded-lg bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
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
          {state.error ?? '图片描述加载失败'}
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
              Image · carrier #{state.carrier.id} · {state.layer.charCount} chars
            </p>
            <h1 className="truncate text-sm font-semibold text-[var(--ink-primary)]">{state.carrier.title}</h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {imageUrl ? (
            <a
              href={imageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-3 text-sm font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-substrate)] hover:text-[var(--ink-primary)]"
            >
              <ExternalLink className="h-4 w-4" /> 原图
            </a>
          ) : null}
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
          <article className="mx-auto max-w-5xl overflow-hidden rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] shadow-sm">
            <header className="flex items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] px-4 py-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Image text layer</span>
              <span className="font-mono text-[10px] text-[var(--ink-muted)]">{state.layer.storageUri}</span>
            </header>
            {imageUrl ? (
              <div className="border-b border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] bg-[var(--bg-substrate)] p-4">
                <img
                  src={imageUrl}
                  alt={state.carrier.title}
                  className="mx-auto max-h-[360px] max-w-full rounded-md object-contain"
                />
              </div>
            ) : (
              <div className="flex h-44 items-center justify-center border-b border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] bg-[var(--bg-substrate)] text-[var(--ink-muted)]">
                <ImageIcon className="h-10 w-10" />
              </div>
            )}
            <pre
              ref={textRef}
              data-atlas-image-reader
              className="min-h-[360px] whitespace-pre-wrap break-words px-5 py-5 font-mono text-sm leading-7 text-[var(--ink-primary)]"
            >
              {state.layer.text || ' '}
            </pre>
          </article>
        </section>

        <aside className="w-[360px] shrink-0 overflow-y-auto border-l border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-4 py-4">
          <h2 className="mb-3 text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            图片标注 · {state.annotations.length}
          </h2>
          {state.annotations.length === 0 ? (
            <p className="text-xs text-[var(--ink-secondary)]">暂无图片描述标注</p>
          ) : (
            <ul className="space-y-2">
              {state.annotations.map((annotation) => {
                const quote = annotation.selectors.find((s) => s.type === 'TextQuoteSelector') as TextQuoteSelector | undefined;
                return (
                  <li
                    key={annotation.id}
                    className="rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] p-3 text-xs"
                  >
                    <header className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-secondary)]">
                        {annotation.anchorState}
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
                        disabled={generatingAnnotationId === annotation.id}
                        onClick={() => void handleGenerateAnnotationSuggestions(annotation)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--aurora-2)_25%,transparent)] px-2 text-[10px] text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-2)_10%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Sparkles className="h-3 w-3" /> AI 建议
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
