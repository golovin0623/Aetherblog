import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { MobileHeader } from './MobileHeader';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { CommandPalette } from '@/components/common/CommandPalette';
import { IntelligenceShell } from '@/components/intelligence';
import { GlobalPricingSkeletonContent } from '@/pages/global-pricing/GlobalPricingSkeleton';

import { cn } from '@/lib/utils';
import {
  getIntelligenceShell,
  normalizeIntelligencePath,
} from '@/navigation/intelligenceNavigation';

function AdminRouteFallback({ pathname }: { pathname: string }) {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';

  if (normalizedPath === '/ai-config/pricing') {
    return <GlobalPricingSkeletonContent />;
  }

  return (
    <div className="flex h-full items-center justify-center min-h-[200px]">
      <LoadingSpinner />
    </div>
  );
}

// These pages reuse the roomy canvas treatment, but are analytics/platform
// surfaces rather than Intelligence destinations. Keep visual layout separate
// from product-domain membership.
const NON_INTELLIGENCE_CANVAS_PATHS = new Set([
  '/ai-config',
  '/ai-config/pricing',
  '/analytics',
  '/search-config',
]);

export function AdminLayout() {
  const location = useLocation();
  const normalizedPath = normalizeIntelligencePath(location.pathname);
  const isGlobalPricingRoute = normalizedPath === '/ai-config/pricing';
  const usesAdminCanvas =
    getIntelligenceShell(normalizedPath) === 'admin-canvas' ||
    NON_INTELLIGENCE_CANVAS_PATHS.has(normalizedPath);
  // 自管布局/滚动的页面：媒体库 + AI 协同写作
  const isAppPage =
    location.pathname.startsWith('/media') ||
    location.pathname.startsWith('/posts/ai-writing');
  const [cmdkOpen, setCmdkOpen] = useState(false);

  // ⌘K / Ctrl+K 全局命令面板
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdkOpen(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex h-dvh bg-background overflow-hidden">
      {/* 侧边栏 */}
      <Sidebar />

      {/* 主内容区 - z-0 创建层叠上下文，确保页面内二级侧栏不会覆盖主侧栏 */}
      <div className="flex-1 flex flex-col min-w-0 relative z-0 overflow-hidden">
        <MobileHeader />


        {/* 页面内容 */}
        <main className={cn(
          "flex-1 relative overflow-auto overscroll-contain",
          usesAdminCanvas && "admin-intelligence-canvas",
          isAppPage ? "p-0" : "p-4 md:p-6"
        )}>
          {isGlobalPricingRoute ? (
            <IntelligenceShell className="global-pricing-page" contentClassName="global-pricing-layout">
              <Suspense fallback={<AdminRouteFallback pathname={location.pathname} />}>
                <Outlet />
              </Suspense>
            </IntelligenceShell>
          ) : (
            <Suspense fallback={<AdminRouteFallback pathname={location.pathname} />}>
              <Outlet />
            </Suspense>
          )}
        </main>
      </div>

      {/* 全局命令面板(⌘K / Ctrl+K) */}
      <CommandPalette isOpen={cmdkOpen} onClose={() => setCmdkOpen(false)} />
    </div>
  );
}
