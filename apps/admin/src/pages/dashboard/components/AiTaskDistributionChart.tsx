import { useMemo, type CSSProperties } from 'react';
import type { AiTaskDistribution } from '@/services/analyticsService';
import { DASHBOARD_AURORA_COLORS } from './palette';

interface AiTaskDistributionChartProps {
  data: AiTaskDistribution[];
  loading?: boolean;
}

/**
 * 内置 task 的中文化标签 -- 与 ai_task_types.code seed (migration 000019)
 * 对齐。命中失败时退回到原始 code (例如自定义 task), 让 dashboard 仍可用。
 */
const TASK_LABEL_ZH: Record<string, string> = {
  summary: '摘要',
  tags: '标签',
  titles: '标题',
  polish: '润色',
  outline: '大纲',
  translate: '翻译',
  qa: '问答 (QA)',
  agent_chat: '灵境问答',
  embedding: '向量化索引',
  internal: '内部处理',
  index: '索引构建',
};

const COLORS = DASHBOARD_AURORA_COLORS;

const TASK_COLORS: Record<string, string> = {
  summary: COLORS[0],
  tags: COLORS[1],
  titles: COLORS[2],
  polish: COLORS[3],
  outline: COLORS[4],
  translate: COLORS[5],
  qa: COLORS[6],
  agent_chat: COLORS[7],
  embedding: COLORS[8],
  internal: COLORS[9],
  index: COLORS[10],
};

const getTaskColor = (task: string): string => {
  const mappedColor = TASK_COLORS[task];
  if (mappedColor) return mappedColor;

  const hash = Array.from(task).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return COLORS[hash % COLORS.length];
};

const formatCost = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
};

const formatNumber = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return '0';
  return value.toLocaleString();
};

const formatPercent = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return '0.00';
  return value.toFixed(2);
};

export function AiTaskDistributionChart({ data, loading = false }: AiTaskDistributionChartProps) {
  const sortedData = useMemo(() => {
    // 按 cost 降序 — 让"最烧钱的任务"立刻浮到顶, 满足审计 §1.2 "运营无法回答
    // 哪个工具最贵" 的下钻诉求
    return [...data]
      .map((item) => ({
        rawTask: item.task,
        task: TASK_LABEL_ZH[item.task] || item.task,
        calls: item.calls ?? 0,
        tokens: item.tokens ?? 0,
        cost: item.cost ?? 0,
        percentage: item.percentage ?? 0,
        color: getTaskColor(item.task),
      }))
      .sort((a, b) => b.cost - a.cost);
  }, [data]);

  const totalCost = useMemo(
    () => sortedData.reduce((sum, item) => sum + item.cost, 0),
    [sortedData],
  );

  const hasData = sortedData.length > 0 && totalCost > 0;

  // 用稳定面积的费用气泡卡代替横向比例条。极端高费用项只影响排序和文本比例,
  // 不再把低费用任务压到几乎不可见。
  const naturalChartHeight = hasData
    ? Math.max(360, Math.ceil(sortedData.length / 2) * 128 + 96)
    : 360;
  const chartHeight = Math.min(720, naturalChartHeight);

  if (loading) {
    return (
      <div
        className="surface-leaf surface-dashboard-card p-6 rounded-xl"
        style={{ height: `${chartHeight}px` }}
      >
        <div className="h-6 w-44 bg-[var(--bg-secondary)] rounded animate-pulse mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-[var(--bg-secondary)] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="surface-leaf surface-dashboard-card p-6 rounded-xl flex flex-col"
      style={{ height: `${chartHeight}px` }}
    >
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">任务费用分布</h3>
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)] font-mono">
          {hasData ? `合计 ${formatCost(totalCost)}` : '暂无数据'}
        </span>
      </div>
      {!hasData ? (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="text-xs text-[var(--text-tertiary)] py-8">
            当前过滤范围内没有任务费用记录
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {sortedData.map((item, index) => {
              const share = totalCost > 0 ? (item.cost / totalCost) * 100 : item.percentage;
              const cardStyle = {
                borderColor: `color-mix(in oklch, ${item.color} 30%, var(--border-subtle))`,
                background: `linear-gradient(135deg, color-mix(in oklch, ${item.color} 16%, transparent), transparent 58%), var(--bg-card)`,
              } satisfies CSSProperties;

              return (
                <article
                  key={item.rawTask}
                  className="relative min-h-[112px] overflow-hidden rounded-2xl border p-4 shadow-sm transition-colors hover:bg-[var(--bg-card-hover)]"
                  style={cardStyle}
                >
                  <div
                    className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full opacity-20 blur-sm"
                    style={{ backgroundColor: item.color }}
                  />
                  <div className="relative z-10 flex h-full flex-col justify-between gap-3">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                          {item.task}
                        </div>
                        <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                          #{index + 1} · 占总费用 {formatPercent(share)}%
                        </div>
                      </div>
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full shadow-sm"
                        style={{
                          backgroundColor: item.color,
                          boxShadow: `0 0 12px color-mix(in oklch, ${item.color} 62%, transparent)`,
                        }}
                      />
                    </div>

                    <div className="flex items-end justify-between gap-3">
                      <div className="font-mono text-xl font-semibold leading-none text-[var(--text-primary)]">
                        {formatCost(item.cost)}
                      </div>
                      <div className="grid shrink-0 grid-cols-2 gap-2 text-right text-[10px] text-[var(--text-tertiary)]">
                        <div>
                          <div className="font-mono text-xs text-[var(--text-secondary)]">
                            {formatNumber(item.calls)}
                          </div>
                          <div>次</div>
                        </div>
                        <div>
                          <div className="font-mono text-xs text-[var(--text-secondary)]">
                            {formatNumber(item.tokens)}
                          </div>
                          <div>tokens</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default AiTaskDistributionChart;
