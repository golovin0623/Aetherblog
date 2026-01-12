import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, Users, Eye, MessageSquare, Clock, FolderTree, FileType, Cpu, DollarSign } from 'lucide-react';
import { 
  StatsCard, 
  VisitorChart, 
  TopPosts, 
  DeviceChart, 
  SystemStatus,
  RecentActivity,
  SystemTrends,
  ActivityItem,
  ContainerStatus,
  RealtimeLogViewer
} from './components';
import { analyticsService, DashboardData } from '@/services/analyticsService';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardData | null>(null);
  const [timeRange, setTimeRange] = useState<'7d' | '30d'>('7d');
  
  // Container Logs State
  const [selectedContainer, setSelectedContainer] = useState<{id: string, name: string}>({id: '', name: ''});

  const handleContainerSelect = (id: string, name: string) => {
    setSelectedContainer({id, name});
  };

  // Mock data for fallback or initial dev
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
    archiveStats: []
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // Call real API
        const res = await analyticsService.getDashboard();
        if (res.code === 200 && res.data) {
          setData(res.data);
        } else {
          // Fallback to mock data if API fails
          logger.warn('Dashboard API returned non-200, using mock data');
          setData(mockData);
        }
      } catch (err) {
        logger.error('Failed to fetch dashboard data:', err);
        toast.error('加载仪表盘数据失败，显示演示数据');
        setData(mockData); // Fallback
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Refetch visitor trend when time range changes
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
          // Generate fallback mock data for selected range
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
        // Generate fallback mock data
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
        {/* Header Skeleton */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-2">
            <div className="h-8 w-32 bg-white/10 rounded animate-pulse" />
            <div className="h-4 w-48 bg-white/10 rounded animate-pulse" />
          </div>
          <div className="h-8 w-32 bg-white/10 rounded animate-pulse" />
        </div>

        {/* Stats Cards Skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="p-6 rounded-xl bg-white/5 border border-white/10 h-[140px] relative overflow-hidden">
              {/* Shimmer effect */}
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              <div className="flex justify-between items-start">
                <div className="space-y-3 flex-1">
                  <div className="h-4 w-20 bg-white/10 rounded animate-pulse" />
                  <div className="h-8 w-24 bg-white/10 rounded animate-pulse" />
                  <div className="h-3 w-16 bg-white/10 rounded animate-pulse" />
                </div>
                <div className="w-10 h-10 bg-white/10 rounded-lg animate-pulse" />
              </div>
            </div>
          ))}
        </div>

        {/* Content & Activity Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Posts Skeleton */}
          <div className="p-6 rounded-xl bg-white/5 border border-white/10 h-[420px] relative overflow-hidden">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <div className="flex justify-between items-center mb-6">
              <div className="h-6 w-24 bg-white/10 rounded animate-pulse" />
              <div className="h-4 w-16 bg-white/10 rounded animate-pulse" />
            </div>
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-3">
                  <div className="w-8 h-8 bg-white/10 rounded-lg animate-pulse" />
                  <div className="flex-1 h-4 bg-white/10 rounded animate-pulse" />
                  <div className="w-12 h-4 bg-white/10 rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>

          {/* Recent Activity Skeleton */}
          <div className="p-6 rounded-xl bg-white/5 border border-white/10 h-[420px] relative overflow-hidden">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <div className="flex justify-between items-center mb-4">
              <div className="h-6 w-24 bg-white/10 rounded animate-pulse" />
              <div className="h-4 w-16 bg-white/10 rounded animate-pulse" />
            </div>
            <div className="space-y-4 ml-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-start gap-4">
                  <div className="w-6 h-6 bg-white/10 rounded-full animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-white/10 rounded w-3/4 animate-pulse" />
                    <div className="h-3 bg-white/10 rounded w-1/2 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Charts Area Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Visitor Chart Skeleton */}
          <div className="lg:col-span-2 p-6 rounded-xl bg-white/5 border border-white/10 h-[420px] relative overflow-hidden">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <div className="flex justify-between items-center mb-6">
              <div className="space-y-2">
                <div className="h-6 w-24 bg-white/10 rounded animate-pulse" />
                <div className="h-4 w-32 bg-white/10 rounded animate-pulse" />
              </div>
              <div className="flex gap-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="w-12 h-8 bg-white/10 rounded animate-pulse" />
                ))}
              </div>
            </div>
            <div className="h-[300px] bg-white/5 rounded-lg animate-pulse" />
          </div>

          {/* Device Chart Skeleton */}
          <div className="p-6 rounded-xl bg-white/5 border border-white/10 h-[420px] relative overflow-hidden">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <div className="h-6 w-24 bg-white/10 rounded animate-pulse mb-4" />
            <div className="h-[340px] flex items-center justify-center">
              <div className="w-48 h-48 rounded-full bg-white/10 animate-pulse" />
            </div>
          </div>
        </div>

        {/* System Monitoring Area Skeleton */}
        <h2 className="text-lg font-semibold text-white pt-4">系统监控</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* System Trends Skeleton */}
          <div className="lg:col-span-2 p-6 rounded-xl bg-white/5 border border-white/10 relative overflow-hidden">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <div className="flex justify-between mb-6">
              <div className="h-6 w-32 bg-white/10 rounded animate-pulse" />
              <div className="flex gap-2">
                <div className="h-8 w-24 bg-white/10 rounded animate-pulse" />
                <div className="h-8 w-16 bg-white/10 rounded animate-pulse" />
              </div>
            </div>
            <div className="h-[300px] bg-white/5 rounded-xl animate-pulse" />
          </div>

          {/* System Status Skeleton */}
          <div className="p-6 rounded-xl bg-white/5 border border-white/10 relative overflow-hidden">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <div className="h-6 w-24 bg-white/10 rounded mb-6 animate-pulse" />
            <div className="grid grid-cols-2 gap-4 mb-6">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-4 bg-white/10 rounded animate-pulse" />
                  <div className="h-2 bg-white/10 rounded animate-pulse" />
                </div>
              ))}
            </div>
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Use visitorTrend from dedicated fetch, fallback to data.visitorTrend, then mockData
  const chartData = visitorTrend || data?.visitorTrend || mockData.visitorTrend;
  const topPostsData = data?.topPosts || mockData.topPosts;

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">仪表盘</h1>
          <p className="text-gray-400 text-sm sm:text-base mt-0.5 sm:mt-1">欢迎回来，查看您的博客数据概览</p>
        </div>
        <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-500 bg-white/5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg border border-white/5 self-start sm:self-auto">
          <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span><span className="hidden sm:inline">上次更新: </span>{new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <StatsCard
          title="文章总数"
          value={data?.stats.posts || 0}
          change={12}
          changeLabel="本月新增"
          icon={<FileText className="w-5 h-5" />}
          color="primary"
        />
        <StatsCard
          title="独立访客"
          value={data?.stats.visitors || 0}
          change={8}
          changeLabel="较上周"
          icon={<Users className="w-5 h-5" />}
          color="blue"
        />
        <StatsCard
          title="总浏览量"
          value={data?.stats.views || 0}
          change={15}
          changeLabel="较上周"
          icon={<Eye className="w-5 h-5" />}
          color="green"
        />
        <StatsCard
          title="评论总数"
          value={data?.stats.comments || 0}
          change={5}
          changeLabel="待审核"
          icon={<MessageSquare className="w-5 h-5" />}
          color="orange"
        />
        <StatsCard
          title="分类总数"
          value={data?.stats.categories || 0}
          change={2}
          changeLabel="新增"
          icon={<FolderTree className="w-5 h-5" />}
          color="purple"
        />
        <StatsCard
          title="总字数"
          value={data?.stats.totalWords || 0}
          change={8}
          changeLabel="本月新增"
          icon={<FileType className="w-5 h-5" />}
          color="cyan"
        />
        <StatsCard
          title="AI Tokens"
          value={data?.stats.aiTokens || 0}
          change={0}
          changeLabel="总消耗"
          icon={<Cpu className="w-5 h-5" />}
          color="indigo"
        />
        <StatsCard
          title="AI 费用"
          value={`$${(data?.stats.aiCost || 0).toFixed(2)}`}
          change={0}
          changeLabel="总花费"
          icon={<DollarSign className="w-5 h-5" />}
          color="emerald"
        />
      </div>

      {/* Content & Activity - Moved up */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TopPosts posts={topPostsData} />
        <RecentActivity />
      </div>

      {/* Charts Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <VisitorChart
            data={chartData}
            loading={trendLoading}
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
          />
        </div>
        <DeviceChart />
      </div>

      {/* System Monitoring Area */}
      <div className="space-y-6 pt-4">
        <h2 className="text-lg font-semibold text-white">系统监控</h2>
        
        {/* Row 1: Trends + Status */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
           <div className="lg:col-span-2">
             <SystemTrends className="h-[500px]" />
           </div>
           <div className="lg:col-span-1">
             <SystemStatus refreshInterval={5} className="h-[500px]" />
           </div>
        </div>

        {/* Row 2: Logs + Container */}
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
