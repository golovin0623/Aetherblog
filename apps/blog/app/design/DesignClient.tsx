'use client';

import ScrollSection from './components/ScrollSection';
import S1_Manifesto from './sections/S1_Manifesto';
import S2_Color from './sections/S2_Color';
import S3_Typography from './sections/S3_Typography';
import S4_Surface from './sections/S4_Surface';
import S5_Motion from './sections/S5_Motion';
import S6_Signature from './sections/S6_Signature';
import S7_Reasoning from './sections/S7_Reasoning';
import S8_CTA from './sections/S8_CTA';

interface DesignClientProps {
  siteTitle: string;
}

/**
 * /design · 设计系统的推理链
 * 8 节交替深浅底色;各节通过 ScrollSection 的 intersection-observer 懒入场。
 */
export default function DesignClient({ siteTitle }: DesignClientProps) {
  return (
    <main className="relative">
      {/* S1 · Manifesto */}
      <ScrollSection className="bg-[var(--bg-void)]" id="manifesto">
        {(isVisible: boolean) => <S1_Manifesto isVisible={isVisible} siteTitle={siteTitle} />}
      </ScrollSection>

      {/* S2 · Color · OKLCH hue slider */}
      <ScrollSection className="bg-[var(--bg-substrate)]" id="color">
        {(isVisible: boolean) => <S2_Color isVisible={isVisible} />}
      </ScrollSection>

      {/* S3 · Typography · 9 级阶梯 + 四角色 */}
      <ScrollSection className="bg-[var(--bg-void)]" id="type">
        {(isVisible: boolean) => <S3_Typography isVisible={isVisible} />}
      </ScrollSection>

      {/* S4 · Surface · 4 层玻璃 */}
      <ScrollSection className="bg-[var(--bg-substrate)]" id="surface">
        {(isVisible: boolean) => <S4_Surface isVisible={isVisible} />}
      </ScrollSection>

      {/* S5 · Motion · 曲线与节奏 */}
      <ScrollSection className="bg-[var(--bg-void)]" id="motion">
        {(isVisible: boolean) => <S5_Motion isVisible={isVisible} />}
      </ScrollSection>

      {/* S6 · Signature Moments · 五个签名时刻 */}
      <ScrollSection className="bg-[var(--bg-substrate)]" id="signature">
        {(isVisible: boolean) => <S6_Signature isVisible={isVisible} />}
      </ScrollSection>

      {/* S7 · Reasoning · 八问八答 */}
      <ScrollSection className="bg-[var(--bg-void)]" id="reasoning">
        {(isVisible: boolean) => <S7_Reasoning isVisible={isVisible} />}
      </ScrollSection>

      {/* S8 · CTA */}
      <ScrollSection className="bg-[var(--bg-substrate)]" id="coda">
        {(isVisible: boolean) => <S8_CTA isVisible={isVisible} />}
      </ScrollSection>
    </main>
  );
}
