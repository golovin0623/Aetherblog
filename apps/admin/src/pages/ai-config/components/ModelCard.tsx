// 模型卡片组件 —— 模型工作台的最小信息单元
// ref: §5.1 - AI Service 架构
// 设计: .claude/design-system/ · 排印 mono+tnum · hover 左侧极光轨(见 index.css .ai-model-card)

import { useState, type ComponentType } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Copy,
  Settings,
  Eye,
  Brain,
  Globe,
  Image,
  Video,
  Wand2,
  Paperclip,
  Braces,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { Toggle, spring, transition, variants } from '@aetherblog/ui';
import type { AiModel } from '@/services/aiProviderService';
import { useToggleModel } from '../hooks/useModels';
import {
  getModelExtra,
  resolveModelAbilities,
  resolveModelContextWindow,
  resolveModelMaxOutputTokens,
  resolveModelPricing,
  resolveModelSource,
} from '../utils/modelCapabilities';

interface ModelCardProps {
  model: AiModel;
  onEdit: () => void;
  readOnly?: boolean;
}

// 能力徽章的视觉语义(data-kind → aurora / signal 着色,见 index.css .aiw-ability)
const ABILITY_BADGES: Array<{
  key: 'functionCall' | 'vision' | 'reasoning' | 'search' | 'imageOutput' | 'video' | 'files' | 'structuredOutput';
  label: string;
  kind?: 'tools' | 'vision' | 'reasoning' | 'search' | 'image';
  icon: ComponentType<{ className?: string }>;
}> = [
  { key: 'functionCall', label: '工具', kind: 'tools', icon: Wand2 },
  { key: 'vision', label: '视觉', kind: 'vision', icon: Eye },
  { key: 'reasoning', label: '推理', kind: 'reasoning', icon: Brain },
  { key: 'search', label: '搜索', kind: 'search', icon: Globe },
  { key: 'imageOutput', label: '绘画', kind: 'image', icon: Image },
  { key: 'video', label: '视频', icon: Video },
  { key: 'files', label: '文件', icon: Paperclip },
  { key: 'structuredOutput', label: '结构化', icon: Braces },
];

export default function ModelCard({ model, onEdit, readOnly = false }: ModelCardProps) {
  const [copied, setCopied] = useState(false);
  const toggleMutation = useToggleModel();

  const handleToggle = () => {
    if (readOnly) return;
    toggleMutation.mutate({ id: model.id, enabled: !model.is_enabled });
  };

  const abilities = resolveModelAbilities(model);
  const pricing = resolveModelPricing(model);
  const extra = getModelExtra(model);
  const source = resolveModelSource(model);
  const contextWindow = resolveModelContextWindow(model);
  const maxOutputTokens = resolveModelMaxOutputTokens(model);

  const releaseAt = extra.released_at ? String(extra.released_at) : null;
  const description = typeof extra.description === 'string' ? extra.description : null;
  const legacy = extra.legacy as boolean | undefined;
  const isNew = isRecentRelease(releaseAt);

  const pricePairs = resolvePricePairs(pricing, model);

  const copyModelId = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await navigator.clipboard.writeText(model.model_id);
      setCopied(true);
      toast.success(`模型 ID 已复制: ${model.model_id}`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('复制失败');
    }
  };

  return (
    <motion.div
      variants={variants.fadeUp}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={transition.quick}
      data-enabled={model.is_enabled ? 'true' : 'false'}
      className="ai-model-card group flex items-start gap-3 rounded-xl border px-3.5 py-3 overflow-hidden"
    >
      {/* 状态点 */}
      <span
        aria-hidden="true"
        className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full transition-colors duration-quick ease-aether"
        style={
          model.is_enabled
            ? {
                background: 'var(--signal-success)',
                boxShadow: '0 0 8px color-mix(in oklch, var(--signal-success) 55%, transparent)',
              }
            : { background: 'var(--ink-subtle)' }
        }
      />

      {/* 信息区 */}
      <motion.div
        className="min-w-0 flex-1 cursor-pointer lg:cursor-default"
        whileTap={window.innerWidth < 1024 ? { scale: 0.98 } : {}}
        transition={spring.precise}
        onClick={(e) => {
          if (window.innerWidth < 1024) copyModelId(e);
        }}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span
              className="truncate text-sm font-semibold text-[var(--ink-primary)]"
              title={description || model.display_name || model.model_id}
            >
              {model.display_name || model.model_id}
            </span>
            {isNew && (
              <motion.span
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={spring.bouncy}
                className="aiw-signal-badge shrink-0"
                data-tone="accent"
                title={releaseAt ? `发布于 ${releaseAt}` : '近期发布'}
              >
                NEW
              </motion.span>
            )}
            {legacy && (
              <span className="aiw-signal-badge shrink-0" data-tone="warn" title="已标记为旧版模型">
                Legacy
              </span>
            )}
            {source && (
              <span className="aiw-signal-badge shrink-0" data-tone="neutral">
                {source === 'remote' ? '远程' : source === 'custom' ? '自定义' : '内置'}
              </span>
            )}
          </div>

          {/* 模型 ID(mono),复制反馈原位切换 */}
          <div className="flex h-4 items-center gap-1.5">
            <AnimatePresence mode="wait" initial={false}>
              {copied ? (
                <motion.span
                  key="check"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  transition={spring.precise}
                  className="flex items-center gap-1 text-micro font-mono text-[var(--signal-success)]"
                >
                  <Check className="h-3 w-3" />
                  已复制 ID
                </motion.span>
              ) : (
                <motion.span
                  key="id"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={transition.quick}
                  className="truncate font-mono text-micro text-[var(--ink-muted)]"
                >
                  {model.model_id}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* 规格行:上下文 / 输出 / 发布时间 —— mono + tnum */}
        {(contextWindow || maxOutputTokens || releaseAt) && (
          <div className="aiw-model-meta mt-1.5">
            {contextWindow && (
              <span title="最大上下文窗口">
                CTX <b>{formatContextWindow(contextWindow)}</b>
              </span>
            )}
            {maxOutputTokens && (
              <span title="最大输出 Tokens">
                OUT <b>{formatContextWindow(maxOutputTokens)}</b>
              </span>
            )}
            {releaseAt && <span title="发布时间">{releaseAt}</span>}
          </div>
        )}

        {/* 价格行:mono + tnum,与全局价格页同一套排印 */}
        {pricePairs.length > 0 && (
          <div className="aiw-price mt-1">
            {pricePairs.map((pair) => (
              <span key={pair.label} className="aiw-price-pair" title={pair.title}>
                <span>{pair.label}</span>
                <b>{pair.value}</b>
              </span>
            ))}
          </div>
        )}

        {description && (
          <div className="mt-1.5 line-clamp-1 text-micro text-[var(--ink-muted)]">
            {description}
          </div>
        )}

        {/* 能力徽章 */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {ABILITY_BADGES.filter(({ key }) => abilities[key]).map(({ key, label, kind, icon: Icon }) => (
            <span key={key} className="aiw-ability" data-kind={kind} title={label}>
              <Icon />
              {label}
            </span>
          ))}
        </div>
      </motion.div>

      {/* 操作 */}
      <div className="flex flex-shrink-0 items-center gap-1.5">
        <button
          onClick={copyModelId}
          className="hidden rounded-lg p-1.5 text-[var(--ink-muted)] opacity-0 transition-all duration-quick ease-aether hover:bg-[var(--intelligence-control-hover)] hover:text-[var(--ink-primary)] focus-visible:opacity-100 group-hover:opacity-100 lg:flex"
          title="复制模型 ID"
        >
          <Copy className="h-4 w-4" />
        </button>
        <button
          onClick={onEdit}
          disabled={readOnly}
          className={`rounded-lg p-1.5 text-[var(--ink-muted)] transition-all duration-quick ease-aether hover:text-[var(--ink-primary)] ${
            readOnly ? 'cursor-not-allowed opacity-50' : 'hover:bg-[var(--intelligence-control-hover)]'
          }`}
          title="配置模型"
        >
          <Settings className="h-4 w-4" />
        </button>
        <Toggle
          checked={model.is_enabled}
          onChange={() => handleToggle()}
          disabled={toggleMutation.isPending || readOnly}
          size="sm"
        />
      </div>
    </motion.div>
  );
}

interface PricePair {
  label: string;
  value: string;
  title: string;
}

// 归一化三档单价 → [入/出/缓存] 展示对;capabilities.pricing 优先,列回退到平铺字段
function resolvePricePairs(pricing: Record<string, unknown>, model: AiModel): PricePair[] {
  const currency = (pricing?.currency as string) || 'USD';
  const symbol = currency === 'CNY' ? '¥' : '$';

  const input =
    typeof pricing?.input === 'number' ? (pricing.input as number) : model.input_cost_per_1m ?? null;
  const output =
    typeof pricing?.output === 'number' ? (pricing.output as number) : model.output_cost_per_1m ?? null;
  const cachedInput =
    typeof pricing?.cachedInput === 'number'
      ? (pricing.cachedInput as number)
      : model.cached_input_cost_per_1m ?? null;

  const pairs: PricePair[] = [];
  if (input != null) {
    pairs.push({ label: '入', value: `${symbol}${formatCost(input)}`, title: `输入 ${symbol}${formatCost(input)} / 1M Tokens` });
  }
  if (output != null) {
    pairs.push({ label: '出', value: `${symbol}${formatCost(output)}`, title: `输出 ${symbol}${formatCost(output)} / 1M Tokens` });
  }
  if (cachedInput != null) {
    pairs.push({ label: '缓存', value: `${symbol}${formatCost(cachedInput)}`, title: `缓存读取 ${symbol}${formatCost(cachedInput)} / 1M Tokens` });
  }
  return pairs;
}

// 价格数值:≥1 保留两位,<1 保留至多四位有效小数,去掉尾零
function formatCost(value: number): string {
  if (value >= 1) return value.toFixed(2).replace(/\.00$/, '');
  return String(parseFloat(value.toFixed(4)));
}

// 判断模型是否「近期发布」（默认 45 天内）—— 用于 NEW 徽章
function isRecentRelease(releaseAt: string | null, withinDays = 45): boolean {
  if (!releaseAt) return false;
  const ts = Date.parse(releaseAt);
  if (Number.isNaN(ts)) return false;
  const ageDays = (Date.now() - ts) / 86_400_000;
  return ageDays >= 0 && ageDays <= withinDays;
}

// 格式化上下文窗口
function formatContextWindow(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  return String(tokens);
}
