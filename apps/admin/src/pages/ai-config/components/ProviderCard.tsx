// 供应商卡片组件 —— 品牌光晕 + Codex 排印
// ref: §5.1 - AI Service 架构 · 模型中心
// 设计: 底衬/边框由 index.css .ai-provider-card 提供;品牌色仅作为数据驱动的光晕点缀

import { motion } from 'framer-motion';
import { Power } from 'lucide-react';
import { Toggle, spring, transition, variants } from '@aetherblog/ui';
import type { AiProvider } from '@/services/aiProviderService';
import { getPresetProvider } from '../types';
import ProviderIcon from './ProviderIcon';
import { getProviderBrand } from '../utils/brandColors';

interface ProviderCardProps {
  provider: AiProvider;
  onToggle: (enabled: boolean) => void;
  onClick: () => void;
  isToggling?: boolean;
}

export default function ProviderCard({
  provider,
  onToggle,
  onClick,
  isToggling,
}: ProviderCardProps) {
  const preset = getPresetProvider(provider.code);
  const capabilityDescription =
    typeof (provider.capabilities as Record<string, unknown> | null)?.description === 'string'
      ? ((provider.capabilities as Record<string, unknown>).description as string)
      : undefined;
  const description = capabilityDescription || preset?.description || `${provider.api_type} API`;

  const brand = getProviderBrand(provider.code);

  return (
    <motion.div
      variants={variants.fadeUp}
      initial="initial"
      animate="animate"
      exit="exit"
      whileHover={{ y: -4 }}
      transition={spring.soft}
      className="ai-provider-card group relative cursor-pointer overflow-hidden rounded-2xl border p-5"
      style={
        provider.is_enabled
          ? {
            boxShadow: `0 16px 36px -28px ${brand.primary}80, inset 0 1px 0 rgb(from var(--bg-raised) r g b / 0.42)`,
            borderColor: 'var(--intelligence-border-strong)',
            transform: 'translateZ(0)',
            willChange: 'transform',
            WebkitBackfaceVisibility: 'hidden',
          }
          : {
            transform: 'translateZ(0)',
            willChange: 'transform',
            WebkitBackfaceVisibility: 'hidden',
          }
      }
      onClick={onClick}
    >
      {/* 启用状态背景光晕 - 品牌色透出 */}
      {provider.is_enabled && (
        <>
          <div
            className="pointer-events-none absolute -inset-[10%] opacity-[0.08] blur-3xl transition-opacity duration-quick ease-aether group-hover:opacity-[0.12]"
            style={{
              background: `radial-gradient(circle at 20% 20%, ${brand.gradientFrom}, transparent 70%), radial-gradient(circle at 80% 80%, ${brand.gradientTo}, transparent 70%)`
            }}
          />
          <div className="pointer-events-none absolute -inset-[1px] z-10 overflow-hidden rounded-[inherit]">
            {/* 特色光带：顶部品牌色细线 */}
            <div
              className="absolute inset-x-0 top-0 h-[2px]"
              style={{
                background: `linear-gradient(to right, transparent, ${brand.primary}, transparent)`,
                opacity: 0.8,
              }}
            />
          </div>
        </>
      )}

      <div className={`relative z-10 mb-4 flex items-start justify-between ${!provider.is_enabled ? 'opacity-60 grayscale' : ''}`}>
        {/* 图标和名称 */}
        <div className="flex min-w-0 items-center gap-4">
          <div
            className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl transition-transform duration-quick ease-aether group-hover:scale-110 ${
              provider.is_enabled
                ? 'bg-[var(--bg-raised)] text-[var(--ink-primary)]'
                : 'bg-[var(--intelligence-control)] text-[var(--ink-muted)]'
            }`}
            style={provider.is_enabled ? {
              boxShadow: `0 4px 20px -4px ${brand.primary}40`,
            } : undefined}
          >
            <ProviderIcon
              code={provider.code}
              icon={provider.icon}
              size={28}
              colorful={provider.is_enabled}
              className={provider.is_enabled ? "drop-shadow-sm" : ""}
            />
          </div>
          <div className="min-w-0 pr-8">
            <h3 className="truncate text-base font-bold tracking-tight text-[var(--ink-primary)]">
              {provider.display_name || provider.name}
            </h3>
            <p className="truncate font-mono text-micro uppercase tracking-wider text-[var(--ink-muted)]">
              {provider.code}
            </p>
          </div>
        </div>

        {/* 状态指示器 - 右上角 */}
        <div className="absolute right-0 top-0 flex h-12 items-center">
          <div
            className={`h-2 w-2 rounded-full transition-all duration-flow ease-aether ${provider.is_enabled ? 'scale-125' : 'scale-100 opacity-30'}`}
            style={
              provider.is_enabled
                ? {
                    backgroundColor: 'var(--signal-success)',
                    boxShadow: '0 0 12px color-mix(in oklch, var(--signal-success) 60%, transparent)',
                  }
                : { backgroundColor: 'var(--ink-muted)' }
            }
          />
        </div>
      </div>

      {/* 描述 - 严格两行截断 */}
      <p className="relative z-10 line-clamp-2 h-[2.5rem] overflow-hidden text-caption leading-relaxed text-[var(--ink-secondary)] transition-colors duration-quick ease-aether group-hover:text-[var(--ink-primary)]">
        {description}
      </p>

      {/* 底部信息 */}
      <div className="relative z-10 mt-5 flex items-center justify-between border-t border-[var(--intelligence-border)] pt-4">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="aiw-signal-badge" data-tone="neutral">
            {provider.api_type === 'OPENAI_COMPAT' ? 'OpenAI' : (provider.api_type === 'ANTHROPIC' ? 'Anthropic' : provider.api_type)}
          </span>
          {provider.priority > 0 && provider.priority < 100 && (
            <span className="aiw-signal-badge" data-tone="neutral">
              Priority {provider.priority}
            </span>
          )}
        </div>
      </div>

      {/* 启用开关 */}
      <div className="ai-provider-card-toggle relative z-10 flex justify-end" onClick={(e) => e.stopPropagation()}>
        <Toggle
          checked={provider.is_enabled}
          onChange={(en) => onToggle(en)}
          disabled={isToggling}
        />
      </div>

      {/* Hover 效果 - 未启用时的极光描边提示 */}
      {!provider.is_enabled && (
        <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-transparent transition-colors duration-quick ease-aether group-hover:border-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)]" />
      )}
    </motion.div>
  );
}

// 卡片网格容器
interface ProviderGridProps {
  title: string;
  count: number;
  children: React.ReactNode;
  className?: string;
  tone?: 'primary' | 'secondary';
}

export function ProviderGrid({
  title,
  count,
  children,
  className = '',
  tone = 'primary',
}: ProviderGridProps) {
  return (
    <div className={`ai-provider-grid-section ${className}`}>
      <div className="ai-provider-grid-heading flex items-center gap-2 mb-4" data-tone={tone}>
        <h2 className="text-sm">{title}</h2>
        <span>{count}</span>
      </div>
      <div className="ai-provider-grid grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {children}
      </div>
    </div>
  );
}

// 空状态
export function EmptyProviderState({ onAdd }: { onAdd: () => void }) {
  return (
    <motion.div
      variants={variants.fadeUp}
      initial="initial"
      animate="animate"
      transition={transition.flow}
      className="aiw-empty"
    >
      <div className="aiw-empty-icon">
        <Power />
      </div>
      <h3 className="aiw-empty-title">暂无服务商</h3>
      <p className="aiw-empty-hint">
        接入 OpenAI、Anthropic、Google 等 AI 服务商，即可为写作、搜索与对话提供模型算力。
      </p>
      <button onClick={onAdd} className="aiw-button-primary mt-3">
        添加服务商
      </button>
    </motion.div>
  );
}
