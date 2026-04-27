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
      {/* S1：Hero - 深色 */}
      <ScrollSection className="bg-[var(--bg-void)]" id="hero">
        {(isVisible: boolean) => <HeroSection isVisible={isVisible} />}
      </ScrollSection>

      {/* S2：设计理念 - 浅色 */}
      <ScrollSection className="bg-[var(--bg-substrate)]" id="design">
        {(isVisible: boolean) => <DesignSection isVisible={isVisible} />}
      </ScrollSection>

      {/* S3：AI 协作 - 深色 */}
      <ScrollSection className="bg-[var(--bg-void)]" id="ai">
        {(isVisible: boolean) => <AiSection isVisible={isVisible} />}
      </ScrollSection>

      {/* S4：语义搜索 - 浅色 */}
      <ScrollSection className="bg-[var(--bg-substrate)]" id="search">
        {(isVisible: boolean) => <SearchSection isVisible={isVisible} />}
      </ScrollSection>

      {/* S5：编辑器 - 深色 */}
      <ScrollSection className="bg-[var(--bg-void)]" id="editor">
        {(isVisible: boolean) => <EditorSection isVisible={isVisible} />}
      </ScrollSection>

      {/* S6：技术栈 - 浅色 */}
      <ScrollSection className="bg-[var(--bg-substrate)]" id="tech">
        {(isVisible: boolean) => <TechStackSection isVisible={isVisible} />}
      </ScrollSection>

      {/* S7：安全 - 深色 */}
      <ScrollSection className="bg-[var(--bg-void)]" id="security">
        {(isVisible: boolean) => <SecuritySection isVisible={isVisible} />}
      </ScrollSection>

      {/* S8：作者 + CTA - 浅色 */}
      <ScrollSection className="bg-[var(--bg-substrate)]" id="author">
        {(isVisible: boolean) => (
          <AuthorCTASection isVisible={isVisible} settings={settings} stats={stats} />
        )}
      </ScrollSection>
    </main>
  );
}
