'use client';

import { forwardRef, memo, useImperativeHandle, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ease } from '@aetherblog/ui';
import {
  BookMarked,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  FileText,
  Lightbulb,
  Quote,
  ShieldAlert,
  StickyNote,
} from 'lucide-react';
import type {
  AgentRetrievalHitKind,
  AgentRetrievalReceipt,
} from '../../lib/agentChatStream';

/**
 * RetrievalReceipt —— 知识检索回执卡（回答编排的可视化）
 *
 * 时间线事实：后端先检索、后作答，`retrieval` 事件先于首个 delta 抵达。
 * 因此回执渲染在回答正文上方 —— 视觉顺序与执行顺序一致，用户在等待首字时
 * 就能看到"检索到了什么"。
 *
 * 视觉：aurora-2（violet）是知识体系的专属点色（与对话主光源 aurora-1 区分），
 * 状态语义用 signal-*。收起态是一行 pill：状态图标 + 结论 + 命中数 + chevron；
 * 展开态是编号命中列表（kind 徽标 / 标题 / 来源 / snippet / 相关度）+ warnings。
 *
 * 每个命中 li 带 `id=cite-{messageId}-{rank}` 锚点 —— 正文里的 [n] 引用标记
 * 由 MessageBubble 链接到这里（点击展开 + 平滑滚动 + 高亮脉冲）。
 */

export interface RetrievalReceiptHandle {
  /** 展开列表并高亮指定 rank 的命中（供内联引用标记点击联动）。 */
  reveal: (rank: number) => void;
}

interface Props {
  receipt: AgentRetrievalReceipt;
  /** 供内联引用锚点使用的消息 id。 */
  messageId: string;
  /** admin 角色才允许跳转 /admin/ 开头的 href（普通读者点了只会撞登录墙）。 */
  allowAdminHref?: boolean;
}

const HIT_KIND_META: Record<
  AgentRetrievalHitKind,
  { label: string; icon: typeof BookMarked }
> = {
  knowledge_base_chunk: { label: '知识库', icon: BookMarked },
  atlas_note: { label: '笔记', icon: StickyNote },
  atlas_knowledge_point: { label: '知识点', icon: Lightbulb },
  atlas_evidence: { label: '原文证据', icon: Quote },
};

function statusPresentation(receipt: AgentRetrievalReceipt): {
  tone: 'success' | 'warning' | 'danger';
  title: string;
} {
  const n = receipt.hits.length;
  switch (receipt.status) {
    case 'matched':
      return { tone: 'success', title: `已核对 ${n} 条知识依据` };
    case 'partial':
      return { tone: 'warning', title: `找到 ${n} 条依据 · 部分来源未完成` };
    case 'empty':
      return { tone: 'warning', title: '知识库中未命中相关内容' };
    case 'unavailable':
      return { tone: 'danger', title: '知识来源暂时不可用' };
  }
}

function formatScore(score: number | undefined): string | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (score >= 0 && score <= 1) return `${Math.round(score * 100)}%`;
  return score.toFixed(2);
}

function safeHref(href: string | undefined, allowAdmin: boolean): string | null {
  if (!href || href.startsWith('//')) return null;
  if (href.startsWith('/posts/')) return href;
  if (allowAdmin && href.startsWith('/admin/')) return href;
  return null;
}

const TONE_STYLES = {
  success: {
    dot: 'bg-[var(--signal-success)]',
    text: 'text-[var(--ink-secondary)]',
  },
  warning: {
    dot: 'bg-[var(--signal-warn)]',
    text: 'text-[color-mix(in_oklch,var(--signal-warn)_72%,var(--ink-primary))]',
  },
  danger: {
    dot: 'bg-[var(--signal-danger)]',
    text: 'text-[color-mix(in_oklch,var(--signal-danger)_72%,var(--ink-primary))]',
  },
} as const;

const RetrievalReceipt = forwardRef<RetrievalReceiptHandle, Props>(function RetrievalReceipt(
  { receipt, messageId, allowAdminHref = false },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [flashRank, setFlashRank] = useState<number | null>(null);
  const presentation = statusPresentation(receipt);
  const tone = TONE_STYLES[presentation.tone];
  const hasDetails = receipt.hits.length > 0 || receipt.warnings.length > 0;
  const kbCount = receipt.requested.knowledgeBaseIds.length;

  useImperativeHandle(ref, () => ({
    reveal: (rank: number) => {
      setOpen(true);
      // 等展开动画把 li 放进布局后再滚动 + 高亮脉冲。
      window.setTimeout(() => {
        const el = document.getElementById(`cite-${messageId}-${rank}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setFlashRank(rank);
        window.setTimeout(() => setFlashRank((v) => (v === rank ? null : v)), 1600);
      }, 240);
    },
  }));

  return (
    <section
      className="mb-2.5 w-full overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--aurora-2)_20%,transparent)] bg-[color-mix(in_oklch,var(--aurora-2)_5%,transparent)]"
      aria-live="polite"
      aria-label="知识检索回执"
    >
      <button
        type="button"
        onClick={() => hasDetails && setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!hasDetails}
        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
          hasDetails ? 'cursor-pointer hover:bg-[color-mix(in_oklch,var(--aurora-2)_7%,transparent)]' : 'cursor-default'
        }`}
      >
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[color-mix(in_oklch,var(--aurora-2)_14%,transparent)] text-[var(--aurora-2)]"
          aria-hidden="true"
        >
          <BookMarked className="h-3.5 w-3.5" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${tone.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden="true" />
            {presentation.title}
          </span>
          {kbCount > 0 && (
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)] tnum">
              {kbCount} 库
            </span>
          )}
        </span>
        {hasDetails && (
          <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            依据
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && hasDetails && (
          <motion.div
            key="receipt-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: ease.out }}
            className="overflow-hidden"
          >
            <div className="border-t border-[color-mix(in_oklch,var(--aurora-2)_14%,transparent)] px-3 py-2.5">
              {receipt.hits.length > 0 && (
                <ol className="space-y-2.5">
                  {receipt.hits.map((hit) => {
                    const meta = HIT_KIND_META[hit.kind];
                    const KindIcon = meta.icon;
                    const score = formatScore(hit.score);
                    const href = safeHref(hit.href, allowAdminHref);
                    const flashing = flashRank === hit.rank;
                    return (
                      <li
                        key={hit.key}
                        id={`cite-${messageId}-${hit.rank}`}
                        className={`grid scroll-mt-24 grid-cols-[1.4rem_minmax(0,1fr)] gap-2 rounded-lg px-1 py-0.5 transition-colors duration-500 ${
                          flashing ? 'bg-[color-mix(in_oklch,var(--aurora-2)_12%,transparent)]' : ''
                        }`}
                      >
                        <span className="pt-0.5 text-center font-mono text-[10px] text-[color-mix(in_oklch,var(--aurora-2)_80%,var(--ink-muted))] tnum">
                          {String(hit.rank).padStart(2, '0')}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="inline-flex items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--aurora-2)_22%,transparent)] bg-[color-mix(in_oklch,var(--aurora-2)_8%,transparent)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[color-mix(in_oklch,var(--aurora-2)_86%,var(--ink-secondary))]">
                              <KindIcon className="h-2.5 w-2.5" aria-hidden="true" />
                              {meta.label}
                            </span>
                            {href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-w-0 items-center gap-1 truncate text-[12.5px] font-medium text-[var(--ink-primary)] transition-colors hover:text-[var(--aurora-2)]"
                              >
                                <span className="truncate">{hit.title}</span>
                                <ExternalLink className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
                              </a>
                            ) : (
                              <span className="truncate text-[12.5px] font-medium text-[var(--ink-primary)]">
                                {hit.title}
                              </span>
                            )}
                            {score && (
                              <span
                                className="ml-auto inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-[var(--ink-muted)] tnum"
                                title="语义相关度"
                              >
                                <span
                                  aria-hidden="true"
                                  className="h-[3px] w-8 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]"
                                >
                                  <span
                                    className="block h-full rounded-full bg-[color-mix(in_oklch,var(--aurora-2)_75%,transparent)]"
                                    style={{
                                      width: `${Math.round(
                                        Math.min(1, Math.max(0, hit.score ?? 0)) * 100,
                                      )}%`,
                                    }}
                                  />
                                </span>
                                {score}
                              </span>
                            )}
                          </div>
                          {hit.sourceTitle && hit.sourceTitle !== hit.title && (
                            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--ink-muted)]">
                              <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="truncate">来自 {hit.sourceTitle}</span>
                            </p>
                          )}
                          {hit.snippet && (
                            <p className="agent-receipt-snippet mt-1 text-[11.5px] leading-[1.6] text-[var(--ink-secondary)]">
                              {hit.snippet}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}

              {receipt.warnings.length > 0 && (
                <ul className={`space-y-1.5 ${receipt.hits.length > 0 ? 'mt-2.5 border-t border-[var(--ink-subtle)]/12 pt-2.5' : ''}`}>
                  {receipt.warnings.map((w, i) => (
                    <li
                      key={`${w.scope}-${w.code}-${i}`}
                      className="flex items-start gap-1.5 text-[11px] leading-snug text-[color-mix(in_oklch,var(--signal-warn)_78%,var(--ink-secondary))]"
                    >
                      {w.code === 'unavailable' ? (
                        <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      ) : (
                        <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      )}
                      <span className="min-w-0">
                        <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] opacity-75">
                          {w.scope}
                        </span>{' '}
                        {w.message}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
});

/** receipt 是一次性快照（流开头写入后不再变化），memo 按引用比较即可。 */
export default memo(RetrievalReceipt);
