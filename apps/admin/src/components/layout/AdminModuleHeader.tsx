import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
  actions,
  className,
}: AdminModuleHeaderProps<T>) {
  const safeTabs = tabs ?? [];
  const hasTabs = safeTabs.length > 0 && activeKey !== undefined && onTabChange !== undefined;
  const activeTab = hasTabs ? safeTabs.find((item) => item.key === activeKey) ?? safeTabs[0] : undefined;
  const HeaderIcon = activeTab?.icon ?? HeaderIconProp;
  const currentText = activeTab ? `当前：${activeTab.label}` : currentLabel;
  const summaryText = activeTab?.description ?? activeSummary;
  const tabsRef = useRef<HTMLElement | null>(null);
  const buttonRefs = useRef<Map<T, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false });

  useLayoutEffect(() => {
    if (!hasTabs || activeKey === undefined) return;

    const syncIndicator = () => {
      const activeButton = buttonRefs.current.get(activeKey);
      if (!activeButton) return;
      setIndicator({
        left: activeButton.offsetLeft,
        width: activeButton.offsetWidth,
        ready: true,
      });
    };

    syncIndicator();

    const resizeObserver = new ResizeObserver(syncIndicator);
    if (tabsRef.current) resizeObserver.observe(tabsRef.current);
    buttonRefs.current.forEach((button) => resizeObserver.observe(button));
    window.addEventListener('resize', syncIndicator);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncIndicator);
    };
  }, [activeKey, hasTabs, safeTabs]);

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
              <nav ref={tabsRef} className="admin-module-tabs" aria-label={`${title}视图`}>
                <span
                  className="admin-module-tab-indicator"
                  style={{
                    opacity: indicator.ready ? 1 : 0,
                    transform: `translate3d(${indicator.left}px, 0, 0)`,
                    width: `${indicator.width}px`,
                  }}
                />
                {safeTabs.map((item) => {
                  const Icon = item.icon;
                  const active = item.key === activeKey;
                  return (
                    <button
                      key={item.key}
                      ref={(node) => {
                        if (node) {
                          buttonRefs.current.set(item.key, node);
                        } else {
                          buttonRefs.current.delete(item.key);
                        }
                      }}
                      type="button"
                      onClick={() => onTabChange?.(item.key)}
                      data-active={active}
                      className={cn(
                        'admin-module-tab-button',
                        active
                          ? 'text-[var(--bg-void)]'
                          : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--ink-primary)]'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="sm:hidden">{item.shortLabel || item.label}</span>
                      <span className="hidden sm:inline">{item.label}</span>
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
