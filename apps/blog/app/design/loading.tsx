export default function DesignLoading() {
  return (
    <div className="min-h-screen bg-[var(--bg-void)] flex items-center justify-center">
      <div className="max-w-4xl mx-auto text-center px-4 space-y-8">
        <div className="flex justify-center">
          <div className="h-4 w-40 rounded-full bg-[var(--ink-subtle)]/20 animate-pulse" />
        </div>
        <div className="space-y-4 flex flex-col items-center">
          <div className="h-14 w-[28rem] max-w-full rounded-lg bg-[var(--ink-subtle)]/20 animate-pulse" />
          <div className="h-6 w-72 rounded-lg bg-[var(--ink-subtle)]/10 animate-pulse" />
        </div>
        <div className="space-y-3 flex flex-col items-center">
          <div className="h-4 w-96 max-w-full rounded bg-[var(--ink-subtle)]/10 animate-pulse" />
          <div className="h-4 w-80 rounded bg-[var(--ink-subtle)]/10 animate-pulse" />
          <div className="h-4 w-64 rounded bg-[var(--ink-subtle)]/10 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
