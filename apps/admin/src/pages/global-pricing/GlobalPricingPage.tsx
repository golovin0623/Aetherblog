// 全局模型价格管理页
// ref: §5.1 - AI Service / 全局价格管理
//
// 设计目标：把按 (provider, model) 维护的成本配置抽到 model_id 维度，
// 一处编辑、一键回填到所有同名供应商模型；模型详情面板提供反向同步入口。

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
  Layers,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import type {
  GlobalPricing,
  GlobalPricingCoverageRow,
} from '@/services/aiProviderService';
import {
  useApplyGlobalPricing,
  useDeleteGlobalPricing,
  useEnabledModelIds,
  useGlobalPricingCoverage,
  useGlobalPricingList,
} from './hooks';
import GlobalPricingDialog from './GlobalPricingDialog';

type FilterMode = 'all' | 'configured' | 'missing' | 'out-of-sync' | 'enabled-only';

const FILTER_OPTIONS: Array<{ value: FilterMode; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'configured', label: '已配置' },
  { value: 'missing', label: '未配置' },
  { value: 'out-of-sync', label: '存在脱锚' },
  { value: 'enabled-only', label: '仅启用模型' },
];

function formatPrice(value: number | null | undefined, currency = 'USD'): string {
  if (value == null) return '—';
  const symbol = currency === 'CNY' ? '¥' : '$';
  if (value >= 1) return `${symbol}${value.toFixed(2)}`;
  return `${symbol}${value.toFixed(4)}`;
}

function CoverageBadge({ row }: { row: GlobalPricingCoverageRow }) {
  if (!row.has_global) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-500">
        <XCircle className="w-3 h-3" />
        未配置
      </span>
    );
  }
  if (row.out_of_sync_count === 0 && row.missing_count === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-500">
        <CheckCircle2 className="w-3 h-3" />
        全部同步
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-xs text-orange-500">
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
  const enabledModelIdsQuery = useEnabledModelIds();

  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [pendingDeleteModelId, setPendingDeleteModelId] = useState<string | null>(null);

  const isLoading = coverageQuery.isLoading || listQuery.isLoading;

  const globalByModelId = useMemo(() => {
    const map = new Map<string, GlobalPricing>();
    (listQuery.data || []).forEach((row) => map.set(row.model_id, row));
    return map;
  }, [listQuery.data]);

  const filteredRows = useMemo(() => {
    const rows = coverageQuery.data || [];
    const lower = search.trim().toLowerCase();
    const enabledModelIds = enabledModelIdsQuery.data ?? new Set<string>();
    return rows.filter((row) => {
      if (lower) {
        const haystack =
          `${row.model_id} ${row.display_name ?? ''} ${row.providers.join(' ')}`.toLowerCase();
        if (!haystack.includes(lower)) return false;
      }
      switch (filter) {
        case 'configured':
          return row.has_global;
        case 'missing':
          return !row.has_global;
        case 'out-of-sync':
          return row.has_global && (row.out_of_sync_count > 0 || row.missing_count > 0);
        case 'enabled-only':
          return enabledModelIds.has(row.model_id);
        default:
          return true;
      }
    });
  }, [coverageQuery.data, enabledModelIdsQuery.data, filter, search]);

  const stats = useMemo(() => {
    const rows = coverageQuery.data || [];
    let configured = 0;
    let missing = 0;
    let outOfSync = 0;
    rows.forEach((row) => {
      if (!row.has_global) {
        missing += 1;
        return;
      }
      configured += 1;
      if (row.out_of_sync_count > 0 || row.missing_count > 0) outOfSync += 1;
    });
    return { configured, missing, outOfSync, total: rows.length };
  }, [coverageQuery.data]);

  const handleApply = (modelId: string) => {
    applyMutation.mutate({
      modelId,
      data: { overwrite_existing: true },
    });
  };

  const handleRefresh = () => {
    coverageQuery.refetch();
    listQuery.refetch();
    enabledModelIdsQuery.refetch();
  };

  const editingRow = editingModelId
    ? coverageQuery.data?.find((r) => r.model_id === editingModelId) ?? null
    : null;

  return (
    <div className="h-[calc(100vh-4rem)] min-h-0">
      <div className="h-full min-h-0 flex flex-col rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] shadow-sm overflow-hidden">
        {/* 头部 */}
        <div className="flex flex-col gap-4 p-6 border-b border-[var(--border-default)]">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Coins className="w-5 h-5" />
                全局模型价格
              </h1>
              <p className="text-sm text-[var(--text-muted)] mt-1 max-w-2xl">
                按 model_id 维护一份基准价格，可批量回填到所有同名供应商模型。
                单条模型详情里可点击「从全局回填」反向闭环。
              </p>
            </div>
            <motion.button
              onClick={handleRefresh}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-all"
            >
              <RefreshCw
                className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`}
              />
              刷新
            </motion.button>
          </div>

          {/* 统计卡片 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="模型 ID 总数" value={stats.total} icon={Layers} />
            <StatCard
              label="已配置全局价格"
              value={stats.configured}
              icon={CheckCircle2}
              tone="success"
            />
            <StatCard
              label="未配置"
              value={stats.missing}
              icon={XCircle}
              tone="warning"
            />
            <StatCard
              label="存在脱锚"
              value={stats.outOfSync}
              icon={AlertCircle}
              tone="danger"
            />
          </div>

          {/* 过滤 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索 model_id / 展示名称 / 供应商"
                className="w-full pl-10 pr-3 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/60 focus:outline-none focus:border-primary/40"
              />
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-1">
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    filter === opt.value
                      ? 'bg-black dark:bg-white text-white dark:text-black'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 表格 */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-64 text-[var(--text-muted)]">
              加载中...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-[var(--text-muted)] gap-2">
              <div className="text-sm">没有符合条件的模型</div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[var(--bg-primary)] border-b border-[var(--border-default)]">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  <th className="px-6 py-3 font-medium">Model ID</th>
                  <th className="px-3 py-3 font-medium">供应商</th>
                  <th className="px-3 py-3 font-medium">输入 / 1M</th>
                  <th className="px-3 py-3 font-medium">输出 / 1M</th>
                  <th className="px-3 py-3 font-medium">缓存 / 1M</th>
                  <th className="px-3 py-3 font-medium">状态</th>
                  <th className="px-3 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr
                    key={row.model_id}
                    className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)]/40"
                  >
                    <td className="px-6 py-3 align-top">
                      <div className="font-mono text-[var(--text-primary)] break-all">
                        {row.model_id}
                      </div>
                      {row.display_name && (
                        <div className="text-xs text-[var(--text-muted)] mt-0.5">
                          {row.display_name}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
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
                    <td className="px-3 py-3 align-top text-[var(--text-primary)] font-mono">
                      {formatPrice(row.global_input_per_1m, row.currency || 'USD')}
                    </td>
                    <td className="px-3 py-3 align-top text-[var(--text-primary)] font-mono">
                      {formatPrice(row.global_output_per_1m, row.currency || 'USD')}
                    </td>
                    <td className="px-3 py-3 align-top text-[var(--text-primary)] font-mono">
                      {formatPrice(row.global_cached_input_per_1m, row.currency || 'USD')}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <CoverageBadge row={row} />
                      {row.has_global && (
                        <div className="text-[10px] text-[var(--text-muted)] mt-1">
                          {row.in_sync_count}/{row.provider_count} 已同步
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1">
                        <button
                          onClick={() => setEditingModelId(row.model_id)}
                          className="px-2.5 py-1 rounded-lg border border-[var(--border-default)] text-xs text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
                        >
                          {row.has_global ? '编辑' : '配置'}
                        </button>
                        {row.has_global && (
                          <button
                            disabled={applyMutation.isPending}
                            onClick={() => handleApply(row.model_id)}
                            className="px-2.5 py-1 rounded-lg bg-black dark:bg-white text-white dark:text-black text-xs font-medium hover:opacity-90 transition-all disabled:opacity-50"
                          >
                            批量回填
                          </button>
                        )}
                        {row.has_global && (
                          <button
                            onClick={() => setPendingDeleteModelId(row.model_id)}
                            className="p-1 rounded-lg text-status-danger/80 hover:text-status-danger hover:bg-status-danger-light transition-colors"
                            title="移除全局价格"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <AnimatePresence>
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
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  icon: typeof Layers;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-emerald-500'
      : tone === 'warning'
        ? 'text-amber-500'
        : tone === 'danger'
          ? 'text-orange-500'
          : 'text-[var(--text-secondary)]';
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/40 p-3">
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <Icon className={`w-4 h-4 ${toneClass}`} />
        {label}
      </div>
      <div className="text-2xl font-semibold text-[var(--text-primary)] mt-1 tabular-nums">
        {value}
      </div>
    </div>
  );
}
