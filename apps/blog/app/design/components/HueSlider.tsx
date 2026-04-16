'use client';

import { useId } from 'react';

interface HueSliderProps {
  hue: number;
  onChange: (hue: number) => void;
  label?: string;
}

/**
 * OKLCH Hue 控制器 —— 取值 0-360°。
 * 通过 `<input type="range">` + `conic-gradient` 背景条形成色环指示。
 */
export default function HueSlider({ hue, onChange, label = '主色 Hue' }: HueSliderProps) {
  const id = useId();
  const displayHex = `oklch(0.72 0.15 ${hue})`;

  return (
    <div className="w-full max-w-xl space-y-2">
      <label
        htmlFor={id}
        className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]"
      >
        <span>{label}</span>
        <span className="tnum tabular-nums text-[var(--ink-secondary)]">{hue}°</span>
      </label>

      <div className="relative h-9 rounded-full p-1 border border-[var(--ink-subtle)]/40 bg-[var(--bg-leaf)]/50 backdrop-blur-sm">
        {/* 色环底条 —— 全 360° conic 投影为线性 */}
        <div
          className="absolute inset-1 rounded-full pointer-events-none"
          style={{
            background:
              'linear-gradient(to right, oklch(0.72 0.15 0), oklch(0.72 0.15 60), oklch(0.72 0.15 120), oklch(0.72 0.15 180), oklch(0.72 0.15 240), oklch(0.72 0.15 300), oklch(0.72 0.15 360))',
            opacity: 0.7,
          }}
        />
        <input
          id={id}
          type="range"
          min={0}
          max={360}
          value={hue}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
          className="relative z-10 w-full h-7 appearance-none bg-transparent cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-5
            [&::-webkit-slider-thumb]:h-5
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-white
            [&::-webkit-slider-thumb]:border-2
            [&::-webkit-slider-thumb]:border-[var(--aurora-1)]
            [&::-webkit-slider-thumb]:shadow-lg
            [&::-webkit-slider-thumb]:cursor-grab
            [&::-moz-range-thumb]:w-5
            [&::-moz-range-thumb]:h-5
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-white
            [&::-moz-range-thumb]:border-2
            [&::-moz-range-thumb]:border-[var(--aurora-1)]"
          style={{ accentColor: displayHex }}
        />
      </div>
    </div>
  );
}
