// 模型配置弹窗组件 —— 工作台式分区配置面板
// ref: §5.1 - AI Service 架构 · 模型中心
// 设计: aiw-dialog 骨架(粘性头/锚点导航/粘性尾) · 能力 chip 网格 · 价格 mono+tnum
//      滚动联动分区导航,Esc 关闭,焦点态走极光光环(见 index.css .aiw-*)

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  X,
  Loader2,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Sparkles,
  Check,
  Wand2,
  Eye,
  Brain,
  Globe,
  Image as ImageIcon,
  Video,
  Paperclip,
  Braces,
} from 'lucide-react';
import { Toggle, spring, transition, variants } from '@aetherblog/ui';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { aiProviderService, type AiModel, type CreateModelRequest, type UpdateModelRequest } from '@/services/aiProviderService';
import { useQuery } from '@tanstack/react-query';
import { useModalDialog } from '@/hooks/useModalDialog';
import { MODEL_TYPES, type ModelAbility, type ModelSettings, type ModelPricing, type SamplingParam } from '../types';
import { groupParamControls, SAMPLING_PARAMS } from '../utils/modelParams';
import { useCreateModel, useUpdateModel, useDeleteModel } from '../hooks/useModels';
import {
  useSyncModelFromGlobal,
  useSyncModelToGlobal,
} from '@/pages/global-pricing/hooks';
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

const SEARCH_IMPL_OPTIONS: Array<{ label: string; value: ModelSettings['searchImpl'] }> = [
  { label: '工具调用', value: 'tool' },
  { label: '参数驱动', value: 'params' },
  { label: '模型内置', value: 'internal' },
];

// 上下文窗口预设档位
const CONTEXT_PRESETS: Array<{ value: number; label: string }> = [
  { value: 8192, label: '8K' },
  { value: 32768, label: '32K' },
  { value: 65536, label: '64K' },
  { value: 131072, label: '128K' },
  { value: 200000, label: '200K' },
  { value: 400000, label: '400K' },
  { value: 1000000, label: '1M' },
  { value: 2000000, label: '2M' },
];

// 最大输出 Tokens 预设档位
const OUTPUT_TOKENS_PRESETS: Array<{ value: number; label: string }> = [
  { value: 2048, label: '2K' },
  { value: 4096, label: '4K' },
  { value: 8192, label: '8K' },
  { value: 16384, label: '16K' },
  { value: 32768, label: '32K' },
  { value: 65536, label: '64K' },
  { value: 131072, label: '128K' },
];

// 分区锚点(渲染顺序即导航顺序)
const DIALOG_SECTIONS = [
  { id: 'identity', label: '基础' },
  { id: 'spec', label: '规格' },
  { id: 'abilities', label: '能力' },
  { id: 'params', label: '参数' },
  { id: 'search', label: '搜索' },
  { id: 'pricing', label: '价格' },
  { id: 'advanced', label: '高级' },
] as const;

type SectionId = (typeof DIALOG_SECTIONS)[number]['id'];

// 能力目录:与 ModelCard 徽章同一套语义
const ABILITY_OPTIONS: Array<{
  key: keyof ModelAbility;
  label: string;
  desc: string;
  icon: typeof Wand2;
}> = [
  { key: 'functionCall', label: '函数调用', desc: '可调用工具 / 函数', icon: Wand2 },
  { key: 'vision', label: '视觉识别', desc: '接受图片输入', icon: Eye },
  { key: 'reasoning', label: '深度思考', desc: '具备链式推理能力', icon: Brain },
  { key: 'search', label: '联网搜索', desc: '内置搜索增强', icon: Globe },
  { key: 'imageOutput', label: '图片输出', desc: '可生成图像', icon: ImageIcon },
  { key: 'video', label: '视频输出', desc: '可生成视频', icon: Video },
  { key: 'files', label: '文件上传', desc: '可处理文件输入', icon: Paperclip },
  { key: 'structuredOutput', label: '结构化输出', desc: '可返回结构化 JSON', icon: Braces },
];

// 空串 → null（未设置），数字串 → number；保留 "0" 为合法值。
// 用 `Number()` 而非 `parseFloat` —— 后者对 "12 cats" 之类宽松截取，
// 这里要严格一些；同时支持 type="number" 输入框可能产生的 "1e6" 写法。
const parseNum = (s: string): number | null => {
  const trimmed = s.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

const costToString = (v: number | null | undefined) => (v == null ? '' : String(v));

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
    context_window: '128000',
    max_output_tokens: '4096',
    input_cost_per_1m: '',
    output_cost_per_1m: '',
    cached_input_cost_per_1m: '',
    pricing_currency: 'USD' as ModelPricing['currency'],
    description: '',
    legacy: false,
    organization: '',
    max_dimension: '' as number | '',
    resolutions: '',
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
      disabledParams: [] as SamplingParam[],
    },
    config: {
      deploymentName: '',
      enabledSearch: false,
    },
    released_at: '',
    parameters_json: '',
    pricing_json: '',
  });
  const [jsonError, setJsonError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 分区滚动联动
  const bodyRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<SectionId>('identity');

  const createMutation = useCreateModel();
  const updateMutation = useUpdateModel();
  const deleteMutation = useDeleteModel();
  const syncFromGlobalMutation = useSyncModelFromGlobal();
  const syncToGlobalMutation = useSyncModelToGlobal();

  // 查询当前 model_id 是否已配置全局价格 —— 用于在编辑面板里展示「↺ 从全局回填」按钮
  const globalPricingQuery = useQuery({
    queryKey: ['ai-global-pricing', 'by-model-id', initial?.model_id],
    queryFn: () => aiProviderService.getGlobalPricing(initial!.model_id),
    select: (res) => res.data,
    enabled: mode === 'edit' && !!initial?.model_id,
    retry: false,
  });
  const hasGlobalPricing = !!globalPricingQuery.data;

  // 检查该 embedding 模型是否被搜索路由使用
  const embeddingRoutingQuery = useQuery({
    queryKey: ['embedding-routing'],
    queryFn: () => aiProviderService.getRouting('embedding'),
    select: (res) => res.data,
    enabled: mode === 'edit' && initial?.model_type === 'embedding',
  });

  const isUsedBySearch = mode === 'edit' &&
    initial?.model_type === 'embedding' &&
    !!embeddingRoutingQuery.data?.primary_model &&
    embeddingRoutingQuery.data.primary_model.id === initial?.id;

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

    const initialInputCost = initial.input_cost_per_1m ?? pricing.input ?? null;
    const initialOutputCost = initial.output_cost_per_1m ?? pricing.output ?? null;
    const initialCachedInputCost = initial.cached_input_cost_per_1m ?? pricing.cachedInput ?? null;

    setForm({
      model_id: initial.model_id,
      display_name: initial.display_name || '',
      model_type: initial.model_type || 'chat',
      context_window: String(contextWindow || 128000),
      max_output_tokens: String(maxOutputTokens || 4096),
      input_cost_per_1m: costToString(initialInputCost),
      output_cost_per_1m: costToString(initialOutputCost),
      cached_input_cost_per_1m: costToString(initialCachedInputCost),
      pricing_currency: pricing.currency || 'USD',
      description: extra.description ? String(extra.description) : '',
      legacy: !!extra.legacy,
      organization: extra.organization ? String(extra.organization) : '',
      max_dimension:
        typeof extra.maxDimension === 'number' && Number.isFinite(extra.maxDimension)
          ? extra.maxDimension
          : '',
      resolutions: Array.isArray(extra.resolutions) ? extra.resolutions.join(', ') : '',
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
        disabledParams: settings.disabledParams || [],
      },
      config: {
        deploymentName: config.deploymentName || '',
        enabledSearch: !!config.enabledSearch,
      },
      released_at: extra.released_at ? String(extra.released_at) : '',
      parameters_json: extra.parameters ? JSON.stringify(extra.parameters, null, 2) : '',
      pricing_json: extra.pricing ? JSON.stringify(extra.pricing, null, 2) : '',
    });
  }, [initial]);

  // 焦点管理 + Esc(含 IME 组合态守卫) + 滚动锁 —— 删除确认打开时让内层自己处理 Esc
  const dialogRef = useModalDialog<HTMLDivElement>({
    onClose,
    escEnabled: !showDeleteConfirm,
  });

  // 滚动联动:取视口上缘 100px 内最后一个越过的分区
  const handleBodyScroll = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const bodyTop = body.getBoundingClientRect().top;
    let current: SectionId = 'identity';
    body.querySelectorAll<HTMLElement>('[data-aiw-section]').forEach((el) => {
      if (el.getBoundingClientRect().top - bodyTop <= 100) {
        current = (el.dataset.aiwSection as SectionId) || current;
      }
    });
    setActiveSection(current);
  }, []);

  const scrollToSection = (id: SectionId) => {
    const body = bodyRef.current;
    const el = body?.querySelector<HTMLElement>(`[data-aiw-section='${id}']`);
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  };

  const handleSubmit = () => {
    setJsonError('');

    let parameters: Record<string, unknown> | undefined;
    let pricingExtra: Record<string, unknown> | undefined;

    if (form.parameters_json.trim()) {
      try {
        parameters = JSON.parse(form.parameters_json) as Record<string, unknown>;
      } catch {
        setJsonError('参数 JSON 无法解析，请检查格式');
        return;
      }
    }

    if (form.pricing_json.trim()) {
      try {
        pricingExtra = JSON.parse(form.pricing_json) as Record<string, unknown>;
      } catch {
        setJsonError('价格 JSON 无法解析，请检查格式');
        return;
      }
    }

    // null = 未填写；0 = 显式免费/零值
    // 上下文窗口 / 最大输出 Tokens 后端 schema 是 int，强制取整避免 422
    const ctxWindow = Math.trunc(parseNum(form.context_window) ?? 0);
    const maxOutput = Math.trunc(parseNum(form.max_output_tokens) ?? 0);
    const inputCost = parseNum(form.input_cost_per_1m);
    const outputCost = parseNum(form.output_cost_per_1m);
    const cachedInputCost = parseNum(form.cached_input_cost_per_1m);

    const pricing: ModelPricing = {
      currency: form.pricing_currency || 'USD',
      input: inputCost ?? undefined,
      output: outputCost ?? undefined,
      cachedInput: cachedInputCost ?? undefined,
      ...pricingExtra,
    };

    const source = initial ? resolveModelSource(initial) : 'custom';
    const extraBase = initial ? (getModelExtra(initial) as Record<string, unknown>) : null;
    const resolutions = form.resolutions
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const maxDimensionValue =
      typeof form.max_dimension === 'number'
        ? form.max_dimension
        : form.max_dimension
          ? Number.parseInt(String(form.max_dimension), 10)
          : undefined;

    const capabilities = buildModelCapabilities({
      abilities: form.abilities,
      settings: {
        extendParams: form.settings.extendParams.length ? form.settings.extendParams : undefined,
        searchImpl: form.settings.searchImpl,
        searchProvider: form.settings.searchProvider || undefined,
        disabledParams: form.settings.disabledParams?.length ? form.settings.disabledParams : undefined,
      },
      config: {
        deploymentName: showDeployName && form.config.deploymentName ? form.config.deploymentName : undefined,
        enabledSearch: form.config.enabledSearch,
      },
      pricing:
        pricingExtra || inputCost !== null || outputCost !== null || cachedInputCost !== null
          ? pricing
          : undefined,
      parameters,
      released_at: form.released_at || null,
      source,
      maxToken: ctxWindow || undefined,
      maxOutputTokens: maxOutput || undefined,
      description: form.description || undefined,
      legacy: form.legacy,
      organization: form.organization || undefined,
      maxDimension: Number.isFinite(maxDimensionValue as number) ? (maxDimensionValue as number) : undefined,
      resolutions: resolutions.length ? resolutions : undefined,
      extra: extraBase,
    });

    if (mode === 'create') {
      const payload: CreateModelRequest = {
        model_id: form.model_id,
        display_name: form.display_name || null,
        model_type: form.model_type,
        context_window: ctxWindow,
        max_output_tokens: maxOutput,
        input_cost_per_1m: inputCost,
        output_cost_per_1m: outputCost,
        cached_input_cost_per_1m: cachedInputCost,
        capabilities,
        is_enabled: true,
      };
      createMutation.mutate({ providerCode, data: payload }, { onSuccess: onClose });
    } else if (initial) {
      const payload: UpdateModelRequest = {
        display_name: form.display_name || null,
        model_type: form.model_type,
        context_window: ctxWindow,
        max_output_tokens: maxOutput,
        input_cost_per_1m: inputCost,
        output_cost_per_1m: outputCost,
        cached_input_cost_per_1m: cachedInputCost,
        capabilities,
      };
      updateMutation.mutate({ id: initial.id, data: payload }, { onSuccess: onClose });
    }
  };

  const handleDelete = () => {
    if (!initial) return;
    deleteMutation.mutate(initial.id, { onSuccess: onClose });
  };

  const isPending = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  // 按分组聚合扩展参数控件，并依据已选能力标注「推荐」
  const paramSections = useMemo(
    () => groupParamControls(form.settings.extendParams, form.abilities),
    [form.settings.extendParams, form.abilities]
  );

  const enabledAbilityCount = useMemo(
    () => ABILITY_OPTIONS.filter(({ key }) => form.abilities[key]).length,
    [form.abilities]
  );

  const toggleAbility = (key: keyof ModelAbility) => {
    setForm((prev) => ({
      ...prev,
      abilities: { ...prev.abilities, [key]: !prev.abilities[key] },
    }));
  };

  const toggleExtendParam = (id: string) => {
    setForm((prev) => {
      const next = new Set(prev.settings.extendParams);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, settings: { ...prev.settings, extendParams: Array.from(next) } };
    });
  };

  const toggleDisabledParam = (id: SamplingParam) => {
    setForm((prev) => {
      const current = prev.settings.disabledParams || [];
      const disabledParams = current.includes(id)
        ? current.filter((p) => p !== id)
        : [...current, id];
      return { ...prev, settings: { ...prev.settings, disabledParams } };
    });
  };

  const currencySymbol = form.pricing_currency === 'CNY' ? '¥' : '$';
  const typeLabel = MODEL_TYPES.find((t) => t.value === form.model_type)?.label || form.model_type;

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
        ref={dialogRef}
        tabIndex={-1}
        className="aiw-dialog surface-overlay sm:max-w-3xl"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'create' ? '添加自定义模型' : '模型配置'}
      >
        {/* 头部 */}
        <div className="aiw-dialog-header">
          <div className="min-w-0">
            <div className="aiw-eyebrow">
              Model · {mode === 'create' ? 'Create' : 'Configure'}
            </div>
            <h2 className="aiw-dialog-title mt-1.5 truncate">
              {mode === 'create'
                ? '添加自定义模型'
                : form.display_name || initial?.display_name || initial?.model_id || '模型配置'}
            </h2>
            <div className="aiw-dialog-subtitle">
              {mode === 'edit' && initial && <span>{initial.model_id}</span>}
              <span className="aiw-signal-badge" data-tone="neutral">{providerCode}</span>
              <span className="aiw-signal-badge" data-tone="neutral">{typeLabel}</span>
              {enabledAbilityCount > 0 && (
                <span className="aiw-signal-badge" data-tone="accent">
                  {enabledAbilityCount} 项能力
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} aria-label="关闭" className="aiw-dialog-close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 分区锚点导航 */}
        <nav className="aiw-dialog-nav" aria-label="配置分区导航">
          {DIALOG_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              data-active={activeSection === section.id ? 'true' : 'false'}
              onClick={() => scrollToSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </nav>

        {/* 表单主体 */}
        <div ref={bodyRef} onScroll={handleBodyScroll} className="aiw-dialog-body">
          {/* —— 基础信息 —— */}
          <section data-aiw-section="identity" className="aiw-section">
            <div className="aiw-eyebrow">基础信息</div>

            <div className="aiw-field">
              <label className="aiw-label" htmlFor="aiw-model-id">
                模型 ID
                {mode === 'edit' && <small>创建后不可修改</small>}
              </label>
              <input
                id="aiw-model-id"
                type="text"
                value={form.model_id}
                onChange={(e) => setForm((prev) => ({ ...prev, model_id: e.target.value }))}
                disabled={mode === 'edit'}
                placeholder="gpt-5-mini"
                data-mono="true"
                className="aiw-input"
              />
              {mode === 'create' && (
                <p className="aiw-helper">调用 AI 时作为模型 ID 使用，创建后不可修改。</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="aiw-field">
                <label className="aiw-label" htmlFor="aiw-display-name">展示名称</label>
                <input
                  id="aiw-display-name"
                  type="text"
                  value={form.display_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, display_name: e.target.value }))}
                  placeholder="GPT-5.2 / Claude 4.5 Thinking"
                  className="aiw-input"
                />
              </div>
              <div className="aiw-field">
                <label className="aiw-label" htmlFor="aiw-organization">发布组织</label>
                <input
                  id="aiw-organization"
                  type="text"
                  value={form.organization}
                  onChange={(e) => setForm((prev) => ({ ...prev, organization: e.target.value }))}
                  placeholder="OpenAI / Anthropic / Google"
                  className="aiw-input"
                />
              </div>
            </div>

            <div className="aiw-field">
              <label className="aiw-label" htmlFor="aiw-description">模型描述</label>
              <textarea
                id="aiw-description"
                rows={2}
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="简要描述模型特性"
                className="aiw-textarea"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="aiw-field">
                <label className="aiw-label" htmlFor="aiw-model-type">模型类型</label>
                <select
                  id="aiw-model-type"
                  value={form.model_type}
                  onChange={(e) => setForm((prev) => ({ ...prev, model_type: e.target.value }))}
                  className="aiw-select"
                >
                  {MODEL_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="aiw-field">
                <label className="aiw-label" htmlFor="aiw-released-at">发布时间</label>
                <input
                  id="aiw-released-at"
                  type="date"
                  value={form.released_at}
                  onChange={(e) => setForm((prev) => ({ ...prev, released_at: e.target.value }))}
                  data-mono="true"
                  className="aiw-input"
                />
              </div>
            </div>

            {showDeployName && (
              <div className="aiw-field">
                <label className="aiw-label" htmlFor="aiw-deploy-name">部署名称<small>Azure</small></label>
                <input
                  id="aiw-deploy-name"
                  type="text"
                  value={form.config.deploymentName}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      config: { ...prev.config, deploymentName: e.target.value },
                    }))
                  }
                  placeholder="gpt-5-2-deploy"
                  data-mono="true"
                  className="aiw-input"
                />
              </div>
            )}

            <CapabilityToggle
              label="标记为旧版模型"
              description="用于标记已弃用但仍保留的模型"
              checked={!!form.legacy}
              onChange={(v) => setForm((prev) => ({ ...prev, legacy: v }))}
            />
          </section>

          {/* —— 规格(Tokens) —— */}
          <section data-aiw-section="spec" className="aiw-section">
            <div className="aiw-eyebrow">
              规格
              <span className="aiw-eyebrow-meta">Tokens</span>
            </div>

            <div className="aiw-field">
              <span className="aiw-label">最大上下文窗口</span>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex flex-1 flex-wrap gap-1.5">
                  {CONTEXT_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      className="aiw-preset"
                      data-active={String(preset.value) === form.context_window ? 'true' : 'false'}
                      onClick={() =>
                        setForm((prev) => ({ ...prev, context_window: String(preset.value) }))
                      }
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  inputMode="numeric"
                  value={form.context_window}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, context_window: e.target.value }))
                  }
                  placeholder="自定义"
                  data-mono="true"
                  data-align="right"
                  className="aiw-input h-9 w-full !py-0 sm:w-28"
                />
              </div>
            </div>

            <div className="aiw-field">
              <span className="aiw-label">最大输出 Tokens</span>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex flex-1 flex-wrap gap-1.5">
                  {OUTPUT_TOKENS_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      className="aiw-preset"
                      data-active={String(preset.value) === form.max_output_tokens ? 'true' : 'false'}
                      onClick={() =>
                        setForm((prev) => ({ ...prev, max_output_tokens: String(preset.value) }))
                      }
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  inputMode="numeric"
                  value={form.max_output_tokens}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, max_output_tokens: e.target.value }))
                  }
                  placeholder="自定义"
                  data-mono="true"
                  data-align="right"
                  className="aiw-input h-9 w-full !py-0 sm:w-28"
                />
              </div>
            </div>

            {form.model_type === 'embedding' && (
              <div className="aiw-field">
                <label className="aiw-label" htmlFor="aiw-max-dimension">最大向量维度</label>
                <input
                  id="aiw-max-dimension"
                  type="number"
                  value={form.max_dimension}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      max_dimension: parseInt(e.target.value) || '',
                    }))
                  }
                  data-mono="true"
                  className="aiw-input"
                />
              </div>
            )}

            {form.model_type === 'image' && (
              <div className="aiw-field">
                <label className="aiw-label" htmlFor="aiw-resolutions">支持分辨率</label>
                <input
                  id="aiw-resolutions"
                  type="text"
                  value={form.resolutions}
                  onChange={(e) => setForm((prev) => ({ ...prev, resolutions: e.target.value }))}
                  placeholder="1024x1024, 1536x1024"
                  data-mono="true"
                  className="aiw-input"
                />
                <p className="aiw-helper">逗号分隔多个分辨率档位。</p>
              </div>
            )}
          </section>

          {/* —— 能力 —— */}
          <section data-aiw-section="abilities" className="aiw-section">
            <div className="aiw-eyebrow">
              模型能力
              <span className="aiw-eyebrow-meta">
                已启用 {enabledAbilityCount} / {ABILITY_OPTIONS.length}
              </span>
            </div>
            <div className="aiw-chip-grid">
              {ABILITY_OPTIONS.map(({ key, label, desc, icon: Icon }) => {
                const active = !!form.abilities[key];
                return (
                  <motion.button
                    key={key}
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    transition={spring.precise}
                    className="aiw-chip"
                    data-active={active ? 'true' : 'false'}
                    aria-pressed={active}
                    onClick={() => toggleAbility(key)}
                  >
                    <span className="aiw-chip-icon">
                      <Icon />
                    </span>
                    <span className="aiw-chip-copy">
                      <span className="aiw-chip-title">{label}</span>
                      <span className="aiw-chip-desc">{desc}</span>
                    </span>
                    <span className="aiw-chip-check">
                      <Check />
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </section>

          {/* —— 参数与推理 —— */}
          <section data-aiw-section="params" className="aiw-section">
            <div className="aiw-eyebrow">
              参数与推理
              {form.settings.extendParams.length > 0 && (
                <span className="aiw-eyebrow-meta">已启用 {form.settings.extendParams.length} 项</span>
              )}
            </div>

            {paramSections.map((section) => (
              <div key={section.group.key} className="aiw-field">
                <span className="aiw-label">
                  {section.group.label}
                  <small>{section.group.hint}</small>
                </span>
                <div className="aiw-chip-grid !grid-cols-1 sm:!grid-cols-2">
                  {section.controls.map((control) => {
                    const active = control.selected;
                    return (
                      <motion.button
                        key={control.id}
                        type="button"
                        whileTap={{ scale: 0.97 }}
                        transition={spring.precise}
                        className="aiw-chip"
                        data-active={active ? 'true' : 'false'}
                        aria-pressed={active}
                        onClick={() => toggleExtendParam(control.id)}
                      >
                        <span className="aiw-chip-copy">
                          <span className="aiw-chip-title">
                            {control.label}
                            {control.recommended && !active && (
                              <span className="aiw-signal-badge" data-tone="accent">
                                <Sparkles />
                                推荐
                              </span>
                            )}
                          </span>
                          <span className="aiw-chip-desc">{control.desc}</span>
                        </span>
                        <span className="aiw-chip-check">
                          <Check />
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* 屏蔽采样参数（disabledParams） */}
            <div className="aiw-field">
              <span className="aiw-label">
                屏蔽采样参数
                <small>勾选后调用时省略，常用于推理模型</small>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {SAMPLING_PARAMS.map((p) => {
                  const active = form.settings.disabledParams?.includes(p.id) ?? false;
                  return (
                    <motion.button
                      key={p.id}
                      type="button"
                      whileTap={{ scale: 0.95 }}
                      transition={spring.precise}
                      onClick={() => toggleDisabledParam(p.id)}
                      title={p.desc}
                      className="aiw-preset !font-sans !tracking-normal"
                      data-variant="block"
                      data-active={active ? 'true' : 'false'}
                      aria-pressed={active}
                    >
                      {p.label}
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* —— 搜索配置 —— */}
          <section data-aiw-section="search" className="aiw-section">
            <div className="aiw-eyebrow">搜索配置</div>
            <CapabilityToggle
              label="启用内置搜索"
              description="部分模型需要显式开启搜索能力"
              checked={!!form.config.enabledSearch}
              onChange={(v) =>
                setForm((prev) => ({
                  ...prev,
                  config: { ...prev.config, enabledSearch: v },
                }))
              }
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="aiw-field">
                <label className="aiw-label" htmlFor="aiw-search-impl">搜索实现方式</label>
                <select
                  id="aiw-search-impl"
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
                  className="aiw-select"
                >
                  <option value="">自动</option>
                  {SEARCH_IMPL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value || ''}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="aiw-field">
                <label className="aiw-label" htmlFor="aiw-search-provider">搜索服务商</label>
                <input
                  id="aiw-search-provider"
                  type="text"
                  value={form.settings.searchProvider}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      settings: { ...prev.settings, searchProvider: e.target.value },
                    }))
                  }
                  placeholder="perplexity / serpapi"
                  data-mono="true"
                  className="aiw-input"
                />
              </div>
            </div>
          </section>

          {/* —— 价格 —— */}
          <section data-aiw-section="pricing" className="aiw-section">
            <div className="aiw-eyebrow">
              价格
              <span className="aiw-eyebrow-meta">单位 / 1M Tokens</span>
            </div>

            {mode === 'edit' && initial && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!hasGlobalPricing || syncFromGlobalMutation.isPending}
                  onClick={async () => {
                    try {
                      await syncFromGlobalMutation.mutateAsync(initial.id);
                      const fresh = await globalPricingQuery.refetch();
                      const g = fresh.data;
                      if (g) {
                        // 把全局价格立即回填进表单，避免用户在保存前还看到旧值
                        const extraPricing: Record<string, unknown> = {};
                        Object.entries(g.pricing || {}).forEach(([k, v]) => {
                          if (
                            ['input', 'output', 'cachedInput', 'currency', 'units'].includes(k)
                          )
                            return;
                          extraPricing[k] = v;
                        });
                        setForm((prev) => ({
                          ...prev,
                          input_cost_per_1m: costToString(g.input_cost_per_1m),
                          output_cost_per_1m: costToString(g.output_cost_per_1m),
                          cached_input_cost_per_1m: costToString(g.cached_input_cost_per_1m),
                          pricing_currency: (g.currency ||
                            'USD') as ModelPricing['currency'],
                          // 全局没有扩展键时显式清空，避免本地保留陈旧的 audioInput
                          // 等字段，导致回填后仍与全局基准不一致
                          pricing_json: Object.keys(extraPricing).length
                            ? JSON.stringify(extraPricing, null, 2)
                            : '',
                        }));
                      }
                    } catch {
                      // 错误已在 hook 中 toast
                    }
                  }}
                  className="aiw-tool-button"
                  title={
                    hasGlobalPricing
                      ? '从全局价格回填到本模型'
                      : '尚未配置该 model_id 的全局价格'
                  }
                >
                  {syncFromGlobalMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ArrowDownToLine className="h-3 w-3" />
                  )}
                  从全局回填
                </button>
                <button
                  type="button"
                  disabled={syncToGlobalMutation.isPending}
                  onClick={async () => {
                    try {
                      await syncToGlobalMutation.mutateAsync(initial.id);
                      await globalPricingQuery.refetch();
                    } catch {
                      // toast 已在 hook 中处理
                    }
                  }}
                  className="aiw-tool-button"
                  title="把本模型当前价格写入全局表"
                >
                  {syncToGlobalMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ArrowUpFromLine className="h-3 w-3" />
                  )}
                  写入全局
                </button>
                {hasGlobalPricing && globalPricingQuery.data && (
                  <span className="aiw-price">
                    <span className="aiw-price-pair">
                      <span>全局基准 · 入</span>
                      <b>{globalPricingQuery.data.input_cost_per_1m ?? '—'}</b>
                    </span>
                    <span className="aiw-price-pair">
                      <span>出</span>
                      <b>{globalPricingQuery.data.output_cost_per_1m ?? '—'}</b>
                    </span>
                    <span className="aiw-price-pair">
                      <span>缓存</span>
                      <b>{globalPricingQuery.data.cached_input_cost_per_1m ?? '—'}</b>
                    </span>
                    <span className="aiw-price-pair">
                      <span>{globalPricingQuery.data.currency}</span>
                    </span>
                  </span>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <div className="aiw-field">
                <label className="aiw-label" htmlFor="aiw-currency">币种</label>
                <select
                  id="aiw-currency"
                  value={form.pricing_currency || 'USD'}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      pricing_currency: e.target.value as ModelPricing['currency'],
                    }))
                  }
                  className="aiw-select"
                >
                  <option value="USD">USD $</option>
                  <option value="CNY">CNY ¥</option>
                </select>
              </div>
              <PriceInput
                id="aiw-cost-input"
                label="输入成本"
                symbol={currencySymbol}
                value={form.input_cost_per_1m}
                onChange={(v) => setForm((prev) => ({ ...prev, input_cost_per_1m: v }))}
              />
              <PriceInput
                id="aiw-cost-output"
                label="输出成本"
                symbol={currencySymbol}
                value={form.output_cost_per_1m}
                onChange={(v) => setForm((prev) => ({ ...prev, output_cost_per_1m: v }))}
              />
              <PriceInput
                id="aiw-cost-cached"
                label="缓存读取"
                symbol={currencySymbol}
                value={form.cached_input_cost_per_1m}
                onChange={(v) => setForm((prev) => ({ ...prev, cached_input_cost_per_1m: v }))}
              />
            </div>

            <div className="aiw-field">
              <label className="aiw-label" htmlFor="aiw-pricing-json">
                高级价格 JSON
                <small>可选,音频 / 视频等其它单价键</small>
              </label>
              <textarea
                id="aiw-pricing-json"
                rows={4}
                value={form.pricing_json}
                onChange={(e) => setForm((prev) => ({ ...prev, pricing_json: e.target.value }))}
                placeholder='{"audioInput": 3.0, "cachedInput": 0.3}'
                data-mono="true"
                className="aiw-textarea text-xs"
              />
            </div>
          </section>

          {/* —— 高级参数 —— */}
          <section data-aiw-section="advanced" className="aiw-section">
            <div className="aiw-eyebrow">高级参数</div>
            <div className="aiw-field">
              <label className="aiw-label" htmlFor="aiw-parameters-json">
                模型参数 JSON
                <small>参数约束与默认值声明</small>
              </label>
              <textarea
                id="aiw-parameters-json"
                rows={5}
                value={form.parameters_json}
                onChange={(e) => setForm((prev) => ({ ...prev, parameters_json: e.target.value }))}
                placeholder='{"temperature": {"min": 0, "max": 2}}'
                data-mono="true"
                className="aiw-textarea text-xs"
              />
            </div>
          </section>

          {jsonError && (
            <div
              className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm"
              style={{
                color: 'var(--signal-danger)',
                borderColor: 'color-mix(in oklch, var(--signal-danger) 30%, transparent)',
                background: 'color-mix(in oklch, var(--signal-danger) 8%, transparent)',
              }}
              role="alert"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {jsonError}
            </div>
          )}

          {/* 搜索路由警告 */}
          {isUsedBySearch && (
            <div
              className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm"
              style={{
                color: 'var(--signal-warn)',
                borderColor: 'color-mix(in oklch, var(--signal-warn) 30%, transparent)',
                background: 'color-mix(in oklch, var(--signal-warn) 8%, transparent)',
              }}
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              此模型已关联搜索功能的向量化配置，删除或禁用将导致语义搜索不可用
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="aiw-dialog-footer">
          {mode === 'edit' && initial ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isPending}
              className="aiw-button-danger"
            >
              删除模型
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-3">
            <motion.button
              onClick={onClose}
              whileTap={{ scale: 0.97 }}
              transition={spring.precise}
              className="aiw-button flex-1 sm:flex-none"
            >
              取消
            </motion.button>
            <motion.button
              onClick={handleSubmit}
              disabled={isPending || (mode === 'create' && !form.model_id)}
              whileTap={{ scale: 0.96 }}
              transition={spring.precise}
              className="aiw-button-primary flex-1 sm:flex-none"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === 'create' ? '创建模型' : '保存配置'}
            </motion.button>
          </div>
        </div>

        <ConfirmDialog
          isOpen={showDeleteConfirm}
          title="删除模型"
          message={
            isUsedBySearch
              ? '此模型正在被搜索功能使用，删除后语义搜索将不可用。确定删除该模型吗？此操作不可撤销。'
              : '确定删除该模型吗？此操作不可撤销。'
          }
          confirmText="删除"
          variant="danger"
          onConfirm={() => { setShowDeleteConfirm(false); handleDelete(); }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      </motion.div>
    </motion.div>,
    document.body
  );
}

// 价格输入:货币符号前缀 + mono 右对齐
function PriceInput({
  id,
  label,
  symbol,
  value,
  onChange,
}: {
  id: string;
  label: string;
  symbol: string;
  value: string;
  onChange: (value: string) => void;
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
          inputMode="decimal"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="未配置"
          data-mono="true"
          data-align="right"
          className="aiw-input !pl-7"
        />
      </div>
    </div>
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
    <label className="group flex cursor-pointer items-start gap-3">
      <Toggle checked={checked} onChange={onChange} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-[var(--ink-primary)]">{label}</div>
        <div className="mt-0.5 text-micro text-[var(--ink-muted)]">{description}</div>
      </div>
    </label>
  );
}
