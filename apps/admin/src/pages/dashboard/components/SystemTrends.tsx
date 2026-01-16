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
import { logger } from '@/lib/logger';
import { format, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';

// ========== Chart Data Helper ==========

interface MergedDataPoint {
  time: string;  // ISO String from backend
  cpu: number;
  memory: number;
  disk: number;
  timestamp: number; // Parsed timestamp for sorting/formatting
}

function mergeHistoryData(history: MetricHistory): MergedDataPoint[] {
  if (!history.cpu || history.cpu.length === 0) return [];
  
  return history.cpu.map((point, index) => ({
    time: point.time,
    cpu: point.value,
    memory: history.memory[index]?.value || 0,
    disk: history.disk[index]?.value || 0,
    timestamp: parseISO(point.time).getTime()
  }));
}

// ========== Component ==========

export function SystemTrends({ className }: { className?: string }) {
  const [data, setData] = useState<MergedDataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [minutes, setMinutes] = useState(60); // View last 60 mins
  const [visibleMetrics, setVisibleMetrics] = useState({
    cpu: true,
    memory: true,
    disk: true
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
      logger.error('Failed to fetch history:', err);
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
      logger.error('Failed to clear history:', err);
      toast.error('清理请求失败');
    } finally {
      setIsCleaning(false);
    }
  };

  const toggleMetric = (key: keyof typeof visibleMetrics) => {
    setVisibleMetrics(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Calculate Ticks based on time range (Time-aligned)
  const ticks = useMemo(() => {
    if (data.length === 0) return [];
    
    // 1. Determine nice interval based on range
    let intervalMs = 3600 * 1000; // Default 1h
    if (minutes <= 30) intervalMs = 5 * 60 * 1000; // 5 min
    else if (minutes <= 60) intervalMs = 10 * 60 * 1000; // 10 min
    else if (minutes <= 180) intervalMs = 30 * 60 * 1000; // 30 min
    else if (minutes <= 720) intervalMs = 2 * 3600 * 1000; // 2 hours
    else if (minutes <= 1440) intervalMs = 4 * 3600 * 1000; // 4 hours
    else if (minutes <= 4320) intervalMs = 12 * 3600 * 1000; // 12 hours
    else intervalMs = 24 * 3600 * 1000; // 1 day

    const startTime = data[0].timestamp;
    const endTime = data[data.length - 1].timestamp;
    
    // 2. Align start to next interval (Round up to nearest nice tick)
    let current = Math.ceil(startTime / intervalMs) * intervalMs;
    const generatedTicks: string[] = [];
    
    while (current <= endTime) {
        // Find closest data point to represent this tick
        // Since XAxis is categorical, we need the exact string from data
        const closest = data.reduce((prev, curr) => 
            Math.abs(curr.timestamp - current) < Math.abs(prev.timestamp - current) ? curr : prev
        );
        
        // Avoid duplicates and ensure we don't jump back in time (though sorted data prevents that usually)
        if (!generatedTicks.includes(closest.time)) {
             generatedTicks.push(closest.time);
        }
        current += intervalMs;
    }

    // Ensure we have at least a few ticks if alignment skipped too many
    if (generatedTicks.length < 2) {
        generatedTicks.push(data[0].time);
        generatedTicks.push(data[data.length-1].time);
    }

    return generatedTicks;
  }, [data, minutes]);

  // Smart Formatter
  const formatXAxis = (isoTime: string, index: number) => {
    // Hide the first tick to prevent overlap with Y-axis
    if (index === 0) return '';
    
    try {
      const date = parseISO(isoTime);
      if (minutes > 1440) { // > 24 Hours
        return format(date, 'MM-dd');
      }
      return format(date, 'HH:mm');
    } catch (e) {
      return '';
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
      <div className={cn("p-4 sm:p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col", className)}>
        <div className="flex flex-col sm:flex-row justify-between mb-6 gap-4">
          <div className="h-6 w-32 bg-[var(--bg-secondary)] rounded animate-pulse" />
          <div className="flex gap-2">
             <div className="h-8 w-24 bg-[var(--bg-secondary)] rounded animate-pulse" />
             <div className="h-8 w-16 bg-[var(--bg-secondary)] rounded animate-pulse" />
          </div>
        </div>
        <div className="flex-1 bg-[var(--bg-secondary)] rounded-xl animate-pulse relative overflow-hidden">
          {/* Shimmer effect */}
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-[var(--bg-card-hover)] to-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("p-4 sm:p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] transition-all duration-300 flex flex-col", className)}>
      {/* Unified Header & Controls */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between mb-6 gap-4 shrink-0">
        
        {/* Left: Title & Status */}
        <div className="flex items-center gap-3">
          <h3 className="text-base sm:text-lg font-semibold text-[var(--text-primary)]">系统负载</h3>
          {loading && data.length > 0 && <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />}
          {minutes > 1440 && (
             <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-yellow-500/80 bg-yellow-500/10 px-2 py-0.5 rounded-full">
               <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
               长周期数据需依赖持久化
             </div>
          )}
        </div>

        {/* Right: Toolbar (Legend + Controls) */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          
          {/* Legend Group */}
          <div className="flex items-center gap-2">
               {/* CPU */}
               <button 
                 onClick={() => toggleMetric('cpu')}
                 className={cn(
                   "flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-colors border",
                   visibleMetrics.cpu 
                     ? "bg-primary/10 border-primary/30 text-primary" 
                     : "bg-[var(--bg-secondary)] border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                 )}
               >
                 <div className={cn("w-1.5 h-1.5 rounded-full", visibleMetrics.cpu ? "bg-primary" : "bg-[var(--text-muted)]")} />
                 CPU
               </button>
               {/* RAM */}
               <button 
                 onClick={() => toggleMetric('memory')}
                 className={cn(
                   "flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-colors border",
                   visibleMetrics.memory 
                     ? "bg-blue-500/10 border-blue-500/30 text-blue-400" 
                     : "bg-[var(--bg-secondary)] border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                 )}
               >
                 <div className={cn("w-1.5 h-1.5 rounded-full", visibleMetrics.memory ? "bg-blue-400" : "bg-[var(--text-muted)]")} />
                 内存
               </button>
               {/* 磁盘 */}
               <button 
                 onClick={() => toggleMetric('disk')}
                 className={cn(
                   "flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-colors border",
                   visibleMetrics.disk 
                     ? "bg-green-500/10 border-green-500/30 text-green-400" 
                     : "bg-[var(--bg-secondary)] border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                 )}
               >
                 <div className={cn("w-1.5 h-1.5 rounded-full", visibleMetrics.disk ? "bg-green-400" : "bg-[var(--text-muted)]")} />
                 磁盘
               </button>
          </div>

          <div className="w-px h-4 bg-[var(--border-subtle)] hidden sm:block" />

          {/* Controls Group */}
          <div className="flex items-center bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-subtle)] p-0.5 h-7">
             <select
                 value={minutes}
                 onChange={(e) => setMinutes(Number(e.target.value))}
                 className="bg-transparent text-[var(--text-primary)] text-[10px] px-2 focus:outline-none border-none cursor-pointer hover:text-primary transition-colors appearance-none text-center h-full min-w-[50px]"
                 title="时间范围"
               >
                 <option value="30">30分</option>
                 <option value="60">1小时</option>
                 <option value="180">3小时</option>
                 <option value="720">12小时</option>
                 <option value="1440">24小时</option>
                 <option value="4320">3天</option>
                 <option value="10080">7天</option>
                 <option value="43200">30天</option>
             </select>
             
             <div className="w-px h-3 bg-[var(--border-subtle)] mx-0.5" />

             <select
                 value={refreshInterval}
                 onChange={(e) => setRefreshInterval(Number(e.target.value))}
                 className="bg-transparent text-[var(--text-muted)] text-[10px] px-2 focus:outline-none border-none cursor-pointer hover:text-[var(--text-primary)] transition-colors appearance-none text-center h-full min-w-[40px]"
                 title="刷新频率"
               >
                 <option value="5">5s</option>
                 <option value="10">10s</option>
                 <option value="30">30s</option>
                 <option value="60">1m</option>
                 <option value="300">5m</option>
             </select>

             <div className="w-px h-3 bg-[var(--border-subtle)] mx-0.5" />

             <button
               onClick={() => fetchHistory(true)}
               className="h-full px-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors flex items-center justify-center"
               title="刷新数据"
             >
               <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
             </button>
             
             <div className="w-px h-3 bg-[var(--border-subtle)] mx-0.5" />

             <button
               onClick={handleCleanup}
               disabled={isCleaning}
               className="h-full px-2 text-[var(--text-muted)] hover:text-red-400 transition-colors disabled:opacity-50 flex items-center justify-center"
               title="清理历史数据"
             >
               <Trash2 className="w-3 h-3" />
             </button>
          </div>
        </div>
      </div>

      {/* Chart - Responsive Height and Opacity Transition */}
      <div className={cn(
        "flex-1 w-full transition-opacity duration-300 min-h-[250px]",
        loading && data.length > 0 ? "opacity-50 blur-[1px]" : "opacity-100"
      )}>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
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
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
              <XAxis 
                dataKey="time" 
                stroke="var(--text-secondary)" 
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                ticks={ticks}
                interval="preserveStartEnd"
                minTickGap={30}
                tickFormatter={formatXAxis}
                height={30}
              />
              <YAxis 
                stroke="var(--text-secondary)" 
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                tickFormatter={(value) => `${value}%`}
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                width={40}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const visiblePayload = payload.filter((entry: any) => {
                      if (entry.dataKey === 'cpu') return visibleMetrics.cpu;
                      if (entry.dataKey === 'memory') return visibleMetrics.memory;
                      if (entry.dataKey === 'disk') return visibleMetrics.disk;
                      return true;
                    });

                    if (visiblePayload.length === 0) return null;

                    return (
                      <div className="p-2 sm:p-3 bg-[var(--bg-card)] backdrop-blur-md border border-[var(--border-subtle)] rounded-lg shadow-xl z-50 min-w-[120px]">
                        <p className="text-[var(--text-muted)] text-[10px] mb-1.5 uppercase font-medium tracking-wider">
                          {formatTooltipLabel(label)}
                        </p>
                        {visiblePayload.map((entry: any) => (
                          <div key={entry.name} className="flex items-center gap-2 text-xs font-medium mb-1 last:mb-0">
                            <div 
                              className="w-1.5 h-1.5 rounded-full shadow-[0_0_5px_currentColor]"
                              style={{ backgroundColor: entry.stroke, color: entry.stroke }}
                            />
                            <span className="text-[var(--text-secondary)] w-10">{entry.name}</span>
                            <span className="text-[var(--text-primary)] font-mono ml-auto">
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
              
              <Area
                key="cpu"
                type="monotone"
                dataKey="cpu"
                name="CPU"
                stroke="#8b5cf6"
                strokeWidth={2}
                fill="url(#colorCpu)"
                animationDuration={300}
                isAnimationActive={true}
                strokeOpacity={visibleMetrics.cpu ? 1 : 0}
                fillOpacity={visibleMetrics.cpu ? 1 : 0}
                style={{ transition: 'all 0.3s ease', pointerEvents: visibleMetrics.cpu ? 'auto' : 'none' }}
              />
              <Area
                key="memory"
                type="monotone"
                dataKey="memory"
                name="内存"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#colorMem)"
                animationDuration={300}
                isAnimationActive={true}
                strokeOpacity={visibleMetrics.memory ? 1 : 0}
                fillOpacity={visibleMetrics.memory ? 1 : 0}
                style={{ transition: 'all 0.3s ease', pointerEvents: visibleMetrics.memory ? 'auto' : 'none' }}
              />
              <Area
                key="disk"
                type="monotone"
                dataKey="disk"
                name="磁盘"
                stroke="#22c55e"
                strokeWidth={2}
                fill="url(#colorDisk)"
                animationDuration={300}
                isAnimationActive={true}
                strokeOpacity={visibleMetrics.disk ? 1 : 0}
                fillOpacity={visibleMetrics.disk ? 1 : 0}
                style={{ transition: 'all 0.3s ease', pointerEvents: visibleMetrics.disk ? 'auto' : 'none' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--text-muted)] text-sm">
             暂无历史数据，请等待采集...
          </div>
        )}
      </div>

    </div>
  );
}
