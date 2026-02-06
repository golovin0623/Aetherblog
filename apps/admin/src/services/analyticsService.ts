import api from './api';
import { R } from '@/types';

// 匹配后端 StatsService.DashboardStats
export interface DashboardStats {
  posts: number;
  categories: number;
  tags: number;
  comments: number;
  views: number;
  visitors: number;
  totalWords: number;    // 总字数
  aiTokens: number;      // AI总tokens数量
  aiCost: number;        // AI总费用（美元）
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

export interface TrendData {
  posts: number;
  categories: number;
  views: number;
  visitors: number;
  comments: number;
  words: number;
  postsThisMonth: number;
}

export interface DeviceStat {
  name: string;
  value: number;
}

export interface DashboardData {
  stats: DashboardStats;
  topPosts: TopPost[];
  visitorTrend: VisitorTrend[];
  archiveStats: ArchiveStats[];
  deviceStats: DeviceStat[]; // 设备分布
  trends?: TrendData;  // 趋势数据
}

class AnalyticsService {
  // 一次调用获取完整仪表盘数据
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

