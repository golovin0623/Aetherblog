'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function TimelineError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen bg-background text-[var(--text-primary)] selection:bg-primary/30">
      <main className="max-w-4xl mx-auto px-4 pt-32 pb-24 md:pb-12">
        <div className="relative mb-8 pl-4">
          <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">时间轴</h1>
          <p className="text-[var(--text-muted)] text-sm italic">数据暂时无法加载</p>
          <div className="absolute left-0 top-1 bottom-1 w-1 bg-gradient-to-b from-primary to-accent rounded-full" />
        </div>

        <div className="surface-leaf text-center py-12 px-6">
          <AlertTriangle className="h-12 w-12 text-primary/70 mx-auto mb-4" />
          <p className="text-[var(--text-secondary)] text-lg font-medium">时间轴加载失败</p>
          <p className="text-[var(--text-muted)] text-sm mt-2">
            可能是网络波动或服务短暂不可用，请稍后重试。
          </p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 mt-6 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-leaf)]"
          >
            <RotateCcw className="w-4 h-4" />
            重试
          </button>
        </div>
      </main>
    </div>
  );
}
