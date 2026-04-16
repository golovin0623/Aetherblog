'use client';

import { useState } from 'react';
import HueSlider from '../components/HueSlider';
import AuroraSwatch from '../components/AuroraSwatch';
import CodeSample from '../components/CodeSample';

interface Props {
  isVisible: boolean;
}

export default function S2_Color({ isVisible }: Props) {
  const [hue, setHue] = useState(270);

  const l = 0.72;
  const c = 0.15;
  // 派生公式(与 tokens.css 的 @supports 块对齐):
  // aurora-1 = 锚点
  // aurora-2 = l+0.02, c*0.92, h+18
  // aurora-3 = l+0.05, c*0.82, h+36
  // aurora-4 = l+0.08, c*0.68, h+60
  const swatches = [
    { label: 'aurora-1', l, c, h: hue, formula: '锚点 · primary' },
    { label: 'aurora-2', l: l + 0.02, c: c * 0.92, h: hue + 18, formula: 'h + 18° · c × 0.92' },
    { label: 'aurora-3', l: l + 0.05, c: c * 0.82, h: hue + 36, formula: 'h + 36° · c × 0.82' },
    { label: 'aurora-4', l: l + 0.08, c: c * 0.68, h: hue + 60, formula: 'h + 60° · c × 0.68' },
  ];

  return (
    <div className="w-full max-w-5xl mx-auto space-y-10">
      <header className="text-center space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--aurora-1)]/80">
          §2 · Color · OKLCH Aurora
        </div>
        <h2 className="font-display text-[clamp(2rem,4.5vw,3rem)] text-[var(--ink-primary)] tracking-[-0.015em]">
          一个光源,四色派生
        </h2>
        <p className="font-editorial italic text-[var(--ink-secondary)] text-lg max-w-2xl mx-auto">
          拖动下方 hue slider —— 四色实时从 primary 派生,同色系邻近而非补色。
        </p>
      </header>

      <div className="flex justify-center">
        <HueSlider hue={hue} onChange={setHue} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {swatches.map((s) => (
          <AuroraSwatch key={s.label} {...s} />
        ))}
      </div>

      <div className="max-w-2xl mx-auto">
        <CodeSample
          language="css"
          caption="派生公式 · tokens.css"
          code={`/* OKLCH 相对色语法:同色系邻近,chroma 随 hue 推远衰减 */
--aurora-1: oklch(from var(--color-primary) l c h);
--aurora-2: oklch(from var(--color-primary) calc(l+0.02) calc(c*0.92) calc(h+18));
--aurora-3: oklch(from var(--color-primary) calc(l+0.05) calc(c*0.82) calc(h+36));
--aurora-4: oklch(from var(--color-primary) calc(l+0.08) calc(c*0.68) calc(h+60));`}
        />
      </div>

      <div className="max-w-2xl mx-auto text-center text-sm text-[var(--ink-secondary)]/80 leading-relaxed">
        为什么 h+60° 而不是 h+180° 的补色?因为同色系邻近保持「一片光」的感觉,
        补色会撕开成两片。Aurora 是<strong className="text-[var(--ink-primary)]">光源</strong>,
        不是<strong className="text-[var(--ink-primary)]">对比色</strong>。
      </div>
    </div>
  );
}
