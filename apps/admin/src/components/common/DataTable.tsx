import { useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Select, type SelectOption } from '@aetherblog/ui';
import { cn } from '@/lib/utils';

interface Column<T> {
  key: keyof T | string;
  title: string;
  render?: (item: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  loading?: boolean;
  refreshing?: boolean;
  onSort?: (key: string, direction: 'asc' | 'desc') => void;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  pageSizeOptions?: number[];
  onPageSizeChange?: (pageSize: number) => void;
}

type PaginationItem = number | 'start-ellipsis' | 'end-ellipsis';

function buildPaginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 1) return [1];
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const safeCurrentPage = Math.min(Math.max(currentPage, 1), totalPages);
  let windowStart = Math.max(2, safeCurrentPage - 1);
  let windowEnd = Math.min(totalPages - 1, safeCurrentPage + 1);

  if (safeCurrentPage <= 4) {
    windowStart = 2;
    windowEnd = Math.min(totalPages - 1, 5);
  } else if (safeCurrentPage >= totalPages - 3) {
    windowStart = Math.max(2, totalPages - 4);
    windowEnd = totalPages - 1;
  }

  const items: PaginationItem[] = [1];
  if (windowStart > 2) items.push('start-ellipsis');
  for (let pageNumber = windowStart; pageNumber <= windowEnd; pageNumber += 1) {
    items.push(pageNumber);
  }
  if (windowEnd < totalPages - 1) items.push('end-ellipsis');
  items.push(totalPages);

  return items;
}

export function DataTable<T extends { id: number | string }>({
  data,
  columns,
  loading = false,
  refreshing = false,
  onSort,
  page = 1,
  pageSize = 10,
  total = 0,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: string) => {
    const newDirection = sortKey === key && sortDirection === 'asc' ? 'desc' : 'asc';
    setSortKey(key);
    setSortDirection(newDirection);
    onSort?.(key, newDirection);
  };

  const totalPages = Math.ceil(total / pageSize);
  const safeTotalPages = Math.max(totalPages, 1);
  const paginationItems = buildPaginationItems(page, safeTotalPages);
  const reservedRowCount = total > 0 ? Math.min(pageSize, total) : 0;
  const emptyRowCount = !loading && data.length > 0
    ? Math.max(reservedRowCount - data.length, 0)
    : 0;
  const showLoadingRow = loading && data.length === 0;
  const pageSizeSelectOptions: SelectOption[] = (pageSizeOptions || []).map((opt) => ({
    value: String(opt),
    label: `${opt} 条/页`,
  }));
  const paginationBusy = loading || refreshing;

  return (
    <div className="surface-leaf surface-dashboard-card relative overflow-hidden rounded-xl" aria-busy={loading || refreshing}>
      <div className="relative overflow-x-auto">
        {refreshing && data.length > 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 bg-[var(--bg-leaf)]/35 backdrop-blur-[1px]">
            <div className="absolute right-4 top-3 inline-flex h-8 items-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-3 text-xs font-medium text-[var(--ink-secondary)] shadow-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              同步列表
            </div>
          </div>
        )}
        <table className="w-full tnum">
          <thead>
            <tr className="border-b border-[var(--border-subtle)]">
              {columns.map((column) => (
                <th
                  key={String(column.key)}
                  className="px-6 py-4 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]"
                  style={{ width: column.width }}
                  aria-sort={
                    column.sortable
                      ? sortKey === column.key
                        ? sortDirection === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                      : undefined
                  }
                >
                  {column.sortable ? (
                    <button
                      onClick={() => handleSort(String(column.key))}
                      className="flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors"
                      aria-label={`排序：${column.title}`}
                    >
                      {column.title}
                      {sortKey === column.key ? (
                        sortDirection === 'asc' ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )
                      ) : null}
                    </button>
                  ) : (
                    column.title
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showLoadingRow ? (
              <tr>
                <td colSpan={columns.length} className="px-6 py-8 text-center text-[var(--text-muted)]">
                  加载中...
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-6 py-8 text-center text-[var(--text-muted)]">
                  暂无数据
                </td>
              </tr>
            ) : (
              <>
                {data.map((item) => (
                  <tr
                    key={item.id}
                    className="group relative h-[84px] border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-card-hover)]"
                    data-interactive="true"
                  >
                    {/* 极光左带装饰作为首列 <td> 的子元素渲染 —— 不能再单独
                        插一个 <td>,否则 tbody 比 thead 多一个 cell,在 iOS
                        Safari 等把 position:absolute 的 <td> 仍计入列数的
                        浏览器里会造成列错位(时间→任务格、任务→模型格...)。 */}
                    {columns.map((column, columnIndex) => (
                      <td
                        key={String(column.key)}
                        className={cn(
                          'px-6 py-4 text-[var(--text-primary)]',
                          columnIndex === 0 && 'relative',
                        )}
                      >
                        {columnIndex === 0 && (
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute left-0 top-0 bottom-0 w-[2px] overflow-hidden"
                          >
                            <span
                              className="absolute inset-0 origin-top scale-y-0 rounded-full transition-transform duration-300 ease-out group-hover:scale-y-100"
                              style={{
                                background:
                                  'linear-gradient(to bottom, var(--aurora-1, var(--color-primary, #818CF8)), var(--aurora-2, var(--color-primary, #818CF8)), var(--aurora-3, var(--color-primary, #818CF8)))',
                              }}
                            />
                          </span>
                        )}
                        {column.render
                          ? column.render(item)
                          : String(item[column.key as keyof T] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
                {Array.from({ length: emptyRowCount }, (_, index) => (
                  <tr
                    key={`reserved-row-${index}`}
                    aria-hidden="true"
                    className="h-[84px] border-b border-[var(--border-subtle)]"
                  >
                    <td colSpan={columns.length} className="px-6 py-4">
                      &nbsp;
                    </td>
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {(totalPages > 1 || (pageSizeOptions && pageSizeOptions.length > 0 && total > 0)) && (
        <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:grid-cols-[minmax(0,1fr)_auto_auto] md:px-4 md:py-3">
          <span className="tnum order-1 col-span-2 flex min-w-0 flex-wrap items-center justify-start gap-1.5 text-left text-[13px] font-semibold leading-5 text-[var(--ink-muted)] md:col-span-1 md:text-xs">
            <span>
              第 <span className="text-[var(--ink-secondary)]">{page}</span> / {safeTotalPages} 页
            </span>
            <span className="mx-1 text-[var(--ink-subtle)]">·</span>
            <span>
              共 <span className="text-[var(--ink-secondary)]">{total.toLocaleString()}</span> 条
            </span>
          </span>

          {pageSizeOptions && pageSizeOptions.length > 0 && onPageSizeChange && (
            <Select
              value={String(pageSize)}
              onValueChange={(nextValue) => onPageSizeChange(Number(nextValue))}
              options={pageSizeSelectOptions}
              ariaLabel="每页条数"
              size="sm"
              fullWidth={false}
              className="order-2 col-start-3 !h-10 !w-[112px] md:order-3 md:col-start-auto md:!h-8 md:!w-[132px]"
              disabled={paginationBusy}
            />
          )}

          <div className="order-3 col-span-3 flex w-full items-center justify-center md:order-2 md:col-span-1 md:w-auto md:justify-end">
            {totalPages > 1 ? (
              <div className="grid w-full grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 md:flex md:w-auto md:gap-1.5">
                <button
                  type="button"
                  onClick={() => onPageChange?.(page - 1)}
                  disabled={paginationBusy || page <= 1}
                  className={cn(
                    'admin-module-action-button min-h-0 flex-shrink-0 p-2 disabled:cursor-not-allowed disabled:opacity-50 max-sm:!h-11 max-sm:!min-h-11 max-sm:!w-11',
                    paginationBusy || page <= 1
                      ? 'text-[var(--ink-muted)]/50'
                      : 'text-[var(--ink-secondary)]'
                  )}
                  aria-label="上一页"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <div
                  role="navigation"
                  aria-label="分页导航"
                  className="no-scrollbar flex min-w-0 max-w-none snap-x snap-proximity items-center gap-1.5 overflow-x-auto overscroll-x-contain scroll-smooth px-1 touch-pan-x [scrollbar-width:none] md:max-w-[520px] md:px-0.5 lg:max-w-none"
                  style={{ WebkitOverflowScrolling: 'touch' }}
                >
                  {paginationItems.map((entry) => {
                    if (typeof entry !== 'number') {
                      return (
                        <span
                          key={entry}
                          aria-hidden="true"
                          className="flex h-10 w-7 flex-shrink-0 items-center justify-center text-xs font-semibold text-[var(--ink-muted)] md:h-8 md:w-7"
                        >
                          ...
                        </span>
                      );
                    }
                    const isActive = entry === page;
                    return (
                      <button
                        key={entry}
                        type="button"
                        onClick={() => {
                          if (!paginationBusy && !isActive) onPageChange?.(entry);
                        }}
                        disabled={paginationBusy}
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
                  onClick={() => onPageChange?.(page + 1)}
                  disabled={paginationBusy || page >= totalPages}
                  className={cn(
                    'admin-module-action-button min-h-0 flex-shrink-0 p-2 disabled:cursor-not-allowed disabled:opacity-50 max-sm:!h-11 max-sm:!min-h-11 max-sm:!w-11',
                    paginationBusy || page >= totalPages
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
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTable;
