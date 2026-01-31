// 模型卡片组件
// ref: §5.1 - AI Service 架构

import type { ComponentType } from 'react';
import { motion } from 'framer-motion';
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
} from 'lucide-react';
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
}

export default function ModelCard({ model, onEdit }: ModelCardProps) {
  const toggleMutation = useToggleModel();

  const handleToggle = () => {
    toggleMutation.mutate({ id: model.id, enabled: !model.is_enabled });
  };

  const abilities = resolveModelAbilities(model);
  const pricing = resolveModelPricing(model);
  const extra = getModelExtra(model);
  const source = resolveModelSource(model);
  const contextWindow = resolveModelContextWindow(model);
  const maxOutputTokens = resolveModelMaxOutputTokens(model);

  const releaseAt = extra.released_at ? String(extra.released_at) : null;

  const priceTags = formatPricing(pricing, model);

  const copyModelId = async () => {
    try {
      await navigator.clipboard.writeText(model.model_id);
    } catch {
      // ignore
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-center gap-4 px-4 py-3 rounded-xl border transition-all ${
        model.is_enabled
          ? 'border-white/10 bg-white/5'
          : 'border-white/5 bg-transparent opacity-70'
      }`}
    >
      {/* 状态点 */}
      <div
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          model.is_enabled ? 'bg-emerald-400' : 'bg-white/20'
        }`}
      />

      {/* 信息区 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-[var(--text-primary)] truncate">
            {model.display_name || model.model_id}
          </span>
          <span className="text-xs text-[var(--text-muted)] truncate">{model.model_id}</span>
          {source && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-[var(--text-muted)]">
              {source === 'remote' ? '远程' : source === 'custom' ? '自定义' : '内置'}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-[var(--text-muted)]">
          {contextWindow && <span>{formatContextWindow(contextWindow)}</span>}
          {maxOutputTokens && <span>输出 {formatContextWindow(maxOutputTokens)}</span>}
          {releaseAt && <span>发布 {releaseAt}</span>}
          {priceTags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-2">
          {abilities.functionCall && <CapabilityBadge icon={Wand2} title="函数调用" />}
          {abilities.vision && <CapabilityBadge icon={Eye} title="视觉" />}
          {abilities.reasoning && <CapabilityBadge icon={Brain} title="推理" />}
          {abilities.search && <CapabilityBadge icon={Globe} title="搜索" />}
          {abilities.imageOutput && <CapabilityBadge icon={Image} title="图像" />}
          {abilities.video && <CapabilityBadge icon={Video} title="视频" />}
          {abilities.files && <CapabilityBadge icon={Paperclip} title="文件" />}
          {abilities.structuredOutput && <CapabilityBadge icon={Braces} title="结构化" />}
        </div>
      </div>

      {/* 操作 */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={copyModelId}
          className="p-1.5 rounded-lg hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
          title="复制模型 ID"
        >
          <Copy className="w-4 h-4" />
        </button>
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
          title="配置模型"
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          onClick={handleToggle}
          disabled={toggleMutation.isPending}
          className={`relative w-10 h-5 rounded-full transition-all flex-shrink-0 ${
            model.is_enabled ? 'bg-primary' : 'bg-white/10 hover:bg-white/20'
          } ${toggleMutation.isPending ? 'opacity-50' : ''}`}
        >
          <motion.div
            layout
            className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
              model.is_enabled ? 'left-5 bg-white' : 'left-0.5 bg-white/60'
            }`}
          />
        </button>
      </div>
    </motion.div>
  );
}

function formatPricing(pricing: Record<string, unknown>, model: AiModel): string[] {
  const currency = (pricing?.currency as string) || 'USD';
  const input = pricing?.input as number | undefined;
  const output = pricing?.output as number | undefined;

  const tags: string[] = [];
  if (typeof input === 'number') {
    tags.push(`${currency} ${input}/1K 入`);
  } else if (model.input_cost_per_1k !== null && model.input_cost_per_1k !== undefined) {
    tags.push(`${currency} ${model.input_cost_per_1k}/1K 入`);
  }
  if (typeof output === 'number') {
    tags.push(`${currency} ${output}/1K 出`);
  } else if (model.output_cost_per_1k !== null && model.output_cost_per_1k !== undefined) {
    tags.push(`${currency} ${model.output_cost_per_1k}/1K 出`);
  }

  return tags;
}

// 能力徽章
function CapabilityBadge({
  icon: Icon,
  title,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <div
      className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 text-[var(--text-muted)] text-[11px]"
      title={title}
    >
      <Icon className="w-3 h-3" />
      {title}
    </div>
  );
}

// 格式化上下文窗口
function formatContextWindow(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  return String(tokens);
}
