import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type IntelligenceShellMode = 'standard' | 'workspace' | 'embedded';
type IntelligenceTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

interface IntelligenceShellProps {
  children: ReactNode;
  mode?: IntelligenceShellMode;
  className?: string;
  contentClassName?: string;
}

export function IntelligenceShell({
  children,
  mode = 'standard',
  className,
  contentClassName,
}: IntelligenceShellProps) {
  return (
    <div
      className={cn(
        'intelligence-shell',
        `intelligence-shell-${mode}`,
        mode === 'standard' &&
          '-m-4 min-h-[calc(100%+2rem)] overflow-auto p-4 md:-m-6 md:min-h-[calc(100%+3rem)] md:p-6',
        mode === 'workspace' &&
          '-m-4 h-[calc(100dvh-3.5rem)] min-h-[620px] overflow-hidden p-3 md:-m-6 md:h-[calc(100dvh-4rem)] md:p-5',
        className
      )}
    >
      <div
        className={cn(
          'intelligence-shell-inner',
          mode === 'standard' && 'mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-0 py-2 sm:px-6 sm:py-4 lg:px-8',
          mode === 'workspace' && 'mx-auto flex h-full w-full max-w-[1600px] min-w-0 flex-col gap-3',
          mode === 'embedded' && 'flex min-w-0 flex-col gap-3',
          contentClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}

interface IntelligenceHeaderProps {
  title: string;
  description: string;
  icon?: LucideIcon;
  eyebrow?: string;
  currentLabel?: string;
  activeSummary?: string;
  actions?: ReactNode;
  className?: string;
}

export function IntelligenceHeader({
  title,
  description,
  icon: Icon,
  eyebrow = 'INTELLIGENCE',
  currentLabel,
  activeSummary,
  actions,
  className,
}: IntelligenceHeaderProps) {
  return (
    <header className={cn('intelligence-header', className)} data-has-actions={Boolean(actions)}>
      <div className="intelligence-header-copy">
        {Icon && (
          <span className="intelligence-header-icon" aria-hidden="true">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="intelligence-eyebrow">{eyebrow}</span>
            {currentLabel && <span className="intelligence-current">{currentLabel}</span>}
          </div>
          <h1 className="intelligence-title font-display">{title}</h1>
          <p className="intelligence-description">{description}</p>
          {activeSummary && <p className="intelligence-summary">{activeSummary}</p>}
        </div>
      </div>
      {actions && <div className="intelligence-header-actions">{actions}</div>}
    </header>
  );
}

interface IntelligencePanelProps {
  children: ReactNode;
  title?: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function IntelligencePanel({
  children,
  title,
  description,
  icon: Icon,
  actions,
  className,
  bodyClassName,
}: IntelligencePanelProps) {
  const hasHeader = Boolean(title || description || Icon || actions);
  return (
    <section className={cn('intelligence-panel', className)}>
      {hasHeader && (
        <div className="intelligence-panel-header">
          <div className="flex min-w-0 items-start gap-2.5">
            {Icon && (
              <span className="intelligence-panel-icon" aria-hidden="true">
                <Icon className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0">
              {title && <h2 className="intelligence-panel-title">{title}</h2>}
              {description && <p className="intelligence-panel-description">{description}</p>}
            </div>
          </div>
          {actions && <div className="intelligence-panel-actions">{actions}</div>}
        </div>
      )}
      <div className={cn('intelligence-panel-body', bodyClassName)}>{children}</div>
    </section>
  );
}

interface IntelligenceMetricProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: IntelligenceTone;
  detail?: ReactNode;
  className?: string;
}

export function IntelligenceMetric({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  detail,
  className,
}: IntelligenceMetricProps) {
  return (
    <div className={cn('intelligence-metric', className)} data-tone={tone}>
      <div className="flex items-center gap-2 text-xs text-[var(--intelligence-muted)]">
        {Icon && <Icon className="h-4 w-4" />}
        <span className="truncate">{label}</span>
      </div>
      <div className="intelligence-metric-value">{value}</div>
      {detail && <div className="intelligence-metric-detail">{detail}</div>}
    </div>
  );
}

interface IntelligenceStatusStripProps {
  children: ReactNode;
  tone?: IntelligenceTone;
  icon?: LucideIcon;
  className?: string;
}

export function IntelligenceStatusStrip({
  children,
  tone = 'neutral',
  icon: Icon,
  className,
}: IntelligenceStatusStripProps) {
  return (
    <div className={cn('intelligence-status-strip', className)} data-tone={tone}>
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

interface IntelligenceSegmentedProps<T extends string | number> {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
}

export function IntelligenceSegmented<T extends string | number>({
  value,
  options,
  onChange,
  className,
  ariaLabel,
}: IntelligenceSegmentedProps<T>) {
  return (
    <div className={cn('intelligence-segmented', className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onChange(option.value)}
          data-active={option.value === value}
          className="intelligence-segmented-button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function intelligenceToneStyle(tone: IntelligenceTone): CSSProperties {
  return { '--intelligence-local-tone': `var(--intelligence-tone-${tone})` } as CSSProperties;
}
