// 模型配置弹窗组件
// ref: §5.1 - AI Service 架构 (参考 LobeChat 图5)

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { X, Loader2 } from 'lucide-react';
import type { AiModel, CreateModelRequest, UpdateModelRequest } from '@/services/aiProviderService';
import { MODEL_TYPES, type ModelAbility, type ModelSettings, type ModelPricing } from '../types';
import { useCreateModel, useUpdateModel, useDeleteModel } from '../hooks/useModels';
import {
  buildModelCapabilities,
  getModelExtra,
  resolveModelAbilities,
  resolveModelContextWindow,
  resolveModelSettings,
  resolveModelConfig,
  resolveModelMaxOutputTokens,
  resolveModelPricing,
  resolveModelSource,
} from '../utils/modelCapabilities';

interface ModelConfigDialogProps {
  mode: 'create' | 'edit';
  providerCode: string;
  initial?: AiModel | null;
  showDeployName?: boolean;
  onClose: () => void;
}

const EXTEND_PARAMS_OPTIONS = [
  'disableContextCaching',
  'enableReasoning',
  'reasoningBudgetToken',
  'reasoningEffort',
  'gpt5ReasoningEffort',
  'gpt5_1ReasoningEffort',
  'gpt5_2ReasoningEffort',
  'gpt5_2ProReasoningEffort',
  'textVerbosity',
  'thinking',
  'thinkingBudget',
  'thinkingLevel',
  'thinkingLevel2',
  'urlContext',
  'imageAspectRatio',
  'imageResolution',
];

const SEARCH_IMPL_OPTIONS: Array<{ label: string; value: ModelSettings['searchImpl'] }> = [
  { label: '工具调用', value: 'tool' },
  { label: '参数驱动', value: 'params' },
  { label: '模型内置', value: 'internal' },
];

export default function ModelConfigDialog({
  mode,
  providerCode,
  initial,
  showDeployName,
  onClose,
}: ModelConfigDialogProps) {
  const [form, setForm] = useState({
    model_id: '',
    display_name: '',
    model_type: 'chat',
    context_window: 128000,
    max_output_tokens: 4096,
    input_cost_per_1k: 0,
    output_cost_per_1k: 0,
    pricing_currency: 'USD' as ModelPricing['currency'],
    abilities: {
      functionCall: false,
      vision: false,
      reasoning: false,
      search: false,
      imageOutput: false,
      video: false,
      files: false,
      structuredOutput: false,
    } as ModelAbility,
    settings: {
      extendParams: [] as string[],
      searchImpl: undefined as ModelSettings['searchImpl'],
      searchProvider: '',
    },
    config: {
      deploymentName: '',
    },
    released_at: '',
    parameters_json: '',
    pricing_json: '',
  });
  const [jsonError, setJsonError] = useState('');

  const createMutation = useCreateModel();
  const updateMutation = useUpdateModel();
  const deleteMutation = useDeleteModel();

  // 初始化表单
  useEffect(() => {
    if (!initial) return;

    const abilities = resolveModelAbilities(initial);
    const settings = resolveModelSettings(initial);
    const config = resolveModelConfig(initial);
    const pricing = resolveModelPricing(initial);
    const extra = getModelExtra(initial) as Record<string, unknown>;
    const contextWindow = resolveModelContextWindow(initial);
    const maxOutputTokens = resolveModelMaxOutputTokens(initial);

    setForm({
      model_id: initial.model_id,
      display_name: initial.display_name || '',
      model_type: initial.model_type || 'chat',
      context_window: contextWindow || 128000,
      max_output_tokens: maxOutputTokens || 4096,
      input_cost_per_1k: initial.input_cost_per_1k || 0,
      output_cost_per_1k: initial.output_cost_per_1k || 0,
      pricing_currency: pricing.currency || 'USD',
      abilities: {
        functionCall: !!abilities.functionCall,
        vision: !!abilities.vision,
        reasoning: !!abilities.reasoning,
        search: !!abilities.search,
        imageOutput: !!abilities.imageOutput,
        video: !!abilities.video,
        files: !!abilities.files,
        structuredOutput: !!abilities.structuredOutput,
      },
      settings: {
        extendParams: settings.extendParams || [],
        searchImpl: settings.searchImpl,
        searchProvider: settings.searchProvider || '',
      },
      config: {
        deploymentName: config.deploymentName || '',
      },
      released_at: extra.released_at ? String(extra.released_at) : '',
      parameters_json: extra.parameters ? JSON.stringify(extra.parameters, null, 2) : '',
      pricing_json: extra.pricing ? JSON.stringify(extra.pricing, null, 2) : '',
    });
  }, [initial]);

  const handleSubmit = () => {
    setJsonError('');

    let parameters: Record<string, unknown> | undefined;
    let pricingExtra: Record<string, unknown> | undefined;

    if (form.parameters_json.trim()) {
      try {
        parameters = JSON.parse(form.parameters_json) as Record<string, unknown>;
      } catch (error) {
        setJsonError('参数 JSON 无法解析，请检查格式');
        return;
      }
    }

    if (form.pricing_json.trim()) {
      try {
        pricingExtra = JSON.parse(form.pricing_json) as Record<string, unknown>;
      } catch (error) {
        setJsonError('价格 JSON 无法解析，请检查格式');
        return;
      }
    }

    const pricing: ModelPricing = {
      currency: form.pricing_currency || 'USD',
      input: form.input_cost_per_1k || undefined,
      output: form.output_cost_per_1k || undefined,
      ...pricingExtra,
    };

    const source = initial ? resolveModelSource(initial) : 'custom';

    const capabilities = buildModelCapabilities({
      abilities: form.abilities,
      settings: {
        extendParams: form.settings.extendParams.length ? form.settings.extendParams : undefined,
        searchImpl: form.settings.searchImpl,
        searchProvider: form.settings.searchProvider || undefined,
      },
      config: showDeployName && form.config.deploymentName ? { deploymentName: form.config.deploymentName } : undefined,
      pricing: pricingExtra || form.input_cost_per_1k || form.output_cost_per_1k ? pricing : undefined,
      parameters,
      released_at: form.released_at || null,
      source,
      maxToken: form.context_window || undefined,
      maxOutputTokens: form.max_output_tokens || undefined,
    });

    if (mode === 'create') {
      const payload: CreateModelRequest = {
        model_id: form.model_id,
        display_name: form.display_name || null,
        model_type: form.model_type,
        context_window: form.context_window,
        max_output_tokens: form.max_output_tokens,
        input_cost_per_1k: form.input_cost_per_1k || null,
        output_cost_per_1k: form.output_cost_per_1k || null,
        capabilities,
        is_enabled: true,
      };
      createMutation.mutate({ providerCode, data: payload }, { onSuccess: onClose });
    } else if (initial) {
      const payload: UpdateModelRequest = {
        display_name: form.display_name || null,
        model_type: form.model_type,
        context_window: form.context_window,
        max_output_tokens: form.max_output_tokens,
        input_cost_per_1k: form.input_cost_per_1k || null,
        output_cost_per_1k: form.output_cost_per_1k || null,
        capabilities,
      };
      updateMutation.mutate({ id: initial.id, data: payload }, { onSuccess: onClose });
    }
  };

  const handleDelete = () => {
    if (!initial) return;
    if (!confirm('确定删除该模型吗？')) return;
    deleteMutation.mutate(initial.id, { onSuccess: onClose });
  };

  const isPending = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  // 上下文窗口预设值
  const contextPresets = [4096, 8192, 16384, 32768, 65536, 131072, 200000, 1000000, 2000000];

  const extendParamSet = useMemo(() => new Set(form.settings.extendParams), [form.settings.extendParams]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[var(--bg-primary)] shadow-2xl"
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {mode === 'create' ? '添加自定义模型' : '模型配置'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 表单 */}
        <div className="p-5 space-y-6">
          {/* 基础信息 */}
          <div className="space-y-4">
            <div className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">基础信息</div>

            {/* 模型 ID */}
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-muted)]">
                模型 ID
                {mode === 'edit' && (
                  <span className="text-xs opacity-60 ml-1">(不可修改)</span>
                )}
              </label>
              <input
                type="text"
                value={form.model_id}
                onChange={(e) => setForm((prev) => ({ ...prev, model_id: e.target.value }))}
                disabled={mode === 'edit'}
                placeholder="claude-haiku-4-5-20251001"
                className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40 transition-all disabled:opacity-50"
              />
              <p className="text-xs text-[var(--text-muted)]">
                创建后不可修改，调用 AI 时将作为模型 ID 使用
              </p>
            </div>

            {/* 显示名称 */}
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-muted)]">模型展示名称</label>
              <input
                type="text"
                value={form.display_name}
                onChange={(e) => setForm((prev) => ({ ...prev, display_name: e.target.value }))}
                placeholder="GPT-5.2 / Claude 4.5 Thinking"
                className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40 transition-all"
              />
            </div>

            {/* 模型类型 */}
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-muted)]">模型类型</label>
              <select
                value={form.model_type}
                onChange={(e) => setForm((prev) => ({ ...prev, model_type: e.target.value }))}
                className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40 transition-all"
              >
                {MODEL_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 部署名 */}
            {showDeployName && (
              <div className="space-y-2">
                <label className="text-sm text-[var(--text-muted)]">部署名称 (Azure)</label>
                <input
                  type="text"
                  value={form.config.deploymentName}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      config: { ...prev.config, deploymentName: e.target.value },
                    }))
                  }
                  placeholder="gpt-5-2-deploy"
                  className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40 transition-all"
                />
              </div>
            )}

            {/* 发布时间 */}
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-muted)]">发布时间</label>
              <input
                type="date"
                value={form.released_at}
                onChange={(e) => setForm((prev) => ({ ...prev, released_at: e.target.value }))}
                className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40 transition-all"
              />
            </div>
          </div>

          {/* Tokens */}
          <div className="space-y-4">
            <div className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">Tokens</div>

            {/* 上下文窗口 */}
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-muted)]">最大上下文窗口</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={contextPresets.length - 1}
                  value={contextPresets.indexOf(
                    contextPresets.find((p) => p >= form.context_window) ||
                      contextPresets[contextPresets.length - 1]
                  )}
                  onChange={(e) => {
                    const idx = parseInt(e.target.value);
                    setForm((prev) => ({ ...prev, context_window: contextPresets[idx] }));
                  }}
                  className="flex-1 accent-primary"
                />
                <input
                  type="number"
                  value={form.context_window}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      context_window: parseInt(e.target.value) || 0,
                    }))
                  }
                  className="w-24 rounded-lg border border-white/5 bg-[var(--bg-card)]/50 px-3 py-1.5 text-sm text-right text-[var(--text-primary)] focus:outline-none focus:border-primary/40"
                />
              </div>
            </div>

            {/* 最大输出 */}
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-muted)]">最大输出 Tokens</label>
              <input
                type="number"
                value={form.max_output_tokens}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    max_output_tokens: parseInt(e.target.value) || 0,
                  }))
                }
                className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40 transition-all"
              />
            </div>
          </div>

          {/* 能力 */}
          <div className="space-y-4">
            <div className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">模型能力</div>
            <CapabilityToggle
              label="支持函数调用"
              description="模型可调用工具/函数"
              checked={!!form.abilities.functionCall}
              onChange={(v) =>
                setForm((prev) => ({
                  ...prev,
                  abilities: { ...prev.abilities, functionCall: v },
                }))
              }
            />
            <CapabilityToggle
              label="支持视觉识别"
              description="开启图片输入能力"
              checked={!!form.abilities.vision}
              onChange={(v) =>
                setForm((prev) => ({
                  ...prev,
                  abilities: { ...prev.abilities, vision: v },
                }))
              }
            />
            <CapabilityToggle
              label="支持深度思考"
              description="模型具备推理能力"
              checked={!!form.abilities.reasoning}
              onChange={(v) =>
                setForm((prev) => ({
                  ...prev,
                  abilities: { ...prev.abilities, reasoning: v },
                }))
              }
            />
            <CapabilityToggle
              label="支持联网搜索"
              description="模型内置搜索能力"
              checked={!!form.abilities.search}
              onChange={(v) =>
                setForm((prev) => ({
                  ...prev,
                  abilities: { ...prev.abilities, search: v },
                }))
              }
            />
            <CapabilityToggle
              label="支持图片输出"
              description="模型可输出图像"
              checked={!!form.abilities.imageOutput}
              onChange={(v) =>
                setForm((prev) => ({
                  ...prev,
                  abilities: { ...prev.abilities, imageOutput: v },
                }))
              }
            />
            <CapabilityToggle
              label="支持视频输出"
              description="模型可输出视频"
              checked={!!form.abilities.video}
              onChange={(v) =>
                setForm((prev) => ({
                  ...prev,
                  abilities: { ...prev.abilities, video: v },
                }))
              }
            />
            <CapabilityToggle
              label="支持文件上传"
              description="模型可处理文件"
              checked={!!form.abilities.files}
              onChange={(v) =>
                setForm((prev) => ({
                  ...prev,
                  abilities: { ...prev.abilities, files: v },
                }))
              }
            />
            <CapabilityToggle
              label="支持结构化输出"
              description="模型可返回结构化 JSON"
              checked={!!form.abilities.structuredOutput}
              onChange={(v) =>
                setForm((prev) => ({
                  ...prev,
                  abilities: { ...prev.abilities, structuredOutput: v },
                }))
              }
            />
          </div>

          {/* 扩展参数 */}
          <div className="space-y-4">
            <div className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">扩展参数</div>
            <div className="grid grid-cols-2 gap-2">
              {EXTEND_PARAMS_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setForm((prev) => {
                      const next = new Set(prev.settings.extendParams);
                      if (next.has(option)) {
                        next.delete(option);
                      } else {
                        next.add(option);
                      }
                      return {
                        ...prev,
                        settings: { ...prev.settings, extendParams: Array.from(next) },
                      };
                    });
                  }}
                  className={`px-3 py-2 rounded-lg border text-xs text-left transition-all ${
                    extendParamSet.has(option)
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-white/10 text-[var(--text-muted)] hover:border-white/20'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          {/* 搜索配置 */}
          <div className="space-y-4">
            <div className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">搜索配置</div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm text-[var(--text-muted)]">搜索实现方式</label>
                <select
                  value={form.settings.searchImpl || ''}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      settings: {
                        ...prev.settings,
                        searchImpl: (e.target.value || undefined) as ModelSettings['searchImpl'],
                      },
                    }))
                  }
                  className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40"
                >
                  <option value="">自动</option>
                  {SEARCH_IMPL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value || ''}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-[var(--text-muted)]">搜索服务商</label>
                <input
                  type="text"
                  value={form.settings.searchProvider}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      settings: { ...prev.settings, searchProvider: e.target.value },
                    }))
                  }
                  placeholder="perplexity / serpapi"
                  className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40"
                />
              </div>
            </div>
          </div>

          {/* 价格 */}
          <div className="space-y-4">
            <div className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">价格</div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm text-[var(--text-muted)]">币种</label>
                <select
                  value={form.pricing_currency || 'USD'}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      pricing_currency: e.target.value as ModelPricing['currency'],
                    }))
                  }
                  className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40"
                >
                  <option value="USD">USD</option>
                  <option value="CNY">CNY</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-[var(--text-muted)]">输入成本 / 1K</label>
                <input
                  type="number"
                  value={form.input_cost_per_1k}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      input_cost_per_1k: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-[var(--text-muted)]">输出成本 / 1K</label>
                <input
                  type="number"
                  value={form.output_cost_per_1k}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      output_cost_per_1k: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-muted)]">高级价格 JSON (可选)</label>
              <textarea
                rows={4}
                value={form.pricing_json}
                onChange={(e) => setForm((prev) => ({ ...prev, pricing_json: e.target.value }))}
                placeholder='{"audioInput": 3.0, "cachedInput": 0.3}'
                className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-3 py-2 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-primary/40"
              />
            </div>
          </div>

          {/* 高级参数 */}
          <div className="space-y-4">
            <div className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">高级参数</div>
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-muted)]">模型参数 JSON</label>
              <textarea
                rows={5}
                value={form.parameters_json}
                onChange={(e) => setForm((prev) => ({ ...prev, parameters_json: e.target.value }))}
                placeholder='{"temperature": {"min": 0, "max": 2}}'
                className="w-full rounded-xl border border-white/5 bg-[var(--bg-card)]/50 px-3 py-2 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-primary/40"
              />
            </div>
          </div>

          {jsonError && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">
              {jsonError}
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between p-5 border-t border-white/5">
          {mode === 'edit' && initial && (
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="px-4 py-2 rounded-xl border border-red-500/30 text-red-400 text-sm font-medium hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              删除模型
            </button>
          )}
          <div className={`flex gap-3 ${mode === 'create' ? 'ml-auto' : ''}`}>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-white/10 text-[var(--text-secondary)] text-sm font-medium hover:bg-white/5 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={isPending || (mode === 'create' && !form.model_id)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              确认
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// 能力开关组件
function CapabilityToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-all flex-shrink-0 mt-0.5 ${
          checked ? 'bg-primary' : 'bg-white/10 group-hover:bg-white/20'
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
            checked ? 'left-5 bg-white' : 'left-0.5 bg-white/60'
          }`}
        />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[var(--text-primary)]">{label}</div>
        <div className="text-xs text-[var(--text-muted)] mt-0.5">{description}</div>
      </div>
    </label>
  );
}
