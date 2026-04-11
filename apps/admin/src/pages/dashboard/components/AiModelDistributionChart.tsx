import { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { ChevronUp, ChevronDown } from 'lucide-react';
import type { AiModelDistribution } from '@/services/analyticsService';

interface AiModelDistributionChartProps {
  data: AiModelDistribution[];
  loading?: boolean;
}

const COLORS = [
  '#6366f1', // indigo-500
  '#14b8a6', // teal-500
  '#f59e0b', // amber-500
  '#ec4899', // pink-500
  '#22c55e', // green-500
  '#06b6d4', // cyan-500
  '#8b5cf6', // violet-500
  '#f43f5e', // rose-500
  '#0ea5e9', // sky-500
  '#84cc16', // lime-500
];

const PAGE_SIZE = 4;

const formatPercent = (value: number | undefined | null): string => {
  if (value == null || !Number.isFinite(value)) return '0.00';
  return value.toFixed(2);
};

export function AiModelDistributionChart({ data, loading = false }: AiModelDistributionChartProps) {
  const [page, setPage] = useState(0);

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => (b.calls ?? 0) - (a.calls ?? 0));
  }, [data]);

  const totalCalls = useMemo(
    () => sortedData.reduce((sum, item) => sum + (item.calls ?? 0), 0),
    [sortedData]
  );

  const totalPages = Math.max(1, Math.ceil(sortedData.length / PAGE_SIZE));

  // Reset page when data changes to avoid out-of-bounds state
  useEffect(() => {
    setPage(0);
  }, [sortedData.length]);

  const currentPage = Math.min(page, totalPages - 1);
  const visibleModels = sortedData.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE
  );

  if (loading) {
    return (
      <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] h-[360px]">
        <div className="h-6 w-44 bg-[var(--bg-secondary)] rounded animate-pulse mb-6" />
        <div className="flex gap-4">
          <div className="w-[150px] h-[150px] rounded-full bg-[var(--bg-secondary)] animate-pulse" />
          <div className="flex-1 space-y-3">
            <div className="h-4 bg-[var(--bg-secondary)] rounded animate-pulse" />
            <div className="h-4 bg-[var(--bg-secondary)] rounded animate-pulse" />
            <div className="h-4 bg-[var(--bg-secondary)] rounded animate-pulse" />
            <div className="h-4 bg-[var(--bg-secondary)] rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  const chartData = sortedData.map((item, index) => ({
    name: item.model,
    value: item.calls,
    percentage: item.percentage,
    providerCode: item.providerCode,
    color: COLORS[index % COLORS.length],
  }));

  const hasData = chartData.length > 0 && totalCalls > 0;

  return (
    <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] h-[360px] flex flex-col">
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">模型调用占比</h3>
      <div className="flex-1 min-h-0 flex flex-row items-center gap-4">
        {/* Left: enhanced donut chart */}
        <div className="relative shrink-0 w-[150px] h-[150px]">
          {hasData ? (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 6, right: 6, bottom: 6, left: 6 }}>
                  <defs>
                    {chartData.map((entry, index) => (
                      <linearGradient
                        key={`grad-${index}`}
                        id={`aiModelSliceGradient-${index}`}
                        x1="0"
                        y1="0"
                        x2="1"
                        y2="1"
                      >
                        <stop offset="0%" stopColor={entry.color} stopOpacity={1} />
                        <stop offset="100%" stopColor={entry.color} stopOpacity={0.55} />
                      </linearGradient>
                    ))}
                    <filter
                      id="aiModelSliceGlow"
                      x="-50%"
                      y="-50%"
                      width="200%"
                      height="200%"
                    >
                      <feGaussianBlur stdDeviation="2.5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <radialGradient id="aiModelSliceInnerShadow" cx="50%" cy="50%" r="50%">
                      <stop offset="60%" stopColor="rgba(0,0,0,0)" />
                      <stop offset="100%" stopColor="rgba(0,0,0,0.25)" />
                    </radialGradient>
                  </defs>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={42}
                    outerRadius={64}
                    dataKey="value"
                    nameKey="name"
                    paddingAngle={3}
                    cornerRadius={4}
                    stroke="none"
                    filter="url(#aiModelSliceGlow)"
                    isAnimationActive
                    activeShape={undefined}
                  >
                    {chartData.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={`url(#aiModelSliceGradient-${index})`}
                        stroke="none"
                        style={{ outline: 'none' }}
                        tabIndex={-1}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    cursor={false}
                    wrapperStyle={{ outline: 'none' }}
                    formatter={(value: number, _name: string, payload: any) => {
                      const item = payload?.payload;
                      return [
                        `${value} 次 (${formatPercent(item?.percentage)}%)`,
                        item?.providerCode || 'unknown',
                      ];
                    }}
                    contentStyle={{
                      backgroundColor: 'var(--bg-card)',
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--text-primary)',
                      borderRadius: '0.75rem',
                      backdropFilter: 'blur(12px)',
                      boxShadow:
                        '0 10px 30px -10px rgba(0,0,0,0.35), 0 2px 6px -2px rgba(0,0,0,0.25)',
                    }}
                    itemStyle={{ color: 'var(--text-primary)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Center overlay: total calls */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                  总调用
                </div>
                <div className="text-xl font-semibold text-[var(--text-primary)] leading-tight">
                  {totalCalls.toLocaleString()}
                </div>
                <div className="text-[10px] text-[var(--text-tertiary)]">
                  {sortedData.length} 个模型
                </div>
              </div>
            </>
          ) : (
            <div className="w-full h-full rounded-full border border-dashed border-[var(--border-subtle)] flex items-center justify-center text-xs text-[var(--text-tertiary)]">
              暂无数据
            </div>
          )}
        </div>

        {/* Right: paginated model list */}
        <div className="flex-1 min-w-0 flex flex-col h-full py-1">
          <div className="flex-1 min-h-0 flex flex-col justify-center gap-2.5">
            {visibleModels.length === 0 ? (
              <div className="text-xs text-[var(--text-tertiary)] text-center">暂无模型</div>
            ) : (
              visibleModels.map((item) => {
                const globalIndex = sortedData.findIndex((s) => s.model === item.model);
                const color = COLORS[globalIndex % COLORS.length];
                return (
                  <div
                    key={`${item.providerCode}-${item.model}`}
                    className="flex items-center gap-2.5 min-w-0"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0 shadow-sm"
                      style={{
                        backgroundColor: color,
                        boxShadow: `0 0 6px ${color}55`,
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                        {item.model}
                      </div>
                      <div className="text-[11px] text-[var(--text-tertiary)] truncate">
                        {(item.calls ?? 0).toLocaleString()} 次 · {formatPercent(item.percentage)}%
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 mt-1 border-t border-[var(--border-subtle)]">
              <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums">
                {currentPage + 1} / {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                  className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="上一页"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={currentPage >= totalPages - 1}
                  className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="下一页"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AiModelDistributionChart;
