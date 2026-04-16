'use client';

import EaseCurveViz from '../components/EaseCurveViz';

interface Props {
  isVisible: boolean;
}

const curves: Array<{
  name: string;
  cubic: [number, number, number, number];
  duration: number;
  description: string;
}> = [
  {
    name: 'ease.emphasis',
    cubic: [0.16, 1, 0.3, 1],
    duration: 800,
    description: 'Expo Out · 戏剧化,签名时刻专用',
  },
  {
    name: 'ease.standard',
    cubic: [0.32, 0.72, 0, 1],
    duration: 520,
    description: 'Apple Material · UI 默认',
  },
  {
    name: 'ease.enter',
    cubic: [0.22, 0.61, 0.36, 1],
    duration: 560,
    description: '入场 · 略过冲再回',
  },
  {
    name: 'ease.exit',
    cubic: [0.4, 0, 0.68, 0.06],
    duration: 260,
    description: '离场 · 先快后慢',
  },
];

export default function S5_Motion({ isVisible }: Props) {
  return (
    <div className="w-full max-w-5xl mx-auto space-y-10">
      <header className="text-center space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--aurora-1)]/80">
          §5 · Motion · 缓动与节奏
        </div>
        <h2 className="font-display text-[clamp(2rem,4.5vw,3rem)] text-[var(--ink-primary)] tracking-[-0.015em]">
          四条曲线,四种语义
        </h2>
        <p className="font-editorial italic text-[var(--ink-secondary)] text-lg max-w-2xl mx-auto">
          点击任意卡片 —— 圆点会按该曲线运动一次,曲线形状即节奏本身。
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {curves.map((c) => (
          <EaseCurveViz key={c.name} {...c} />
        ))}
      </div>

      <div className="text-center text-sm text-[var(--ink-secondary)]/70 max-w-xl mx-auto leading-relaxed font-mono tabular-nums">
        stagger = √N × 20ms · 3 子 ≈ 35ms · 6 子 ≈ 49ms · 12 子 ≈ 69ms
      </div>
    </div>
  );
}
