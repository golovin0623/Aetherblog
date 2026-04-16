'use client';

import TypeScaleRow from '../components/TypeScaleRow';

interface Props {
  isVisible: boolean;
}

export default function S3_Typography({ isVisible }: Props) {
  const scale = [
    { token: '--fs-micro',   px: '11px', usage: '时间戳', sample: '2026-04-17 22:04', className: 'text-[11px] tabular-nums', fontClass: 'font-mono' },
    { token: '--fs-caption', px: '13px', usage: '边注',  sample: 'Published · 4 min read', className: 'text-[13px]', fontClass: 'font-mono' },
    { token: '--fs-body',    px: '16px', usage: 'UI 默认', sample: '默认 UI 文本 —— 表单、按钮、列表。', className: 'text-[16px]' },
    { token: '--fs-reading', px: '18px', usage: '文章正文', sample: '翻开一本被精心排印的书。', className: 'text-[18px] leading-relaxed' },
    { token: '--fs-lede',    px: '20px', usage: '导语',    sample: '导语用 Instrument Serif 斜体。', className: 'text-[20px] italic leading-relaxed' },
    { token: '--fs-h4',      px: '24px', usage: 'h4',    sample: '小节标题', className: 'text-[24px]' },
    { token: '--fs-h3',      px: '30px', usage: 'h3',    sample: '章节副题', className: 'text-[30px]' },
    { token: '--fs-h2',      px: '40px', usage: 'h2',    sample: '§ 章节标记', className: 'text-[40px] tracking-[-0.01em]' },
    { token: '--fs-h1',      px: '56px', usage: 'h1',    sample: '文章标题', className: 'text-[56px] leading-[1.05] tracking-[-0.02em]' },
  ];

  const fontRoles = [
    { name: 'Display', sample: 'Aether Codex', className: 'font-display text-4xl', note: '大标题 · Fraunces/Playfair (opsz 可变)' },
    { name: 'Editorial', sample: '当你拂过一行字', className: 'font-editorial italic text-2xl', note: '导语与正文 · Instrument Serif/Noto Serif' },
    { name: 'Sans', sample: 'UI defaults — buttons, lists.', className: 'font-sans text-lg', note: 'UI/数据 · Geist/Inter' },
    { name: 'Mono', sample: 'const aurora = oklch(0.72 0.15 270);', className: 'font-mono text-sm', note: '代码/数字 · Geist Mono' },
  ];

  return (
    <div className="w-full max-w-5xl mx-auto space-y-12">
      <header className="text-center space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--aurora-1)]/80">
          §3 · Typography · 9 级阶梯 + 四角色
        </div>
        <h2 className="font-display text-[clamp(2rem,4.5vw,3rem)] text-[var(--ink-primary)] tracking-[-0.015em]">
          一套字号,四个角色
        </h2>
        <p className="font-editorial italic text-[var(--ink-secondary)] text-lg max-w-2xl mx-auto">
          9 级音阶(Perfect Fourth),不允许越级。每个字号都有唯一用途。
        </p>
      </header>

      <section aria-labelledby="type-scale" className="surface-leaf rounded-xl p-6 md:p-10">
        <h3 id="type-scale" className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)] mb-4 pb-4 border-b border-[var(--ink-subtle)]/30">
          Scale · token × px × usage × sample
        </h3>
        <div>
          {scale.map((row) => (
            <TypeScaleRow key={row.token} {...row} />
          ))}
        </div>
      </section>

      <section aria-labelledby="type-roles" className="space-y-4">
        <h3 id="type-roles" className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
          Font Roles · 四个角色各司其职
        </h3>
        <div className="grid md:grid-cols-2 gap-4">
          {fontRoles.map((r) => (
            <div key={r.name} className="surface-leaf rounded-xl p-6 space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--aurora-1)]/90">
                  {r.name}
                </span>
                <span className="font-mono text-[10px] text-[var(--ink-muted)]">{r.note}</span>
              </div>
              <div className={`${r.className} text-[var(--ink-primary)]`}>{r.sample}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
