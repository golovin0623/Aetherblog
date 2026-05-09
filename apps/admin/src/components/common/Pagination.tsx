import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize);
  
  const getVisiblePages = () => {
    const pages: (number | string)[] = [];
    const delta = 2;
    
    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= page - delta && i <= page + delta)
      ) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== '...') {
        pages.push('...');
      }
    }
    
    return pages;
  };

  if (totalPages <= 1) return null;

  const navButtonClass =
    'group relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/60 text-[var(--text-muted)] transition-[transform,border-color,background-color,color,box-shadow,opacity] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-[color-mix(in_oklch,var(--aurora-1)_45%,var(--border-default))] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] hover:shadow-[0_0_0_1px_color-mix(in_oklch,var(--aurora-1)_24%,transparent),0_6px_18px_-8px_color-mix(in_oklch,var(--aurora-1)_55%,transparent)] active:scale-[0.92] disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklch,var(--aurora-1)_60%,transparent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]';

  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-1.5">
      <button
        onClick={() => onPageChange(page - 1)}
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

      {getVisiblePages().map((p, index) =>
        typeof p === 'number' ? (
          <button
            key={index}
            onClick={() => onPageChange(p)}
            aria-label={`第 ${p} 页`}
            aria-current={p === page ? 'page' : undefined}
            className={
              p === page
                ? 'relative flex h-8 min-w-[2rem] items-center justify-center rounded-lg border border-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_18%,var(--bg-secondary))] px-2.5 font-mono text-[12px] tnum tracking-wider text-[var(--text-primary)] shadow-[0_0_0_1px_color-mix(in_oklch,var(--aurora-1)_28%,transparent),0_8px_22px_-10px_color-mix(in_oklch,var(--aurora-1)_70%,transparent)] transition-all duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)]'
                : 'group relative flex h-8 min-w-[2rem] items-center justify-center overflow-hidden rounded-lg border border-transparent bg-transparent px-2.5 font-mono text-[12px] tnum tracking-wider text-[var(--text-muted)] transition-[transform,border-color,background-color,color,box-shadow] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklch,var(--aurora-1)_50%,transparent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]'
            }
          >
            {p}
          </button>
        ) : (
          <span
            key={index}
            className="px-1 font-mono text-[12px] tracking-wider text-[var(--text-muted)] opacity-60"
            aria-hidden="true"
          >
            {p}
          </span>
        )
      )}

      <button
        onClick={() => onPageChange(page + 1)}
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
    </nav>
  );
}

export default Pagination;
