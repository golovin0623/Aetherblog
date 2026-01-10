import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { 
  FileText, Eye, MessageSquare, FolderOpen, 
  TrendingUp, TrendingDown, Minus, Loader2 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { analyticsService, DashboardData } from '@/services/analyticsService';

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

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await analyticsService.getDashboard();
        if (res.code === 200 && res.data) {
          setData(res.data);
        } else {
          setError(res.message || '获取数据失败');
        }
      } catch (err: any) {
        logger.error('Dashboard fetch error:', err);
        setError(err.message || '网络错误');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200">
        <p>加载失败: {error}</p>
      </div>
    );
  }

  const stats: Array<{ label: string; value: string; icon: typeof FileText; trend: 'up' | 'down' | 'neutral'; change: string }> = data ? [
    { label: '文章总数', value: data.stats.posts.toString(), icon: FileText, trend: 'neutral', change: '' },
    { label: '总浏览量', value: data.stats.views.toString(), icon: Eye, trend: 'neutral', change: '' },
    { label: '评论数', value: data.stats.comments.toString(), icon: MessageSquare, trend: 'neutral', change: '' },
    { label: '分类数', value: data.stats.categories.toString(), icon: FolderOpen, trend: 'neutral', change: '' },
  ] : [];

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold text-white">仪表盘</h1>
        <p className="text-gray-400 mt-1">欢迎回来，这是您的博客概览</p>
      </div>

      {/* 统计卡片 */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {stats.map((stat) => (
          <motion.div
            key={stat.label}
            variants={item}
            className={cn(
              'p-6 rounded-xl',
              'bg-white/5 backdrop-blur-sm border border-white/10',
              'hover:border-white/20 transition-all duration-300'
            )}
          >
            <div className="flex items-center justify-between">
              <div
                className={cn(
                  'p-3 rounded-lg',
                  'bg-primary/10'
                )}
              >
                <stat.icon className="w-5 h-5 text-primary" />
              </div>
              <div
                className={cn(
                  'flex items-center gap-1 text-sm',
                  stat.trend === 'up' && 'text-green-400',
                  stat.trend === 'down' && 'text-red-400',
                  stat.trend === 'neutral' && 'text-gray-400'
                )}
              >
                {stat.trend === 'up' && <TrendingUp className="w-4 h-4" />}
                {stat.trend === 'down' && <TrendingDown className="w-4 h-4" />}
                {stat.trend === 'neutral' && <Minus className="w-4 h-4" />}
                <span>{stat.change}</span>
              </div>
            </div>
            <div className="mt-4">
              <p className="text-3xl font-bold text-white">{stat.value}</p>
              <p className="text-sm text-gray-400 mt-1">{stat.label}</p>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* 下方区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 p-6 rounded-xl bg-white/5 border border-white/10">
          <h3 className="text-lg font-semibold text-white mb-4">访问趋势</h3>
          <div className="h-64 flex items-center justify-center text-gray-500">
            {data?.visitorTrend && data.visitorTrend.length > 0 
              ? '图表数据已加载 (待实现图表组件)'
              : '暂无访问数据'
            }
          </div>
        </div>
        <div className="p-6 rounded-xl bg-white/5 border border-white/10">
          <h3 className="text-lg font-semibold text-white mb-4">热门文章</h3>
          <div className="space-y-3">
            {data?.topPosts && data.topPosts.length > 0 ? (
              data.topPosts.map((post, i) => (
                <div
                  key={post.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <span className="text-sm text-gray-400 w-6">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{post.title}</p>
                    <p className="text-xs text-gray-500">{post.viewCount} 次浏览</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500 text-sm">暂无热门文章</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

