import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, Users, Eye, MessageSquare, Clock, FolderTree, FileType, Cpu, DollarSign, RefreshCw } from 'lucide-react';
import { 
  StatsCard, 
  VisitorChart, 
  TopPosts, 
  DeviceChart, 
  SystemStatus,
  RecentActivity,
  SystemTrends,
  ContainerStatus,
  RealtimeLogViewer,
  AiUsageTrendChart,
  AiModelDistributionChart,
  AiUsageRecordsTable
} from './components';
import {
  analyticsService,
  DashboardData,
  type AiDashboardData,
  type AiCallRecord,
} from '@/services/analyticsService';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const AI_DASHBOARD_PAGE_SIZE = 20;

const EMPTY_AI_DASHBOARD: AiDashboardData = {
  rangeDays: 30,
  overview: {
    totalCalls: 0,
    successCalls: 0,
    errorCalls: 0,
    successRate: 0,
    cacheHitRate: 0,
    totalTokens: 0,
    totalCost: 0,
    avgTokensPerCall: 0,
    avgCostPerCall: 0,
    avgLatencyMs: 0,
  },
  trend: [],
  modelDistribution: [],
  taskDistribution: [],
  records: {
    list: [],
    pageNum: 1,
    pageSize: AI_DASHBOARD_PAGE_SIZE,
    total: 0,
    pages: 0,
  },
};

function uniqueBy<T>(items: T[], mapper: (item: T) => string): string[] {
  return Array.from(new Set(items.map(mapper).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function extractApiIssue(error: unknown): { message: string; category?: string } {
  if (typeof error === 'object' && error) {
    const message = 'message' in error ? String((error as { message?: unknown }).message || '请求失败') : '请求失败';
    const category = 'errorCategory' in error
      ? String((error as { errorCategory?: unknown }).errorCategory || '')
      : '';
    return { message, category: category || undefined };
  }
  return { message: '请求失败' };
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardData | null>(null);
  const [timeRange, setTimeRange] = useState<'7d' | '30d'>('7d');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiData, setAiData] = useState<AiDashboardData>(EMPTY_AI_DASHBOARD);
  const [aiDays, setAiDays] = useState<7 | 30 | 90>(30);
  const [aiPage, setAiPage] = useState(1);
  const [aiTaskType, setAiTaskType] = useState('');
  const [aiModelId, setAiModelId] = useState('');
  const [aiKeyword, setAiKeyword] = useState('');
  const [aiSuccessFilter, setAiSuccessFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [aiStatus, setAiStatus] = useState<'healthy' | 'degraded'>('healthy');
  const [aiIssueMessage, setAiIssueMessage] = useState('');
  const [aiIssueCategory, setAiIssueCategory] = useState<string | undefined>();
  const [aiLastSuccessAt, setAiLastSuccessAt] = useState<Date | null>(null);
  const [aiReloadTick, setAiReloadTick] = useState(0);
  
  // 容器日志状态
  const [selectedContainer, setSelectedContainer] = useState<{id: string, name: string}>({id: '', name: ''});

  const handleContainerSelect = (id: string, name: string) => {
    setSelectedContainer({id, name});
  };

  // 模拟数据用于回退或初始开发
  const mockData: DashboardData = {
    stats: {
      posts: 128,
      categories: 12,
      tags: 34,
      comments: 567,
      views: 45678,
      visitors: 12453,
      totalWords: 256789,
      aiTokens: 1234567,
      aiCost: 12.34
    },
    topPosts: [
      { id: 1, title: 'Spring Boot 3.0 新特性详解', viewCount: 3456 },
      { id: 2, title: 'React 19 Server Components 实战', viewCount: 2890 },
      { id: 3, title: '使用 AI 提升开发效率的 10 个技巧', viewCount: 2341 },
      { id: 4, title: 'PostgreSQL 性能优化指南', viewCount: 1987 },
      { id: 5, title: 'Docker Compose 多容器部署实践', viewCount: 1654 },
    ],
    visitorTrend: Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - i));
      return {
        date: date.toISOString().split('T')[0],
        pv: Math.floor(Math.random() * 1000) + 1000,
        uv: Math.floor(Math.random() * 500) + 500
      };
    }),
    archiveStats: [],
    deviceStats: [
      { name: '桌面端', value: 850 },
      { name: '移动端', value: 420 },
      { name: '平板', value: 50 },
      { name: '其他', value: 30 }
    ]
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // 调用真实 API
        const res = await analyticsService.getDashboard();
        if (res.code === 200 && res.data) {
          setData(res.data);
        } else {
          // 如果 API 失败，回退到模拟数据
          logger.warn('Dashboard API returned non-200, using mock data');
          setData(mockData);
        }
      } catch (err) {
        logger.error('Failed to fetch dashboard data:', err);
        toast.error('加载仪表盘数据失败，显示演示数据');
        setData(mockData); // 回退
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    const fetchAiDashboard = async () => {
      try {
        setAiLoading(true);
        const success = aiSuccessFilter === 'all'
          ? undefined
          : aiSuccessFilter === 'success';

        const response = await analyticsService.getAiDashboard({
          days: aiDays,
          pageNum: aiPage,
          pageSize: AI_DASHBOARD_PAGE_SIZE,
          taskType: aiTaskType || undefined,
          modelId: aiModelId || undefined,
          success,
          keyword: aiKeyword.trim() || undefined,
        });

        if (response.code === 200 && response.data) {
          setAiData(response.data);
          setAiStatus('healthy');
          setAiIssueMessage('');
          setAiIssueCategory(undefined);
          setAiLastSuccessAt(new Date());
        } else {
          logger.warn('AI dashboard API returned degraded response', response);
          setAiStatus('degraded');
          setAiIssueMessage(response.message || 'AI 看板请求失败');
          setAiIssueCategory(response.errorCategory);
        }
      } catch (error) {
        logger.error('Failed to fetch AI dashboard:', error);
        const issue = extractApiIssue(error);
        setAiStatus('degraded');
        setAiIssueMessage(issue.message || 'AI 看板请求失败');
        setAiIssueCategory(issue.category);
      } finally {
        setAiLoading(false);
      }
    };

    fetchAiDashboard();
  }, [aiDays, aiPage, aiTaskType, aiModelId, aiSuccessFilter, aiKeyword, aiReloadTick]);

  // 当时间范围改变时重新获取访客趋势
  const [trendLoading, setTrendLoading] = useState(false);
  const [visitorTrend, setVisitorTrend] = useState<typeof mockData.visitorTrend | null>(null);

  useEffect(() => {
    const fetchTrendData = async () => {
      const days = timeRange === '7d' ? 7 : 30;
      try {
        setTrendLoading(true);
        const res = await analyticsService.getVisitorTrend(days);
        if (res.code === 200 && res.data) {
          setVisitorTrend(res.data);
        } else {
          // 为选定范围生成回退模拟数据
          const fallbackData = Array.from({ length: days }, (_, i) => {
            const date = new Date();
            date.setDate(date.getDate() - (days - 1 - i));
            return {
              date: date.toISOString().split('T')[0],
              pv: Math.floor(Math.random() * 1000) + 500,
              uv: Math.floor(Math.random() * 500) + 200
            };
          });
          setVisitorTrend(fallbackData);
        }
      } catch (err) {
        logger.error(`Failed to fetch ${days}-day visitor trend:`, err);
        // 生成回退模拟数据
        const fallbackData = Array.from({ length: days }, (_, i) => {
          const date = new Date();
          date.setDate(date.getDate() - (days - 1 - i));
          return {
            date: date.toISOString().split('T')[0],
            pv: Math.floor(Math.random() * 1000) + 500,
            uv: Math.floor(Math.random() * 500) + 200
          };
        });
        setVisitorTrend(fallbackData);
      } finally {
        setTrendLoading(false);
      }
    };
    fetchTrendData();
  }, [timeRange]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        {/* 头部骨架 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-2">
            <div className="h-8 w-32 bg-[var(--bg-secondary)] rounded animate-pulse" />
            <div className="h-4 w-48 bg-[var(--bg-secondary)] rounded animate-pulse" />
          </div>
          <div className="h-8 w-32 bg-[var(--bg-secondary)] rounded animate-pulse" />
        </div>

        {/* 统计网格骨架 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] h-[140px] relative overflow-hidden">
              {/* 闪光效果 */}
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-[var(--bg-card-hover)] to-transparent" />
              <div className="flex justify-between items-start">
                <div className="space-y-3 flex-1">
                  <div className="h-4 w-20 bg-[var(--bg-secondary)] rounded animate-pulse" />
                  <div className="h-8 w-24 bg-[var(--bg-secondary)] rounded animate-pulse" />
                  <div className="h-3 w-16 bg-[var(--bg-secondary)] rounded animate-pulse" />
                </div>
                <div className="w-10 h-10 bg-[var(--bg-secondary)] rounded-lg animate-pulse" />
              </div>
            </div>
          ))}
        </div>

        {/* 内容和活动骨架 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 热门文章骨架 */}
          <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] h-[420px] relative overflow-hidden">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-[var(--bg-card-hover)] to-transparent" />
            <div className="flex justify-between items-center mb-6">
              <div className="h-6 w-24 bg-[var(--bg-secondary)] rounded animate-pulse" />
              <div className="h-4 w-16 bg-[var(--bg-secondary)] rounded animate-pulse" />
            </div>
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-3">
                  <div className="w-8 h-8 bg-[var(--bg-secondary)] rounded-lg animate-pulse" />
                  <div className="flex-1 h-4 bg-[var(--bg-secondary)] rounded animate-pulse" />
                  <div className="w-12 h-4 bg-[var(--bg-secondary)] rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>

          {/* 最近活动骨架 */}
          <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] h-[420px] relative overflow-hidden">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-[var(--bg-card-hover)] to-transparent" />
            <div className="flex justify-between items-center mb-4">
              <div className="h-6 w-24 bg-[var(--bg-secondary)] rounded animate-pulse" />
              <div className="h-4 w-16 bg-[var(--bg-secondary)] rounded animate-pulse" />
            </div>
            <div className="space-y-4 ml-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-start gap-4">
                  <div className="w-6 h-6 bg-[var(--bg-secondary)] rounded-full animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-[var(--bg-secondary)] rounded w-3/4 animate-pulse" />
                    <div className="h-3 bg-[var(--bg-secondary)] rounded w-1/2 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 图表区域骨架 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 访客图表骨架 */}
          <div className="lg:col-span-2 p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] h-[420px] relative overflow-hidden">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-[var(--bg-card-hover)] to-transparent" />
            <div className="flex justify-between items-center mb-6">
              <div className="space-y-2">
                <div className="h-6 w-24 bg-[var(--bg-secondary)] rounded animate-pulse" />
                <div className="h-4 w-32 bg-[var(--bg-secondary)] rounded animate-pulse" />
              </div>
              <div className="flex gap-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="w-12 h-8 bg-[var(--bg-secondary)] rounded animate-pulse" />
                ))}
              </div>
            </div>
            <div className="h-[300px] bg-[var(--bg-secondary)] rounded-lg animate-pulse" />
          </div>

          {/* 设备图表骨架 */}
          <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] h-[420px] relative overflow-hidden">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-[var(--bg-card-hover)] to-transparent" />
            <div className="h-6 w-24 bg-[var(--bg-secondary)] rounded animate-pulse mb-4" />
            <div className="h-[340px] flex items-center justify-center">
              <div className="w-48 h-48 rounded-full bg-[var(--bg-secondary)] animate-pulse" />
            </div>
          </div>
        </div>

        {/* 系统监控区域骨架 */}
        <h2 className="text-lg font-semibold text-[var(--text-primary)] pt-4">系统监控</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 系统趋势骨架 */}
          <div className="lg:col-span-2 p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] relative overflow-hidden">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-[var(--bg-card-hover)] to-transparent" />
            <div className="flex justify-between mb-6">
              <div className="h-6 w-32 bg-[var(--bg-secondary)] rounded animate-pulse" />
              <div className="flex gap-2">
                <div className="h-8 w-24 bg-[var(--bg-secondary)] rounded animate-pulse" />
                <div className="h-8 w-16 bg-[var(--bg-secondary)] rounded animate-pulse" />
              </div>
            </div>
            <div className="h-[300px] bg-[var(--bg-secondary)] rounded-xl animate-pulse" />
          </div>

          {/* 系统状态骨架 */}
          <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] relative overflow-hidden">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-[var(--bg-card-hover)] to-transparent" />
            <div className="h-6 w-24 bg-[var(--bg-secondary)] rounded mb-6 animate-pulse" />
            <div className="grid grid-cols-2 gap-4 mb-6">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-4 bg-[var(--bg-secondary)] rounded animate-pulse" />
                  <div className="h-2 bg-[var(--bg-secondary)] rounded animate-pulse" />
                </div>
              ))}
            </div>
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 bg-[var(--bg-secondary)] rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 使用专用获取的 visitorTrend，回退到 data.visitorTrend，然后是 mockData
  const chartData = visitorTrend || data?.visitorTrend || mockData.visitorTrend;
  const topPostsData = data?.topPosts || mockData.topPosts;
  const aiOverview = aiData.overview || EMPTY_AI_DASHBOARD.overview;
  const aiModelOptions = uniqueBy(aiData.modelDistribution, item => item.model);
  const aiTaskOptions = uniqueBy(aiData.taskDistribution, item => item.task);
  const aiRecords: AiCallRecord[] = aiData.records?.list || [];
  const aiTrendData = aiData.trend || [];

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* 头部 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)]">仪表盘</h1>
          <p className="text-[var(--text-secondary)] text-sm sm:text-base mt-0.5 sm:mt-1">欢迎回来，查看您的博客数据概览</p>
        </div>
        <div className="flex items-center gap-2 text-xs sm:text-sm text-[var(--text-muted)] bg-[var(--bg-card)] px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg border border-[var(--border-subtle)] self-start sm:self-auto">
          <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span><span className="hidden sm:inline">上次更新: </span>{new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <StatsCard
          title="文章总数"
          value={data?.stats.posts || 0}
          change={data?.trends?.posts ?? 0}
          changeLabel={`本月+${data?.trends?.postsThisMonth ?? 0}`}
          icon={<FileText className="w-5 h-5" />}
          color="primary"
        />
        <StatsCard
          title="独立访客"
          value={data?.stats.visitors || 0}
          change={data?.trends?.visitors ?? 0}
          changeLabel="较上周"
          icon={<Users className="w-5 h-5" />}
          color="blue"
        />
        <StatsCard
          title="总浏览量"
          value={data?.stats.views || 0}
          change={data?.trends?.views ?? 0}
          changeLabel="较上周"
          icon={<Eye className="w-5 h-5" />}
          color="green"
        />
        <StatsCard
          title="评论总数"
          value={data?.stats.comments || 0}
          change={data?.trends?.comments ?? 0}
          changeLabel="较上周"
          icon={<MessageSquare className="w-5 h-5" />}
          color="orange"
        />
        <StatsCard
          title="分类总数"
          value={data?.stats.categories || 0}
          change={data?.trends?.categories ?? 0}
          changeLabel="新增"
          icon={<FolderTree className="w-5 h-5" />}
          color="purple"
        />
        <StatsCard
          title="总字数"
          value={data?.stats.totalWords || 0}
          change={data?.trends?.words ?? 0}
          changeLabel="本月新增"
          icon={<FileType className="w-5 h-5" />}
          color="cyan"
        />
        <StatsCard
          title="AI Tokens"
          value={aiOverview.totalTokens || data?.stats.aiTokens || 0}
          change={0}
          changeLabel={`均值 ${Math.round(aiOverview.avgTokensPerCall || 0)} / 次`}
          icon={<Cpu className="w-5 h-5" />}
          color="indigo"
        />
        <StatsCard
          title="AI 费用"
          value={`$${(aiOverview.totalCost || data?.stats.aiCost || 0).toFixed(2)}`}
          change={aiOverview.successRate || 0}
          changeLabel={`成功率 ${aiOverview.successRate || 0}%`}
          icon={<DollarSign className="w-5 h-5" />}
          color="emerald"
        />
      </div>

      {/* AI 调用分析 */}
      <div className="space-y-4 pt-2">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">AI 记录与统计看板</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={cn(
                'px-2 py-0.5 rounded-md border',
                aiStatus === 'healthy'
                  ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-700 border-amber-500/30'
              )}>
                {aiStatus === 'healthy' ? '运行正常' : '降级中'}
              </span>
              <span className="text-[var(--text-muted)]">
                最近成功: {aiLastSuccessAt ? aiLastSuccessAt.toLocaleTimeString() : '尚无'}
              </span>
              {aiIssueCategory && (
                <span className="text-[var(--text-muted)]">诊断: {aiIssueCategory}</span>
              )}
              <button
                onClick={() => setAiReloadTick(value => value + 1)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                disabled={aiLoading}
              >
                <RefreshCw className={cn('w-3 h-3', aiLoading && 'animate-spin')} />
                重试
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 p-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] self-start">
            {([7, 30, 90] as const).map(days => (
              <button
                key={days}
                onClick={() => {
                  setAiDays(days);
                  setAiPage(1);
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  aiDays === days
                    ? 'bg-primary text-white shadow'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {days}天
              </button>
            ))}
          </div>
        </div>

        {aiStatus === 'degraded' && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            AI 看板已进入降级模式：{aiIssueMessage || '请求失败'}。
            当前展示最近一次成功数据，可点击“重试”恢复。
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 lg:gap-4">
          <StatsCard
            title="AI 调用总数"
            value={aiOverview.totalCalls}
            change={aiOverview.successRate}
            changeLabel="成功率"
            icon={<Cpu className="w-5 h-5" />}
            color="indigo"
            loading={aiLoading}
          />
          <StatsCard
            title="AI 总 Tokens"
            value={aiOverview.totalTokens}
            change={0}
            changeLabel="累计消耗"
            icon={<Cpu className="w-5 h-5" />}
            color="cyan"
            loading={aiLoading}
          />
          <StatsCard
            title="AI 总费用"
            value={`$${aiOverview.totalCost.toFixed(4)}`}
            change={0}
            changeLabel={`均次 $${aiOverview.avgCostPerCall.toFixed(6)}`}
            icon={<DollarSign className="w-5 h-5" />}
            color="emerald"
            loading={aiLoading}
          />
          <StatsCard
            title="平均延迟"
            value={`${Math.round(aiOverview.avgLatencyMs)} ms`}
            change={0}
            changeLabel={`缓存命中 ${aiOverview.cacheHitRate}%`}
            icon={<Clock className="w-5 h-5" />}
            color="blue"
            loading={aiLoading}
          />
          <StatsCard
            title="失败调用"
            value={aiOverview.errorCalls}
            change={0}
            changeLabel={`成功 ${aiOverview.successCalls}`}
            icon={<MessageSquare className="w-5 h-5" />}
            color="orange"
            loading={aiLoading}
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2">
            <AiUsageTrendChart data={aiTrendData} loading={aiLoading} />
          </div>
          <div>
            <AiModelDistributionChart data={aiData.modelDistribution} loading={aiLoading} />
          </div>
        </div>

        <AiUsageRecordsTable
          records={aiRecords}
          loading={aiLoading}
          page={aiData.records?.pageNum || aiPage}
          pageSize={aiData.records?.pageSize || AI_DASHBOARD_PAGE_SIZE}
          total={aiData.records?.total || 0}
          onPageChange={(nextPage) => {
            if (nextPage < 1) {
              return;
            }
            const totalPages = aiData.records?.pages || 1;
            if (nextPage > totalPages) {
              return;
            }
            setAiPage(nextPage);
          }}
          modelOptions={aiModelOptions}
          taskOptions={aiTaskOptions}
          selectedTaskType={aiTaskType}
          selectedModelId={aiModelId}
          selectedSuccess={aiSuccessFilter}
          selectedKeyword={aiKeyword}
          onTaskTypeChange={(value) => {
            setAiTaskType(value);
            setAiPage(1);
          }}
          onModelIdChange={(value) => {
            setAiModelId(value);
            setAiPage(1);
          }}
          onSuccessChange={(value) => {
            setAiSuccessFilter(value);
            setAiPage(1);
          }}
          onKeywordChange={(value) => {
            setAiKeyword(value);
            setAiPage(1);
          }}
        />
      </div>

      {/* 内容和活动 - 上移 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TopPosts posts={topPostsData} />
        <RecentActivity />
      </div>

      {/* 图表区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <VisitorChart
            data={chartData}
            loading={trendLoading}
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
          />
        </div>
        <DeviceChart data={data?.deviceStats} loading={loading} />
      </div>

      {/* 系统监控区域 */}
      <div className="space-y-6 pt-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">系统监控</h2>
        
        {/* 第 1 行：趋势 + 状态 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
           <div className="lg:col-span-2">
             <SystemTrends className="h-[500px]" />
           </div>
           <div className="lg:col-span-1">
             <SystemStatus refreshInterval={5} className="h-[500px]" />
           </div>
        </div>

        {/* 第 2 行：日志 + 容器 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
           <div className="lg:col-span-2">
             <RealtimeLogViewer 
                containerId={selectedContainer.id}
                containerName={selectedContainer.name}
                className="h-[500px]"
             />
           </div>
           
           <div className="lg:col-span-1">
             <ContainerStatus 
                refreshInterval={30}
                onSelectContainer={handleContainerSelect}
                selectedId={selectedContainer.id}
                className="h-[500px]" 
             />
           </div>
        </div>
      </div>
    </motion.div>
  );
}
