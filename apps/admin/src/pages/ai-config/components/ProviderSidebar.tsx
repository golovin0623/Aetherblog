// 左侧供应商侧边栏组件
// ref: §5.1 - AI Service 架构 (LobeChat 风格)

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Settings2,
  X,
} from 'lucide-react';
import type { AiProvider } from '@/services/aiProviderService';
import { groupProvidersByStatus } from '../hooks/useProviders';
import ProviderIcon from './ProviderIcon';

interface ProviderSidebarProps {
  providers: AiProvider[];
  selectedCode: string | null;
  onSelect: (code: string | null) => void;
  onAddProvider: () => void;
  onOpenSort: () => void;
  isLoading?: boolean;
  variant?: 'sidebar' | 'drawer';
  isOpen?: boolean;
  onClose?: () => void;
  className?: string;
}

export default function ProviderSidebar({
  providers,
  selectedCode,
  onSelect,
  onAddProvider,
  onOpenSort,
  isLoading,
  variant = 'sidebar',
  isOpen = false,
  onClose = () => undefined,
  className = '',
}: ProviderSidebarProps) {
  const [search, setSearch] = useState('');
  const [enabledExpanded, setEnabledExpanded] = useState(true);
  const [disabledExpanded, setDisabledExpanded] = useState(true);

  // 按启用状态分组
  const { enabled, disabled } = useMemo(
    () => groupProvidersByStatus(providers),
    [providers]
  );

  // 搜索过滤
  const filteredProviders = useMemo(() => {
    if (!search) return { enabled, disabled };
    const searchLower = search.toLowerCase();
    return {
      enabled: enabled.filter(
        (p) =>
          p.name.toLowerCase().includes(searchLower) ||
          p.code.toLowerCase().includes(searchLower) ||
          (p.display_name && p.display_name.toLowerCase().includes(searchLower))
      ),
      disabled: disabled.filter(
        (p) =>
          p.name.toLowerCase().includes(searchLower) ||
          p.code.toLowerCase().includes(searchLower) ||
          (p.display_name && p.display_name.toLowerCase().includes(searchLower))
      ),
    };
  }, [enabled, disabled, search]);

  const panel = (
    <div className={`h-full flex flex-col ${className}`}>
      {variant === 'drawer' && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
          <div className="text-sm font-semibold text-[var(--text-primary)]">服务商列表</div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 头部：搜索 + 操作按钮 */}
      <div className="p-3 space-y-2">
        {/* 搜索框 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            name="provider-search"
            id="provider-search"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索服务商..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40 transition-all"
          />
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2">
          <button
            onClick={onAddProvider}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            添加
          </button>
          <button
            onClick={onOpenSort}
            className="flex items-center justify-center px-3 py-2 rounded-xl border border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-all"
            title="自定义排序"
          >
            <GripVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 供应商列表 */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">
            加载中...
          </div>
        ) : (
          <>
            {/* 全部按钮 */}
            <button
              onClick={() => onSelect(null)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                selectedCode === null
                  ? 'bg-primary/15 text-primary font-medium'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
              }`}
            >
              <Settings2 className="w-4 h-4" />
              全部
              <span className="ml-auto text-xs text-[var(--text-muted)]">
                {providers.length}
              </span>
            </button>

            {/* 已启用分组 */}
            <ProviderGroup
              title="已启用"
              count={filteredProviders.enabled.length}
              expanded={enabledExpanded}
              onToggle={() => setEnabledExpanded(!enabledExpanded)}
            >
              {filteredProviders.enabled.map((provider) => (
                <ProviderItem
                  key={provider.id}
                  provider={provider}
                  selected={selectedCode === provider.code}
                  onClick={() => onSelect(provider.code)}
                />
              ))}
            </ProviderGroup>

            {/* 未启用分组 */}
            <ProviderGroup
              title="未启用"
              count={filteredProviders.disabled.length}
              expanded={disabledExpanded}
              onToggle={() => setDisabledExpanded(!disabledExpanded)}
            >
              {filteredProviders.disabled.map((provider) => (
                <ProviderItem
                  key={provider.id}
                  provider={provider}
                  selected={selectedCode === provider.code}
                  onClick={() => onSelect(provider.code)}
                />
              ))}
            </ProviderGroup>
          </>
        )}
      </div>
    </div>
  );

  if (variant === 'drawer') {
    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="fixed inset-0 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/40" onClick={onClose} />
            <motion.div
              initial={{ x: -260, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -260, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute left-0 top-0 h-full w-[85%] max-w-sm border-r border-[var(--border-default)] bg-[var(--bg-secondary)] shadow-2xl"
            >
              {panel}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <div className={`w-72 h-full flex flex-col border-r border-[var(--border-default)] bg-[var(--bg-secondary)] ${className}`}>
      {panel}
    </div>
  );
}

// 分组组件
function ProviderGroup({
  title,
  count,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" />
        )}
        <span className="font-medium">{title}</span>
        <span className="ml-auto opacity-60">{count}</span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="py-1 space-y-0.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// 供应商项
function ProviderItem({
  provider,
  selected,
  onClick,
}: {
  provider: AiProvider;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all group ${
        selected
          ? 'bg-primary/15 text-primary font-medium'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
      }`}
    >
      <ProviderIcon code={provider.code} size={18} />
      <span className="truncate">{provider.display_name || provider.name}</span>
      {!provider.is_enabled && (
        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-card)] text-[var(--text-muted)]">
          禁用
        </span>
      )}
    </button>
  );
}
