import { Outlet } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useSidebarStore } from '@/stores';
import { cn } from '@/lib/utils';

export function AdminLayout() {
  const { isCollapsed } = useSidebarStore();

  return (
    <div className="flex h-screen bg-background">
      {/* 侧边栏 */}
      <Sidebar />

      {/* 主内容区 */}
      <div
        className={cn(
          'flex-1 flex flex-col transition-all duration-300',
          isCollapsed ? 'ml-16' : 'ml-64'
        )}
      >
        {/* 顶部导航 */}
        <Header />

        {/* 页面内容 */}
        <main className="flex-1 overflow-auto p-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}
