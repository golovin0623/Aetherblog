import type { Metadata } from 'next';
import { getSiteSettings } from '@/app/lib/services';
import LoginClient from './LoginClient';

export const metadata: Metadata = {
  title: '登录 · Agent',
  robots: { index: false, follow: false },
};

export default async function AgentLoginPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const settings = await getSiteSettings();
  const params = (await searchParams) ?? {};
  const rawNext = params.next;
  const next = typeof rawNext === 'string' ? rawNext : '';

  return <LoginClient siteTitle={settings.siteTitle || 'AetherBlog'} next={next} />;
}
