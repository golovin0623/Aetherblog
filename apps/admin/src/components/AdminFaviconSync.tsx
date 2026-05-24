import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPreferredSiteIconUrl, getSiteIconMimeType } from '@aetherblog/utils';
import { publicSiteService } from '@/services/publicSiteService';

function upsertIconLink(rel: string, href: string): void {
  const existing = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel]'))
    .find((link) => link.relList.contains(rel));
  const link = existing ?? document.createElement('link');

  link.rel = rel;
  link.href = href;

  const type = rel === 'icon' ? getSiteIconMimeType(href) : undefined;
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
    const faviconUrl = getPreferredSiteIconUrl(siteInfo);
    if (!faviconUrl) return;

    syncFavicon(faviconUrl);
  }, [siteInfo]);

  return null;
}
