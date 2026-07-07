import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { publicSiteService, type PublicSiteInfo } from '@/services/publicSiteService';
import { resolveSiteDescription, resolveSiteLogo, resolveSiteName } from '@/lib/siteBranding';

export const PUBLIC_SITE_INFO_QUERY_KEY = ['public-site-info'] as const;

export interface SiteBranding {
  siteInfo?: PublicSiteInfo;
  siteName: string;
  siteDescription: string;
  siteLogo: string;
}

export function useSiteBranding(): SiteBranding {
  const { data: siteInfo } = useQuery({
    queryKey: PUBLIC_SITE_INFO_QUERY_KEY,
    queryFn: () => publicSiteService.getInfo(),
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => ({
    siteInfo,
    siteName: resolveSiteName(siteInfo),
    siteDescription: resolveSiteDescription(siteInfo),
    siteLogo: resolveSiteLogo(siteInfo),
  }), [siteInfo]);
}
