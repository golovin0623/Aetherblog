'use client';

interface AuroraSwatchProps {
  label: string;
  /** OKLCH L 分量 */
  l: number;
  /** OKLCH C 分量 */
  c: number;
  /** OKLCH H 分量(度) */
  h: number;
  /** 派生公式文字,用于下方展示 */
  formula?: string;
}

/**
 * 单个极光色样本 —— 使用 OKLCH 数值驱动,
 * 同时在 swatch 下方展示精确的 L/C/H 数值与派生公式。
 * 对 CVD 用户同时提供数值冗余,保证可辨识。
 */
export default function AuroraSwatch({ label, l, c, h, formula }: AuroraSwatchProps) {
  const color = `oklch(${l.toFixed(2)} ${c.toFixed(3)} ${h.toFixed(0)})`;

  return (
    <figure className="surface-leaf flex flex-col overflow-hidden rounded-xl">
      <div
        className="h-28 w-full transition-[background] duration-[520ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ background: color }}
        aria-hidden="true"
      />
      <figcaption className="p-4 font-mono text-[11px] leading-relaxed space-y-1">
        <div className="flex items-center justify-between">
          <span className="uppercase tracking-[0.2em] text-[var(--ink-muted)]">{label}</span>
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        </div>
        <div className="tabular-nums text-[var(--ink-secondary)]">
          L {l.toFixed(2)} · C {c.toFixed(3)} · H {h.toFixed(0)}°
        </div>
        {formula && (
          <div className="pt-1 text-[10px] text-[var(--ink-muted)]/80 border-t border-[var(--ink-subtle)]/30">
            {formula}
          </div>
        )}
      </figcaption>
    </figure>
  );
}
