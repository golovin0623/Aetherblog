import { Check, CircleDashed } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TrackCurationState } from './musicCuration';

interface CurationSignalChainProps {
  state: TrackCurationState;
  compact?: boolean;
  className?: string;
}

export function CurationSignalChain({
  state,
  compact = false,
  className,
}: CurationSignalChainProps) {
  const completeCount = state.steps.length - state.missing.length;
  const accessibleLabel = `策展完成度 ${state.score}%，${completeCount}/${state.steps.length} 个环节完成`;

  return (
    <div
      className={cn('min-w-0', className)}
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <div className="flex items-center gap-1" aria-hidden="true">
        {state.steps.map((step, index) => (
          <div key={step.key} className="contents">
            <span
              className={cn(
                'inline-flex shrink-0 items-center justify-center rounded-full border transition-colors',
                compact ? 'h-5 w-5' : 'h-7 w-7',
                step.complete
                  ? 'border-[color-mix(in_oklch,var(--signal-success)_34%,transparent)] bg-[color-mix(in_oklch,var(--signal-success)_12%,transparent)] text-[var(--signal-success)]'
                  : 'border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] text-[var(--ink-muted)]'
              )}
            >
              {step.complete ? (
                <Check className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} strokeWidth={2.4} />
              ) : (
                <CircleDashed className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} strokeWidth={1.8} />
              )}
            </span>
            {index < state.steps.length - 1 && (
              <span
                className={cn(
                  'h-px min-w-1 flex-1',
                  step.complete
                    ? 'bg-[color-mix(in_oklch,var(--signal-success)_34%,transparent)]'
                    : 'bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]'
                )}
              />
            )}
          </div>
        ))}
      </div>
      {!compact && (
        <div className="mt-2 grid grid-cols-6 gap-1 text-center">
          {state.steps.map((step) => (
            <span
              key={step.key}
              className={cn(
                'truncate text-[9px] font-bold',
                step.complete ? 'text-[var(--ink-secondary)]' : 'text-[var(--ink-muted)]'
              )}
            >
              {step.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
