/**
 * @file SystemTrends.tsx
 * @description 系统资源历史趋势图组件
 */

import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { 
  RefreshCw, 
  Trash2, 
  Settings, 
  Cpu, 
  Activity, 
  HardDrive, 
  Server
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  systemService, 
  MetricHistory, 
  MetricPoint 
} from '@/services/systemService';
import { toast } from 'sonner';

// ========== Chart Data Helper ==========

interface MergedDataPoint {
  time: string;
  cpu: number;
  memory: number;
  disk: number;
  jvm: number;
}

function mergeHistoryData(history: MetricHistory): MergedDataPoint[] {
  if (!history.cpu || history.cpu.length === 0) return [];
  
  return history.cpu.map((point, index) => ({
    time: point.time,
    cpu: point.value,
    memory: history.memory[index]?.value || 0,
    disk: history.disk[index]?.value || 0,
    jvm: history.jvm[index]?.value || 0,
  }));
}

// ========== Component ==========

export function SystemTrends() {
  const [data, setData] = useState<MergedDataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [minutes, setMinutes] = useState(60); // View last 60 mins
  const [visibleMetrics, setVisibleMetrics] = useState({
    cpu: true,
    memory: true,
    disk: false,
    jvm: false
  });
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [isCleaning, setIsCleaning] = useState(false);

  // Fetch History
  const fetchHistory = useCallback(async () => {
    try {
      // Always fetch slightly more points to ensure smooth graph
      const res = await systemService.getHistory(minutes, 100);
      if (res.code === 200 && res.data) {
        setData(mergeHistoryData(res.data));
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  }, [minutes]);

  // Initial load & Auto refresh
  useEffect(() => {
    fetchHistory();
    const timer = setInterval(fetchHistory, refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [fetchHistory, refreshInterval]);

  // Cleanup Handler
  const handleCleanup = async () => {
    if (!confirm('确定要清理所有历史监控数据吗？此操作不可恢复。')) return;
    
    setIsCleaning(true);
    try {
      const res = await systemService.cleanupHistory();
      if (res.code === 200) {
        toast.success(`已清理 ${res.data} 条历史记录`);
        fetchHistory(); // Refresh immediately
      } else {
        toast.error(res.message || '清理失败');
      }
    } catch (err) {
      console.error(err);
      toast.error('清理请求失败');
    } finally {
      setIsCleaning(false);
    }
  };

  const toggleMetric = (key: keyof typeof visibleMetrics) => {
    setVisibleMetrics(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="p-6 rounded-xl bg-white/5 border border-white/10">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="text-lg font-semibold text-white">系统负载趋势</h3>
          <div className="flex items-center gap-4 mt-2">
            {/* Metric Toggles */}
            <div className="flex items-center gap-2">
              <button 
                onClick={() => toggleMetric('cpu')}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors border",
                  visibleMetrics.cpu 
                    ? "bg-primary/10 border-primary/30 text-primary" 
                    : "bg-white/5 border-transparent text-gray-500 hover:text-gray-300"
                )}
              >
                <div className={cn("w-2 h-2 rounded-full", visibleMetrics.cpu ? "bg-primary" : "bg-gray-600")} />
                CPU
              </button>
              <button 
                onClick={() => toggleMetric('memory')}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors border",
                  visibleMetrics.memory 
                    ? "bg-blue-500/10 border-blue-500/30 text-blue-400" 
                    : "bg-white/5 border-transparent text-gray-500 hover:text-gray-300"
                )}
              >
                <div className={cn("w-2 h-2 rounded-full", visibleMetrics.memory ? "bg-blue-400" : "bg-gray-600")} />
                内存
              </button>
              <button 
                onClick={() => toggleMetric('disk')}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors border",
                  visibleMetrics.disk 
                    ? "bg-green-500/10 border-green-500/30 text-green-400" 
                    : "bg-white/5 border-transparent text-gray-500 hover:text-gray-300"
                )}
              >
                <div className={cn("w-2 h-2 rounded-full", visibleMetrics.disk ? "bg-green-400" : "bg-gray-600")} />
                磁盘
              </button>
              <button 
                onClick={() => toggleMetric('jvm')}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors border",
                  visibleMetrics.jvm 
                    ? "bg-orange-500/10 border-orange-500/30 text-orange-400" 
                    : "bg-white/5 border-transparent text-gray-500 hover:text-gray-300"
                )}
              >
                <div className={cn("w-2 h-2 rounded-full", visibleMetrics.jvm ? "bg-orange-400" : "bg-gray-600")} />
                JVM
              </button>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Time Range */}
          <select
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="bg-white/5 border border-white/10 text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary/50"
          >
            <option value="30">最近 30 分钟</option>
            <option value="60">最近 1 小时</option>
            <option value="180">最近 3 小时</option>
            <option value="720">最近 12 小时</option>
            <option value="1440">最近 24 小时</option>
          </select>

          {/* Refresh Interval */}
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-2 py-1">
            <RefreshCw className="w-3.5 h-3.5 text-gray-400" />
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="bg-transparent text-white text-xs py-0.5 focus:outline-none"
            >
              <option value="5">5秒</option>
              <option value="10">10秒</option>
              <option value="30">30秒</option>
              <option value="60">1分钟</option>
              <option value="300">5分钟</option>
            </select>
          </div>

          {/* Tools */}
          <button
            onClick={fetchHistory}
            className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="立即刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          
          <button
            onClick={handleCleanup}
            disabled={isCleaning}
            className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-red-400 hover:bg-white/10 transition-colors disabled:opacity-50"
            title="清理历史数据"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="h-[300px] w-full">
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorMem" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorDisk" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorJvm" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis 
                dataKey="time" 
                stroke="#6b7280" 
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
                minTickGap={30}
              />
              <YAxis 
                stroke="#6b7280" 
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
                domain={[0, 100]}
                unit="%"
                width={35}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="p-3 bg-zinc-900/90 backdrop-blur-md border border-white/10 rounded-lg shadow-xl z-50">
                        <p className="text-zinc-400 text-xs mb-2">{label}</p>
                        {payload.map((entry: any) => (
                          <div key={entry.name} className="flex items-center gap-2 text-xs font-medium mb-1 last:mb-0">
                            <div 
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: entry.stroke }}
                            />
                            <span className="text-gray-300 w-12">{entry.name}</span>
                            <span className="text-white font-mono ml-auto">
                              {Number(entry.value).toFixed(1)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              
              {visibleMetrics.cpu && (
                <Area
                  type="monotone"
                  dataKey="cpu"
                  name="CPU"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorCpu)"
                  animationDuration={500}
                />
              )}
              {visibleMetrics.memory && (
                <Area
                  type="monotone"
                  dataKey="memory"
                  name="内存"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorMem)"
                  animationDuration={500}
                />
              )}
              {visibleMetrics.disk && (
                <Area
                  type="monotone"
                  dataKey="disk"
                  name="磁盘"
                  stroke="#22c55e"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorDisk)"
                  animationDuration={500}
                />
              )}
              {visibleMetrics.jvm && (
                <Area
                  type="monotone"
                  dataKey="jvm"
                  name="JVM"
                  stroke="#f97316"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorJvm)"
                  animationDuration={500}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-gray-500 text-sm">
             暂无历史数据，请等待采集...
          </div>
        )}
      </div>
    </div>
  );
}
