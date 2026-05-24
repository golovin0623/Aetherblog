import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPreferredFaviconUrl } from '@/lib/siteAssets';
import { publicSiteService } from '@/services/publicSiteService';

function inferFaviconType(href: string): string | undefined {
  const pathname = href.split(/[?#]/, 1)[0].toLowerCase();

  if (pathname.endsWith('.svg') || href.startsWith('data:image/svg+xml')) return 'image/svg+xml';
  if (pathname.endsWith('.ico')) return 'image/x-icon';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.webp')) return 'image/webp';

  return undefined;
}

function upsertIconLink(rel: string, href: string): void {
  const existing = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel]'))
    .find((link) => link.rel.toLowerCase() === rel);
  const link = existing ?? document.createElement('link');

  link.rel = rel;
  link.href = href;

  const type = rel === 'icon' ? inferFaviconType(href) : undefined;
  if (type) {
    link.type = type;
  } else {
    link.removeAttribute('type');
  }

  if (!existing) {
    document.head.appendChild(link);
  }
}

function syncFavicon(href: string): void {
  upsertIconLink('icon', href);
  upsertIconLink('apple-touch-icon', href);
}

export default function AdminFaviconSync() {
  const { data: siteInfo } = useQuery({
    queryKey: ['public-site-info'],
    queryFn: () => publicSiteService.getInfo(),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    const faviconUrl = getPreferredFaviconUrl(siteInfo);
    if (!faviconUrl) return;

    syncFavicon(faviconUrl);
  }, [siteInfo]);

  return null;
}
