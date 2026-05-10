import { Brain, Sparkles } from 'lucide-react';

function Bone({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`hub-skeleton-shimmer ${className}`} />;
}

export function AetherHubSkeleton({ label = '正在装载灵境…' }: { label?: string }) {
  return (
    <div
      className="aetherhub-workspace fixed inset-0 flex overflow-hidden bg-[var(--bg-void)] text-[var(--ink-primary)]"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <div className="aurora-layer opacity-60" data-animated="true" aria-hidden="true" />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'var(--hub-canvas-overlay)' }}
        aria-hidden="true"
      />

      <div className="relative z-10 grid h-full min-h-0 w-full grid-cols-1 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_320px]">
        <aside className="hidden h-full min-h-0 border-r border-[var(--hub-border)] bg-[var(--hub-panel)] p-4 lg:flex lg:flex-col">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--hub-soft)] text-[var(--hub-accent-text)]">
                <Sparkles size={18} />
              </span>
              <div className="space-y-2">
                <Bone className="h-4 w-28 rounded-full" />
                <Bone className="h-3 w-20 rounded-full" />
              </div>
            </div>
            <Bone className="h-9 w-9 rounded-full" />
          </div>

          <Bone className="h-11 rounded-2xl" />
          <div className="mt-5 space-y-2">
            <Bone className="h-3 w-16 rounded-full" />
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="rounded-2xl border border-[var(--hub-border)] p-3">
                <Bone className="h-3.5 w-4/5 rounded-full" />
                <Bone className="mt-2 h-3 w-1/2 rounded-full" />
              </div>
            ))}
          </div>

          <div className="mt-auto flex items-center gap-3 rounded-2xl border border-[var(--hub-border)] p-3">
            <Bone className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Bone className="h-3.5 w-24 rounded-full" />
              <Bone className="h-3 w-14 rounded-full" />
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col border-x border-[var(--hub-border)]">
          <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-[var(--hub-border)] px-5">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--hub-soft)] text-[var(--hub-accent-text)]">
                <Brain size={18} />
              </span>
              <div className="space-y-2">
                <Bone className="h-4 w-32 rounded-full" />
                <Bone className="h-3 w-44 rounded-full" />
              </div>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <Bone className="h-9 w-28 rounded-full" />
              <Bone className="h-9 w-9 rounded-full" />
              <Bone className="h-9 w-9 rounded-full" />
            </div>
          </header>

          <div className="flex-1 overflow-hidden px-4 py-6 sm:px-8">
            <div className="mx-auto flex h-full max-w-4xl flex-col justify-end gap-5">
              <div className="ml-auto w-[56%] max-w-md rounded-3xl border border-[var(--hub-border-strong)] bg-[var(--hub-soft)] p-4">
                <Bone className="h-4 w-full rounded-full" />
                <Bone className="mt-2 h-4 w-2/3 rounded-full" />
              </div>

              <div className="mr-auto w-[92%] max-w-3xl rounded-3xl border border-[var(--hub-border)] bg-[var(--hub-panel)] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Bone className="h-9 w-9 rounded-2xl" />
                    <Bone className="h-4 w-28 rounded-full" />
                  </div>
                  <Bone className="h-4 w-40 rounded-full" />
                </div>
                <Bone className="h-28 rounded-2xl" />
                <Bone className="mt-4 h-4 w-full rounded-full" />
                <Bone className="mt-2 h-4 w-5/6 rounded-full" />
                <Bone className="mt-2 h-4 w-2/3 rounded-full" />
              </div>

              <p className="text-center font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)]">
                {label}
              </p>
            </div>
          </div>

          <div className="mx-auto w-full max-w-4xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8">
            <div className="rounded-[28px] border border-[var(--hub-border-strong)] bg-[var(--hub-panel)] p-4">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Bone className="h-7 w-48 rounded-full" />
                <Bone className="h-7 w-24 rounded-full" />
              </div>
              <Bone className="h-14 rounded-2xl" />
              <div className="mt-4 flex items-center justify-between">
                <Bone className="h-9 w-44 rounded-2xl" />
                <Bone className="h-11 w-11 rounded-2xl" />
              </div>
            </div>
          </div>
        </main>

        <aside className="hidden h-full min-h-0 border-l border-[var(--hub-border)] bg-[var(--hub-panel)] p-4 xl:flex xl:flex-col">
          <div className="mb-4 flex items-center justify-between">
            <Bone className="h-4 w-24 rounded-full" />
            <Bone className="h-8 w-8 rounded-full" />
          </div>
          <div className="space-y-3">
            <Bone className="h-20 rounded-2xl" />
            <Bone className="h-20 rounded-2xl" />
            <Bone className="h-28 rounded-2xl" />
          </div>
        </aside>
      </div>
    </div>
  );
}
