'use client';

import type { SiteSettings } from '@/app/lib/services';
import ScrollSection from '../about/components/ScrollSection';
import HeroSection from './sections/HeroSection';
import ManifestoSection from './sections/ManifestoSection';
import CapabilitiesSection from './sections/CapabilitiesSection';
import ModesSection from './sections/ModesSection';
import EnterSection from './sections/EnterSection';

interface Props {
  settings: SiteSettings;
}

/**
 * /agent · Agent 入口落地页
 *
 * 设计参照 /about (8 节深浅交替) 与 /design (推理链公开) 两条规范：
 *  - bg-void / bg-substrate 交替；
 *  - 排版用 font-display + font-editorial + font-mono；
 *  - 不发明颜色，仅组合 ink-* / aurora-* tokens。
 *
 * 本页只负责"叙事 + 召唤进入"，进入后 (`/agent/workspace`) 才是真正的
 * 对话工作台。
 */
export default function AgentLandingClient({ settings }: Props) {
  return (
    <main className="relative">
      {/* S1 · Hero */}
      <ScrollSection className="bg-[var(--bg-void)]" id="agent-hero">
        {(isVisible: boolean) => <HeroSection isVisible={isVisible} />}
      </ScrollSection>

      {/* S2 · Manifesto */}
      <ScrollSection className="bg-[var(--bg-substrate)]" id="agent-manifesto">
        {(isVisible: boolean) => <ManifestoSection isVisible={isVisible} />}
      </ScrollSection>

      {/* S3 · Capabilities */}
      <ScrollSection className="bg-[var(--bg-void)]" id="agent-capabilities">
        {(isVisible: boolean) => <CapabilitiesSection isVisible={isVisible} />}
      </ScrollSection>

      {/* S4 · Three modes */}
      <ScrollSection className="bg-[var(--bg-substrate)]" id="agent-modes">
        {(isVisible: boolean) => <ModesSection isVisible={isVisible} />}
      </ScrollSection>

      {/* S5 · Enter CTA */}
      <ScrollSection className="bg-[var(--bg-void)]" id="agent-enter">
        {(isVisible: boolean) => <EnterSection isVisible={isVisible} siteTitle={settings.siteTitle || 'AetherBlog'} />}
      </ScrollSection>
    </main>
  );
}
