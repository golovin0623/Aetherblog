// 供应商卡片组件
// ref: §5.1 - AI Service 架构 (LobeChat 风格)

import { motion } from 'framer-motion';
import { Power } from 'lucide-react';
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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      className={`group relative rounded-2xl border p-4 cursor-pointer transition-all duration-300 overflow-hidden ${
        provider.is_enabled
          ? 'bg-[var(--bg-card)] border-transparent shadow-xl'
          : 'bg-[var(--bg-card)]/50 border-[var(--border-default)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-card)] shadow-sm'
      }`}
      style={
        provider.is_enabled
          ? {
              boxShadow: `0 8px 30px -12px ${brand.primary}30`, // 30 = 20% opacity using hex
            }
          : undefined
      }
      onClick={onClick}
    >
      {/* 启用状态背景光晕 */}
      {provider.is_enabled && (
        <>
          <div 
            className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{
              background: `linear-gradient(135deg, ${brand.gradientFrom}, ${brand.gradientTo})`
            }}
          />
          <div 
            className="absolute top-0 inset-x-0 h-[3px]"
            style={{
              background: `linear-gradient(90deg, transparent, ${brand.primary}, transparent)`
            }}
          />
        </>
      )}

      <div className="relative z-10 flex items-start justify-between mb-3">
        {/* 图标和名称 */}
        <div className="flex items-center gap-3">
          <div 
            className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-inner transition-colors duration-300 ${
              provider.is_enabled ? 'text-white' : 'bg-[var(--bg-card-hover)] text-[var(--text-muted)]'
            }`}
            style={provider.is_enabled ? {
              background: `linear-gradient(135deg, ${brand.gradientFrom}, ${brand.gradientTo})`,
              color: '#ffffff' 
            } : undefined}
          >
            <ProviderIcon code={provider.code} size={24} className={provider.is_enabled ? "text-white" : ""} />
          </div>
          <div>
            <h3 className="font-bold text-[var(--text-primary)] tracking-tight">
              {provider.display_name || provider.name}
            </h3>
            <p className="text-[11px] font-mono text-[var(--text-muted)] opacity-70">{provider.code}</p>
          </div>
        </div>

        {/* 启用开关 - 增强对比度 */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(!provider.is_enabled);
          }}
          disabled={isToggling}
          className={`w-11 h-6 rounded-full p-0.5 transition-colors duration-200 ease-out focus:outline-none shadow-inner ${
            isToggling ? 'opacity-50 cursor-not-allowed' : ''
          } ${provider.is_enabled ? 'bg-black dark:bg-white' : 'bg-black/10 dark:bg-zinc-800'}`}
        >
          <motion.div
            layout
            className={`w-5 h-5 rounded-full shadow-sm z-10 ${
                provider.is_enabled ? 'bg-white dark:bg-black' : 'bg-white'
            }`}
             initial={false}
             animate={{ 
               x: provider.is_enabled ? 20 : 0
             }}
             transition={{ type: "spring", stiffness: 500, damping: 30 }}
          />
        </button>
      </div>

      {/* 描述 */}
      <p className="relative z-10 text-xs text-[var(--text-muted)] line-clamp-2 min-h-[2.5rem] leading-relaxed">
        {description}
      </p>

      {/* 底部信息 */}
      <div className="relative z-10 flex items-center gap-2 mt-4 pt-3 border-t border-[var(--border-default)]/50">
        <span className="text-[10px] px-2.5 py-1 rounded-md bg-[var(--bg-scale-200)] text-[var(--text-secondary)] font-medium">
          {provider.api_type}
        </span>
        {provider.priority > 0 && provider.priority < 100 && (
          <span className="text-[10px] px-2.5 py-1 rounded-md bg-[var(--bg-scale-200)] text-[var(--text-secondary)] font-medium">
            优先级 {provider.priority}
          </span>
        )}
      </div>

      {/* Hover 效果 - 仅在未启用时显示简单的边框高亮，启用后已有阴影 */}
      {!provider.is_enabled && (
        <div className="absolute inset-0 rounded-2xl border-2 border-primary/0 group-hover:border-primary/10 transition-colors pointer-events-none" />
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
