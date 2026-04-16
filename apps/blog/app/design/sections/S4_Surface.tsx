'use client';

interface Props {
  isVisible: boolean;
}

const surfaces = [
  {
    name: 'surface-leaf',
    title: 'Leaf',
    blurb: '文档流中的卡片 · 95% 场景',
    className: 'surface-leaf',
  },
  {
    name: 'surface-raised',
    title: 'Raised',
    blurb: 'sticky header · floating panel',
    className: 'surface-raised',
  },
  {
    name: 'surface-overlay',
    title: 'Overlay',
    blurb: 'Modal · 命令面板 · 极光边',
    className: 'surface-overlay',
  },
  {
    name: 'surface-luminous',
    title: 'Luminous',
    blurb: '签名稀有卡片 · 一页最多一个',
    className: 'surface-luminous',
  },
];

export default function S4_Surface({ isVisible }: Props) {
  return (
    <div className="w-full max-w-5xl mx-auto space-y-10">
      <header className="text-center space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--aurora-1)]/80">
          §4 · Surface · 四层玻璃
        </div>
        <h2 className="font-display text-[clamp(2rem,4.5vw,3rem)] text-[var(--ink-primary)] tracking-[-0.015em]">
          四层,不是第五层
        </h2>
        <p className="font-editorial italic text-[var(--ink-secondary)] text-lg max-w-2xl mx-auto">
          鼠标悬停 —— leaf 与 raised 上会浮现左侧极光光带,那是「可交互」的签名。
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {surfaces.map((s) => (
          <figure
            key={s.name}
            className={`${s.className} relative rounded-2xl p-8 min-h-[200px] flex flex-col justify-between`}
            data-interactive
          >
            <div className="space-y-1">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--aurora-1)]/90">
                {s.name}
              </div>
              <div className="font-display text-3xl text-[var(--ink-primary)]">{s.title}</div>
            </div>
            <figcaption className="pt-6 font-editorial italic text-[var(--ink-secondary)]/90">
              {s.blurb}
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="text-center text-sm text-[var(--ink-secondary)]/70 max-w-xl mx-auto leading-relaxed">
        决策路径:<strong className="text-[var(--ink-primary)]">浮于文档?</strong> 否→leaf · Modal? 是→overlay · 页面签名? 是→luminous · 默认→raised
      </div>
    </div>
  );
}
