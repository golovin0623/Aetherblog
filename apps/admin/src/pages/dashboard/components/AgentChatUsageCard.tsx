import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, MessagesSquare, RotateCw } from 'lucide-react';
import { analyticsService, type AiTaskDistribution } from '@/services/analyticsService';
import { logger } from '@/lib/logger';

/**
 * 灵境对话（agent_chat）用量卡片。
 *
 * 数据链路：ai-service 在 agent_chat 落库 ai_usage_logs（token 为 provider
 * 真值优先、估算兜底），Go 端 GET /api/v1/admin/stats/ai-dashboard 的
 * taskDistribution 按 task_type 聚合并附带今日（服务器时区自然日）子集，
 * 本卡片以 taskType=agent_chat 固定拉取近 30 天窗口，展示今日 vs 近 30 天
 * 的调用数、Token in/out、成本合计与平均延迟。
 */

interface AgentChatWindowStats {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  avgLatencyMs: number;
}

interface AgentChatUsage {
  today: AgentChatWindowStats;
  last30d: AgentChatWindowStats;
}

const EMPTY_WINDOW: AgentChatWindowStats = {
  calls: 0,
  tokensIn: 0,
  tokensOut: 0,
  cost: 0,
  avgLatencyMs: 0,
};

const formatCount = (value: number): string => value.toLocaleString();

const formatTokens = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString();
};

const formatCost = (value: number): string => {
  if (!Number.isFinite(value) || value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
};

const formatLatency = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value >= 10_000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.round(value).toLocaleString()} ms`;
};

const toWindowStats = (row: AiTaskDistribution | undefined): AgentChatUsage => {
  if (!row) {
    return { today: EMPTY_WINDOW, last30d: EMPTY_WINDOW };
  }
  return {
    today: {
      calls: row.todayCalls ?? 0,
      tokensIn: row.todayTokensIn ?? 0,
      tokensOut: row.todayTokensOut ?? 0,
      cost: row.todayCost ?? 0,
      avgLatencyMs: row.todayAvgLatencyMs ?? 0,
    },
    last30d: {
      calls: row.calls ?? 0,
      tokensIn: row.tokensIn ?? 0,
      tokensOut: row.tokensOut ?? 0,
      cost: row.cost ?? 0,
      avgLatencyMs: row.avgLatencyMs ?? 0,
    },
  };
};

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div
        className="font-mono text-[10px] uppercase tracking-[0.2em]"
        style={{ color: 'var(--ink-muted)' }}
      >
        {label}
      </div>
      <div
        className="mt-1 truncate font-mono text-lg font-semibold leading-tight tabular-nums"
        style={{ color: 'var(--ink-primary)' }}
      >
        {value}
      </div>
    </div>
  );
}

function WindowPanel({ title, stats }: { title: string; stats: AgentChatWindowStats }) {
  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        borderColor: 'color-mix(in oklch, var(--ink-primary) 8%, transparent)',
        background: 'color-mix(in oklch, var(--ink-primary) 2.5%, transparent)',
      }}
    >
      <div
        className="font-mono text-[10px] uppercase tracking-[0.2em]"
        style={{ color: 'var(--ink-secondary)' }}
      >
        {title}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <MetricCell label="调用" value={formatCount(stats.calls)} />
        <MetricCell
          label="Token In / Out"
          value={`${formatTokens(stats.tokensIn)} / ${formatTokens(stats.tokensOut)}`}
        />
        <MetricCell label="成本合计" value={formatCost(stats.cost)} />
        <MetricCell label="平均延迟" value={formatLatency(stats.avgLatencyMs)} />
      </div>
    </div>
  );
}

/**
 * 拉取失败态：明确说「没拿到」，不渲染任何数字。
 * 与空态（真的 0 次调用）互斥 —— 全 0 的表格会让用户以为「确实没人用」。
 */
function ErrorPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex items-start gap-3 rounded-2xl border p-4"
      style={{
        borderColor: 'color-mix(in oklch, var(--signal-danger) 24%, transparent)',
        background: 'color-mix(in oklch, var(--signal-danger) 6%, transparent)',
      }}
      role="status"
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0"
        style={{ color: 'var(--signal-danger)' }}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <div className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
          用量数据加载失败
        </div>
        <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          没能取到近 30 天的调用统计，这里不展示数字 —— 以免把「取不到」显示成「没有调用」。
          网络恢复或后端可用后可重试。
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]"
          style={{
            borderColor: 'color-mix(in oklch, var(--ink-primary) 14%, transparent)',
            color: 'var(--ink-secondary)',
          }}
        >
          <RotateCw className="h-3 w-3" aria-hidden="true" />
          重试
        </button>
      </div>
    </div>
  );
}

function CardSkeleton() {
  const shimmer = { background: 'color-mix(in oklch, var(--ink-primary) 6%, transparent)' };
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-hidden="true">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="rounded-2xl border p-4"
          style={{ borderColor: 'color-mix(in oklch, var(--ink-primary) 8%, transparent)' }}
        >
          <div className="h-3 w-20 animate-pulse rounded" style={shimmer} />
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            {[0, 1, 2, 3].map((j) => (
              <div key={j}>
                <div className="h-2.5 w-16 animate-pulse rounded" style={shimmer} />
                <div className="mt-1.5 h-6 w-24 animate-pulse rounded" style={shimmer} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface AgentChatUsageCardProps {
  /** 变化时触发重新拉取（如归档费用后），保持与页面刷新通道一致。 */
  refreshToken?: number;
}

export function AgentChatUsageCard({ refreshToken = 0 }: AgentChatUsageCardProps) {
  const [usage, setUsage] = useState<AgentChatUsage | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * 「拉取失败」必须与「确实没有调用」分开。
   * 两者折叠成同一个全 0 视图会向用户断言一个错误事实（明明有用量，却显示
   * 「近 30 天暂无调用」）—— 拿不到数据时只能说「没拿到」，不能替后端下结论。
   */
  const [failed, setFailed] = useState(false);
  /** 「重试」按钮的自增计数 —— 与 refreshToken 同为 effect 触发源。 */
  const [retryNonce, setRetryNonce] = useState(0);
  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    const fetchUsage = async () => {
      setLoading(true);
      try {
        const response = await analyticsService.getAiDashboard({
          days: 30,
          taskType: 'agent_chat',
          pageNum: 1,
          pageSize: 1,
        });
        if (cancelled) return;
        if (response.code === 200 && response.data) {
          const row = (response.data.taskDistribution ?? []).find(
            (item) => item.task === 'agent_chat',
          );
          setUsage(toWindowStats(row));
          setFailed(false);
        } else {
          // 业务码非 200 同样是「没拿到数据」，不是「用量为 0」。
          logger.error('Agent chat usage request returned non-200:', response.code, response.message);
          setUsage(null);
          setFailed(true);
        }
      } catch (error) {
        logger.error('Failed to fetch agent chat usage:', error);
        if (cancelled) return;
        setUsage(null);
        setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchUsage();
    return () => {
      cancelled = true;
    };
  }, [refreshToken, retryNonce]);

  // 空态只在「拉取成功且确实为 0」时成立；失败态一律不下这个结论。
  const isEmpty = !loading && !failed && !(usage && usage.last30d.calls > 0);

  return (
    <section className="surface-leaf surface-dashboard-card rounded-xl p-6">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessagesSquare className="h-4 w-4" style={{ color: 'var(--ink-secondary)' }} />
          <h3 className="text-lg font-semibold" style={{ color: 'var(--ink-primary)' }}>
            灵境对话
          </h3>
        </div>
        <span
          className="font-mono text-[10px] uppercase tracking-[0.2em]"
          style={{ color: 'var(--ink-muted)' }}
        >
          Agent Chat · Usage
        </span>
      </div>

      <div className="mt-4">
        {loading ? (
          <CardSkeleton />
        ) : failed ? (
          <ErrorPanel onRetry={retry} />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <WindowPanel title="今日" stats={usage?.today ?? EMPTY_WINDOW} />
            <WindowPanel title="近 30 天" stats={usage?.last30d ?? EMPTY_WINDOW} />
          </div>
        )}
      </div>

      <p className="mt-3 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {isEmpty ? '近 30 天暂无灵境对话调用 · ' : ''}
        token 为 provider 真值优先、估算兜底；今日按服务器时区自然日统计；口径含自动起名与多模型对比产生的调用。
      </p>
    </section>
  );
}

export default AgentChatUsageCard;
