// 模型卡片组件
// ref: §5.1 - AI Service 架构

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

  const priceTags = formatPricing(pricing, model);

  const copyModelId = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await navigator.clipboard.writeText(model.model_id);
      setCopied(true);
      toast.success(`模型 ID 已复制: ${model.model_id}`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
      toast.error('复制失败');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative group flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-all overflow-hidden ${model.is_enabled
        ? 'border-[var(--border-default)]/60 bg-[var(--bg-card)] shadow-sm'
        : 'border-transparent bg-transparent opacity-70 hover:bg-[var(--bg-card-hover)]'
        }`}
      style={{
        transform: 'translateZ(0)',
        WebkitBackfaceVisibility: 'hidden',
      }}
    >
      {/* Top shine effect */}
      {model.is_enabled && (
        <div className="absolute inset-0 rounded-[inherit] pointer-events-none z-10 overflow-hidden">
          <div
            className="absolute inset-0 rounded-[inherit] border-t border-l border-r border-white/30 dark:border-white/10"
            style={{
              maskImage: 'linear-gradient(to bottom, black 0%, black 15%, transparent 60%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 15%, transparent 60%)',
            }}
          />
        </div>
      )}
      {/* 状态点 */}
      <div
        className={`w-2 h-2 rounded-full flex-shrink-0 ${model.is_enabled ? 'bg-emerald-400' : 'bg-[var(--border-default)]'
          }`}
      />

      {/* 信息区 */}
      <motion.div
        className="flex-1 min-w-0 cursor-pointer lg:cursor-default"
        whileTap={window.innerWidth < 1024 ? { scale: 0.98 } : {}}
        onClick={(e) => {
          if (window.innerWidth < 1024) copyModelId(e);
        }}
      >
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="font-bold text-sm text-[var(--text-primary)] truncate"
              title={description || model.display_name || model.model_id}
            >
              {model.display_name || model.model_id}
            </span>
            {source && (
              <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--bg-card)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
                {source === 'remote' ? '远程' : source === 'custom' ? '自定义' : '内置'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 h-4">
            <AnimatePresence mode="wait">
              {copied ? (
                <motion.span
                  key="check"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  className="flex items-center gap-1 text-emerald-500 text-[10px]"
                >
                  <Check className="w-3.5 h-3.5" />
                  已复制 ID
                </motion.span>
              ) : (
                <motion.span
                  key="id"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-[10px] text-[var(--text-muted)] font-mono truncate opacity-60"
                >
                  {model.model_id}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[11px] text-[var(--text-muted)]">
          {contextWindow && <span className="bg-[var(--bg-card)] px-1 rounded">CW {formatContextWindow(contextWindow)}</span>}
          {maxOutputTokens && <span className="bg-[var(--bg-card)] px-1 rounded">Out {formatContextWindow(maxOutputTokens)}</span>}
          {legacy && <span className="text-amber-500 font-medium">Legacy</span>}
          {releaseAt && <span>{releaseAt}</span>}
          {priceTags.map((tag) => (
            <span key={tag} className="opacity-80 ">{tag}</span>
          ))}
        </div>

        {description && (
          <div className="mt-1 text-[11px] text-[var(--text-muted)] line-clamp-1 opacity-70">
            {description}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {abilities.functionCall && <CapabilityBadge icon={Wand2} title="工具" color="text-blue-500 bg-blue-500/10" />}
          {abilities.vision && <CapabilityBadge icon={Eye} title="视觉" color="text-emerald-500 bg-emerald-500/10" />}
          {abilities.reasoning && <CapabilityBadge icon={Brain} title="推理" color="text-purple-500 bg-purple-500/10" />}
          {abilities.imageOutput && <CapabilityBadge icon={Image} title="绘画" color="text-pink-500 bg-pink-500/10" />}
          {abilities.search && <CapabilityBadge icon={Globe} title="搜索" color="text-cyan-500 bg-cyan-500/10" />}
          {abilities.video && <CapabilityBadge icon={Video} title="视频" />}
          {abilities.files && <CapabilityBadge icon={Paperclip} title="文件" />}
          {abilities.structuredOutput && <CapabilityBadge icon={Braces} title="结构化" />}
        </div>
      </motion.div>

      {/* 操作 */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={copyModelId}
          className="hidden lg:flex p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
          title="复制模型 ID"
        >
          <Copy className="w-4 h-4" />
        </button>
        <button
          onClick={onEdit}
          disabled={readOnly}
          className={`p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all ${readOnly ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[var(--bg-card-hover)]'
            }`}
          title="配置模型"
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          onClick={handleToggle}
          disabled={toggleMutation.isPending || readOnly}
          className={`w-10 h-5 rounded-full p-0.5 transition-colors duration-200 ease-out flex-shrink-0 focus:outline-none flex items-center ${model.is_enabled ? 'bg-black dark:bg-white' : 'bg-black/10 dark:bg-zinc-800'
            } ${toggleMutation.isPending || readOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <motion.div
            className={`w-4 h-4 rounded-full shadow-sm z-10 ${model.is_enabled ? 'bg-white dark:bg-black' : 'bg-white'
              }`}
            initial={false}
            animate={{
              x: model.is_enabled ? 20 : 0
            }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
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
// 能力徽章
function CapabilityBadge({
  icon: Icon,
  title,
  color = "text-[var(--text-muted)] bg-[var(--bg-card)]",
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  color?: string;
}) {
  return (
    <div
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border border-transparent ${color}`}
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
