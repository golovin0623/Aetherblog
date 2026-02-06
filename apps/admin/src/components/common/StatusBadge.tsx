import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const styles = {
    PUBLISHED: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
    DRAFT: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20',
    ARCHIVED: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20',
  };
  const labels: Record<string, string> = { PUBLISHED: '已发布', DRAFT: '草稿', ARCHIVED: '已归档' };

  return (
    <span className={cn('px-1.5 py-0.5 text-xs rounded-full border leading-none font-medium', styles[status as keyof typeof styles] || styles.DRAFT)}>
      {labels[status as keyof typeof labels] || status}
    </span>
  );
}
