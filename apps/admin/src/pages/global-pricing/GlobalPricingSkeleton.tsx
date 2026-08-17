import type { CSSProperties } from 'react';
import { AlertCircle, CheckCircle2, Coins, Layers, RefreshCw, Search, XCircle } from 'lucide-react';
import {
  IntelligenceHeader,
  IntelligencePanel,
  IntelligenceShell,
} from '@/components/intelligence';

const TABLE_HEADERS = ['Model ID', '供应商', '输入 / 1M', '输出 / 1M', '缓存 / 1M', '状态', '操作'];
const SEGMENT_WIDTHS = ['2.25rem', '3rem', '3rem', '4.5rem'];

function GlobalPricingSkeletonBlock({
  className = '',
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return <div aria-hidden="true" className={`global-pricing-skeleton-block ${className}`} style={style} />;
}

export function GlobalPricingMetricSkeletonGrid() {
  const metrics = [
    { label: '模型 ID 总数', icon: Layers, tone: 'neutral' },
    { label: '已配置全局价格', icon: CheckCircle2, tone: 'success' },
    { label: '未配置', icon: XCircle, tone: 'warning' },
    { label: '存在脱锚', icon: AlertCircle, tone: 'danger' },
  ] as const;

  return (
    <div className="global-pricing-metrics grid grid-cols-2 gap-3 xl:grid-cols-4">
      {metrics.map(({ label, icon: Icon, tone }) => (
        <div key={label} className="intelligence-metric global-pricing-metric-skeleton" data-tone={tone}>
          <div className="flex items-center gap-2 text-xs text-[var(--intelligence-muted)]">
            <Icon className="h-4 w-4" />
            <span className="truncate">{label}</span>
          </div>
          <GlobalPricingSkeletonBlock className="mt-3 h-7 w-16" />
          <GlobalPricingSkeletonBlock className="mt-2 h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

export function GlobalPricingToolbarSkeleton() {
  return (
    <div className="global-pricing-toolbar" aria-hidden="true">
      <div className="global-pricing-search relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ink-muted)]" />
        <div className="intelligence-input flex w-full items-center pl-10 pr-3 text-sm text-[var(--ink-muted)]">
          搜索 model_id / 展示名称 / 供应商
        </div>
      </div>
      <div className="global-pricing-filter intelligence-segmented">
        {SEGMENT_WIDTHS.map((width, index) => (
          <GlobalPricingSkeletonBlock
            key={index}
            className="h-8 rounded-[0.625rem]"
            style={{ width }}
          />
        ))}
      </div>
    </div>
  );
}

export function GlobalPricingTableSkeletonRows({ rows = 8 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, index) => (
        <tr key={`global-pricing-skeleton-${index}`} className="global-pricing-row" aria-hidden="true">
          <td>
            <GlobalPricingSkeletonBlock className="h-4 w-48" />
            <GlobalPricingSkeletonBlock className="mt-2 h-3 w-32" />
          </td>
          <td>
            <div className="flex gap-1">
              <GlobalPricingSkeletonBlock className="h-5 w-10 rounded-md" />
              <GlobalPricingSkeletonBlock className="h-5 w-12 rounded-md" />
            </div>
            <GlobalPricingSkeletonBlock className="mt-2 h-3 w-20" />
          </td>
          <td><GlobalPricingSkeletonBlock className="h-4 w-12" /></td>
          <td><GlobalPricingSkeletonBlock className="h-4 w-12" /></td>
          <td><GlobalPricingSkeletonBlock className="h-4 w-12" /></td>
          <td>
            <GlobalPricingSkeletonBlock className="h-6 w-20 rounded-full" />
            <GlobalPricingSkeletonBlock className="mt-2 h-3 w-16" />
          </td>
          <td>
            <div className="flex justify-end">
              <GlobalPricingSkeletonBlock className="h-8 w-14 rounded-lg" />
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

export function GlobalPricingTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <table className="global-pricing-table tnum w-full min-w-[1400px] text-sm" aria-hidden="true">
      <colgroup>
        <col className="global-pricing-col-model" />
        <col className="global-pricing-col-provider" />
        <col className="global-pricing-col-price" />
        <col className="global-pricing-col-price" />
        <col className="global-pricing-col-price" />
        <col className="global-pricing-col-status" />
        <col className="global-pricing-col-actions" />
      </colgroup>
      <thead className="sticky top-0 z-10">
        <tr className="text-left uppercase tracking-[0.18em] text-[var(--ink-muted)]">
          {TABLE_HEADERS.map((header) => (
            <th
              key={header}
              className={header === '操作' ? 'text-right' : undefined}
              data-col={header.includes('/ 1M') ? 'price' : undefined}
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <GlobalPricingTableSkeletonRows rows={rows} />
      </tbody>
    </table>
  );
}

export function GlobalPricingSkeletonContent() {
  return (
    <>
      <IntelligenceHeader
        className="global-pricing-header"
        title="全局模型价格"
        eyebrow="INTELLIGENCE · PRICING"
        description="按 model_id 维护一份基准价格，可批量回填到所有同名供应商模型。"
        icon={Coins}
        currentLabel="读取中"
        activeSummary="正在加载价格覆盖状态"
        actions={
          <button
            aria-label="刷新全局模型价格"
            data-refreshing="true"
            title="刷新全局模型价格"
            className="intelligence-action-button global-pricing-refresh-action"
            disabled
          >
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="sr-only">刷新</span>
          </button>
        }
      />
      <GlobalPricingMetricSkeletonGrid />
      <IntelligencePanel className="global-pricing-panel" bodyClassName="p-0">
        <GlobalPricingToolbarSkeleton />
        <div className="global-pricing-table-wrap">
          <GlobalPricingTableSkeleton rows={8} />
        </div>
      </IntelligencePanel>
    </>
  );
}

export function GlobalPricingSkeleton() {
  return (
    <IntelligenceShell className="global-pricing-page" contentClassName="global-pricing-layout">
      <GlobalPricingSkeletonContent />
    </IntelligenceShell>
  );
}
