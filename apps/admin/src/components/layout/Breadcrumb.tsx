import { ChevronRight, Home } from 'lucide-react';
import { Link } from 'react-router-dom';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav className="flex items-center space-x-1 text-sm">
      <Link
        to="/"
        className="flex items-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      >
        <Home className="w-4 h-4" />
      </Link>
      {items.map((item, index) => (
        <div key={index} className="flex items-center">
          <ChevronRight className="w-4 h-4 text-[var(--text-secondary)] mx-1" />
          {item.href ? (
            <Link
              to={item.href}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-[var(--text-tertiary)]">{item.label}</span>
          )}
        </div>
      ))}
    </nav>
  );
}

export default Breadcrumb;
