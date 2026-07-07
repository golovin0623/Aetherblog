import { Menu } from 'lucide-react';
import { AetherMark } from '@aetherblog/ui';
import { useSidebarStore } from '@/stores';
import { useSiteBranding } from '@/hooks/useSiteBranding';

export function MobileHeader() {
  const { toggleMobile } = useSidebarStore();
  const { siteName, siteLogo } = useSiteBranding();

  return (
    <header className="md:hidden h-14 flex items-center px-4 border-b border-border bg-[var(--bg-overlay)] backdrop-blur-md sticky top-0 z-30">
      <button
        onClick={toggleMobile}
        className="p-2 -ml-2 text-foreground hover:bg-accent rounded-md transition-colors"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>
      
      <div className="ml-3 flex min-w-0 items-center gap-2.5">
        {/* 站点 Logo */}
        {siteLogo ? (
          <div className="relative w-7 h-7 rounded-lg overflow-hidden flex-shrink-0 shadow-md shadow-primary/20">
            <img src={siteLogo} alt={`${siteName} Logo`} className="w-full h-full object-contain" />
          </div>
        ) : (
          <span className="relative w-7 h-7 inline-flex items-center justify-center flex-shrink-0">
            <AetherMark size={28} />
          </span>
        )}
        {/* 渐变文本 */}
        <span
          className="block max-w-[calc(100vw-7rem)] truncate font-semibold text-lg text-transparent bg-clip-text bg-gradient-to-r from-[var(--text-primary)] via-[var(--text-secondary)] to-[var(--text-muted)] tracking-normal"
          title={siteName}
        >
          {siteName}
        </span>
      </div>
    </header>
  );
}
