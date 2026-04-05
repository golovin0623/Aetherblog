import api from './api';
import { R } from '@/types';

// 对应后端 StatsService.DashboardStats
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
  costStatus: 'archived' | 'realtime' | 'missing';
  pricingMissing: boolean;
  latencyMs: number;
  success: boolean;
  cached: boolean;
  errorCode?: string | null;
  archiveError?: string | null;
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

export interface AiPricingGap {
  providerCode: string;
  modelId: string;
  modelDbId?: number | null;
  displayName: string;
  missingFields: string[];
  calls: number;
  latestUsedAt?: string;
}

export interface AiCostArchiveResult {
  total: number;
  archived: number;
  failed: number;
}

class AnalyticsService {
  // 一次性获取完整的仪表盘数据
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

  async getAiPricingGaps(query: AiDashboardQuery = {}): Promise<R<AiPricingGap[]>> {
    const params = new URLSearchParams();
    if (query.days) params.set('days', String(query.days));
    if (query.taskType) params.set('taskType', query.taskType);
    if (query.modelId) params.set('modelId', query.modelId);
    if (typeof query.success === 'boolean') params.set('success', String(query.success));
    if (query.keyword) params.set('keyword', query.keyword);
    const queryString = params.toString();
    const url = queryString
      ? `/v1/admin/stats/ai-pricing-gaps?${queryString}`
      : '/v1/admin/stats/ai-pricing-gaps';
    return api.get<R<AiPricingGap[]>>(url);
  }

  async archiveAiCosts(payload: Partial<AiDashboardQuery> = {}): Promise<R<AiCostArchiveResult>> {
    return api.post<R<AiCostArchiveResult>>('/v1/admin/stats/ai-cost-archive', payload);
  }
}

export const analyticsService = new AnalyticsService();
export default analyticsService;
