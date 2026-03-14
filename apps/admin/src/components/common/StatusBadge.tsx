import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const styles = {
    PUBLISHED: 'bg-status-success-light text-status-success border-status-success-border',
    DRAFT: 'bg-status-warning-light text-status-warning border-status-warning-border',
    ARCHIVED: 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border-[var(--border-default)]',
  };
  const labels: Record<string, string> = { PUBLISHED: '已发布', DRAFT: '草稿', ARCHIVED: '已归档' };

  return (
    <span className={cn('px-1.5 py-0.5 text-xs rounded-full border leading-none font-medium', styles[status as keyof typeof styles] || styles.DRAFT)}>
      {labels[status as keyof typeof labels] || status}
    </span>
  );
}
