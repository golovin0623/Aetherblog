import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Select, type SelectOption } from '@aetherblog/ui';
import { cn } from '@/lib/utils';

const FULL_RENDER_THRESHOLD = 10;
const EDGE_COUNT = 5;
const SIBLING_COUNT = 5;

type PaginationEllipsis = {
  type: 'ellipsis';
  key: string;
  start: number;
  end: number;
};

type PaginationItem = number | PaginationEllipsis;

type PaginationShellProps = {
  summary: ReactNode;
  pageSize?: number;
  pageSizeOptions?: number[];
  onPageSizeChange?: (pageSize: number) => void;
  itemLabel?: string;
  pageSizeAriaLabel?: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
};

export type AdminPaginationProps = {
  page: number;
  total?: number;
  totalPages?: number;
  pageSize?: number;
  pageSizeOptions?: number[];
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  itemLabel?: string;
  loading?: boolean;
  summaryLoading?: boolean;
  disabled?: boolean;
  className?: string;
  pageSizeAriaLabel?: string;
};

export type AdminCursorPaginationProps = {
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  summary: ReactNode;
  pageSize?: number;
  pageSizeOptions?: number[];
  onPageSizeChange?: (pageSize: number) => void;
  itemLabel?: string;
  pageSizeAriaLabel?: string;
  disabled?: boolean;
  className?: string;
};

function pageRange(start: number, end: number): number[] {
  if (end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function isPaginationEllipsis(item: PaginationItem): item is PaginationEllipsis {
  return typeof item !== 'number';
}

function buildPaginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 1) return [1];
  if (totalPages <= FULL_RENDER_THRESHOLD) {
    return pageRange(1, totalPages);
  }

  const safeCurrentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const rawRanges = ([
    [1, Math.min(EDGE_COUNT, totalPages)],
    [
      Math.max(1, safeCurrentPage - SIBLING_COUNT),
      Math.min(totalPages, safeCurrentPage + SIBLING_COUNT),
    ],
    [Math.max(1, totalPages - EDGE_COUNT + 1), totalPages],
  ] satisfies Array<[number, number]>).sort((a, b) => a[0] - b[0]);

  const ranges = rawRanges.reduce<Array<[number, number]>>((merged, range) => {
    const last = merged[merged.length - 1];
    if (!last || range[0] > last[1] + 1) {
      merged.push([...range]);
      return merged;
    }
    last[1] = Math.max(last[1], range[1]);
    return merged;
  }, []);

  const items: PaginationItem[] = [];
  let lastPage = 0;
  for (const [start, end] of ranges) {
    if (start > lastPage + 1) {
      if (start === lastPage + 2) {
        items.push(lastPage + 1);
      } else {
        items.push({
          type: 'ellipsis',
          key: `ellipsis-${lastPage + 1}-${start - 1}`,
          start: lastPage + 1,
          end: start - 1,
        });
      }
    }
    items.push(...pageRange(start, end));
    lastPage = end;
  }

  return items;
}

function PaginationShell({
  summary,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  itemLabel = '条',
  pageSizeAriaLabel,
  disabled = false,
  className,
  children,
}: PaginationShellProps) {
  const resolvedPageSizeAriaLabel = pageSizeAriaLabel ?? `每页${itemLabel}数`;
  const pageSizeSelectOptions: SelectOption[] = useMemo(
    () => (pageSizeOptions || []).map((size) => ({ value: String(size), label: `${size} ${itemLabel}/页` })),
    [itemLabel, pageSizeOptions]
  );
  const showPageSizeSelect = Boolean(
    pageSize !== undefined &&
    pageSizeSelectOptions.length > 0 &&
    onPageSizeChange
  );

  return (
    <div
      className={cn(
        'grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:grid-cols-[minmax(0,1fr)_auto_auto] md:px-4 md:py-3',
        className
      )}
    >
      <div className="tnum order-1 col-span-2 flex min-w-0 flex-wrap items-center justify-start gap-1.5 text-left text-[13px] font-semibold leading-5 text-[var(--ink-muted)] md:col-span-1 md:text-xs">
        {summary}
      </div>

      {showPageSizeSelect ? (
        <Select
          value={String(pageSize)}
          onValueChange={(nextValue) => {
            const nextSize = Number(nextValue);
            if (!Number.isFinite(nextSize) || nextSize === pageSize) return;
            onPageSizeChange?.(nextSize);
          }}
          options={pageSizeSelectOptions}
          ariaLabel={resolvedPageSizeAriaLabel}
          size="sm"
          fullWidth={false}
          className="order-2 col-start-3 !h-10 !w-[112px] md:order-3 md:col-start-auto md:!h-8 md:!w-[132px]"
          disabled={disabled}
        />
      ) : (
        <div className="order-2 col-start-3 hidden md:order-3 md:col-start-auto md:block" />
      )}

      <div className="order-3 col-span-3 flex w-full items-center justify-center md:order-2 md:col-span-1 md:w-auto md:justify-end">
        {children}
      </div>
    </div>
  );
}

function SummarySkeleton() {
  return <div className="h-4 w-32 animate-pulse rounded bg-[var(--bg-secondary)]" />;
}

function DefaultSummary({
  page,
  totalPages,
  total,
  itemLabel,
}: {
  page: number;
  totalPages: number;
  total: number;
  itemLabel: string;
}) {
  return (
    <>
      <span>
        第 <span className="text-[var(--ink-secondary)]">{page}</span> / {totalPages} 页
      </span>
      <span className="mx-1 text-[var(--ink-subtle)]">·</span>
      <span>
        共 <span className="text-[var(--ink-secondary)]">{total.toLocaleString()}</span> {itemLabel}
      </span>
    </>
  );
}

export function AdminPagination({
  page,
  total = 0,
  totalPages,
  pageSize = 10,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
  itemLabel = '条',
  loading = false,
  summaryLoading = false,
  disabled = false,
  className,
  pageSizeAriaLabel,
}: AdminPaginationProps) {
  const computedTotalPages = totalPages ?? Math.ceil(total / pageSize);
  const safeTotalPages = Math.max(computedTotalPages, 1);
  const safePage = Math.min(Math.max(page, 1), safeTotalPages);
  const paginationItems = useMemo(
    () => buildPaginationItems(safePage, safeTotalPages),
    [safePage, safeTotalPages]
  );
  const pageStripRef = useRef<HTMLDivElement>(null);
  const isInitialScrollRef = useRef(true);
  const [pageJumpTarget, setPageJumpTarget] = useState<string | null>(null);
  const [pageJumpValue, setPageJumpValue] = useState('');
  const isPageChangeDisabled = loading || disabled || !onPageChange;

  useEffect(() => {
    const container = pageStripRef.current;
    if (!container) return;
    const activeBtn = container.querySelector<HTMLButtonElement>('[aria-current="page"]');
    if (!activeBtn) return;
    const containerRect = container.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    const target =
      container.scrollLeft +
      (btnRect.left + btnRect.width / 2) -
      (containerRect.left + containerRect.width / 2);
    // 已经居中(±1px 容差)时不重复触发滚动,避免触摸滚动中被打断或首屏多余动效。
    if (Math.abs(target - container.scrollLeft) <= 1) {
      isInitialScrollRef.current = false;
      return;
    }
    // 首屏挂载时不要做 smooth 动画,瞬时落位即可。
    container.scrollTo({
      left: target,
      behavior: isInitialScrollRef.current ? 'auto' : 'smooth',
    });
    isInitialScrollRef.current = false;
  }, [safePage, safeTotalPages]);

  const handlePageChange = (nextPage: number) => {
    const clampedPage = Math.min(Math.max(nextPage, 1), safeTotalPages);
    if (isPageChangeDisabled || clampedPage === safePage) return;
    setPageJumpTarget(null);
    onPageChange?.(clampedPage);
  };

  const handleOpenPageJump = (entry: PaginationEllipsis) => {
    const defaultPage =
      safePage >= entry.start && safePage <= entry.end
        ? safePage
        : entry.start;
    setPageJumpTarget(entry.key);
    setPageJumpValue(String(defaultPage));
  };

  const handlePageJumpSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pageJumpValue.trim()) return;
    const nextPage = Number(pageJumpValue);
    if (!Number.isFinite(nextPage)) return;
    const truncated = Math.trunc(nextPage);
    // 输入框已经通过 min/max 限制在 entry 范围内; 提交时同样夹紧到当前 ellipsis 区间,
    // 避免用户绕过 HTML5 校验提交超出区间的页码后被沉默接受。
    const entry = paginationItems.find(
      (item) => isPaginationEllipsis(item) && item.key === pageJumpTarget
    ) as PaginationEllipsis | undefined;
    const finalPage = entry
      ? Math.min(Math.max(truncated, entry.start), entry.end)
      : truncated;
    handlePageChange(finalPage);
  };

  return (
    <PaginationShell
      summary={
        summaryLoading ? (
          <SummarySkeleton />
        ) : (
          <DefaultSummary
            page={safePage}
            totalPages={safeTotalPages}
            total={total}
            itemLabel={itemLabel}
          />
        )
      }
      pageSize={pageSize}
      pageSizeOptions={pageSizeOptions}
      onPageSizeChange={onPageSizeChange}
      itemLabel={itemLabel}
      pageSizeAriaLabel={pageSizeAriaLabel}
      disabled={loading || disabled || summaryLoading}
      className={className}
    >
      {safeTotalPages > 1 && !summaryLoading ? (
        <div className="grid w-full grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 md:flex md:w-auto md:gap-1.5">
          <button
            type="button"
            onClick={() => handlePageChange(safePage - 1)}
            disabled={isPageChangeDisabled || safePage <= 1}
            className={cn(
              'admin-module-action-button min-h-0 flex-shrink-0 p-2 disabled:cursor-not-allowed disabled:opacity-50 max-sm:!h-11 max-sm:!min-h-11 max-sm:!w-11',
              isPageChangeDisabled || safePage <= 1
                ? 'text-[var(--ink-muted)]/50'
                : 'text-[var(--ink-secondary)]'
            )}
            aria-label="上一页"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <div
            ref={pageStripRef}
            role="navigation"
            aria-label="分页导航"
            className="no-scrollbar flex min-w-0 max-w-none snap-x snap-proximity items-center gap-1.5 overflow-x-auto overscroll-x-contain scroll-smooth px-1 touch-pan-x [scrollbar-width:none] md:max-w-[520px] md:px-0.5 lg:max-w-[640px] xl:max-w-[760px]"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {paginationItems.map((entry) => {
              if (isPaginationEllipsis(entry)) {
                if (pageJumpTarget === entry.key) {
                  return (
                    <form
                      key={entry.key}
                      onSubmit={handlePageJumpSubmit}
                      className="flex h-10 w-[104px] flex-shrink-0 items-center gap-1 rounded-lg border border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] bg-[var(--bg-leaf)] p-1 md:h-8 md:w-[96px]"
                      aria-label={`跳转到第 ${entry.start} 到 ${entry.end} 页`}
                    >
                      <input
                        type="number"
                        min={entry.start}
                        max={entry.end}
                        value={pageJumpValue}
                        onChange={(event) => setPageJumpValue(event.target.value)}
                        onFocus={(event) => event.currentTarget.select()}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            setPageJumpTarget(null);
                          }
                        }}
                        autoFocus
                        disabled={isPageChangeDisabled}
                        inputMode="numeric"
                        className="tnum h-full min-w-0 flex-1 rounded-md bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] px-1 text-center text-xs font-semibold text-[var(--ink-primary)] outline-none focus:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]"
                        aria-label="输入页码"
                      />
                      <button
                        type="submit"
                        disabled={isPageChangeDisabled}
                        className="h-full rounded-md px-2 text-xs font-semibold text-[var(--aurora-1)] transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        跳
                      </button>
                    </form>
                  );
                }
                return (
                  <button
                    type="button"
                    key={entry.key}
                    onClick={() => handleOpenPageJump(entry)}
                    disabled={isPageChangeDisabled}
                    className="flex h-10 w-10 flex-shrink-0 snap-center items-center justify-center rounded-lg border border-dashed border-[color-mix(in_oklch,var(--ink-primary)_14%,transparent)] bg-[var(--bg-leaf)] text-xs font-semibold text-[var(--ink-muted)] transition-all duration-200 hover:border-[color-mix(in_oklch,var(--aurora-1)_32%,transparent)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--ink-primary)] disabled:cursor-not-allowed disabled:opacity-60 md:h-8 md:w-9"
                    aria-label={`跳转到第 ${entry.start} 到 ${entry.end} 页`}
                  >
                    ...
                  </button>
                );
              }
              const isActive = entry === safePage;
              return (
                <button
                  type="button"
                  key={entry}
                  onClick={() => handlePageChange(entry)}
                  disabled={isPageChangeDisabled}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={`第 ${entry} 页`}
                  className={cn(
                    'flex h-10 w-10 flex-shrink-0 snap-center items-center justify-center rounded-lg text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60 md:h-8 md:w-8 md:text-xs',
                    isActive
                      ? 'bg-[var(--ink-primary)] text-[var(--bg-void)] shadow-[0_12px_24px_-20px_color-mix(in_oklch,var(--aurora-1)_55%,black)]'
                      : 'border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] text-[var(--ink-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--ink-primary)]'
                  )}
                >
                  {entry}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => handlePageChange(safePage + 1)}
            disabled={isPageChangeDisabled || safePage >= safeTotalPages}
            className={cn(
              'admin-module-action-button min-h-0 flex-shrink-0 p-2 disabled:cursor-not-allowed disabled:opacity-50 max-sm:!h-11 max-sm:!min-h-11 max-sm:!w-11',
              isPageChangeDisabled || safePage >= safeTotalPages
                ? 'text-[var(--ink-muted)]/50'
                : 'text-[var(--ink-secondary)]'
            )}
            aria-label="下一页"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="h-8" />
      )}
    </PaginationShell>
  );
}

export function AdminCursorPagination({
  page,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  summary,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  itemLabel = '条',
  pageSizeAriaLabel,
  disabled = false,
  className,
}: AdminCursorPaginationProps) {
  return (
    <PaginationShell
      summary={summary}
      pageSize={pageSize}
      pageSizeOptions={pageSizeOptions}
      onPageSizeChange={onPageSizeChange}
      itemLabel={itemLabel}
      pageSizeAriaLabel={pageSizeAriaLabel}
      disabled={disabled}
      className={className}
    >
      <div className="grid w-full grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 md:flex md:w-auto md:gap-1.5">
        <button
          type="button"
          onClick={onPrevious}
          disabled={disabled || !hasPrevious}
          className={cn(
            'admin-module-action-button min-h-0 flex-shrink-0 p-2 disabled:cursor-not-allowed disabled:opacity-50 max-sm:!h-11 max-sm:!min-h-11 max-sm:!w-11',
            disabled || !hasPrevious ? 'text-[var(--ink-muted)]/50' : 'text-[var(--ink-secondary)]'
          )}
          aria-label="上一页"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <div className="tnum flex h-10 min-w-0 items-center justify-center rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-4 text-sm font-semibold text-[var(--ink-secondary)] md:h-8 md:min-w-20 md:text-xs">
          {page}
        </div>
        <button
          type="button"
          onClick={onNext}
          disabled={disabled || !hasNext}
          className={cn(
            'admin-module-action-button min-h-0 flex-shrink-0 p-2 disabled:cursor-not-allowed disabled:opacity-50 max-sm:!h-11 max-sm:!min-h-11 max-sm:!w-11',
            disabled || !hasNext ? 'text-[var(--ink-muted)]/50' : 'text-[var(--ink-secondary)]'
          )}
          aria-label="下一页"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </PaginationShell>
  );
}

export default AdminPagination;
