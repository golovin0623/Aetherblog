/**
 * AI 工具结果预览卡(Aether Codex)
 *
 * 选区 AI 工具(润色/总结)不再直接改写正文,而是先在此预览:
 * 原文与 AI 结果对照,由作者决定「替换选中 / 插入其后 / 复制 / 舍弃」。
 *
 * 签名时刻 #5:结果文字用 .ai-stream + .delta 按句分片 ink-bleed 入场
 * (墨水一滴一滴渗入纸张),等待态是骨架行(禁 spinner)。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Copy, CornerDownRight, RefreshCw, Replace, Sparkles, X } from 'lucide-react';
import { spring, transition, variants } from '@aetherblog/ui';
import { cn } from '@/lib/utils';

export type AiToolPreviewStatus = 'loading' | 'ok' | 'error';

export interface AiToolPreviewState {
  toolId: string;
  toolLabel: string;
  original: string;
  range: { from: number; to: number };
  status: AiToolPreviewStatus;
  result: string;
  error?: string;
}

interface AiResultPreviewProps {
  state: AiToolPreviewState;
  onApply: (mode: 'replace' | 'append') => void;
  onRetry: () => void;
  onClose: () => void;
}

/** ink-bleed 按句分片 —— 逐字符动画性能差,规范要求按句/块。 */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[。!?;\n.!?;])/).filter((chunk) => chunk.length > 0);
}

export function AiResultPreview({ state, onApply, onRetry, onClose }: AiResultPreviewProps) {
  const [copied, setCopied] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const chunks = useMemo(
    () => (state.status === 'ok' ? splitSentences(state.result) : []),
    [state.status, state.result]
  );

  // Esc 舍弃;结果就绪后聚焦主操作
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => {
    if (state.status === 'ok') primaryRef.current?.focus();
  }, [state.status]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(state.result);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center p-3 md:p-6">
      {/* 遮罩 */}
      <motion.div
        variants={variants.fade}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={transition.quick}
        onClick={onClose}
        className="absolute inset-0 bg-[color-mix(in_oklch,var(--ink-primary)_38%,transparent)] backdrop-blur-sm"
        aria-hidden="true"
      />

      <motion.div
        variants={variants.scaleIn}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={spring.soft}
        role="dialog"
        aria-modal="true"
        aria-label={`AI ${state.toolLabel}结果预览`}
        className="surface-overlay relative w-full max-w-xl max-h-[82vh] md:max-h-[76vh] !rounded-2xl flex flex-col overflow-hidden"
      >
        {/* 头部 */}
        <div className="flex items-center justify-between gap-2 px-4 h-12 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 text-[var(--aurora-1)] flex-shrink-0" />
            <h3 className="font-mono text-[var(--fs-micro)] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
              AI · {state.toolLabel}
            </h3>
            <span className="font-mono text-[10px] tabular-nums text-[var(--ink-subtle)]">
              {state.original.length} 字选区
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]"
            aria-label="关闭预览"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
          <section>
            <p className="font-mono text-[var(--fs-micro)] uppercase tracking-[0.16em] text-[var(--ink-subtle)] mb-1.5">
              原文
            </p>
            <div className="max-h-32 overflow-y-auto rounded-lg bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] px-3 py-2.5">
              <p className="text-[var(--fs-caption)] leading-[var(--lh-normal)] text-[var(--ink-muted)] whitespace-pre-wrap break-words">
                {state.original}
              </p>
            </div>
          </section>

          <section>
            <p className="font-mono text-[var(--fs-micro)] uppercase tracking-[0.16em] text-[var(--aurora-1)] mb-1.5">
              AI 结果
            </p>
            {state.status === 'loading' ? (
              <div className="space-y-2.5 py-1" role="status" aria-label="AI 处理中">
                {[92, 100, 76, 58].map((width, index) => (
                  <div
                    key={index}
                    className="h-4 rounded-md bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] animate-pulse"
                    style={{ width: `${width}%`, animationDelay: `${index * 120}ms` }}
                  />
                ))}
              </div>
            ) : state.status === 'error' ? (
              <div className="flex items-center gap-2 py-1">
                <span className="font-mono text-[var(--fs-micro)] tracking-[0.06em] text-[var(--signal-danger)]">
                  ERROR · {state.error ?? 'AI 处理失败'}
                </span>
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-md font-mono text-[var(--fs-micro)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  重试
                </button>
              </div>
            ) : (
              <div className="ai-stream whitespace-pre-wrap break-words">
                {chunks.map((chunk, index) => (
                  <span
                    key={index}
                    className="delta"
                    style={{ animationDelay: `${Math.min(index, 30) * 40}ms` }}
                  >
                    {chunk}
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* 操作 */}
        <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3.5 rounded-full text-[var(--fs-caption)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] transition-colors"
          >
            舍弃
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={state.status !== 'ok'}
            className={cn(
              'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[var(--fs-caption)] transition-colors',
              'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]',
              'hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]',
              'disabled:opacity-40 disabled:pointer-events-none'
            )}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[var(--signal-success)]" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? '已复制' : '复制'}
          </button>
          <button
            type="button"
            onClick={() => onApply('append')}
            disabled={state.status !== 'ok'}
            className={cn(
              'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[var(--fs-caption)] transition-colors',
              'border border-[color-mix(in_oklch,var(--aurora-1)_26%,transparent)] text-[var(--ink-primary)]',
              'hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]',
              'disabled:opacity-40 disabled:pointer-events-none'
            )}
          >
            <CornerDownRight className="w-3.5 h-3.5" />
            插入其后
          </button>
          <button
            ref={primaryRef}
            type="button"
            onClick={() => onApply('replace')}
            disabled={state.status !== 'ok'}
            className={cn(
              'inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-[var(--fs-caption)] font-medium transition-opacity',
              'bg-[var(--ink-primary)] text-[var(--bg-void)] hover:opacity-90',
              'disabled:opacity-40 disabled:pointer-events-none'
            )}
          >
            <Replace className="w-3.5 h-3.5" />
            替换选中
          </button>
        </div>
      </motion.div>
    </div>
  );
}
