import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  FileText,
  Image,
  FolderTree,
  MessageSquare,
  Link2,
  Settings,
  Sparkles,
  Activity,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useSidebarStore } from '@/stores';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/dashboard', icon: LayoutDashboard, label: '仪表盘' },
  { path: '/posts', icon: FileText, label: '文章管理' },
  { path: '/media', icon: Image, label: '媒体库' },
  { path: '/categories', icon: FolderTree, label: '分类标签' },
  { path: '/comments', icon: MessageSquare, label: '评论管理' },
  { path: '/friends', icon: Link2, label: '友情链接' },
  { path: '/ai-tools', icon: Sparkles, label: 'AI 工具' },
  { path: '/monitor', icon: Activity, label: '系统监控' },
  { path: '/settings', icon: Settings, label: '系统设置' },
];

export function Sidebar() {
  const { isCollapsed, toggle } = useSidebarStore();

  return (
    <motion.aside
      initial={false}
      animate={{ width: isCollapsed ? 64 : 256 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className={cn(
        'fixed left-0 top-0 h-screen z-40',
        'bg-background-secondary border-r border-border',
        'flex flex-col'
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-center border-b border-border">
        <motion.div
          initial={false}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2"
        >
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-white font-bold text-lg">A</span>
          </div>
          {!isCollapsed && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="font-semibold text-white"
            >
              AetherBlog
            </motion.span>
          )}
        </motion.div>
      </div>

      {/* 导航菜单 */}
      <nav className="flex-1 py-4 overflow-y-auto">
        <ul className="space-y-1 px-3">
          {navItems.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg',
                    'transition-all duration-200',
                    isActive
                      ? 'bg-primary text-white'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  )
                }
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {!isCollapsed && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-sm font-medium"
                  >
                    {item.label}
                  </motion.span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* 折叠按钮 */}
      <div className="p-3 border-t border-border">
        <button
          onClick={toggle}
          className={cn(
            'w-full flex items-center justify-center gap-2 px-3 py-2',
            'rounded-lg text-gray-400 hover:text-white hover:bg-white/5',
            'transition-all duration-200'
          )}
        >
          {isCollapsed ? (
            <ChevronRight className="w-5 h-5" />
          ) : (
            <>
              <ChevronLeft className="w-5 h-5" />
              <span className="text-sm">收起</span>
            </>
          )}
        </button>
      </div>
    </motion.aside>
  );
}
