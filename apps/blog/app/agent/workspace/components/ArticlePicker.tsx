'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import PickerPopover from './PickerPopover';
import {
  useArticleSearch,
  ARTICLE_PAGE_SIZE,
  type AgentArticle,
} from '../../lib/agentResources';

interface Props {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** 用户已选中的文章 ID 集合 —— 选中态显示已选；移除从 composer chip 处理。 */
  selectedIds: Set<number>;
  onPick: (article: AgentArticle) => void;
}

/**
 * @ 文章选择器
 *
 *  - 搜索框输入触发 `/api/v1/agent/articles?q=...`，搜索路径单页返回；
 *  - 空查询走分页（10 / 页），底部 prev/next 翻页；
 *  - 列表区域固定高度，pagination footer 始终渲染 —— 整体尺寸不随结果数量变化，
 *    打开 / 翻页 / 搜索都不会出现"模态忽大忽小"的跳动感；
 *  - 选中样式与 ModelPicker 一致（aurora 高亮 + Check）。
 */
export default function ArticlePicker({
  open,
  onClose,
  anchorRef,
  selectedIds,
  onPick,
}: Props) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const { items, total, loading, error } = useArticleSearch(
    query,
    open,
    page,
    ARTICLE_PAGE_SIZE,
  );

  // 打开时清空搜索 + 重置页码 + 自动 focus
  useEffect(() => {
    if (open) {
      setQuery('');
      setPage(1);
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  // query 变化时把页码拨回 1（避免上次翻到第 3 页后输入新关键词仍带 page=3）
  useEffect(() => {
    setPage(1);
  }, [query]);

  const isSearching = query.trim().length > 0;
  const totalPages = isSearching
    ? 1
    : Math.max(1, Math.ceil(total / ARTICLE_PAGE_SIZE));
  const canPrev = !isSearching && page > 1 && !loading;
  const canNext = !isSearching && page < totalPages && !loading;

  const showInitialLoading = loading && items.length === 0;
  const showEmpty = !loading && !error && items.length === 0;

  return (
    <PickerPopover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      ariaLabel="选择文章"
      className="w-full max-w-[calc(100vw-1.25rem)] sm:w-[min(360px,calc(100vw-1.25rem))]"
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
          <span>§ {isSearching ? '搜索结果' : '最近发布'}</span>
          <span>{total} 条</span>
        </div>
      </div>

      {/* 列表区域按 3 个固定槽位展示,避免底部露出半截下一篇文章。 */}
      <div className="agent-thumb-scroll relative h-[min(288px,52dvh)] overflow-y-auto sm:h-[288px]">
        {showInitialLoading && (
          <div className="absolute inset-x-3 top-4 space-y-3" aria-label="文章加载中">
            {[0, 1, 2].map((idx) => (
              <div key={idx} className="h-20 rounded-xl bg-[var(--bg-raised)]/70 p-3 animate-pulse">
                <div className="h-3 w-2/3 rounded-full bg-[var(--ink-subtle)]/18" />
                <div className="mt-3 h-2.5 w-full rounded-full bg-[var(--ink-subtle)]/12" />
                <div className="mt-2 h-2.5 w-3/5 rounded-full bg-[var(--ink-subtle)]/12" />
              </div>
            ))}
          </div>
        )}

        {error && !loading && (
          <div className="px-3 py-3 font-mono text-[10.5px] tracking-[0.04em] text-[var(--signal-warn)]">
            {error}
          </div>
        )}

        {showEmpty && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            没有匹配的文章
          </div>
        )}

        {items.length > 0 && (
          <div
            className={`transition-opacity duration-150 ${loading ? 'opacity-50' : 'opacity-100'}`}
          >
            {items.map((it) => {
              const checked = selectedIds.has(it.id);
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => {
                    if (!checked) onPick(it);
                  }}
                  aria-disabled={checked}
                  className={`group/item h-24 w-full overflow-hidden text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors ${
                    checked
                      ? 'cursor-default bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)]'
                      : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)]/70 hover:text-[var(--ink-primary)]'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 opacity-80" />
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="text-[13px] truncate" title={it.title}>
                      {it.title}
                    </div>
                    <div className="mt-0.5 line-clamp-2 min-h-[2.25rem] text-[11.5px] leading-relaxed text-[var(--ink-muted)]">
                      {it.summary?.trim() || '暂无摘要'}
                    </div>
                    <div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)] mt-1 flex min-w-0 items-center gap-1.5">
                      {it.category && <span className="truncate">{it.category}</span>}
                      {it.category && it.publishedAt && <span aria-hidden="true">·</span>}
                      {it.publishedAt && <span className="shrink-0">{it.publishedAt}</span>}
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
        )}
      </div>

      {/* 分页 footer —— 始终渲染，禁用态用透明度区分，整体高度恒定。 */}
      <div className="flex items-center justify-between border-t border-[var(--ink-subtle)]/15 px-3 py-2 font-mono text-[9.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)]">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={!canPrev}
          aria-label="上一页"
          className="flex h-6 w-6 items-center justify-center rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:bg-[var(--bg-raised)] enabled:hover:text-[var(--ink-primary)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span>
          {isSearching ? '搜索结果' : `第 ${page} / ${totalPages} 页`}
        </span>
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={!canNext}
          aria-label="下一页"
          className="flex h-6 w-6 items-center justify-center rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:bg-[var(--bg-raised)] enabled:hover:text-[var(--ink-primary)]"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </PickerPopover>
  );
}
