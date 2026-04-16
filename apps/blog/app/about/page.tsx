import type { Metadata } from 'next';
import { getSiteSettings, getSiteStats } from '@/app/lib/services';
import AboutClient from './AboutClient';

export const revalidate = 600; // 10 min ISR, aligned with getSiteStats cache

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  return {
    title: `关于 - ${settings.siteTitle}`,
    description: `了解 ${settings.siteTitle} 的设计哲学、AI 能力与技术架构`,
  };
}

export default async function AboutPage() {
  const [settings, stats] = await Promise.all([
    getSiteSettings(),
    getSiteStats(),
  ]);

  return <AboutClient settings={settings} stats={stats} />;
}
