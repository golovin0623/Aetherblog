'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

interface AvatarImageProps {
  src: string;
  alt: string;
  /** next/image sizes 提示，如 "96px" */
  sizes: string;
  priority?: boolean;
  unoptimized?: boolean;
  draggable?: boolean;
  /** 头像多为装饰性，配合容器外的可见文字标签时设 true */
  ariaHidden?: boolean;
  /** 透传给 <Image> 的额外类名（object-cover / select-none 等） */
  className?: string;
}

type LoadStatus = 'loading' | 'loaded' | 'error';

// 本会话内已成功加载过的头像 URL。侧栏抽屉是懒挂载（createPortal 仅在打开时
// 渲染），其 AvatarImage 每次打开都全新挂载；首页早已用同一 URL 加载并缓存好，
// 此处据此把后续挂载直接初始化为 loaded —— 不再重放骨架屏/淡入，做到秒开。
const loadedSrcCache = new Set<string>();

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
  unoptimized,
  draggable,
  ariaHidden,
  className,
}: AvatarImageProps) {
  const [status, setStatus] = useState<LoadStatus>(() =>
    loadedSrcCache.has(src) ? 'loaded' : 'loading'
  );
  const imgRef = useRef<HTMLImageElement>(null);

  const markLoaded = () => {
    loadedSrcCache.add(src);
    setStatus('loaded');
  };

  // src 变化时按缓存重置状态；同时探测缓存命中（onLoad 在挂载前已触发的场景），
  // 避免骨架屏在已缓存图片上永久残留。
  useEffect(() => {
    if (loadedSrcCache.has(src)) {
      setStatus('loaded');
      return;
    }
    setStatus('loading');
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      markLoaded();
    }
    // markLoaded 仅依赖 src，闭包稳定，无需进依赖数组
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return (
    <>
      <span
        aria-hidden
        className={`absolute inset-0 agent-skeleton-shimmer pointer-events-none transition-opacity duration-500 ease-out ${
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
          onError={() => setStatus('error')}
          className={`${className ?? ''} transition-opacity duration-500 ease-out ${
            status === 'loaded' ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </>
  );
}
