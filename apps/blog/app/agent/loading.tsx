function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`agent-skeleton-shimmer ${className}`} />;
}

export default function AgentLoading() {
  return (
    <main
      className="relative min-h-screen overflow-hidden bg-[var(--bg-void)] px-4 pb-16 pt-28"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="正在装载灵境"
    >
      <div className="absolute inset-0 aurora-layer opacity-45" aria-hidden="true" />
      <div className="relative mx-auto grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-7 pt-8">
          <div className="space-y-4">
            <SkeletonBlock className="h-3 w-40 rounded-full" />
            <SkeletonBlock className="h-14 w-[88%] max-w-3xl rounded-2xl md:h-20" />
            <SkeletonBlock className="h-5 w-[72%] rounded-full" />
            <SkeletonBlock className="h-5 w-[56%] rounded-full" />
          </div>

          <div className="flex flex-wrap gap-3">
            <SkeletonBlock className="h-12 w-40 rounded-2xl" />
            <SkeletonBlock className="h-12 w-32 rounded-2xl" />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="surface-leaf rounded-2xl border border-[var(--ink-subtle)]/12 p-4"
              >
                <SkeletonBlock className="mb-4 h-9 w-9 rounded-xl" />
                <SkeletonBlock className="mb-3 h-4 w-2/3 rounded-full" />
                <SkeletonBlock className="h-3 w-full rounded-full" />
                <SkeletonBlock className="mt-2 h-3 w-4/5 rounded-full" />
              </div>
            ))}
          </div>
        </section>

        <aside className="surface-overlay hidden rounded-[28px] border border-[var(--ink-subtle)]/14 p-4 shadow-2xl lg:block">
          <div className="mb-4 flex items-center justify-between">
            <SkeletonBlock className="h-8 w-32 rounded-full" />
            <SkeletonBlock className="h-8 w-8 rounded-full" />
          </div>
          <div className="space-y-3">
            <SkeletonBlock className="h-24 rounded-2xl" />
            <SkeletonBlock className="h-16 rounded-2xl" />
            <SkeletonBlock className="h-16 rounded-2xl" />
          </div>
          <div className="mt-5 rounded-2xl border border-[var(--ink-subtle)]/10 p-3">
            <SkeletonBlock className="mb-3 h-3 w-24 rounded-full" />
            <SkeletonBlock className="h-20 rounded-xl" />
          </div>
        </aside>
      </div>
    </main>
  );
}
