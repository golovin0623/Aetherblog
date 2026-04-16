'use client';

import Link from 'next/link';

interface Props {
  isVisible: boolean;
}

export default function S8_CTA({ isVisible }: Props) {
  return (
    <div className="w-full max-w-3xl mx-auto text-center space-y-10 py-10">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--aurora-1)]/80">
        §8 · Coda · 尾声
      </div>

      <h2 className="font-display text-[clamp(2rem,4.5vw,3rem)] text-[var(--ink-primary)] tracking-[-0.015em]">
        这是骨架,不是终点
      </h2>

      <p className="font-editorial italic text-lg md:text-xl text-[var(--ink-secondary)] max-w-2xl mx-auto leading-relaxed">
        设计系统最难的不是做加法,是做减法 —— 到今天为止,
        每周都会有新组件加入,也会有旧组件被删除。这份规范会持续滚动更新。
      </p>

      <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-6">
        <Link
          href="/"
          className="surface-leaf px-7 py-3 rounded-full font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--ink-primary)] hover:text-[var(--aurora-1)] transition-colors"
          data-interactive
        >
          ← 回到首页
        </Link>
        <Link
          href="/about"
          className="px-7 py-3 rounded-full font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--ink-muted)] hover:text-[var(--ink-primary)] transition-colors"
        >
          关于作者
        </Link>
      </div>

      <div className="pt-10 font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]/60">
        AetherBlog · Aether Codex · v1 · 2026
      </div>
    </div>
  );
}
