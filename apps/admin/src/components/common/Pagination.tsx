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

  return (
    <div className="flex items-center justify-center gap-2">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft className="w-4 h-4 text-gray-400" />
      </button>

      {getVisiblePages().map((p, index) =>
        typeof p === 'number' ? (
          <button
            key={index}
            onClick={() => onPageChange(p)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              p === page
                ? 'bg-primary text-white'
                : 'text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            {p}
          </button>
        ) : (
          <span key={index} className="text-gray-500">
            {p}
          </span>
        )
      )}

      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight className="w-4 h-4 text-gray-400" />
      </button>
    </div>
  );
}

export default Pagination;
