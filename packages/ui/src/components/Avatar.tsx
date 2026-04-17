import * as React from 'react';
import { cn } from '../utils';

interface AvatarProps {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

// SECURITY (VULN-084): reject avatars that point at dangerous URL schemes.
// `javascript:` / `vbscript:` load as document context; `data:image/svg+xml`
// can carry inline scripts. Only allow http(s) absolute URLs, same-origin
// relative paths, or non-SVG data: URIs.
function isSafeAvatarSrc(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  if (trimmed.startsWith('data:image/') && !/svg\+xml/i.test(trimmed)) return trimmed;
  return undefined;
}

export function Avatar({ src, alt, fallback, size = 'md', className }: AvatarProps) {
  const [hasError, setHasError] = React.useState(false);

  const safeSrc = React.useMemo(() => isSafeAvatarSrc(src), [src]);

  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
    xl: 'w-16 h-16 text-lg',
  };

  const getFallbackText = () => {
    if (fallback) return fallback.slice(0, 2).toUpperCase();
    if (alt) return alt.slice(0, 2).toUpperCase();
    return '?';
  };

  return (
    <div
      className={cn(
        'relative rounded-full overflow-hidden bg-gradient-to-br from-primary/50 to-purple-500/50',
        'flex items-center justify-center font-medium text-white',
        sizeClasses[size],
        className
      )}
    >
      {safeSrc && !hasError ? (
        <img
          src={safeSrc}
          alt={alt}
          className="w-full h-full object-cover"
          onError={() => setHasError(true)}
        />
      ) : (
        <span>{getFallbackText()}</span>
      )}
    </div>
  );
}
