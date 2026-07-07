import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPreferredSiteIconUrl, getSiteIconMimeType } from '@aetherblog/utils';
import { publicSiteService } from '@/services/publicSiteService';
import { PUBLIC_SITE_INFO_QUERY_KEY } from '@/hooks/useSiteBranding';
import { resolveSiteName } from '@/lib/siteBranding';

const INSERTED_ATTR = 'data-aetherblog-inserted-icon';
const DEFAULT_HREF_ATTR = 'data-aetherblog-default-href';
const DEFAULT_REL_ATTR = 'data-aetherblog-default-rel';
const DEFAULT_TYPE_ATTR = 'data-aetherblog-default-type';

function findIconLink(rel: string): HTMLLinkElement | undefined {
  return Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel]'))
    .find((link) => link.relList.contains(rel));
}

function rememberDefaultLinkState(link: HTMLLinkElement, inserted: boolean): void {
  if (inserted) {
    link.setAttribute(INSERTED_ATTR, 'true');
  }

  if (!link.hasAttribute(DEFAULT_HREF_ATTR)) {
    link.setAttribute(DEFAULT_HREF_ATTR, inserted ? '' : link.href);
  }
  if (!link.hasAttribute(DEFAULT_REL_ATTR)) {
    link.setAttribute(DEFAULT_REL_ATTR, inserted ? '' : link.rel);
  }
  if (!link.hasAttribute(DEFAULT_TYPE_ATTR)) {
    link.setAttribute(DEFAULT_TYPE_ATTR, inserted ? '' : (link.getAttribute('type') ?? ''));
  }
}

function applyIconType(link: HTMLLinkElement, rel: string, href: string): void {
  const type = rel === 'icon' ? getSiteIconMimeType(href) : undefined;
  if (type) {
    link.type = type;
  } else {
    link.removeAttribute('type');
  }
}

function upsertIconLink(rel: string, href: string): void {
  const existing = findIconLink(rel);
  const link = existing ?? document.createElement('link');
  const inserted = !existing;

  rememberDefaultLinkState(link, inserted);
  link.rel = rel;
  link.href = href;
  applyIconType(link, rel, href);

  if (inserted) {
    document.head.appendChild(link);
  }
}

function syncFavicon(href: string): void {
  upsertIconLink('icon', href);
  upsertIconLink('apple-touch-icon', href);
}

function resetIconLink(rel: string): void {
  const link = findIconLink(rel);
  if (!link) return;

  if (link.getAttribute(INSERTED_ATTR) === 'true') {
    link.remove();
    return;
  }

  const defaultHref = link.getAttribute(DEFAULT_HREF_ATTR);
  if (!defaultHref) return;

  link.rel = link.getAttribute(DEFAULT_REL_ATTR) || rel;
  link.href = defaultHref;

  const defaultType = link.getAttribute(DEFAULT_TYPE_ATTR);
  if (defaultType) {
    link.type = defaultType;
  } else {
    applyIconType(link, rel, defaultHref);
  }
}

function resetFavicon(): void {
  resetIconLink('icon');
  resetIconLink('apple-touch-icon');
}

export default function AdminFaviconSync() {
  const { data: siteInfo } = useQuery({
    queryKey: PUBLIC_SITE_INFO_QUERY_KEY,
    queryFn: () => publicSiteService.getInfo(),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!siteInfo) return;

    const faviconUrl = getPreferredSiteIconUrl(siteInfo);
    if (!faviconUrl) {
      resetFavicon();
      return;
    }

    syncFavicon(faviconUrl);
  }, [siteInfo]);

  useEffect(() => {
    if (!siteInfo) return;

    document.title = `${resolveSiteName(siteInfo)} Admin`;
  }, [siteInfo]);

  return null;
}
