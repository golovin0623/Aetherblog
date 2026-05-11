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
  const lineBase = 'agent-skeleton-shimmer rounded-lg';
  return (
    <div
      className="relative h-screen [height:100dvh] min-h-[600px] bg-[var(--bg-substrate)] flex overflow-hidden select-none"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <div className="absolute inset-0 aurora-layer opacity-30" aria-hidden="true" />
      {showSidebar && (
        <aside className="relative z-10 hidden md:flex surface-raised w-[280px] flex-shrink-0 border-r border-[var(--ink-subtle)]/15 flex-col">
          <div className="p-4 space-y-3 border-b border-[var(--ink-subtle)]/12">
            <div className="flex items-center justify-between gap-3">
              <div className={`h-5 w-28 ${lineBase}`} />
              <div className={`h-8 w-8 rounded-full ${lineBase}`} />
            </div>
            <div className={`h-10 w-full rounded-2xl ${lineBase}`} />
            <div className="grid grid-cols-3 gap-1.5">
              <div className={`h-7 ${lineBase}`} />
              <div className={`h-7 ${lineBase}`} />
              <div className={`h-7 ${lineBase}`} />
            </div>
          </div>
          <div className="flex-1 overflow-hidden p-3 space-y-2">
            <div className={`h-3.5 w-12 ${lineBase}`} />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={`a-${i}`} className="rounded-2xl border border-[var(--ink-subtle)]/8 p-2">
                <div className={`h-3.5 ${i % 2 === 0 ? 'w-3/4' : 'w-5/6'} ${lineBase}`} />
                <div className={`mt-2 h-2.5 w-1/2 ${lineBase}`} />
              </div>
            ))}
            <div className={`h-3.5 w-12 mt-4 ${lineBase}`} />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={`b-${i}`} className={`h-8 w-full rounded-xl ${lineBase}`} />
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

      <section className="relative z-10 flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between gap-3 px-4 sm:px-6 h-14 border-b border-[var(--ink-subtle)]/12">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`md:hidden w-8 h-8 rounded-full ${lineBase}`} />
            <div className="space-y-1.5">
              <div className={`h-3 w-32 ${lineBase}`} />
              <div className={`h-3.5 w-44 ${lineBase}`} />
            </div>
          </div>
          <div className={`h-9 w-44 ${lineBase}`} />
        </header>

        <div className="agent-thumb-scroll flex-1 overflow-hidden px-3 py-6 sm:px-6">
          <div className="mx-auto flex h-full w-full max-w-[820px] flex-col justify-end gap-5">
            <div className="mr-auto w-[86%] max-w-xl rounded-2xl border border-[var(--ink-subtle)]/12 p-4">
              <div className={`mb-3 h-4 w-28 ${lineBase}`} />
              <div className={`h-3.5 w-full ${lineBase}`} />
              <div className={`mt-2 h-3.5 w-4/5 ${lineBase}`} />
            </div>
            <div className="ml-auto w-[58%] max-w-md rounded-2xl border border-[var(--aurora-1)]/20 p-4">
              <div className={`h-3.5 w-full ${lineBase}`} />
              <div className={`mt-2 h-3.5 w-2/3 ${lineBase}`} />
            </div>
            <div className="mr-auto w-[92%] max-w-2xl rounded-2xl border border-[var(--ink-subtle)]/12 p-4">
              <div className="mb-3 flex items-center gap-2">
                <div className={`h-8 w-8 rounded-full ${lineBase}`} />
                <div className="flex-1">
                  <div className={`h-3.5 w-32 ${lineBase}`} />
                </div>
              </div>
              <div className={`h-3.5 w-full ${lineBase}`} />
              <div className={`mt-2 h-3.5 w-[88%] ${lineBase}`} />
              <div className={`mt-2 h-3.5 w-[62%] ${lineBase}`} />
            </div>
            <div className="text-center font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)]/80">
              {label}
            </div>
          </div>
        </div>

        <div className="px-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
          <div className="mx-auto w-full max-w-[820px]">
            <div className={`h-[88px] w-full ${lineBase}`} />
          </div>
        </div>
      </section>
    </div>
  );
}
