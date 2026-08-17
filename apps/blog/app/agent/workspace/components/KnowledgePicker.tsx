'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BookMarked, Check, Library, Search, Sparkles } from 'lucide-react';
import { spring } from '@aetherblog/ui';
import PickerPopover from './PickerPopover';
import {
  isKbReady,
  useAgentKnowledgeBases,
  type AgentKnowledgeBase,
} from '../../lib/agentKbs';
import type { KnowledgeContextMode } from '../../lib/agentChatStream';

interface Props {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  mode: KnowledgeContextMode;
  selectedIds: Set<number>;
  onModeChange: (mode: KnowledgeContextMode) => void;
  /** 选择/取消选择一个 KB。父级负责隐含模式切换（选了 → selected；清空 → auto）。 */
  onToggleKb: (kb: AgentKnowledgeBase) => void;
}

const MODE_OPTIONS: ReadonlyArray<{
  value: KnowledgeContextMode;
  label: string;
  hint: string;
}> = [
  { value: 'auto', label: '自动', hint: '灵境自动在你的全部可用知识库中检索依据。' },
  { value: 'selected', label: '指定', hint: '只在下面勾选的知识库中检索。' },
  { value: 'none', label: '关闭', hint: '本轮对话不做知识检索，仅靠模型本身作答。' },
];

/**
 * 知识库选择器 —— 「知识检索」的控制面板
 *
 * 与 @ 文章 / # 标签的"素材引用"不同,知识库是检索编排的三态开关：
 *   auto     后端自动注入当前用户可用的知识库（默认，无感）
 *   selected 只用勾选的库（勾选任意一个即隐含切到该态）
 *   none     显式关闭检索
 *
 * 后端契约：auto = 请求省略 kbIds；selected = kbIds:[…]；none = kbIds:null。
 * CUSTOM 库无就绪索引（activeProfile 缺失或 chunkCount=0）时召回必然为空 ——
 * 列表里降级为"未就绪"且不可勾选，避免用户选了个空库还以为在检索。
 */
export default function KnowledgePicker({
  open,
  onClose,
  anchorRef,
  mode,
  selectedIds,
  onModeChange,
  onToggleKb,
}: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { items, loading, error } = useAgentKnowledgeBases(open, query);

  // SYSTEM_POSTS 优先、然后按 chunkCount 倒序 —— "最有料"的库靠前。
  const visible = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'SYSTEM_POSTS' ? -1 : 1;
      return (b.chunkCount ?? 0) - (a.chunkCount ?? 0);
    });
  }, [items]);

  useEffect(() => {
    if (open) {
      setQuery('');
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const activeHint = MODE_OPTIONS.find((o) => o.value === mode)?.hint ?? '';
  const listDimmed = mode === 'none';

  return (
    <PickerPopover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      ariaLabel="知识检索设置"
      className="w-full max-w-[calc(100vw-1.25rem)] sm:w-[min(360px,calc(100vw-1.25rem))]"
    >
      {/* 三态模式 segmented */}
      <div className="border-b border-[var(--ink-subtle)]/15 p-3">
        <div className="mb-2 flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)]">
          <span>§ Knowledge</span>
          <span className="inline-flex items-center gap-1 text-[color-mix(in_oklch,var(--aurora-2)_85%,var(--ink-muted))]">
            <BookMarked className="h-3 w-3" aria-hidden="true" />
            检索
          </span>
        </div>
        <div
          role="radiogroup"
          aria-label="知识检索模式"
          className="relative flex items-center rounded-[12px] bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] p-[3px]"
        >
          {MODE_OPTIONS.map((opt) => {
            const active = opt.value === mode;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onModeChange(opt.value)}
                className={`relative flex h-8 flex-1 items-center justify-center rounded-[9px] text-[12px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklch,var(--aurora-2)_45%,transparent)] ${
                  active
                    ? 'text-[var(--ink-primary)]'
                    : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]'
                }`}
              >
                {/* 滑动 thumb —— layoutId 共享元素在三个按钮间滑移（spring.precise = Toggle 语义） */}
                {active && (
                  <motion.span
                    layoutId="kb-mode-thumb"
                    aria-hidden="true"
                    transition={spring.precise}
                    className="absolute inset-0 rounded-[9px] bg-[var(--bg-raised)] shadow-[0_2px_6px_rgba(0,0,0,0.14),inset_0_0_0_0.5px_color-mix(in_oklch,var(--ink-primary)_10%,transparent)]"
                  />
                )}
                <span className="relative z-10 inline-flex items-center">
                  {opt.value === 'auto' && <Sparkles className="mr-1 h-3 w-3 opacity-70" aria-hidden="true" />}
                  {opt.label}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-[var(--ink-muted)]">{activeHint}</p>
      </div>

      {/* 搜索 */}
      <div className="border-b border-[var(--ink-subtle)]/12 p-3 pb-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索知识库…"
            disabled={listDimmed}
            className="w-full rounded-lg border border-[var(--ink-subtle)]/15 bg-[var(--bg-raised)] py-2 pl-8 pr-2 text-[12.5px] text-[var(--ink-secondary)] outline-none placeholder-[var(--ink-muted)]/60 focus:border-[var(--aurora-2)]/40 focus:ring-1 focus:ring-[var(--aurora-2)]/15 disabled:opacity-50"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>

      {/* KB 列表 */}
      <div
        className={`agent-thumb-scroll max-h-[min(300px,48dvh)] overflow-y-auto py-1 transition-opacity sm:max-h-[300px] ${
          listDimmed ? 'pointer-events-none opacity-40' : loading && items.length > 0 ? 'opacity-60' : ''
        }`}
        aria-disabled={listDimmed}
        aria-busy={loading}
      >
        {loading && items.length === 0 && (
          <div className="space-y-2 px-3 py-3" aria-label="知识库加载中">
            {[0, 1, 2].map((idx) => (
              <div key={idx} className="flex animate-pulse items-center gap-2.5">
                <div className="h-7 w-7 rounded-lg bg-[var(--ink-subtle)]/14" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-2/3 rounded-full bg-[var(--ink-subtle)]/14" />
                  <div className="h-2.5 w-1/3 rounded-full bg-[var(--ink-subtle)]/10" />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && !loading && (
          <div className="px-3 py-3 font-mono text-[10.5px] tracking-[0.04em] text-[var(--signal-warn)]">
            {error}
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="px-3 py-6 text-center font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            {query.trim() ? '没有匹配的知识库' : '暂无可用知识库'}
          </div>
        )}

        {/* 重取期间保留旧列表可见（轻微降透明），不闪空白（§3.6 零延迟感知）；
            骨架屏只在首载（items 为空）时出现。 */}
        {!error &&
          visible.length > 0 &&
          visible.map((kb) => {
            const checked = selectedIds.has(kb.id);
            const ready = isKbReady(kb);
            return (
              <button
                key={kb.id}
                type="button"
                onClick={() => ready && onToggleKb(kb)}
                aria-pressed={checked}
                aria-disabled={!ready}
                title={ready ? undefined : '该知识库尚未完成索引，暂不可检索'}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  !ready
                    ? 'cursor-not-allowed opacity-45'
                    : checked
                    ? 'bg-[color-mix(in_oklch,var(--aurora-2)_11%,transparent)] text-[var(--ink-primary)]'
                    : 'text-[var(--ink-secondary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] hover:text-[var(--ink-primary)]'
                }`}
              >
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border ${
                    checked
                      ? 'border-[color-mix(in_oklch,var(--aurora-2)_35%,transparent)] bg-[color-mix(in_oklch,var(--aurora-2)_14%,transparent)] text-[var(--aurora-2)]'
                      : 'border-[var(--ink-subtle)]/16 bg-[var(--bg-raised)] text-[var(--ink-muted)]'
                  }`}
                  aria-hidden="true"
                >
                  {kb.kind === 'SYSTEM_POSTS' ? (
                    <Library className="h-3.5 w-3.5" />
                  ) : (
                    <BookMarked className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-snug">{kb.name}</span>
                  <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-muted)] tnum">
                    {kb.kind === 'SYSTEM_POSTS' ? '站点文章库' : '自建'}
                    {typeof kb.chunkCount === 'number' && ready && ` · ${kb.chunkCount} 段`}
                    {!ready && ' · 未就绪'}
                  </span>
                </span>
                {checked && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-[var(--aurora-2)]" aria-hidden="true" />
                )}
              </button>
            );
          })}
      </div>
    </PickerPopover>
  );
}
