import { useState, useEffect } from 'react';
import { BarChart2, Users, Monitor, TrendingUp, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { LineChart, BarChart, PieChart } from '../../components/charts';
import { analyticsService, VisitorTrend } from '@/services/analyticsService';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// 模拟数据用于回退
const mockVisitorData = [
  { label: '周一', value: 1200 },
  { label: '周二', value: 1400 },
  { label: '周三', value: 1100 },
  { label: '周四', value: 1600 },
  { label: '周五', value: 1800 },
  { label: '周六', value: 2200 },
  { label: '周日', value: 1900 },
];

const mockDeviceData = [
  { label: '桌面端', value: 5600, color: '#8b5cf6' },
  { label: '移动端', value: 3200, color: '#ec4899' },
  { label: '平板', value: 800, color: '#06b6d4' },
];

const mockTrafficSources = [
  { label: '直接访问', value: 4200 },
  { label: '搜索引擎', value: 3100 },
  { label: '社交媒体', value: 1800 },
  { label: '外链', value: 900 },
];

export function AnalyticsPage() {
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [loading, setLoading] = useState(true);
  const [visitorData, setVisitorData] = useState(mockVisitorData);

  // 日期范围改变时获取访客趋势数据
  useEffect(() => {
    const fetchData = async () => {
      const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
      try {
        setLoading(true);
        const res = await analyticsService.getVisitorTrend(days);
        if (res.code === 200 && res.data && res.data.length > 0) {
          // 将 API 数据转换为图表格式
          const transformed = res.data.map((item: VisitorTrend) => ({
            label: item.date.slice(5), // MM-DD 格式
            value: item.pv,
          }));
          setVisitorData(transformed);
        } else {
          // 生成演示用的模拟数据
          const mockData = generateMockData(days);
          setVisitorData(mockData);
        }
      } catch (err) {
        logger.error('Failed to fetch analytics data:', err);
        toast.error('获取统计数据失败，显示演示数据');
        const mockData = generateMockData(days);
        setVisitorData(mockData);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [dateRange]);

  // 基于天数生成模拟数据
  const generateMockData = (days: number) => {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return Array.from({ length: Math.min(days, 14) }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i));
      return {
        label: days <= 7 ? weekdays[date.getDay()] : `${date.getMonth() + 1}/${date.getDate()}`,
        value: Math.floor(Math.random() * 1500) + 800,
      };
    });
  };

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 },
  };

  const stats = [
    { icon: Users, label: '总访客', value: '12,453', change: '+8.2%', positive: true },
    { icon: BarChart2, label: '页面浏览', value: '45,678', change: '+15.3%', positive: true },
    { icon: TrendingUp, label: '跳出率', value: '32.1%', change: '-2.4%', positive: true },
    { icon: Monitor, label: '平均停留', value: '3:24', change: '+0:18', positive: true },
  ];

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">统计分析</h1>
          <p className="text-[var(--text-muted)] mt-1">深入了解访客行为和内容表现</p>
        </div>
        {/* 日期范围切换 - 响应式 */}
        <div className="flex items-center gap-1.5 sm:gap-2 p-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
          {(['7d', '30d', '90d'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={cn(
                "px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all touch-manipulation",
                dateRange === range
                  ? 'bg-primary text-white shadow-lg'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]'
              )}
            >
              {range === '7d' ? '7天' : range === '30d' ? '30天' : '90天'}
            </button>
          ))}
        </div>
      </div>

      {/* 概览卡片 - 响应式网格 */}
      <motion.div 
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
      >
        {stats.map((stat, i) => (
          <motion.div 
            key={i} 
            variants={item}
            className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/20">
                <stat.icon className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-[var(--text-muted)] truncate">{stat.label}</p>
                <p className="text-lg sm:text-xl font-bold text-[var(--text-primary)]">{stat.value}</p>
              </div>
            </div>
            <p className={cn(
              "mt-2 text-xs sm:text-sm",
              stat.positive ? 'text-green-400' : 'text-red-400'
            )}>
              {stat.change}
            </p>
          </motion.div>
        ))}
      </motion.div>

      {/* 图表 - 响应式网格 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <motion.div 
          variants={item}
          initial="hidden"
          animate="show"
          className="p-4 sm:p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)]"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">访问趋势</h3>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
          </div>
          {loading ? (
            <div className="h-[200px] sm:h-[250px] flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <LineChart data={visitorData} height={250} />
          )}
        </motion.div>
        
        <motion.div 
          variants={item}
          initial="hidden"
          animate="show"
          transition={{ delay: 0.1 }}
          className="p-4 sm:p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)]"
        >
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">设备分布</h3>
          <PieChart data={mockDeviceData} />
        </motion.div>
      </div>

      {/* 流量来源 - 全宽 */}
      <motion.div 
        variants={item}
        initial="hidden"
        animate="show"
        transition={{ delay: 0.2 }}
        className="p-4 sm:p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)]"
      >
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">流量来源</h3>
        <BarChart data={mockTrafficSources} height={200} horizontal />
      </motion.div>
    </div>
  );
}

export default AnalyticsPage;
