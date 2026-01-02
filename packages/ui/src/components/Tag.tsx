import * as React from 'react';
import { cn } from '../utils';
import { X } from 'lucide-react';

interface TagProps {
  children: React.ReactNode;
  color?: string;
  removable?: boolean;
  onRemove?: () => void;
  className?: string;
}

export function Tag({ children, color, removable, onRemove, className }: TagProps) {
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
          onClick={onRemove}
          className="ml-1 p-0.5 rounded-full hover:bg-white/10 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}
