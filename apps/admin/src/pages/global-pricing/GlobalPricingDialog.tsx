// 全局价格编辑弹窗
// ref: §5.1 - AI Service / 全局价格管理

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, Loader2 } from 'lucide-react';
import type { GlobalPricing } from '@/services/aiProviderService';
import { useApplyGlobalPricing, useUpsertGlobalPricing } from './hooks';

interface Props {
  modelId: string;
  displayName?: string | null;
  providerCount?: number;
  initial?: GlobalPricing | null;
  // 当前已经在多少 provider 下出现 —— 用于按钮文案
  hasGlobal: boolean;
  onClose: () => void;
}

export function GlobalPricingDialog({
  modelId,
  displayName,
  providerCount,
  initial,
  hasGlobal,
  onClose,
}: Props) {
  const [form, setForm] = useState({
    display_name: '',
    currency: 'USD' as string,
    input_cost_per_1m: 0,
    output_cost_per_1m: 0,
    cached_input_cost_per_1m: 0,
    pricing_json: '',
    notes: '',
  });
  const [jsonError, setJsonError] = useState('');
  const [overwriteExisting, setOverwriteExisting] = useState(true);
  const [applyAfterSave, setApplyAfterSave] = useState(true);

  const upsertMutation = useUpsertGlobalPricing();
  const applyMutation = useApplyGlobalPricing();

  useEffect(() => {
    if (!initial) {
      setForm((prev) => ({
        ...prev,
        display_name: displayName ?? '',
        currency: 'USD',
        input_cost_per_1m: 0,
        output_cost_per_1m: 0,
        cached_input_cost_per_1m: 0,
        pricing_json: '',
        notes: '',
      }));
      return;
    }
    // pricing_json 显示的是除「单价 + currency + units」之外的扩展字段，
    // 避免和上方四个数字输入框重复
    const extraPricing: Record<string, unknown> = {};
    Object.entries(initial.pricing || {}).forEach(([k, v]) => {
      if (['input', 'output', 'cachedInput', 'currency', 'units'].includes(k)) return;
      extraPricing[k] = v;
    });
    setForm({
      display_name: initial.display_name ?? displayName ?? '',
      currency: initial.currency || 'USD',
      input_cost_per_1m: initial.input_cost_per_1m ?? 0,
      output_cost_per_1m: initial.output_cost_per_1m ?? 0,
      cached_input_cost_per_1m: initial.cached_input_cost_per_1m ?? 0,
      pricing_json: Object.keys(extraPricing).length
        ? JSON.stringify(extraPricing, null, 2)
        : '',
      notes: initial.notes ?? '',
    });
  }, [initial, displayName]);

  const isPending = upsertMutation.isPending || applyMutation.isPending;

  const handleSave = async () => {
    setJsonError('');
    let pricingExtra: Record<string, unknown> = {};
    if (form.pricing_json.trim()) {
      try {
        pricingExtra = JSON.parse(form.pricing_json) as Record<string, unknown>;
      } catch {
        setJsonError('高级价格 JSON 无法解析，请检查格式');
        return;
      }
    }
    const payload = {
      model_id: modelId,
      display_name: form.display_name || null,
      currency: form.currency || 'USD',
      input_cost_per_1m: form.input_cost_per_1m || null,
      output_cost_per_1m: form.output_cost_per_1m || null,
      cached_input_cost_per_1m: form.cached_input_cost_per_1m || null,
      pricing: {
        ...pricingExtra,
        // 同时把单价 / currency 写入扩展 JSON, 这样 _sync_model_pricing_capabilities
        // 在批量回填时能保留这些显式键
        currency: form.currency || 'USD',
      },
      notes: form.notes || null,
    };

    try {
      await upsertMutation.mutateAsync({ modelId, data: payload });
      if (applyAfterSave) {
        await applyMutation.mutateAsync({
          modelId,
          data: { overwrite_existing: overwriteExisting },
        });
      }
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
      className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl max-h-[85vh] sm:max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-2xl"
      >
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-default)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              {hasGlobal ? '编辑全局价格' : '添加全局价格'}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono break-all">
              {modelId}
              {typeof providerCount === 'number' && providerCount > 0 && (
                <span className="ml-2 text-[var(--text-secondary)]">
                  · {providerCount} 个供应商共享
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          <div className="space-y-2">
            <label className="text-sm text-[var(--text-muted)]">展示名称（可选）</label>
            <input
              type="text"
              value={form.display_name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, display_name: e.target.value }))
              }
              placeholder="GPT-4o mini / Claude 4 Haiku"
              className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-black dark:focus:border-white transition-all"
            />
          </div>

          <div className="space-y-4">
            <div className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">价格</div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="space-y-2">
                <label className="text-sm text-[var(--text-muted)]">币种</label>
                <select
                  value={form.currency}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, currency: e.target.value }))
                  }
                  className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40"
                >
                  <option value="USD">USD</option>
                  <option value="CNY">CNY</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-[var(--text-muted)]">输入 / 1M Tokens</label>
                <input
                  type="number"
                  step="0.000001"
                  value={form.input_cost_per_1m}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      input_cost_per_1m: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-[var(--text-muted)]">输出 / 1M Tokens</label>
                <input
                  type="number"
                  step="0.000001"
                  value={form.output_cost_per_1m}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      output_cost_per_1m: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-[var(--text-muted)]">缓存读取 / 1M Tokens</label>
                <input
                  type="number"
                  step="0.000001"
                  value={form.cached_input_cost_per_1m}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      cached_input_cost_per_1m: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-muted)]">高级价格 JSON（可选）</label>
              <textarea
                rows={4}
                value={form.pricing_json}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, pricing_json: e.target.value }))
                }
                placeholder='{"audioInput": 3.0, "audioOutput": 6.0}'
                className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-primary/40"
              />
              <p className="text-xs text-[var(--text-muted)]">
                输入 / 输出 / 缓存读取已由上方独立填写，此处仅放音频、视频等其它单价键。
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-[var(--text-muted)]">备注（可选）</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="例如：以 OpenAI 官方文档为准，2026-05 更新"
              className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40"
            />
          </div>

          <div className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)]/40 px-4 py-3">
            <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={applyAfterSave}
                onChange={(e) => setApplyAfterSave(e.target.checked)}
              />
              保存后立即批量回填到所有同名供应商模型
            </label>
            {applyAfterSave && (
              <label className="flex items-center gap-2 text-xs text-[var(--text-muted)] cursor-pointer pl-6">
                <input
                  type="checkbox"
                  checked={overwriteExisting}
                  onChange={(e) => setOverwriteExisting(e.target.checked)}
                />
                覆盖已存在的供应商价格（取消则只填补缺失字段）
              </label>
            )}
          </div>

          {jsonError && (
            <div className="text-sm text-status-danger bg-status-danger-light border border-status-danger-border px-3 py-2 rounded-lg">
              {jsonError}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-5 border-t border-[var(--border-default)]">
          <motion.button
            onClick={onClose}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="px-4 py-2 rounded-xl border border-[var(--border-default)] text-[var(--text-secondary)] text-sm font-medium hover:bg-[var(--bg-card-hover)] transition-colors"
          >
            取消
          </motion.button>
          <motion.button
            onClick={handleSave}
            disabled={isPending}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.95 }}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-black dark:bg-white text-white dark:text-black text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 shadow-sm"
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {applyAfterSave ? '保存并应用' : '保存'}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

export default GlobalPricingDialog;
