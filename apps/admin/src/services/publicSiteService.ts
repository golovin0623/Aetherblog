import api from './api';
import { R } from '@/types';
import type { SiteBrandingSettings } from '@aetherblog/utils';

export interface PublicSiteInfo extends SiteBrandingSettings {
  site_name?: string;
  siteName?: string;
  siteTitle?: string;
  site_description?: string;
  siteDescription?: string;
  [key: string]: unknown;
}

class PublicSiteService {
  async getInfo(): Promise<PublicSiteInfo> {
    const res = await api.get<R<PublicSiteInfo>>('/v1/public/site/info');
    return res.data || {};
  }
}

export const publicSiteService = new PublicSiteService();
export default publicSiteService;
