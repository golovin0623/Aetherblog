import { useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AdminModuleHeaderTab<T extends string> {
  key: T;
  label: string;
  shortLabel?: string;
  description: string;
  icon: LucideIcon;
}

interface AdminModuleHeaderProps<T extends string> {
  title: string;
  description: string;
  tabs?: Array<AdminModuleHeaderTab<T>>;
  activeKey?: T;
  onTabChange?: (key: T) => void;
  icon?: LucideIcon;
  currentLabel?: string;
  activeSummary?: string;
  showCurrentLabel?: boolean;
  showActiveSummary?: boolean;
  tabPanelIdPrefix?: string;
  actions?: ReactNode;
  className?: string;
}

export function AdminModuleHeader<T extends string>({
  title,
  description,
  tabs,
  activeKey,
  onTabChange,
  icon: HeaderIconProp,
  currentLabel,
  activeSummary,
  showCurrentLabel = true,
  showActiveSummary = true,
  tabPanelIdPrefix,
  actions,
  className,
}: AdminModuleHeaderProps<T>) {
  const safeTabs = tabs ?? [];
  const hasTabs = safeTabs.length > 0 && activeKey !== undefined && onTabChange !== undefined;
  const hasSemanticTabPanels = hasTabs && Boolean(tabPanelIdPrefix);
  const activeTab = hasTabs ? safeTabs.find((item) => item.key === activeKey) ?? safeTabs[0] : undefined;
  const HeaderIcon = activeTab?.icon ?? HeaderIconProp;
  const currentText = showCurrentLabel ? (activeTab ? `当前：${activeTab.label}` : currentLabel) : undefined;
  const summaryText = showActiveSummary ? (activeTab?.description ?? activeSummary) : undefined;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % safeTabs.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + safeTabs.length) % safeTabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = safeTabs.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <header
      className={cn('admin-module-header', className)}
      data-has-tabs={hasTabs}
      data-has-actions={Boolean(actions)}
    >
      <div className="admin-module-header-inner">
        <div className="admin-module-header-copy">
          {HeaderIcon && (
            <div className="admin-module-header-icon" aria-hidden="true">
              <HeaderIcon className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="admin-module-title">{title}</h1>
              {currentText && <span className="admin-module-current">{currentText}</span>}
            </div>
            <p className="admin-module-description">{description}</p>
            {summaryText && <p className="admin-module-active-summary">{summaryText}</p>}
          </div>
        </div>

        {(actions || hasTabs) && (
          <div className="admin-module-side">
            {actions && <div className="admin-module-actions">{actions}</div>}
            {hasTabs && (
              <nav className="admin-module-tabs" aria-label={`${title}视图`} role={hasSemanticTabPanels ? 'tablist' : undefined}>
                {safeTabs.map((item, index) => {
                  const Icon = item.icon;
                  const active = item.key === activeKey;
                  return (
                    <button
                      key={item.key}
                      ref={(node) => { tabRefs.current[index] = node; }}
                      type="button"
                      role={hasSemanticTabPanels ? 'tab' : undefined}
                      onClick={() => onTabChange?.(item.key)}
                      onKeyDown={hasSemanticTabPanels ? (event) => handleTabKeyDown(event, index) : undefined}
                      id={hasSemanticTabPanels ? `${tabPanelIdPrefix}-tab-${item.key}` : undefined}
                      aria-controls={hasSemanticTabPanels ? `${tabPanelIdPrefix}-panel-${item.key}` : undefined}
                      aria-selected={hasSemanticTabPanels ? active : undefined}
                      tabIndex={hasSemanticTabPanels ? (active ? 0 : -1) : undefined}
                      data-active={active}
                      className={cn(
                        'admin-module-tab-button',
                        active
                          ? 'text-[var(--bg-void)]'
                          : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--ink-primary)]'
                      )}
                    >
                      {active && <span className="admin-module-tab-indicator" />}
                      <Icon className="relative z-10 h-4 w-4" />
                      <span className="relative z-10 sm:hidden">{item.shortLabel || item.label}</span>
                      <span className="relative z-10 hidden sm:inline">{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
