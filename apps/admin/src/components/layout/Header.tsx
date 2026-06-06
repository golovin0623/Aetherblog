import { Bell, User, LogOut, Sun, Moon } from 'lucide-react';
import { useAuthStore } from '@/stores';
import { useTheme } from '@/hooks';
import { cn } from '@/lib/utils';
import { CachedAvatar } from '@/components/common/CachedAvatar';
import { getMediaUrl } from '@/services/mediaService';

export function Header() {
  const { user, logout } = useAuthStore();
  const { isDark, toggleThemeWithAnimation } = useTheme();

  return (
    <header className="hidden md:flex h-16 items-center justify-end px-6 border-b border-border bg-[var(--bg-overlay)] backdrop-blur-md sticky top-0 z-30">
      <div className="flex items-center gap-4">
        {/* 主题切换 */}
        <button
          type="button"
          data-theme-toggle
          onClick={(e) => toggleThemeWithAnimation(e.clientX, e.clientY)}
          className={cn(
            'p-2 rounded-lg',
            'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]',
            'transition-colors duration-150'
          )}
          title={isDark ? '切换亮色模式' : '切换暗色模式'}
          aria-label={isDark ? '切换亮色模式' : '切换暗色模式'}
        >
          {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        {/* 通知 */}
        <button
          className={cn(
            'relative p-2 rounded-lg',
            'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]',
            'transition-all duration-200'
          )}
          title="通知"
          aria-label="通知"
        >
          <Bell className="w-5 h-5" />
          <span aria-hidden="true" className="absolute top-1 right-1 w-2 h-2 bg-status-danger rounded-full" />
        </button>

        {/* 用户菜单 */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
            {user?.avatar ? (
              <CachedAvatar
                src={getMediaUrl(user.avatar)}
                alt={user.nickname}
                className="w-full h-full rounded-full object-cover"
                fallback={<User className="w-4 h-4 text-primary" />}
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
            className="p-2 text-[var(--text-muted)] hover:text-status-danger transition-colors"
            title="退出登录"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
