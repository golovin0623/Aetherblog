'use client';

import CodeSample from '../components/CodeSample';

interface Props {
  isVisible: boolean;
}

interface QA {
  q: string;
  a: React.ReactNode;
  code?: { language: string; code: string; caption?: string };
}

const qaList: QA[] = [
  {
    q: '为什么拒绝 Inter 作为标题字体?',
    a: (
      <>
        Inter 是 UI 字体,不是排印字体。它的字形针对「小字号信息密度」优化 —— tabular 数字好看、中性、
        在 14px 极度清晰。但用作 h1 display,它没有衬线、没有 opsz、没有 WONK 轴,失去了「印刷物」质感。
        AetherBlog 是典籍,不是 Dashboard。Fraunces 的 opsz 144 + SOFT 30↔80 才是大字应有的呼吸。
      </>
    ),
  },
  {
    q: '为什么极光是唯一光源?',
    a: (
      <>
        「光源唯一」是反 Dribbble 最硬的一条约束。大部分「紫色渐变 AI 产品」之所以廉价,就是因为每个卡片都在发光。
        Apple 的 iOS 只用一处 wallpaper 作为光源,所有组件都是<strong className="text-[var(--ink-primary)]">反射光</strong>。
        我们照做:首页 body::before 铺一次
        aurora-field,admin 主区铺一次,其他任何位置禁止 radial-gradient。
      </>
    ),
  },
  {
    q: '为什么 aurora-4 取 h + 60° 而不是补色 + 180°?',
    a: (
      <>
        同色系邻近保持「一片光」的感觉,补色会把画面撕成两片。Rauno 在 Vercel 2023 Dash 的极光就是
        +40-60° 的邻近演化,不是冷暖对比。chroma 随 hue 推远逐步降低(0.92→0.68),避免高饱和度撞眼。
      </>
    ),
    code: {
      language: 'css',
      caption: 'tokens.css · 派生公式',
      code: `--aurora-4: oklch(from var(--color-primary)
  calc(l + 0.08)
  calc(c * 0.68)
  calc(h + 60)
);`,
    },
  },
  {
    q: '为什么文章正文用 Instrument Serif 而不是 Source Han Serif?',
    a: (
      <>
        Instrument Serif 有<strong className="text-[var(--ink-primary)]">真实的斜体字形</strong>,
        不是浏览器合成的 skew。斜体引语、斜体 lede 的「书卷气」
        依赖于真斜体而非倾斜罗马。Noto Serif SC 负责中文字符渲染,我们通过 unicode-range 让拉丁字符走
        Instrument Serif,中文走 Noto Serif —— 一段文字里两种文字用两种字体,视觉重量一致。
      </>
    ),
  },
  {
    q: '为什么呼吸周期从 7.2s 改为 4.8s?',
    a: (
      <>
        人类静息呼吸频率 12-20 次/分,周期 3-5 秒。7.2s 是冥想频率,作为首页 Hero 会让用户「感到迟钝」。
        4.8s 落在呼吸下限 + 审美余裕里。关键帧不是匀速:吸气占 40% 时间(快),呼气占 60%(慢),
        用 cubic-bezier(0.5, 0, 0.25, 1) 模拟生理节奏。
      </>
    ),
  },
  {
    q: '为什么 4 层 surface 不肯拆成 6 层?',
    a: (
      <>
        每多一层 surface,组件作者的决策疲劳翻倍。4 层对应 4 种场景:文档流(leaf)、浮起(raised)、
        覆盖(overlay)、签名(luminous)。更多层意味着 2 周后「这到底该用哪层」的争议。
        <strong className="text-[var(--ink-primary)]">好系统强制选择,不允许模糊地带。</strong>
      </>
    ),
  },
  {
    q: '为什么 drop cap 取消了 aurora 渐变?',
    a: (
      <>
        衬线字体在 opsz 144 下有丰富的 ink trap(字肩、衬线端点的小凹槽),渐变填充会在这些位置产生采样锯齿。
        印刷物里 drop cap 要么<strong className="text-[var(--ink-primary)]">烫金</strong>(单色 + 微凸)要么<strong className="text-[var(--ink-primary)]">纯墨</strong>,
        从不渐变。我们保留极细 1px 金色 text-shadow
        作为致敬,而字形本身是纯墨。
      </>
    ),
    code: {
      language: 'css',
      caption: 'globals.css · 新 drop cap',
      code: `.markdown-body > p:first-of-type::first-letter {
  font-size: 3.6em;          /* = 3 × line-height */
  font-weight: 400;           /* Book —— 不能 600 */
  font-style: normal;         /* 不要 italic */
  color: var(--ink-primary);  /* 纯墨 */
  text-shadow: 0 1px 0 color-mix(in oklch, var(--aurora-1) 22%, transparent);
}`,
    },
  },
  {
    q: '为什么所有信号色 OKLCH L 要对齐?',
    a: (
      <>
        5% 人口有红绿色盲(deuteranopia)。如果 --signal-success 和 --signal-info 只靠 hue 区分而 L 一致,
        CVD 用户看到的是两个相同灰度的方块,完全无法分辨「成功」和「信息」。我们强制 L/C/H 三维都拉开,
        同时要求所有信号色必须绑定图标(✓ ⚠ ⓘ ✕),不允许仅靠颜色传递状态。这是 Apple HIG 2024 的硬要求。
      </>
    ),
  },
];

export default function S7_Reasoning({ isVisible }: Props) {
  return (
    <div className="w-full max-w-4xl mx-auto space-y-12">
      <header className="text-center space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--aurora-1)]/80">
          §7 · Reasoning · 八问八答
        </div>
        <h2 className="font-display text-[clamp(2rem,4.5vw,3rem)] text-[var(--ink-primary)] tracking-[-0.015em]">
          为什么这样决定
        </h2>
        <p className="font-editorial italic text-[var(--ink-secondary)] text-lg max-w-2xl mx-auto">
          设计系统的价值不在决定本身,在决定的推理链可被公开审查。
        </p>
      </header>

      <article className="space-y-14">
        {qaList.map((qa, i) => (
          <section key={i} className="space-y-4">
            <h3 className="font-display text-xl md:text-2xl text-[var(--ink-primary)] leading-snug">
              <span className="font-mono text-[12px] tabular-nums text-[var(--aurora-1)]/80 mr-3 align-middle">
                0{i + 1}
              </span>
              {qa.q}
            </h3>
            <div className="font-editorial text-[17px] leading-[1.85] text-[var(--ink-secondary)] md:pl-10">
              {qa.a}
            </div>
            {qa.code && (
              <div className="md:pl-10 pt-2">
                <CodeSample
                  language={qa.code.language}
                  code={qa.code.code}
                  caption={qa.code.caption}
                />
              </div>
            )}
          </section>
        ))}
      </article>
    </div>
  );
}
