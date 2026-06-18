import * as React from 'react';
import { cn } from '../utils';

interface AvatarProps {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

// 安全（VULN-084）：拒绝指向危险 URL 协议的头像。
// `javascript:` / `vbscript:` 会以文档上下文加载；`data:image/svg+xml`
// 可能携带内联脚本。仅允许 http(s) 绝对 URL、同源
// 相对路径，或非 SVG 的 data: URI。
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

  // 轻量字符串校验，useMemo 的 hook 开销大于直接计算，移除。
  const safeSrc = isSafeAvatarSrc(src);

  // 当 src 改变时在渲染阶段同步重置 hasError，避免旧图加载失败后新头像被永久卡在 fallback。
  // 这是 React 官方推荐的「根据 prop 变化调整 state」模式，比 useEffect 少一次渲染周期。
  const [prevSrc, setPrevSrc] = React.useState(src);
  if (src !== prevSrc) {
    setPrevSrc(src);
    setHasError(false);
  }

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
