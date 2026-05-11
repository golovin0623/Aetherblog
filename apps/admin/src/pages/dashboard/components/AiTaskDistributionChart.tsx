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
  embedding: '向量化',
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

  const hasData = sortedData.length > 0 && totalCost > 0;

  // ref: 移动端 min-h-[360px] 让 ResponsiveContainer 拿不到 definite height, BarChart
  // 在 height="100%" 下渲染为空。改用根据 bar 数量推导的定值高度: 头部/轴/边距固定 ~110px,
  // 每个任务类型再追加 44px, 兜底 360px (零数据态也保持视觉占位)。
  // ref: chatgpt-codex on PR #650 — 后端 analytics_repo.go GROUP BY task_type 无 LIMIT,
  // 自定义 task code 累积时 (50 个 → 2310px) 卡片会拉爆 dashboard 整页。叠一个 720px
  // 上限, 超出走容器内滚动, 既保留每行 44px 的可读性, 又锁住对页面布局的影响。
  // ref: chatgpt-codex on PR #650 #2 — 当 task 分组很多但 totalCost === 0 (例如 cached-only
  // 或 pricing 缺失), hasData=false 走空态文案, 不应继承 bar-count 高度, 收回到 360px。
  const naturalChartHeight = hasData
    ? Math.max(360, sortedData.length * 44 + 110)
    : 360;
  const chartHeight = Math.min(720, naturalChartHeight);
  const needsScroll = naturalChartHeight > chartHeight;

  if (loading) {
    return (
      <div
        className="surface-leaf surface-dashboard-card p-6 rounded-xl"
        style={{ height: `${chartHeight}px` }}
      >
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
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div
            style={
              needsScroll
                ? { height: `${naturalChartHeight - 88}px` }
                : { height: '100%' }
            }
          >
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
        </div>
      )}
    </div>
  );
}

export default AiTaskDistributionChart;
