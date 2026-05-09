import { useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StyledSelect } from './StyledSelect';

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
  loading,
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

  // 页脚的极光态导航按钮 —— DataTable 落在 surface-leaf 上,故 ring-offset 跟随 --bg-leaf。
  const navButtonClass =
    'group relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/60 text-[var(--text-muted)] transition-[transform,border-color,background-color,color,box-shadow,opacity] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-[color-mix(in_oklch,var(--aurora-1)_45%,var(--border-default))] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] hover:shadow-[0_0_0_1px_color-mix(in_oklch,var(--aurora-1)_24%,transparent),0_6px_18px_-8px_color-mix(in_oklch,var(--aurora-1)_55%,transparent)] active:scale-[0.92] disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklch,var(--aurora-1)_60%,transparent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-leaf)]';

  return (
    <div className="surface-leaf surface-dashboard-card rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
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
            {loading ? (
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
              data.map((item) => (
                <tr
                  key={item.id}
                  className="group relative border-b border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] transition-colors"
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
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {(totalPages > 1 || (pageSizeOptions && pageSizeOptions.length > 0 && total > 0)) && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-6 py-4 border-t border-[var(--border-subtle)]">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)] tnum">
            共 <span className="text-[var(--text-secondary)]">{total.toLocaleString()}</span> 条
            <span className="mx-2 text-[var(--ink-subtle,var(--border-default))]">·</span>
            第 <span className="text-[var(--text-secondary)]">{page}</span>
            <span className="opacity-60"> / {Math.max(totalPages, 1)}</span> 页
          </span>
          <div className="flex items-center gap-2">
            {pageSizeOptions && pageSizeOptions.length > 0 && onPageSizeChange && (
              <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                <span className="hidden sm:inline">每页</span>
                <StyledSelect
                  value={String(pageSize)}
                  onChange={(nextValue) => onPageSizeChange(Number(nextValue))}
                  options={pageSizeOptions.map((opt) => ({
                    value: String(opt),
                    label: String(opt),
                  }))}
                  ariaLabel="每页条数"
                  className="w-[72px]"
                  buttonClassName="!h-8 !rounded-lg !px-3 !text-[12px] !font-mono !tracking-wider hover:!shadow-[0_0_0_1px_color-mix(in_oklch,var(--aurora-1)_24%,transparent),0_4px_14px_-6px_color-mix(in_oklch,var(--aurora-1)_45%,transparent)]"
                  menuClassName="!rounded-xl"
                />
              </label>
            )}
            <div className="flex items-center gap-1">
              <button
                onClick={() => onPageChange?.(page - 1)}
                disabled={page <= 1}
                className={navButtonClass}
                aria-label="上一页"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 translate-x-full bg-gradient-to-r from-transparent via-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] to-transparent opacity-0 transition-[transform,opacity] duration-[520ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-x-full group-hover:opacity-100"
                />
                <ChevronLeft className="relative h-4 w-4 transition-transform duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-x-0.5 group-active:-translate-x-1" />
              </button>
              <button
                onClick={() => onPageChange?.(page + 1)}
                disabled={page >= totalPages}
                className={navButtonClass}
                aria-label="下一页"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] to-transparent opacity-0 transition-[transform,opacity] duration-[520ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-full group-hover:opacity-100"
                />
                <ChevronRight className="relative h-4 w-4 transition-transform duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5 group-active:translate-x-1" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTable;
