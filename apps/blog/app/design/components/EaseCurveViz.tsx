'use client';

import { useState } from 'react';

interface EaseCurveVizProps {
  name: string;
  cubic: [number, number, number, number];
  duration?: number;
  description?: string;
}

/**
 * SVG 可视化 cubic-bezier 曲线 + 点击触发真实动画演示。
 * 点击后圆点从左到右运动一次,曲线决定运动速率。
 */
export default function EaseCurveViz({
  name,
  cubic,
  duration = 800,
  description,
}: EaseCurveVizProps) {
  const [playing, setPlaying] = useState(false);
  const [x1, y1, x2, y2] = cubic;
  const cubicStr = `cubic-bezier(${cubic.join(', ')})`;

  const play = () => {
    if (playing) return;
    setPlaying(true);
    window.setTimeout(() => setPlaying(false), duration + 50);
  };

  // SVG 视图:100x100,y 轴翻转(视觉上 0 在底部)
  return (
    <button
      type="button"
      onClick={play}
      className="surface-leaf block w-full p-5 text-left rounded-xl group focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
      data-interactive
      aria-label={`播放 ${name} 动画样本`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--aurora-1)]">
          {name}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
          {duration}ms
        </span>
      </div>

      <svg
        viewBox="0 0 100 100"
        className="w-full h-32 mb-3"
        aria-hidden="true"
      >
        {/* 网格 */}
        <rect x="0" y="0" width="100" height="100" fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.5" />
        <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.5" />
        <line x1="50" y1="0" x2="50" y2="100" stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.5" />
        {/* 曲线 */}
        <path
          d={`M 0 100 C ${x1 * 100} ${100 - y1 * 100} ${x2 * 100} ${100 - y2 * 100} 100 0`}
          fill="none"
          stroke="var(--aurora-1)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* 控制点 */}
        <circle cx={x1 * 100} cy={100 - y1 * 100} r="1.8" fill="var(--aurora-2)" />
        <circle cx={x2 * 100} cy={100 - y2 * 100} r="1.8" fill="var(--aurora-2)" />
      </svg>

      {/* 演示轨道:圆点沿水平方向运动 */}
      <div className="relative h-2 rounded-full bg-[var(--ink-subtle)]/30 overflow-hidden">
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[var(--aurora-1)]"
          style={{
            left: playing ? 'calc(100% - 16px)' : '0',
            transition: playing ? `left ${duration}ms ${cubicStr}` : 'none',
            boxShadow: '0 0 12px var(--aurora-1)',
          }}
        />
      </div>

      <div className="mt-3 font-mono text-[10px] text-[var(--ink-muted)] truncate">
        {cubicStr}
      </div>
      {description && (
        <div className="mt-1 text-[11px] text-[var(--ink-secondary)]/80">{description}</div>
      )}
    </button>
  );
}
