'use client';

import { useEffect, useState } from 'react';

export type CachedImageStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface CachedImageSnapshot {
  status: CachedImageStatus;
  width?: number;
  height?: number;
}

interface CacheEntry extends CachedImageSnapshot {
  promise?: Promise<CachedImageSnapshot>;
}

interface UseCachedImageOptions {
  enabled?: boolean;
  preload?: boolean;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const imageCache = new Map<string, CacheEntry>();
const listeners = new Map<string, Set<() => void>>();

function getSnapshot(src: string): CachedImageSnapshot {
  if (!src) return { status: 'idle' };
  const cached = imageCache.get(src);
  if (!cached) return { status: 'idle' };
  return {
    status: cached.status,
    width: cached.width,
    height: cached.height,
  };
}

function notify(src: string) {
  listeners.get(src)?.forEach((listener) => listener());
}

function subscribe(src: string, listener: () => void): () => void {
  const set = listeners.get(src) ?? new Set<() => void>();
  set.add(listener);
  listeners.set(src, set);

  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(src);
  };
}

export function markCachedImageLoaded(src: string, width?: number, height?: number): void {
  const normalized = src.trim();
  if (!normalized) return;
  imageCache.set(normalized, {
    status: 'loaded',
    width,
    height,
  });
  notify(normalized);
}

export function markCachedImageFailed(src: string): void {
  const normalized = src.trim();
  if (!normalized) return;
  imageCache.set(normalized, { status: 'error' });
  notify(normalized);
}

export function preloadCachedImage(
  src: string,
  options: Pick<UseCachedImageOptions, 'timeoutMs'> = {},
): Promise<CachedImageSnapshot> {
  const normalized = src.trim();
  if (!normalized) return Promise.resolve({ status: 'idle' });

  const cached = imageCache.get(normalized);
  if (cached?.status === 'loaded') return Promise.resolve(getSnapshot(normalized));
  if (cached?.status === 'loading' && cached.promise) return cached.promise;
  if (typeof window === 'undefined') return Promise.resolve(getSnapshot(normalized));

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // 先建立 'loading' 缓存条目，再启动加载与同步命中检测。
  // 浏览器缓存命中时 image.complete 可能在赋值 src 后同步为真，导致 resolveLoaded()
  // 在此函数内同步执行并把状态标记为 'loaded'；若把 imageCache.set('loading') 放在
  // 最后会反过来覆盖回 'loading'，使该条目永远停在加载态。
  let resolvePromise!: (value: CachedImageSnapshot) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<CachedImageSnapshot>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  imageCache.set(normalized, { status: 'loading', promise });
  notify(normalized);
  promise.catch(() => undefined);

  const image = new window.Image();
  let settled = false;

  const cleanup = () => {
    image.onload = null;
    image.onerror = null;
  };

  const timer = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    cleanup();
    markCachedImageFailed(normalized);
    rejectPromise(new Error(`Image load timed out: ${normalized}`));
  }, timeoutMs);

  const resolveLoaded = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    const width = image.naturalWidth || undefined;
    const height = image.naturalHeight || undefined;
    cleanup();
    markCachedImageLoaded(normalized, width, height);
    resolvePromise({ status: 'loaded', width, height });
  };

  image.onload = resolveLoaded;

  image.onerror = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    cleanup();
    markCachedImageFailed(normalized);
    rejectPromise(new Error(`Image load failed: ${normalized}`));
  };

  image.decoding = 'async';
  image.src = normalized;

  if (image.complete && image.naturalWidth > 0) {
    resolveLoaded();
  }

  return promise;
}

export function useCachedImage(
  src: string | null | undefined,
  options: UseCachedImageOptions = {},
) {
  // ⚡ Bolt: Removed useMemo because trimming a string is trivial and hook overhead exceeds GC savings.
  const normalizedSrc = (src ?? '').trim();
  const enabled = options.enabled ?? true;
  const preload = options.preload ?? true;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const [prevSrc, setPrevSrc] = useState(normalizedSrc);
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  const [snapshot, setSnapshot] = useState<CachedImageSnapshot>(() =>
    normalizedSrc && enabled ? getSnapshot(normalizedSrc) : { status: 'idle' },
  );

  let currentSnapshot = snapshot;
  if (normalizedSrc !== prevSrc || enabled !== prevEnabled) {
    currentSnapshot = normalizedSrc && enabled ? getSnapshot(normalizedSrc) : { status: 'idle' };
    setPrevSrc(normalizedSrc);
    setPrevEnabled(enabled);
    setSnapshot(currentSnapshot);
  }

  useEffect(() => {
    if (!normalizedSrc || !enabled) {
      return undefined;
    }

    const unsubscribe = subscribe(normalizedSrc, () => {
      setSnapshot(getSnapshot(normalizedSrc));
    });
    setSnapshot(getSnapshot(normalizedSrc));

    if (preload) {
      preloadCachedImage(normalizedSrc, { timeoutMs }).catch(() => undefined);
    }
    return unsubscribe;
  }, [enabled, normalizedSrc, preload, timeoutMs]);

  return {
    ...currentSnapshot,
    src: normalizedSrc,
    isIdle: currentSnapshot.status === 'idle',
    isLoading: currentSnapshot.status === 'loading',
    isLoaded: currentSnapshot.status === 'loaded',
    isError: currentSnapshot.status === 'error',
  };
}
