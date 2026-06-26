'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import {
  markCachedImageFailed,
  markCachedImageLoaded,
  useCachedImage,
} from '@aetherblog/hooks';

interface AvatarImageProps {
  src: string;
  alt: string;
  /** next/image sizes 提示，如 "96px" */
  sizes: string;
  priority?: boolean;
  preload?: boolean;
  unoptimized?: boolean;
  draggable?: boolean;
  /** 头像多为装饰性，配合容器外的可见文字标签时设 true */
  ariaHidden?: boolean;
  /** 透传给 <Image> 的额外类名（object-cover / select-none 等） */
  className?: string;
}

type LoadStatus = 'loading' | 'loaded' | 'error';

/**
 * 头像图片：骨架屏 shimmer 占位 + 加载完成淡入。
 *
 * 设计系统 §3.6 禁止 spinner —— 用 `.agent-skeleton-shimmer`（aurora 扫光、
 * 自动适配明暗、prefers-reduced-motion 下停动）作占位，图片解码后淡入，
 * 消除「空白圆 → 突然弹出」的卡顿观感。首次出现才有动画，同一 URL 的后续
 * 挂载（如打开侧栏）直接秒显。
 *
 * 必须放在一个 `relative overflow-hidden` 的定尺容器内（fill 模式）。
 */
export default function AvatarImage({
  src,
  alt,
  sizes,
  priority,
  preload = true,
  unoptimized,
  draggable,
  ariaHidden,
  className,
}: AvatarImageProps) {
  const cachedImage = useCachedImage(src, { enabled: Boolean(src), preload });
  const cachedStatus: LoadStatus = cachedImage.isError
    ? 'error'
    : cachedImage.isLoaded
      ? 'loaded'
      : 'loading';
  const [prevSrc, setPrevSrc] = useState(src);
  const [status, setStatus] = useState<LoadStatus>(() => cachedStatus);
  const imgRef = useRef<HTMLImageElement>(null);

  if (src !== prevSrc) {
    setPrevSrc(src);
    setStatus(cachedStatus);
  }

  useEffect(() => {
    setStatus(cachedStatus);
  }, [cachedStatus, src]);

  // 探测缓存命中（onLoad 在 React 绑定事件前已触发的场景），避免骨架屏在
  // 已缓存图片上永久残留。
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      markCachedImageLoaded(src, img.naturalWidth || undefined, img.naturalHeight || undefined);
      setStatus('loaded');
    }
  }, [src]);

  const markLoaded = () => {
    const image = imgRef.current;
    markCachedImageLoaded(src, image?.naturalWidth || undefined, image?.naturalHeight || undefined);
    setStatus('loaded');
  };

  return (
    <>
      <span
        aria-hidden
        className={`!absolute inset-0 agent-skeleton-shimmer pointer-events-none transition-opacity duration-500 ease-out ${
          status === 'loading' ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {status !== 'error' && (
        <Image
          ref={imgRef}
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          unoptimized={unoptimized}
          draggable={draggable}
          aria-hidden={ariaHidden}
          onLoad={markLoaded}
          onError={() => {
            markCachedImageFailed(src);
            setStatus('error');
          }}
          className={`${className ?? ''} transition-opacity duration-500 ease-out ${
            status === 'loaded' ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </>
  );
}
