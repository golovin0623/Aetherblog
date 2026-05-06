'use client';

/**
 * Workspace 骨架屏 —— 在 useAgentAuth 还在拉 /me 时占位。
 *
 * 形状必须严格对齐真实 WorkspaceClient 的 sidebar / topbar / thread / composer 四块
 * 比例。这样状态从 loading → authed 翻转时几乎没有 layout shift；guest 跳转登录时
 * 用户也不会看到一张空的工作台闪现。
 *
 * 原则（CLAUDE.md §3.6）：禁止 spinner，统一骨架 + shimmer/pulse。
 */
export default function WorkspaceSkeleton({
  showSidebar = true,
  label = '正在确认登录状态…',
}: { showSidebar?: boolean; label?: string }) {
  const lineBase = 'rounded-lg bg-[var(--ink-subtle)]/12 animate-pulse';
  return (
    <div
      className="h-screen [height:100dvh] min-h-[600px] bg-[var(--bg-substrate)] flex overflow-hidden select-none"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      {showSidebar && (
        <aside className="hidden md:flex surface-raised w-[280px] flex-shrink-0 border-r border-[var(--ink-subtle)]/15 flex-col">
          <div className="p-4 space-y-3 border-b border-[var(--ink-subtle)]/12">
            <div className={`h-5 w-28 ${lineBase}`} />
            <div className={`h-9 w-full ${lineBase}`} />
            <div className={`h-7 w-full ${lineBase}`} />
          </div>
          <div className="flex-1 overflow-hidden p-3 space-y-2">
            <div className={`h-3.5 w-12 ${lineBase}`} />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={`a-${i}`} className={`h-7 w-full ${lineBase}`} />
            ))}
            <div className={`h-3.5 w-12 mt-4 ${lineBase}`} />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={`b-${i}`} className={`h-7 w-full ${lineBase}`} />
            ))}
          </div>
          <div className="p-3 border-t border-[var(--ink-subtle)]/12 flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full ${lineBase}`} />
            <div className="flex-1 space-y-1.5">
              <div className={`h-3 w-24 ${lineBase}`} />
              <div className={`h-2.5 w-12 ${lineBase}`} />
            </div>
          </div>
        </aside>
      )}

      <section className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between gap-3 px-4 sm:px-6 h-14 border-b border-[var(--ink-subtle)]/12">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`md:hidden w-8 h-8 ${lineBase}`} />
            <div className="space-y-1.5">
              <div className={`h-3 w-32 ${lineBase}`} />
              <div className={`h-3.5 w-44 ${lineBase}`} />
            </div>
          </div>
          <div className={`h-9 w-44 ${lineBase}`} />
        </header>

        <div className="flex-1 overflow-hidden flex flex-col items-center justify-center px-4">
          <div className="max-w-2xl w-full space-y-5 text-center">
            <div className={`mx-auto w-12 h-12 ${lineBase}`} />
            <div className={`mx-auto h-10 w-3/4 ${lineBase}`} />
            <div className={`mx-auto h-4 w-1/2 ${lineBase}`} />
            <div className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)]/80">
              {label}
            </div>
          </div>
        </div>

        <div className="px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 max-w-3xl w-full mx-auto">
          <div className={`h-[88px] w-full ${lineBase}`} />
        </div>
      </section>
    </div>
  );
}
