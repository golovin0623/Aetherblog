'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Hash, Search, Loader2 } from 'lucide-react';
import PickerPopover from './PickerPopover';
import { filterTags, useAllTags, type AgentTag } from '../../lib/agentResources';

interface Props {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  selectedSlugs: Set<string>;
  onPick: (tag: AgentTag) => void;
}

/**
 * # 标签选择器
 *
 * 一次性拉全量 tags（站点标签量通常 < 200），客户端按 query 过滤，避免每次
 * 输入再 round-trip。按 postCount 倒序展示，让"主流话题"出现在顶部。
 */
export default function TagPicker({
  open,
  onClose,
  anchorRef,
  selectedSlugs,
  onPick,
}: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { items, loading, error } = useAllTags(open);

  const visible = useMemo(() => {
    const filtered = filterTags(items, query);
    return [...filtered].sort((a, b) => b.postCount - a.postCount);
  }, [items, query]);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  return (
    <PickerPopover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      ariaLabel="选择标签"
      className="w-[min(320px,calc(100vw-1.25rem))] max-w-[calc(100vw-1.25rem)]"
    >
      <div className="p-3 border-b border-[var(--ink-subtle)]/15">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标签…"
            className="w-full pl-8 pr-2 py-2 rounded-lg bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/15 text-[var(--ink-secondary)] placeholder-[var(--ink-muted)]/60 text-[12.5px] outline-none focus:border-[var(--aurora-1)]/40 focus:ring-1 focus:ring-[var(--aurora-1)]/15"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)] flex items-center justify-between">
          <span>§ Tags</span>
          <span>{visible.length} 个</span>
        </div>
      </div>

      <div className="agent-thumb-scroll max-h-[min(320px,52vh)] overflow-y-auto py-1">
        {loading && (
          <div className="px-3 py-3 inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            <Loader2 className="w-3 h-3 animate-spin" />
            加载中…
          </div>
        )}

        {error && !loading && (
          <div className="px-3 py-3 font-mono text-[10.5px] tracking-[0.04em] text-[var(--signal-warn)]">
            {error}
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="px-3 py-6 text-center font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            没有匹配的标签
          </div>
        )}

        {!loading && !error &&
          visible.map((t) => {
            const checked = selectedSlugs.has(t.slug);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onPick(t)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors ${
                  checked
                    ? 'bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)]'
                    : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)]/70 hover:text-[var(--ink-primary)]'
                }`}
              >
                <Hash className="w-3.5 h-3.5 flex-shrink-0 opacity-80" />
                <span className="text-[13px] truncate flex-1">{t.name}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)] flex-shrink-0">
                  {t.postCount}
                </span>
                {checked && (
                  <span className="font-mono text-[9px] uppercase tracking-[0.22em] flex-shrink-0">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
      </div>
    </PickerPopover>
  );
}
