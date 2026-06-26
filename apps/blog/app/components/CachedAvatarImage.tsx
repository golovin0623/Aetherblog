'use client';

import type { ImgHTMLAttributes, ReactNode } from 'react';
import {
  markCachedImageFailed,
  markCachedImageLoaded,
  useCachedImage,
} from '@aetherblog/hooks';

interface CachedAvatarImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string | null;
  fallback?: ReactNode;
  preload?: boolean;
  timeoutMs?: number;
}

export function CachedAvatarImage({
  src,
  alt,
  className,
  fallback = null,
  timeoutMs,
  onLoad,
  onError,
  loading = 'eager',
  decoding = 'async',
  preload = true,
  ...props
}: CachedAvatarImageProps) {
  const normalizedSrc = (src ?? '').trim();
  const cachedImage = useCachedImage(normalizedSrc, {
    enabled: Boolean(normalizedSrc),
    preload,
    timeoutMs,
  });

  if (!normalizedSrc || cachedImage.isError) return <>{fallback}</>;

  return (
    <img
      {...props}
      src={normalizedSrc}
      alt={alt}
      className={className}
      loading={loading}
      decoding={decoding}
      onLoad={(event) => {
        const image = event.currentTarget;
        markCachedImageLoaded(
          normalizedSrc,
          image.naturalWidth || undefined,
          image.naturalHeight || undefined,
        );
        onLoad?.(event);
      }}
      onError={(event) => {
        markCachedImageFailed(normalizedSrc);
        onError?.(event);
      }}
    />
  );
}
