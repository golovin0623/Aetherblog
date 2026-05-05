export default function AgentLoading() {
  return (
    <main className="relative min-h-screen flex items-center justify-center bg-[var(--bg-void)]">
      {/* 与最终首屏布局对齐的骨架,避免 spinner —— CLAUDE.md §3.6 */}
      <div className="relative max-w-4xl mx-auto px-4 text-center space-y-6 w-full">
        <div className="mx-auto h-3 w-44 rounded bg-[var(--ink-subtle)]/15 animate-pulse" />
        <div className="mx-auto h-12 md:h-16 w-3/4 rounded bg-[var(--ink-subtle)]/15 animate-pulse" />
        <div className="mx-auto h-5 w-2/3 rounded bg-[var(--ink-subtle)]/12 animate-pulse" />
        <div className="mx-auto h-4 w-1/2 rounded bg-[var(--ink-subtle)]/10 animate-pulse" />
        <div className="pt-2 flex justify-center gap-3">
          <div className="h-12 w-40 rounded-xl bg-[var(--ink-subtle)]/15 animate-pulse" />
          <div className="h-12 w-32 rounded-xl bg-[var(--ink-subtle)]/10 animate-pulse" />
        </div>
      </div>
    </main>
  );
}
