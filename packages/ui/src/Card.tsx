import { cn } from './utils';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

export function Card({ children, className, hover }: CardProps) {
  return (
    <div
      className={cn(
        'p-6 rounded-xl',
        'bg-[var(--bg-card)] backdrop-blur-sm border border-[var(--border-default)]',
        hover && 'hover:border-[var(--border-hover)] transition-all cursor-pointer',
        className
      )}
    >
      {children}
    </div>
  );
}

Card.Header = function CardHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between mb-4', className)}>
      {children}
    </div>
  );
};

Card.Title = function CardTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-lg font-medium text-[var(--text-primary)]">{children}</h3>;
};

Card.Content = function CardContent({ children }: { children: React.ReactNode }) {
  return <div className="text-[var(--text-secondary)]">{children}</div>;
};
