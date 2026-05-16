import { useEffect, useMemo, useRef, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { ChevronUp, ChevronDown } from 'lucide-react';
import type { AiModelDistribution } from '@/services/analyticsService';
import { DASHBOARD_AURORA_COLORS } from './palette';

interface AiModelDistributionChartProps {
  data: AiModelDistribution[];
  loading?: boolean;
}

const PAGE_SIZE = 4;

const formatPercent = (value: number | undefined | null): string => {
  if (value == null || !Number.isFinite(value)) return '0.00';
  return value.toFixed(2);
};

export function AiModelDistributionChart({ data, loading = false }: AiModelDistributionChartProps) {
  const [page, setPage] = useState(0);
  const chartFrameRef = useRef<HTMLDivElement>(null);
  const [chartSize, setChartSize] = useState(220);

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => (b.calls ?? 0) - (a.calls ?? 0));
  }, [data]);

  const totalCalls = useMemo(
    () => sortedData.reduce((sum, item) => sum + (item.calls ?? 0), 0),
    [sortedData]
  );

  const totalPages = Math.max(1, Math.ceil(sortedData.length / PAGE_SIZE));

  // 数据变化时重置页码，避免越界状态
  useEffect(() => {
    setPage(0);
  }, [sortedData.length]);

  useEffect(() => {
    const node = chartFrameRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setChartSize(Math.min(rect.width, rect.height));
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const currentPage = Math.min(page, totalPages - 1);
  const visibleModels = sortedData.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE
  );

  if (loading) {
    return (
      <div className="surface-leaf surface-dashboard-card p-6 rounded-xl min-h-[420px] md:h-[420px]">
        <div className="h-6 w-44 bg-[var(--bg-secondary)] rounded animate-pulse mb-6" />
        <div className="flex gap-4">
          <div className="w-[190px] h-[190px] rounded-full bg-[var(--bg-secondary)] animate-pulse" />
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
    color: DASHBOARD_AURORA_COLORS[index % DASHBOARD_AURORA_COLORS.length],
  }));

  const hasData = chartData.length > 0 && totalCalls > 0;
  const showCenterCount = chartSize >= 132;
  const showCenterLabels = chartSize >= 176;

  return (
    <div className="surface-leaf surface-dashboard-card p-6 rounded-xl min-h-[420px] md:h-[420px] flex flex-col">
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">模型调用占比</h3>
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 items-center gap-5">
        {/* 左侧：增强环形图 —— 与模型列表各占一半 */}
        <div
          ref={chartFrameRef}
          className="relative mx-auto h-[220px] w-[220px] md:h-full md:max-h-[300px] md:w-full md:aspect-square"
        >
          {hasData ? (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
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
                    innerRadius="50%"
                    outerRadius="80%"
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
                    wrapperStyle={{ outline: 'none', zIndex: 20 }}
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
              {/* 中心覆盖层：总调用次数 —— z-index 低于 tooltip */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-0">
                {showCenterLabels && (
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                    总调用
                  </div>
                )}
                {showCenterCount && (
                  <div className="text-2xl font-semibold leading-tight text-[var(--text-primary)]">
                    {totalCalls.toLocaleString()}
                  </div>
                )}
                {showCenterLabels && (
                  <div className="text-[10px] text-[var(--text-tertiary)]">
                    {sortedData.length} 个模型
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="w-full h-full rounded-full border border-dashed border-[var(--border-subtle)] flex items-center justify-center text-xs text-[var(--text-tertiary)]">
              暂无数据
            </div>
          )}
        </div>

        {/* 右侧：分页模型列表 —— 上/下按钮分离,页码位于下按钮下方 */}
        <div className="w-full min-w-0 h-full flex flex-col justify-center py-1">
          {totalPages > 1 && (
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="mx-auto mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="上一页"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          )}

          <div className="min-h-0 grid grid-cols-2 md:grid-cols-1 gap-3 content-center">
            {visibleModels.length === 0 ? (
              <div className="text-xs text-[var(--text-tertiary)] text-center">暂无模型</div>
            ) : (
              visibleModels.map((item, visibleIndex) => {
                const globalIndex = currentPage * PAGE_SIZE + visibleIndex;
                const color = DASHBOARD_AURORA_COLORS[globalIndex % DASHBOARD_AURORA_COLORS.length];
                return (
                  <div
                    key={`${item.providerCode}-${item.model}`}
                    className="flex items-center gap-2.5 min-w-0"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0 shadow-sm"
                      style={{
                        backgroundColor: color,
                        boxShadow: `0 0 8px color-mix(in oklch, ${color} 48%, transparent)`,
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
            <>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
                className="mx-auto mt-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="下一页"
              >
                <ChevronDown className="w-4 h-4" />
              </button>

              <div className="relative mt-3 flex items-center justify-center">
                <div className="absolute left-0 right-0 top-1/2 h-px bg-[var(--border-subtle)]" />
                <span className="relative bg-[var(--bg-leaf)] px-3 text-[11px] text-[var(--text-tertiary)] tabular-nums">
                  {currentPage + 1} / {totalPages}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AiModelDistributionChart;
