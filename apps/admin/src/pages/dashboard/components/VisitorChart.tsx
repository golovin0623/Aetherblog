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
}

export function VisitorChart({ data, loading }: VisitorChartProps) {
  const [activeTab, setActiveTab] = useState<'pv' | 'uv'>('pv');
  const [timeRange, setTimeRange] = useState<'7d' | '30d'>('7d');

  if (loading) {
    return (
      <div className="p-6 rounded-xl bg-white/5 border border-white/10 h-[380px] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Generate extended mock data based on timeRange if needed
  // In real app, parent should fetch data based on timeRange
  const displayData = data; 

  return (
    <div className="p-6 rounded-xl bg-white/5 border border-white/10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="text-lg font-semibold text-white">访问趋势</h3>
          <p className="text-sm text-gray-400 mt-1">
            {activeTab === 'pv' ? '页面浏览量 (Page Views)' : '独立访客 (Unique Visitors)'}
          </p>
        </div>
        
        <div className="flex items-center gap-2 p-1 rounded-lg bg-white/5 border border-white/5">
          <button
            onClick={() => setActiveTab('pv')}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
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
              "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
              activeTab === 'uv' 
                ? "bg-cyan-500 text-white shadow-lg" 
                : "text-gray-400 hover:text-white hover:bg-white/5"
            )}
          >
            UV
          </button>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <button
            onClick={() => setTimeRange('7d')}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
              timeRange === '7d' 
                ? "bg-white/10 text-white" 
                : "text-gray-400 hover:text-white hover:bg-white/5"
            )}
          >
            7天
          </button>
          <button
            onClick={() => setTimeRange('30d')}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
              timeRange === '30d' 
                ? "bg-white/10 text-white" 
                : "text-gray-400 hover:text-white hover:bg-white/5"
            )}
          >
            30天
          </button>
        </div>
      </div>

      <div className="h-[300px] w-full">
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
