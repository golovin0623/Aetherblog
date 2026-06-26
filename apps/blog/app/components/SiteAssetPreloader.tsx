'use client';

import { useEffect, useMemo } from 'react';
import { preloadCachedImage } from '@aetherblog/hooks';
import type { SiteSettings } from '../lib/services';
import { extractSocialLinks } from '../lib/socialLinks';
import { sanitizeImageUrl } from '../lib/sanitizeUrl';

const AUTHOR_AVATAR_FALLBACK =
  'https://cravatar.cn/avatar/00000000000000000000000000000000?d=mp&s=200';
const MAX_PRELOADED_SOCIAL_ICON_URLS = 16;
const IMAGE_WARM_TIMEOUT_MS = 20_000;
const SOCIAL_ICON_WARM_TIMEOUT_MS = 8_000;

function uniqueImageUrls(urls: Array<string | undefined | null>, limit = Number.POSITIVE_INFINITY) {
  const seen = new Set<string>();

  for (const url of urls) {
    const normalized = (url ?? '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    if (seen.size >= limit) break;
  }

  return Array.from(seen);
}

function scheduleIdle(task: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(task, { timeout: 1_500 });
    return () => window.cancelIdleCallback(id);
  }

  const id = window.setTimeout(task, 120);
  return () => window.clearTimeout(id);
}

function warmImage(src: string, timeoutMs: number) {
  preloadCachedImage(src, { timeoutMs }).catch(() => undefined);
}

interface SiteAssetPreloaderProps {
  settings: SiteSettings;
}

export default function SiteAssetPreloader({ settings }: SiteAssetPreloaderProps) {
  const avatarUrl = useMemo(
    () =>
      sanitizeImageUrl(
        settings.authorAvatar || settings.author_avatar || '',
        AUTHOR_AVATAR_FALLBACK,
      ),
    [settings.authorAvatar, settings.author_avatar],
  );

  const socialIconUrls = useMemo(() => {
    const socialLinks = extractSocialLinks(settings);
    return uniqueImageUrls(
      socialLinks.flatMap((link) => [link.iconUrl, link.iconUrlDark]),
      MAX_PRELOADED_SOCIAL_ICON_URLS,
    );
  }, [settings]);

  useEffect(() => {
    warmImage(avatarUrl, IMAGE_WARM_TIMEOUT_MS);
  }, [avatarUrl]);

  useEffect(() => {
    if (socialIconUrls.length === 0) return undefined;

    return scheduleIdle(() => {
      socialIconUrls.forEach((url) => warmImage(url, SOCIAL_ICON_WARM_TIMEOUT_MS));
    });
  }, [socialIconUrls]);

  return null;
}
