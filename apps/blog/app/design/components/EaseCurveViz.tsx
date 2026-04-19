'use client';

import { useEffect, useRef, useState } from 'react';

interface EaseCurveVizProps {
  name: string;
  cubic: [number, number, number, number];
  duration?: number;
  description?: string;
  /** 进入视口后自动循环演示;离开视口暂停。 */
  autoPlay?: boolean;
  /** 进入视口后首次起跑的额外延迟,用于多卡 stagger,默认 0。 */
  initialDelay?: number;
}

/**
 * SVG 可视化 cubic-bezier 曲线 + 真实动画演示。
 * autoPlay=true 时进入视口循环播放,圆点按曲线节奏从左到右滑过 → 0.5s
 * 静止 → 复位 → 2s 留白 → 下一轮。点击亦可手动触发。
 */
export default function EaseCurveViz({
  name,
  cubic,
  duration = 800,
  description,
  autoPlay = false,
  initialDelay = 0,
}: EaseCurveVizProps) {
  // phase: idle (左) → run (运动到右) → hold (停在右) → reset (复位到左)
  const [phase, setPhase] = useState<'idle' | 'run' | 'hold' | 'reset'>('idle');
  const timersRef = useRef<number[]>([]);
  const [x1, y1, x2, y2] = cubic;
  const cubicStr = `cubic-bezier(${cubic.join(', ')})`;

  // 单次播放周期 —— 把所有 setTimeout 收拢在一起,用 ref 跟踪以便清理
  const playOnce = () => {
    setPhase('run');
    const t1 = window.setTimeout(() => {
      setPhase('hold');
      const t2 = window.setTimeout(() => {
        // 复位用线性瞬移(无 transition),圆点直接弹回左边
        setPhase('reset');
        const t3 = window.setTimeout(() => setPhase('idle'), 30);
        timersRef.current.push(t3);
      }, 600);
      timersRef.current.push(t2);
    }, duration + 30);
    timersRef.current.push(t1);
  };

  // 手动点击:仅在 idle 时响应,避免连击叠状态
  const handleClick = () => {
    if (phase !== 'idle') return;
    playOnce();
  };

  // autoPlay loop:进入视口 → initialDelay 起跑 → 周期 = duration + 600 hold + 30 reset + 2200 rest
  useEffect(() => {
    if (!autoPlay) return;
    let cancelled = false;
    const cycle = duration + 600 + 30 + 2200;

    const start = window.setTimeout(() => {
      if (cancelled) return;
      playOnce();
      const interval = window.setInterval(() => {
        if (cancelled) return;
        playOnce();
      }, cycle);
      timersRef.current.push(interval);
    }, initialDelay);
    timersRef.current.push(start);

    return () => {
      cancelled = true;
      timersRef.current.forEach((id) => {
        window.clearTimeout(id);
        window.clearInterval(id);
      });
      timersRef.current = [];
      setPhase('idle');
    };
  }, [autoPlay, duration, initialDelay]);

  // 计算圆点 left + transition 表达
  const dotLeft = phase === 'run' || phase === 'hold' ? 'calc(100% - 16px)' : '0';
  const dotTransition =
    phase === 'run' ? `left ${duration}ms ${cubicStr}` : 'none';

  return (
    <button
      type="button"
      onClick={handleClick}
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
            left: dotLeft,
            transition: dotTransition,
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
