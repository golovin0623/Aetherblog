import api from './api';
import { R } from '@/types';

// Match backend StatsService.DashboardStats
export interface DashboardStats {
  posts: number;
  categories: number;
  tags: number;
  comments: number;
  views: number;
  visitors: number;
}

export interface TopPost {
  id: number;
  title: string;
  viewCount: number;
}

export interface VisitorTrend {
  date: string;
  pv: number;
  uv: number;
}

export interface ArchiveStats {
  yearMonth: string;
  count: number;
}

export interface DashboardData {
  stats: DashboardStats;
  topPosts: TopPost[];
  visitorTrend: VisitorTrend[];
  archiveStats: ArchiveStats[];
}

class AnalyticsService {
  // Get complete dashboard data in one call
  async getDashboard(): Promise<R<DashboardData>> {
    return api.get<R<DashboardData>>('/v1/admin/stats/dashboard');
  }

  async getTopPosts(limit: number = 10): Promise<R<TopPost[]>> {
    return api.get<R<TopPost[]>>(`/v1/admin/stats/top-posts?limit=${limit}`);
  }

  async getVisitorTrend(days: number = 7): Promise<R<VisitorTrend[]>> {
    return api.get<R<VisitorTrend[]>>(`/v1/admin/stats/visitor-trend?days=${days}`);
  }

  async getArchiveStats(): Promise<R<ArchiveStats[]>> {
    return api.get<R<ArchiveStats[]>>('/v1/admin/stats/archives');
  }
}

export const analyticsService = new AnalyticsService();
export default analyticsService;

