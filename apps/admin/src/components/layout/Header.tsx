import { Bell, Search, User, LogOut } from 'lucide-react';
import { useAuthStore } from '@/stores';
import { cn } from '@/lib/utils';

export function Header() {
  const { user, logout } = useAuthStore();

  return (
    <header className="h-16 flex items-center justify-between px-6 border-b border-border bg-background-secondary/50 backdrop-blur-sm">
      {/* 搜索框 */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索..."
            className={cn(
              'w-full pl-10 pr-4 py-2 rounded-lg',
              'bg-white/5 border border-border',
              'text-white placeholder-gray-500',
              'focus:outline-none focus:border-primary/50',
              'transition-colors duration-200'
            )}
          />
        </div>
      </div>

      {/* 右侧操作区 */}
      <div className="flex items-center gap-4">
        {/* 通知 */}
        <button
          className={cn(
            'relative p-2 rounded-lg',
            'text-gray-400 hover:text-white hover:bg-white/5',
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
            <p className="text-sm font-medium text-white">
              {user?.nickname || '管理员'}
            </p>
            <p className="text-xs text-gray-400">
              {user?.role || 'ADMIN'}
            </p>
          </div>
          <button
            onClick={logout}
            className="p-2 text-gray-400 hover:text-red-400 transition-colors"
            title="退出登录"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
