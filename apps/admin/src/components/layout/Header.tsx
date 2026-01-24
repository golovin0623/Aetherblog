import { Bell, Search, User, LogOut, Sun, Moon } from 'lucide-react';
import { useAuthStore } from '@/stores';
import { useTheme } from '@/hooks';
import { cn } from '@/lib/utils';

export function Header() {
  const { user, logout } = useAuthStore();
  const { theme, toggleThemeWithAnimation } = useTheme();

  return (
    <header className="hidden md:flex h-16 items-center justify-between px-6 border-b border-border bg-[var(--bg-overlay)] backdrop-blur-md sticky top-0 z-30">
      {/* 搜索框 */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="搜索..."
            className={cn(
              'w-full pl-10 pr-4 py-2 rounded-lg',
              'w-full pl-10 pr-4 py-2 rounded-lg',
              'bg-[var(--bg-card)] border border-border',
              'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
              'focus:outline-none focus:border-primary/50',
              'transition-colors duration-200'
            )}
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Theme Toggle */}
        <button
          onClick={(e) => toggleThemeWithAnimation(e.clientX, e.clientY)}
          className={cn(
            'p-2 rounded-lg',
            'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]',
            'transition-all duration-200'
          )}
          title={theme === 'dark' ? '切换亮色模式' : '切换暗色模式'}
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        {/* 通知 */}
        <button
          className={cn(
            'relative p-2 rounded-lg',
            'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]',
            'transition-all duration-200'
          )}
        >
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        {/* 用户菜单 */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
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
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {user?.nickname || '管理员'}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {user?.role || 'ADMIN'}
            </p>
          </div>
          <button
            onClick={logout}
            className="p-2 text-[var(--text-muted)] hover:text-red-400 transition-colors"
            title="退出登录"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
