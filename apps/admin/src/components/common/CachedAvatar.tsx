import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import {
  markCachedImageFailed,
  markCachedImageLoaded,
  useCachedImage,
} from '@/hooks';

interface CachedAvatarProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string | null;
  fallback: ReactNode;
  timeoutMs?: number;
}

export function CachedAvatar({
  src,
  alt,
  className,
  fallback,
  timeoutMs,
  onLoad,
  onError,
  loading = 'eager',
  decoding = 'async',
  ...props
}: CachedAvatarProps) {
  const normalizedSrc = (src ?? '').trim();
  const cachedImage = useCachedImage(normalizedSrc, {
    enabled: Boolean(normalizedSrc),
    preload: false,
    timeoutMs,
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [normalizedSrc]);

  if (!normalizedSrc || failed || cachedImage.isError) {
    return <>{fallback}</>;
  }

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
        setFailed(true);
        markCachedImageFailed(normalizedSrc);
        onError?.(event);
      }}
    />
  );
}
