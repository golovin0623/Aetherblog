/**
 * 时间轴加载骨架。
 * 镜像 TimelineTree 足以保持跨主题的路由转换稳定。
 */
function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`relative block overflow-hidden bg-[var(--bg-tertiary)] ${className}`}
    >
      <span className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-[var(--shimmer-color)] to-transparent" />
    </span>
  );
}

const skeletonYears = [
  {
    year: '2026',
    months: [
      { id: 'jan', posts: 3 },
      { id: 'feb', posts: 2 },
    ],
  },
  {
    year: '2025',
    months: [
      { id: 'mar', posts: 2 },
    ],
  },
];

export default function TimelineLoading() {
  return (
    <div className="min-h-screen bg-background text-[var(--text-primary)] selection:bg-primary/30">
      <main
        className="max-w-4xl mx-auto px-4 pt-32 pb-24 md:pb-12"
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label="时间轴加载中"
        data-testid="timeline-loading"
      >
        <div className="relative mb-8 pl-4">
          <SkeletonBlock className="mb-2 h-9 w-32 rounded" />
          <SkeletonBlock className="h-4 w-48 rounded" />
          <div className="absolute left-0 top-1 bottom-1 w-1 bg-gradient-to-b from-primary to-accent rounded-full" />
        </div>

        <div className="space-y-4" data-timeline-loading-skeleton>
          {skeletonYears.map((year, yearIndex) => (
            <section key={year.year} className="relative" aria-hidden="true">
              <div className="surface-raised flex items-center gap-3 w-full py-2 px-3 !rounded-lg">
                <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20">
                  <SkeletonBlock className="h-5 w-5 rounded" />
                </div>
                <SkeletonBlock
                  className={`h-7 rounded ${
                    yearIndex === 0 ? 'w-20' : 'w-16'
                  }`}
                />
                <SkeletonBlock className="ml-auto h-5 w-14 rounded-full bg-[var(--bg-secondary)]" />
              </div>

              <div className="mt-2 ml-2 pl-2 md:ml-4 md:pl-4 border-l-2 border-[var(--border-subtle)] space-y-2">
                {year.months.map((month) => (
                  <div key={month.id}>
                    <div className="surface-leaf flex items-center gap-2.5 w-full py-1.5 px-2.5 !rounded-lg">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <SkeletonBlock className="h-3.5 w-3.5 rounded" />
                      </div>
                      <SkeletonBlock className="h-3.5 w-3.5 rounded bg-primary/10" />
                      <SkeletonBlock className="h-5 w-14 rounded" />
                      <SkeletonBlock className="ml-auto h-5 w-10 rounded-full bg-[var(--bg-secondary)]" />
                    </div>

                    <div className="mt-1 ml-4 md:ml-8 space-y-1">
                      {Array.from({ length: month.posts }).map((_, postIndex) => (
                        <div
                          key={postIndex}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5"
                        >
                          <SkeletonBlock className="h-4 w-4 shrink-0 rounded" />
                          <SkeletonBlock
                            className={`h-5 flex-1 rounded ${
                              postIndex === month.posts - 1 ? 'max-w-[68%]' : 'max-w-[82%]'
                            }`}
                          />
                          <SkeletonBlock className="h-3 w-8 rounded" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
