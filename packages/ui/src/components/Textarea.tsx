import * as React from 'react';
import { cn } from '../utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
  helperText?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, helperText, 'aria-describedby': ariaDescribedby, 'aria-invalid': ariaInvalid, ...props }, ref) => {
    const generatedId = React.useId();
    const helperId = helperText ? `${generatedId}-helper` : undefined;
    const describedBy = [ariaDescribedby, helperId].filter(Boolean).join(' ') || undefined;

    return (
      <div className="w-full">
        <textarea
          ref={ref}
          className={cn(
            'w-full px-4 py-2.5 rounded-lg min-h-[100px] resize-y',
            'bg-[var(--bg-card)] border border-[var(--border-default)]',
            'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
            'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary',
            'transition-all duration-200',
            error && 'border-red-500 focus:ring-red-500/50',
            className
          )}
          {...props}
          aria-invalid={error ? true : ariaInvalid}
          aria-describedby={describedBy}
        />
        {helperText && (
          <p id={helperId} className={cn('mt-1.5 text-sm', error ? 'text-red-400' : 'text-[var(--text-muted)]')}>
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
