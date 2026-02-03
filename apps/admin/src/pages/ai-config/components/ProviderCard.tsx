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
      className={`group relative rounded-2xl border p-5 cursor-pointer transition-all duration-300 overflow-hidden ${
        provider.is_enabled
          ? 'bg-white/70 dark:bg-zinc-900/40 border-white/40 dark:border-white/5 backdrop-blur-xl shadow-2xl z-10'
          : 'bg-white/30 dark:bg-zinc-950/20 border-white/20 dark:border-white/5 backdrop-blur-sm opacity-80 hover:opacity-100 hover:bg-white/50 dark:hover:bg-zinc-900/40 hover:border-white/40'
      }`}
      style={
        provider.is_enabled
          ? {
              boxShadow: `0 10px 40px -10px ${brand.primary}40, 0 0 1px 1px ${brand.primary}10`, 
            }
          : undefined
      }
      onClick={onClick}
    >
      {/* 启用状态背景光晕 - 增强透明感 */}
      {provider.is_enabled && (
        <>
          <div 
            className="absolute -inset-[10%] opacity-[0.08] pointer-events-none blur-3xl transition-opacity group-hover:opacity-[0.12]"
            style={{
              background: `radial-gradient(circle at 20% 20%, ${brand.gradientFrom}, transparent 70%), radial-gradient(circle at 80% 80%, ${brand.gradientTo}, transparent 70%)`
            }}
          />
          <div className="absolute -inset-[1px] rounded-[inherit] pointer-events-none z-10 overflow-hidden">
            {/* 特色光带：延展到侧边 2/5 位置 - 增强厚度与贴合度 */}
            <div
              className="absolute inset-0 rounded-[inherit] border-t-2 border-l-2 border-r-2"
              style={{
                borderColor: brand.primary,
                opacity: 0.8,
                maskImage: 'linear-gradient(to bottom, black 0%, black 15%, transparent 40%)',
                WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 15%, transparent 40%)',
              }}
            />
          </div>
        </>
      )}

      <div className="relative z-10 flex items-start justify-between mb-4">
        {/* 图标和名称 */}
        <div className="flex items-center gap-4">
          <div 
            className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-lg transition-transform duration-500 group-hover:scale-110 ${
              provider.is_enabled ? 'text-white' : 'bg-[var(--bg-card-hover)] text-[var(--text-muted)]'
            }`}
            style={provider.is_enabled ? {
              background: `linear-gradient(135deg, ${brand.gradientFrom}, ${brand.gradientTo})`,
              boxShadow: `0 4px 15px -4px ${brand.primary}80`,
              color: '#ffffff' 
            } : undefined}
          >
            <ProviderIcon code={provider.code} size={28} className={provider.is_enabled ? "text-white drop-shadow-md" : ""} />
          </div>
          <div className="min-w-0">
            <h3 className="font-extrabold text-[var(--text-primary)] text-base tracking-tight truncate dark:text-zinc-100">
              {provider.display_name || provider.name}
            </h3>
            <p className="text-[10px] font-mono text-[var(--text-muted)] font-bold opacity-60 tracking-wider uppercase">{provider.code}</p>
          </div>
        </div>

        {/* 启用开关 - 极简高对比 */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(!provider.is_enabled);
          }}
          disabled={isToggling}
          className={`w-12 h-6 rounded-full p-1 transition-all duration-300 ease-in-out focus:outline-none shadow-inner border border-transparent ${
            isToggling ? 'opacity-50 cursor-not-allowed' : ''
          } ${provider.is_enabled ? 'bg-zinc-900 dark:bg-white' : 'bg-black/10 dark:bg-white/5 border-black/5 dark:border-white/5'}`}
        >
          <motion.div
            layout
            className={`w-4 h-4 rounded-full shadow-lg z-10 ${
                provider.is_enabled ? 'bg-white dark:bg-zinc-900' : 'bg-white/90'
            }`}
             initial={false}
             animate={{ 
               x: provider.is_enabled ? 24 : 0
             }}
             transition={{ type: "spring", stiffness: 400, damping: 25 }}
          />
        </button>
      </div>

      {/* 描述 - 提升可读性 - 严格截断 */}
      <p className="relative z-10 text-[13px] text-[var(--text-primary)] dark:text-zinc-300 opacity-80 group-hover:opacity-100 transition-opacity line-clamp-2 h-[2.5rem] overflow-hidden leading-relaxed font-medium">
        {description}
      </p>

      {/* 底部信息 - 更加微妙但清晰 */}
      <div className="relative z-10 flex items-center justify-between mt-5 pt-4 border-t border-[var(--border-default)]/20 dark:border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2.5 py-1 rounded-lg bg-black/5 dark:bg-white/5 text-[var(--text-secondary)] font-bold tracking-wide uppercase">
            {provider.api_type}
          </span>
          {provider.priority > 0 && provider.priority < 100 && (
            <span className="text-[10px] px-2.5 py-1 rounded-lg bg-black/5 dark:bg-white/5 text-[var(--text-secondary)] font-bold tracking-wide uppercase">
              PRIORITY {provider.priority}
            </span>
          )}
        </div>
        
        {/* 指示器 */}
        <div className={`w-1.5 h-1.5 rounded-full transition-all duration-500 ${provider.is_enabled ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.8)] scale-125' : 'bg-zinc-400 opacity-30 shadow-none scale-100'}`} />
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
