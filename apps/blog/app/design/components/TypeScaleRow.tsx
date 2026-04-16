'use client';

interface TypeScaleRowProps {
  token: string;
  px: string;
  usage: string;
  sample: string;
  fontClass?: string;
  className?: string;
}

/**
 * 单行字号展示 —— 左侧 token 标识,中间 px 与用途说明,右侧真实大小样本。
 * sample 文字用 className 里的字体类直接渲染,确保视觉即真实。
 */
export default function TypeScaleRow({
  token,
  px,
  usage,
  sample,
  fontClass = 'font-editorial',
  className = '',
}: TypeScaleRowProps) {
  return (
    <div className="grid grid-cols-[140px_1fr] md:grid-cols-[180px_100px_1fr] gap-4 md:gap-8 items-baseline py-5 border-b border-[var(--ink-subtle)]/20">
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--aurora-1)]/90">
        {token}
      </div>
      <div className="hidden md:block font-mono text-[11px] tabular-nums text-[var(--ink-muted)]">
        {px} · {usage}
      </div>
      <div className="col-span-1 md:col-auto overflow-hidden">
        <div className="md:hidden font-mono text-[10px] text-[var(--ink-muted)] mb-1">
          {px} · {usage}
        </div>
        <span className={`${fontClass} ${className} text-[var(--ink-primary)]`}>
          {sample}
        </span>
      </div>
    </div>
  );
}
