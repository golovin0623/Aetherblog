import { Menu } from 'lucide-react';
import { useSidebarStore } from '@/stores';
import { cn } from '@/lib/utils';

export function MobileHeader() {
  const { toggleMobile } = useSidebarStore();

  return (
    <header className="md:hidden h-14 flex items-center px-4 border-b border-border bg-background sticky top-0 z-30">
      <button
        onClick={toggleMobile}
        className="p-2 -ml-2 text-foreground hover:bg-accent rounded-md transition-colors"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>
      
      <div className="ml-3 font-semibold text-lg tracking-tight">
        AetherBlog
      </div>
    </header>
  );
}
