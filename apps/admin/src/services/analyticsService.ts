import api from './api';

export interface SiteStats {
  posts: number;
  categories: number;
  tags: number;
  comments: number;
  views: number;
}

export interface VisitorStats {
  date: string;
  pv: number;
  uv: number;
}

export interface TopPost {
  id: number;
  title: string;
  views: number;
}

export interface DeviceStats {
  device: string;
  count: number;
  percentage: number;
}

class AnalyticsService {
  async getSiteStats(): Promise<SiteStats> {
    const response = await api.get('/v1/analytics/stats');
    return response.data.data;
  }

  async getVisitorTrend(days: number = 7): Promise<VisitorStats[]> {
    const response = await api.get(`/v1/analytics/visitors?days=${days}`);
    return response.data.data;
  }

  async getTopPosts(limit: number = 10): Promise<TopPost[]> {
    const response = await api.get(`/v1/analytics/top-posts?limit=${limit}`);
    return response.data.data;
  }

  async getDeviceStats(): Promise<DeviceStats[]> {
    const response = await api.get('/v1/analytics/devices');
    return response.data.data;
  }

  async getGeoDistribution(): Promise<Record<string, number>> {
    const response = await api.get('/v1/analytics/geo');
    return response.data.data;
  }
}

export const analyticsService = new AnalyticsService();
export default analyticsService;
