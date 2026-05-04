import type { Metadata } from 'next';
import { getSiteSettings } from '@/app/lib/services';
import AgentLandingClient from './AgentLandingClient';

export const revalidate = 600;

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  return {
    title: `Agent - ${settings.siteTitle}`,
    description: `${settings.siteTitle} 的 AI 对话与代理工作台 —— 与思想共智`,
  };
}

export default async function AgentEntryPage() {
  const settings = await getSiteSettings();
  return <AgentLandingClient settings={settings} />;
}
