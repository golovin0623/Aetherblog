import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import type { AiModelDistribution } from '@/services/analyticsService';

interface AiModelDistributionChartProps {
  data: AiModelDistribution[];
  loading?: boolean;
}

const COLORS = ['#6366f1', '#14b8a6', '#f59e0b', '#ec4899', '#22c55e', '#06b6d4', '#8b5cf6'];

export function AiModelDistributionChart({ data, loading = false }: AiModelDistributionChartProps) {
  if (loading) {
    return (
      <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] h-[360px]">
        <div className="h-6 w-44 bg-[var(--bg-secondary)] rounded animate-pulse mb-6" />
        <div className="h-[280px] bg-[var(--bg-secondary)] rounded animate-pulse" />
      </div>
    );
  }

  const chartData = data.map(item => ({
    name: item.model,
    value: item.calls,
    percentage: item.percentage,
    providerCode: item.providerCode,
  }));

  const legendPayload = chartData.map((item, index) => ({
    value: `${item.name} (${item.percentage ?? 0}%)`,
    type: 'square' as const,
    color: COLORS[index % COLORS.length],
  }));

  return (
    <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] h-[360px] flex flex-col">
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">模型调用占比</h3>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="45%"
              innerRadius={55}
              outerRadius={90}
              dataKey="value"
              nameKey="name"
              paddingAngle={2}
            >
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, _name: string, payload: any) => {
                const item = payload?.payload;
                return [`${value} 次 (${item?.percentage || 0}%)`, item?.providerCode || 'unknown'];
              }}
              contentStyle={{
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '0.75rem',
              }}
            />
            <Legend
              verticalAlign="bottom"
              height={68}
              wrapperStyle={{ fontSize: 12 }}
              payload={legendPayload}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default AiModelDistributionChart;
