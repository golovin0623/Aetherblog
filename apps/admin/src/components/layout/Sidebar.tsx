import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
  Sun,
  Moon,
  PanelLeftClose,
} from 'lucide-react';
import { useSidebarStore, useAuthStore } from '@/stores';
import { useTheme } from '@/hooks';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { UserProfileModal } from './UserProfileModal';
import { getMediaUrl } from '@/services/mediaService';

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
  const [showProfileModal, setShowProfileModal] = useState(false);
  
  const openProfile = () => setShowProfileModal(true);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchValue.trim()) {
      navigate(`/posts?search=${encodeURIComponent(searchValue.trim())}`);
      setMobileOpen(false); // 搜索时关闭移动端抽屉
    }
  };

  const handleNavigation = () => {
     setMobileOpen(false); // 导航时关闭移动端抽屉
  };

  const contentProps = {
    effectiveCollapsed,
    user,
    logout: () => setShowLogoutConfirm(true),
    openProfile: () => setShowProfileModal(true),
    searchValue,
    setSearchValue,
    handleSearch,
    toggle,
    handleNavigation,
    isProfileOpen: showProfileModal,
  };

  return (
    <>
      {/* 移动端背景遮罩 */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* 移动端抽屉 - 优化宽度 (减少约1/3，目标 ~65vw 或 ~220px) */}
      <div className={cn(
        "fixed top-0 left-0 h-[100dvh] z-50 w-[65vw] max-w-[220px] bg-[var(--bg-overlay)] backdrop-blur-md border-r border-border transform-gpu transition-transform duration-300 ease-in-out md:hidden flex flex-col will-change-transform",
        isMobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <SidebarContent {...contentProps} effectiveCollapsed={false} isMobile={true} closeMobile={() => setMobileOpen(false)} />
      </div>

      {/* 桌面端侧边栏 */}
      <motion.aside
        initial={false}
        animate={{ width: effectiveCollapsed ? 64 : 256 }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
        className={cn(
          'relative h-screen z-40 overflow-hidden flex-shrink-0',
          'bg-[var(--bg-overlay)] backdrop-blur-md border-r border-border',
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

      <UserProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        sidebarCollapsed={effectiveCollapsed}
      />
    </>
  );
}

interface SidebarContentProps {
  effectiveCollapsed: boolean;
  user: any;
  logout: () => void;
  openProfile: () => void;
  searchValue: string;
  setSearchValue: (val: string) => void;
  handleSearch: (e: React.FormEvent) => void;
  toggle: () => void;
  isMobile?: boolean;
  handleNavigation: () => void;
  closeMobile?: () => void;
  isProfileOpen: boolean;
}

function SidebarContent({
  effectiveCollapsed,
  user,
  logout,
  openProfile,
  searchValue,
  setSearchValue,
  handleSearch,
  toggle,
  isMobile,
  handleNavigation,
  closeMobile,
  isProfileOpen,
}: SidebarContentProps) {
  const { isDark, toggleThemeWithAnimation } = useTheme();

  return (
    <>
      {/* Logo + 移动端关闭按钮 */}
      <div className={cn(
        "h-14 flex items-center justify-between border-b border-border transition-all duration-300",
        effectiveCollapsed ? "px-4" : "px-3"
      )}>
        <div className="flex items-center gap-3">
          {/* 光泽感 Logo */}
          <div className="relative w-8 h-8 rounded-xl overflow-hidden flex-shrink-0 shadow-lg shadow-primary/30">
            {/* 基础渐变 */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary via-purple-500 to-indigo-600" />
            {/* 玻璃光泽叠加 */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/30 via-transparent to-transparent" />
            {/* 内部发光 */}
            <div className="absolute inset-[1px] rounded-[10px] bg-gradient-to-br from-white/20 to-transparent" />
            {/* 字母 */}
            <span className="absolute inset-0 flex items-center justify-center text-white font-bold text-lg drop-shadow-md">
              A
            </span>
          </div>
          <div className={cn(
            'overflow-hidden transition-all duration-300',
            effectiveCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
          )}>
            <span className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-[var(--text-primary)] via-[var(--text-secondary)] to-[var(--text-muted)] whitespace-nowrap">
              AetherBlog
            </span>
          </div>
        </div>
        
        {/* 移动端：优雅关闭按钮 */}
        {isMobile && (
          <button
            onClick={closeMobile}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
            aria-label="关闭菜单"
          >
            <PanelLeftClose className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* 搜索栏 */}
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
              'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]',
              'transition-all duration-200'
            )}
          >
            <Search className="w-5 h-5 text-[var(--text-muted)]" />
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
                'bg-[var(--bg-card)] border border-border',
                'text-[var(--text-primary)] placeholder-gray-500',
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
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
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

      {/* 快速链接 + 折叠切换 (仅桌面端) */}
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
            'flex items-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-all duration-200',
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
            'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
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
            'text-sm font-normal tracking-wide overflow-hidden whitespace-nowrap transition-all duration-300',
            effectiveCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
          )}>
            收起导航
          </span>
        </button>
      </div>

      {/* 用户信息 */}
      <div className={cn(
        "border-t border-border",
        isMobile ? "p-3" : "p-1"
      )}>
        <div
          onClick={openProfile}
          className={cn(
            "flex items-center transition-all duration-300 cursor-pointer group rounded-lg hover:bg-[var(--bg-card-hover)] relative z-10",
            effectiveCollapsed ? "px-0 justify-center h-12 w-12 mx-auto" : isMobile ? "gap-2 px-2 py-2" : "gap-1.5 px-1 py-1"
          )}
        >
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center group-hover:ring-2 group-hover:ring-primary/50 transition-all overflow-hidden">
              {user?.avatar ? (
                <img
                  src={getMediaUrl(user.avatar)}
                  alt={user.nickname}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-4 h-4 text-primary" />
              )}
            </div>
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full border border-[var(--bg-primary)]" />
          </div>

          {!effectiveCollapsed && (
            <div className="flex-1 min-w-0 overflow-hidden">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate whitespace-nowrap">
                {user?.nickname || '管理员'}
              </p>
              <p className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                {user?.role || 'USER'}
              </p>
            </div>
          )}

          {!effectiveCollapsed && (
            <div className="flex-shrink-0 flex items-center gap-0.5">
              {/* 主题切换按钮 - 性能优化版 */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleThemeWithAnimation(e.clientX, e.clientY);
                }}
                className={cn(
                  'p-1.5 rounded-md transform-gpu will-change-transform',
                  'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]',
                  'transition-colors duration-150'
                )}
                title={isDark ? '切换亮色模式' : '切换暗色模式'}
                aria-label={isDark ? '切换亮色模式' : '切换暗色模式'}
              >
                {isDark ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
              </button>

              {/* 退出登录按钮 - 性能优化版 */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  logout();
                }}
                className={cn(
                  'p-1.5 rounded-md transform-gpu will-change-transform',
                  'text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--bg-card-hover)]',
                  'transition-colors duration-150'
                )}
                title="退出登录"
                aria-label="退出登录"
              >
                <LogOut className="w-4.5 h-4.5" />
              </button>
            </div>
          )}
        </div>
      </div>

    </>
  );
}
