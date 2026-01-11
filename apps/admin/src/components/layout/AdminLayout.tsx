import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { useSidebarStore } from '@/stores';
import { MobileHeader } from './MobileHeader';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';

export function AdminLayout() {
  const { isCollapsed, isAutoCollapsed } = useSidebarStore();
  const effectiveCollapsed = isCollapsed || isAutoCollapsed;
  const isMobile = useMediaQuery('(max-width: 768px)');
  const location = useLocation();
  const isAppPage = location.pathname.startsWith('/media'); // Pages that manage their own layout/scroll

  return (
    <div className="flex h-screen bg-background">
      {/* 侧边栏 */}
      <Sidebar />

      {/* 主内容区 */}
      <motion.div
        animate={{ marginLeft: isMobile ? 0 : (effectiveCollapsed ? 64 : 256) }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
        className="flex-1 flex flex-col"
      >
        <MobileHeader />

        {/* 页面内容 
            App页面 (如Media): p-0, overflow-hidden (由页面内部控制滚动)
            文档页面 (如Dashboard): p-6, overflow-auto (由布局控制滚动)
        */}
        <main className={cn(
          "flex-1 relative",
          isAppPage ? "p-0 overflow-hidden" : "p-4 md:p-6 overflow-auto"
        )}>
          <motion.div
            key={location.pathname} // Add key for route transition
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >

            <Outlet />
          </motion.div>
        </main>
      </motion.div>
    </div>
  );
}

