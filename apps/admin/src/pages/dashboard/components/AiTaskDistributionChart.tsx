import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AiTaskDistribution } from '@/services/analyticsService';

interface AiTaskDistributionChartProps {
  data: AiTaskDistribution[];
  loading?: boolean;
}

/**
 * 7 个内置 task 的中文化标签 -- 与 ai_task_types.code seed (migration 000019)
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
  embedding: '向量化',
};

const COLORS = [
  '#6366f1', // indigo-500
  '#14b8a6', // teal-500
  '#f59e0b', // amber-500
  '#ec4899', // pink-500
  '#22c55e', // green-500
  '#06b6d4', // cyan-500
  '#8b5cf6', // violet-500
  '#f43f5e', // rose-500
];

const TASK_COLORS: Record<string, string> = {
  summary: COLORS[0],
  tags: COLORS[1],
  titles: COLORS[2],
  polish: COLORS[3],
  outline: COLORS[4],
  translate: COLORS[5],
  qa: COLORS[6],
  embedding: COLORS[7],
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

  if (loading) {
    return (
      <div className="surface-leaf surface-dashboard-card p-6 rounded-xl min-h-[360px] md:h-[360px]">
        <div className="h-6 w-44 bg-[var(--bg-secondary)] rounded animate-pulse mb-6" />
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-4 w-16 bg-[var(--bg-secondary)] rounded animate-pulse" />
              <div className="flex-1 h-5 bg-[var(--bg-secondary)] rounded animate-pulse" />
              <div className="h-4 w-12 bg-[var(--bg-secondary)] rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const hasData = sortedData.length > 0 && totalCost > 0;

  return (
    <div className="surface-leaf surface-dashboard-card p-6 rounded-xl min-h-[360px] md:h-[360px] flex flex-col">
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
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={sortedData}
              layout="vertical"
              margin={{ top: 6, right: 24, left: 8, bottom: 6 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
              <XAxis
                type="number"
                stroke="var(--text-muted)"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
                tickFormatter={(value: number) => formatCost(value)}
              />
              <YAxis
                type="category"
                dataKey="task"
                stroke="var(--text-muted)"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12 }}
                width={88}
              />
              <Tooltip
                cursor={{ fill: 'var(--bg-card-hover)', opacity: 0.4 }}
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
                formatter={(value: number, _name, payload) => {
                  // 单条 Bar 时 Recharts 仍把 series 名 "cost" 透传; 我们用 payload 里
                  // 完整的行数据自定义渲染三件套 (calls / tokens / cost) 的 tooltip
                  const item = payload?.payload;
                  if (!item) return [formatCost(value), 'cost'];
                  return [
                    `${formatCost(item.cost)} · ${formatNumber(item.calls)} 次 · ${formatNumber(item.tokens)} tokens`,
                    item.task,
                  ];
                }}
              />
              <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                {sortedData.map((entry) => (
                  <Cell key={entry.rawTask} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default AiTaskDistributionChart;
