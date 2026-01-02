import { useState } from 'react';
import { BarChart2, Users, Monitor, TrendingUp } from 'lucide-react';
import { LineChart, BarChart, PieChart } from '../../components/charts';

export function AnalyticsPage() {
  const [dateRange, setDateRange] = useState('7d');

  const visitorData = [
    { label: '周一', value: 1200 },
    { label: '周二', value: 1400 },
    { label: '周三', value: 1100 },
    { label: '周四', value: 1600 },
    { label: '周五', value: 1800 },
    { label: '周六', value: 2200 },
    { label: '周日', value: 1900 },
  ];

  const deviceData = [
    { label: '桌面端', value: 5600, color: '#8b5cf6' },
    { label: '移动端', value: 3200, color: '#ec4899' },
    { label: '平板', value: 800, color: '#06b6d4' },
  ];

  const trafficSources = [
    { label: '直接访问', value: 4200 },
    { label: '搜索引擎', value: 3100 },
    { label: '社交媒体', value: 1800 },
    { label: '外链', value: 900 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">统计分析</h1>
          <p className="text-gray-400 mt-1">深入了解访客行为和内容表现</p>
        </div>
        <div className="flex items-center gap-2">
          {['7d', '30d', '90d'].map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                dateRange === range
                  ? 'bg-primary text-white'
                  : 'bg-white/10 text-gray-300 hover:bg-white/20'
              }`}
            >
              {range === '7d' ? '7天' : range === '30d' ? '30天' : '90天'}
            </button>
          ))}
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { icon: Users, label: '总访客', value: '12,453', change: '+8.2%' },
          { icon: BarChart2, label: '页面浏览', value: '45,678', change: '+15.3%' },
          { icon: TrendingUp, label: '跳出率', value: '32.1%', change: '-2.4%' },
          { icon: Monitor, label: '平均停留', value: '3:24', change: '+0:18' },
        ].map((item, i) => (
          <div key={i} className="p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/20">
                <item.icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-gray-400">{item.label}</p>
                <p className="text-xl font-bold text-white">{item.value}</p>
              </div>
            </div>
            <p className="mt-2 text-sm text-green-400">{item.change}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-6">
        <div className="p-6 rounded-xl bg-white/5 border border-white/10">
          <h3 className="text-lg font-semibold text-white mb-4">访问趋势</h3>
          <LineChart data={visitorData} height={250} />
        </div>
        <div className="p-6 rounded-xl bg-white/5 border border-white/10">
          <h3 className="text-lg font-semibold text-white mb-4">设备分布</h3>
          <PieChart data={deviceData} />
        </div>
      </div>

      <div className="p-6 rounded-xl bg-white/5 border border-white/10">
        <h3 className="text-lg font-semibold text-white mb-4">流量来源</h3>
        <BarChart data={trafficSources} height={200} horizontal />
      </div>
    </div>
  );
}

export default AnalyticsPage;
