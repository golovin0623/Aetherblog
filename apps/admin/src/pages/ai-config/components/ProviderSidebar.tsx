// 左侧供应商侧边栏组件
// ref: §5.1 - AI Service 架构 (LobeChat 风格)

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  Archive,
  ArrowUpDown,
  X,
} from 'lucide-react';
import type { AiProvider } from '@/services/aiProviderService';
import { Tooltip } from '@aetherblog/ui';
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
    <div className={`h-full min-w-0 flex flex-col overflow-x-hidden ${className}`}>
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

      {/* 头部：搜索 + 新增按钮 */}
      <div className="p-3 border-b border-[var(--border-default)]">
        {/* 隐藏的输入框用于阻止浏览器自动填充 (Autofill Trap) */}
        <div className="hidden" aria-hidden="true">
          <input type="text" name="fake-username-trap" autoComplete="username" tabIndex={-1} />
          <input type="password" name="fake-password-trap" autoComplete="current-password" tabIndex={-1} />
        </div>

        {/* 搜索 + 新增 */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <input
              type="search"
              name="ai-provider-search-random-id"
              id="ai-provider-listing-search"
              autoComplete="new-password"
              data-form-type="other"
              data-lpignore="true"
              role="searchbox"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索服务商..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40 transition-all"
            />
          </div>
          <motion.button
            onClick={onAddProvider}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.9 }}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-black dark:bg-white text-white dark:text-black hover:opacity-90 transition-all shadow-sm"
            title="添加服务商"
          >
            <Plus className="w-4 h-4" />
          </motion.button>
        </div>
      </div>

      {/* 供应商列表 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 pr-1 scrollbar-thin scrollbar-thumb-[var(--border-subtle)] scrollbar-track-transparent">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">
            加载中...
          </div>
        ) : (
          <>
            {/* 全部按钮 */}
            <motion.button
              onClick={() => onSelect(null)}
              whileTap={{ scale: 0.97 }}
              className={`w-full min-h-[40px] flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm transition-all ${
                selectedCode === null
                  ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] font-medium'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
              }`}
            >
              <Archive className="w-4 h-4" />
              全部
            </motion.button>

            {/* 已启用分组 */}
            <ProviderGroup
              title="已启用"
              expanded={enabledExpanded}
              onToggle={() => setEnabledExpanded(!enabledExpanded)}
              action={
                <Tooltip content="自定义排序" position="top" delay={0}>
                  <motion.button
                    onClick={onOpenSort}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    className="flex items-center justify-center w-7 h-7 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-all"
                    aria-label="自定义排序"
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                  </motion.button>
                </Tooltip>
              }
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
            className="absolute inset-0 z-50 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Local Backdrop */}
            <div 
              className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-[2px]" 
              onClick={onClose} 
            />
            
            <motion.div
              initial={{ x: '-100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '-100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute left-0 top-0 h-full w-[280px] border-r border-[var(--border-default)] bg-[var(--bg-secondary)] shadow-2xl flex flex-col overflow-hidden"
            >
              {panel}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <div className={`w-72 h-full flex flex-col border-r border-[var(--border-default)] bg-[var(--bg-secondary)] overflow-hidden ${className}`}>
      {panel}
    </div>
  );
}

// 分组组件
function ProviderGroup({
  title,
  expanded,
  onToggle,
  action,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-card-hover)] text-xs text-[var(--text-muted)] min-h-[36px]">
        <motion.button
          onClick={onToggle}
          whileTap={{ scale: 0.95 }}
          className="flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          <span className="font-medium">{title}</span>
        </motion.button>
        <div className="ml-auto flex items-center">{action}</div>
      </div>
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
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      className={`relative w-full min-w-0 min-h-[40px] flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm transition-all group ${
        selected
          ? 'bg-white dark:bg-zinc-800 shadow-sm text-[var(--text-primary)] font-bold'
          : 'text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
      }`}
    >
      <ProviderIcon code={provider.code} size={20} />
      <span className="truncate min-w-0">{provider.display_name || provider.name}</span>
      
      {/* 启用状态指示点 (仅已启用显示) */}
      {provider.is_enabled && (
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
      )}
    </motion.button>
  );
}
