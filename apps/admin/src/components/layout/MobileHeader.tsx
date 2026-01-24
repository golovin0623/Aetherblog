import { Menu } from 'lucide-react';
import { useSidebarStore } from '@/stores';

export function MobileHeader() {
  const { toggleMobile } = useSidebarStore();

  return (
    <header className="md:hidden h-14 flex items-center px-4 border-b border-border bg-[var(--bg-overlay)] backdrop-blur-md sticky top-0 z-30">
      <button
        onClick={toggleMobile}
        className="p-2 -ml-2 text-foreground hover:bg-accent rounded-md transition-colors"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>
      
      <div className="ml-3 flex items-center gap-2.5">
        {/* 光泽 Logo */}
        <div className="relative w-7 h-7 rounded-lg overflow-hidden flex-shrink-0 shadow-md shadow-primary/20">
          {/* 基础渐变 */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary via-purple-500 to-indigo-600" />
          {/* 玻璃光泽叠加 */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/30 via-transparent to-transparent" />
          {/* 内部发光 */}
          <div className="absolute inset-[1px] rounded-[6px] bg-gradient-to-br from-white/20 to-transparent" />
          {/* 字母 */}
          <span className="absolute inset-0 flex items-center justify-center text-white font-bold text-sm drop-shadow-sm">
            A
          </span>
        </div>
        {/* 渐变文本 */}
        <span className="font-semibold text-lg text-transparent bg-clip-text bg-gradient-to-r from-[var(--text-primary)] via-[var(--text-secondary)] to-[var(--text-muted)] tracking-tight">
          AetherBlog
        </span>
      </div>
    </header>
  );
}
