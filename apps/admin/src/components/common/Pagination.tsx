import { AdminPagination } from './AdminPagination';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  className?: string;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  itemLabel = '条',
  className,
}: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize);

  if (totalPages <= 1) return null;

  return (
    <AdminPagination
      page={page}
      pageSize={pageSize}
      total={total}
      totalPages={totalPages}
      onPageChange={onPageChange}
      itemLabel={itemLabel}
      className={className}
    />
  );
}

export default Pagination;
