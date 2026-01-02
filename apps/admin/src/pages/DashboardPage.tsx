import { motion } from 'framer-motion';
import { 
  FileText, Eye, MessageSquare, Users, 
  TrendingUp, TrendingDown, Minus 
} from 'lucide-react';
import { cn } from '@/lib/utils';

const stats = [
  { label: '文章总数', value: '128', icon: FileText, trend: 'up', change: '+12%' },
  { label: '总浏览量', value: '45.2K', icon: Eye, trend: 'up', change: '+8.5%' },
  { label: '评论数', value: '892', icon: MessageSquare, trend: 'down', change: '-2%' },
  { label: '访客数', value: '12.8K', icon: Users, trend: 'neutral', change: '0%' },
];

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

      {/* 占位内容 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 p-6 rounded-xl bg-white/5 border border-white/10">
          <h3 className="text-lg font-semibold text-white mb-4">访问趋势</h3>
          <div className="h-64 flex items-center justify-center text-gray-500">
            图表区域（待实现）
          </div>
        </div>
        <div className="p-6 rounded-xl bg-white/5 border border-white/10">
          <h3 className="text-lg font-semibold text-white mb-4">热门文章</h3>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors"
              >
                <span className="text-sm text-gray-400 w-6">{i}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">示例文章标题 {i}</p>
                  <p className="text-xs text-gray-500">{1000 - i * 100} 次浏览</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
