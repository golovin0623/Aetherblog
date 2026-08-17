// 从价格数据源（LiteLLM 最新价格表）自动同步价格的弹窗
// ref: §5.1 - AI Service / 全局价格管理 / 自动同步

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { spring, transition, variants } from '@aetherblog/ui';
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

// 状态 → 信号语义:新增=success / 更新=accent(将写入) / 已一致=neutral / 无匹配=warn(需手动)
const STATUS_META: Record<
  PricingSyncStatus,
  { label: string; tone: 'success' | 'accent' | 'neutral' | 'warn' }
> = {
  new: { label: '新增', tone: 'success' },
  update: { label: '更新', tone: 'accent' },
  unchanged: { label: '已一致', tone: 'neutral' },
  no_match: { label: '无匹配', tone: 'warn' },
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

// 价差标注:目录价 vs 当前价,涨=warn ↑ / 降=success ↓
function PriceDelta({
  current,
  next,
}: {
  current: number | null | undefined;
  next: number | null | undefined;
}) {
  if (current == null || next == null || next === current) return null;
  const direction = next > current ? 'up' : 'down';
  return (
    <span className="gp-delta font-mono" data-direction={direction}>
      <s>{formatPrice(current)}</s>
      {direction === 'up' ? '↑' : '↓'}
    </span>
  );
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

  // Esc 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

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
      variants={variants.fade}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={transition.quick}
      className="global-pricing-sync-overlay aiw-overlay sm:p-4"
      onClick={onClose}
    >
      <motion.div
        variants={variants.scaleIn}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={spring.soft}
        onClick={(e) => e.stopPropagation()}
        className="global-pricing-sync-dialog w-full border shadow-2xl sm:max-w-4xl"
      >
        <div className="global-pricing-sync-header">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles className="h-5 w-5 text-[var(--aurora-1)]" />
              <h2 className="truncate text-lg font-semibold text-[var(--ink-primary)]">
                从 LiteLLM 同步价格
              </h2>
            </div>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
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
              <span className="block text-xs text-[var(--ink-muted)]">
                取消勾选时只为「未配置」的 model_id 写入，不动你手填的价格。
              </span>
            </span>
          </label>
        </div>

        <div className="global-pricing-sync-table-wrap">
          {isLoadingPreview ? (
            <div className="space-y-2 p-4" aria-busy="true" aria-label="正在比对价格">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="global-pricing-skeleton-block h-4 w-4 rounded" />
                  <div className="global-pricing-skeleton-block h-3.5 w-1/3 rounded" />
                  <div className="global-pricing-skeleton-block h-4 w-14 rounded-full" />
                  <div className="global-pricing-skeleton-block ml-auto h-3.5 w-32 rounded" />
                </div>
              ))}
            </div>
          ) : proposals.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-[var(--ink-muted)] text-sm">
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
                          className="aiw-signal-badge global-pricing-status-badge"
                          data-tone={meta.tone}
                        >
                          {meta.label}
                        </span>
                      </td>
                      <td className="font-mono">
                        {p.status === 'no_match'
                          ? '—'
                          : formatPrice(p.source_input_per_1m)}
                        {p.status === 'update' && (
                          <PriceDelta
                            current={p.current_input_per_1m}
                            next={p.source_input_per_1m}
                          />
                        )}
                      </td>
                      <td className="font-mono">
                        {p.status === 'no_match'
                          ? '—'
                          : formatPrice(p.source_output_per_1m)}
                        {p.status === 'update' && (
                          <PriceDelta
                            current={p.current_output_per_1m}
                            next={p.source_output_per_1m}
                          />
                        )}
                      </td>
                      <td className="font-mono">
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
          <div className="text-xs text-[var(--ink-muted)]">
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
              whileTap={{ scale: 0.97 }}
              transition={spring.precise}
              className="global-pricing-sync-secondary"
            >
              取消
            </motion.button>
            <motion.button
              onClick={handleApply}
              disabled={isApplying || isLoadingPreview || selected.size === 0}
              whileTap={{ scale: 0.96 }}
              transition={spring.precise}
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
