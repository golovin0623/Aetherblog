import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, CircleAlert, ExternalLink, ShieldAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { AgentRetrievalReceipt } from '@aetherblog/agent-kit';
import {
  getRetrievalReceiptPresentation,
  retrievalHitKindLabel,
  safeRetrievalHref,
  type RetrievalReceiptTone,
} from './retrievalReceiptModel';

const TONE_STYLES: Record<
  RetrievalReceiptTone,
  { border: string; surface: string; icon: string; Icon: typeof CheckCircle2 }
> = {
  success: {
    border: 'border-[color-mix(in_oklch,var(--signal-success)_24%,var(--hub-border))]',
    surface: 'bg-[color-mix(in_oklch,var(--signal-success)_6%,var(--hub-control))]',
    icon: 'text-[var(--signal-success)]',
    Icon: CheckCircle2,
  },
  warning: {
    border: 'border-[color-mix(in_oklch,var(--signal-warn)_28%,var(--hub-border))]',
    surface: 'bg-[color-mix(in_oklch,var(--signal-warn)_7%,var(--hub-control))]',
    icon: 'text-[var(--signal-warn)]',
    Icon: CircleAlert,
  },
  danger: {
    border: 'border-[color-mix(in_oklch,var(--signal-danger)_26%,var(--hub-border))]',
    surface: 'bg-[color-mix(in_oklch,var(--signal-danger)_7%,var(--hub-control))]',
    icon: 'text-[var(--signal-danger)]',
    Icon: ShieldAlert,
  },
};

function formatScore(score: number | undefined): string | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (score >= 0 && score <= 1) return `${Math.round(score * 100)}%`;
  return score.toFixed(2);
}

export function RetrievalReceiptCard({
  receipt,
  messageId,
  spotlight,
}: {
  receipt: AgentRetrievalReceipt;
  /** 供正文引用标记 `[n]` 锚点定位（`#cite-{messageId}-{rank}`）。 */
  messageId?: string;
  /** 正文引用被点击时传入 —— 卡片自动展开并把该命中滚入视野高亮。
   *  nonce 保证连点同一个 [n] 也能重新触发定位。 */
  spotlight?: { rank: number; nonce: number } | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [flashRank, setFlashRank] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const detailsId = useId();
  const presentation = getRetrievalReceiptPresentation(receipt);
  const tone = TONE_STYLES[presentation.tone];
  const hasDetails = receipt.hits.length > 0 || receipt.warnings.length > 0;
  const Icon = tone.Icon;

  // 引用跳转：先展开，等折叠区渲染完成后再滚动 —— 直接锚点跳转会因为目标
  // 尚未挂载而落空，这也是不用原生 href 跳转的原因。
  useEffect(() => {
    if (!spotlight) return;
    setExpanded(true);
    setFlashRank(spotlight.rank);
    const raf = requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-cite-rank="${spotlight.rank}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    const timer = window.setTimeout(() => setFlashRank(null), 1600);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [spotlight]);

  return (
    <section
      className={cn('mt-3 overflow-hidden rounded-xl border', tone.border, tone.surface)}
      aria-live="polite"
      aria-label="知识检索回执"
    >
      <div className="flex min-h-11 items-start gap-2.5 px-3 py-2 sm:min-h-9">
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone.icon)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium leading-5 text-[var(--ink-primary)]">
            {presentation.title}
          </p>
          <p className="mt-0.5 text-[11.5px] leading-4 text-[var(--ink-muted)]">
            {presentation.detail}
          </p>
        </div>
        {hasDetails && (
          <button
            type="button"
            className="-mr-1 inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-[11.5px] font-medium text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] sm:min-h-8"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? '收起' : '查看依据'}
            <ChevronDown
              className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')}
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {expanded && hasDetails && (
        <div
          id={detailsId}
          className="border-t border-[color-mix(in_oklch,var(--hub-border)_72%,transparent)] px-3 py-2.5"
        >
          {receipt.hits.length > 0 && (
            <ol ref={listRef} className="space-y-2">
              {receipt.hits.map((hit) => {
                const score = formatScore(hit.score);
                const href = safeRetrievalHref(hit.href);
                return (
                  <li
                    key={hit.key}
                    id={messageId ? `cite-${messageId}-${hit.rank}` : undefined}
                    data-cite-rank={hit.rank}
                    className={cn(
                      'grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 rounded-lg transition-colors',
                      flashRank === hit.rank && 'hub-cite-flash',
                    )}
                  >
                    <span className="tnum pt-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
                      {hit.rank.toString().padStart(2, '0')}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="rounded-md border border-[var(--hub-border)] bg-[var(--hub-control)] px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--ink-muted)]">
                          {retrievalHitKindLabel(hit.kind)}
                        </span>
                        <span className="truncate text-[12px] font-medium text-[var(--ink-primary)]">
                          {hit.title}
                        </span>
                        {score && (
                          <span className="tnum font-mono text-[10.5px] text-[var(--ink-muted)]">
                            相关度 {score}
                          </span>
                        )}
                      </div>
                      {hit.sourceTitle && hit.sourceTitle !== hit.title && (
                        <p className="mt-1 text-[11px] text-[var(--ink-muted)]">来自 {hit.sourceTitle}</p>
                      )}
                      {hit.snippet && (
                        <p className="mt-1 line-clamp-3 text-[11.5px] leading-[1.55] text-[var(--ink-secondary)]">
                          {hit.snippet}
                        </p>
                      )}
                      {href && (
                        <a
                          href={href}
                          className="mt-1.5 inline-flex min-h-10 items-center gap-1 rounded-md text-[11.5px] font-medium text-[var(--aurora-1)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] sm:min-h-8"
                        >
                          打开来源 <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {receipt.warnings.length > 0 && (
            <ul
              className={cn(
                'space-y-1 text-[11.5px] leading-4 text-[var(--ink-secondary)]',
                receipt.hits.length > 0 && 'mt-2.5 border-t border-[var(--hub-border)] pt-2.5',
              )}
              aria-label="未完成的来源"
            >
              {receipt.warnings.map((warning) => (
                <li key={`${warning.scope}:${warning.code}`} className="flex gap-2">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--signal-warn)]" aria-hidden="true" />
                  <span>{warning.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
