// 左侧供应商侧边栏组件
// ref: §5.1 - AI Service 架构 · 模型中心
// 设计: 激活项 = 左侧 2px 极光线 + ink-primary(见 index.css .ai-provider-sidebar-item)

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
import { Tooltip, spring, transition } from '@aetherblog/ui';
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

// 侧栏行骨架 —— 列表加载态用骨架而非文本提示
function SidebarItemSkeleton() {
  return (
    <div className="flex min-h-[40px] items-center gap-2 px-3 py-2.5">
      <div className="global-pricing-skeleton-block h-5 w-5 rounded-md" />
      <div className="global-pricing-skeleton-block h-3 w-24 rounded" />
    </div>
  );
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
    const matches = (p: AiProvider) =>
      p.name.toLowerCase().includes(searchLower) ||
      p.code.toLowerCase().includes(searchLower) ||
      (p.display_name && p.display_name.toLowerCase().includes(searchLower));
    return {
      enabled: enabled.filter(matches),
      disabled: disabled.filter(matches),
    };
  }, [enabled, disabled, search]);

  const panel = (
    <div className={`ai-provider-sidebar-panel h-full min-w-0 flex flex-col overflow-x-hidden ${className}`}>
      {variant === 'drawer' && (
        <div className="ai-provider-sidebar-drawer-header flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold text-[var(--ink-primary)]">服务商列表</div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--ink-muted)] transition-colors duration-quick ease-aether hover:bg-[var(--intelligence-control-hover)] hover:text-[var(--ink-primary)]"
            aria-label="关闭服务商列表"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 头部：搜索 + 新增按钮 */}
      <div className="ai-provider-sidebar-tools border-b p-3">
        {/* 隐藏的输入框用于阻止浏览器自动填充 (Autofill Trap) */}
        <div className="hidden" aria-hidden="true">
          <input type="text" name="fake-username-trap" autoComplete="username" tabIndex={-1} />
          <input type="password" name="fake-password-trap" autoComplete="current-password" tabIndex={-1} />
        </div>

        {/* 搜索 + 新增 */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
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
              className="ai-provider-sidebar-search w-full rounded-xl border py-2 pl-9 pr-3 text-sm transition-all duration-quick ease-aether focus:outline-none"
            />
          </div>
          <motion.button
            onClick={onAddProvider}
            whileTap={{ scale: 0.92 }}
            transition={spring.precise}
            className="ai-provider-sidebar-add flex h-9 w-9 items-center justify-center rounded-xl transition-opacity duration-quick ease-aether hover:opacity-90"
            title="添加服务商"
          >
            <Plus className="h-4 w-4" />
          </motion.button>
        </div>
      </div>

      {/* 供应商列表 */}
      <div className="ai-provider-sidebar-list flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 pr-1 scrollbar-thin scrollbar-thumb-[var(--intelligence-border)] scrollbar-track-transparent">
        {isLoading ? (
          <div className="space-y-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <SidebarItemSkeleton key={i} />
            ))}
          </div>
        ) : (
          <>
            {/* 全部按钮 */}
            <motion.button
              onClick={() => onSelect(null)}
              whileTap={{ scale: 0.97 }}
              transition={spring.precise}
              data-active={selectedCode === null ? 'true' : 'false'}
              className="ai-provider-sidebar-item flex min-h-[40px] w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm"
            >
              <Archive className="h-4 w-4" />
              全部
            </motion.button>

            {/* 已启用分组 */}
            <ProviderGroup
              title="已启用"
              count={filteredProviders.enabled.length}
              expanded={enabledExpanded}
              onToggle={() => setEnabledExpanded(!enabledExpanded)}
              action={
                <Tooltip content="自定义排序" position="top" delay={0}>
                  <motion.button
                    onClick={onOpenSort}
                    whileTap={{ scale: 0.9 }}
                    transition={spring.precise}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--intelligence-border)] bg-[var(--intelligence-control)] text-[var(--ink-muted)] transition-colors duration-quick ease-aether hover:bg-[var(--intelligence-control-hover)] hover:text-[var(--ink-primary)]"
                    aria-label="自定义排序"
                  >
                    <ArrowUpDown className="h-3.5 w-3.5" />
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
            className="absolute inset-0 z-50 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition.quick}
          >
            {/* 局部遮罩层 */}
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
              onClick={onClose}
            />

            <motion.div
              initial={{ x: '-100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '-100%', opacity: 0 }}
              transition={spring.soft}
              className="ai-provider-sidebar-drawer absolute left-0 top-0 flex h-full flex-col overflow-hidden border-r"
            >
              {panel}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <div className={`ai-provider-sidebar-shell flex h-full w-72 flex-col overflow-hidden border-r ${className}`}>
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
  action,
  children,
}: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="ai-provider-group mt-3">
      <div className="ai-provider-group-header flex min-h-[36px] items-center gap-2 rounded-xl px-3 py-2">
        <motion.button
          onClick={onToggle}
          whileTap={{ scale: 0.95 }}
          transition={spring.precise}
          className="flex items-center gap-1.5 text-[var(--ink-secondary)] transition-colors duration-quick ease-aether hover:text-[var(--ink-primary)]"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          <span className="font-mono text-micro font-semibold uppercase tracking-[0.16em]">{title}</span>
          <span className="font-mono text-micro text-[var(--ink-muted)]">{count}</span>
        </motion.button>
        <div className="ml-auto flex items-center">{action}</div>
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transition.quick}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 py-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// 供应商项 —— 激活态:左侧极光线(CSS ::before)
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
      transition={spring.precise}
      data-active={selected ? 'true' : 'false'}
      className="ai-provider-sidebar-item group relative flex min-h-[40px] w-full min-w-0 items-center gap-2 rounded-xl px-3 py-2.5 text-sm"
    >
      <ProviderIcon code={provider.code} icon={provider.icon} size={20} />
      <span className="min-w-0 truncate">{provider.display_name || provider.name}</span>

      {/* 启用状态指示点 (仅已启用显示) */}
      {provider.is_enabled && (
        <span
          className="ml-auto h-1.5 w-1.5 rounded-full"
          style={{
            background: 'var(--signal-success)',
            boxShadow: '0 0 8px color-mix(in oklch, var(--signal-success) 40%, transparent)',
          }}
        />
      )}
    </motion.button>
  );
}
