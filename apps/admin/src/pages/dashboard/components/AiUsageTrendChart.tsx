import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AiTrendPoint } from '@/services/analyticsService';

interface AiUsageTrendChartProps {
  data: AiTrendPoint[];
  loading?: boolean;
}

export function AiUsageTrendChart({ data, loading = false }: AiUsageTrendChartProps) {
  if (loading) {
    return (
      <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] h-[360px]">
        <div className="h-6 w-36 bg-[var(--bg-secondary)] rounded animate-pulse mb-6" />
        <div className="h-[280px] bg-[var(--bg-secondary)] rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] h-[360px] flex flex-col">
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">AI 调用趋势</h3>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="aiCallsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="aiTokensGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => value.slice(5)}
              stroke="var(--text-muted)"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              yAxisId="left"
              stroke="var(--text-muted)"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
              width={40}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="var(--text-muted)"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
              width={56}
              tickFormatter={(value: number) => {
                if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
                return `${Math.round(value)}`;
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--bg-card)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-primary)',
                borderRadius: '0.75rem',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
              }}
              labelStyle={{ color: 'var(--text-secondary)', marginBottom: '0.25rem' }}
              itemStyle={{ color: 'var(--text-primary)' }}
              formatter={(value: number, name: string) => {
                if (name === 'tokens') {
                  return [value.toLocaleString(), 'Tokens'];
                }
                return [value.toLocaleString(), '调用次数'];
              }}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="calls"
              stroke="#6366f1"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#aiCallsGradient)"
              name="calls"
            />
            <Area
              yAxisId="right"
              type="monotone"
              dataKey="tokens"
              stroke="#14b8a6"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#aiTokensGradient)"
              name="tokens"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default AiUsageTrendChart;
