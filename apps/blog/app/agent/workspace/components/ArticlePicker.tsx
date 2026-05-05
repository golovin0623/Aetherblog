'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, FileText, Loader2 } from 'lucide-react';
import PickerPopover from './PickerPopover';
import { useArticleSearch, type AgentArticle } from '../../lib/agentResources';

interface Props {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** 用户已选中的文章 ID 集合 —— 选中态显示 ✓；再次点击会从 selected 移除。 */
  selectedIds: Set<number>;
  onPick: (article: AgentArticle) => void;
}

/**
 * @ 文章选择器
 *
 *  - 搜索框输入触发 `/api/v1/agent/articles?q=...`，空查询时返回最近 12 篇；
 *  - 列表里 hover/选中样式与 ModelPicker 一致（aurora 高亮 + Check）；
 *  - 选中后通过 onPick 通知父级；父级负责把文章 id 加入 mentions 数组并把
 *    `@<title>` token 插入 textarea。
 */
export default function ArticlePicker({
  open,
  onClose,
  anchorRef,
  selectedIds,
  onPick,
}: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { items, loading, error } = useArticleSearch(query, open);

  // 打开时自动 focus 搜索框
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
      ariaLabel="选择文章"
      className="w-[360px] sm:w-[420px]"
    >
      <div className="p-3 border-b border-[var(--ink-subtle)]/15">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文章标题、摘要…"
            className="w-full pl-8 pr-2 py-2 rounded-lg bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/15 text-[var(--ink-secondary)] placeholder-[var(--ink-muted)]/60 text-[12.5px] outline-none focus:border-[var(--aurora-1)]/40 focus:ring-1 focus:ring-[var(--aurora-1)]/15"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)] flex items-center justify-between">
          <span>§ {query.trim() ? '搜索结果' : '最近发布'}</span>
          <span>{items.length} 条</span>
        </div>
      </div>

      <div className="agent-thumb-scroll max-h-[320px] overflow-y-auto py-1">
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

        {!loading && !error && items.length === 0 && (
          <div className="px-3 py-6 text-center font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            没有匹配的文章
          </div>
        )}

        {!loading && !error &&
          items.map((it) => {
            const checked = selectedIds.has(it.id);
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => onPick(it)}
                className={`group/item w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors ${
                  checked
                    ? 'bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)]'
                    : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)]/70 hover:text-[var(--ink-primary)]'
                }`}
              >
                <FileText className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 opacity-80" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] truncate" title={it.title}>
                    {it.title}
                  </div>
                  {it.summary && (
                    <div className="text-[11.5px] text-[var(--ink-muted)] line-clamp-2 mt-0.5 leading-relaxed">
                      {it.summary}
                    </div>
                  )}
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)] mt-1 flex items-center gap-1.5">
                    {it.category && <span className="truncate">{it.category}</span>}
                    {it.category && it.publishedAt && <span aria-hidden="true">·</span>}
                    {it.publishedAt && <span>{it.publishedAt}</span>}
                  </div>
                </div>
                {checked && (
                  <span className="font-mono text-[9px] uppercase tracking-[0.22em] flex-shrink-0">
                    已选
                  </span>
                )}
              </button>
            );
          })}
      </div>
    </PickerPopover>
  );
}
