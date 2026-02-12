import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { useSidebarStore } from '@/stores';
import { MobileHeader } from './MobileHeader';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';

import { useMediaQuery } from '@/hooks';
import { cn } from '@/lib/utils';

export function AdminLayout() {
  const { isCollapsed, isAutoCollapsed } = useSidebarStore();
  const effectiveCollapsed = isCollapsed || isAutoCollapsed;
  const isMobile = useMediaQuery('(max-width: 768px)');
  const location = useLocation();
  const isAppPage = location.pathname.startsWith('/media'); // 管理自身布局/滚动的页面

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* 侧边栏 */}
      <Sidebar />

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
        <MobileHeader />


        {/* 页面内容 */}
        <main className={cn(
          "flex-1 relative overflow-auto",
          isAppPage ? "p-0" : "p-4 md:p-6"
        )}>
          <Suspense fallback={
            <div className="flex h-full items-center justify-center min-h-[200px]">
              <LoadingSpinner />
            </div>
          }>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
