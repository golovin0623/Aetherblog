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
  ClipboardList,
  Home,
  LogOut,
  Search,
  User,
  ChevronsLeft,
  ChevronsRight,
  Sun,
  Moon,
  Bot,
  PanelLeftClose,
} from 'lucide-react';
import { AetherMark } from '@aetherblog/ui';
import { useSidebarStore, useAuthStore } from '@/stores';
import { useTheme } from '@/hooks';
import { useSiteLogo } from '@/hooks/useSiteLogo';
import { cn } from '@/lib/utils';
import { startTransition, useCallback, useState } from 'react';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { UserProfileModal } from './UserProfileModal';
import { getMediaUrl } from '@/services/mediaService';
import { authService } from '@/services/authService';

// 分组结构 —— Control Room 风格导航(OVERVIEW / CONTENT / INTELLIGENCE / SYSTEM)
const navSections: Array<{
  label: string;
  items: Array<{ path: string; icon: typeof LayoutDashboard; label: string }>;
}> = [
  {
    label: 'OVERVIEW',
    items: [
      { path: '/dashboard', icon: LayoutDashboard, label: '仪表盘' },
      { path: '/analytics', icon: Activity, label: '数据分析' },
    ],
  },
  {
    label: 'CONTENT',
    items: [
      { path: '/posts', icon: FileText, label: '文章管理' },
      { path: '/media', icon: Image, label: '媒体库' },
      { path: '/categories', icon: FolderTree, label: '分类标签' },
      { path: '/comments', icon: MessageSquare, label: '评论管理' },
      { path: '/friends', icon: Link2, label: '友情链接' },
    ],
  },
  {
    label: 'INTELLIGENCE',
    items: [
      { path: '/ai-tools', icon: Sparkles, label: 'AI 工具' },
      { path: '/ai-config', icon: Bot, label: 'AI 配置' },
      { path: '/search-config', icon: Search, label: '搜索配置' },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { path: '/monitor', icon: Activity, label: '系统监控' },
      { path: '/activities', icon: ClipboardList, label: '活动记录' },
      { path: '/settings', icon: Settings, label: '系统设置' },
    ],
  },
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
    const q = searchValue.trim();
    if (!q) return;
    setMobileOpen(false);
    startTransition(() => {
      navigate(`/posts?search=${encodeURIComponent(q)}`);
    });
  };

  // 点击导航项：
  // 1. 立即(urgent)关闭移动端抽屉 —— 用户看到的视觉反馈不能被阻塞
  // 2. 路由切换包进 startTransition —— 把老页面(例如媒体库/AI 配置)的 unmount
  //    降级为可中断的低优先级更新，让 React 能分帧处理、浏览器可以立刻 paint
  //    抽屉关闭动画。这是"点侧边栏没反应"的核心修复。
  const handleNavClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
      // 放行新标签页 / 非左键的原生行为
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        setMobileOpen(false);
        return;
      }

      e.preventDefault();
      setMobileOpen(false);

      // 不拦截"点击当前路径"——用户常用这个手势清空 query/reset 视图。
      // react-router 的 navigate() 对相同 URL 已是 no-op，无需自己判重。
      startTransition(() => {
        navigate(path);
      });
    },
    [navigate, setMobileOpen]
  );

  const contentProps = {
    effectiveCollapsed,
    user,
    logout: () => setShowLogoutConfirm(true),
    openProfile: () => setShowProfileModal(true),
    searchValue,
    setSearchValue,
    handleSearch,
    toggle,
    handleNavClick,
    isProfileOpen: showProfileModal,
  };

  return (
    <>
      {/* 移动端背景遮罩 */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden"
          style={{ viewTransitionName: 'admin-sidebar-backdrop' } as React.CSSProperties}
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* 移动端抽屉 - 优化宽度 (减少约1/3，目标 ~65vw 或 ~220px) */}
      <div className={cn(
        "fixed top-0 left-0 h-[100dvh] z-50 w-[65vw] max-w-[220px] bg-[var(--bg-overlay)] backdrop-blur-md border-r border-border transform-gpu transition-transform duration-300 ease-in-out md:hidden flex flex-col will-change-transform",
        isMobileOpen ? "translate-x-0" : "-translate-x-full"
      )}
        style={{ viewTransitionName: 'admin-sidebar-drawer' } as React.CSSProperties}
      >
        <SidebarContent {...contentProps} effectiveCollapsed={false} isMobile={true} closeMobile={() => setMobileOpen(false)} />
      </div>

      {/* 桌面端侧边栏 */}
      <motion.aside
        initial={false}
        animate={{ width: effectiveCollapsed ? 64 : 256 }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
        className={cn(
          'relative h-dvh z-40 overflow-hidden flex-shrink-0',
          'bg-[var(--bg-overlay)] backdrop-blur-md border-r border-border',
          'hidden md:flex flex-col will-change-[width] transform-gpu'
        )}
      >
        <SidebarContent {...contentProps} isMobile={false} closeMobile={() => { }} />
      </motion.aside>

      <ConfirmDialog
        isOpen={showLogoutConfirm}
        title="确认退出登录？"
        message="退出后将返回登录页面，未保存的操作可能会丢失。"
        confirmText="确认退出"
        cancelText="取消"
        variant="warning"
        onConfirm={async () => {
          try {
            await authService.logout();
          } finally {
            logout();
            navigate('/login');
          }
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
  handleNavClick: (e: React.MouseEvent<HTMLAnchorElement>, path: string) => void;
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
  handleNavClick,
  closeMobile,
  isProfileOpen,
}: SidebarContentProps) {
  const { isDark, toggleThemeWithAnimation } = useTheme();
  const siteLogo = useSiteLogo();

  return (
    <>
      {/* Logo + 移动端关闭按钮 */}
      <div className={cn(
        "h-14 flex items-center justify-between border-b border-border transition-all duration-300",
        effectiveCollapsed ? "px-4" : "px-3"
      )}>
        {/* 跨应用导航不加 target="_blank",见 packages/hooks/src/themeConstants.ts 约定。 */}
        <a
          href="/"
          title="访问主站"
          aria-label="访问主站"
          className={cn(
            'flex items-center gap-3 rounded-lg px-1 py-1 -mx-1 transition-colors duration-200 group outline-none',
            isMobile
              ? 'active:bg-[var(--bg-card-hover)]' // 移动端仅 active 状态，避免触摸残留 hover
              : 'hover:bg-[var(--bg-card-hover)]'
          )}
        >
          {/* Logo */}
          {siteLogo ? (
            <div className="relative w-8 h-8 rounded-xl overflow-hidden flex-shrink-0 shadow-lg shadow-primary/30">
              <img src={siteLogo} alt="Logo" className="w-full h-full object-contain" />
            </div>
          ) : (
            <span className="relative w-8 h-8 inline-flex items-center justify-center flex-shrink-0">
              <AetherMark size={32} />
            </span>
          )}
          <div className={cn(
            'overflow-hidden transition-all duration-300',
            effectiveCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
          )}>
            <span className={cn(
              'font-semibold text-transparent bg-clip-text bg-gradient-to-r from-[var(--text-primary)] via-[var(--text-secondary)] to-[var(--text-muted)] whitespace-nowrap transition-all duration-200',
              !isMobile && 'group-hover:from-primary group-hover:to-accent'
            )}>
              AetherBlog
            </span>
          </div>
        </a>

        {/* 移动端：优雅关闭按钮 */}
        {isMobile && (
          <button
            onClick={closeMobile}
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
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
              'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]',
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
                'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
                'focus:outline-none focus:border-primary/50',
                'transition-colors duration-200'
              )}
            />
          </div>
        </form>
      </div>

      {/* 导航菜单 — Control Room 分组 */}
      <nav className="flex-1 py-3 overflow-y-auto">
        <div className={cn("space-y-4 transition-all duration-300", effectiveCollapsed ? "px-4" : "px-3")}>
          {navSections.map((section, sectionIdx) => (
            <div key={section.label} className="space-y-0.5">
              {/* 分组标签 —— 展开态显示 mono uppercase 小字 */}
              {!effectiveCollapsed && (
                <div
                  className="px-3 pb-1 pt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]"
                  aria-hidden="true"
                >
                  {section.label}
                </div>
              )}
              {/* 折叠态用短分隔线代替分组标签 */}
              {effectiveCollapsed && sectionIdx > 0 && (
                <div className="mx-auto my-1 h-px w-6 bg-[var(--border-subtle)]" aria-hidden="true" />
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      onClick={(e) => handleNavClick(e, item.path)}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center rounded-lg transition-all duration-200',
                          effectiveCollapsed ? 'justify-center py-1.5 px-0' : 'gap-3 px-3 py-2',
                          isActive
                            ? 'bg-primary text-white'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
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
            </div>
          ))}
        </div>
      </nav>

      {/* 快速链接 + 折叠切换 (仅桌面端) */}
      <div className={cn(
        "border-t border-border py-2 space-y-0.5 transition-all duration-300",
        effectiveCollapsed ? "px-4" : "px-3",
        isMobile && "hidden" // 移动端隐藏收起按钮，因为已有顶部X按钮
      )}>
        {/* 跨应用导航不加 target="_blank",见 packages/hooks/src/themeConstants.ts 约定。 */}
        <a
          href="/"
          className={cn(
            'flex items-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-all duration-200',
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
            'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
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
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-status-success rounded-full border border-[var(--bg-primary)]" />
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
                  'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]',
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
                  'text-[var(--text-secondary)] hover:text-status-danger hover:bg-[var(--bg-card-hover)]',
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
