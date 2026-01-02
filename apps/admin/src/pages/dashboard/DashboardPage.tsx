import { useState, useEffect } from 'react';
import { FileText, Users, Eye, MessageSquare, TrendingUp } from 'lucide-react';
import { StatsCard, VisitorChart, TopPosts, SystemStatus } from './components';

export function DashboardPage() {
  const [stats] = useState({
    posts: 128,
    visitors: 12453,
    views: 45678,
    comments: 892,
  });

  const [visitorData] = useState([
    { date: '2024-01-01', pv: 1200, uv: 800 },
    { date: '2024-01-02', pv: 1400, uv: 900 },
    { date: '2024-01-03', pv: 1100, uv: 750 },
    { date: '2024-01-04', pv: 1600, uv: 1100 },
    { date: '2024-01-05', pv: 1800, uv: 1200 },
    { date: '2024-01-06', pv: 2000, uv: 1400 },
    { date: '2024-01-07', pv: 1900, uv: 1300 },
  ]);

  const [topPosts] = useState([
    { id: 1, title: 'Spring Boot 3.0 新特性详解', views: 3456 },
    { id: 2, title: 'React 19 Server Components 实战', views: 2890 },
    { id: 3, title: '使用 AI 提升开发效率的 10 个技巧', views: 2341 },
    { id: 4, title: 'PostgreSQL 性能优化指南', views: 1987 },
    { id: 5, title: 'Docker Compose 多容器部署实践', views: 1654 },
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">仪表盘</h1>
        <p className="text-gray-400 mt-1">欢迎回来！这是您的博客概览</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatsCard
          title="文章总数"
          value={stats.posts}
          change={12}
          changeLabel="本月"
          icon={<FileText className="w-5 h-5" />}
          color="primary"
        />
        <StatsCard
          title="独立访客"
          value={stats.visitors.toLocaleString()}
          change={8}
          changeLabel="本周"
          icon={<Users className="w-5 h-5" />}
          color="blue"
        />
        <StatsCard
          title="页面浏览"
          value={stats.views.toLocaleString()}
          change={15}
          changeLabel="本周"
          icon={<Eye className="w-5 h-5" />}
          color="green"
        />
        <StatsCard
          title="评论数"
          value={stats.comments}
          change={-3}
          changeLabel="本周"
          icon={<MessageSquare className="w-5 h-5" />}
          color="orange"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-2 gap-6">
        <VisitorChart data={visitorData} />
        <TopPosts posts={topPosts} />
      </div>

      {/* System Status */}
      <SystemStatus
        status="healthy"
        services={[
          { name: 'API 服务', status: 'up', latency: 45 },
          { name: 'Database', status: 'up', latency: 12 },
          { name: 'Cache', status: 'up', latency: 3 },
        ]}
      />
    </div>
  );
}

export default DashboardPage;
