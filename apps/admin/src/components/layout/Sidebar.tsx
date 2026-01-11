import { NavLink, useNavigate } from 'react-router-dom';
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
  Home,
  LogOut,
  Search,
  User,
  ChevronsLeft,
  ChevronsRight,
  X,
} from 'lucide-react';
import { useSidebarStore, useAuthStore } from '@/stores';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

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
  const { isCollapsed, isAutoCollapsed, isMobileOpen, toggle, setMobileOpen } = useSidebarStore();
  const effectiveCollapsed = isCollapsed || isAutoCollapsed;
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchValue.trim()) {
      navigate(`/posts?search=${encodeURIComponent(searchValue.trim())}`);
      setMobileOpen(false); // Close mobile drawer on search
    }
  };

  const handleNavigation = () => {
     setMobileOpen(false); // Close mobile drawer on navigation
  };

  const contentProps = {
    effectiveCollapsed,
    user,
    logout: () => setShowLogoutConfirm(true),
    searchValue,
    setSearchValue,
    handleSearch,
    toggle,
    handleNavigation, // New prop
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Drawer - 缩小宽度以适配移动端 */}
      <div className={cn(
        "fixed top-0 left-0 h-[100dvh] z-50 w-[75vw] max-w-[280px] bg-background-secondary border-r border-border transform transition-transform duration-300 ease-in-out md:hidden flex flex-col",
        isMobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <SidebarContent {...contentProps} effectiveCollapsed={false} isMobile={true} closeMobile={() => setMobileOpen(false)} />
      </div>

      {/* Desktop Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: effectiveCollapsed ? 64 : 256 }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
        className={cn(
          'relative h-screen z-40 overflow-hidden flex-shrink-0',
          'bg-background-secondary border-r border-border',
          'hidden md:flex flex-col will-change-[width] transform-gpu'
        )}
      >
        <SidebarContent {...contentProps} isMobile={false} closeMobile={() => {}} />
      </motion.aside>

      <ConfirmDialog
        isOpen={showLogoutConfirm}
        title="确认退出登录？"
        message="退出后将返回登录页面，未保存的操作可能会丢失。"
        confirmText="确认退出"
        cancelText="取消"
        variant="warning"
        onConfirm={() => {
          logout();
          navigate('/login');
        }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </>
  );
}

interface SidebarContentProps {
  effectiveCollapsed: boolean;
  user: any;
  logout: () => void;
  searchValue: string;
  setSearchValue: (val: string) => void;
  handleSearch: (e: React.FormEvent) => void;
  toggle: () => void;
  isMobile: boolean;
  handleNavigation: () => void;
  closeMobile: () => void;
}

function SidebarContent({
  effectiveCollapsed,
  user,
  logout,
  searchValue,
  setSearchValue,
  handleSearch,
  toggle,
  isMobile,
  handleNavigation,
  closeMobile
}: SidebarContentProps) {
  return (
    <>
      {/* Logo + Mobile Close Button */}
      <div className={cn(
        "h-14 flex items-center justify-between border-b border-border transition-all duration-300",
        effectiveCollapsed ? "px-4" : "px-3"
      )}>
        <div className="flex items-center gap-3">
          {/* Glossy Logo */}
          <div className="relative w-8 h-8 rounded-xl overflow-hidden flex-shrink-0 shadow-lg shadow-primary/30">
            {/* Base gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary via-purple-500 to-indigo-600" />
            {/* Glass shine overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/30 via-transparent to-transparent" />
            {/* Inner glow */}
            <div className="absolute inset-[1px] rounded-[10px] bg-gradient-to-br from-white/20 to-transparent" />
            {/* Letter */}
            <span className="absolute inset-0 flex items-center justify-center text-white font-bold text-lg drop-shadow-md">
              A
            </span>
          </div>
          <div className={cn(
            'overflow-hidden transition-all duration-300',
            effectiveCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
          )}>
            <span className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-white via-gray-200 to-gray-400 whitespace-nowrap">
              AetherBlog
            </span>
          </div>
        </div>
        
        {/* Mobile: Close button in header */}
        {isMobile && (
          <button
            onClick={closeMobile}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="关闭菜单"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Search Bar */}
      <div className={cn(
        "py-3 border-b border-border transition-all duration-300",
        effectiveCollapsed ? "px-4" : "px-3"
      )}>
        <form onSubmit={handleSearch} className="flex items-center">
          <button
            type="button"
            onClick={() => !isMobile && effectiveCollapsed && toggle()}
            className={cn(
              'flex-shrink-0 flex items-center justify-center rounded-lg',
              'w-8 h-8',
              'text-gray-400 hover:text-white hover:bg-white/5',
              'transition-all duration-200'
            )}
          >
            <Search className="w-5 h-5 text-gray-400" />
          </button>
          <div className={cn(
            'overflow-hidden transition-all duration-300',
            effectiveCollapsed ? 'w-0 opacity-0 ml-0' : 'flex-1 opacity-100 ml-2'
          )}>
            <input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="搜索..."
              className={cn(
                'w-full px-3 py-1.5 rounded-lg text-sm',
                'bg-white/5 border border-border',
                'text-white placeholder-gray-500',
                'focus:outline-none focus:border-primary/50',
                'transition-colors duration-200'
              )}
            />
          </div>
        </form>
      </div>

      {/* 导航菜单 */}
      <nav className="flex-1 py-3 overflow-y-auto">
        <ul className={cn(
          "space-y-0.5 transition-all duration-300",
          effectiveCollapsed ? "px-4" : "px-3"
        )}>
          {navItems.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                onClick={handleNavigation}
                className={({ isActive }) =>
                  cn(
                    'flex items-center rounded-lg transition-all duration-200',
                    effectiveCollapsed ? 'justify-center py-1.5 px-0' : 'gap-3 px-3 py-2',
                    isActive
                      ? 'bg-primary text-white'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  )
                }
              >
              
                <item.icon className="w-5 h-5 flex-shrink-0" />
                <span className={cn(
                  'text-sm font-medium overflow-hidden whitespace-nowrap transition-all duration-300',
                  effectiveCollapsed ? 'w-0 opacity-0 ml-0' : 'w-auto opacity-100 ml-0'
                )}>
                  {item.label}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Quick Links + Collapse Toggle (Desktop only) */}
      <div className={cn(
        "border-t border-border py-2 space-y-0.5 transition-all duration-300",
        effectiveCollapsed ? "px-4" : "px-3",
        isMobile && "hidden" // 移动端隐藏收起按钮，因为已有顶部X按钮
      )}>
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'flex items-center rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-all duration-200',
            effectiveCollapsed ? 'justify-center py-1.5 px-0' : 'gap-3 px-3 py-2'
          )}
          title="访问主站"
        >
          <Home className="w-5 h-5 flex-shrink-0" />
          <span className={cn(
            'text-sm overflow-hidden whitespace-nowrap transition-all duration-300',
            effectiveCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100 ml-0'
          )}>
            主站
          </span>
        </a>

        <button
          onClick={toggle}
          className={cn(
            'w-full flex items-center rounded-lg transition-all duration-200 group',
            effectiveCollapsed ? 'justify-center py-2 px-0' : 'gap-3 px-3 py-2.5',
            'text-gray-500 hover:text-gray-300 hover:bg-white/5'
          )}
          title={effectiveCollapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          <div className={cn(
            'flex items-center justify-center w-5 h-5 transition-transform duration-300',
            !effectiveCollapsed ? 'group-hover:-translate-x-0.5' : 'group-hover:translate-x-0.5'
          )}>
            {effectiveCollapsed ? (
              <ChevronsRight className="w-5 h-5" />
            ) : (
              <ChevronsLeft className="w-5 h-5" />
            )}
          </div>
          <span className={cn(
            'text-xs font-normal tracking-wide overflow-hidden whitespace-nowrap transition-all duration-300',
            effectiveCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
          )}>
            收起导航
          </span>
        </button>
      </div>

      {/* User Info */}
      <div className="border-t border-border p-3">
        <div className={cn(
          "flex items-center transition-all duration-300 cursor-pointer group",
          effectiveCollapsed ? "px-0 justify-center" : "gap-3 px-1"
        )}>
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center group-hover:ring-2 group-hover:ring-primary/50 transition-all">
              {user?.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.nickname}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <User className="w-4 h-4 text-primary" />
              )}
            </div>
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-background-secondary" />
          </div>

          <div className={cn(
            'flex-1 min-w-0 overflow-hidden transition-all duration-300',
            effectiveCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
          )}>
            <p className="text-sm font-medium text-white truncate whitespace-nowrap">
              {user?.nickname || '管理员'}
            </p>
            <p className="text-xs text-gray-400 whitespace-nowrap">
              {user?.role || 'ADMIN'}
            </p>
          </div>

          <div className={cn(
            'overflow-hidden transition-all duration-300 flex-shrink-0',
            effectiveCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
          )}>
            <button
              onClick={logout}
              className={cn(
                'p-2 rounded-lg',
                'text-gray-400 hover:text-red-400 hover:bg-white/5',
                'transition-all duration-200'
              )}
              title="退出登录"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
