// 从价格数据源（LiteLLM 最新价格表）自动同步价格的弹窗
// ref: §5.1 - AI Service / 全局价格管理 / 自动同步

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, Loader2, Sparkles } from 'lucide-react';
import type {
  PricingSyncProposal,
  PricingSyncStatus,
} from '@/services/aiProviderService';
import {
  useApplyPricingCatalogSync,
  usePreviewPricingCatalogSync,
} from './hooks';

interface Props {
  onClose: () => void;
}

// 同步对象只覆盖「供应商启用」的模型，与覆盖率视图默认口径一致。
const ENABLED_ONLY = true;

const STATUS_META: Record<
  PricingSyncStatus,
  { label: string; className: string }
> = {
  new: {
    label: '新增',
    className: 'bg-emerald-500/10 text-emerald-500',
  },
  update: {
    label: '更新',
    className: 'bg-orange-500/10 text-orange-500',
  },
  unchanged: {
    label: '已一致',
    className: 'bg-[var(--bg-card)] text-[var(--text-muted)]',
  },
  no_match: {
    label: '无匹配',
    className: 'bg-amber-500/10 text-amber-500',
  },
};

// 排序：可写入的排前面，便于一眼看到将要同步的内容
const STATUS_ORDER: Record<PricingSyncStatus, number> = {
  new: 0,
  update: 1,
  unchanged: 2,
  no_match: 3,
};

function formatPrice(value: number | null | undefined): string {
  if (value == null) return '—';
  const v = Number(value);
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

export function PricingSyncDialog({ onClose }: Props) {
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const previewMutation = usePreviewPricingCatalogSync();
  const applyMutation = useApplyPricingCatalogSync();

  const preview = previewMutation.data?.data ?? null;
  const proposals = useMemo(() => {
    const rows = preview?.proposals ? [...preview.proposals] : [];
    rows.sort((a, b) => {
      const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (byStatus !== 0) return byStatus;
      return a.model_id.localeCompare(b.model_id);
    });
    return rows;
  }, [preview]);

  // overwrite 切换会改变「哪些会被写入」，每次都重新拉预览并重置勾选。
  const runPreview = (overwrite: boolean) => {
    previewMutation.mutate(
      { enabled_only: ENABLED_ONLY, overwrite_existing: overwrite },
      {
        onSuccess: (res) => {
          const next = new Set<string>();
          (res.data?.proposals || []).forEach((p) => {
            if (p.will_apply) next.add(p.model_id);
          });
          setSelected(next);
        },
      }
    );
  };

  // 仅在首次挂载时拉取；后续靠 overwrite toggle 主动刷新。
  useEffect(() => {
    runPreview(false);
  }, []);

  const handleToggleOverwrite = (next: boolean) => {
    setOverwriteExisting(next);
    runPreview(next);
  };

  const isSelectable = (p: PricingSyncProposal) => p.will_apply;

  const selectableIds = useMemo(
    () => proposals.filter(isSelectable).map((p) => p.model_id),
    [proposals]
  );
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggleOne = (modelId: string) => {
    const proposal = proposals.find((p) => p.model_id === modelId);
    if (!proposal || !isSelectable(proposal)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(() => (allSelected ? new Set() : new Set(selectableIds)));
  };

  const isLoadingPreview = previewMutation.isPending;
  const isApplying = applyMutation.isPending;

  const handleApply = async () => {
    if (selected.size === 0) return;
    try {
      await applyMutation.mutateAsync({
        enabled_only: ENABLED_ONLY,
        overwrite_existing: overwriteExisting,
        model_ids: Array.from(selected),
      });
      onClose();
    } catch {
      // 错误 toast 已在 hook 中处理
    }
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="global-pricing-sync-overlay fixed inset-0 z-[55] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 18 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 18 }}
        onClick={(e) => e.stopPropagation()}
        className="global-pricing-sync-dialog w-full border shadow-2xl sm:max-w-4xl"
      >
        <div className="global-pricing-sync-header">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles className="h-5 w-5 text-[var(--aurora-1)]" />
              <h2 className="truncate text-lg font-semibold text-[var(--text-primary)]">
                从 LiteLLM 同步价格
              </h2>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {preview
                ? `数据源 ${preview.source} · ${preview.source_model_count} 条定价 · 命中 ${preview.matched_count}/${preview.total_candidates} 个 model_id`
                : '正在加载最新价格目录…'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="global-pricing-sync-close"
            aria-label="关闭 LiteLLM 价格同步"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="global-pricing-sync-options">
          <label className="global-pricing-sync-check">
            <input
              type="checkbox"
              checked={overwriteExisting}
              disabled={isLoadingPreview || isApplying}
              onChange={(e) => handleToggleOverwrite(e.target.checked)}
            />
            <span>
              覆盖已配置的全局价格
              <span className="block text-xs text-[var(--text-muted)]">
                取消勾选时只为「未配置」的 model_id 写入，不动你手填的价格。
              </span>
            </span>
          </label>
        </div>

        <div className="global-pricing-sync-table-wrap">
          {isLoadingPreview ? (
            <div className="flex items-center justify-center h-48 gap-2 text-[var(--text-muted)] text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              正在比对价格…
            </div>
          ) : proposals.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">
              没有可同步的启用模型
            </div>
          ) : (
            <table className="global-pricing-sync-table tnum">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      disabled={selectableIds.length === 0}
                      onChange={toggleAll}
                      aria-label="全选可同步项"
                    />
                  </th>
                  <th>Model ID</th>
                  <th>状态</th>
                  <th>输入 / 1M</th>
                  <th>输出 / 1M</th>
                  <th>缓存 / 1M</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => {
                  const selectable = isSelectable(p);
                  const meta = STATUS_META[p.status];
                  return (
                    <tr key={p.model_id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(p.model_id)}
                          disabled={!selectable}
                          onChange={() => toggleOne(p.model_id)}
                        />
                      </td>
                      <td>
                        <div className="global-pricing-sync-model">
                          <span>{p.model_id}</span>
                          {p.matched_key && p.matched_key !== p.model_id && (
                            <small>{p.matched_key}</small>
                          )}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`global-pricing-status-badge inline-flex items-center rounded-full px-2 py-1 text-xs ${meta.className}`}
                        >
                          {meta.label}
                        </span>
                      </td>
                      <td>
                        {p.status === 'no_match'
                          ? '—'
                          : formatPrice(p.source_input_per_1m)}
                        {p.status === 'update' &&
                          p.current_input_per_1m != null &&
                          p.source_input_per_1m !== p.current_input_per_1m && (
                            <div className="text-[10px] text-[var(--text-muted)] line-through">
                              {formatPrice(p.current_input_per_1m)}
                            </div>
                          )}
                      </td>
                      <td>
                        {p.status === 'no_match'
                          ? '—'
                          : formatPrice(p.source_output_per_1m)}
                        {p.status === 'update' &&
                          p.current_output_per_1m != null &&
                          p.source_output_per_1m !== p.current_output_per_1m && (
                            <div className="text-[10px] text-[var(--text-muted)] line-through">
                              {formatPrice(p.current_output_per_1m)}
                            </div>
                          )}
                      </td>
                      <td>
                        {p.status === 'no_match'
                          ? '—'
                          : formatPrice(p.source_cached_input_per_1m)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="global-pricing-sync-footer">
          <div className="text-xs text-[var(--text-muted)]">
            已选 {selected.size} 项
            {preview && preview.matched_count < preview.total_candidates && (
              <span className="ml-2">
                · {preview.total_candidates - preview.matched_count} 个未匹配（需手动配置）
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <motion.button
              onClick={onClose}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="global-pricing-sync-secondary"
            >
              取消
            </motion.button>
            <motion.button
              onClick={handleApply}
              disabled={isApplying || isLoadingPreview || selected.size === 0}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.95 }}
              className="global-pricing-sync-primary"
            >
              {isApplying && <Loader2 className="w-4 h-4 animate-spin" />}
              应用所选（{selected.size}）
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

export default PricingSyncDialog;
