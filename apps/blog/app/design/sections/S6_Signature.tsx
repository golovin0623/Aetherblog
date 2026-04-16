'use client';

interface Props {
  isVisible: boolean;
}

export default function S6_Signature({ isVisible }: Props) {
  return (
    <div className="w-full max-w-5xl mx-auto space-y-10">
      <header className="text-center space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--aurora-1)]/80">
          §6 · Signature Moments
        </div>
        <h2 className="font-display text-[clamp(2rem,4.5vw,3rem)] text-[var(--ink-primary)] tracking-[-0.015em]">
          五个签名时刻
        </h2>
        <p className="font-editorial italic text-[var(--ink-secondary)] text-lg max-w-2xl mx-auto">
          完美让人忘记,签名让人记住。每一处都是 live,不是截图。
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Breath —— Fraunces 可变字体呼吸 */}
        <figure className="surface-leaf rounded-2xl p-8 flex flex-col justify-between min-h-[200px]">
          <figcaption className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--aurora-1)]/90">
            #01 · Breath · 呼吸标题
          </figcaption>
          <div className="py-8 text-center">
            <span
              className="font-display text-4xl md:text-5xl text-[var(--ink-primary)]"
              style={{ animation: 'breath-soft 4.8s cubic-bezier(0.5, 0, 0.25, 1) infinite' }}
            >
              Aether
            </span>
          </div>
          <div className="font-mono text-[10px] text-[var(--ink-muted)] text-right">
            4.8s · opacity + letter-spacing + brightness
          </div>
        </figure>

        {/* Ink cursor —— 命令面板 / AI 流式 */}
        <figure className="surface-leaf rounded-2xl p-8 flex flex-col justify-between min-h-[200px]">
          <figcaption className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--aurora-1)]/90">
            #02 · Ink Cursor · 墨水光标
          </figcaption>
          <div className="py-8 text-center">
            <span className="font-editorial italic text-2xl text-[var(--ink-primary)]">
              思想正在成形
              <span className="ink-cursor" aria-hidden="true" />
            </span>
          </div>
          <div className="font-mono text-[10px] text-[var(--ink-muted)] text-right">
            800ms blink · aurora-1 background
          </div>
        </figure>

        {/* Aurora text —— 渐变字 */}
        <figure className="surface-leaf rounded-2xl p-8 flex flex-col justify-between min-h-[200px]">
          <figcaption className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--aurora-1)]/90">
            #03 · Aurora Text · 极光字
          </figcaption>
          <div className="py-8 text-center">
            <span className="aurora-text font-display text-4xl md:text-5xl">
              发光典籍
            </span>
          </div>
          <div className="font-mono text-[10px] text-[var(--ink-muted)] text-right">
            linear-gradient · aurora-1/2/4
          </div>
        </figure>

        {/* Cmd chip —— 命令面板模式标签 */}
        <figure className="surface-leaf rounded-2xl p-8 flex flex-col justify-between min-h-[200px]">
          <figcaption className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--aurora-1)]/90">
            #04 · Command Chip · 命令芯片
          </figcaption>
          <div className="py-8 text-center flex justify-center gap-3 flex-wrap">
            <span className="cmd-chip">nav</span>
            <span className="cmd-chip">ask</span>
            <span className="cmd-chip">cmd</span>
            <span className="cmd-chip">tag</span>
          </div>
          <div className="font-mono text-[10px] text-[var(--ink-muted)] text-right">
            prefix routing · &gt; / ? #
          </div>
        </figure>

        {/* Drop cap —— 首字下沉 */}
        <figure className="surface-leaf rounded-2xl p-8 md:col-span-2">
          <figcaption className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--aurora-1)]/90 mb-4">
            #05 · Drop Cap · 首字下沉
          </figcaption>
          <div className="drop-cap font-editorial text-lg leading-relaxed text-[var(--ink-primary)]/90 max-w-prose">
            <p>
              纸的厚度不重要,墨的精度才是。在屏幕上模拟出版物的质感,
              关键不在造型而在克制 —— 正体、3.6em、纯墨色、极细描金。
              这是 2026 版 Aether Codex 在 drop cap 上的全部规则。
            </p>
          </div>
          <div className="mt-4 font-mono text-[10px] text-[var(--ink-muted)] text-right">
            initial-letter: 3 drop 2 · font-family: var(--font-editorial)
          </div>
        </figure>
      </div>
    </div>
  );
}
