// 全局模型价格管理页
// ref: §5.1 - AI Service / 全局价格管理
//
// 设计目标：把按 (provider, model) 维护的成本配置抽到 model_id 维度，
// 一处编辑、一键回填到所有同名供应商模型；模型详情面板提供反向同步入口。

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  XCircle,
  Layers,
} from 'lucide-react';
import {
  IntelligenceHeader,
  IntelligenceMetric,
  IntelligencePanel,
  IntelligenceSegmented,
} from '@/components/intelligence';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import type {
  GlobalPricing,
  GlobalPricingCoverageRow,
} from '@/services/aiProviderService';
import {
  useApplyGlobalPricing,
  useDeleteGlobalPricing,
  useGlobalPricingCoverage,
  useGlobalPricingList,
} from './hooks';
import GlobalPricingDialog from './GlobalPricingDialog';
import PricingSyncDialog from './PricingSyncDialog';
import {
  GlobalPricingMetricSkeletonGrid,
  GlobalPricingTableSkeleton,
  GlobalPricingTableSkeletonRows,
} from './GlobalPricingSkeleton';

type FilterMode = 'all' | 'configured' | 'missing' | 'out-of-sync';

const FILTER_OPTIONS: Array<{ value: FilterMode; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'configured', label: '已配置' },
  { value: 'missing', label: '未配置' },
  { value: 'out-of-sync', label: '存在脱锚' },
];

const INITIAL_ROW_RENDER_LIMIT = 120;
const ROW_RENDER_BATCH_SIZE = 240;

function formatPrice(value: number | null | undefined, currency = 'USD'): string {
  if (value == null) return '—';
  const symbol = currency === 'CNY' ? '¥' : '$';
  if (value >= 1) return `${symbol}${value.toFixed(2)}`;
  return `${symbol}${value.toFixed(4)}`;
}

function CoverageBadge({ row }: { row: GlobalPricingCoverageRow }) {
  if (!row.has_global) {
    return (
      <span className="global-pricing-status-badge inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-500">
        <XCircle className="w-3 h-3" />
        未配置
      </span>
    );
  }
  if (row.out_of_sync_count === 0 && row.missing_count === 0) {
    return (
      <span className="global-pricing-status-badge inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-500">
        <CheckCircle2 className="w-3 h-3" />
        全部同步
      </span>
    );
  }
  return (
    <span className="global-pricing-status-badge inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-xs text-orange-500">
      <AlertCircle className="w-3 h-3" />
      {row.out_of_sync_count + row.missing_count} 行待同步
    </span>
  );
}

export default function GlobalPricingPage() {
  const coverageQuery = useGlobalPricingCoverage();
  const listQuery = useGlobalPricingList();
  const applyMutation = useApplyGlobalPricing();
  const deleteMutation = useDeleteGlobalPricing();

  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [pendingDeleteModelId, setPendingDeleteModelId] = useState<string | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [renderLimit, setRenderLimit] = useState(INITIAL_ROW_RENDER_LIMIT);

  const deferredSearch = useDeferredValue(search);
  const deferredFilter = useDeferredValue(filter);

  const hasCoverageData = coverageQuery.data !== undefined;
  const hasListData = listQuery.data !== undefined;
  const isInitialLoading =
    (coverageQuery.isLoading && !hasCoverageData) ||
    (listQuery.isLoading && !hasListData);
  const isRefreshing =
    coverageQuery.isFetching || listQuery.isFetching;

  const globalByModelId = useMemo(() => {
    const map = new Map<string, GlobalPricing>();
    (listQuery.data || []).forEach((row) => map.set(row.model_id, row));
    return map;
  }, [listQuery.data]);

  const filteredRows = useMemo(() => {
    const rows = coverageQuery.data || [];
    const lower = deferredSearch.trim().toLowerCase();
    return rows.filter((row) => {
      if (lower) {
        const haystack =
          `${row.model_id} ${row.display_name ?? ''} ${row.providers.join(' ')}`.toLowerCase();
        if (!haystack.includes(lower)) return false;
      }
      switch (deferredFilter) {
        case 'configured':
          return row.has_global;
        case 'missing':
          return !row.has_global;
        case 'out-of-sync':
          return row.has_global && (row.out_of_sync_count > 0 || row.missing_count > 0);
        default:
          return true;
      }
    });
  }, [coverageQuery.data, deferredFilter, deferredSearch]);

  const stats = useMemo(() => {
    let configured = 0;
    let missing = 0;
    let outOfSync = 0;
    filteredRows.forEach((row) => {
      if (!row.has_global) {
        missing += 1;
        return;
      }
      configured += 1;
      if (row.out_of_sync_count > 0 || row.missing_count > 0) outOfSync += 1;
    });
    return { configured, missing, outOfSync, total: filteredRows.length };
  }, [filteredRows]);

  const handleApply = (modelId: string) => {
    applyMutation.mutate({
      modelId,
      data: { overwrite_existing: true },
    });
  };

  const handleRefresh = () => {
    coverageQuery.refetch();
    listQuery.refetch();
  };

  const editingRow = editingModelId
    ? coverageQuery.data?.find((r) => r.model_id === editingModelId) ?? null
    : null;

  const renderResetKey = `${deferredFilter}:${deferredSearch}`;

  useEffect(() => {
    setRenderLimit(INITIAL_ROW_RENDER_LIMIT);
  }, [renderResetKey]);

  useEffect(() => {
    if (isInitialLoading || filteredRows.length <= renderLimit) return;

    const timeoutId = window.setTimeout(() => {
      setRenderLimit((current) =>
        Math.min(filteredRows.length, current + ROW_RENDER_BATCH_SIZE)
      );
    }, 16);

    return () => window.clearTimeout(timeoutId);
  }, [filteredRows.length, isInitialLoading, renderLimit]);

  const visibleRows = useMemo(
    () => filteredRows.slice(0, renderLimit),
    [filteredRows, renderLimit]
  );
  const isProgressivelyRendering = visibleRows.length < filteredRows.length;

  return (
    <>
      <IntelligenceHeader
        className="global-pricing-header"
        title="全局模型价格"
        eyebrow="INTELLIGENCE · PRICING"
        description="按 model_id 维护一份基准价格，可批量回填到所有同名供应商模型。"
        icon={Coins}
        currentLabel={isInitialLoading ? '读取中' : `${stats.configured}/${stats.total} 已配置`}
        activeSummary={
          isInitialLoading
            ? '正在加载价格覆盖状态'
            : `未配置 ${stats.missing} · 脱锚 ${stats.outOfSync}`
        }
        actions={
          <div className="flex items-center gap-2">
            <motion.button
              onClick={() => setSyncDialogOpen(true)}
              title="从 LiteLLM 内置价格表自动同步"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="intelligence-action-button global-pricing-sync-action inline-flex items-center gap-1.5 px-3"
            >
              <Sparkles className="w-4 h-4" />
              <span className="text-sm font-medium">同步价格</span>
            </motion.button>
            <motion.button
              onClick={handleRefresh}
              aria-label="刷新全局模型价格"
              aria-busy={isRefreshing}
              data-refreshing={isRefreshing ? 'true' : 'false'}
              title="刷新全局模型价格"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="intelligence-action-button global-pricing-refresh-action"
            >
              <RefreshCw
                className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
              />
              <span className="sr-only">刷新</span>
            </motion.button>
          </div>
        }
      />

      {isInitialLoading ? (
        <GlobalPricingMetricSkeletonGrid />
      ) : (
        <div className="global-pricing-metrics grid grid-cols-2 gap-3 xl:grid-cols-4">
          <IntelligenceMetric label="模型 ID 总数" value={stats.total} icon={Layers} />
          <IntelligenceMetric
            label="已配置全局价格"
            value={stats.configured}
            icon={CheckCircle2}
            tone="success"
          />
          <IntelligenceMetric
            label="未配置"
            value={stats.missing}
            icon={XCircle}
            tone="warning"
          />
          <IntelligenceMetric
            label="存在脱锚"
            value={stats.outOfSync}
            icon={AlertCircle}
            tone="danger"
          />
        </div>
      )}

      <IntelligencePanel className="global-pricing-panel" bodyClassName="p-0">
        <div className="global-pricing-toolbar">
          <div className="global-pricing-search relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索 model_id / 展示名称 / 供应商"
              className="intelligence-input w-full pl-10 pr-3 text-sm"
            />
          </div>
          <IntelligenceSegmented
            value={filter}
            options={FILTER_OPTIONS}
            onChange={setFilter}
            ariaLabel="价格配置筛选"
            className="global-pricing-filter"
          />
        </div>

        <div className="global-pricing-table-wrap">
          {isInitialLoading ? (
            <GlobalPricingTableSkeleton rows={8} />
          ) : filteredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-[var(--text-muted)] gap-2">
              <div className="text-sm">没有符合条件的模型</div>
            </div>
          ) : (
            <table className="global-pricing-table tnum w-full min-w-[1400px] text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  <th className="font-medium">Model ID</th>
                  <th className="font-medium">供应商</th>
                  <th className="font-medium">输入 / 1M</th>
                  <th className="font-medium">输出 / 1M</th>
                  <th className="font-medium">缓存 / 1M</th>
                  <th className="font-medium">状态</th>
                  <th className="font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    key={row.model_id}
                    className="global-pricing-row"
                  >
                    <td className="align-top">
                      <div className="font-mono text-[var(--text-primary)] break-all">
                        {row.model_id}
                      </div>
                      {row.display_name && (
                        <div className="text-xs text-[var(--text-muted)] mt-0.5">
                          {row.display_name}
                        </div>
                      )}
                    </td>
                    <td className="align-top">
                      <div className="flex flex-wrap gap-1">
                        {row.providers.slice(0, 4).map((p) => (
                          <span
                            key={p}
                            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] font-mono"
                          >
                            {p}
                          </span>
                        ))}
                        {row.providers.length > 4 && (
                          <span className="text-[10px] text-[var(--text-muted)]">
                            +{row.providers.length - 4}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] mt-1">
                        {row.provider_count} 个供应商行
                      </div>
                    </td>
                    <td className="align-top text-[var(--text-primary)] font-mono">
                      {formatPrice(row.global_input_per_1m, row.currency || 'USD')}
                    </td>
                    <td className="align-top text-[var(--text-primary)] font-mono">
                      {formatPrice(row.global_output_per_1m, row.currency || 'USD')}
                    </td>
                    <td className="align-top text-[var(--text-primary)] font-mono">
                      {formatPrice(row.global_cached_input_per_1m, row.currency || 'USD')}
                    </td>
                    <td className="align-top">
                      <CoverageBadge row={row} />
                      {row.has_global && (
                        <div className="text-[10px] text-[var(--text-muted)] mt-1">
                          {row.in_sync_count}/{row.provider_count} 已同步
                        </div>
                      )}
                    </td>
                    <td className="align-top text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1">
                        <button
                          onClick={() => setEditingModelId(row.model_id)}
                          className="global-pricing-row-button"
                        >
                          {row.has_global ? '编辑' : '配置'}
                        </button>
                        {row.has_global && (
                          <button
                            disabled={applyMutation.isPending}
                            onClick={() => handleApply(row.model_id)}
                            className="global-pricing-row-button global-pricing-row-button-primary"
                          >
                            批量回填
                          </button>
                        )}
                        {row.has_global && (
                          <button
                            onClick={() => setPendingDeleteModelId(row.model_id)}
                            className="global-pricing-icon-button"
                            title="移除全局价格"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {isProgressivelyRendering && (
                  <GlobalPricingTableSkeletonRows rows={3} />
                )}
              </tbody>
            </table>
          )}
        </div>
      </IntelligencePanel>

      <AnimatePresence>
        {syncDialogOpen && (
          <PricingSyncDialog onClose={() => setSyncDialogOpen(false)} />
        )}
        {editingModelId && (
          <GlobalPricingDialog
            modelId={editingModelId}
            displayName={editingRow?.display_name}
            providerCount={editingRow?.provider_count}
            initial={globalByModelId.get(editingModelId) ?? null}
            hasGlobal={!!editingRow?.has_global}
            onClose={() => setEditingModelId(null)}
          />
        )}
      </AnimatePresence>

      <ConfirmDialog
        isOpen={!!pendingDeleteModelId}
        title="移除全局价格"
        message={`确定移除 ${pendingDeleteModelId} 的全局价格吗？已下发到各供应商的价格不会被回滚。`}
        confirmText="移除"
        variant="danger"
        onConfirm={() => {
          if (pendingDeleteModelId) {
            deleteMutation.mutate(pendingDeleteModelId);
          }
          setPendingDeleteModelId(null);
        }}
        onCancel={() => setPendingDeleteModelId(null)}
      />
    </>
  );
}
