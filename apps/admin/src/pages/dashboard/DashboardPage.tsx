import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, Users, Eye, MessageSquare, Clock, FolderTree } from 'lucide-react';
import { 
  StatsCard, 
  VisitorChart, 
  TopPosts, 
  DeviceChart, 
  SystemStatus,
  RecentActivity,
  SystemTrends,
  ActivityItem
} from './components';
import { analyticsService, DashboardData } from '@/services/analyticsService';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardData | null>(null);
  const [timeRange, setTimeRange] = useState<'7d' | '30d'>('7d');

  // Mock data for fallback or initial dev
  const mockData: DashboardData = {
    stats: {
      posts: 128,
      categories: 12,
      tags: 34,
      comments: 567,
      views: 45678,
      visitors: 12453
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

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 },
  };

  if (loading && !data) {
    return (
      <div className="space-y-6 animate-pulse p-6">
        <div className="h-20 bg-white/5 rounded-xl w-1/3" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-white/5 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-6 h-96">
          <div className="col-span-2 bg-white/5 rounded-xl" />
          <div className="bg-white/5 rounded-xl" />
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
      variants={container}
      initial="hidden"
      animate="show"
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
        <motion.div variants={item}>
          <StatsCard
            title="文章总数"
            value={data?.stats.posts || 0}
            change={12}
            changeLabel="本月新增"
            icon={<FileText className="w-5 h-5" />}
            color="primary"
            loading={loading}
          />
        </motion.div>
        <motion.div variants={item}>
          <StatsCard
            title="独立访客"
            value={data?.stats.visitors || 0}
            change={8}
            changeLabel="较上周"
            icon={<Users className="w-5 h-5" />}
            color="blue"
            loading={loading}
          />
        </motion.div>
        <motion.div variants={item}>
          <StatsCard
            title="总浏览量"
            value={data?.stats.views || 0}
            change={15}
            changeLabel="较上周"
            icon={<Eye className="w-5 h-5" />}
            color="green"
            loading={loading}
          />
        </motion.div>
        <motion.div variants={item}>
          <StatsCard
            title="评论总数"
            value={data?.stats.comments || 0}
            change={5}
            changeLabel="待审核"
            icon={<MessageSquare className="w-5 h-5" />}
            color="orange"
            loading={loading}
          />
        </motion.div>

        <motion.div variants={item}>
          <StatsCard
            title="分类总数"
            value={data?.stats.categories || 0}
            change={2}
            changeLabel="新增"
            icon={<FolderTree className="w-5 h-5" />}
            color="purple"
            loading={loading}
          />
        </motion.div>
      </div>

      {/* Main Charts Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div variants={item} className="lg:col-span-2">
          <VisitorChart 
            data={chartData} 
            loading={loading || trendLoading}
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
          />
        </motion.div>
        <motion.div variants={item}>
          <DeviceChart loading={loading} />
        </motion.div>
      </div>

      {/* Secondary Area - Content & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div variants={item}>
          <TopPosts posts={topPostsData} loading={loading} />
        </motion.div>
        <motion.div variants={item}>
          <RecentActivity loading={loading} />
        </motion.div>
      </div>

      {/* System Monitoring Area */}
      <h2 className="text-lg font-semibold text-white pt-4">系统监控</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div variants={item} className="lg:col-span-2">
          <SystemTrends />
        </motion.div>
        <motion.div variants={item}>
          <SystemStatus refreshInterval={30} />
        </motion.div>
      </div>
    </motion.div>
  );
}
