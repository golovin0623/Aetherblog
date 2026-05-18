import { useState } from 'react';
import { ChevronUp, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AdminPagination } from './AdminPagination';

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
  const reservedRowCount = total > 0 ? Math.min(pageSize, total) : 0;
  const emptyRowCount = !loading && data.length > 0
    ? Math.max(reservedRowCount - data.length, 0)
    : 0;
  const showLoadingRow = loading && data.length === 0;
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
        <AdminPagination
          page={page}
          pageSize={pageSize}
          total={total}
          totalPages={safeTotalPages}
          pageSizeOptions={pageSizeOptions}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          loading={paginationBusy}
        />
      )}
    </div>
  );
}

export default DataTable;
