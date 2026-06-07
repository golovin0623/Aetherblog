import * as React from 'react';
import { cn } from '../utils';
import { X } from 'lucide-react';

interface TagProps {
  children: React.ReactNode;
  color?: string;
  removable?: boolean;
  onRemove?: () => void;
  className?: string;
  removeButtonAriaLabel?: string;
}

export function Tag({
  children,
  color,
  removable,
  onRemove,
  className,
  removeButtonAriaLabel = 'Remove tag',
}: TagProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium',
        'transition-all duration-200',
        className
      )}
      style={{
        backgroundColor: color ? `${color}20` : 'rgba(139, 92, 246, 0.2)',
        color: color || '#8b5cf6',
      }}
    >
      {children}
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeButtonAriaLabel}
          title={removeButtonAriaLabel}
          className="ml-1 p-0.5 rounded-full hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}
