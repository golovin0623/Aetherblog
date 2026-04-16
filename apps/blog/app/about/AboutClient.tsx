'use client';

import type { SiteSettings } from '@/app/lib/services';
import HeroSection from './sections/HeroSection';
import DesignSection from './sections/DesignSection';
import AiSection from './sections/AiSection';
import SearchSection from './sections/SearchSection';
import EditorSection from './sections/EditorSection';
import TechStackSection from './sections/TechStackSection';
import SecuritySection from './sections/SecuritySection';
import AuthorCTASection from './sections/AuthorCTASection';
import ScrollSection from './components/ScrollSection';

interface AboutClientProps {
  settings: SiteSettings;
  stats: any;
}

export default function AboutClient({ settings, stats }: AboutClientProps) {
  return (
    <main className="relative">
      {/* S1: Hero - deep */}
      <ScrollSection className="bg-[var(--bg-void)]" id="hero">
        {(isVisible: boolean) => <HeroSection isVisible={isVisible} />}
      </ScrollSection>

      {/* S2: Design Philosophy - light */}
      <ScrollSection className="bg-[var(--bg-substrate)]" id="design">
        {(isVisible: boolean) => <DesignSection isVisible={isVisible} />}
      </ScrollSection>

      {/* S3: AI Copilot - deep */}
      <ScrollSection className="bg-[var(--bg-void)]" id="ai">
        {(isVisible: boolean) => <AiSection isVisible={isVisible} />}
      </ScrollSection>

      {/* S4: Semantic Search - light */}
      <ScrollSection className="bg-[var(--bg-substrate)]" id="search">
        {(isVisible: boolean) => <SearchSection isVisible={isVisible} />}
      </ScrollSection>

      {/* S5: Editor - deep */}
      <ScrollSection className="bg-[var(--bg-void)]" id="editor">
        {(isVisible: boolean) => <EditorSection isVisible={isVisible} />}
      </ScrollSection>

      {/* S6: Tech Stack - light */}
      <ScrollSection className="bg-[var(--bg-substrate)]" id="tech">
        {(isVisible: boolean) => <TechStackSection isVisible={isVisible} />}
      </ScrollSection>

      {/* S7: Security - deep */}
      <ScrollSection className="bg-[var(--bg-void)]" id="security">
        {(isVisible: boolean) => <SecuritySection isVisible={isVisible} />}
      </ScrollSection>

      {/* S8: Author + CTA - light */}
      <ScrollSection className="bg-[var(--bg-substrate)]" id="author">
        {(isVisible: boolean) => (
          <AuthorCTASection isVisible={isVisible} settings={settings} stats={stats} />
        )}
      </ScrollSection>
    </main>
  );
}
