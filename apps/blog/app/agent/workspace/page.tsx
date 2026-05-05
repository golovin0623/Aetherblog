import type { Metadata } from 'next';
import { getSiteSettings } from '@/app/lib/services';
import WorkspaceClient from './WorkspaceClient';

export const metadata: Metadata = {
  title: '工作台 · Agent',
  robots: { index: false, follow: false },
};

export default async function AgentWorkspacePage() {
  const settings = await getSiteSettings();
  return <WorkspaceClient siteTitle={settings.siteTitle || 'AetherBlog'} />;
}
