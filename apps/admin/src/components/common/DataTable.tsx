import { useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
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
  onSort?: (key: string, direction: 'asc' | 'desc') => void;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
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

  return (
    <div className="bg-[var(--bg-card)] backdrop-blur-sm border border-[var(--border-subtle)] rounded-xl overflow-hidden">
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
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-subtle)]">
          <span className="font-mono text-[11px] tracking-wider text-[var(--text-muted)] tnum">
            共 {total} 条,第 {page}/{totalPages} 页
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange?.(page - 1)}
              disabled={page <= 1}
              className="p-2 rounded-lg hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="上一页"
            >
              <ChevronLeft className="w-4 h-4 text-[var(--text-muted)]" />
            </button>
            <button
              onClick={() => onPageChange?.(page + 1)}
              disabled={page >= totalPages}
              className="p-2 rounded-lg hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="下一页"
            >
              <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTable;
