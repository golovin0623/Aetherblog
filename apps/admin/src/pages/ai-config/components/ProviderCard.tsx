// 供应商卡片组件
// ref: §5.1 - AI Service 架构 (LobeChat 风格)

import { motion } from 'framer-motion';
import { Power } from 'lucide-react';
import type { AiProvider } from '@/services/aiProviderService';
import { getPresetProvider } from '../types';
import ProviderIcon from './ProviderIcon';

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className={`group relative rounded-2xl border bg-[var(--bg-card)] backdrop-blur-xl p-4 cursor-pointer transition-all duration-300 ${
        provider.is_enabled
          ? 'border-primary/20 shadow-lg shadow-primary/5'
          : 'border-[var(--border-default)] hover:border-[var(--border-hover)]'
      }`}
      onClick={onClick}
    >
      {/* 启用状态指示条 */}
      {provider.is_enabled && (
        <div className="absolute top-0 left-4 right-4 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />
      )}

      <div className="flex items-start justify-between mb-3">
        {/* 图标和名称 */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--bg-card-hover)] to-[var(--bg-card)] flex items-center justify-center shadow-inner">
            <ProviderIcon code={provider.code} size={24} />
          </div>
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">
              {provider.display_name || provider.name}
            </h3>
            <p className="text-xs text-[var(--text-muted)]">{provider.code}</p>
          </div>
        </div>

        {/* 启用开关 */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(!provider.is_enabled);
          }}
          disabled={isToggling}
          className={`relative w-11 h-6 rounded-full transition-all duration-300 ${
            provider.is_enabled
              ? 'bg-primary shadow-lg shadow-primary/30'
              : 'bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)]'
          } ${isToggling ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={provider.is_enabled ? '点击禁用' : '点击启用'}
        >
          <motion.div
            layout
            className={`absolute top-1 w-4 h-4 rounded-full transition-all ${
              provider.is_enabled
                ? 'left-6 bg-white'
                : 'left-1 bg-[var(--text-muted)]/70'
            }`}
          />
        </button>
      </div>

      {/* 描述 */}
      <p className="text-xs text-[var(--text-muted)] line-clamp-2 min-h-[2.5rem]">
        {description}
      </p>

      {/* 底部信息 */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--border-default)]">
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-card)] text-[var(--text-muted)]">
          {provider.api_type}
        </span>
        {provider.priority > 0 && provider.priority < 100 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-card)] text-[var(--text-muted)]">
            优先级 {provider.priority}
          </span>
        )}
      </div>

      {/* Hover 效果 */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
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
  const toneClass = tone === 'secondary' ? 'text-[var(--color-secondary)]' : 'text-primary';
  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-4">
        <h2 className={`text-sm font-medium ${toneClass}`}>{title}</h2>
        <span className="text-xs text-[var(--text-muted)]">{count}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {children}
      </div>
    </div>
  );
}

// 空状态
export function EmptyProviderState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-[var(--bg-card)] flex items-center justify-center mb-4">
        <Power className="w-8 h-8 text-[var(--text-muted)]" />
      </div>
      <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
        暂无服务商
      </h3>
      <p className="text-sm text-[var(--text-muted)] mb-6 max-w-sm">
        添加 AI 服务商以开始使用智能功能
      </p>
      <button
        onClick={onAdd}
        className="px-4 py-2 rounded-xl bg-primary text-white font-medium hover:bg-primary/90 transition-colors"
      >
        添加服务商
      </button>
    </div>
  );
}
