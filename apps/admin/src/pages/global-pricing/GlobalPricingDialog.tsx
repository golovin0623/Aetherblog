// 全局价格编辑弹窗 —— 一处基准价,一键回填
// ref: §5.1 - AI Service / 全局价格管理
// 设计: aiw-dialog 骨架 · 价格 mono+tnum · 焦点极光光环

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, Loader2 } from 'lucide-react';
import { Toggle, spring, transition, variants } from '@aetherblog/ui';
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
    // 三个数值字段允许 null —— 区分"未配置"(null) 与"免费"(0)，
    // 编辑时若原本是 null，仅改备注不应把它静默变成 0
    input_cost_per_1m: null as number | null,
    output_cost_per_1m: null as number | null,
    cached_input_cost_per_1m: null as number | null,
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
        input_cost_per_1m: null,
        output_cost_per_1m: null,
        cached_input_cost_per_1m: null,
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
      input_cost_per_1m: initial.input_cost_per_1m ?? null,
      output_cost_per_1m: initial.output_cost_per_1m ?? null,
      cached_input_cost_per_1m: initial.cached_input_cost_per_1m ?? null,
      pricing_json: Object.keys(extraPricing).length
        ? JSON.stringify(extraPricing, null, 2)
        : '',
      notes: initial.notes ?? '',
    });
  }, [initial, displayName]);

  // Esc 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

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
      // 直接传数值：0 表示"免费"（与 null"未配置"语义不同），不要被 `|| null` 吞掉
      input_cost_per_1m: form.input_cost_per_1m,
      output_cost_per_1m: form.output_cost_per_1m,
      cached_input_cost_per_1m: form.cached_input_cost_per_1m,
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

  const currencySymbol = form.currency === 'CNY' ? '¥' : '$';

  return createPortal(
    <motion.div
      variants={variants.fade}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={transition.quick}
      className="aiw-overlay sm:p-4"
      onClick={onClose}
    >
      <motion.div
        variants={variants.scaleIn}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={spring.soft}
        onClick={(e) => e.stopPropagation()}
        className="aiw-dialog surface-overlay sm:max-w-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={hasGlobal ? '编辑全局价格' : '添加全局价格'}
      >
        <div className="aiw-dialog-header">
          <div className="min-w-0">
            <div className="aiw-eyebrow">Pricing · {hasGlobal ? 'Edit' : 'Create'}</div>
            <h2 className="aiw-dialog-title mt-1.5">
              {hasGlobal ? '编辑全局价格' : '添加全局价格'}
            </h2>
            <div className="aiw-dialog-subtitle">
              <span>{modelId}</span>
              {typeof providerCount === 'number' && providerCount > 0 && (
                <span className="aiw-signal-badge" data-tone="accent">
                  {providerCount} 个供应商共享
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="aiw-dialog-close" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="aiw-dialog-body">
          <div className="aiw-field">
            <label className="aiw-label" htmlFor="gp-display-name">
              展示名称
              <small>可选</small>
            </label>
            <input
              id="gp-display-name"
              type="text"
              value={form.display_name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, display_name: e.target.value }))
              }
              placeholder="GPT-4o mini / Claude 4 Haiku"
              className="aiw-input"
            />
          </div>

          <section className="aiw-section">
            <div className="aiw-eyebrow">
              价格
              <span className="aiw-eyebrow-meta">单位 / 1M Tokens</span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <div className="aiw-field">
                <label className="aiw-label" htmlFor="gp-currency">币种</label>
                <select
                  id="gp-currency"
                  value={form.currency}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, currency: e.target.value }))
                  }
                  className="aiw-select"
                >
                  <option value="USD">USD $</option>
                  <option value="CNY">CNY ¥</option>
                </select>
              </div>
              <NullablePriceInput
                id="gp-input-cost"
                label="输入"
                symbol={currencySymbol}
                value={form.input_cost_per_1m}
                onChange={(v) => setForm((prev) => ({ ...prev, input_cost_per_1m: v }))}
              />
              <NullablePriceInput
                id="gp-output-cost"
                label="输出"
                symbol={currencySymbol}
                value={form.output_cost_per_1m}
                onChange={(v) => setForm((prev) => ({ ...prev, output_cost_per_1m: v }))}
              />
              <NullablePriceInput
                id="gp-cached-cost"
                label="缓存读取"
                symbol={currencySymbol}
                value={form.cached_input_cost_per_1m}
                onChange={(v) =>
                  setForm((prev) => ({ ...prev, cached_input_cost_per_1m: v }))
                }
              />
            </div>
            <div className="aiw-field">
              <label className="aiw-label" htmlFor="gp-pricing-json">
                高级价格 JSON
                <small>可选</small>
              </label>
              <textarea
                id="gp-pricing-json"
                rows={4}
                value={form.pricing_json}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, pricing_json: e.target.value }))
                }
                placeholder='{"audioInput": 3.0, "audioOutput": 6.0}'
                data-mono="true"
                className="aiw-textarea text-xs"
              />
              <p className="aiw-helper">
                输入 / 输出 / 缓存读取已由上方独立填写，此处仅放音频、视频等其它单价键。
              </p>
            </div>
          </section>

          <div className="aiw-field">
            <label className="aiw-label" htmlFor="gp-notes">
              备注
              <small>可选</small>
            </label>
            <textarea
              id="gp-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="例如：以 OpenAI 官方文档为准，2026-05 更新"
              className="aiw-textarea"
            />
          </div>

          {/* 保存后的回填策略 */}
          <div className="aiw-kv-panel">
            <div className="aiw-kv !flex-row !items-center">
              <div className="aiw-kv-copy !w-auto flex-1">
                <div className="aiw-kv-title">保存后立即批量回填</div>
                <div className="aiw-kv-desc">把基准价下发到所有同名供应商模型</div>
              </div>
              <Toggle checked={applyAfterSave} onChange={setApplyAfterSave} size="sm" />
            </div>
            {applyAfterSave && (
              <div className="aiw-kv !flex-row !items-center">
                <div className="aiw-kv-copy !w-auto flex-1">
                  <div className="aiw-kv-title">覆盖已存在的供应商价格</div>
                  <div className="aiw-kv-desc">关闭则只填补缺失字段，不动已手填的价格</div>
                </div>
                <Toggle checked={overwriteExisting} onChange={setOverwriteExisting} size="sm" />
              </div>
            )}
          </div>

          {jsonError && (
            <div
              className="rounded-lg border px-3 py-2 text-sm"
              style={{
                color: 'var(--signal-danger)',
                borderColor: 'color-mix(in oklch, var(--signal-danger) 30%, transparent)',
                background: 'color-mix(in oklch, var(--signal-danger) 8%, transparent)',
              }}
              role="alert"
            >
              {jsonError}
            </div>
          )}
        </div>

        <div className="aiw-dialog-footer !flex-row !justify-end">
          <motion.button
            onClick={onClose}
            whileTap={{ scale: 0.97 }}
            transition={spring.precise}
            className="aiw-button"
          >
            取消
          </motion.button>
          <motion.button
            onClick={handleSave}
            disabled={isPending}
            whileTap={{ scale: 0.96 }}
            transition={spring.precise}
            className="aiw-button-primary"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {applyAfterSave ? '保存并应用' : '保存'}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

// 可空价格输入:空串 = 未配置(null),0 = 显式免费
function NullablePriceInput({
  id,
  label,
  symbol,
  value,
  onChange,
}: {
  id: string;
  label: string;
  symbol: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="aiw-field">
      <label className="aiw-label" htmlFor={id}>{label}</label>
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-[var(--ink-muted)]"
        >
          {symbol}
        </span>
        <input
          id={id}
          type="number"
          step="0.000001"
          placeholder="未配置"
          value={value ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === '' ? null : (parseFloat(raw) || 0));
          }}
          data-mono="true"
          data-align="right"
          className="aiw-input pl-7"
        />
      </div>
    </div>
  );
}

export default GlobalPricingDialog;
