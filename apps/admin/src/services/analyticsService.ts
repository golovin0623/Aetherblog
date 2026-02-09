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

export interface AiOverview {
  totalCalls: number;
  successCalls: number;
  errorCalls: number;
  successRate: number;
  cacheHitRate: number;
  totalTokens: number;
  totalCost: number;
  avgTokensPerCall: number;
  avgCostPerCall: number;
  avgLatencyMs: number;
}

export interface AiTrendPoint {
  date: string;
  calls: number;
  tokens: number;
  cost: number;
}

export interface AiModelDistribution {
  model: string;
  providerCode: string;
  calls: number;
  percentage: number;
  tokens: number;
  cost: number;
}

export interface AiTaskDistribution {
  task: string;
  calls: number;
  percentage: number;
  tokens: number;
  cost: number;
}

export interface AiCallRecord {
  id: number;
  taskType: string;
  providerCode: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  cost: number;
  latencyMs: number;
  success: boolean;
  cached: boolean;
  errorCode?: string | null;
  createdAt: string;
}

export interface AiRecordsPage {
  list: AiCallRecord[];
  pageNum: number;
  pageSize: number;
  total: number;
  pages: number;
}

export interface AiDashboardData {
  rangeDays: number;
  overview: AiOverview;
  trend: AiTrendPoint[];
  modelDistribution: AiModelDistribution[];
  taskDistribution: AiTaskDistribution[];
  records: AiRecordsPage;
}

export interface AiDashboardQuery {
  days?: number;
  pageNum?: number;
  pageSize?: number;
  taskType?: string;
  modelId?: string;
  success?: boolean;
  keyword?: string;
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

  async getAiDashboard(query: AiDashboardQuery = {}): Promise<R<AiDashboardData>> {
    const params = new URLSearchParams();
    if (query.days) params.set('days', String(query.days));
    if (query.pageNum) params.set('pageNum', String(query.pageNum));
    if (query.pageSize) params.set('pageSize', String(query.pageSize));
    if (query.taskType) params.set('taskType', query.taskType);
    if (query.modelId) params.set('modelId', query.modelId);
    if (typeof query.success === 'boolean') params.set('success', String(query.success));
    if (query.keyword) params.set('keyword', query.keyword);

    const queryString = params.toString();
    const url = queryString
      ? `/v1/admin/stats/ai-dashboard?${queryString}`
      : '/v1/admin/stats/ai-dashboard';

    return api.get<R<AiDashboardData>>(url);
  }
}

export const analyticsService = new AnalyticsService();
export default analyticsService;
