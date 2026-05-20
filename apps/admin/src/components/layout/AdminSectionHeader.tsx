import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface AdminSectionHeaderProps {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  className?: string;
}

export function AdminSectionHeader({
  icon,
  title,
  description,
  aside,
  className,
}: AdminSectionHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-4 py-3',
        className
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ink-primary)] text-[var(--bg-void)]">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[var(--ink-primary)]">{title}</p>
          {description && (
            <p className="truncate text-xs text-[var(--ink-muted)]">{description}</p>
          )}
        </div>
      </div>
      {aside && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{aside}</div>}
    </div>
  );
}

export function AdminSectionCount({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-2.5 text-xs font-semibold text-[var(--ink-muted)] sm:h-8">
      {children}
    </span>
  );
}
