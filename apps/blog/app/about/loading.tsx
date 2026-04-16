export default function AboutLoading() {
  return (
    <div className="min-h-screen bg-[var(--bg-void)] flex items-center justify-center">
      <div className="max-w-4xl mx-auto text-center px-4 space-y-8">
        {/* Eyebrow skeleton */}
        <div className="flex justify-center">
          <div className="h-4 w-32 rounded-full bg-[var(--ink-subtle)]/20 animate-pulse" />
        </div>

        {/* Title skeleton */}
        <div className="space-y-4 flex flex-col items-center">
          <div className="h-12 w-80 rounded-lg bg-[var(--ink-subtle)]/20 animate-pulse" />
          <div className="h-6 w-64 rounded-lg bg-[var(--ink-subtle)]/10 animate-pulse" />
        </div>

        {/* Body skeleton */}
        <div className="space-y-3 flex flex-col items-center">
          <div className="h-4 w-96 max-w-full rounded bg-[var(--ink-subtle)]/10 animate-pulse" />
          <div className="h-4 w-72 rounded bg-[var(--ink-subtle)]/10 animate-pulse" />
        </div>

        {/* Arrow skeleton */}
        <div className="pt-8 flex justify-center">
          <div className="h-8 w-8 rounded-full bg-[var(--ink-subtle)]/10 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
