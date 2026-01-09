/**
 * @file SystemTrends.tsx
 * @description 系统资源历史趋势图组件
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { 
  RefreshCw, 
  Trash2, 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  systemService, 
  MetricHistory, 
} from '@/services/systemService';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';

// ========== Chart Data Helper ==========

interface MergedDataPoint {
  time: string;  // ISO String from backend
  cpu: number;
  memory: number;
  disk: number;
  jvm: number;
  timestamp: number; // Parsed timestamp for sorting/formatting
}

function mergeHistoryData(history: MetricHistory): MergedDataPoint[] {
  if (!history.cpu || history.cpu.length === 0) return [];
  
  return history.cpu.map((point, index) => ({
    time: point.time,
    cpu: point.value,
    memory: history.memory[index]?.value || 0,
    disk: history.disk[index]?.value || 0,
    jvm: history.jvm[index]?.value || 0,
    timestamp: parseISO(point.time).getTime()
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

  // Dynamic Sampling Density
  const maxPoints = useMemo(() => {
    if (minutes <= 60) return 60;      // 1 min granularity
    if (minutes <= 1440) return 150;   // ~10 min granularity
    if (minutes <= 10080) return 300;  // ~30 min granularity (7 days)
    return 500;                        // ~1.5 hr granularity (30 days)
  }, [minutes]);

  // Fetch History
  const fetchHistory = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      const res = await systemService.getHistory(minutes, maxPoints);
      if (res.code === 200 && res.data) {
        setData(mergeHistoryData(res.data));
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [minutes, maxPoints]);

  // Initial load & Auto refresh
  useEffect(() => {
    fetchHistory(true);
    const timer = setInterval(() => fetchHistory(false), refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [fetchHistory, refreshInterval]);

  // Cleanup Handler
  const handleCleanup = async () => {
    if (!confirm(`确定要清理最近 ${minutes} 分钟内的历史数据吗？(目前后端实现为清理所有过期数据)`)) return;
    
    setIsCleaning(true);
    try {
      const res = await systemService.cleanupHistory();
      if (res.code === 200) {
        toast.success(`已清理 ${res.data} 条历史记录`);
        fetchHistory(true); 
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

  // Smart Formatter
  const formatXAxis = (isoTime: string) => {
    try {
      const date = parseISO(isoTime);
      if (minutes > 1440) { // > 24 Hours
        return format(date, 'MM-dd HH:mm');
      }
      return format(date, 'HH:mm');
    } catch (e) {
      return isoTime;
    }
  };

  const formatTooltipLabel = (isoTime: string) => {
    try {
      return format(parseISO(isoTime), 'yyyy-MM-dd HH:mm:ss', { locale: zhCN });
    } catch (e) {
      return isoTime;
    }
  };

  // Loading State for UX: only show Skeleton if NO data.
  // If we have data but are reloading (e.g. changing range), we show chart with opacity.
  const showSkeleton = loading && data.length === 0;

  if (showSkeleton) {
    return (
      <div className="p-4 sm:p-6 rounded-xl bg-white/5 border border-white/10 h-[350px] sm:h-[400px] animate-pulse">
        <div className="flex flex-col sm:flex-row justify-between mb-6 gap-4">
          <div className="h-6 w-32 bg-white/10 rounded" />
          <div className="flex gap-2">
             <div className="h-8 w-24 bg-white/10 rounded" />
             <div className="h-8 w-16 bg-white/10 rounded" />
          </div>
        </div>
        <div className="h-[200px] sm:h-[300px] bg-white/5 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 rounded-xl bg-white/5 border border-white/10 transition-all duration-300">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 mb-6">
        
        {/* Row 1: Title & Metrics (Mobile: Stacked, Desktop: Row) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base sm:text-lg font-semibold text-white">系统负载</h3>
             {loading && data.length > 0 && <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />}
          </div>

          <div className="flex flex-wrap items-center gap-2">
              {/* CPU */}
              <button 
                onClick={() => toggleMetric('cpu')}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] sm:text-xs font-medium transition-colors border",
                  visibleMetrics.cpu 
                    ? "bg-primary/10 border-primary/30 text-primary" 
                    : "bg-white/5 border-transparent text-gray-500 hover:text-gray-300"
                )}
              >
                <div className={cn("w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full", visibleMetrics.cpu ? "bg-primary" : "bg-gray-600")} />
                CPU
              </button>
              {/* RAM */}
              <button 
                onClick={() => toggleMetric('memory')}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] sm:text-xs font-medium transition-colors border",
                  visibleMetrics.memory 
                    ? "bg-blue-500/10 border-blue-500/30 text-blue-400" 
                    : "bg-white/5 border-transparent text-gray-500 hover:text-gray-300"
                )}
              >
                <div className={cn("w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full", visibleMetrics.memory ? "bg-blue-400" : "bg-gray-600")} />
                内存
              </button>
              {/* IO */}
              <button 
                onClick={() => toggleMetric('disk')}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] sm:text-xs font-medium transition-colors border",
                  visibleMetrics.disk 
                    ? "bg-green-500/10 border-green-500/30 text-green-400" 
                    : "bg-white/5 border-transparent text-gray-500 hover:text-gray-300"
                )}
              >
                <div className={cn("w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full", visibleMetrics.disk ? "bg-green-400" : "bg-gray-600")} />
                磁盘
              </button>
              {/* JVM */}
              <button 
                onClick={() => toggleMetric('jvm')}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] sm:text-xs font-medium transition-colors border",
                  visibleMetrics.jvm 
                    ? "bg-orange-500/10 border-orange-500/30 text-orange-400" 
                    : "bg-white/5 border-transparent text-gray-500 hover:text-gray-300"
                )}
              >
                <div className={cn("w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full", visibleMetrics.jvm ? "bg-orange-400" : "bg-gray-600")} />
                JVM
              </button>
          </div>
        </div>

        {/* Row 2: Controls & Warning */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/5 p-2 rounded-lg border border-white/5">
           
           {/* Left: Warning (if any) or Spacer */}
           <div className="flex-1">
             {minutes > 1440 && (
              <div className="flex items-center gap-1.5 text-[10px] text-yellow-500/80">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
                长周期数据需依赖持久化存储
              </div>
            )}
           </div>

           {/* Right: Selectors */}
           <div className="flex items-center gap-2 justify-between sm:justify-end w-full sm:w-auto">
              <select
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                className="bg-zinc-900 border border-white/10 text-white text-[10px] sm:text-xs rounded-md px-2 py-1 focus:outline-none focus:border-primary/50 max-w-[100px] sm:max-w-none"
              >
                <option value="30">30 分钟</option>
                <option value="60">1 小时</option>
                <option value="180">3 小时</option>
                <option value="720">12 小时</option>
                <option value="1440">24 小时</option>
                <option value="4320">3 天</option>
                <option value="10080">7 天</option>
                <option value="43200">30 天</option>
              </select>

              <div className="w-px h-4 bg-white/10" />

              <select
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                className="bg-transparent text-gray-400 text-[10px] sm:text-xs focus:outline-none"
              >
                <option value="5">5s</option>
                <option value="10">10s</option>
                <option value="30">30s</option>
                <option value="60">1m</option>
                <option value="300">5m</option>
              </select>

              <div className="w-px h-4 bg-white/10" />

               <button
                  onClick={() => fetchHistory(true)}
                  className="p-1 text-gray-400 hover:text-white transition-colors"
                  title="刷新"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
                </button>
                
                <button
                  onClick={handleCleanup}
                  disabled={isCleaning}
                  className="p-1 text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
                  title="清理"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
           </div>
        </div>
      </div>

      {/* Chart - Responsive Height and Opacity Transition */}
      <div className={cn(
        "h-[250px] sm:h-[300px] w-full transition-opacity duration-300",
        loading && data.length > 0 ? "opacity-50 blur-[1px]" : "opacity-100"
      )}>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
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
                stroke="#4b5563" 
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10 }}
                minTickGap={30}
                tickFormatter={formatXAxis}
                height={30}
              />
              <YAxis 
                stroke="#4b5563" 
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10 }}
                domain={[0, 100]}
                unit="%"
                width={30}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="p-2 sm:p-3 bg-zinc-900/95 backdrop-blur-md border border-white/10 rounded-lg shadow-xl z-50 min-w-[120px]">
                        <p className="text-zinc-500 text-[10px] mb-1.5 uppercase font-medium tracking-wider">
                          {formatTooltipLabel(label)}
                        </p>
                        {payload.map((entry: any) => (
                          <div key={entry.name} className="flex items-center gap-2 text-xs font-medium mb-1 last:mb-0">
                            <div 
                              className="w-1.5 h-1.5 rounded-full shadow-[0_0_5px_currentColor]"
                              style={{ backgroundColor: entry.stroke, color: entry.stroke }}
                            />
                            <span className="text-gray-300 w-10">{entry.name}</span>
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
                  isAnimationActive={!loading} // Prevent re-animation flicker during updates
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
                  isAnimationActive={!loading}
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
                  isAnimationActive={!loading}
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
                  isAnimationActive={!loading}
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
