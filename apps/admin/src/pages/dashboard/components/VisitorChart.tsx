import { useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface VisitorChartProps {
  data: { date: string; pv: number; uv: number }[];
  loading?: boolean;
  timeRange?: '7d' | '30d';
  onTimeRangeChange?: (range: '7d' | '30d') => void;
}

export function VisitorChart({ 
  data, 
  loading, 
  timeRange: controlledTimeRange,
  onTimeRangeChange 
}: VisitorChartProps) {
  const [activeTab, setActiveTab] = useState<'pv' | 'uv'>('pv');
  // Support both controlled and uncontrolled modes
  const [internalTimeRange, setInternalTimeRange] = useState<'7d' | '30d'>('7d');
  const timeRange = controlledTimeRange ?? internalTimeRange;
  
  const handleTimeRangeChange = (range: '7d' | '30d') => {
    if (onTimeRangeChange) {
      onTimeRangeChange(range);
    } else {
      setInternalTimeRange(range);
    }
  };

  if (loading) {
    return (
      <div className="p-4 sm:p-6 rounded-xl bg-white/5 border border-white/10 h-[420px]">
        <div className="flex justify-between items-center mb-6">
          <div className="space-y-2">
            <div className="w-24 h-6 bg-white/10 rounded animate-pulse" />
            <div className="w-32 h-4 bg-white/10 rounded animate-pulse" />
          </div>
          <div className="flex gap-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="w-12 h-8 bg-white/10 rounded animate-pulse" />
            ))}
          </div>
        </div>
        <div className="h-[300px] bg-white/5 rounded-lg animate-pulse relative overflow-hidden">
          {/* Shimmer effect */}
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
        </div>
      </div>
    );
  }

  // Generate extended mock data based on timeRange if needed
  // In real app, parent should fetch data based on timeRange
  const displayData = data;

  return (
    <div className="p-4 sm:p-6 rounded-xl bg-white/5 border border-white/10 h-[420px] flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div>
          <h3 className="text-lg font-semibold text-white">访问趋势</h3>
          <p className="text-sm text-gray-400 mt-1">
            {activeTab === 'pv' ? '页面浏览量 (Page Views)' : '独立访客 (Unique Visitors)'}
          </p>
        </div>
        {/* Button group - wraps on mobile */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 p-1 rounded-lg bg-white/5 border border-white/5">
          <button
            onClick={() => setActiveTab('pv')}
            className={cn(
              "px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-all min-w-[36px] touch-manipulation",
              activeTab === 'pv'
                ? "bg-primary text-white shadow-lg"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            )}
          >
            PV
          </button>
          <button
            onClick={() => setActiveTab('uv')}
            className={cn(
              "px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-all min-w-[36px] touch-manipulation",
              activeTab === 'uv'
                ? "bg-cyan-500 text-white shadow-lg"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            )}
          >
            UV
          </button>
          <div className="hidden sm:block w-px h-4 bg-white/10 mx-0.5 sm:mx-1" />
          <button
            onClick={() => handleTimeRangeChange('7d')}
            className={cn(
              "px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-all min-w-[40px] touch-manipulation",
              timeRange === '7d'
                ? "bg-white/10 text-white"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            )}
          >
            7天
          </button>
          <button
            onClick={() => handleTimeRangeChange('30d')}
            className={cn(
              "px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-all min-w-[44px] touch-manipulation",
              timeRange === '30d'
                ? "bg-white/10 text-white"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            )}
          >
            30天
          </button>
        </div>
      </div>
      {/* Chart with flex-1 to fill remaining space */}
      <div className="flex-1 w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={displayData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorPv" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorUv" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="#6b7280"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
              interval="preserveStartEnd"
              tickFormatter={(value) => value.slice(5)} // Show MM-DD
            />
            <YAxis
              stroke="#6b7280"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
              width={40}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="p-3 bg-zinc-900/90 backdrop-blur-md border border-white/10 rounded-lg shadow-xl">
                      <p className="text-zinc-400 text-xs mb-2">{label}</p>
                      {payload.map((entry: any) => (
                        <div key={entry.name} className="flex items-center gap-2 text-sm font-medium">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: entry.color }}
                          />
                          <span className="text-white">
                            {entry.name}: {entry.value.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                }
                return null;
              }}
            />

            {activeTab === 'pv' && (
              <Area
                type="monotone"
                dataKey="pv"
                name="页面浏览"
                stroke="#8b5cf6"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorPv)"
                animationDuration={1000}
              />
            )}

            {activeTab === 'uv' && (
              <Area
                type="monotone"
                dataKey="uv"
                name="独立访客"
                stroke="#06b6d4"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorUv)"
                animationDuration={1000}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default VisitorChart;
